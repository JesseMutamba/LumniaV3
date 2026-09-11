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

def _filtered_inputs(wbs, tables, ctx):
    from dataclasses import replace
    ignored = {_norm(x) for x in (ctx.ignore_sheets if ctx else [])}
    excluded = {_norm(x) for x in (ctx.exclude_labels if ctx else [])}
    cleaned = []
    for wb in wbs:
        sheets = {}
        for name, sheet in wb.sheets.items():
            if _norm(name) in ignored:
                continue
            grid = [([None] * len(row) if any(isinstance(v, str) and _norm(v) in excluded for v in row) else list(row)) for row in sheet.grid]
            sheets[name] = replace(sheet, grid=grid)
        cleaned.append(replace(wb, sheets=sheets))
    return cleaned, [(idx, t) for idx, t in tables if t.sheet in cleaned[idx].sheets]



def _month_identity(value):
    from datetime import date, datetime
    import re, unicodedata
    if isinstance(value, (date, datetime)):
        return value.month - 1, value.year
    if not isinstance(value, str):
        return None
    text = ''.join(c for c in unicodedata.normalize('NFD', value.strip().lower()) if unicodedata.category(c) != 'Mn')
    iso = re.fullmatch(r'(20\d{2})[-/](0?[1-9]|1[0-2])(?:[-/]\d{1,2})?', text)
    if iso:
        return int(iso[2]) - 1, int(iso[1])
    prefixes = ('jan', 'feb|fev', 'mar', 'apr|avr', 'may|mai', 'jun|juin', 'jul|juil', 'aug|aou', 'sep', 'oct', 'nov', 'dec')
    for month, prefix in enumerate(prefixes):
        if re.match(r'^(?:' + prefix + r')[a-z]*\.?\s*(?:[-/]?\s*(?:20\d{2}|\d{2}))?$', text):
            year = re.search(r'20\d{2}', text)
            return month, int(year[0]) if year else None
    return None



def _calendar_header(sheet, before_row):
    """Nearest usable month header before the selected measure, not the first
    numeric cell. A repeated month in one header is ambiguous and rejected."""
    import re
    for rowno in range(before_row - 1, 0, -1):
        row = sheet.grid[rowno - 1]
        identified = [(ci + 1, _month_identity(v)) for ci, v in enumerate(row)]
        identified = [(ci, period) for ci, period in identified if period is not None]
        if len(identified) < 2:
            continue
        months = [period[0] for _, period in identified]
        if len(months) != len(set(months)):
            return None
        # Use a nearby explicit year only when it is unambiguous. Never
        # rewrite conflicting dates: alignment emits a visible review flag.
        year = None
        for title_row in reversed(sheet.grid[max(0, rowno - 4):rowno]):
            years = {int(y) for v in title_row if v is not None for y in re.findall(r'\b20\d{2}\b', str(v))}
            if len(years) == 1:
                year = next(iter(years)); break
        return {month: (column, explicit_year or year) for column, (month, explicit_year) in identified}
    return None



def _alignment_subset(al, months):
    months = sorted(set(months) & set(al['amap']) & set(al['bmap']))
    if not months:
        return None
    result = dict(al)
    result.update(months=months, n=len(months),
                  sum_a=sum(al['amap'][m][1] for m in months),
                  sum_b=sum(al['bmap'][m][1] for m in months))
    for prefix in ('a', 'b'):
        cells = [al[prefix + 'map'][m][0] for m in months]
        result[prefix + '_src'] = Src(file=al[prefix + 'wb'].source.idx,
                                     sheet=al[prefix + 'sheet'],
                                     cells=a1_range(al[prefix + 'row'], min(cells), al[prefix + 'row'], max(cells)))
    return result



def _period_review(al, name):
    if not al.get('year_mismatch'):
        return []
    return [Flag(severity='blocked', tag=Text(fr='Périodes à vérifier', en='Periods require review'),
                 title=Text(fr=f'{name} : années différentes', en=f'{name}: source years differ'),
                 body=Text(fr=f"Budget {al['budget_years']} ; réel {al['actual_years']}. La comparaison ci-dessous utilise les mois explicitement associés par la définition client et reste non vérifiée jusqu’à correction des dates.",
                           en=f"Budget {al['budget_years']}; actual {al['actual_years']}. The comparison below uses the months explicitly paired by the client definition and is unverified until the source years are reconciled."))]



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

