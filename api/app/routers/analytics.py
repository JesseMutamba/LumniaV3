"""Private, client-scoped analysis workspaces. Published reports stay separate.

The saved document is a prepared source snapshot and a declarative dashboard,
not a set of trusted report values. Charts are recalculated when it opens.
Existing author authentication and client retention choices apply here too.
"""
from __future__ import annotations

import json
import math
import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Literal, Union

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictFloat, StrictInt, ValidationError, model_validator

from .. import store
from ..auth import require_author

router = APIRouter(prefix="/studio/orgs/{org_id}/analytics", dependencies=[Depends(require_author)], tags=["studio"])
MAX_BYTES = 12 * 1024 * 1024
def finite_number(value):
    try:
        valid = math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("Numeric cells must be finite in the browser")
    return value


Cell = Union[Annotated[str, Field(max_length=10000)], Annotated[StrictInt, AfterValidator(finite_number)], Annotated[StrictFloat, Field(allow_inf_nan=False)], None]
View = Literal["monthly", "quarterly", "yearly", "region", "product"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Issue(Model):
    severity: Literal["info", "warning"]
    message: str = Field(max_length=5000)
    source: str | None = Field(default=None, max_length=1000)


class Preview(Model):
    row: int = Field(ge=1)
    cells: list[Cell] = Field(max_length=150)


class Preparation(Model):
    layout: Literal["table", "matrix", "ledger"]
    sheet: str = Field(min_length=1, max_length=200)
    range: str = Field(min_length=1, max_length=200)
    headerRow: int = Field(ge=1)
    originalRows: int = Field(ge=0)
    activeRows: int = Field(ge=0, le=20001)
    ignoredFormattedRows: int = Field(ge=0)
    changes: list[Annotated[str, Field(max_length=5000)]] = Field(max_length=100)
    issues: list[Issue] = Field(max_length=300)
    preview: list[Preview] = Field(max_length=10)
    duplicateRows: int = Field(ge=0)
    formulaCount: int = Field(ge=0)
    formulaErrors: int = Field(ge=0)
    missingFormulaResults: int = Field(ge=0)


class Metric(Model):
    id: str = Field(min_length=1, max_length=500)
    label: str = Field(min_length=1, max_length=500)
    currency: str = Field(pattern=r"^(?:[A-Z]{3}|UNSPECIFIED)$")
    unit: Literal["currency", "number", "percent"]
    aggregation: Literal["sum", "last"]
    role: Literal["receipts", "payments", "balance", "opening"] | None = None


class Financial(Model):
    metrics: list[Metric] = Field(min_length=1, max_length=2000)
    granularity: Literal["annual", "monthly", "daily"]
    basis: Literal["projection", "recorded", "unspecified"]
    title: str = Field(max_length=500)


class Provenance(Model):
    sheet: str = Field(min_length=1, max_length=200)
    rows: list[Annotated[int, Field(ge=1, le=1048576)]] = Field(max_length=20000)
    columns: list[Annotated[int, Field(ge=0, lt=150)]] = Field(max_length=150)


class Dataset(Model):
    name: str = Field(min_length=1, max_length=500)
    headers: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(min_length=2, max_length=150)
    rows: list[list[Cell]] = Field(min_length=1, max_length=20000)
    sheet: str = Field(min_length=1, max_length=500)
    kind: Literal["financial", "table"]
    report: Preparation
    financial: Financial | None = None
    provenance: Provenance | None = None
    sourceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    currencyEvidence: dict[Annotated[str, Field(max_length=500)], list[Annotated[str, Field(pattern=r"^(?:[A-Z]{3}|DOLLAR)$")]]] = Field(default_factory=dict, max_length=150)

    @model_validator(mode="after")
    def valid_shape(self):
        if len(set(self.headers)) != len(self.headers):
            raise ValueError("Prepared headers must be unique")
        if len(self.rows) * len(self.headers) > 750000 or any(len(r) != len(self.headers) for r in self.rows):
            raise ValueError("Prepared table must be rectangular and contain at most 750,000 cells")
        if self.kind == "financial":
            if not self.financial or self.headers != ["Period", "Metric", "Amount", "Category", "Currency", "Unit", "Basis", "Source"]:
                raise ValueError("A financial table requires its measure definitions")
            metrics = {m.id: m for m in self.financial.metrics}
            if len(metrics) != len(self.financial.metrics):
                raise ValueError("Financial measure identifiers must be unique")
            import re
            for row in self.rows:
                period = row[0]
                pattern = {"annual": r"\d{4}", "monthly": r"\d{4}-\d{2}", "daily": r"\d{4}-\d{2}-\d{2}"}[self.financial.granularity]
                if not isinstance(period, str) or not re.fullmatch(pattern, period):
                    raise ValueError("Financial periods must match the source frequency")
                date.fromisoformat(period + {"annual": "-01-01", "monthly": "-01", "daily": ""}[self.financial.granularity])
                m = metrics.get(row[1])
                if not m or not isinstance(row[2], (int, float)) or row[4] != m.currency or row[5] != m.unit:
                    raise ValueError("Financial observations must match their measure and currency")
                if not isinstance(row[7], str) or not re.fullmatch(r".+![A-Z]+[1-9][0-9]*", row[7]):
                    raise ValueError("Every financial observation needs an original source cell")
                if row[7].rsplit("!", 1)[0] != self.report.sheet:
                    raise ValueError("Source cells must belong to the reviewed source sheet")
        elif not self.provenance or len(self.provenance.rows) != len(self.rows) or len(self.provenance.columns) != len(self.headers):
            raise ValueError("Every prepared row and column must retain its source position")
        elif self.provenance.sheet != self.report.sheet:
            raise ValueError("Prepared row provenance must match the reviewed sheet")
        if any(key not in self.headers or len(units) > 12 for key, units in self.currencyEvidence.items()):
            raise ValueError("Currency evidence must name a prepared column")
        return self


class Mapping(Model):
    date: str = Field(max_length=500)
    revenue: str = Field(max_length=500)
    region: str = Field(max_length=500)
    product: str = Field(max_length=500)
    currency: Literal["UNSPECIFIED", "USD", "CDF", "EUR", "GBP", "CAD", "AUD", "XOF", "XAF"]
    dateFormat: Literal["MDY", "DMY"]
    metric: str | None = Field(default=None, max_length=500)
    removeDuplicates: bool = False


class Message(Model):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=12000)


