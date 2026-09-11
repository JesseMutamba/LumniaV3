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
    """Preserve every table/row/header occurrence; never overwrite a value."""
    import json
    from collections import Counter
    out = {"schema_version": 2, "tables": {}, "notes": []}
    occurrences = Counter()
    for t in sorted(tables, key=lambda item: (item.sheet, item.header_row)):
        text_cols = [c for c in t.columns if c.kind == "text"]
        num_cols = [c for c in t.columns if c.kind == "number"]
        if not text_cols or not num_cols:
            continue
        signature = json.dumps([t.sheet, [c.label for c in t.columns]], ensure_ascii=False)
        occurrences[signature] += 1
        key = json.dumps([signature, occurrences[signature]])
        table = {"sheet": t.sheet, "cells": t.cells, "rows": {}}
        labels = Counter()
        for r in range(t.first_row, t.last_row + 1):
            label = wb[t.sheet].cell(r, text_cols[0].index)
            if label is None or not str(label).strip():
                continue
            label = str(label).strip()
            labels[label] += 1
            row = {"label": label, "source_row": r, "values": {}}
            cols = Counter()
            for c in num_cols:
                cols[c.label] += 1
                value = wb[t.sheet].cell(r, c.index)
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    row["values"][json.dumps([c.label, cols[c.label]])] = {"label": c.label, "n": float(value), "source_col": c.index}
            table["rows"][json.dumps([label, labels[label]], ensure_ascii=False)] = row
        if any(n > 1 for n in labels.values()):
            out["notes"].append(f"{t.sheet}: repeated labels are matched by occurrence; review changes after reordering.")
        if occurrences[signature] > 1:
            out["notes"].append(f"{t.sheet}: repeated table headers are matched by occurrence.")
        out["tables"][key] = table
    return out


def diff(prev: dict, curr: dict, threshold_pct: float) -> dict:
    """Prioritize all significant changes before limiting the displayed list."""
    if prev.get("schema_version") != 2 or curr.get("schema_version") != 2:
        return {"changes": [], "alerts": [], "notes": ["Comparison baseline refreshed to preserve duplicate rows and tables. The next upload will be compared."], "changes_total": 0, "alerts_total": 0}
    changes, notes = [], list(curr.get("notes", []))
    p_tables, c_tables = prev["tables"], curr["tables"]
    for key in set(c_tables) - set(p_tables):
        notes.append(f"nouveau tableau : {c_tables[key]['sheet']}")
    for key in set(p_tables) - set(c_tables):
        notes.append(f"tableau disparu : {p_tables[key]['sheet']}")
    for key in sorted(set(p_tables) & set(c_tables)):
        sheet = c_tables[key]["sheet"]
        pr, cr = p_tables[key]["rows"], c_tables[key]["rows"]
        for added in sorted(set(cr) - set(pr)):
            notes.append(f"{sheet} : ligne nouvelle — {cr[added]['label']}")
        for gone in sorted(set(pr) - set(cr)):
            notes.append(f"{sheet} : ligne disparue — {pr[gone]['label']}")
        for row_key in sorted(set(pr) & set(cr)):
            pv, cv = pr[row_key]["values"], cr[row_key]["values"]
            if set(pv) != set(cv):
                notes.append(f"{sheet} / {cr[row_key]['label']}: numeric columns or missing values changed.")
            for col in sorted(set(pv) & set(cv)):
                before, after = pv[col]["n"], cv[col]["n"]
                if before != after:
                    changes.append({"sheet": sheet, "label": cr[row_key]["label"], "column": cv[col]["label"], "before": before, "after": after, "pct": round((after-before)/abs(before)*100, 1) if before else None})
    alerts = [c for c in changes if c["pct"] is None or abs(c["pct"]) >= threshold_pct]
    alerts.sort(key=lambda c: abs(c["pct"]) if c["pct"] is not None else float("inf"), reverse=True)
    other = [c for c in changes if c["pct"] is not None and abs(c["pct"]) < threshold_pct]
    if len(changes) > MAX_CHANGES:
        notes.append(f"{len(changes)-MAX_CHANGES} changement(s) de plus non listés; {len(alerts)} alert(s) in total.")
    return {"changes": (alerts+other)[:MAX_CHANGES], "alerts": alerts[:MAX_CHANGES], "notes": notes, "changes_total": len(changes), "alerts_total": len(alerts)}
