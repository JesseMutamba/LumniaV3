"""Standalone integration checks; writes only a temporary scratch database."""
import importlib.util
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

SCRATCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRATCH))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import store
from app.schema import ContextIn, Text

from app.routers import financial as proposal

def document():
    ref = {"file": "plan.xlsx", "sheet": "Plan", "cell": "B3", "formula": None}
    def figure(value, unit="USD"):
        return {"value": value, "unit": unit, "refs": [deepcopy(ref)]}
    plan = {"year": 2026, "revenue": figure(1000), "opex": figure(600), "capex": figure(100),
            "ffb": figure(100, "t"), "cpo": figure(20, "t"), "hectares": figure(None, "ha"), "balance": figure(300)}
    point = {"month": 1, "year": 2026, "label": "Jan", "value": 50, "refs": [deepcopy(ref)], "unit": "USD"}
    return {"title": "Financial review", "review": {"version": 1, "title": "Financial review", "createdAt": "2026-09-09T12:00:00.000Z",
            "plan": [plan], "forecastYears": [2026], "comparisonYear": 2026,
            "q1": [{"id": "opex", "label": "OPEX", "unit": "USD", "plan": figure(50), "actual": figure(None),
                    "planMonths": [deepcopy(point)], "actualMonths": [], "status": "unavailable"}],
            "monthlyPlan": {"opex": [point], "ffb": [], "cpo": []}, "planCosts": [], "actualCosts": [],
            "issues": [{"id": "missing-actual", "severity": "warning", "title": "Missing actuals", "detail": "Values stay unavailable.", "refs": []}],
            "sources": [{"name": "plan.xlsx", "hash": "a" * 64, "sheets": 1, "tables": 1, "formulaErrors": 0, "missingFormulaResults": 0}],
            "steps": [{"name": "Prepare", "detail": "Preserve source values."}],
            "bindings": [{"role": "Annual revenue", "table": "Plan", "metric": "Revenue", "unit": "USD"}]},
            "drivers": {"pricePct": 0, "volumePct": 0, "extractionPp": 0, "opexPct": 0, "capexPct": 0, "variableCostPct": 30},
            "risk": {"trials": 3000, "seed": 202609, "priceStd": 15, "volumeStd": 20, "opexStd": 10, "extractionStd": 1, "year": 2026},
            "tab": "overview"}


