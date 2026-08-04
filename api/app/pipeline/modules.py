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

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable

from ..schema import (
    BarPair,
    Column,
    Flag,
    Heading,
    Kpi,
    KpiGrid,
    Prose,
    Rail,
    RailRow,
    Series,
    SeriesDef,
    Src,
    Step,
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
    run: Callable  # (wbs, tables, ctx, extras) -> list[blocks]
    # wbs: every workbook in the session; tables: [(file_idx, DetectedTable)]


# --------------------------------------------------------------------------
# movements — the recurring-ingestion delta, as a named product
# --------------------------------------------------------------------------

def _run_movements(wbs: list[Workbook], tables, ctx, extras) -> list:
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


def _run_execution(wbs: list[Workbook], tables, ctx, extras) -> list:
    """For every table carrying a budget column and an actual column: the
    execution rail per line, and total execution computed as a ratio of
    totals — sum over sum, the only honest way to aggregate a rate."""
    blocks: list = []
    for idx, t in tables:
        wb = wbs[idx]
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
            if not isinstance(label, str) or not (_is_num(b) or _is_num(a)):
                continue
            # A budgeted line with nothing spent yet has spent nothing — it
            # does not leave the denominator. Dropping such rows was silently
            # overstating execution: a line budgeted 8 000 and untouched used
            # to vanish, turning 13,6 % of spend into 50 %.
            bv = float(b) if _is_num(b) else 0.0
            av = float(a) if _is_num(a) else 0.0
            sum_b += bv
            sum_a += av
            first_r = first_r or r
            last_r = r
            if len(rows) < MAX_RAIL_ROWS and bv:
                unit = _unit_for(b_col.label, ctx)
                b_src = Src(file=wb.source.idx, sheet=t.sheet,
                            cells=a1(r, b_col.index))
                rows.append(
                    RailRow(
                        label=Text(fr=label.strip()),
                        envelope=Value(n=bv, unit=unit, src=b_src),
                        pace=Value(n=bv, unit=unit, src=b_src),
                        actual=Value(n=av, unit=unit,
                                     src=Src(file=wb.source.idx, sheet=t.sheet,
                                             cells=a1(r, a_col.index))),
                    )
                )
        if not rows or not sum_b:
            continue
        pct = round(sum_a / sum_b * 100, 1)
        a_range = a1_range(first_r, a_col.index, last_r, a_col.index)
        b_range = a1_range(first_r, b_col.index, last_r, b_col.index)
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
                        lineage=[
                            Step(text=Text(fr=f"Somme de la colonne « {a_col.label} »",
                                           en=f"Sum of column “{a_col.label}”"),
                                 cells=f"{t.sheet}!{a_range}", n=round(sum_a, 2)),
                            Step(text=Text(fr=f"Somme de la colonne « {b_col.label} »",
                                           en=f"Sum of column “{b_col.label}”"),
                                 cells=f"{t.sheet}!{b_range}", n=round(sum_b, 2)),
                            Step(text=Text(fr="Ratio des totaux — jamais moyenne des ratios",
                                           en="Ratio of totals — never an average of ratios"),
                                 n=pct),
                        ],
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


def _run_reconciliation(wbs: list[Workbook], tables, ctx, extras) -> list:
    """Match rows across journal tables on (date, amount). The same money
    recorded in two journals is the classic double-count; here it becomes a
    table the author can take to finance, every line pointing at both cells.

    Which sheets are journals is the client's knowledge, not the module's
    guess: context.reconcile_sheets names them. Left empty, every detected
    table with dates is considered — noisier, but nothing is hidden."""
    wanted = {_norm(s) for s in (ctx.reconcile_sheets if ctx else [])}
    pool = [(idx, t) for idx, t in tables if not wanted or _norm(t.sheet) in wanted]
    journals = [(idx, t, _date_amount_rows(wbs[idx], t)) for idx, t in pool]
    journals = [(idx, t, rows) for idx, t, rows in journals if rows]
    if len(journals) < 2:
        return []
    matches: list[dict] = []
    seen: set = set()
    for i in range(len(journals)):
        for j in range(i + 1, len(journals)):
            f1, t1, rows1 = journals[i]
            f2, t2, rows2 = journals[j]
            if f1 == f2 and t1.sheet == t2.sheet:
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
                     "a": (f1, sh1, r1, c1), "b": (f2, sh2, r2, c2)}
                )
    if not matches:
        return []
    total = sum(m["amt"] for m in matches)
    rows = []
    for m in matches[:MAX_RECON_ROWS]:
        fa, sha, ra, ca = m["a"]
        fb, shb, rb, cb = m["b"]
        rows.append(
            {
                "date": str(m["day"]),
                "amount": Value(
                    n=m["amt"], unit="none",
                    src=Src(file=wbs[fa].source.idx, sheet=sha, cells=a1(ra, ca)),
                ),
                "also": f"{shb}!{a1(rb, cb)}",
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
# budget-vs-actual — the phased comparison, across files
# --------------------------------------------------------------------------

def _find_series(wbs: list[Workbook], sd: SeriesDef):
    """Locate the row the context describes: (workbook, sheet name, row,
    [(col, value), ...]). Numeric cells left to right; leading cells dropped
    per `skip`; an annual-total column (first ≈ sum of the rest) is dropped
    automatically.

    A label that matches a row exactly wins over one that merely appears
    inside it. Real sheets carry « CPO » and « CPO 2025 » ten rows apart,
    and the looser match would silently answer with the wrong year."""
    loose = None
    for wb in wbs:
        for name, sheet in wb.sheets.items():
            if _norm(name) != _norm(sd.sheet):
                continue
            for r in range(1, sheet.rows + 1):
                row = sheet.grid[r - 1] or []
                labels = [_norm(c) for c in row[:4] if isinstance(c, str)]
                if not any(_norm(sd.label) in c for c in labels):
                    continue
                cells = [
                    (ci + 1, float(v)) for ci, v in enumerate(row) if _is_num(v)
                ]
                cells = _trim_totals(cells[sd.skip:])
                if not cells:
                    continue
                if any(c == _norm(sd.label) for c in labels):
                    return wb, name, r, cells
                loose = loose or (wb, name, r, cells)
    return loose


def _trim_totals(cells: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """Drop total columns bracketing the months. Real budget rows carry the
    annual figure before the months, after them, or both — a total is any
    end cell that equals the sum of what it brackets, within 1%."""
    def close(a: float, b: float) -> bool:
        return bool(a) and abs(a - b) <= abs(a) * 0.01

    # annual at both ends: head == tail == sum of the middle
    if (
        len(cells) >= 5
        and close(cells[0][1], cells[-1][1])
        and close(cells[0][1], sum(v for _, v in cells[1:-1]))
    ):
        cells = cells[1:-1]
    changed = True
    while changed and len(cells) >= 4:
        changed = False
        if close(cells[0][1], sum(v for _, v in cells[1:])):
            cells = cells[1:]
            changed = True
        elif close(cells[-1][1], sum(v for _, v in cells[:-1])):
            cells = cells[:-1]
            changed = True
    return cells


def _aligned(wbs: list[Workbook], mdef):
    """Both sides of a metric, summed over the months the actuals reach.

    Alignment is by month position, never by sequence: a month with no
    figure leaves a blank cell, and pairing what survives in order would
    compare March against February. One implementation, used by every
    module that compares a plan to a reality."""
    found_b = _find_series(wbs, mdef.budget)
    found_a = _find_series(wbs, mdef.actual)
    if not found_b or not found_a:
        return None
    bwb, bsheet, brow, bcells = found_b
    awb, asheet, arow, acells = found_a
    bmap = {c - bcells[0][0]: (c, v) for c, v in bcells}
    amap = {c - acells[0][0]: (c, v) for c, v in acells}
    n = min(max(amap) + 1, max(bmap) + 1)
    a_in = [(c, v) for off, (c, v) in sorted(amap.items()) if off < n]
    b_in = [(c, v) for off, (c, v) in sorted(bmap.items()) if off < n]
    if not a_in or not b_in:
        return None
    return {
        "n": n,
        "sum_a": sum(v for _, v in a_in),
        "sum_b": sum(v for _, v in b_in),
        "amap": amap, "bmap": bmap,
        "awb": awb, "asheet": asheet, "arow": arow,
        "bwb": bwb, "bsheet": bsheet, "brow": brow,
        "a_src": Src(file=awb.source.idx, sheet=asheet,
                     cells=a1_range(arow, a_in[0][0], arow, a_in[-1][0])),
        "b_src": Src(file=bwb.source.idx, sheet=bsheet,
                     cells=a1_range(brow, b_in[0][0], brow, b_in[-1][0])),
    }


# --------------------------------------------------------------------------
# history — a closed season, drawn under the months it actually happened in
# --------------------------------------------------------------------------

MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
             "août", "septembre", "octobre", "novembre", "décembre"]
MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july",
             "august", "september", "october", "november", "december"]
MONTH_ABBR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû",
              "Sep", "Oct", "Nov", "Déc"]


