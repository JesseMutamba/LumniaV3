"""Green or it didn't happen.

Two tests carry the product claim: test_value_requires_source and
test_publish_rejects_unsourced_value. If either goes red, Lumnia's one
differentiator is false and nothing else in the suite matters.
"""
from __future__ import annotations

import io
import json

import pytest
from pydantic import ValidationError

from app.pipeline.checks import (
    check_implied_price,
    check_subtotal,
    detect_rollup_hierarchy,
)
from app.pipeline.ingest import a1, a1_range
from app.schema import Src, Value
from conftest import doc  # noqa: E402


# --------------------------------------------------------------- schema ---

def test_value_requires_source():
    with pytest.raises(ValidationError):
        Value(n=1000.0, unit="USD")  # type: ignore[call-arg]


def test_value_with_source_is_fine():
    assert Value(n=1.0, unit="USD", src=Src(file=0, sheet="S", cells="A1")).derived == "read"


def test_a1_addressing():
    assert a1(1, 1) == "A1"
    assert a1(96, 3) == "C96"
    assert a1(18, 27) == "AA18"
    assert a1_range(43, 4, 43, 6) == "D43:F43"
    assert a1_range(4, 4, 4, 4) == "D4"


# --------------------------------------------------------------- checks ---

def test_rollup_detects_parent_child():
    r = detect_rollup_hierarchy([
        ("PLANTATIONS", 87930.28),
        ("PRODUCTION", 36218.48),
        ("MAINTENANCE DES BLOCS", 39432.50),
        ("AGRITECH/HSE", 12279.30),
    ])
    assert not r.passed
    assert r.data["parents"][0]["parent"] == "PLANTATIONS"
    assert r.data["overstatement"] == pytest.approx(87930.28, abs=0.01)


def test_rollup_leaves_flat_columns_alone():
    assert detect_rollup_hierarchy([("A", 10.0), ("B", 20.0), ("C", 45.0)]).passed


def test_subtotal_check():
    assert check_subtotal([10.0, 20.0], 30.0).passed
    assert not check_subtotal([10.0, 20.0], 25.0).passed


def test_implied_price_flags_inconsistency():
    assert check_implied_price([771190, 1081920], [771.19, 1081.92], ["26", "27"]).passed
    assert not check_implied_price([238939, 771190], [254.08, 771.19], ["25", "26"]).passed


# ------------------------------------------------------ empty by default ---

def test_platform_boots_empty(client):
    h = client.get("/v1/health").json()
    assert h["ok"] and h["publishing_enabled"]
    assert len(h["block_types"]) == 8


def test_unknown_org_404s(client):
    assert client.get("/v1/orgs/nope/reports").status_code == 404


# ------------------------------------------------------------ authoring ---

def test_writes_require_a_token(client):
    assert client.post("/v1/orgs", json={"id": "x", "name": "X", "sub": {"fr": "y"}}).status_code == 401
    assert client.post("/v1/orgs/acme/reports", json=doc()).status_code == 401
    assert client.post("/v1/studio/import", files={"file": ("r.json", b"{}")}).status_code == 401


