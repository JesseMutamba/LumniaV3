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
    automatically."""
    for wb in wbs:
        for name, sheet in wb.sheets.items():
            if _norm(name) != _norm(sd.sheet):
                continue
            for r in range(1, sheet.rows + 1):
                row = sheet.grid[r - 1] or []
                if not any(
                    isinstance(c, str) and _norm(sd.label) in _norm(c)
                    for c in row[:4]
                    if isinstance(c, str)
                ):
                    continue
                cells = [
                    (ci + 1, float(v)) for ci, v in enumerate(row) if _is_num(v)
                ]
                cells = _trim_totals(cells[sd.skip:])
                if cells:
                    return wb, name, r, cells
    return None


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
        found_b = _find_series(wbs, mdef.budget)
        found_a = _find_series(wbs, mdef.actual)
        if not found_b or not found_a:
            continue
        bwb, bsheet, brow, bcells = found_b
        awb, asheet, arow, acells = found_a
        n = min(len(acells), len(bcells))
        if n == 0:
            continue
        sum_a = sum(v for _, v in acells[:n])
        sum_b = sum(v for _, v in bcells[:n])
        if not sum_b:
            continue
        pct = round(sum_a / sum_b * 100, 1)
        a_range = a1_range(arow, acells[0][0], arow, acells[n - 1][0])
        fmt = lambda x: f"{x:,.0f}".replace(",", " ")  # noqa: E731
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
                    )
                ]
            )
        )
        m = min(len(bcells), 12)
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
                            for c, v in bcells[:m]
                        ],
                    ),
                    Series(
                        key="act",
                        label=Text(fr="Réel", en="Actual"),
                        values=[
                            Value(n=v, unit=mdef.unit,
                                  src=Src(file=awb.source.idx, sheet=asheet,
                                          cells=a1(arow, c)))
                            for c, v in acells[:min(len(acells), m)]
                        ],
                    ),
                ],
                cutoff=min(n, m),
                fmt="k",
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
            name="narrate",
            version="1.0",
            description_fr="Raconte en prose ce que les autres modules ont calculé — chaque chiffre repris tel quel, jamais inventé. Relecture Claude optionnelle.",
            description_en="Narrates in prose what the other modules computed — every figure restated verbatim, never invented. Optional Claude polish.",
            run=_run_narrate,
        ),
    ]
}

DEFAULT_MODULES = ["movements"]


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