def test_financial_reviews():
    old_path = store.DB_PATH
    old_token = os.environ.get("LUMNIA_ADMIN_TOKEN")
    os.environ["LUMNIA_ADMIN_TOKEN"] = "proposal-test-author-token"
    try:
        with TemporaryDirectory(prefix="financial-router-test-", dir=SCRATCH) as tmp:
            store.DB_PATH = Path(tmp) / "reviews.sqlite"
            store.init()
            store.put_org("client-a", "A", Text(fr="A"))
            store.put_org("client-b", "B", Text(fr="B"))
            app = FastAPI()
            app.include_router(proposal.router, prefix="/v1")
            auth = {"Authorization": "Bearer proposal-test-author-token"}
            with TestClient(app) as client:
                base = "/v1/financial-reviews"
                assert client.get(base, params={"org": "client-a"}).status_code == 401
                assert client.post(base, params={"org": "client-a"}, json=document()).status_code == 401
                assert client.get(base, params={"org": "client-a"}, headers={"Authorization": "Bearer reader-key"}).status_code == 401
                assert client.get(base, headers=auth).status_code == 422
                assert client.post(base, params={"org": "absent"}, json=document(), headers=auth).status_code == 404

                original = document()
                created = client.post(base, params={"org": "client-a"}, json=original, headers=auth)
                assert created.status_code == 201, created.text
                saved = created.json()
                assert saved["version"] == 1
                assert saved["review"] == original["review"]
                assert saved["review"]["plan"][0]["hectares"]["value"] is None
                url = base + "/" + saved["id"]
                assert client.get(url, params={"org": "client-a"}, headers=auth).json() == saved
                listed = client.get(base, params={"org": "client-a"}, headers=auth)
                assert listed.headers["cache-control"] == "no-store"
                assert listed.json()[0]["id"] == saved["id"]
                assert "review" not in listed.json()[0]
                assert client.get(url, params={"org": "client-b"}, headers=auth).status_code == 404
                assert client.get(url, params={"org": "client-a"}).status_code == 401

                update = {**document(), "expected_version": 1, "tab": "risk"}
                assert client.put(url, params={"org": "client-b"}, json=update, headers=auth).status_code == 404
                assert client.put(url, params={"org": "client-a"}, json=document(), headers=auth).status_code == 422
                def writer(percent):
                    body = deepcopy(update)
                    body["drivers"]["pricePct"] = percent
                    return client.put(url, params={"org": "client-a"}, json=body, headers=auth)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    responses = list(pool.map(writer, [10, 20]))
                assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
                winner = next(r.json() for r in responses if r.status_code == 200)
                assert winner["version"] == 2 and winner["tab"] == "risk"
                assert client.get(url, params={"org": "client-a"}, headers=auth).json() == winner
                assert "expected_version" not in winner

                # A future verified owner principal must not read/update/delete another.
                app.dependency_overrides[proposal.financial_owner] = lambda: "author:other"
                assert client.get(base, params={"org": "client-a"}, headers=auth).json() == []
                assert client.get(url, params={"org": "client-a"}, headers=auth).status_code == 404
                assert client.put(url, params={"org": "client-a"}, json={**document(), "expected_version": 2}, headers=auth).status_code == 404
                assert client.delete(url, params={"org": "client-a", "expected_version": 2}, headers=auth).status_code == 404
                other = client.post(base, params={"org": "client-a"}, json=document(), headers=auth)
                assert other.status_code == 201
                app.dependency_overrides.clear()
                assert len(client.get(base, params={"org": "client-a"}, headers=auth).json()) == 1

                def invalid(mutate):
                    data = document()
                    mutate(data)
                    response = client.post(base, params={"org": "client-a"}, content=json.dumps(data), headers={**auth, "Content-Type": "application/json"})
                    assert response.status_code == 422, response.text
                invalid(lambda d: d.update(owner="author:other"))
                invalid(lambda d: d["review"].update(version=True))
                invalid(lambda d: d["review"]["plan"][0]["revenue"].update(value=True))
                invalid(lambda d: d["review"]["plan"][0]["revenue"].update(value=float("nan")))
                invalid(lambda d: d["review"]["plan"][0]["revenue"].update(value=10**400))
                invalid(lambda d: d["review"]["plan"][0]["revenue"].update(note=None))
                invalid(lambda d: d["drivers"].update(pricePct=101))
                invalid(lambda d: d["risk"].update(trials=10001))
                invalid(lambda d: d["risk"].update(seed="123"))
                invalid(lambda d: d["risk"].update(year=2027))
                invalid(lambda d: d["review"].update(createdAt="2026-02-30T00:00:00Z"))
                invalid(lambda d: d["review"]["plan"][0]["revenue"]["refs"][0].update(file="another.xlsx"))
                invalid(lambda d: d["review"]["plan"][0]["revenue"]["refs"][0].update(cell="A1\n"))
                invalid(lambda d: d["review"]["plan"].append(deepcopy(d["review"]["plan"][0])))
                invalid(lambda d: d["review"]["q1"].append(deepcopy(d["review"]["q1"][0])))
                invalid(lambda d: d.update(tab="unknown"))
                invalid(lambda d: d.update(title=" "))
                assert client.post(base, params={"org": "client-a"}, content=b"{", headers=auth).status_code == 422
                assert client.post(base, params={"org": "client-a"}, content=b" " * (proposal.MAX_BYTES + 1), headers=auth).status_code == 413

                store.put_context("client-a", ContextIn(retain_files=False))
                assert client.post(base, params={"org": "client-a"}, json=document(), headers=auth).status_code == 409
                assert client.put(url, params={"org": "client-a"}, json={**document(), "expected_version": 2}, headers=auth).status_code == 409
                assert client.get(url, params={"org": "client-a"}, headers=auth).status_code == 200
                store.put_context("client-a", ContextIn(retain_files=True, ignore_sheets=[" PLAN "]))
                assert client.post(base, params={"org": "client-a"}, json=document(), headers=auth).status_code == 409
                assert client.delete(url, params={"org": "client-a", "expected_version": 1}, headers=auth).status_code == 409
                assert client.delete(url, params={"org": "client-a", "expected_version": 2}, headers=auth).status_code == 204
                assert client.get(url, params={"org": "client-a"}, headers=auth).status_code == 404
                assert store.delete_org("client-a")
                with store.connect() as con:
                    assert con.execute("SELECT count(*) FROM financial_reviews WHERE org='client-a'").fetchone()[0] == 0
        print("PASS: financial review CRUD, private owner/org scope, concurrent version CAS, required nulls, strict types/limits, source identity, retention/exclusions and cascade deletion.")
    finally:
        store.DB_PATH = old_path
        if old_token is None:
            os.environ.pop("LUMNIA_ADMIN_TOKEN", None)
        else:
            os.environ["LUMNIA_ADMIN_TOKEN"] = old_token

if __name__ == "__main__":
    test_financial_reviews()
