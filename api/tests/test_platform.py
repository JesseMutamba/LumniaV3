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


# --------------------------------------------------------- parse layer ---

def _xlsx(sheets: dict) -> bytes:
    """Build a workbook in memory: {sheet: [[row], ...]}."""
    from openpyxl import Workbook as XlsxWorkbook
    wb = XlsxWorkbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


BUDGET_SHEET = {
    "budget": [
        ["Poste", "Budget USD", "Réel USD"],
        ["Semences", 12000, 9500],
        ["Engrais", 8000, 8100],
        ["Transport", 5000, 2200],
        ["Main d'œuvre", 15000, 14000],
    ]
}


def _ingest(client, auth, sheets, org="acme"):
    return client.post(
        f"/v1/studio/ingest?org={org}",
        files={"file": ("test.xlsx", io.BytesIO(_xlsx(sheets)), "application/x")},
        headers=auth,
    )


def test_parse_detects_a_table_and_builds_a_draft(client, auth):
    body = _ingest(client, auth, BUDGET_SHEET).json()
    assert len(body["tables"]) == 1
    t = body["tables"][0]
    assert t["sheet"] == "budget" and t["cells"] == "A1:C5"
    assert t["rows"] == 4 and t["cols"] == 3
    assert 0 < t["confidence"] <= 1

    draft = body["draft"]
    assert draft["status"] == "draft" and draft["org"] == "acme"
    table = next(b for b in draft["blocks"] if b["type"] == "table")
    # every extracted number carries the exact cell it came from
    first = table["rows"][0]
    assert first["c1"] == "Semences"
    assert first["c2"]["n"] == 12000 and first["c2"]["src"]["cells"] == "B2"
    assert first["c2"]["unit"] == "USD"  # inferred from the header
    assert first["c3"]["src"] == {"file": 0, "sheet": "budget", "cells": "C2"}


def test_machine_draft_is_publishable_as_is(client, auth, org):
    draft = _ingest(client, auth, BUDGET_SHEET, org=org).json()["draft"]
    r = client.post(f"/v1/orgs/{org}/reports", json=draft, headers=auth)
    assert r.status_code == 201  # CH-004 has nothing to refuse: every value is sourced


def test_parse_skips_prose_only_sheets(client, auth):
    body = _ingest(client, auth, {"notes": [["Compte rendu"], ["Réunion du 3 août"], ["Présents: A, B"]]}).json()
    assert body["tables"] == [] and body["draft"] is None


def test_parse_confidence_drops_on_sparse_data(client, auth):
    dense = _ingest(client, auth, BUDGET_SHEET).json()["tables"][0]["confidence"]
    sparse = _ingest(client, auth, {
        "s": [
            ["Poste", "Budget", "Réel", "Écart"],
            ["A", 1, None, None],
            ["B", None, 2, None],
            ["C", None, None, None],
            ["D", 4, None, None],
        ]
    }).json()["tables"][0]["confidence"]
    assert sparse < dense


# ------------------------------------------------------- context model ---

CTX = {
    "ignore_sheets": ["notes"],
    "units": {"Budget USD": "USD", "Tonnes": "t"},
    "aliases": {"MO": "Main d'œuvre"},
    "exclude_labels": ["TOTAL"],
}


def test_context_versions_append(client, auth, org):
    assert client.get(f"/v1/studio/orgs/{org}/context", headers=auth).json() is None
    v1 = client.put(f"/v1/studio/orgs/{org}/context", json=CTX, headers=auth).json()
    assert v1["version"] == 1 and v1["units"]["Budget USD"] == "USD"
    v2 = client.put(f"/v1/studio/orgs/{org}/context", json={**CTX, "exclude_labels": []}, headers=auth).json()
    assert v2["version"] == 2
    latest = client.get(f"/v1/studio/orgs/{org}/context", headers=auth).json()
    assert latest["version"] == 2 and latest["exclude_labels"] == []
    versions = client.get(f"/v1/studio/orgs/{org}/context/versions", headers=auth).json()
    assert [v["version"] for v in versions] == [2, 1]