class DashboardIn(Model):
    title: str = Field(min_length=1, max_length=160)
    dataset: Dataset
    mapping: Mapping
    views: list[View] = Field(max_length=5)
    messages: list[Message] = Field(max_length=100)
    expected_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def valid_mapping(self):
        if not self.title.strip():
            raise ValueError("Give this dashboard a name")
        if len(set(self.views)) != len(self.views):
            raise ValueError("Chart views must be unique")
        if self.dataset.kind == "table":
            if self.mapping.date and self.mapping.date == self.mapping.revenue:
                raise ValueError("Date and amount must be different columns")
            for field in ("date", "revenue", "region", "product"):
                value = getattr(self.mapping, field)
                if value and value not in self.dataset.headers:
                    raise ValueError("Column mapping refers to an unknown column")
        elif self.mapping.metric not in {m.id for m in self.dataset.financial.metrics}:
            raise ValueError("Choose a measure from this financial table")
        return self


def require_org(org_id: str):
    if not store.get_org(org_id):
        raise HTTPException(404, "Client not found")


async def read_document(request: Request, org_id: str) -> DashboardIn:
    require_org(org_id)
    context = store.get_context(org_id)
    if context and not context.retain_files:
        raise HTTPException(409, "Saving prepared data is disabled by this client's retention setting. Analysis is available for this session.")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BYTES:
            raise HTTPException(413, "Prepared dashboard exceeds 12 MB")
    try:
        document = DashboardIn.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(422, json.loads(exc.json(include_input=False, include_url=False))) from exc
    ignored = {s.strip().casefold() for s in (context.ignore_sheets if context else [])}
    if document.dataset.report.sheet.strip().casefold() in ignored:
        raise HTTPException(409, "This sheet is excluded by the client's context")
    return document


def response(row):
    return {"id": row["id"], "org": row["org"], "version": row["version"],
            "created_at": row["created_at"], "updated_at": row["updated_at"], **json.loads(row["doc"])}


@router.get("/dashboards")
def list_dashboards(org_id: str):
    require_org(org_id)
    with store.connect() as con:
        rows = con.execute("SELECT id,title,version,created_at,updated_at FROM analytics_dashboards WHERE org=? ORDER BY updated_at DESC", (org_id,)).fetchall()
    return [dict(r) for r in rows]


@router.get("/dashboards/{dashboard_id}")
def get_dashboard(org_id: str, dashboard_id: str):
    require_org(org_id)
    with store.connect() as con:
        row = con.execute("SELECT * FROM analytics_dashboards WHERE org=? AND id=?", (org_id, dashboard_id)).fetchone()
    if row is None:
        raise HTTPException(404, "Dashboard not found for this client")
    return response(row)


@router.post("/dashboards", status_code=201)
async def create_dashboard(org_id: str, request: Request):
    document = await read_document(request, org_id)
    now = datetime.now(timezone.utc).isoformat()
    dashboard_id = uuid.uuid4().hex
    data = document.model_dump(mode="json", exclude={"expected_version"}, exclude_none=True)
    with store.connect() as con:
        con.execute("INSERT INTO analytics_dashboards(id,org,title,version,created_at,updated_at,doc) VALUES (?,?,?,1,?,?,?)",
                    (dashboard_id, org_id, document.title.strip(), now, now, json.dumps(data, allow_nan=False)))
    return get_dashboard(org_id, dashboard_id)


@router.put("/dashboards/{dashboard_id}")
async def update_dashboard(org_id: str, dashboard_id: str, request: Request):
    document = await read_document(request, org_id)
    if document.expected_version is None:
        raise HTTPException(422, "The version you opened is required to save changes")
    data = document.model_dump(mode="json", exclude={"expected_version"}, exclude_none=True)
    now = datetime.now(timezone.utc).isoformat()
    with store.connect() as con:
        found = con.execute("SELECT version,created_at FROM analytics_dashboards WHERE org=? AND id=?", (org_id, dashboard_id)).fetchone()
        if not found:
            raise HTTPException(404, "Dashboard not found for this client")
        updated = con.execute("UPDATE analytics_dashboards SET title=?,version=version+1,updated_at=?,doc=? WHERE org=? AND id=? AND version=?",
                              (document.title.strip(), now, json.dumps(data, allow_nan=False), org_id, dashboard_id, document.expected_version))
        if updated.rowcount != 1:
            raise HTTPException(409, "This dashboard changed in another session. Save a copy or reopen the current version.")
    return {"id":dashboard_id,"org":org_id,"version":document.expected_version+1,"created_at":found["created_at"],"updated_at":now,**data}
