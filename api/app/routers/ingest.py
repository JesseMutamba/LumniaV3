"""Layer 01/02 boundary.

Upload returns an inventory, a check run, and — since layer 02 landed — a
confidence-scored *draft report*: every table the parser could find, every
extracted value already carrying its source cell. The draft is returned,
not stored; the author reviews it, edits the document, and publishes it
through the normal flow. The machine writes the first draft, the author
signs it.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from .. import store
from ..auth import require_author
from ..pipeline.checks import detect_rollup_hierarchy
from ..pipeline.ingest import read_workbook
from ..pipeline.modules import DEFAULT_MODULES, MODULES, run_modules
from ..pipeline.parse import build_draft, detect_tables
from ..pipeline.recur import diff, snapshot
from ..schema import Prose, Report, Source, Text

router = APIRouter()
author = Depends(require_author)

ALLOWED = {".xlsx", ".xlsm"}
MAX_BYTES = 25 * 1024 * 1024


class SheetInfo(BaseModel):
    name: str
    rows: int
    cols: int
    file: int = 0


class CheckReport(BaseModel):
    name: str
    passed: bool
    detail: str
    data: dict = {}


class TableInfo(BaseModel):
    file: int = 0
    sheet: str
    cells: str
    rows: int
    cols: int
    confidence: float
    notes: list[str] = []


class ValueChange(BaseModel):
    sheet: str
    label: str
    column: str
    before: float
    after: float
    pct: float | None = None


class IngestionDelta(BaseModel):
    """What this ingest sees that the previous one of the same file didn't."""

    seq: int
    previous_ts: str | None = None
    changes: list[ValueChange] = []
    alerts: list[ValueChange] = []
    notes: list[str] = []


class IngestionRecord(BaseModel):
    filename: str
    seq: int
    ts: str
    sha256: str | None = None


class Inventory(BaseModel):
    sources: list[Source]
    sheets: list[SheetInfo]
    checks: list[CheckReport]
    needs_review: bool
    tables: list[TableInfo] = []
    draft: Report | None = None
    ingestion: IngestionDelta | None = None
    modules_run: list[str] = []