def _date_amount_rows(wb, t, ctx=None):
    """Outgoing payments (or explicit amount columns), not balances, receipts,
    identifiers or mixed currencies. Each returned row is only a candidate."""
    from datetime import date, datetime
    import unicodedata
    def norm(s):
        return ''.join(c for c in unicodedata.normalize('NFD',_norm(s)) if unicodedata.category(c)!='Mn')
    sheet=wb[t.sheet]
    date_col=next((c for c in range(1,max((len(r) for r in sheet.grid),default=0)+1)
                   if sum(isinstance(sheet.cell(r,c),(date,datetime)) for r in range(t.first_row,t.last_row+1))>=1),None)
    if date_col is None:
        return []
    cols=[]
    for col in t.columns:
        label=norm(col.label)
        unit=_unit_for(col.label,ctx)
        if col.kind!='number' or unit not in ('USD','CDF') or any(s in label for s in ('solde','balance','code','piece','reference','entree','receipt','inflow')):
            continue
        if not any(s in label for s in ('sortie','payment','outflow','depense','montant','amount','paid')):
            continue
        cols.append((col.index,unit))
    out=[]
    for r in range(t.first_row,t.last_row+1):
        day=sheet.cell(r,date_col)
        if not isinstance(day,(date,datetime)):
            continue
        day=day.date() if isinstance(day,datetime) else day
        for col,unit in cols:
            amount=sheet.cell(r,col)
            if _is_num(amount) and amount!=0:
                out.append((day,round(float(amount),2),unit,r,col,t.sheet))
    return out



def _run_reconciliation(wbs,tables,ctx,extras):
    from collections import defaultdict,deque
    wanted={_norm(s) for s in (ctx.reconcile_sheets if ctx else [])}
    journals=[(idx,t,_date_amount_rows(wbs[idx],t,ctx)) for idx,t in tables if not wanted or _norm(t.sheet) in wanted]
    matches=[]
    for i,(fa,ta,a) in enumerate(journals):
        for fb,tb,b in journals[i+1:]:
            if fa==fb and ta.sheet==tb.sheet:
                continue
            pool=defaultdict(deque)
            for day,amt,unit,row,col,sh in a:
                pool[(day,amt,unit)].append((row,col,sh))
            for day,amt,unit,row,col,sh in b:
                q=pool[(day,amt,unit)]
                if not q:
                    continue
                ra,ca,sha=q.popleft()
                matches.append((day,amt,unit,(fa,sha,ra,ca),(fb,sh,row,col)))
    if not matches:
        return []
    totals=defaultdict(float)
    for _,amt,unit,_,_ in matches:
        totals[unit]+=amt
    total_text=' + '.join(f'{v:,.0f} {u}'.replace(',',' ') for u,v in sorted(totals.items()))
    rows=[]
    for day,amt,unit,(fa,sha,ra,ca),(fb,shb,rb,cb) in matches[:MAX_RECON_ROWS]:
        rows.append({'date':str(day),'amount':Value(n=amt,unit=unit,src=Src(file=wbs[fa].source.idx,sheet=sha,cells=a1(ra,ca))),
                     'also':f'{wbs[fb].source.filename} · {shb}!{a1(rb,cb)}'})
    return [Flag(severity='warn',tag=Text(fr='Rapprochement',en='Reconciliation'),
                 title=Text(fr=f'{len(matches)} écriture(s) candidates dans deux journaux — {total_text}',en=f'{len(matches)} candidate entries across two journals — {total_text}'),
                 body=Text(fr='Même date, même montant signé et même devise. Ces correspondances sont des pistes de rapprochement, pas des doublons confirmés. Vérifiez les références avant toute exclusion ; aucun montant n’est déduit.',en='Same date, signed amount and currency. These are reconciliation candidates, not confirmed duplicate payments. Verify transaction references before excluding an entry; nothing is deducted.')),
            Table(columns=[{'key':'date','label':Text(fr='Date',en='Date'),'align':'left'},
                           {'key':'amount','label':Text(fr='Montant',en='Amount'),'align':'right'},
                           {'key':'also','label':Text(fr='Aussi dans',en='Also in'),'align':'left'}],rows=rows)]



