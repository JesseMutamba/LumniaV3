"""Release gate against a real, disposable PostgreSQL server.

Set LUMNIA_TEST_POSTGRES_URL to a test-only administrator connection with
CREATEDB permission. Every test creates and drops a uniquely named database.
DATABASE_URL is deliberately never used to select the test server. Without
the explicit test URL these tests skip; mocked SQL is not a substitute.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
from threading import Barrier
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
import pytest
from fastapi.testclient import TestClient

from app import portal, postgres, store
from test_analysis_studio import definitions, document as sales_document
from test_financial_reviews import document as financial_document


# The schema deployed before Studio, reproduced with synthetic records only.
LEGACY_SCHEMA = """
CREATE TABLE public.orgs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, sub JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.reports (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    title JSONB NOT NULL, period JSONB NOT NULL, generated_at TEXT,
    status TEXT NOT NULL DEFAULT 'published', share_key TEXT NOT NULL, doc JSONB NOT NULL
);
CREATE INDEX reports_org_idx ON public.reports(org_id);
CREATE TABLE public.users (
    id BIGSERIAL PRIMARY KEY, org_id TEXT NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL, disabled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE public.sessions (
    token TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE public.pilot_requests (
    id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name TEXT NOT NULL, company TEXT NOT NULL, role TEXT, email TEXT NOT NULL,
    country TEXT, sector TEXT, note TEXT, source_ip TEXT
);
CREATE INDEX pilot_created_idx ON public.pilot_requests(created_at DESC);
CREATE INDEX sessions_exp_idx ON public.sessions(expires_at);
"""
PASSWORD = "legacy-client-password"
SALT = bytes.fromhex("ef4029019c080771fa43d5b80738d012")
LEGACY_HASH = "pbkdf2_sha256$260000$" + SALT.hex() + "$" + hashlib.pbkdf2_hmac(
    "sha256", PASSWORD.encode(), SALT, 260000
).hex()
TOKENS = {"alice": "existing-opaque-alice-session", "bob": "existing-opaque-bob-session",
          "carol": "existing-opaque-carol-session"}
SHARE_KEY = "existing-share-key-kept-across-releases"
SEED_REPORT = {"id": "legacy-q1", "org": "client-a", "title": {"en": "Existing Q1"},
               "blocks": [{"type": "paragraph", "text": {"en": "Original published content"}}]}


def auth(name="alice"):
    return {"Authorization": "Bearer " + TOKENS[name]}


def seed_database(dsn):
    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        connection.execute(LEGACY_SCHEMA)
        for identity in ("client-a", "client-b"):
            subtitle = {} if identity == "client-a" else {"en": "Existing organization"}
            connection.execute("INSERT INTO public.orgs VALUES (%s,%s,%s)",
                               (identity, identity.upper(), Jsonb(subtitle)))
        expires = datetime.now(timezone.utc) + timedelta(days=7)
        for username, org in (("alice", "client-a"), ("bob", "client-a"), ("carol", "client-b")):
            user_id = connection.execute(
                "INSERT INTO public.users(org_id,username,pw_hash) VALUES (%s,%s,%s) RETURNING id",
                (org, username, LEGACY_HASH),
            ).fetchone()["id"]
            connection.execute("INSERT INTO public.sessions VALUES (%s,%s,%s)",
                               (TOKENS[username], user_id, expires))
        connection.execute(
            "INSERT INTO public.reports VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            ("legacy-q1", "client-a", Jsonb({"en": "Existing Q1"}), Jsonb({"en": "Q1 2026"}),
             "2026-04-01T00:00:00Z", "published", SHARE_KEY, Jsonb(SEED_REPORT)),
        )
        connection.execute(
            "INSERT INTO public.pilot_requests(name,company,email,note) VALUES (%s,%s,%s,%s)",
            ("Existing lead", "Synthetic company", "existing@example.com", "Preserve this enquiry"),
        )


def snapshot_legacy(dsn):
    """Capture the exact pre-upgrade records, allowing later newly added rows."""
    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        result = {}
        for table in ("orgs", "reports", "users", "pilot_requests"):
            statement = sql.SQL("SELECT * FROM public.{} ORDER BY id").format(sql.Identifier(table))
            rows = connection.execute(statement).fetchall()
            result[table] = [row for row in rows if table != "pilot_requests" or row["id"] == 1]
        result["sessions"] = connection.execute(
            "SELECT * FROM public.sessions WHERE token = ANY(%s) ORDER BY token", (list(TOKENS.values()),)
        ).fetchall()
    return result


@pytest.fixture
def pg_database(monkeypatch, tmp_path):
    admin_url = os.environ.get("LUMNIA_TEST_POSTGRES_URL")
    if not admin_url:
        pytest.skip("Real PostgreSQL gate requires explicit LUMNIA_TEST_POSTGRES_URL (never DATABASE_URL)")
    name = "lumnia_test_" + uuid.uuid4().hex
    assert re.fullmatch(r"lumnia_test_[0-9a-f]{32}", name)
    dsn = make_conninfo(admin_url, dbname=name)
    created = False
    postgres.close()
    try:
        with psycopg.connect(admin_url, autocommit=True, connect_timeout=10) as admin:
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        created = True
        seed_database(dsn)
        monkeypatch.setenv("DATABASE_URL", dsn)
        monkeypatch.setenv("LUMNIA_PORTAL_KEY_CLIENT-A", "test-portal-key")
        # Existing deployment bootstrap variables must not reseed these rows.
        monkeypatch.setenv("LUMNIA_CLIENT_USER", "alice")
        monkeypatch.setenv("LUMNIA_CLIENT_PASSWORD", "must-not-overwrite-existing-password")
        monkeypatch.setenv("LUMNIA_CLIENT_ORG", "client-b")
        monkeypatch.setenv("LUMNIA_BOOTSTRAP_ORGS", "must-not-be-created:Unexpected")
        monkeypatch.setenv("LUMNIA_BUILD_SHA", "postgres-release-test")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        sqlite_path = tmp_path / "must-not-create-sqlite.db"
        monkeypatch.setenv("LUMNIA_DB", str(sqlite_path))
        monkeypatch.setattr(store, "DB_PATH", sqlite_path)
        static = tmp_path / "static"
        static.mkdir()
        (static / "index.html").write_text("<html>Existing Lumnia landing</html>")
        for directory, text in (("signup", "Existing signup"), ("reports/sample", "Existing sample"),
                                ("workspace", "New analytics workspace")):
            page = static / directory
            page.mkdir(parents=True)
            (page / "index.html").write_text("<html>" + text + "</html>")
        monkeypatch.setenv("LUMNIA_PORTAL_STATIC", str(static))
        yield {"dsn": dsn, "sqlite": sqlite_path, "static": static}
    finally:
        postgres.close()
        if created:
            # Only this fixture's freshly generated name can reach DROP. No
            # supplied URL's database and no pre-existing database is dropped.
            assert re.fullmatch(r"lumnia_test_[0-9a-f]{32}", name)
            with psycopg.connect(admin_url, autocommit=True, connect_timeout=10) as admin:
                admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


def test_existing_portal_records_auth_and_routes_survive(pg_database):
    baseline = snapshot_legacy(pg_database["dsn"])
    for boot in range(2):
        with TestClient(portal.create_app()) as client:
            assert snapshot_legacy(pg_database["dsn"]) == baseline
            health = client.get("/v1/health")
            assert health.status_code == 200 and health.json()["deployment_mode"] == "portal"
            assert health.json()["publishing_enabled"] is False
            assert health.headers["cache-control"] == "private, no-store"
            identity = client.get("/v1/auth/me", headers=auth())
            assert identity.status_code == 200
            assert identity.json()["user"] == {"id": 1, "username": "alice", "org": "client-a"}
            assert client.get("/v1/me/reports", headers=auth()).json()[0]["share_key"] == SHARE_KEY
            assert client.get("/v1/reports/legacy-q1", headers=auth()).json() == SEED_REPORT
            assert client.get("/v1/reports/legacy-q1", headers=auth("carol")).status_code == 404
            assert client.get("/v1/reports/legacy-q1", params={"k": SHARE_KEY}).json() == SEED_REPORT
            assert client.get("/v1/reports/legacy-q1", params={"k": "é"}).status_code == 404
            assert client.get("/v1/portal/client-a", params={"k": "test-portal-key"}).status_code == 200
            assert client.get("/v1/portal/client-a", params={"k": "wrong"}).status_code == 404
            login = client.post("/v1/auth/login", json={"username": "alice", "password": PASSWORD})
            assert login.status_code == 200, login.text
            assert login.json()["org"]["id"] == "client-a"
            new_auth = {"Authorization": "Bearer " + login.json()["token"]}
            assert client.get("/v1/auth/me", headers=new_auth).status_code == 200
            assert client.post("/v1/auth/logout", headers=new_auth).status_code == 204
            assert client.get("/v1/auth/me", headers=new_auth).status_code == 401
            assert client.post("/v1/auth/login", json={"username": "alice", "password": "wrong"}).status_code == 401
            for path in ("/", "/signup", "/signup/", "/reports/sample/", "/workspace/"):
                assert client.get(path).status_code == 200
            for path in ("/v1/unknown", "/v1", "/assets/missing.js"):
                response = client.get(path)
                assert response.status_code == 404 and response.headers["content-type"].startswith("application/json")
            if boot == 0:
                pilot = client.post("/v1/pilot-requests", json={"name": "New synthetic lead", "company": "Test", "email": "new@example.com"})
                assert pilot.status_code == 201
        assert snapshot_legacy(pg_database["dsn"]) == baseline
        assert not pg_database["sqlite"].exists()


def test_saved_analysis_and_financial_reviews_enforce_versions_and_owners(pg_database, monkeypatch):
    app = portal.create_app()
    scope = {"org": "client-a"}
    baseline = snapshot_legacy(pg_database["dsn"])
    saved = []
    with TestClient(app) as client:
        for base, make_document in (("/v1/analysis-studio/dashboards", sales_document),
                                    ("/v1/financial-reviews", financial_document)):
            assert client.post(base, params=scope, json=make_document()).status_code == 401
            assert client.post(base, params=scope, headers=auth("carol"), json=make_document()).status_code == 404
            response = client.post(base, params=scope, headers=auth(), json=make_document())
            assert response.status_code == 201, response.text
            original = response.json()
            url = base + "/" + original["id"]
            assert client.get(url, params=scope, headers=auth()).json() == original
            for headers, params in ((auth("bob"), scope), (auth("carol"), scope), (auth(), {"org": "client-b"}),
                                    ({"Authorization": "Bearer test-token"}, scope)):
                assert client.get(url, params=params, headers=headers).status_code == 404
                assert client.put(url, params=params, headers=headers, json={**make_document(), "expected_version": 1}).status_code == 404
                assert client.delete(url, params={**params, "expected_version": 1}, headers=headers).status_code == 404
            barrier = Barrier(2)

            def writer(number):
                body = {**make_document(), "title": f"Concurrent edit {number}", "expected_version": 1}
                # Without a context manager, each TestClient request owns an
                # independent ASGI event loop. The enclosing client has already
                # run startup. Blocking SQL cannot serialize both requests on
                # one test event loop and hide a database race.
                worker = TestClient(app)
                barrier.wait(timeout=10)
                return worker.put(url, params=scope, headers=auth(), json=body)

            with ThreadPoolExecutor(max_workers=2) as workers:
                responses = list(workers.map(writer, (1, 2)))
            assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
            winner = next(r.json() for r in responses if r.status_code == 200)
            assert winner["version"] == 2
            assert client.get(url, params=scope, headers=auth()).json() == winner
            saved.append((url, winner))
        # An explicitly configured administrator may configure organization AI
        # credentials, while the client documents above remain owner-private.
        ai_base = "/v1/analysis-studio/ai"
        admin = {"Authorization": "Bearer test-token"}
        assert client.get(ai_base + "/status", params=scope, headers=auth()).json()["canConfigure"] is False
        assert client.get(ai_base + "/status", params=scope, headers=admin).json()["canConfigure"] is True
        monkeypatch.setenv("LUMNIA_CREDENTIAL_KEY", base64.urlsafe_b64encode(b"\x19" * 32).decode())
        connection = {"provider": "openai", "model": "gpt-5-mini", "apiKey": "synthetic-test-key-never-used-with-provider"}
        assert client.put(ai_base + "/connection", params=scope, headers=auth(), json=connection).status_code == 403
        configured = client.put(ai_base + "/connection", params=scope, headers=admin, json=connection)
        assert configured.status_code == 200, configured.text
        assert connection["apiKey"] not in configured.text
    with TestClient(portal.create_app()) as client:
        for url, winner in saved:
            assert client.get(url, params=scope, headers=auth()).json() == winner
    assert snapshot_legacy(pg_database["dsn"]) == baseline
    with psycopg.connect(pg_database["dsn"], row_factory=dict_row) as connection:
        tables = connection.execute("SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema IN ('public','lumnia_studio')").fetchall()
        for name in ("financial_reviews", "review_publications", "analysis_studio_dashboards", "analysis_studio_definitions",
                     "analysis_studio_definition_history", "analysis_studio_ai_connections", "contexts"):
            assert {"table_schema": "lumnia_studio", "table_name": name} in tables
            assert {"table_schema": "public", "table_name": name} not in tables
        foreign_keys = connection.execute("""SELECT c.conname FROM pg_constraint c
            JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname='lumnia_studio' AND c.contype='f' AND c.confrelid='public.orgs'::regclass""").fetchall()
        assert len(foreign_keys) == 7
    assert not pg_database["sqlite"].exists()


@pytest.mark.parametrize("subtitle,expected", [({}, ""), ({"en": "English-only portal organization"}, "English-only portal organization")])
def test_legacy_organization_display_metadata_needs_no_french_field(monkeypatch, subtitle, expected):
    """Run without a server too: decoding display metadata must not mutate it."""
    from app import portal_db

    original = {"id": "org", "name": "Existing", "sub": subtitle.copy()}
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused-for-this-pure-decoding-test")
    monkeypatch.setattr(portal_db, "org_row", lambda _: original)
    decoded = store.get_org("org")
    assert decoded.id == "org" and decoded.sub.fr == expected and decoded.sub.en == expected
    assert original["sub"] == subtitle


def test_concurrent_first_definitions_write_has_one_history_entry(pg_database):
    app = portal.create_app()
    scope = {"org": "client-a"}
    url = "/v1/analysis-studio/definitions/" + "b" * 64
    with TestClient(app) as client:
        assert client.get(url, params=scope, headers=auth()).json() is None
        for expected_version in (0, 1):
            barrier = Barrier(2)

            def writer(number):
                body = definitions()
                body["expected_version"] = expected_version
                body["fields"][1]["definition"] = f"Confirmed sales definition {number}"
                worker = TestClient(app)
                barrier.wait(timeout=10)
                return worker.put(url, params=scope, headers=auth(), json=body)

            with ThreadPoolExecutor(max_workers=2) as workers:
                responses = list(workers.map(writer, (1, 2)))
            assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
            winner = next(r.json() for r in responses if r.status_code == 200)
            assert winner["version"] == expected_version + 1
            assert client.get(url, params=scope, headers=auth()).json() == winner
            assert client.get(url, params=scope, headers=auth("bob")).json() is None
            assert client.get(url, params=scope, headers=auth("carol")).status_code == 404
            with psycopg.connect(pg_database["dsn"], row_factory=dict_row) as connection:
                history = connection.execute("SELECT version,doc FROM lumnia_studio.analysis_studio_definition_history ORDER BY version").fetchall()
                assert [row["version"] for row in history] == list(range(1, expected_version + 2))
                assert json.loads(history[-1]["doc"])["fields"] == winner["fields"]


def test_published_reviews_lifecycle_and_restart_preserve_legacy_reports(pg_database):
    """Use real PostgreSQL row locks, JSON snapshots and original opaque sessions."""
    baseline = snapshot_legacy(pg_database["dsn"])
    app = portal.create_app()
    scope = {"org": "client-a"}
    base = "/v1/review-publications"
    with TestClient(app) as client:
        health = client.get("/v1/health").json()
        assert "review-publications" in health["features"]
        assert health["publishing_enabled"] is False
        saved = client.post("/v1/financial-reviews", params=scope, headers=auth(), json=financial_document()).json()
        body = {"review_id": saved["id"], "expected_version": 1}
        # More callers than the five-connection pool prove publication does
        # not need a nested checkout while holding the source row lock.
        barrier = Barrier(6)

        def publisher(_):
            worker = TestClient(app)
            barrier.wait(timeout=10)
            return worker.post(base, params=scope, headers=auth(), json=body)

        with ThreadPoolExecutor(max_workers=6) as workers:
            responses = list(workers.map(publisher, range(6)))
        assert sorted(r.status_code for r in responses) == [200, 200, 200, 200, 200, 201], [r.text for r in responses]
        published = responses[0].json()
        assert all(published == r.json() for r in responses)
        assert published["review"] == saved["review"]
        url = base + "/" + published["id"]
        for headers, query in ((auth("bob"), scope), (auth("carol"), scope), (auth(), {"org": "client-b"})):
            assert client.get(url, params=query, headers=headers).status_code == 404
            assert client.post(base, params=query, headers=headers, json=body).status_code == 404
            assert client.post(url + "/trash", params=query, headers=headers, json={"expected_version": 1}).status_code == 404
            assert client.delete(url, params={**query, "expected_version": 1}, headers=headers).status_code == 404
        # Draft deletion cannot remove the frozen report or its provenance.
        assert client.delete("/v1/financial-reviews/" + saved["id"], params={**scope, "expected_version": 1}, headers=auth()).status_code == 204
        assert client.get(url, params=scope, headers=auth()).json() == published
    with TestClient(portal.create_app()) as client:
        assert client.get(url, params=scope, headers=auth()).json() == published
        for action, version in (("trash", 1), ("restore", 2), ("trash", 3)):
            barrier = Barrier(2)

            def transition(_):
                worker = TestClient(app)
                barrier.wait(timeout=10)
                return worker.post(url + "/" + action, params=scope, headers=auth(), json={"expected_version": version})

            with ThreadPoolExecutor(max_workers=2) as workers:
                responses = list(workers.map(transition, (1, 2)))
            assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
            winner = next(r.json() for r in responses if r.status_code == 200)
            assert winner["version"] == version + 1 and winner["review"] == published["review"]
        assert client.get(base, params=scope, headers=auth()).json() == []
        assert client.get(base, params={**scope, "status": "trashed"}, headers=auth()).json()[0]["id"] == published["id"]
        assert client.delete(url, params={**scope, "expected_version": 3}, headers=auth()).status_code == 409
        assert client.delete(url, params={**scope, "expected_version": 4}, headers=auth()).status_code == 204
        assert client.get(url, params=scope, headers=auth()).status_code == 404
        assert client.get("/v1/reports/legacy-q1", params={"k": SHARE_KEY}).json() == SEED_REPORT
    assert snapshot_legacy(pg_database["dsn"]) == baseline
    assert not pg_database["sqlite"].exists()


def test_expired_disabled_and_recreated_accounts_cannot_reuse_owner(pg_database):
    scope = {"org": "client-a"}
    base = "/v1/analysis-studio/dashboards"
    with TestClient(portal.create_app()) as client:
        created = client.post(base, params=scope, headers=auth(), json=sales_document()).json()
        url = base + "/" + created["id"]
        with psycopg.connect(pg_database["dsn"]) as connection:
            connection.execute("UPDATE public.users SET disabled=TRUE WHERE username='alice'")
        assert client.get("/v1/auth/me", headers=auth()).status_code == 401
        assert client.get(url, params=scope, headers=auth()).status_code == 401
        with psycopg.connect(pg_database["dsn"]) as connection:
            connection.execute("UPDATE public.users SET disabled=FALSE WHERE username='alice'")
            connection.execute("UPDATE public.sessions SET expires_at=now()-interval '1 second' WHERE token=%s", (TOKENS["alice"],))
        assert client.get(url, params=scope, headers=auth()).status_code == 401
        login = client.post("/v1/auth/login", json={"username": "alice", "password": PASSWORD}).json()
        fresh_auth = {"Authorization": "Bearer " + login["token"]}
        assert client.get(url, params=scope, headers=fresh_auth).status_code == 200
        with psycopg.connect(pg_database["dsn"]) as connection:
            connection.execute("DELETE FROM public.users WHERE username='alice'")
            connection.execute("INSERT INTO public.users(org_id,username,pw_hash) VALUES ('client-a','alice',%s)", (LEGACY_HASH,))
        assert client.get(url, params=scope, headers=fresh_auth).status_code == 401
        replacement = client.post("/v1/auth/login", json={"username": "alice", "password": PASSWORD}).json()
        assert replacement["user"]["id"] != login["user"]["id"]
        assert client.get(url, params=scope, headers={"Authorization": "Bearer " + replacement["token"]}).status_code == 404


def test_missing_core_schema_fails_without_creating_sqlite(pg_database):
    with psycopg.connect(pg_database["dsn"]) as connection:
        connection.execute("ALTER TABLE public.pilot_requests RENAME TO missing_pilot_requests")
    with pytest.raises(psycopg.errors.UndefinedTable):
        with TestClient(portal.create_app()):
            pytest.fail("An incompatible database must not start an empty replacement application")
    with psycopg.connect(pg_database["dsn"]) as connection:
        assert connection.execute("SELECT count(*) FROM pg_namespace WHERE nspname='lumnia_studio'").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM public.reports").fetchone()[0] == 1
    assert not pg_database["sqlite"].exists()


@contextmanager
def running_server(tmp_path, boot):
    with socket.socket() as socket_:
        socket_.bind(("127.0.0.1", 0))
        port = socket_.getsockname()[1]
    env = {**os.environ, "PORT": str(port)}
    api = Path(__file__).resolve().parents[1]
    with (tmp_path / f"postgres-boot-{boot}.log").open("w+") as log:
        process = subprocess.Popen([sys.executable, "-m", "app.serve"], cwd=api, env=env,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)

        def request(path, payload=None):
            headers = {**auth(), "Content-Type": "application/json"}
            req = Request(f"http://127.0.0.1:{port}" + path,
                          data=None if payload is None else json.dumps(payload).encode(), headers=headers)
            try:
                response = urlopen(req, timeout=3)
            except HTTPError as exc:
                response = exc
            with response:
                body = response.read().decode()
                return response.status, json.loads(body) if "application/json" in response.headers.get("Content-Type", "") else body

        try:
            deadline = time.monotonic() + 30
            while True:
                if process.poll() is not None:
                    # Avoid printing a database URL from a driver startup log.
                    raise AssertionError("PostgreSQL portal exited before readiness; inspect the isolated test log")
                try:
                    status, health = request("/v1/health")
                    if status == 200:
                        assert health["deployment_mode"] == "portal"
                        assert health["revision"] == "postgres-release-test"
                        break
                except (URLError, TimeoutError):
                    pass
                assert time.monotonic() < deadline, "PostgreSQL portal did not become ready on assigned PORT"
                time.sleep(0.05)
            yield request
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def test_actual_railway_entrypoint_reopens_both_documents_after_restart(pg_database, tmp_path):
    baseline = snapshot_legacy(pg_database["dsn"])
    saved = []
    for boot in range(2):
        with running_server(tmp_path, boot) as request:
            assert request("/")[0] == 200
            assert request("/workspace/")[0] == 200
            assert request("/v1/auth/me")[1]["user"]["username"] == "alice"
            assert request("/v1/reports/legacy-q1?k=" + SHARE_KEY) == (200, SEED_REPORT)
            if boot == 0:
                for base, body in (("/v1/analysis-studio/dashboards", sales_document()),
                                   ("/v1/financial-reviews", financial_document())):
                    status, document = request(base + "?org=client-a", body)
                    assert status == 201, document
                    saved.append((base + "/" + document["id"] + "?org=client-a", document))
            for path, document in saved:
                assert request(path) == (200, document)
            assert snapshot_legacy(pg_database["dsn"]) == baseline
        assert not pg_database["sqlite"].exists()
