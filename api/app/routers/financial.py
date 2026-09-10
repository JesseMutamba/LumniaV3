"""Private financial review API: private, versioned financial reviews.

Integration: import this router in app/main.py and include it with prefix /v1
before the static mount. Its lifespan creates the additive table after the
application's bootstrap. No existing report or analytics table is rewritten.

Owners are server-verified author or named client principals. Client sessions
are restricted to the organization on their account; account creation identity
preserves ownership through password rotation and isolates recreated accounts.
Never derive ownership from an untrusted request header or body field.

The review is a saved, user-authored scenario snapshot, not a published report
or an assertion that its submitted numbers have been independently verified.
"""
from __future__ import annotations

import json
import math
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated, Literal, Union

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictFloat, StrictInt, ValidationError, field_validator, model_validator

from .. import store
from .analysis_studio import Principal, principal

MAX_BYTES = 4 * 1024 * 1024
SCHEMA = """
CREATE TABLE IF NOT EXISTS financial_reviews (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    org TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS financial_reviews_owner_org_updated
ON financial_reviews(owner, org, updated_at);
"""


def init_financial_store() -> None:
    with store.connect() as con:
        con.executescript(SCHEMA)


@asynccontextmanager
async def lifespan(_app):
    init_financial_store()
    yield


def financial_owner(p: Principal = Depends(principal)) -> str:
    """Reuse the verified principal and its organization boundary.

    Every route also accepts org from the same query parameter. principal
    checks that query against the signed-in account before any database read
    or write; existing SQL predicates continue to require both owner and org.
    """
    return p.owner


router = APIRouter(prefix="/financial-reviews", tags=["financial reviews"], lifespan=lifespan)


def finite_number(value):
    try:
        valid = math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("Numeric values must be finite")
    return value