# --------------------------------------------------------------------------
# budget-vs-actual — the phased comparison, across files
# --------------------------------------------------------------------------

def _find_series(wbs, sd):
    """Keep original cell positions. Calendar headers, not coincidental
    numeric equality, decide which cells are months and which are totals."""
    exact, loose = [], []
    for wb in wbs:
        for name, sheet in wb.sheets.items():
            if _norm(name) != _norm(sd.sheet):
                continue
            for r, row in enumerate(sheet.grid, 1):
                labels = [_norm(v) for v in row[:4] if isinstance(v, str)]
                if not any(_norm(sd.label) in label for label in labels):
                    continue
                cells = [(ci + 1, float(v)) for ci, v in enumerate(row) if _is_num(v)][sd.skip:]
                if not cells:
                    continue
                target = exact if _norm(sd.label) in labels else loose
                target.append((wb, name, r, cells))
    matches = exact or loose
    # An ambiguous same-named measure must not silently select a workbook.
    return matches[0] if matches else None



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


def _aligned(wbs, mdef):
    b, a = _find_series(wbs, mdef.budget), _find_series(wbs, mdef.actual)
    if not b or not a:
        return None
    bwb, bsheet, brow, bcells = b
    awb, asheet, arow, acells = a
    bh = _calendar_header(bwb[bsheet], brow)
    ah = _calendar_header(awb[asheet], arow)
    if not bh or not ah:
        return None
    bv, av = dict(bcells), dict(acells)
    bmap = {m: (c, bv[c]) for m, (c, _) in bh.items() if c in bv}
    amap = {m: (c, av[c]) for m, (c, _) in ah.items() if c in av}
    common = sorted(set(amap) & set(bmap))
    if not common:
        return None
    mismatch = [m for m in common if ah[m][1] and bh[m][1] and ah[m][1] != bh[m][1]]
    out = dict(amap=amap, bmap=bmap, awb=awb, asheet=asheet, arow=arow,
               bwb=bwb, bsheet=bsheet, brow=brow, months=common,
               chart_months=sorted(set(ah) | set(bh)),
               year_mismatch=mismatch,
               actual_years=sorted({y for _, y in ah.values() if y}),
               budget_years=sorted({y for _, y in bh.values() if y}),
               missing_months=sorted((set(ah) | set(bh)) - set(common)))
    return _alignment_subset(out, common)



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
                            if y in found[d] else None
                            for y in ordered
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