def _month_columns(sheet, declared: int | None) -> dict[int, int]:
    """{month index 0-11: column} from the sheet's own header row."""
    rows = [declared] if declared else range(1, min(sheet.rows, 40) + 1)
    for r in rows:
        if r is None or r > sheet.rows:
            continue
        found = {}
        for ci, v in enumerate(sheet.grid[r - 1] or []):
            if not isinstance(v, str):
                continue
            name = _norm(v)
            for i, (fr, en) in enumerate(zip(MONTHS_FR, MONTHS_EN)):
                if name.startswith(_norm(fr)[:4]) or name.startswith(_norm(en)[:4]):
                    found.setdefault(i, ci + 1)
                    break
        if len(found) >= 6:
            return found
    return {}


def _run_history(wbs: list[Workbook], tables, ctx, extras) -> list:
    """Rows the client keeps month by month, charted under the months they
    belong to. A season that began in July is drawn from July: reading the
    sheet's month header rather than counting from the left is the whole
    point, because the alternative silently relabels a harvest."""
    if not ctx or not getattr(ctx, "histories", None):
        return []
    blocks: list = []
    for hname, hdef in ctx.histories.items():
        target = None
        for wb in wbs:
            for name, sheet in wb.sheets.items():
                if _norm(name) == _norm(hdef.sheet):
                    target = (wb, name, sheet)
                    break
        if not target:
            continue
        wb, sname, sheet = target
        months = _month_columns(sheet, hdef.months_row)
        if not months:
            continue
        found: dict[str, dict[int, tuple[int, float]]] = {}
        rownos: dict[str, int] = {}
        for display, label in hdef.rows.items():
            for r in range(1, sheet.rows + 1):
                row = sheet.grid[r - 1] or []
                labels = [_norm(c) for c in row[:4] if isinstance(c, str)]
                if not any(_norm(label) == c for c in labels):
                    continue
                vals = {
                    m: (col, float(row[col - 1]))
                    for m, col in months.items()
                    if col <= len(row) and _is_num(row[col - 1])
                }
                if vals:
                    found[display] = vals
                    rownos[display] = r
                break
        if not found:
            continue
        # Only the months every declared row covers — a chart pairing a month
        # of one series against a different month of another is worse than a
        # shorter chart.
        span = sorted(set.intersection(*(set(v) for v in found.values())))
        if not span:
            continue
        names = list(found)[:2]
        blocks.append(
            KpiGrid(items=[
                Kpi(
                    label=Text(fr=f"{hname} · {d}", en=f"{hname} · {d}"),
                    value=Value(
                        n=round(sum(found[d][m][1] for m in span), 1),
                        unit=hdef.unit, derived="sum",
                        src=Src(file=wb.source.idx, sheet=sname,
                                cells=a1_range(rownos[d], found[d][span[0]][0],
                                               rownos[d], found[d][span[-1]][0])),
                    ),
                    sub=Text(
                        fr=f"cumul sur {len(span)} mois — {MONTH_ABBR[span[0]]} à {MONTH_ABBR[span[-1]]}",
                        en=f"total over {len(span)} months — {MONTH_ABBR[span[0]]} to {MONTH_ABBR[span[-1]]}",
                    ),
                    lineage=[
                        Step(text=Text(fr=f"Somme de « {hdef.rows[d]} » sur les mois couverts",
                                       en=f"Sum of “{hdef.rows[d]}” over the months covered"),
                             cells=f"{sname}!" + a1_range(
                                 rownos[d], found[d][span[0]][0],
                                 rownos[d], found[d][span[-1]][0]),
                             n=round(sum(found[d][m][1] for m in span), 1)),
                    ],
                )
                for d in names
            ])
        )
        if len(names) == 2:
            blocks.append(BarPair(
                title=Text(fr=hname, en=hname),
                sub=hdef.note or Text(fr="mensuel", en="monthly"),
                x=[MONTH_ABBR[m] for m in span],
                series=[
                    Series(
                        key=f"h{i}", label=Text(fr=d),
                        values=[
                            Value(n=found[d][m][1], unit=hdef.unit,
                                  src=Src(file=wb.source.idx, sheet=sname,
                                          cells=a1(rownos[d], found[d][m][0])))
                            for m in span
                        ],
                    )
                    for i, d in enumerate(names)
                ],
                fmt="n",
            ))
    return blocks


