"""Durable analysis state, source traceability and author/client boundaries."""
from copy import deepcopy


def document():
    return {
        "title": "Monthly revenue",
        "dataset": {
            "name": "sales.csv", "sheet": "CSV data", "kind": "table",
            "sourceHash": "a" * 64,
            "headers": ["Date", "Revenue", "Region"],
            "rows": [["2026-01-01", 1250.5, "East"], ["2026-02-01", 2000, "West"]],
            "provenance": {"sheet": "CSV data", "rows": [3, 5], "columns": [0, 1, 2]},
            "report": {
                "layout": "table", "sheet": "CSV data", "range": "A2:C5", "headerRow": 2,
                "originalRows": 5, "activeRows": 4, "ignoredFormattedRows": 1,
                "changes": ["Removed a repeated header"], "issues": [],
                "preview": [{"row": 1, "cells": ["Sales export"]}],
                "duplicateRows": 0, "formulaCount": 0, "formulaErrors": 0, "missingFormulaResults": 0,
            },
        },
        "mapping": {"date": "Date", "revenue": "Revenue", "region": "Region", "product": "", "currency": "USD", "dateFormat": "MDY"},
        "views": ["monthly"],
        "messages": [{"role": "user", "text": "Show monthly revenue"}, {"role": "assistant", "text": "Added monthly revenue."}],
    }


def client_org(client, auth, name):
    assert client.post("/v1/orgs", json={"id": name, "name": name, "sub": {"fr": name}}, headers=auth).status_code == 201
    return f"/v1/studio/orgs/{name}/analytics/dashboards"


def test_save_reopen_incremental_dashboard(client, auth):
    path = client_org(client, auth, "analytics-flow")
    payload = document()
    created = client.post(path, json=payload, headers=auth)
    assert created.status_code == 201, created.text
    first = created.json()
    assert first["version"] == 1
    assert client.get(path, headers=auth).json()[0]["id"] == first["id"]
    url = path + "/" + first["id"]
    reopened = client.get(url, headers=auth).json()
    assert reopened["dataset"] == first["dataset"]
    assert reopened["dataset"]["provenance"]["rows"] == [3, 5]
    assert reopened["messages"] == payload["messages"]
    update = {**payload, "expected_version": 1, "views": ["monthly", "region"],
              "messages": payload["messages"] + [{"role": "user", "text": "Add revenue by region"}]}
    updated = client.put(url, json=update, headers=auth)
    assert updated.status_code == 200, updated.text
    assert updated.json()["id"] == first["id"]
    assert updated.json()["version"] == 2
    assert client.get(url, headers=auth).json()["views"] == ["monthly", "region"]
    stale = client.put(url, json=update, headers=auth)
    assert stale.status_code == 409
    assert client.get(url, headers=auth).json()["version"] == 2


def test_author_only_and_client_scoping(client, auth):
    path = client_org(client, auth, "analytics-owner")
    other = client_org(client, auth, "analytics-other")
    created = client.post(path, json=document(), headers=auth).json()
    assert client.get(path).status_code == 401
    assert client.post(path, json=document()).status_code == 401
    assert client.get(path + "/" + created["id"]).status_code == 401
    assert client.get(other, headers=auth).json() == []
    assert client.get(other + "/" + created["id"], headers=auth).status_code == 404
    assert client.put(other + "/" + created["id"], json={**document(), "expected_version": 1}, headers=auth).status_code == 404
    assert client.post("/v1/studio/orgs/no-such-client/analytics/dashboards", json=document(), headers=auth).status_code == 404


def test_rejects_lost_provenance_bad_shapes_and_unknown_columns(client, auth):
    path = client_org(client, auth, "analytics-validation")
    invalid = document()
    invalid["dataset"].pop("provenance")
    assert client.post(path, json=invalid, headers=auth).status_code == 422
    invalid = document()
    invalid["dataset"]["rows"][0].append("unmapped")
    assert client.post(path, json=invalid, headers=auth).status_code == 422
    invalid = document()
    invalid["mapping"]["revenue"] = "Not a real column"
    assert client.post(path, json=invalid, headers=auth).status_code == 422
    invalid = document()
    invalid["dataset"]["rows"][0][1] = True
    assert client.post(path, json=invalid, headers=auth).status_code == 422
    invalid = document()
    invalid["dataset"]["rows"][0][1] = 10 ** 400
    assert client.post(path, json=invalid, headers=auth).status_code == 422
    invalid = document()
    invalid["dataset"]["provenance"]["sheet"] = "Different sheet"
    assert client.post(path, json=invalid, headers=auth).status_code == 422
    assert client.post(path, content=b"{", headers={**auth, "Content-Type": "application/json"}).status_code == 422
    assert client.post(path, content=b" " * (12 * 1024 * 1024 + 1), headers=auth).status_code == 413


def test_financial_values_keep_currency_source_and_measure(client, auth):
    path = client_org(client, auth, "analytics-financial")
    payload = document()
    d = payload["dataset"]
    d.pop("provenance")
    d.update(kind="financial", sheet="Cash journal", headers=["Period", "Metric", "Amount", "Category", "Currency", "Unit", "Basis", "Source"],
             rows=[["2026-01-01", "Cash payments · CDF", 2000, "OPS", "CDF", "currency", "Recorded", "Cash journal!I3"]],
             financial={"metrics": [{"id": "Cash payments · CDF", "label": "Cash payments · CDF", "currency": "CDF", "unit": "currency", "aggregation": "sum", "role": "payments"}],
                        "granularity": "daily", "basis": "recorded", "title": "Cash book"})
    d["report"].update(layout="ledger", sheet="Cash journal", range="A1:M5")
    payload["mapping"]["metric"] = "Cash payments · CDF"
    response = client.post(path, json=payload, headers=auth)
    assert response.status_code == 201, response.text
    reopened = client.get(path + "/" + response.json()["id"], headers=auth).json()
    assert reopened["dataset"]["rows"][0][7] == "Cash journal!I3"
    invalid = deepcopy(payload)
    invalid["dataset"]["rows"][0][4] = "USD"
    assert client.post(path, json=invalid, headers=auth).status_code == 422
    for column, value in [(0, None), (0, "2026-02-30"), (7, "Another sheet!I3")]:
        invalid = deepcopy(payload)
        invalid["dataset"]["rows"][0][column] = value
        assert client.post(path, json=invalid, headers=auth).status_code == 422


def test_retention_exclusions_and_client_deletion(client, auth):
    path = client_org(client, auth, "analytics-retention")
    base = "/v1/studio/orgs/analytics-retention"
    assert client.post(path, json=document(), headers=auth).status_code == 201
    context = client.put(base + "/context", json={"retain_files": False}, headers=auth)
    assert context.status_code == 200, context.text
    assert client.post(path, json=document(), headers=auth).status_code == 409
    assert client.put(base + "/context", json={"retain_files": True, "ignore_sheets": ["CSV data"]}, headers=auth).status_code == 200
    assert client.post(path, json=document(), headers=auth).status_code == 409
    assert client.delete(base, headers=auth).status_code == 204
    from app import store
    with store.connect() as con:
        assert con.execute("SELECT COUNT(*) FROM analytics_dashboards WHERE org='analytics-retention'").fetchone()[0] == 0
