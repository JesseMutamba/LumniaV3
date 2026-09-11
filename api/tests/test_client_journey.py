"""One client journey through the production portal, using an issued session.

The disposable PostgreSQL fixture never selects a deployment's DATABASE_URL.
The documents are synthetic; no uploaded client workbook is committed here.
"""
from copy import deepcopy

from fastapi.testclient import TestClient

from app import portal
from test_analysis_studio import ai_request, definitions, document as sales_document
from test_financial_reviews import document as financial_document
from test_portal_postgres import PASSWORD, pg_database, snapshot_legacy  # noqa: F401


def sign_in(client):
    response = client.post("/v1/auth/login", json={"username": "alice", "password": PASSWORD})
    assert response.status_code == 200, response.text
    session = response.json()
    return session, {"Authorization": "Bearer " + session["token"]}


def test_client_can_prepare_save_and_resume_both_dashboard_types_after_sign_in(pg_database):
    original_records = snapshot_legacy(pg_database["dsn"])
    saved_documents = []
    with TestClient(portal.create_app()) as client:
        session, headers = sign_in(client)
        scope = {"org": session["org"]["id"]}
        identity = client.get("/v1/auth/me", headers=headers)
        assert identity.status_code == 200, identity.text
        assert identity.json() == {key: session[key] for key in ("user", "org")}
        # The original organization intentionally has an empty subtitle.
        assert identity.json()["org"]["sub"] == {}
        context = client.get("/v1/analysis-studio/context", params=scope, headers=headers)
        assert context.status_code == 200, context.text
        assert context.json() == {"ignore_sheets": [], "retain_files": True, "version": None}

        definition_url = "/v1/analysis-studio/definitions/" + definitions()["fingerprint"]
        confirmed = client.put(definition_url, params=scope, headers=headers, json=definitions())
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["version"] == 1
        status = client.get("/v1/analysis-studio/ai/status", params=scope, headers=headers).json()
        assert status["configured"] is False and status["canConfigure"] is False
        proposal = client.post("/v1/analysis-studio/ai/plan", params=scope, headers=headers, json=ai_request())
        assert proposal.status_code == 200 and proposal.json()["planner"] == "rules"

        sales = sales_document()
        # Store the existing monthly view and the next conversational addition
        # together, matching the browser's single-dashboard update contract.
        sales["plan"]["cards"].append({
            "id": "region", "tool": "breakdown", "measure": "c1", "dimension": "c2", "filters": [],
        })
        sales["messages"].append({
            "role": "user", "text": "Add revenue by region", "at": "2026-09-10T00:01:00.000Z",
        })
        review = financial_document()
        review["title"] = review["review"]["title"] = "Synthetic plan and Q1 review"
        review["drivers"]["volumePct"] = -10
        review["tab"] = "risk"
        actual_ref = {"file": "q1-results.xlsx", "sheet": "Q1", "cell": "B2", "formula": None}
        review["review"]["sources"].append({
            "name": "q1-results.xlsx", "hash": "c" * 64, "sheets": 1, "tables": 1,
            "formulaErrors": 0, "missingFormulaResults": 0,
        })
        review["review"]["q1"][0].update({
            "actual": {"value": 55, "unit": "USD", "refs": [actual_ref]},
            "actualMonths": [{
                "month": 1, "year": 2026, "label": "Jan", "value": 55,
                "unit": "USD", "refs": [actual_ref],
            }],
            "status": "review",
        })
        for base, document in (("/v1/analysis-studio/dashboards", sales), ("/v1/financial-reviews", review)):
            created = client.post(base, params=scope, headers=headers, json=document)
            assert created.status_code == 201, created.text
            saved = created.json()
            assert {key: saved[key] for key in document} == document
            # A later title edit must preserve charts, questions, source cells,
            # scenario settings and explicitly unavailable figures.
            update = deepcopy(document)
            update.update(title=document["title"] + " — client revision", expected_version=1)
            if "review" in update:
                update["review"]["title"] = update["title"]
            url = base + "/" + saved["id"]
            revised = client.put(url, params=scope, headers=headers, json=update)
            assert revised.status_code == 200, revised.text
            assert revised.json()["version"] == 2
            saved_documents.append((base, url, revised.json()))

        assert client.post("/v1/auth/logout", headers=headers).status_code == 204
        for _, url, _ in saved_documents:
            assert client.get(url, params=scope, headers=headers).status_code == 401

    # Reopening uses a fresh application instance and a fresh opaque session,
    # as happens after a deploy and a returning client's new sign-in.
    with TestClient(portal.create_app()) as client:
        returning, returning_headers = sign_in(client)
        assert returning["token"] != session["token"]
        assert returning["user"]["id"] == session["user"]["id"]
        for base, url, saved in saved_documents:
            listing = client.get(base, params=scope, headers=returning_headers)
            assert listing.status_code == 200, listing.text
            assert any(item["id"] == saved["id"] and item["version"] == 2 for item in listing.json())
            reopened = client.get(url, params=scope, headers=returning_headers)
            assert reopened.status_code == 200, reopened.text
            assert reopened.json() == saved
        remembered = client.get(definition_url, params=scope, headers=returning_headers)
        assert remembered.status_code == 200 and remembered.json() == confirmed.json()
    assert snapshot_legacy(pg_database["dsn"]) == original_records