def _run_efficiency(wbs, tables, ctx, extras):
    if not ctx or not ctx.ratios:
        return []
    blocks = []
    for name, rdef in ctx.ratios.items():
        num, den = ctx.metrics.get(rdef.numerator), ctx.metrics.get(rdef.denominator)
        if not num or not den:
            continue
        an, ad = _aligned(wbs,num), _aligned(wbs,den)
        if not an or not ad:
            continue
        common = sorted(set(an['months']) & set(ad['months']))
        an, ad = _alignment_subset(an,common), _alignment_subset(ad,common)
        if not an or not ad or not ad['sum_a'] or not ad['sum_b']:
            continue
        scale = 100.0 if rdef.unit == 'pct' else 1.0
        actual, planned = an['sum_a']/ad['sum_a']*scale, an['sum_b']/ad['sum_b']*scale
        gap = (actual/planned-1)*100 if planned else None
        worse = gap is not None and (gap > 0 if rdef.lower_is_better else gap < 0)
        cross_years = any(an[key] and ad[key] and an[key] != ad[key] for key in ('actual_years','budget_years'))
        mismatch = bool(an['year_mismatch'] or ad['year_mismatch'] or cross_years)
        blocks += _period_review(an,name) or _period_review(ad,name)
        if cross_years:
            blocks.append(Flag(severity='blocked',tag=Text(fr='Périodes à vérifier',en='Periods require review'),title=Text(fr=f'{name} : années différentes entre mesures',en=f'{name}: measure years differ'),body=Text(fr='Les mesures du numérateur et du dénominateur indiquent des années différentes. Le ratio reste non vérifié.',en='The numerator and denominator measures indicate different years. This ratio is unverified.')))
        prefix_fr, prefix_en = ('NON VÉRIFIÉ · ','UNVERIFIED · ') if mismatch else ('','')
        gap_fr = f'{gap:+.0f} %' if gap is not None else 'écart indéfini (plan nul)'
        gap_en = f'{gap:+.0f} %' if gap is not None else 'gap undefined (zero plan)'
        steps = [Step(text=Text(fr=f'{rdef.numerator} réel sur {len(common)} mois communs', en=f'Actual {rdef.numerator} over {len(common)} common months'), cells=f"{an['asheet']}!{an['a_src'].cells}",n=round(an['sum_a'],2)),
                 Step(text=Text(fr=f'{rdef.denominator} réel sur les mêmes mois', en=f'Actual {rdef.denominator} over the same months'), cells=f"{ad['asheet']}!{ad['a_src'].cells}",n=round(ad['sum_a'],2)),
                 Step(text=Text(fr='Ratio réel',en='Actual ratio'),n=round(actual,1)),
                 Step(text=Text(fr='Ratio du plan sur les mêmes mois',en='Planned ratio over the same months'),cells=f"{an['bsheet']}!{an['b_src'].cells}",n=round(planned,1)),
                 Step(text=Text(fr='Écart au plan',en='Gap to plan'),n=round(gap,1) if gap is not None else None)]
        blocks.append(KpiGrid(items=[Kpi(label=Text(fr=name,en=name),value=Value(n=round(actual,1),unit=rdef.unit,derived='ratio',src=an['a_src']),
            sub=Text(fr=f'{prefix_fr}contre {planned:,.1f} prévu — {gap_fr} sur {len(common)} mois communs', en=f'{prefix_en}against {planned:,.1f} planned — {gap_en} over {len(common)} common months'),
            tone='warn' if mismatch or gap is None else 'bad' if worse and abs(gap)>15 else 'warn' if worse else 'good',
            metric=name,definition=rdef.definition,methodology=rdef.methodology,lineage=steps)]))
    return blocks