# --------------------------------------------------------------------------
# trajectory — the plan's own multi-year summary, read rather than retyped
# --------------------------------------------------------------------------

def _year_columns(sheet, declared: int | None) -> dict[int, int]:
    """{year: column} from the sheet's own header row. A row carrying three
    or more four-digit years is that header; the client may name the row
    outright when a sheet is stranger than that."""
    rows = [declared] if declared else range(1, min(sheet.rows, 40) + 1)
    for r in rows:
        if r is None or r > sheet.rows:
            continue
        found = {}
        for ci, v in enumerate(sheet.grid[r - 1] or []):
            if _is_num(v) and float(v).is_integer() and 2000 <= int(v) <= 2100:
                found[int(v)] = ci + 1
        if len(found) >= 3:
            return found
    return {}


def _run_trajectory(wbs: list[Workbook], tables, ctx, extras) -> list:
    """The plan as the client wrote it: revenue, costs and the balance they
    themselves projected, each figure pointing at the cell it came from.

    A trajectory retyped into a slide is a trajectory nobody can check —
    and the numbers most worth checking are the ones furthest out."""
    if not ctx or not getattr(ctx, "timelines", None):
        return []
    blocks: list = []
    for tname, tdef in ctx.timelines.items():
        target = None
        for wb in wbs:
            for name, sheet in wb.sheets.items():
                if _norm(name) == _norm(tdef.sheet):
                    target = (wb, name, sheet)
                    break
        if not target:
            continue
        wb, sname, sheet = target
        years = _year_columns(sheet, tdef.years_row)
        if not years:
            continue
        ordered = sorted(years)
        found: dict[str, dict[int, tuple[int, float]]] = {}
        for display, label in tdef.rows.items():
            for r in range(1, sheet.rows + 1):
                row = sheet.grid[r - 1] or []
                labels = [_norm(c) for c in row[:4] if isinstance(c, str)]
                if not any(_norm(label) == c for c in labels):
                    continue
                vals = {
                    y: (col, float(row[col - 1]))
                    for y, col in years.items()
                    if col <= len(row) and _is_num(row[col - 1])
                }
                if vals:
                    found[display] = vals
                    found.setdefault("_rows", {})[display] = r  # type: ignore
                break
        rownos = found.pop("_rows", {})  # type: ignore
        if not found:
            continue
        columns = [Column(key="item", label=Text(fr="Poste", en="Line item"),
                          align="left")]
        for y in ordered:
            columns.append(Column(key=f"y{y}", label=Text(fr=str(y)),
                                  align="right", money=tdef.unit in ("USD", "CDF")))
        out_rows = []
        for display, vals in found.items():
            row: dict = {"item": display}
            for y in ordered:
                if y in vals:
                    col, v = vals[y]
                    row[f"y{y}"] = Value(
                        n=v, unit=tdef.unit,
                        src=Src(file=wb.source.idx, sheet=sname,
                                cells=a1(rownos[display], col)),
                    )
            out_rows.append(row)
        blocks.append(Heading(
            level=3,
            label=Text(fr="Plan", en="Plan"),
            text=Text(fr=tname, en=tname),
            dek=tdef.definition or Text(
                fr=f"Trajectoire telle que le client l'a écrite dans « {sname} ».",
                en=f"The trajectory as the client wrote it in “{sname}”.",
            ),
        ))
        blocks.append(Table(columns=columns, rows=out_rows))

        drawn = [d for d in tdef.chart if d in found][:2]
        if len(drawn) == 2:
            blocks.append(BarPair(
                title=Text(fr=f"{tname} · {drawn[0]} contre {drawn[1]}",
                           en=f"{tname} · {drawn[0]} vs {drawn[1]}"),
                sub=Text(fr="par exercice", en="by year"),
                x=[str(y) for y in ordered],
                series=[
                    Series(
                        key=f"s{i}",
                        label=Text(fr=d),
                        values=[
                            Value(n=found[d][y][1], unit=tdef.unit,
                                  src=Src(file=wb.source.idx, sheet=sname,
                                          cells=a1(rownos[d], found[d][y][0])))
                            for y in ordered if y in found[d]
                        ],
                    )
                    for i, d in enumerate(drawn)
                ],
                fmt="k",
            ))
    return blocks


