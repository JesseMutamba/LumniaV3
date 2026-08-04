"""Recurring ingestion — the memory between uploads.

One upload is an analysis; the second upload of the same file is a watch.
This module snapshots what the parser found and, on the next ingest of the
same (client, filename), answers the operator's actual question: what moved?

Rows and columns are matched by their *labels*, not their positions, so a
client inserting a row in Excel doesn't turn everything into noise. Values
that moved beyond the client's alert threshold become alerts; rows and
tables that appeared or vanished become structural notes. The deltas
narrate; they carry no Value objects, because a delta is commentary on two
workbooks, not a figure from one.
"""
from __future__ import annotations

from .ingest import Workbook
from .parse import DetectedTable

MAX_CHANGES = 40  # the diff points the eye; the workbook holds the truth


def snapshot(wb: Workbook, tables: list[DetectedTable]) -> dict:
    """Compact record of what was detected: per sheet, rows keyed by their
    label, numeric cells keyed by their column header."""
    out: dict = {"tables": {}}
    for t in tables:
        sheet = wb[t.sheet]
        text_cols = [c for c in t.columns if c.kind == "text"]
        num_cols = [c for c in t.columns if c.kind == "number"]
        if not text_cols or not num_cols:
            continue
        label_col = text_cols[0]
        rows: dict = {}
        for r in range(t.first_row, t.last_row + 1):
            label = sheet.cell(r, label_col.index)
            if not isinstance(label, str) or not label.strip():
                continue
            vals = {}
            for c in num_cols:
                v = sheet.cell(r, c.index)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    vals[c.label] = float(v)
            if vals:
                rows[label.strip()] = vals
        out["tables"][t.sheet] = {"cells": t.cells, "rows": rows}
    return out


def diff(prev: dict, curr: dict, threshold_pct: float) -> dict:
    """What changed between two snapshots of the same file.

    Returns {changes, alerts, notes}: every value movement (capped), the
    subset beyond the threshold, and structural observations in prose.
    """
    changes: list[dict] = []
    notes: list[str] = []
    p_tables = prev.get("tables", {})
    c_tables = curr.get("tables", {})

    for sheet in sorted(set(c_tables) - set(p_tables)):
        notes.append(f"nouveau tableau : {sheet}")
    for sheet in sorted(set(p_tables) - set(c_tables)):
        notes.append(f"tableau disparu : {sheet}")

    for sheet in sorted(set(p_tables) & set(c_tables)):
        p_rows = p_tables[sheet]["rows"]
        c_rows = c_tables[sheet]["rows"]
        added = sorted(set(c_rows) - set(p_rows))
        gone = sorted(set(p_rows) - set(c_rows))
        if added:
            notes.append(f"{sheet} : ligne(s) nouvelle(s) — " + ", ".join(added[:5]))
        if gone:
            notes.append(f"{sheet} : ligne(s) disparue(s) — " + ", ".join(gone[:5]))
        for label in sorted(set(p_rows) & set(c_rows)):
            for col in sorted(set(p_rows[label]) & set(c_rows[label])):
                before, after = p_rows[label][col], c_rows[label][col]
                if before == after:
                    continue
                pct = round((after - before) / abs(before) * 100, 1) if before else None
                changes.append(
                    {
                        "sheet": sheet,
                        "label": label,
                        "column": col,
                        "before": before,
                        "after": after,
                        "pct": pct,
                    }
                )

    dropped = len(changes) - MAX_CHANGES
    changes = changes[:MAX_CHANGES]
    if dropped > 0:
        notes.append(f"{dropped} changement(s) de plus non listés")

    alerts = [
        c for c in changes if c["pct"] is None or abs(c["pct"]) >= threshold_pct
    ]
    return {"changes": changes, "alerts": alerts, "notes": notes}
