"""Report schema — the contract between the pipeline and the renderer.

The load-bearing rule of the whole platform lives here: a Value cannot be
constructed without a Src. There is no code path that produces a number
without an address. That is enforced by the type system, not by convention.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------

Locale = Literal["fr", "en"]
Unit = Literal["USD", "CDF", "t", "ha", "pct", "ratio", "USD/t", "count", "none"]
Derived = Literal[
    "read", "sum", "mean", "ratio", "delta", "extrapolation", "simulation"
]


class Text(BaseModel):
    """Localised string. `fr` is required; DRC clients read French first."""

    model_config = ConfigDict(extra="forbid")
    fr: str
    en: str | None = None

    def get(self, locale: Locale = "fr") -> str:
        return (self.en or self.fr) if locale == "en" else self.fr


class Src(BaseModel):
    """Where a number came from. file indexes Report.sources."""

    model_config = ConfigDict(extra="forbid")
    file: int = Field(ge=0)
    sheet: str
    cells: str


class Value(BaseModel):
    """A number that knows its own address.

    `src` is required and has no default. Constructing a Value without one
    raises. This is the anti-fabrication gate: the pipeline physically cannot
    hand the renderer an unsourced figure.
    """

    model_config = ConfigDict(extra="forbid")
    n: float
    unit: Unit = "none"
    src: Src
    derived: Derived = "read"


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idx: int
    filename: str
    sha256: str | None = None
    sheets: int = 0
    rows_read: int = 0
    checks_run: int = 0
    checks_passed: int = 0


# --------------------------------------------------------------------------
# blocks
# --------------------------------------------------------------------------


class Block(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str | None = None


class Heading(Block):
    type: Literal["heading"] = "heading"
    level: int = 2
    label: Text | None = None
    text: Text
    dek: Text | None = None


class Prose(Block):
    type: Literal["prose"] = "prose"
    text: Text


class Kpi(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Text
    value: Value
    sub: Text | None = None
    tone: Literal["neutral", "good", "warn", "bad"] = "neutral"


class KpiGrid(Block):
    type: Literal["kpiGrid"] = "kpiGrid"
    items: list[Kpi] = Field(min_length=1)


class RailRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Text
    envelope: Value  # full-period budget
    pace: Value  # expected spend by the as-of date
    actual: Value  # what was actually spent


class Rail(Block):
    type: Literal["rail"] = "rail"
    rows: list[RailRow] = Field(min_length=1)


class Series(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    label: Text
    values: list[Value]


class BarPair(Block):
    type: Literal["barPair"] = "barPair"
    title: Text
    sub: Text | None = None
    x: list[str] | Literal["months"] = "months"
    series: list[Series] = Field(min_length=1, max_length=2)
    cutoff: int | None = None
    fmt: Literal["n", "k"] = "n"


class Column(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    label: Text
    align: Literal["left", "right"] = "right"
    money: bool = False
    signed: bool = False


class Table(Block):
    type: Literal["table"] = "table"
    columns: list[Column] = Field(min_length=1)
    rows: list[dict[str, Value | str | float]]
    total: dict[str, Value | str | float] | None = None


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["tree", "diff", "cells"]
    payload: dict


class Flag(Block):
    type: Literal["flag"] = "flag"
    severity: Literal["caught", "warn", "blocked"]
    tag: Text
    title: Text
    body: Text
    src: Src | None = None
    evidence: Evidence | None = None


class Ledger(Block):
    """Renders Report.sources. Takes no payload — it is a view of the envelope."""

    type: Literal["ledger"] = "ledger"


AnyBlock = Annotated[
    Union[Heading, Prose, KpiGrid, Rail, BarPair, Table, Flag, Ledger],
    Field(discriminator="type"),
]

# The frozen set. Adding a type here is a deliberate act, not a reflex —
# see docs/schema.md. Report #2 is the test of whether these eight hold.
BLOCK_TYPES = ("heading", "prose", "kpiGrid", "rail", "barPair", "table", "flag", "ledger")


# --------------------------------------------------------------------------
# envelope
# --------------------------------------------------------------------------


class Period(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Text
    start: date
    end: date


class Report(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    org: str
    title: Text
    period: Period
    status: Literal["draft", "published", "retracted"] = "draft"
    generated_at: datetime | None = None
    pipeline_version: str = "0.1.0"
    default_locale: Locale = "fr"
    sources: list[Source] = []
    blocks: list[AnyBlock] = []

    # Set by the server on publish, never supplied by the author. A reader
    # holding this key can fetch this one report and nothing else.
    share_key: str | None = None


class ReportStub(BaseModel):
    """What the index endpoint returns — no blocks, so the nav stays cheap."""

    model_config = ConfigDict(extra="forbid")
    id: str
    org: str
    title: Text
    period: Period
    status: str
    generated_at: datetime | None = None
    pipeline_version: str


class PortalReport(ReportStub):
    """A stub plus the key that opens it. Only ever inside a portal payload —
    the portal-key holder is entitled to read every published report here."""

    share_key: str


class Portal(BaseModel):
    """What a stakeholder holding a client's portal link sees: the client and
    its published reports, nothing else. There is no way to enumerate other
    clients from here."""

    model_config = ConfigDict(extra="forbid")
    org: "Org"
    reports: list[PortalReport]


class Org(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    sub: Text
    report_count: int = 0


class ContextIn(BaseModel):
    """What the author saves: the client's parsing knowledge.

    This is the context model — everything Lumnia knows about how *this*
    client keeps their books that a generic parser cannot guess. It shapes
    layer 02: which sheets to skip, what unit a header means, which labels
    are the same thing spelled twice, which rows are derived totals that
    would double-count if extracted.
    """

    model_config = ConfigDict(extra="forbid")
    ignore_sheets: list[str] = []
    units: dict[str, Unit] = {}          # header text -> unit, exact match wins
    aliases: dict[str, str] = {}         # label as written -> canonical label
    exclude_labels: list[str] = []       # rows whose label matches are dropped
    alert_threshold_pct: float = Field(default=20.0, ge=0)  # re-ingest movement alert


class Context(ContextIn):
    """A saved version. Definitions change; every change stays visible."""

    version: int
    updated_at: datetime


class ContextVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int
    updated_at: datetime


class ReadStats(BaseModel):
    """The audit answer: how many reads, how many distinct readers, when the
    last one was, and how many attempts were refused."""

    model_config = ConfigDict(extra="forbid")
    reads: int
    readers: int
    last_read: datetime | None = None
    refused: int


class StudioOrg(Org):
    """Org plus its portal key — appears only in author-authenticated
    responses, never on a public endpoint."""

    share_key: str | None = None


class OrgIn(BaseModel):
    """What an author posts to create a client."""

    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,38}$")
    name: str = Field(min_length=1, max_length=80)
    sub: Text


Portal.model_rebuild()