# --------------------------------------------------------------------------
# efficiency — the rate a plan implied, against the rate reality produced
# --------------------------------------------------------------------------

def _run_efficiency(wbs: list[Workbook], tables, ctx, extras) -> list:
    """Cost per tonne, extraction rate, yield per hectare — any rate the
    client declares as one metric over another.

    This is the module that catches what a money-only view hides. Spending
    40 % of a budget reads as comfortable until output is at 30 % of plan:
    the rate is what carries that, and neither figure alone says it."""
    if not ctx or not getattr(ctx, "ratios", None):
        return []
    metrics = ctx.metrics or {}
    blocks: list = []
    for rname, rdef in ctx.ratios.items():
        num, den = metrics.get(rdef.numerator), metrics.get(rdef.denominator)
        if not num or not den:
            continue
        an, ad = _aligned(wbs, num), _aligned(wbs, den)
        if not an or not ad:
            continue
        n = min(an["n"], ad["n"])          # compare over months both cover
        if not an["sum_a"] or not ad["sum_a"] or not ad["sum_b"]:
            continue
        scale = 100.0 if rdef.unit == "pct" else 1.0
        actual = an["sum_a"] / ad["sum_a"] * scale
        planned = an["sum_b"] / ad["sum_b"] * scale
        gap = (actual / planned - 1) * 100 if planned else 0.0
        worse = gap > 0 if rdef.lower_is_better else gap < 0
        fmt = lambda x: f"{x:,.0f}".replace(",", " ")  # noqa: E731
        num_u = "" if num.unit == "none" else f" {num.unit}"
        den_u = "" if den.unit == "none" else f" {den.unit}"
        blocks.append(
            KpiGrid(items=[Kpi(
                label=Text(fr=rname, en=rname),
                value=Value(n=round(actual, 1), unit=rdef.unit, derived="ratio",
                            src=an["a_src"]),
                sub=Text(
                    fr=(f"contre {planned:,.1f} prévu — {gap:+.0f} % sur {n} mois"
                        .replace(",", " ").replace(".", ",")),
                    en=(f"against {planned:,.1f} planned — {gap:+.0f} % over {n} months"),
                ),
                tone="bad" if worse and abs(gap) > 15 else
                     "warn" if worse else "good",
                metric=rname,
                definition=rdef.definition,
                methodology=rdef.methodology,
                lineage=[
                    Step(text=Text(
                            fr=f"{rdef.numerator} réel sur {n} mois",
                            en=f"actual {rdef.numerator} over {n} months"),
                         cells=f"{an['asheet']}!{an['a_src'].cells}",
                         n=round(an["sum_a"], 2)),
                    Step(text=Text(
                            fr=f"{rdef.denominator} réel sur les mêmes mois",
                            en=f"actual {rdef.denominator} over the same months"),
                         cells=f"{ad['asheet']}!{ad['a_src'].cells}",
                         n=round(ad["sum_a"], 2)),
                    Step(text=Text(
                            fr=f"Taux réel : {fmt(an['sum_a'])}{num_u} ÷ {fmt(ad['sum_a'])}{den_u}",
                            en=f"Actual rate: {fmt(an['sum_a'])}{num_u} ÷ {fmt(ad['sum_a'])}{den_u}"),
                         n=round(actual, 1)),
                    Step(text=Text(
                            fr=f"Taux prévu au plan : {fmt(an['sum_b'])}{num_u} ÷ {fmt(ad['sum_b'])}{den_u}",
                            en=f"Rate the plan implied: {fmt(an['sum_b'])}{num_u} ÷ {fmt(ad['sum_b'])}{den_u}"),
                         cells=f"{an['bsheet']}!{an['b_src'].cells}",
                         n=round(planned, 1)),
                    Step(text=Text(fr="Écart au plan", en="Gap to plan"),
                         n=round(gap, 1)),
                ],
            )])
        )
    return blocks


