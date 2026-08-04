"""Layer 02 — parse & normalize. The machine writes the first draft.

Takes the grids layer 01 read and finds the tables in them: a header row
inferred from strings, columns typed by what their cells actually hold, and
a confidence score that says how sure the detection is. From the detections
it builds a *draft* report document in which every extracted number already
carries the address of the cell it came from — the one rule holds from the
very first machine-written draft.

What this deliberately does not do: publish. The draft goes back to the
author for review. Confidence scores exist so the author knows where to
look first, not so the machine can skip the review.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from ..schema import (
    Column,
    Heading,
    Ledger,
    Prose,
    Report,
    Src,
    Table,
    Text,
    Value,
)
from .ingest import Sheet, Workbook, a1, a1_range

MAX_TABLES = 6      # a draft is a starting point, not a data dump
MAX_ROWS = 25       # per table; the workbook remains the system of record
MIN_DATA_ROWS = 2
NUMERIC_FRACTION = 0.6  # a column is numeric when ≥60% of its cells are


# --------------------------------------------------------------------------
# detection
# --------------------------------------------------------------------------

@dataclass
class DetectedColumn:
    index: int              # 1-based sheet column
    label: str
    kind: str               # "text" | "number"
    numeric_fraction: float = 0.0


@dataclass
class DetectedTable:
    sheet: str
    header_row: int
    first_row: int          # first data row
    last_row: int
    columns: list[DetectedColumn]
    confidence: float
    notes: list[str] = field(default_factory=list)

    @property
    def cells(self) -> str:
        c0 = self.columns[0].index
        c1 = self.columns[-1].index
        return a1_range(self.header_row, c0, self.last_row, c1)

    @property
    def n_rows(self) -> int:
        return self.last_row - self.first_row + 1


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_text(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


def _blocks(sheet: Sheet) -> list[tuple[int, int]]:
    """Contiguous runs of non-blank rows, as inclusive 1-indexed (r0, r1)."""
    out: list[tuple[int, int]] = []
    start = None
    for r in range(1, sheet.rows + 1):
        blank = not any(c is not None for c in (sheet.grid[r - 1] or []))
        if blank and start is not None:
            out.append((start, r - 1))
            start = None
        elif not blank and start is None:
            start = r
    if start is not None:
        out.append((start, sheet.rows))
    return out


def _detect_in_block(sheet: Sheet, r0: int, r1: int) -> DetectedTable | None:
    # Header: the first row in the block carrying at least two strings.
    header_row = next(
        (
            r
            for r in range(r0, r1 + 1)
            if sum(_is_text(sheet.cell(r, c)) for c in range(1, _width(sheet) + 1)) >= 2
        ),
        None,
    )
    if header_row is None or r1 - header_row < MIN_DATA_ROWS:
        return None

    cols = [
        DetectedColumn(index=c, label=str(sheet.cell(header_row, c)).strip(), kind="text")
        for c in range(1, _width(sheet) + 1)
        if _is_text(sheet.cell(header_row, c))
    ]
    if len(cols) < 2:
        return None

    first, last = header_row + 1, r1
    notes: list[str] = []

    # Type each column by what its data cells hold.
    filled = 0
    for col in cols:
        vals = [sheet.cell(r, col.index) for r in range(first, last + 1)]
        present = [v for v in vals if v is not None]
        nums = [v for v in present if _is_num(v)]
        filled += len(present)
        col.numeric_fraction = len(nums) / len(present) if present else 0.0
        col.kind = "number" if col.numeric_fraction >= NUMERIC_FRACTION else "text"

    n_number = sum(c.kind == "number" for c in cols)
    if n_number == 0:
        return None
    if all(c.kind == "number" for c in cols):
        notes.append("aucune colonne d'intitulés détectée")

    # Confidence: how header-like the header is, how pure the numeric columns
    # are, how filled the data region is. Blunt on purpose — the score points
    # the reviewer's eye, it does not replace the review.
    span = cols[-1].index - cols[0].index + 1
    header_strength = len(cols) / span
    purity = sum(c.numeric_fraction for c in cols if c.kind == "number") / n_number
    fill = filled / (len(cols) * (last - first + 1)) if last >= first else 0.0
    confidence = round(0.25 * header_strength + 0.5 * purity + 0.25 * fill, 2)

    return DetectedTable(
        sheet=sheet.name,
        header_row=header_row,
        first_row=first,
        last_row=last,
        columns=cols,
        confidence=confidence,
        notes=notes,
    )


def _width(sheet: Sheet) -> int:
    return max((len(r) for r in sheet.grid), default=0)


def detect_tables(wb: Workbook) -> list[DetectedTable]:
    """Every table worth showing an author, biggest first, capped."""
    found: list[DetectedTable] = []
    for sheet in wb.sheets.values():
        for r0, r1 in _blocks(sheet):
            t = _detect_in_block(sheet, r0, r1)
            if t:
                found.append(t)
    found.sort(key=lambda t: t.n_rows * len(t.columns), reverse=True)
    dropped = len(found) - MAX_TABLES
    found = found[:MAX_TABLES]
    if dropped > 0 and found:
        found[-1].notes.append(f"{dropped} tableau(x) plus petits non retenus")
    return found


# --------------------------------------------------------------------------
# draft builder
# --------------------------------------------------------------------------

def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:40] or "classeur"


def _unit_for(label: str) -> str:
    up = label.upper()
    if "USD" in up or "$" in label:
        return "USD"
    if "CDF" in up or up.endswith(" FC"):
        return "CDF"
    if "%" in label or "PCT" in up:
        return "pct"
    return "none"


def _table_block(wb: Workbook, t: DetectedTable) -> Table:
    sheet = wb[t.sheet]
    columns = [
        Column(
            key=f"c{c.index}",
            label=Text(fr=c.label),
            align="left" if c.kind == "text" else "right",
            money=_unit_for(c.label) in ("USD", "CDF"),
        )
        for c in t.columns
    ]
    rows: list[dict] = []
    for r in range(t.first_row, min(t.last_row, t.first_row + MAX_ROWS - 1) + 1):
        row: dict = {}
        for c in t.columns:
            v = sheet.cell(r, c.index)
            if v is None:
                continue
            if c.kind == "number" and _is_num(v):
                row[f"c{c.index}"] = Value(
                    n=float(v),
                    unit=_unit_for(c.label),
                    src=Src(file=wb.source.idx, sheet=t.sheet, cells=a1(r, c.index)),
                )
            else:
                row[f"c{c.index}"] = str(v)
        if row:
            rows.append(row)
    return Table(columns=columns, rows=rows)


def build_draft(wb: Workbook, tables: list[DetectedTable], org_id: str) -> Report:
    """A reviewable draft. Every number carries its cell; nothing is guessed."""
    today = date.today()
    name = wb.source.filename
    truncated = [t for t in tables if t.n_rows > MAX_ROWS]

    blocks: list = [
        Heading(
            level=2,
            label=Text(fr="Brouillon machine", en="Machine draft"),
            text=Text(fr="Extraction automatique", en="Automatic extraction"),
            dek=Text(
                fr=(
                    f"{len(tables)} tableau(x) détecté(s) dans « {name} ». Chaque valeur "
                    "porte sa cellule source. Relisez, renommez, supprimez — puis publiez."
                ),
                en=(
                    f"{len(tables)} table(s) detected in “{name}”. Every value carries its "
                    "source cell. Review, rename, prune — then publish."
                ),
            ),
        )
    ]
    for t in tables:
        pieces = [f"confiance {int(t.confidence * 100)} %", t.cells]
        if t.n_rows > MAX_ROWS:
            pieces.append(f"{t.n_rows - MAX_ROWS} ligne(s) tronquée(s)")
        pieces += t.notes
        blocks.append(
            Heading(
                level=3,
                label=Text(fr=t.sheet),
                text=Text(fr=t.sheet),
                dek=Text(fr=" · ".join(pieces)),
            )
        )
        blocks.append(_table_block(wb, t))
    if truncated:
        blocks.append(
            Prose(
                text=Text(
                    fr="Les tableaux tronqués le sont pour la relecture ; le classeur reste la source.",
                    en="Truncated tables are truncated for review; the workbook remains the source.",
                )
            )
        )
    blocks.append(Ledger())

    return Report(
        id=f"{org_id}-{_slug(name)}",
        org=org_id,
        title=Text(fr=f"Brouillon · {name}", en=f"Draft · {name}"),
        period={
            "label": Text(fr="À définir", en="To define"),
            "start": today,
            "end": today,
        },
        status="draft",
        pipeline_version="0.3.0",
        default_locale="fr",
        sources=[wb.source],
        blocks=blocks,
    )
