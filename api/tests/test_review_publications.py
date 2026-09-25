"""Published financial reports use real temporary storage and verified clients."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import store
from app.auth import new_session
from app.routers import financial, publications
from app.schema import ContextIn, Text
from test_financial_reviews import document


BASE = "/v1/review-publications"
SCOPE = {"org": "client-a"}


@pytest.fixture
def publication_client(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "publications.sqlite")
    store.init()
    for org in ("client-a", "client-b"):
        store.put_org(org, org, Text(fr=org))
    headers = {}
    for name, org in (("alice", "client-a"), ("bob", "client-a"), ("carol", "client-b")):
        store.put_user(name, org, "test-hash", "test-salt")
        headers[name] = {"Authorization": "Bearer " + new_session(name)[0]}
    app = FastAPI()
    app.include_router(financial.router, prefix="/v1")
    app.include_router(publications.router, prefix="/v1")
    with TestClient(app) as client:
        yield client, headers, app


def save(client, headers, body=None):
    response = client.post("/v1/financial-reviews", params=SCOPE, headers=headers, json=body or document())
    assert response.status_code == 201, response.text
    return response.json()


def publish(client, headers, saved):
    return client.post(BASE, params=SCOPE, headers=headers,
                       json={"review_id": saved["id"], "expected_version": saved["version"]})


def test_publication_is_immutable_and_survives_draft_delete(publication_client):
    client, headers, _ = publication_client
    alice = headers["alice"]
    saved = save(client, alice)
    response = publish(client, alice, saved)
    assert response.status_code == 201, response.text
    published = response.json()
    assert published["kind"] == "financial" and published["status"] == "published"
    assert published["source_review_id"] == saved["id"] and published["source_version"] == 1
    assert published["version"] == 1 and published["trashed_at"] is None
    assert published["review"] == saved["review"] and published["drivers"] == saved["drivers"]
    assert published["review"]["plan"][0]["hectares"]["value"] is None
    assert "owner" not in published and "expected_version" not in published
    duplicate = publish(client, alice, saved)
    assert duplicate.status_code == 200 and duplicate.json() == published
    listed = client.get(BASE, params=SCOPE, headers=alice)
    assert listed.headers["cache-control"] == "no-store"
    assert listed.json()[0]["id"] == published["id"] and "review" not in listed.json()[0]
    url = BASE + "/" + published["id"]
    new_document = deepcopy(document())
    new_document.update(expected_version=1, title="Revised financial plan")
    new_document["drivers"]["volumePct"] = 20
    draft_url = "/v1/financial-reviews/" + saved["id"]
    updated = client.put(draft_url, params=SCOPE, headers=alice, json=new_document)
    assert updated.status_code == 200
    assert publish(client, alice, saved).status_code == 409
    assert client.get(url, params=SCOPE, headers=alice).json() == published
    second = publish(client, alice, updated.json())
    assert second.status_code == 201 and second.json()["id"] != published["id"]
    assert second.json()["source_version"] == 2
    assert client.delete(draft_url, params={**SCOPE, "expected_version": 2}, headers=alice).status_code == 204
    assert client.get(url, params=SCOPE, headers=alice).json() == published
    assert len(client.get(BASE, params=SCOPE, headers=alice).json()) == 2


def test_publication_trash_restore_and_versioned_permanent_delete(publication_client):
    client, headers, _ = publication_client
    alice = headers["alice"]
    saved = save(client, alice)
    published = publish(client, alice, saved).json()
    url = BASE + "/" + published["id"]
    assert client.delete(url, params={**SCOPE, "expected_version": 1}, headers=alice).status_code == 409
    trashed = client.post(url + "/trash", params=SCOPE, headers=alice, json={"expected_version": 1})
    assert trashed.status_code == 200, trashed.text
    assert trashed.json()["version"] == 2 and trashed.json()["status"] == "trashed"
    assert trashed.json()["trashed_at"] and trashed.json()["review"] == published["review"]
    assert client.get(BASE, params=SCOPE, headers=alice).json() == []
    assert client.get(BASE, params={**SCOPE, "status": "trashed"}, headers=alice).json()[0]["id"] == published["id"]
    assert client.get(url, params=SCOPE, headers=alice).json() == trashed.json()
    assert publish(client, alice, saved).status_code == 409
    assert client.post(url + "/restore", params=SCOPE, headers=alice, json={"expected_version": 1}).status_code == 409
    restored = client.post(url + "/restore", params=SCOPE, headers=alice, json={"expected_version": 2})
    assert restored.status_code == 200 and restored.json()["version"] == 3
    assert restored.json()["trashed_at"] is None and restored.json()["published_at"] == published["published_at"]
    assert client.post(url + "/trash", params=SCOPE, headers=alice, json={"expected_version": 2}).status_code == 409
    assert client.post(url + "/trash", params=SCOPE, headers=alice, json={"expected_version": 3}).status_code == 200
    assert client.delete(url, params={**SCOPE, "expected_version": 3}, headers=alice).status_code == 409
    assert client.delete(url, params={**SCOPE, "expected_version": 4}, headers=alice).status_code == 204
    assert client.get(url, params=SCOPE, headers=alice).status_code == 404
    assert client.get("/v1/financial-reviews/" + saved["id"], params=SCOPE, headers=alice).status_code == 200


def test_publication_owner_org_and_input_boundaries(publication_client):
    client, headers, _ = publication_client
    alice = headers["alice"]
    saved = save(client, alice)
    published = publish(client, alice, saved).json()
    url = BASE + "/" + published["id"]
    for other, scope, status in (({}, SCOPE, 401), (headers["bob"], SCOPE, 404),
                                 (headers["carol"], SCOPE, 404), (alice, {"org": "client-b"}, 404),
                                 ({"Authorization": "Bearer test-token"}, SCOPE, 404)):
        assert client.post(BASE, params=scope, headers=other,
                           json={"review_id": saved["id"], "expected_version": 1}).status_code == status
        assert client.get(url, params=scope, headers=other).status_code == status
        for action in ("trash", "restore"):
            assert client.post(url + "/" + action, params=scope, headers=other,
                               json={"expected_version": 1}).status_code == status
        assert client.delete(url, params={**scope, "expected_version": 1}, headers=other).status_code == status
    assert client.get(BASE, params=SCOPE, headers=headers["bob"]).json() == []
    for body in ({"review_id": saved["id"]}, {"review_id": saved["id"], "expected_version": True},
                 {"review_id": saved["id"], "expected_version": 1, "owner": "another"}):
        assert client.post(BASE, params=SCOPE, headers=alice, json=body).status_code == 422
    assert client.get(BASE, params={**SCOPE, "status": "all"}, headers=alice).status_code == 422
    assert client.post(url + "/trash", params=SCOPE, headers=alice, json={}).status_code == 422
    assert client.delete(url, params=SCOPE, headers=alice).status_code == 422
    store.delete_user("alice")
    store.put_user("alice", "client-a", "new-hash", "new-salt")
    replacement = {"Authorization": "Bearer " + new_session("alice")[0]}
    assert client.get(url, params=SCOPE, headers=alice).status_code == 401
    assert client.get(url, params=SCOPE, headers=replacement).status_code == 404
    assert client.get(BASE, params=SCOPE, headers=replacement).json() == []


def test_publication_validates_current_retention_exclusions_and_saved_schema(publication_client):
    client, headers, _ = publication_client
    alice = headers["alice"]
    saved = save(client, alice)
    store.put_context("client-a", ContextIn(retain_files=False))
    assert publish(client, alice, saved).status_code == 409
    store.put_context("client-a", ContextIn(ignore_sheets=[" PLAN "]))
    assert publish(client, alice, saved).status_code == 409
    store.put_context("client-a", ContextIn())
    published = publish(client, alice, saved).json()
    url = BASE + "/" + published["id"]
    store.put_context("client-a", ContextIn(retain_files=False))
    # Removing retained data is always available; restoring it checks policy.
    assert client.post(url + "/trash", params=SCOPE, headers=alice, json={"expected_version": 1}).status_code == 200
    assert client.post(url + "/restore", params=SCOPE, headers=alice, json={"expected_version": 2}).status_code == 409
    assert client.delete(url, params={**SCOPE, "expected_version": 2}, headers=alice).status_code == 204
    store.put_context("client-a", ContextIn())
    with store.connect() as con:
        con.execute("UPDATE financial_reviews SET doc='{}' WHERE id=?", (saved["id"],))
    assert publish(client, alice, saved).status_code == 409


def test_concurrent_publication_is_idempotent_and_lifecycle_has_one_winner(publication_client):
    client, headers, app = publication_client
    alice = headers["alice"]
    saved = save(client, alice)

    def race(action):
        barrier = Barrier(2)
        def worker(_):
            peer = TestClient(app)
            barrier.wait(timeout=10)
            return action(peer)
        with ThreadPoolExecutor(max_workers=2) as workers:
            return list(workers.map(worker, (1, 2)))

    responses = race(lambda peer: publish(peer, alice, saved))
    assert sorted(r.status_code for r in responses) == [200, 201], [r.text for r in responses]
    assert responses[0].json() == responses[1].json()
    url = BASE + "/" + responses[0].json()["id"]
    for action, version in (("trash", 1), ("restore", 2), ("trash", 3)):
        responses = race(lambda peer: peer.post(url + "/" + action, params=SCOPE, headers=alice,
                                               json={"expected_version": version}))
        assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
        assert next(r.json() for r in responses if r.status_code == 200)["version"] == version + 1
    responses = race(lambda peer: peer.delete(url, params={**SCOPE, "expected_version": 4}, headers=alice))
    assert sorted(r.status_code for r in responses) == [204, 404]
    assert client.get(BASE, params={**SCOPE, "status": "trashed"}, headers=alice).json() == []