Finite = Annotated[Union[StrictInt, StrictFloat], AfterValidator(finite_number)]
Amount = Annotated[Finite, Field(ge=-1e15, le=1e15)]
Year = Annotated[StrictInt, Field(ge=1900, le=2300)]
Text = Annotated[str, Field(max_length=1000)]
Unit = Annotated[str, Field(max_length=32)]
Title = Annotated[str, Field(min_length=1, max_length=160)]
Counter = Annotated[StrictInt, Field(ge=0)]
OrgQuery = Annotated[str, Query(min_length=1, max_length=200)]
Tab = Literal["overview", "plan", "q1", "cost", "forecast", "risk", "sources"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Ref(Model):
    file: Text
    sheet: Text
    cell: str = Field(min_length=2, max_length=20)
    formula: str | None = Field(default=None, max_length=10000)

    @field_validator("cell")
    @classmethod
    def valid_cell(cls, value):
        if not re.fullmatch(r"[A-Za-z]+[1-9][0-9]*", value):
            raise ValueError("Use an original spreadsheet cell address")
        return value


Refs = Annotated[list[Ref], Field(max_length=1000)]


class Figure(Model):
    value: Amount | None
    unit: Unit
    refs: Refs
    note: Text | None = None

    @field_validator("note")
    @classmethod
    def present_note_is_text(cls, value):
        # The TypeScript contract permits omission, but not an explicit null.
        if value is None:
            raise ValueError("A figure note must be text when present")
        return value


class PlanYear(Model):
    year: Year
    revenue: Figure
    opex: Figure
    capex: Figure
    ffb: Figure
    cpo: Figure
    hectares: Figure
    balance: Figure


class MonthlyPoint(Model):
    month: StrictInt = Field(ge=1, le=12)
    label: str = Field(max_length=20)
    year: Year
    value: Amount
    refs: Refs
    unit: Unit


Months = Annotated[list[MonthlyPoint], Field(max_length=24)]


class Q1Metric(Model):
    id: Literal["opex", "ffb", "cpo"]
    label: Text
    unit: Unit
    plan: Figure
    actual: Figure
    planMonths: Months
    actualMonths: Months
    status: Literal["aligned", "review", "unavailable"]


class MonthlyPlan(Model):
    opex: Months
    ffb: Months
    cpo: Months


class Category(Model):
    name: Text
    value: Amount
    refs: Refs


class Issue(Model):
    id: Text
    severity: Literal["info", "warning"]
    title: Text
    detail: str = Field(max_length=4000)
    refs: Refs


class SourceInfo(Model):
    name: Text
    hash: str = Field(min_length=64, max_length=64)
    sheets: StrictInt = Field(ge=0, le=100)
    tables: StrictInt = Field(ge=0, le=1000)
    formulaErrors: Counter
    missingFormulaResults: Counter

    @field_validator("hash")
    @classmethod
    def valid_hash(cls, value):
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ValueError("A source SHA-256 hash is required")
        return value


class Step(Model):
    name: Text
    detail: str = Field(max_length=4000)


class Binding(Model):
    role: Text
    table: Text
    metric: Text
    unit: Unit


class Review(Model):
    version: StrictInt = Field(ge=1, le=1)
    title: Title
    createdAt: str = Field(max_length=64)
    plan: list[PlanYear] = Field(min_length=1, max_length=50)
    forecastYears: list[Year] = Field(min_length=1, max_length=50)
    comparisonYear: Year
    q1: list[Q1Metric] = Field(max_length=3)
    monthlyPlan: MonthlyPlan
    planCosts: list[Category] = Field(max_length=100)
    actualCosts: list[Category] = Field(max_length=100)
    issues: list[Issue] = Field(max_length=100)
    sources: list[SourceInfo] = Field(min_length=1, max_length=2)
    steps: list[Step] = Field(max_length=20)
    bindings: list[Binding] = Field(max_length=100)

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("createdAt")
    @classmethod
    def valid_created_at(cls, value):
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?Z", value):
            raise ValueError("Use an ISO UTC creation timestamp")
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    def references(self):
        """All stored cell references; used for client sheet exclusions."""
        for year in self.plan:
            for key in ("revenue", "opex", "capex", "ffb", "cpo", "hectares", "balance"):
                yield from getattr(year, key).refs
        for quarter in self.q1:
            yield from quarter.plan.refs
            yield from quarter.actual.refs
            for point in [*quarter.planMonths, *quarter.actualMonths]:
                yield from point.refs
        for key in ("opex", "ffb", "cpo"):
            for point in getattr(self.monthlyPlan, key):
                yield from point.refs
        for item in [*self.planCosts, *self.actualCosts, *self.issues]:
            yield from item.refs

    @model_validator(mode="after")
    def valid_review(self):
        years = [item.year for item in self.plan]
        if len(set(years)) != len(years) or any(year not in years for year in self.forecastYears) or self.comparisonYear not in self.forecastYears:
            raise ValueError("Review years do not reconcile")
        if len({item.id for item in self.q1}) != len(self.q1):
            raise ValueError("Duplicate quarter metric")
        filenames = {source.name for source in self.sources}
        if any(ref.file not in filenames for ref in self.references()):
            raise ValueError("Every cell reference must belong to a reviewed source file")
        return self


class Drivers(Model):
    pricePct: Finite = Field(ge=-80, le=100)
    volumePct: Finite = Field(ge=-80, le=100)
    extractionPp: Finite = Field(ge=-10, le=10)
    opexPct: Finite = Field(ge=-80, le=100)
    capexPct: Finite = Field(ge=-80, le=100)
    variableCostPct: Finite = Field(ge=0, le=100)


class RiskSettings(Model):
    trials: StrictInt = Field(ge=500, le=10000)
    seed: StrictInt = Field(ge=0, le=4294967295)
    priceStd: Finite = Field(ge=0, le=100)
    volumeStd: Finite = Field(ge=0, le=100)
    opexStd: Finite = Field(ge=0, le=100)
    extractionStd: Finite = Field(ge=0, le=10)
    year: Year


class FinancialDocument(Model):
    title: Title
    review: Review
    drivers: Drivers
    risk: RiskSettings
    tab: Tab
    expected_version: StrictInt | None = Field(default=None, ge=1)

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def valid_year(self):
        if self.risk.year not in self.review.forecastYears:
            raise ValueError("Select an available simulation year")
        return self


def require_org(org: str) -> None:
    if not store.get_org(org):
        raise HTTPException(404, "Client not found")


async def read_document(request: Request, org: str) -> FinancialDocument:
    require_org(org)
    context = store.get_context(org)
    if context and not context.retain_files:
        raise HTTPException(409, "Saving prepared financial data is disabled by this client's retention setting")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "Financial review exceeds 4 MB")
        body.extend(chunk)
    try:
        document = FinancialDocument.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(422, json.loads(exc.json(include_input=False, include_url=False))) from exc
    ignored = {name.strip().casefold() for name in (context.ignore_sheets if context else [])}
    if any(ref.sheet.strip().casefold() in ignored for ref in document.review.references()):
        raise HTTPException(409, "This review includes a sheet excluded by the client's context")
    return document


