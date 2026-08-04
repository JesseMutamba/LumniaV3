"""Named analysis modules — the analyses clients ask for repeatedly,
packaged as runnable units with fixed definitions.

A module has a name, a version, and one job. It runs during ingest over
what the parser detected, shaped by the client's context, and emits report
blocks. Which modules run for a client is part of their context — a
versioned, visible choice, not a code path. Definitions are fixed per
module version, so "execution v1" means the same computation for every
client, every month; when the definition changes, the version does.

Modules compute; every figure they emit carries provenance like any other.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable

from ..schema import (
    Flag,
    Kpi,
    KpiGrid,
    Rail,
    RailRow,
    Src,
    Table,
    Text,
    Value,
)
from .ingest import Workbook, a1, a1_range
from .parse import DetectedTable, _is_num, _norm, _unit_for

MAX_RAIL_ROWS = 8
MAX_RECON_ROWS = 12


@dataclass
class Module:
    name: str
    version: str
    description_fr: str
    description_en: str
    run: Callable  # (wb, tables, ctx, extras) -> list[blocks]


# --------------------------------------------------------------------------
# movements — the recurring-ingestion delta, as a named product
# --------------------------------------------------------------------------

def _run_movements(wb: Workbook, tables, ctx, extras) -> list:
    delta = extras.get("delta")
    if not delta or not delta.get("alerts"):
        return []
    alerts = delta["alerts"]
    lines = "; ".join(
        f"{a['sheet']} · {a['label']} · {a['column']} : {a['before']:g} → {a['after']:g}"
        + (f" ({a['pct']:+.1f} %)" if a.get("pct") is not None else "")
        for a in alerts[:8]
    )
    return [
        Flag(
            severity="warn",
            tag=Text(fr="Mouvement détecté", en="Movement detected"),
            title=Text(
                fr=f"{len(alerts)} valeur(s) ont bougé depuis l'ingestion précédente",
                en=f"{len(alerts)} value(s) moved since the previous ingest",
            ),
            body=Text(fr=lines),
        )
    ]


# --------------------------------------------------------------------------
# execution — budget vs actual, ratio of totals, never average of ratios
# --------------------------------------------------------------------------

BUDGET_WORDS = ("budget", "prévu", "prevu", "plan")
ACTUAL_WORDS = ("réel", "reel", "actual", "réalisé", "realise")


def _find_col(t: DetectedTable, words) -> object | None:
    for c in t.columns:
        if c.kind == "number" and any(w in _norm(c.label) for w in words):
            return c
    return None


def _run_execution(wb: Workbook, tables, ctx, extras) -> list:
    """For every table carrying a budget column and an actual column: the
    execution rail per line, and total execution computed as a ratio of
    totals — sum over sum, the only honest way to aggregate a rate."""
    blocks: list = []
    for t in tables:
        b_col, a_col = _find_col(t, BUDGET_WORDS), _find_col(t, ACTUAL_WORDS)
        text_cols = [c for c in t.columns if c.kind == "text"]
        if not b_col or not a_col or not text_cols:
            continue
        sheet = wb[t.sheet]
        label_col = text_cols[0]
        rows: list[RailRow] = []
        sum_b = sum_a = 0.0
        first_r = last_r = None
        for r in range(t.first_row, t.last_row + 1):
            label = sheet.cell(r, label_col.index)
            b, a = sheet.cell(r, b_col.index), sheet.cell(r, a_col.index)
            if not isinstance(label, str) or not _is_num(b) or not _is_num(a):
                continue
            sum_b += float(b)
            sum_a += float(a)
            first_r = first_r or r
            last_r = r
            if len(rows) < MAX_RAIL_ROWS and b:
                unit = _unit_for(b_col.label, ctx)
                rows.append(
                    RailRow(
                        label=Text(fr=label.strip()),
                        envelope=Value(n=float(b), unit=unit,
                                       src=Src(file=wb.source.idx, sheet=t.sheet,
                                               cells=a1(r, b_col.index))),
                        pace=Value(n=float(b), unit=unit,
                                   src=Src(file=wb.source.idx, sheet=t.sheet,
                                           cells=a1(r, b_col.index))),
                        actual=Value(n=float(a), unit=unit,
                                     src=Src(file=wb.source.idx, sheet=t.sheet,
                                             cells=a1(r, a_col.index))),
                    )
                )
        if not rows or not sum_b:
            continue
        pct = round(sum_a / sum_b * 100, 1)
        a_range = a1_range(first_r, a_col.index, last_r, a_col.index)
        blocks.append(
            KpiGrid(
                items=[
                    Kpi(
                        label=Text(fr=f"Exécution · {t.sheet}",
                                   en=f"Execution · {t.sheet}"),
                        value=Value(n=pct, unit="pct", derived="ratio",
                                    src=Src(file=wb.source.idx, sheet=t.sheet,
                                            cells=a_range)),
                        sub=Text(
                            fr=f"{sum_a:,.0f} sur {sum_b:,.0f} — ratio des totaux, jamais moyenne des ratios".replace(",", " "),
                            en=f"{sum_a:,.0f} of {sum_b:,.0f} — ratio of totals, never average of ratios".replace(",", " "),
                        ),
                        tone="bad" if pct > 110 else "warn" if pct < 60 else "neutral",
                    )
                ]
            )
        )
        blocks.append(Rail(rows=rows))
    return blocks


# --------------------------------------------------------------------------
# reconciliation — the same money recorded twice across cash journals
# --------------------------------------------------------------------------

def _date_amount_rows(wb: Workbook, t: DetectedTable) -> list[tuple]:
    """(date, amount, row) for tables that look like cash journals: a date
    column and at least one numeric column."""
    sheet = wb[t.sheet]
    date_col = None
    for c_idx in range(1, max((len(r) for r in sheet.grid), default=0) + 1):
        vals = [sheet.cell(r, c_idx) for r in range(t.first_row, t.last_row + 1)]
        dates = [v for v in vals if isinstance(v, (datetime, date))]
        if len(dates) >= max(3, (t.last_row - t.first_row + 1) // 2):
            date_col = c_idx
            break
    if date_col is None:
        return []
    num_cols = [c for c in t.columns if c.kind == "number"]
    out = []
    for r in range(t.first_row, t.last_row + 1):
        d = sheet.cell(r, date_col)
        if not isinstance(d, (datetime, date)):
            continue
        day = d.date() if isinstance(d, datetime) else d
        for c in num_cols:
            v = sheet.cell(r, c.index)
            if _is_num(v) and abs(float(v)) >= 1:
                out.append((day, round(float(v), 2), r, c.index, t.sheet))
    return out


def _run_reconciliation(wb: Workbook, tables, ctx, extras) -> list:
    """Match rows across journal tables on (date, amount). The same money
    recorded in two journals is the classic double-count; here it becomes a
    table the author can take to finance, every line pointing at both cells.

    Which sheets are journals is the client's knowledge, not the module's
    guess: context.reconcile_sheets names them. Left empty, every detected
    table with dates is considered — noisier, but nothing is hidden."""
    wanted = {_norm(s) for s in (ctx.reconcile_sheets if ctx else [])}
    pool = [t for t in tables if not wanted or _norm(t.sheet) in wanted]
    journals = [(t, _date_amount_rows(wb, t)) for t in pool]
    journals = [(t, rows) for t, rows in journals if rows]
    if len(journals) < 2:
        return []
    matches: list[dict] = []
    seen: set = set()
    for i in range(len(journals)):
        for j in range(i + 1, len(journals)):
            t1, rows1 = journals[i]
            t2, rows2 = journals[j]
            if t1.sheet == t2.sheet:
                continue
            index = {}
            for day, amt, r, c, sh in rows1:
                index.setdefault((day, amt), []).append((r, c, sh))
            for day, amt, r2, c2, sh2 in rows2:
                hits = index.get((day, amt))
                if not hits:
                    continue
                key = (day, amt, sh2)
                if key in seen:
                    continue
                seen.add(key)
                r1, c1, sh1 = hits[0]
                matches.append(
                    {"day": day, "amt": amt,
                     "a": (sh1, r1, c1), "b": (sh2, r2, c2)}
                )
    if not matches:
        return []
    total = sum(m["amt"] for m in matches)
    rows = []
    for m in matches[:MAX_RECON_ROWS]:
        rows.append(
            {
                "date": str(m["day"]),
                "amount": Value(
                    n=m["amt"], unit="none",
                    src=Src(file=wb.source.idx, sheet=m["a"][0],
                            cells=a1(m["a"][1], m["a"][2])),
                ),
                "also": f"{m['b'][0]}!{a1(m['b'][1], m['b'][2])}",
            }
        )
    blocks: list = [
        Flag(
            severity="warn",
            tag=Text(fr="Rapprochement", en="Reconciliation"),
            title=Text(
                fr=f"{len(matches)} écriture(s) présentes dans deux journaux — {total:,.0f} au total".replace(",", " "),
                en=f"{len(matches)} entries present in two journals — {total:,.0f} in total".replace(",", " "),
            ),
            body=Text(
                fr="Même date, même montant, deux journaux : le même argent compté deux fois tant qu'aucune clé de rapprochement n'existe. La somme des journaux surestime la dépense réelle.",
                en="Same date, same amount, two journals: the same money counted twice until a reconciliation key exists. Summing the journals overstates real spend.",
            ),
        ),
        Table(
            columns=[
                {"key": "date", "label": Text(fr="Date"), "align": "left"},
                {"key": "amount", "label": Text(fr="Montant"), "align": "right"},
                {"key": "also", "label": Text(fr="Aussi dans"), "align": "right"},
            ],
            rows=rows,
        ),
    ]
    return blocks


# --------------------------------------------------------------------------
# registry
# --------------------------------------------------------------------------

MODULES: dict[str, Module] = {
    m.name: m
    for m in [
        Module(
            name="movements",
            version="1.0",
            description_fr="Mouvements depuis l'ingestion précédente du même fichier, au-delà du seuil d'alerte du client.",
            description_en="Movements since the previous ingest of the same file, beyond the client's alert threshold.",
            run=_run_movements,
        ),
        Module(
            name="execution",
            version="1.0",
            description_fr="Exécution budget contre réel par ligne, et le total en ratio des totaux — jamais moyenne des ratios.",
            description_en="Budget-vs-actual execution per line, and the total as a ratio of totals — never an average of ratios.",
            run=_run_execution,
        ),
        Module(
            name="reconciliation",
            version="1.0",
            description_fr="Écritures à même date et même montant dans deux journaux : le même argent compté deux fois.",
            description_en="Entries with the same date and amount in two journals: the same money counted twice.",
            run=_run_reconciliation,
        ),
    ]
}

DEFAULT_MODULES = ["movements"]


def run_modules(names: list[str], wb: Workbook, tables, ctx, extras) -> tuple[list, list[str]]:
    """Run the named modules in order; returns (blocks, attribution)."""
    blocks: list = []
    ran: list[str] = []
    for name in names:
        mod = MODULES.get(name)
        if not mod:
            continue
        out = mod.run(wb, tables, ctx, extras)
        if out:
            blocks.extend(out)
            ran.append(f"{mod.name} v{mod.version}")
    return blocks, ran