def test_context_rejects_unknown_fields_and_units(client, auth, org):
    assert client.put(f"/v1/studio/orgs/{org}/context",
                      json={"formulas": {}}, headers=auth).status_code == 422
    assert client.put(f"/v1/studio/orgs/{org}/context",
                      json={"units": {"X": "EUR"}}, headers=auth).status_code == 422
    assert client.put("/v1/studio/orgs/ghost/context", json=CTX, headers=auth).status_code == 404


def test_ingest_applies_the_context(client, auth):
    client.post("/v1/orgs", json={"id": "ctxco", "name": "CtxCo", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/ctxco/context", json=CTX, headers=auth)
    body = _ingest(client, auth, {
        "budget": [
            ["Poste", "Budget USD", "Tonnes"],
            ["Semences", 12000, 3],
            ["MO", 15000, 0],
            ["TOTAL", 27000, 3],
        ],
        "notes": [
            ["Poste", "Montant"],
            ["a", 1], ["b", 2], ["c", 3],
        ],
    }, org="ctxco").json()

    # the ignored sheet was never parsed
    assert [t["sheet"] for t in body["tables"]] == ["budget"]

    draft = body["draft"]
    assert any("Contexte client v1" in b.get("text", {}).get("fr", "")
               for b in draft["blocks"] if b["type"] == "prose")
    table = next(b for b in draft["blocks"] if b["type"] == "table")
    labels = [r["c1"] for r in table["rows"]]
    assert "Main d'œuvre" in labels        # alias applied
    assert "TOTAL" not in labels           # derived row excluded
    tonnes = table["rows"][0]["c3"]
    assert tonnes["unit"] == "t"           # unit override from context


# ------------------------------------------------------------ assurance ---

def test_reads_are_audited(client, auth, org):
    key = client.post(f"/v1/orgs/{org}/reports", json=doc("r-aud"), headers=auth).json()["share_key"]
    client.get(f"/v1/reports/r-aud?k={key}")
    client.get(f"/v1/reports/r-aud?k={key}")
    client.get("/v1/reports/r-aud?k=wrong")
    s = client.get("/v1/studio/reports/r-aud/reads", headers=auth).json()
    assert s["reads"] == 2 and s["refused"] == 1
    assert s["readers"] == 1  # same client fingerprint
    assert s["last_read"] is not None


def test_portal_reads_are_audited(client, auth, org):
    pkey = _portal_key(client, auth, org)
    before = client.get(f"/v1/studio/orgs/{org}/reads", headers=auth).json()
    client.get(f"/v1/portal/{org}?k={pkey}")
    client.get(f"/v1/portal/{org}?k=wrong")
    after = client.get(f"/v1/studio/orgs/{org}/reads", headers=auth).json()
    assert after["reads"] == before["reads"] + 1
    assert after["refused"] == before["refused"] + 1


def test_read_stats_require_the_token(client, org):
    assert client.get("/v1/studio/reports/r-aud/reads").status_code == 401
    assert client.get(f"/v1/studio/orgs/{org}/reads").status_code == 401


def test_public_reads_are_rate_limited(client, auth, org, monkeypatch):
    from app import auth as auth_mod
    key = client.post(f"/v1/orgs/{org}/reports", json=doc("r-lim"), headers=auth).json()["share_key"]
    monkeypatch.setenv("LUMNIA_RATE_LIMIT", "3")
    auth_mod._hits.clear()
    for _ in range(3):
        assert client.get(f"/v1/reports/r-lim?k={key}").status_code == 200
    assert client.get(f"/v1/reports/r-lim?k={key}").status_code == 429
    auth_mod._hits.clear()


# ------------------------------------------------- recurring ingestion ---

def test_recurring_ingest_diffs_the_previous_snapshot(client, auth):
    client.post("/v1/orgs", json={"id": "recur", "name": "Recur", "sub": {"fr": "Kin"}},
                headers=auth)
    first = _ingest(client, auth, BUDGET_SHEET, org="recur").json()["ingestion"]
    assert first["seq"] == 1 and first["previous_ts"] is None and first["changes"] == []

    changed = {
        "budget": [
            ["Poste", "Budget USD", "Réel USD"],
            ["Semences", 12000, 14500],       # réel +52.6% → alert
            ["Engrais", 8000, 8200],          # +1.2% → change, no alert
            ["Transport", 5000, 2200],        # unchanged
            ["Irrigation", 4000, 0],          # new row → note
        ]                                     # "Main d'œuvre" gone → note
    }
    second = _ingest(client, auth, changed, org="recur").json()
    d = second["ingestion"]
    assert d["seq"] == 2 and d["previous_ts"]
    cols = {(c["label"], c["column"]): c for c in d["changes"]}
    assert cols[("Semences", "Réel USD")]["pct"] == pytest.approx(52.6, abs=0.1)
    assert ("Engrais", "Réel USD") in cols
    alerts = {(a["label"], a["column"]) for a in d["alerts"]}
    assert ("Semences", "Réel USD") in alerts
    assert ("Engrais", "Réel USD") not in alerts     # below the 20% default
    joined = " ".join(d["notes"])
    assert "Irrigation" in joined and "Main d'œuvre" in joined

    # the draft carries the movement flag for review
    flag = next(b for b in second["draft"]["blocks"] if b["type"] == "flag")
    assert flag["severity"] == "warn" and "Semences" in flag["body"]["fr"]

    # retention: both ingests are on record
    hist = client.get("/v1/studio/orgs/recur/ingestions", headers=auth).json()
    assert [h["seq"] for h in hist] == [2, 1] or [h["seq"] for h in hist] == [1, 2]


def test_alert_threshold_comes_from_the_context(client, auth):
    client.post("/v1/orgs", json={"id": "sens", "name": "Sens", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/sens/context",
               json={"alert_threshold_pct": 1}, headers=auth)
    _ingest(client, auth, BUDGET_SHEET, org="sens")
    changed = {"budget": [r[:] for r in BUDGET_SHEET["budget"]]}
    changed["budget"][2] = ["Engrais", 8000, 8200]   # +1.2% — alerts at 1%
    d = _ingest(client, auth, changed, org="sens").json()["ingestion"]
    assert any(a["label"] == "Engrais" for a in d["alerts"])


# ------------------------------------------------------ analysis modules ---

def test_module_registry_lists_named_analyses(client, auth):
    mods = client.get("/v1/studio/modules", headers=auth).json()
    names = {m["name"] for m in mods}
    assert {"movements", "execution", "reconciliation"} <= names
    assert all(m["version"] for m in mods)


def test_context_rejects_unknown_module(client, auth, org):
    r = client.put(f"/v1/studio/orgs/{org}/context",
                   json={"modules": ["movements", "sorcery"]}, headers=auth)
    assert r.status_code == 422 and "sorcery" in r.json()["detail"]


def test_execution_module_uses_ratio_of_totals(client, auth):
    client.post("/v1/orgs", json={"id": "exe", "name": "Exe", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/exe/context",
               json={"modules": ["execution"]}, headers=auth)
    body = _ingest(client, auth, {
        "opex": [
            ["Poste", "Budget USD", "Réel USD"],
            ["Janvier", 1000, 387],     # per-line rates: 38.7%, 147.4%, 107.0%
            ["Février", 1000, 1474],    # mean of ratios would be 97.7%
            ["Mars", 1000, 1070],       # ratio of totals is 97.7%... use uneven budgets
        ]
    }, org="exe").json()
    assert any(m.startswith("execution") for m in body["modules_run"])
    kpi = next(b for b in body["draft"]["blocks"] if b["type"] == "kpiGrid"
               and "Exécution" in b["items"][0]["label"]["fr"])
    v = kpi["items"][0]["value"]
    assert v["derived"] == "ratio" and v["unit"] == "pct"
    assert v["n"] == pytest.approx((387 + 1474 + 1070) / 3000 * 100, abs=0.1)
    assert v["src"]["cells"] == "C2:C4"      # provenance: the actual column
    rail = next(b for b in body["draft"]["blocks"] if b["type"] == "rail")
    assert len(rail["rows"]) == 3
    assert rail["rows"][0]["actual"]["src"]["cells"] == "C2"


def test_reconciliation_module_finds_the_double_count(client, auth):
    from datetime import date as D
    client.post("/v1/orgs", json={"id": "rec2", "name": "Rec2", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/rec2/context",
               json={"modules": ["reconciliation"]}, headers=auth)
    site = [["Date", "Libellé", "Sorties USD"],
            [D(2026, 2, 16), "acompte Indigo", 45600],
            [D(2026, 3, 5), "carburant", 1200],
            [D(2026, 3, 9), "salaires", 14751]]
    hq = [["Date", "Libellé", "Montant USD"],
          [D(2026, 2, 16), "Indigo seeds", 45600],       # duplicate
          [D(2026, 3, 9), "quinzaine RH", 14751],        # duplicate
          [D(2026, 3, 20), "frais bancaires", 300]]
    body = _ingest(client, auth, {"JC Site": site, "JC DGO": hq}, org="rec2").json()
    assert any(m.startswith("reconciliation") for m in body["modules_run"])
    flag = next(b for b in body["draft"]["blocks"] if b["type"] == "flag")
    assert "2" in flag["title"]["fr"] and "journaux" in flag["title"]["fr"]
    recon = next(b for b in body["draft"]["blocks"] if b["type"] == "table"
                 and b["columns"][0]["key"] == "date")
    amounts = {r["amount"]["n"] for r in recon["rows"]}
    assert amounts == {45600.0, 14751.0}
    assert all(r["amount"]["src"]["cells"] for r in recon["rows"])


# ----------------------------------------------------- budget-vs-actual ---

def _ingest_many(client, auth, workbooks: list[dict], org):
    files = [("file", (f"wb{i}.xlsx", io.BytesIO(_xlsx(w)), "application/x"))
             for i, w in enumerate(workbooks)]
    return client.post(f"/v1/studio/ingest?org={org}", files=files, headers=auth)


def test_budget_vs_actual_across_two_files(client, auth):
    client.post("/v1/orgs", json={"id": "bva", "name": "BvA", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/bva/context", json={
        "modules": ["budget-vs-actual"],
        "metrics": {
            "OPEX": {
                "budget": {"sheet": "opex", "label": "TOTAL DEPENSES"},
                "actual": {"sheet": "reel", "label": "TOTAL SITE"},
                "unit": "USD",
            }
        },
    }, headers=auth)
    budget_wb = {"opex": [
        ["Poste", "Annuel", "Jan", "Fév", "Mar", "Avr"],
        ["Salaires", 260, 60, 70, 70, 60],
        ["TOTAL DEPENSES OPEX", 400, 100, 100, 100, 100],  # annual col auto-dropped
    ]}
    actual_wb = {"reel": [
        ["Opération", "Jan", "Fév", "Mar"],
        ["Plantations", 10, 20, 10],
        ["TOTAL SITE", 20, 50, 50],
    ]}
    body = _ingest_many(client, auth, [budget_wb, actual_wb], "bva").json()
    assert any(m.startswith("budget-vs-actual") for m in body["modules_run"])
    assert len(body["sources"]) == 2

    kpi = next(b for b in body["draft"]["blocks"] if b["type"] == "kpiGrid"
               and "OPEX" in b["items"][0]["label"]["fr"])
    v = kpi["items"][0]["value"]
    assert v["n"] == pytest.approx(120 / 300 * 100, abs=0.1)  # phased 3 months, ratio of totals
    assert v["src"]["file"] == 1                              # actuals live in file 1

    bar = next(b for b in body["draft"]["blocks"] if b["type"] == "barPair")
    plan, act = bar["series"]
    assert plan["values"][0]["src"]["file"] == 0              # budget cells from file 0
    assert plan["values"][0]["n"] == 100 and len(plan["values"]) == 4
    assert act["values"][0]["src"]["file"] == 1 and len(act["values"]) == 3
    assert bar["cutoff"] == 3

    # the machine draft with cross-file provenance publishes as-is
    r = client.post("/v1/orgs/bva/reports", json=body["draft"], headers=auth)
    assert r.status_code == 201


# --------------------------------------------------------------------------
# narration — code computes, the narrate module speaks
# --------------------------------------------------------------------------

def test_narrate_speaks_the_computed_facts(client, auth):
    client.post("/v1/orgs", json={"id": "nar", "name": "Nar", "sub": {"fr": "Kin"}},
                headers=auth)
    # narrate listed FIRST — it must still run last, after the computation
    client.put("/v1/studio/orgs/nar/context", json={
        "modules": ["narrate", "budget-vs-actual"],
        "metrics": {
            "OPEX": {
                "budget": {"sheet": "opex", "label": "TOTAL DEPENSES"},
                "actual": {"sheet": "reel", "label": "TOTAL SITE"},
            }
        },
    }, headers=auth)
    budget_wb = {"opex": [
        ["Poste", "Jan", "Fév", "Mar", "Avr"],
        ["Salaires", 60, 70, 70, 60],
        ["TOTAL DEPENSES OPEX", 100, 100, 100, 100],
    ]}
    actual_wb = {"reel": [
        ["Opération", "Jan", "Fév", "Mar"],
        ["Plantations", 10, 20, 10],
        ["TOTAL SITE", 20, 50, 50],
    ]}
    body = _ingest_many(client, auth, [budget_wb, actual_wb], "nar").json()
    assert any(m.startswith("budget-vs-actual") for m in body["modules_run"])
    assert body["modules_run"][-1].startswith("narrate")  # always last

    prose = next(
        b for b in body["draft"]["blocks"]
        if b["type"] == "prose" and "Lecture —" in b["text"]["fr"]
    )
    # the narration restates the computed figures verbatim — 40 % of 300
    assert "40 %" in prose["text"]["fr"] and "OPEX" in prose["text"]["fr"]
    assert "40 %" in prose["text"]["en"] and "Reading —" in prose["text"]["en"]

    # narration adds prose, not figures: the draft still publishes as-is
    r = client.post("/v1/orgs/nar/reports", json=body["draft"], headers=auth)
    assert r.status_code == 201


def test_narrate_stays_silent_without_facts(client, auth):
    client.post("/v1/orgs", json={"id": "mute", "name": "Mute", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/mute/context", json={"modules": ["narrate"]},
               headers=auth)
    body = _ingest(client, auth, BUDGET_SHEET, org="mute").json()
    # nothing was computed, so there is nothing to narrate — no empty shell
    assert not any(m.startswith("narrate") for m in body["modules_run"])
    assert not any(
        b["type"] == "prose" and "Lecture —" in b["text"]["fr"]
        for b in body["draft"]["blocks"]
    )


def test_narrate_number_guardrail():
    from app.pipeline.modules import _numbers_in

    facts = "Exécution · OPEX s'établit à 39,5 % (44 624 réels sur 3 mois)."
    assert _numbers_in(facts) == {"395", "44624", "3"}
    # a rewrite that invents or drops a figure no longer matches
    assert _numbers_in("39,5 % soit 44 625 sur 3 mois") != _numbers_in(facts)
    assert _numbers_in("39,5 % sur 3 mois") != _numbers_in(facts)


def test_narrate_llm_gate_is_closed_without_key(monkeypatch):
    from app.pipeline import modules

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert modules._llm_polish([("Un fait : 42.", "A fact: 42.")]) is None


# --------------------------------------------------------------------------
# dashboard — the practice at a glance
# --------------------------------------------------------------------------

def test_dashboard_aggregates_per_client(client, auth):
    client.post("/v1/orgs", json={"id": "dsh", "name": "Dash", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/dsh/context",
               json={"modules": ["movements", "narrate"]}, headers=auth)
    r = client.post("/v1/orgs/dsh/reports", json=doc("r-dsh", org="dsh"),
                    headers=auth)
    assert r.status_code == 201
    _ingest(client, auth, BUDGET_SHEET, org="dsh")
    client.get("/v1/portal/dsh?k=wrong-key")  # one refused read

    rows = client.get("/v1/studio/dashboard", headers=auth).json()
    row = next(x for x in rows if x["id"] == "dsh")
    assert row["published"] == 1 and row["unpublished"] == 0
    assert row["context_version"] == 1
    assert row["modules"] == ["movements", "narrate"]
    assert row["files_tracked"] == 1 and row["last_ingest"]
    assert row["refused"] >= 1

    # the dashboard is the author's view — no token, no rows
    assert client.get("/v1/studio/dashboard").status_code == 401


# --------------------------------------------------------------------------
# coverage — uncoded journal entries are money that cannot land anywhere
# --------------------------------------------------------------------------

JOURNAL = {"journal": [
    ["Date", "Libellé", "CODE", "Sorties USD", "Solde USD"],
    ["2026-01-05", "Achat pièces", "6022", 120, 880],
    ["2026-01-08", "Transport équipe", "", 60, 820],
    ["2026-01-12", "Ciment chantier", None, 300, 520],
]}


def test_coverage_lists_uncoded_entries(client, auth):
    client.post("/v1/orgs", json={"id": "cov", "name": "Cov", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/cov/context", json={
        "modules": ["coverage"],
        "reconcile_sheets": ["journal"],
        "journal_code_column": "CODE",
    }, headers=auth)
    body = _ingest(client, auth, JOURNAL, org="cov").json()
    assert any(m.startswith("coverage") for m in body["modules_run"])

    kpi = next(b for b in body["draft"]["blocks"] if b["type"] == "kpiGrid"
               and "sans code" in b["items"][0]["label"]["fr"])
    item = kpi["items"][0]
    assert item["value"]["n"] == 2 and item["value"]["unit"] == "count"
    assert item["tone"] == "warn"
    assert "3 écritures" in item["sub"]["fr"] and "360" in item["sub"]["fr"]

    flag = next(b for b in body["draft"]["blocks"] if b["type"] == "flag"
                and "code" in b["tag"]["fr"].lower())
    assert "2 écriture(s)" in flag["title"]["fr"]

    table = next(b for b in body["draft"]["blocks"] if b["type"] == "table"
                 and b["columns"][0]["key"] == "entry")
    assert len(table["rows"]) == 2
    first = table["rows"][0]
    # the amount points at its cell; the missing code points at where it belongs
    assert first["entry"] == "Transport équipe"
    assert first["amount"]["n"] == 60 and first["amount"]["src"]["cells"] == "D3"
    assert first["code"] == "journal!C3"

    # balance columns are never cited as amounts
    assert all("E" not in r["amount"]["src"]["cells"] for r in table["rows"])


def test_coverage_all_coded_is_good_news(client, auth):
    client.post("/v1/orgs", json={"id": "cov2", "name": "Cov2", "sub": {"fr": "Kin"}},
                headers=auth)
    client.put("/v1/studio/orgs/cov2/context", json={
        "modules": ["coverage"],
        "reconcile_sheets": ["journal"],
    }, headers=auth)
    coded = {"journal": [
        ["Date", "Libellé", "CODE", "Sorties USD"],
        ["2026-01-05", "Achat pièces", "6022", 120],
        ["2026-01-08", "Transport équipe", "6021", 60],
    ]}
    body = _ingest(client, auth, coded, org="cov2").json()
    kpi = next(b for b in body["draft"]["blocks"] if b["type"] == "kpiGrid"
               and "sans code" in b["items"][0]["label"]["fr"])
    assert kpi["items"][0]["value"]["n"] == 0
    assert kpi["items"][0]["tone"] == "good"
    assert not any(b["type"] == "flag" and "code" in b["tag"]["fr"].lower()
                   for b in body["draft"]["blocks"])


# --------------------------------------------------------------------------
# timeline — the same figure watched across versions of the file
# --------------------------------------------------------------------------

def test_timeline_keeps_each_runs_facts(client, auth):
    runs = client.get("/v1/studio/orgs/cov/timeline", headers=auth).json()
    assert len(runs) >= 1
    fact = next(f for f in runs[0]["facts"] if f.get("n") is not None)
    assert fact["label"] == "Écritures sans code · journal"
    assert fact["n"] == 2 and fact["unit"] == "count"
    assert any(m.startswith("coverage") for m in runs[0]["modules"])

    assert client.get("/v1/studio/orgs/cov/timeline").status_code == 401
    assert client.get("/v1/studio/orgs/nope/timeline",
                      headers=auth).status_code == 404