def document_data(document: FinancialDocument) -> dict:
    # Required Figure.value=null means unavailable. Never drop it on save.
    return document.model_dump(mode="json", exclude={"expected_version"}, exclude_unset=True)


def result(row) -> dict:
    return {"id": row["id"], "org": row["org"], "version": row["version"],
            "created_at": row["created_at"], "updated_at": row["updated_at"], **json.loads(row["doc"])}


@router.get("")
def list_reviews(org: OrgQuery, response: Response, owner: str = Depends(financial_owner)):
    require_org(org)
    response.headers["Cache-Control"] = "no-store"
    with store.connect() as con:
        rows = con.execute("SELECT id,title,version,created_at,updated_at FROM financial_reviews WHERE owner=? AND org=? ORDER BY updated_at DESC", (owner, org)).fetchall()
    return [dict(row) for row in rows]


@router.get("/{review_id}")
def get_review(review_id: str, org: OrgQuery, response: Response, owner: str = Depends(financial_owner)):
    require_org(org)
    response.headers["Cache-Control"] = "no-store"
    with store.connect() as con:
        row = con.execute("SELECT * FROM financial_reviews WHERE id=? AND owner=? AND org=?", (review_id, owner, org)).fetchone()
    if row is None:
        raise HTTPException(404, "Financial review not found for this client")
    return result(row)


@router.post("", status_code=201)
async def create_review(request: Request, org: OrgQuery, owner: str = Depends(financial_owner)):
    document = await read_document(request, org)
    data = document_data(document)
    now = datetime.now(timezone.utc).isoformat()
    review_id = uuid.uuid4().hex
    with store.connect() as con:
        con.execute("INSERT INTO financial_reviews(id,owner,org,title,version,created_at,updated_at,doc) VALUES (?,?,?,?,1,?,?,?)",
                    (review_id, owner, org, document.title, now, now, json.dumps(data, allow_nan=False)))
    return {"id": review_id, "org": org, "version": 1, "created_at": now, "updated_at": now, **data}


@router.put("/{review_id}")
async def update_review(review_id: str, request: Request, org: OrgQuery, owner: str = Depends(financial_owner)):
    document = await read_document(request, org)
    if document.expected_version is None:
        raise HTTPException(422, "The version you opened is required to save changes")
    data = document_data(document)
    now = datetime.now(timezone.utc).isoformat()
    with store.connect() as con:
        found = con.execute("SELECT version,created_at FROM financial_reviews WHERE id=? AND owner=? AND org=?", (review_id, owner, org)).fetchone()
        if found is None:
            raise HTTPException(404, "Financial review not found for this client")
        changed = con.execute("UPDATE financial_reviews SET title=?,version=version+1,updated_at=?,doc=? WHERE id=? AND owner=? AND org=? AND version=?",
                              (document.title, now, json.dumps(data, allow_nan=False), review_id, owner, org, document.expected_version))
        if changed.rowcount != 1:
            raise HTTPException(409, "This financial review changed in another session. Save a copy or reopen the current version.")
    # Return exactly this committed revision, never a subsequent writer's GET.
    return {"id": review_id, "org": org, "version": document.expected_version + 1,
            "created_at": found["created_at"], "updated_at": now, **data}


@router.delete("/{review_id}", status_code=204)
def delete_review(review_id: str, org: OrgQuery, expected_version: Annotated[int, Query(ge=1)], owner: str = Depends(financial_owner)):
    require_org(org)
    with store.connect() as con:
        found = con.execute("SELECT version FROM financial_reviews WHERE id=? AND owner=? AND org=?", (review_id, owner, org)).fetchone()
        if found is None:
            raise HTTPException(404, "Financial review not found for this client")
        changed = con.execute("DELETE FROM financial_reviews WHERE id=? AND owner=? AND org=? AND version=?", (review_id, owner, org, expected_version))
        if changed.rowcount != 1:
            raise HTTPException(409, "This financial review changed in another session. Reopen it before deleting.")
    return Response(status_code=204)