@router.post(
    "/studio/ingest",
    response_model=Inventory,
    tags=["studio"],
    dependencies=[author],
)
async def ingest(
    file: list[UploadFile] = File(...), org: str = Query(default="client")
):
    """One or several workbooks in one session — budget and actuals side by
    side. Sources are indexed in upload order; provenance carries the file."""
    wbs = []
    for i, f in enumerate(file):
        ext = Path(f.filename or "").suffix.lower()
        if ext not in ALLOWED:
            raise HTTPException(415, f"Unsupported type '{ext}'. Accepts: {sorted(ALLOWED)}")
        body = await f.read()
        if len(body) > MAX_BYTES:
            raise HTTPException(413, f"File exceeds {MAX_BYTES // 1024 // 1024} MB")
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(body)
            tmp_path = Path(tmp.name)
        try:
            wb = read_workbook(tmp_path, idx=i)
        finally:
            tmp_path.unlink(missing_ok=True)
        wb.source.filename = f.filename or wb.source.filename
        wbs.append(wb)

    sheets = [
        SheetInfo(
            name=s.name,
            rows=s.rows,
            cols=max((len(r) for r in s.grid), default=0),
            file=wb.source.idx,
        )
        for wb in wbs
        for s in wb.sheets.values()
    ]

    # CH-001 sweeps every label/number column pair we can find. Cheap, and it
    # is the check most likely to change a number rather than a caveat.
    checks: list[CheckReport] = []
    for wb in wbs:
        for s in wb.sheets.values():
            for col in range(2, 6):
                pairs = [
                    (str(s.cell(r, col - 1)), s.cell(r, col))
                    for r in range(1, s.rows + 1)
                    if isinstance(s.cell(r, col), (int, float))
                    and isinstance(s.cell(r, col - 1), str)
                ]
                if len(pairs) < 4:
                    continue
                res = detect_rollup_hierarchy(pairs)
                if not res.passed:
                    checks.append(
                        CheckReport(
                            name=f"{res.name} · {s.name}!col{col}",
                            passed=False,
                            detail=res.detail,
                            data=res.data,
                        )
                    )

    if not checks:
        checks.append(
            CheckReport(
                name="CH-001 rollup-hierarchy",
                passed=True,
                detail="No flattened rollups detected in any sheet.",
            )
        )
    for wb in wbs:
        wb.source.checks_run = len(checks)
        wb.source.checks_passed = sum(c.passed for c in checks)

    # Layer 02: detect tables, build the reviewable draft. The client's
    # context (latest version) shapes both — ignored sheets are never read,
    # units and aliases come from what this client's books actually mean.
    ctx = store.get_context(org)
    detected: list = []
    for wb in wbs:
        detected += [(wb.source.idx, t) for t in detect_tables(wb, ctx)]
    draft = build_draft(wbs, detected, org, ctx) if detected else None

    # Recurring ingestion: remember each file, and if we've seen it for this
    # client before, answer "what moved" — alerts beyond the client's
    # threshold, structural changes as notes. Deltas merge across files.
    ingestion = None
    delta_raw = None
    if detected and store.get_org(org):
        merged = {"changes": [], "alerts": [], "notes": []}
        seqs, prev_ts = [], None
        for wb in wbs:
            own = [t for i, t in detected if i == wb.source.idx]
            if not own:
                continue
            snap = snapshot(wb, own)
            prev = store.last_ingestion(org, wb.source.filename)
            seqs.append(
                store.put_ingestion(org, wb.source.filename, wb.source.sha256, snap)
            )
            if prev:
                prev_ts = prev_ts or prev["ts"]
                threshold = ctx.alert_threshold_pct if ctx else 20.0
                d = diff(prev["summary"], snap, threshold)
                for k in merged:
                    merged[k] += d[k]
        if prev_ts:
            delta_raw = merged
            ingestion = IngestionDelta(seq=max(seqs), previous_ts=prev_ts, **merged)
        elif seqs:
            ingestion = IngestionDelta(seq=max(seqs))

    # Named analysis modules: the client's context says which analyses run
    # on every ingest. Their blocks join the draft ahead of the ledger, each
    # figure carrying provenance like any other.
    modules_run: list[str] = []
    if draft:
        names = ctx.modules if ctx else DEFAULT_MODULES
        blocks, modules_run = run_modules(
            names, wbs, detected, ctx, {"delta": delta_raw}
        )
        if blocks:
            draft.blocks[1:1] = blocks
        if modules_run:
            draft.blocks.insert(
                1,
                Prose(
                    text=Text(
                        fr="Modules exécutés : " + " · ".join(modules_run) + ".",
                        en="Modules run: " + " · ".join(modules_run) + ".",
                    )
                ),
            )

    return Inventory(
        sources=[wb.source for wb in wbs],
        sheets=sheets,
        checks=checks,
        needs_review=any(not c.passed for c in checks),
        tables=[
            TableInfo(
                file=i,
                sheet=t.sheet,
                cells=t.cells,
                rows=t.n_rows,
                cols=len(t.columns),
                confidence=t.confidence,
                notes=t.notes,
            )
            for i, t in detected
        ],
        draft=draft,
        ingestion=ingestion,
        modules_run=modules_run,
    )


class ModuleInfo(BaseModel):
    name: str
    version: str
    description_fr: str
    description_en: str


@router.get(
    "/studio/modules",
    response_model=list[ModuleInfo],
    tags=["studio"],
    dependencies=[author],
)
def get_modules():
    """The registry: every named analysis this platform can run. Enable them
    per client in the context document."""
    return [
        ModuleInfo(
            name=m.name,
            version=m.version,
            description_fr=m.description_fr,
            description_en=m.description_en,
        )
        for m in MODULES.values()
    ]


@router.get(
    "/studio/orgs/{org_id}/ingestions",
    response_model=list[IngestionRecord],
    tags=["studio"],
    dependencies=[author],
)
def get_ingestions(org_id: str):
    """The retention record: every ingest for this client, newest first."""
    if not store.get_org(org_id):
        raise HTTPException(404, f"Unknown org: {org_id}")
    return [IngestionRecord(**r) for r in store.list_ingestions(org_id)]