def _run_budget_actual(wbs: list[Workbook], tables, ctx, extras) -> list:
    """For each metric the context declares: align the budget and actual
    monthly series from wherever they live, compare over the months the
    actuals cover — phased budget, never the annual rate — and compute
    execution as a ratio of totals. Both defects the manual analysis found
    in the client's own reporting, encoded as the definition."""
    if not ctx or not getattr(ctx, "metrics", None):
        return []
    blocks: list = []
    for mname, mdef in ctx.metrics.items():
        al = _aligned(wbs, mdef)
        if not al:
            continue
        n, sum_a, sum_b = al["n"], al["sum_a"], al["sum_b"]
        if not sum_b:
            continue
        awb, asheet, arow = al["awb"], al["asheet"], al["arow"]
        bwb, bsheet, brow = al["bwb"], al["bsheet"], al["brow"]
        bmap, amap = al["bmap"], al["amap"]
        pct = round(sum_a / sum_b * 100, 1)
        a_range, b_range = al["a_src"].cells, al["b_src"].cells
        fmt = lambda x: f"{x:,.0f}".replace(",", " ")  # noqa: E731
        lineage = [
            Step(
                text=Text(
                    fr=f"Somme des {n} mois réels de « {mdef.actual.label} » ({awb.source.filename})",
                    en=f"Sum of the {n} actual months of “{mdef.actual.label}” ({awb.source.filename})",
                ),
                cells=f"{asheet}!{a_range}",
                n=round(sum_a, 2),
            ),
            Step(
                text=Text(
                    fr=f"Somme du budget phasé sur les {n} mêmes mois de « {mdef.budget.label} » ({bwb.source.filename}) — jamais le rythme annuel",
                    en=f"Sum of the phased budget over the same {n} months of “{mdef.budget.label}” ({bwb.source.filename}) — never the annual rate",
                ),
                cells=f"{bsheet}!{b_range}",
                n=round(sum_b, 2),
            ),
            Step(
                text=Text(
                    fr="Ratio des totaux : somme des réels ÷ somme du budget phasé — jamais moyenne des ratios",
                    en="Ratio of totals: sum of actuals ÷ sum of phased budget — never an average of ratios",
                ),
                n=pct,
            ),
        ]
        blocks.append(
            KpiGrid(
                items=[
                    Kpi(
                        label=Text(fr=f"Exécution · {mname}",
                                   en=f"Execution · {mname}"),
                        value=Value(
                            n=pct, unit="pct", derived="ratio",
                            src=Src(file=awb.source.idx, sheet=asheet,
                                    cells=a_range),
                        ),
                        sub=Text(
                            fr=f"{fmt(sum_a)} réels contre {fmt(sum_b)} de budget phasé sur {n} mois — ratio des totaux",
                            en=f"{fmt(sum_a)} actual against {fmt(sum_b)} phased budget over {n} months — ratio of totals",
                        ),
                        tone="bad" if pct > 115 else "warn" if pct < 60 else "neutral",
                        metric=mname,
                        definition=mdef.definition,
                        methodology=mdef.methodology,
                        lineage=lineage,
                    )
                ]
            )
        )
        # The chart is positional — bar i sits under month i — so each series
        # stops at its first missing month rather than sliding later months
        # under the wrong label. Fewer bars beats mislabelled ones.
        def _prefix(mapping):
            out, off = [], 0
            while off in mapping:
                out.append(mapping[off])
                off += 1
            return out

        m = min(len(_prefix(bmap)), 12)
        plan_cells = _prefix(bmap)[:m]
        act_cells = _prefix(amap)[:m]
        blocks.append(
            BarPair(
                title=Text(fr=f"{mname} · budget contre réel",
                           en=f"{mname} · budget vs actual"),
                sub=Text(fr="mensuel", en="monthly"),
                x="months",
                series=[
                    Series(
                        key="plan",
                        label=Text(fr="Budget", en="Budget"),
                        values=[
                            Value(n=v, unit=mdef.unit,
                                  src=Src(file=bwb.source.idx, sheet=bsheet,
                                          cells=a1(brow, c)))
                            for c, v in plan_cells
                        ],
                    ),
                    Series(
                        key="act",
                        label=Text(fr="Réel", en="Actual"),
                        values=[
                            Value(n=v, unit=mdef.unit,
                                  src=Src(file=awb.source.idx, sheet=asheet,
                                          cells=a1(arow, c)))
                            for c, v in act_cells
                        ],
                    ),
                ],
                cutoff=len(act_cells),
                fmt="k",
            )
        )
    return blocks