def _run_budget_actual(wbs, tables, ctx, extras):
    if not ctx or not ctx.metrics:
        return []
    blocks = []
    months_fr = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
    for name, mdef in ctx.metrics.items():
        al = _aligned(wbs, mdef)
        if not al or not al['sum_b']:
            blocks.append(Flag(severity='warn', tag=Text(fr='Comparaison indisponible', en='Comparison unavailable'),
                               title=Text(fr=name, en=name), body=Text(fr='Vérifiez les lignes, les en-têtes de mois et le budget. Aucune valeur manquante n’est remplacée par zéro.', en='Review the measure rows, month headers, and budget. Missing values are not replaced with zero.')))
            continue
        blocks += _period_review(al, name)
        n, sa, sb = al['n'], al['sum_a'], al['sum_b']
        pct = round(sa / sb * 100, 1)
        selected = ', '.join(months_fr[m] for m in al['months'])
        status_fr = 'NON VÉRIFIÉ · ' if al['year_mismatch'] else ''
        status_en = 'UNVERIFIED · ' if al['year_mismatch'] else ''
        blocks.append(KpiGrid(items=[Kpi(label=Text(fr=f'Exécution · {name}', en=f'Execution · {name}'),
            value=Value(n=pct, unit='pct', src=al['a_src'], derived='ratio'),
            sub=Text(fr=f'{status_fr}{sa:,.0f} réels contre {sb:,.0f} de budget phasé sur {n} mois observés — {selected}',
                     en=f'{status_en}{sa:,.0f} actual against {sb:,.0f} phased budget over {n} observed months — {selected}'),
            tone='warn' if al['year_mismatch'] else 'bad' if pct > 115 else 'warn' if pct < 60 else 'neutral',
            metric=name, definition=mdef.definition, methodology=mdef.methodology,
            lineage=[Step(text=Text(fr=f'Réels : {selected}', en=f'Actuals for selected months: {selected}'), cells=f"{al['asheet']}!{al['a_src'].cells}", n=round(sa,2)),
                     Step(text=Text(fr=f'Budget phasé : {selected}', en=f'Phased budget for the same months: {selected}'), cells=f"{al['bsheet']}!{al['b_src'].cells}", n=round(sb,2)),
                     Step(text=Text(fr='Ratio des totaux', en='Ratio of totals'), n=pct)])]))
        if al['missing_months']:
            blocks.append(Flag(severity='warn', tag=Text(fr='Mois incomplets', en='Incomplete months'),
                               title=Text(fr=f'{name} : comparaison limitée aux observations communes', en=f'{name}: comparison uses common observed months'),
                               body=Text(fr='Les cellules manquantes restent manquantes. Elles sont exclues du ratio et représentées par des espaces dans le graphique.', en='Missing cells remain missing. They are excluded from the ratio and remain gaps in the chart.')))
        span = al['chart_months']
        series = []
        for prefix, key, fr, en in [('b','plan','Budget','Budget'), ('a','act','Réel','Actual')]:
            values = [Value(n=al[prefix+'map'][m][1], unit=mdef.unit,
                            src=Src(file=al[prefix+'wb'].source.idx, sheet=al[prefix+'sheet'], cells=a1(al[prefix+'row'],al[prefix+'map'][m][0])))
                      if m in al[prefix+'map'] else None for m in span]
            # Trailing missing months need no padding; internal holes retain
            # their index. This preserves existing complete-series payloads.
            while values and values[-1] is None:
                values.pop()
            series.append(Series(key=key,label=Text(fr=fr,en=en),values=values))
        blocks.append(BarPair(title=Text(fr=f'{status_fr}{name} · budget contre réel', en=f'{status_en}{name} · budget vs actual'),
                              sub=Text(fr='mensuel', en='monthly'), x=[months_fr[m] for m in span], series=series,
                              cutoff=len(series[1].values),fmt='k'))
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


def _llm_polish(facts):
    """Optional editorial ordering only. Whole computed fact statements are
    immutable; a model cannot alter digits, signs, units, or metric binding."""
    import os,json
    key=os.environ.get('ANTHROPIC_API_KEY')
    if not key or not facts:
        return None
    try:
        import httpx
        menu=[{'id':i,'fr':fr,'en':en} for i,(fr,en) in enumerate(facts)]
        response=httpx.post('https://api.anthropic.com/v1/messages',
            headers={'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
            json={'model':os.environ.get('LUMNIA_NARRATE_MODEL','claude-opus-5'),'max_tokens':512,
                  'system':'Order the supplied immutable financial fact statements into a clear narrative. Return ONLY JSON {"order":[integer ids]}. Every supplied id must appear exactly once. Never write or modify a statement.',
                  'messages':[{'role':'user','content':json.dumps(menu,ensure_ascii=False)}]},timeout=25.0)
        if response.status_code!=200:
            return None
        data=response.json()
        if data.get('stop_reason')=='refusal':
            return None
        text=''.join(p.get('text','') for p in data.get('content',[]) if p.get('type')=='text').strip()
        if text.startswith('```'):
            text=text.strip('`').removeprefix('json').strip()
        payload=json.loads(text)
        if not isinstance(payload,dict) or set(payload)!={'order'}:
            return None
        order=payload['order']
        if not isinstance(order,list) or any(type(i) is not int for i in order) or sorted(order)!=list(range(len(facts))):
            return None
        return ' '.join(facts[i][0] for i in order),' '.join(facts[i][1] for i in order)
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
    wbs, tables = _filtered_inputs(wbs, tables, ctx)
    ordered = list(dict.fromkeys(n for n in names if n != "narrate"))
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
