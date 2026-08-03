"""Layer 01/02 boundary.

Upload returns an inventory and a check run — not a report. Turning an
inventory into a report is layer 02 (parse & normalize) and layer 02 is
where the honest gap is: today a person picks the ranges. This endpoint is
built so that when confidence-scored parsing lands, it slots in here and
nothing above it changes.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..pipeline.checks import detect_rollup_hierarchy
from ..pipeline.ingest import read_workbook
from ..schema import Source

router = APIRouter()

from ..auth import require_author  # noqa: E402
author = Depends(require_author)

ALLOWED = {".xlsx", ".xlsm"}
MAX_BYTES = 25 * 1024 * 1024


class SheetInfo(BaseModel):
    name: str
    rows: int
    cols: int


class CheckReport(BaseModel):
    name: str
    passed: bool
    detail: str
    data: dict = {}


class Inventory(BaseModel):
    source: Source
    sheets: list[SheetInfo]
    checks: list[CheckReport]
    needs_review: bool


@router.post(
    "/studio/ingest",
    response_model=Inventory,
    tags=["studio"],
    dependencies=[author],
)
async def ingest(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(415, f"Unsupported type '{ext}'. Accepts: {sorted(ALLOWED)}")

    body = await file.read()
    if len(body) > MAX_BYTES:
        raise HTTPException(413, f"File exceeds {MAX_BYTES // 1024 // 1024} MB")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(body)
        tmp_path = Path(tmp.name)

    try:
        wb = read_workbook(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    wb.source.filename = file.filename or wb.source.filename

    sheets = [
        SheetInfo(
            name=s.name,
            rows=s.rows,
            cols=max((len(r) for r in s.grid), default=0),
        )
        for s in wb.sheets.values()
    ]

    # CH-001 sweeps every label/number column pair we can find. Cheap, and it
    # is the check most likely to change a number rather than a caveat.
    checks: list[CheckReport] = []
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

    wb.source.checks_run = len(checks)
    wb.source.checks_passed = sum(c.passed for c in checks)

    return Inventory(
        source=wb.source,
        sheets=sheets,
        checks=checks,
        needs_review=any(not c.passed for c in checks),
    )