# --------------------------------------------------------------------------
# coverage — every journal entry must carry the code that routes it
# --------------------------------------------------------------------------

def _run_coverage(wbs: list[Workbook], tables, ctx, extras) -> list:
    """Routing coverage. In a coded cash journal, the code column is what
    sends each entry to the ledger and on into OPEX or CAPEX — an entry
    without a code is money that cannot land anywhere yet. This module
    counts them per journal and lists them, each line pointing at its cell,
    so 'waiting on documentation' becomes a worklist instead of a feeling.

    Which sheets are journals comes from context.reconcile_sheets; the code
    column's header from context.journal_code_column (default: 'code').
    Balance columns (solde/balance) are never cited as amounts."""
    if not ctx or not ctx.reconcile_sheets:
        return []
    code_name = _norm(getattr(ctx, "journal_code_column", None) or "code")
    wanted = {_norm(s) for s in ctx.reconcile_sheets}
    kpis: list[Kpi] = []
    uncoded_rows: list[dict] = []
    total_missing = 0
    for idx, t in tables:
        if _norm(t.sheet) not in wanted:
            continue
        wb = wbs[idx]
        sheet = wb[t.sheet]
        code_col = next(
            (c for c in t.columns if _norm(c.label) == code_name), None
        )
        if not code_col:
            continue
        num_cols = [
            c for c in t.columns
            if c.kind == "number" and c.index != code_col.index
            and "solde" not in _norm(c.label) and "balance" not in _norm(c.label)
        ]
        text_cols = [
            c for c in t.columns
            if c.kind == "text" and c.index != code_col.index
        ]
        if not num_cols:
            continue
        checked = missing = 0
        sums: dict[str, float] = {}  # per unit — CDF and USD never add up
        for r in range(t.first_row, t.last_row + 1):
            amts = [
                (c.index, float(sheet.cell(r, c.index)))
                for c in num_cols
                if _is_num(sheet.cell(r, c.index))
                and abs(float(sheet.cell(r, c.index))) >= 1
            ]
            if not amts:
                continue
            checked += 1
            code = sheet.cell(r, code_col.index)
            if code is not None and str(code).strip():
                continue
            missing += 1
            ci, v = amts[0]
            u = _unit_for(next(c.label for c in num_cols if c.index == ci), ctx)
            sums[u] = sums.get(u, 0.0) + v
            if len(uncoded_rows) < MAX_RECON_ROWS:
                # the most descriptive text cell — a libellé, not a date
                texts = [
                    str(sheet.cell(r, c.index)).strip() for c in text_cols
                    if isinstance(sheet.cell(r, c.index), str)
                    and str(sheet.cell(r, c.index)).strip()
                ]
                label = max(texts, key=len, default="—")
                uncoded_rows.append(
                    {
                        "entry": label[:60],
                        "amount": Value(
                            n=v, unit=_unit_for(
                                next(c.label for c in num_cols if c.index == ci),
                                ctx),
                            src=Src(file=wb.source.idx, sheet=t.sheet,
                                    cells=a1(r, ci)),
                        ),
                        "code": f"{t.sheet}!{a1(r, code_col.index)}",
                    }
                )
        if not checked:
            continue
        total_missing += missing
        code_range = a1_range(t.first_row, code_col.index,
                              t.last_row, code_col.index)
        amounts = " + ".join(
            f"{s:,.0f}".replace(",", " ") + ("" if u == "none" else f" {u}")
            for u, s in sorted(sums.items())
        ) or "0"
        kpis.append(
            Kpi(
                label=Text(fr=f"Écritures sans code · {t.sheet}",
                           en=f"Uncoded entries · {t.sheet}"),
                value=Value(n=missing, unit="count", derived="sum",
                            src=Src(file=wb.source.idx, sheet=t.sheet,
                                    cells=code_range)),
                sub=Text(
                    fr=f"sur {checked} écritures — {amounts} non routés vers OPEX/CAPEX",
                    en=f"of {checked} entries — {amounts} not routed to OPEX/CAPEX",
                ),
                tone="good" if missing == 0 else "warn",
                lineage=[
                    Step(text=Text(fr=f"Écritures avec un montant dans « {t.sheet} » (colonnes de solde exclues)",
                                   en=f"Entries carrying an amount in “{t.sheet}” (balance columns excluded)"),
                         n=checked),
                    Step(text=Text(fr=f"Dont cellule « {code_col.label} » vide — non routées",
                                   en=f"Of which the “{code_col.label}” cell is empty — unrouted"),
                         cells=f"{t.sheet}!{code_range}", n=missing),
                ],
            )
        )
    if not kpis:
        return []
    blocks: list = [KpiGrid(items=kpis)]
    if total_missing:
        blocks.append(
            Flag(
                severity="warn",
                tag=Text(fr="Couverture des codes", en="Code coverage"),
                title=Text(
                    fr=f"{total_missing} écriture(s) sans code de routage — la liste à apurer avec la comptabilité",
                    en=f"{total_missing} entrie(s) without a routing code — the worklist to clear with accounting",
                ),
                body=Text(
                    fr="Sans code, une écriture n'atteint ni le grand livre ni les coûts de production : les totaux OPEX/CAPEX sont incomplets d'autant.",
                    en="Without a code, an entry reaches neither the ledger nor production costs: OPEX/CAPEX totals are short by that much.",
                ),
            )
        )
        blocks.append(
            Table(
                columns=[
                    {"key": "entry", "label": Text(fr="Écriture", en="Entry"),
                     "align": "left"},
                    {"key": "amount", "label": Text(fr="Montant", en="Amount"),
                     "align": "right"},
                    {"key": "code", "label": Text(fr="Code attendu en",
                                                  en="Code expected at"),
                     "align": "right"},
                ],
                rows=uncoded_rows,
            )
        )
    return blocks