def test_bad_token_rejected(client):
    r = client.post("/v1/orgs", json={"id": "x", "name": "X", "sub": {"fr": "y"}},
                    headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_create_org_and_publish(client, auth, org):
    r = client.post(f"/v1/orgs/{org}/reports", json=doc("r-pub"), headers=auth)
    assert r.status_code == 201
    body = r.json()
    assert len(body["share_key"]) == 32
    assert client.get(f"/v1/orgs/{org}/reports").json()[0]["id"] == "r-pub"


def test_publish_rejects_unsourced_value(client, auth, org):
    bad = doc("r-bad")
    bad["blocks"][0]["items"][0]["value"] = {"n": 1.0, "unit": "USD"}
    assert client.post(f"/v1/orgs/{org}/reports", json=bad, headers=auth).status_code == 422


def test_publish_rejects_unknown_block_type(client, auth, org):
    bad = doc("r-blk", blocks=[{"type": "sankey"}])
    assert client.post(f"/v1/orgs/{org}/reports", json=bad, headers=auth).status_code == 422


def test_publish_to_unknown_org_404s(client, auth):
    assert client.post("/v1/orgs/ghost/reports", json=doc("r-x", org="ghost"),
                       headers=auth).status_code == 404


def test_import_json_file(client, auth, org):
    payload = json.dumps(doc("r-imp")).encode()
    r = client.post("/v1/studio/import",
                    files={"file": ("report.json", io.BytesIO(payload), "application/json")},
                    headers=auth)
    assert r.status_code == 201 and r.json()["id"] == "r-imp"


def test_import_rejects_malformed_json(client, auth):
    r = client.post("/v1/studio/import",
                    files={"file": ("r.json", b"{not json", "application/json")},
                    headers=auth)
    assert r.status_code == 400


# ------------------------------------------------------------- sharing ---

def test_read_requires_the_share_key(client, auth, org):
    key = client.post(f"/v1/orgs/{org}/reports", json=doc("r-key"), headers=auth).json()["share_key"]
    assert client.get("/v1/reports/r-key").status_code == 404
    assert client.get("/v1/reports/r-key?k=nope").status_code == 404
    ok = client.get(f"/v1/reports/r-key?k={key}")
    assert ok.status_code == 200
    assert ok.json()["share_key"] is None  # never echoed back to a reader


def test_rotating_the_key_kills_old_links(client, auth, org):
    old = client.post(f"/v1/orgs/{org}/reports", json=doc("r-rot"), headers=auth).json()["share_key"]
    new = client.post("/v1/studio/reports/r-rot/rotate-key", headers=auth).json()["share_key"]
    assert new != old
    assert client.get(f"/v1/reports/r-rot?k={old}").status_code == 404
    assert client.get(f"/v1/reports/r-rot?k={new}").status_code == 200


def test_republishing_keeps_the_same_link(client, auth, org):
    first = client.post(f"/v1/orgs/{org}/reports", json=doc("r-v2"), headers=auth).json()["share_key"]
    second = client.post(f"/v1/orgs/{org}/reports", json=doc("r-v2"), headers=auth).json()["share_key"]
    assert first == second  # a corrected report reaches the people already holding the link


def test_retracted_report_returns_410(client, auth, org):
    key = client.post(f"/v1/orgs/{org}/reports", json=doc("r-ret"), headers=auth).json()["share_key"]
    client.patch("/v1/studio/reports/r-ret/status?new_status=retracted", headers=auth)
    r = client.get(f"/v1/reports/r-ret?k={key}")
    assert r.status_code == 410


def test_author_can_read_without_a_key(client, auth, org):
    client.post(f"/v1/orgs/{org}/reports", json=doc("r-auth"), headers=auth)
    r = client.get("/v1/studio/reports/r-auth", headers=auth)
    assert r.status_code == 200 and r.json()["share_key"]


# -------------------------------------------------------------- portal ---

def _portal_key(client, auth, org):
    orgs = client.get("/v1/studio/orgs", headers=auth).json()
    return next(o["share_key"] for o in orgs if o["id"] == org)


def test_portal_requires_the_org_key(client, auth, org):
    key = _portal_key(client, auth, org)
    assert key and len(key) == 32
    assert client.get(f"/v1/portal/{org}").status_code == 404
    assert client.get(f"/v1/portal/{org}?k=nope").status_code == 404
    assert client.get("/v1/portal/ghost?k=" + key).status_code == 404
    assert client.get(f"/v1/portal/{org}?k={key}").status_code == 200


def test_portal_lists_only_published(client, auth, org):
    client.post(f"/v1/orgs/{org}/reports", json=doc("p-pub"), headers=auth)
    client.post(f"/v1/orgs/{org}/reports", json=doc("p-dra", status="draft"), headers=auth)
    client.post(f"/v1/orgs/{org}/reports", json=doc("p-ret"), headers=auth)
    client.patch("/v1/studio/reports/p-ret/status?new_status=retracted", headers=auth)
    key = _portal_key(client, auth, org)
    body = client.get(f"/v1/portal/{org}?k={key}").json()
    ids = [r["id"] for r in body["reports"]]
    assert "p-pub" in ids and "p-dra" not in ids and "p-ret" not in ids
    # each entry carries a working report link
    entry = next(r for r in body["reports"] if r["id"] == "p-pub")
    assert client.get(f"/v1/reports/p-pub?k={entry['share_key']}").status_code == 200


def test_rotating_the_portal_key_kills_the_old_link(client, auth, org):
    old = _portal_key(client, auth, org)
    new = client.post(f"/v1/studio/orgs/{org}/rotate-key", headers=auth).json()["share_key"]
    assert new != old
    assert client.get(f"/v1/portal/{org}?k={old}").status_code == 404
    assert client.get(f"/v1/portal/{org}?k={new}").status_code == 200


def test_public_org_list_never_leaks_keys(client):
    for o in client.get("/v1/orgs").json():
        assert "share_key" not in o


def test_studio_org_list_requires_the_token(client):
    assert client.get("/v1/studio/orgs").status_code == 401