# --------------------------------------------------------------------------
# narrate — code computes, this layer speaks
# --------------------------------------------------------------------------

def _facts_from_blocks(blocks: list) -> list[tuple[str, str]]:
    """Sentences already carrying their numbers, lifted from the computing
    modules' blocks. Narration never computes; it restates."""
    facts: list[tuple[str, str]] = []
    for b in blocks:
        kind = getattr(b, "type", None)
        if kind == "kpiGrid":
            for k in b.items:
                unit = " %" if k.value.unit == "pct" else ""
                n_fr = f"{k.value.n:g}".replace(".", ",")
                fr = f"{k.label.fr} s'établit à {n_fr}{unit}"
                en = f"{k.label.get('en')} stands at {k.value.n:g}{unit}"
                if k.sub:
                    fr += f" ({k.sub.fr})"
                    en += f" ({k.sub.get('en')})"
                facts.append((fr + ".", en + "."))
        elif kind == "flag":
            facts.append(
                (f"{b.tag.fr} : {b.title.fr}.",
                 f"{b.tag.get('en')}: {b.title.get('en')}.")
            )
    return facts


_NUM_RE = re.compile(r"\d(?:[\d  .,]*\d)?")


def _numbers_in(text: str) -> set[str]:
    """Digit groups, spacing and separators stripped — '44 624' == '44624'."""
    return {re.sub(r"[^\d]", "", m) for m in _NUM_RE.findall(text)}


def _llm_polish(facts: list[tuple[str, str]]) -> tuple[str, str] | None:
    """Optional: ask Claude to turn the fact sentences into flowing analyst
    prose. Gated on ANTHROPIC_API_KEY being present in the environment; any
    failure — network, refusal, invented figures — falls back to the
    template. The model may rephrase; it may not add or alter a number."""
    import json
    import os

    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import httpx

        model = os.environ.get("LUMNIA_NARRATE_MODEL", "claude-opus-5")
        facts_fr = "\n".join(f"- {fr}" for fr, _ in facts)
        facts_en = "\n".join(f"- {en}" for _, en in facts)
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 1024,
                "system": (
                    "You write the narrative paragraph of a verified financial "
                    "report. You receive computed facts; every number in them "
                    "is final. Reuse each number EXACTLY as written — same "
                    "digits, same grouping. Never introduce a figure that is "
                    "not in the facts, never total, never estimate. Respond "
                    "with a JSON object {\"fr\": \"...\", \"en\": \"...\"}: "
                    "one short professional paragraph per language, nothing "
                    "else."
                ),
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Faits (français):\n{facts_fr}\n\n"
                            f"Facts (English):\n{facts_en}"
                        ),
                    }
                ],
            },
            timeout=25.0,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        if data.get("stop_reason") == "refusal":
            return None
        text = "".join(
            p.get("text", "") for p in data.get("content", [])
            if p.get("type") == "text"
        ).strip()
        if text.startswith("```"):
            text = text.strip("`").removeprefix("json").strip()
        out = json.loads(text)
        fr, en = str(out["fr"]), str(out["en"])
        # The guardrail: the prose must carry exactly the numbers the facts
        # carry — none dropped, none invented.
        if (
            _numbers_in(fr) != _numbers_in(facts_fr)
            or _numbers_in(en) != _numbers_in(facts_en)
        ):
            return None
        return fr, en
    except Exception:
        return None


def _run_narrate(wbs: list[Workbook], tables, ctx, extras) -> list:
    """Narrates what the other modules computed this ingest — nothing more.
    Deterministic templates by default; a Claude rewrite when the API key is
    present, with every number checked verbatim against the facts. Runs last
    whatever order the context lists it in."""
    facts = _facts_from_blocks(extras.get("blocks") or [])
    if not facts:
        return []
    polished = _llm_polish(facts)
    if polished:
        fr, en = polished
    else:
        fr = "Lecture — " + " ".join(f for f, _ in facts)
        en = "Reading — " + " ".join(e for _, e in facts)
    return [
        Heading(
            level=3,
            label=Text(fr="Narration", en="Narration"),
            text=Text(fr="Lecture des résultats", en="Reading the results"),
            dek=Text(
                fr="Le code calcule ; cette section raconte. Chaque chiffre reprend un résultat calculé ci-dessus.",
                en="Code computes; this section speaks. Every figure restates a computed result above.",
            ),
        ),
        Prose(text=Text(fr=fr, en=en)),
    ]


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
            name="budget-vs-actual",
            version="1.0",
            description_fr="Compare les séries mensuelles budget et réel déclarées dans le contexte (metrics), sur budget phasé, en ratio des totaux — même entre deux classeurs.",
            description_en="Compares the budget and actual monthly series the context declares (metrics), against phased budget, as a ratio of totals — even across two workbooks.",
            run=_run_budget_actual,
        ),
        Module(
            name="reconciliation",
            version="1.0",
            description_fr="Écritures à même date et même montant dans deux journaux : le même argent compté deux fois.",
            description_en="Entries with the same date and amount in two journals: the same money counted twice.",
            run=_run_reconciliation,
        ),
        Module(
            name="history",
            version="1.0",
            description_fr="Séries mensuelles déjà closes — une campagne passée — tracées sous les mois où elles ont eu lieu, d'après l'en-tête de la feuille.",
            description_en="Closed monthly series — a past season — drawn under the months they happened in, from the sheet's own header.",
            run=_run_history,
        ),
        Module(
            name="trajectory",
            version="1.0",
            description_fr="La trajectoire pluriannuelle telle que le client l'a écrite — revenus, charges, solde — lue dans sa propre feuille de synthèse, chaque chiffre pointant sa cellule.",
            description_en="The multi-year trajectory as the client wrote it — revenue, costs, balance — read from their own summary sheet, every figure pointing at its cell.",
            run=_run_trajectory,
        ),
        Module(
            name="efficiency",
            version="1.0",
            description_fr="Taux déclarés entre deux métriques — coût par tonne, taux d'extraction — comparés au taux que le plan impliquait sur les mêmes mois.",
            description_en="Declared rates between two metrics — cost per tonne, extraction rate — against the rate the plan implied over the same months.",
            run=_run_efficiency,
        ),
        Module(
            name="coverage",
            version="1.0",
            description_fr="Écritures de journal sans code de routage : l'argent qui n'atteint ni le grand livre ni OPEX/CAPEX, listé cellule par cellule.",
            description_en="Journal entries without a routing code: money reaching neither the ledger nor OPEX/CAPEX, listed cell by cell.",
            run=_run_coverage,
        ),
        Module(
            name="narrate",
            version="1.0",
            description_fr="Raconte en prose ce que les autres modules ont calculé — chaque chiffre repris tel quel, jamais inventé. Relecture Claude optionnelle.",
            description_en="Narrates in prose what the other modules computed — every figure restated verbatim, never invented. Optional Claude polish.",
            run=_run_narrate,
        ),
    ]
}

DEFAULT_MODULES = ["movements"]


def facts_of(blocks: list) -> list[dict]:
    """The numeric facts a run produced, compact enough to store: what the
    timeline trends from version to version of the client's file."""
    out: list[dict] = []
    for b in blocks:
        kind = getattr(b, "type", None)
        if kind == "kpiGrid":
            for k in b.items:
                out.append({"label": k.label.fr, "n": k.value.n,
                            "unit": k.value.unit, "tone": k.tone})
        elif kind == "flag":
            out.append({"label": b.tag.fr, "title": b.title.fr})
    return out


def run_modules(names: list[str], wbs: list[Workbook], tables, ctx, extras) -> tuple[list, list[str]]:
    """Run the named modules in order; returns (blocks, attribution).

    `narrate` always goes last, whatever order the context lists: it speaks
    about what the others computed, so it must see their blocks — passed to
    every module as extras["blocks"], the output accumulated so far."""
    ordered = [n for n in names if n != "narrate"]
    if "narrate" in names:
        ordered.append("narrate")
    blocks: list = []
    ran: list[str] = []
    for name in ordered:
        mod = MODULES.get(name)
        if not mod:
            continue
        out = mod.run(wbs, tables, ctx, {**extras, "blocks": blocks})
        if out:
            blocks.extend(out)
            ran.append(f"{mod.name} v{mod.version}")
    return blocks, ran
