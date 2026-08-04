"""The golden set — the numbers this platform is not allowed to get wrong.

Every case here is a defect found in real client books, reduced to the
smallest workbook that still exhibits it, with the answer worked out by
hand in the test rather than taken from the code. A change that moves one
of these numbers fails the build. That is the point: the product's claim is
that its figures can be trusted, and a claim without a gate is a slogan.

The real client workbooks are not in this repository and never will be —
private financial data does not belong in a public repo. What is encoded
here is their *shape*: the annual total sitting at both ends of a budget
row, the balance column that must never be summed as an amount, the same
payment written into two journals. The exact figures those books produce
are asserted in `test_real_books.py`, which skips unless the files are
present on the machine running it.
"""
from __future__ import annotations

import io

import pytest

from app.pipeline.ingest import read_workbook
from app.pipeline.modules import run_modules
from app.pipeline.parse import detect_tables
from app.schema import ContextIn
from conftest import xlsx


def _run(sheets_per_file: list[dict], ctx: ContextIn, tmp_path):
    wbs = []
    for i, sheets in enumerate(sheets_per_file):
        p = tmp_path / f"wb{i}.xlsx"
        p.write_bytes(xlsx(sheets))
        wbs.append(read_workbook(p, idx=i))
    tables = []
    for wb in wbs:
        tables += [(wb.source.idx, t) for t in detect_tables(wb, ctx)]
    blocks, ran = run_modules(ctx.modules, wbs, tables, ctx, {})
    return blocks, ran


def _kpis(blocks):
    return [k for b in blocks if getattr(b, "type", "") == "kpiGrid" for k in b.items]


# --------------------------------------------------------------------------
# G1–G3 · budget vs actual: the two defects the manual analysis caught
# --------------------------------------------------------------------------

# A budget row as the real book writes it: the annual figure appears BEFORE
# the months and again AFTER them. Both must be dropped, or execution reads
# a third of the truth.
BUDGET_BOTH_ENDS = {"opex": [
    ["Poste", "Annuel", "Jan", "Fév", "Mar", "Avr", "Total"],
    ["Salaires", 480, 120, 120, 120, 120, 480],
    ["TOTAL DEPENSES OPEX", 400, 100, 100, 100, 100, 400],
]}
ACTUALS_3M = {"reel": [
    ["Opération", "Jan", "Fév", "Mar"],
    ["Plantations", 10, 20, 10],
    ["TOTAL SITE", 20, 50, 50],
]}

BVA_CTX = ContextIn(
    modules=["budget-vs-actual"],
    metrics={"OPEX": {
        "budget": {"sheet": "opex", "label": "TOTAL DEPENSES"},
        "actual": {"sheet": "reel", "label": "TOTAL SITE"},
        "unit": "USD",
    }},
)


def test_g1_annual_totals_at_both_ends_are_dropped(tmp_path):
    """Hand-worked: actuals 20+50+50 = 120. Phased budget over those same
    three months 100+100+100 = 300. Execution 120/300 = 40,0 %."""
    blocks, _ = _run([BUDGET_BOTH_ENDS, ACTUALS_3M], BVA_CTX, tmp_path)
    k = _kpis(blocks)[0]
    assert k.value.n == pytest.approx(40.0, abs=0.05)
    assert k.lineage[0].n == 120.0     # actuals summed
    assert k.lineage[1].n == 300.0     # phased budget, not the 400 annual


def test_g2_budget_is_phased_never_the_annual_rate(tmp_path):
    """The defect: dividing three months of spend by a full-year budget.
    120/400 would read 30 %; the honest figure is 40 %."""
    blocks, _ = _run([BUDGET_BOTH_ENDS, ACTUALS_3M], BVA_CTX, tmp_path)
    k = _kpis(blocks)[0]
    assert k.value.n != pytest.approx(30.0, abs=0.5)
    assert "phasé" in k.sub.fr


def test_g3_ratio_of_totals_never_average_of_ratios(tmp_path):
    """Months whose individual ratios average high while the money says
    otherwise. Actuals 10+10+280 = 300 against budget 10+10+1000 = 1020:
    ratio of totals 29,4 %, average of monthly ratios 42,7 %. The second is
    the flattering lie; the first is what the money did."""
    budget = {"opex": [
        ["Poste", "Jan", "Fév", "Mar"],
        ["Ligne", 5, 5, 500],
        ["TOTAL DEPENSES OPEX", 10, 10, 1000],
    ]}
    actual = {"reel": [
        ["Opération", "Jan", "Fév", "Mar"],
        ["Ligne", 5, 5, 140],
        ["TOTAL SITE", 10, 10, 280],
    ]}
    blocks, _ = _run([budget, actual], BVA_CTX, tmp_path)
    k = _kpis(blocks)[0]
    assert k.value.n == pytest.approx(29.4, abs=0.1)          # 300 / 1020
    assert k.value.n != pytest.approx(42.7, abs=1.0)          # the average of ratios


def test_g3b_a_month_with_no_spend_does_not_shift_the_others(tmp_path):
    """Found by review, not by a client — which is the point of a gate.

    A month with no spend leaves a blank cell. Pairing the surviving cells
    in order compared March's spend against February's budget and dropped
    March's budget entirely: 13,3 % reported where the truth is 6,7 %.
    Hand-worked: spent 10 (Jan) + 30 (Mar) = 40 against a budget of
    100 + 200 + 300 = 600 over those three months."""
    budget = {"opex": [
        ["Poste", "Jan", "Fév", "Mar"],
        ["Ligne", 5, 5, 5],
        ["TOTAL DEPENSES OPEX", 100, 200, 300],
    ]}
    actual = {"reel": [
        ["Opération", "Jan", "Fév", "Mar"],
        ["Ligne", 1, None, 1],
        ["TOTAL SITE", 10, None, 30],
    ]}
    blocks, _ = _run([budget, actual], BVA_CTX, tmp_path)
    k = _kpis(blocks)[0]
    assert k.value.n == pytest.approx(6.7, abs=0.1)
    assert k.lineage[0].n == 40.0
    assert k.lineage[1].n == 600.0
    # the chart stops at the gap rather than sliding March under February
    bar = next(b for b in blocks if getattr(b, "type", "") == "barPair")
    act = bar.series[1]
    assert [v.n for v in act.values] == [10.0]
    assert bar.cutoff == 1


def test_g3c_a_budgeted_line_with_no_spend_stays_in_the_denominator(tmp_path):
    """Also found by review. A line budgeted 8 000 and untouched used to
    vanish from the comparison entirely, turning 13,6 % of spend into 50 %.
    Hand-worked: 1 500 spent against 11 000 budgeted."""
    sheet = {"plan": [
        ["Poste", "Budget USD", "Réel USD"],
        ["Semences", 1000, 500],
        ["Engrais", 1000, 500],
        ["Transport", 8000, None],      # budgeted, nothing spent yet
        ["Divers", 1000, 500],
    ]}
    blocks, _ = _run([sheet], ContextIn(modules=["execution"]), tmp_path)
    k = _kpis(blocks)[0]
    assert k.value.n == pytest.approx(13.6, abs=0.1)
    assert k.lineage[0].n == 1500.0
    assert k.lineage[1].n == 11000.0


# --------------------------------------------------------------------------
# G3d–G3f · efficiency: the rate a plan implied against the rate reality gave
# --------------------------------------------------------------------------

EFF_BUDGET = {"opex": [
    ["Poste", "Jan", "Fév", "Mar"],
    ["Ligne", 10, 10, 10],
    ["TOTAL DEPENSES OPEX", 300, 300, 300],
]}
EFF_ACTUAL = {"reel": [
    ["Opération", "Jan", "Fév", "Mar"],
    ["TOTAL SITE", 100, 100, 100],
    ["Tonnes produites", 10, 10, 5],
]}
EFF_PLAN_TONNES = {"opex": [
    ["Poste", "Jan", "Fév", "Mar"],
    ["Ligne", 10, 10, 10],
    ["TOTAL DEPENSES OPEX", 300, 300, 300],
    ["Tonnes prévues", 30, 30, 30],
]}

EFF_CTX = ContextIn(
    modules=["efficiency"],
    metrics={
        "OPEX": {"budget": {"sheet": "opex", "label": "TOTAL DEPENSES OPEX"},
                 "actual": {"sheet": "reel", "label": "TOTAL SITE"}, "unit": "USD"},
        "Tonnes": {"budget": {"sheet": "opex", "label": "Tonnes prévues"},
                   "actual": {"sheet": "reel", "label": "Tonnes produites"},
                   "unit": "t"},
    },
    ratios={"Coût par tonne": {"numerator": "OPEX", "denominator": "Tonnes",
                               "unit": "USD/t"}},
)


def test_g3d_cost_per_tonne_meets_the_rate_the_plan_implied(tmp_path):
    """The defect a money-only view hides. Hand-worked: 300 spent of 900
    budgeted is 33 % — comfortable. But 25 tonnes came out of a planned 90,
    so the real cost is 300/25 = 12,0 per tonne against a planned
    900/90 = 10,0 — 20 % worse, while the spend column says all is well."""
    blocks, _ = _run([EFF_PLAN_TONNES, EFF_ACTUAL], EFF_CTX, tmp_path)
    k = _kpis(blocks)[0]
    assert k.value.n == pytest.approx(12.0, abs=0.05)
    assert k.value.unit == "USD/t"
    assert "10.0" in k.sub.en and "+20 %" in k.sub.fr
    assert k.tone == "bad"                       # over plan by more than 15 %
    assert k.lineage[0].n == 300.0               # actual OPEX
    assert k.lineage[1].n == 25.0                # actual tonnes
    assert k.lineage[-1].n == pytest.approx(20.0, abs=0.1)   # the gap


def test_g3e_a_rate_where_higher_is_better_reads_the_other_way(tmp_path):
    """An extraction rate under plan is bad news; a cost per tonne under
    plan is good news. The direction is the client's to declare."""
    ctx = ContextIn(
        modules=["efficiency"],
        metrics=EFF_CTX.model_dump()["metrics"],
        ratios={"Rendement": {"numerator": "Tonnes", "denominator": "OPEX",
                              "unit": "ratio", "lower_is_better": False}},
    )
    blocks, _ = _run([EFF_PLAN_TONNES, EFF_ACTUAL], ctx, tmp_path)
    k = _kpis(blocks)[0]
    # 25/300 actual against 90/900 planned — below plan, and that is bad
    assert k.value.n == pytest.approx(0.1, abs=0.01)
    assert k.tone in ("warn", "bad")


def test_g3f_a_label_matches_its_row_exactly_before_any_other(tmp_path):
    """Real sheets carry « CPO » and « CPO 2025 » rows apart. The looser
    match answered with whichever came first — silently the wrong year."""
    plan = {"opex": [
        ["Poste", "Jan", "Fév", "Mar"],
        ["CPO 2025", 1, 1, 1],           # last year, listed first
        ["TOTAL DEPENSES OPEX", 300, 300, 300],
        ["CPO", 30, 30, 30],             # the row the context means
    ]}
    metrics = EFF_CTX.model_dump()["metrics"]
    metrics["Tonnes"] = {"budget": {"sheet": "opex", "label": "CPO"},
                         "actual": {"sheet": "reel", "label": "Tonnes produites"},
                         "unit": "t"}
    ctx = ContextIn(modules=["efficiency"], metrics=metrics,
                    ratios=EFF_CTX.model_dump()["ratios"])
    blocks, _ = _run([plan, EFF_ACTUAL], ctx, tmp_path)
    k = _kpis(blocks)[0]
    # planned rate uses the 30/month row (900/90 = 10), not the 1/month row
    assert k.lineage[3].n == pytest.approx(10.0, abs=0.05)


# --------------------------------------------------------------------------
# G3g · trajectory: the plan read from the client's sheet, not retyped
# --------------------------------------------------------------------------

def test_g3g_trajectory_reads_the_plan_and_keeps_every_cell(tmp_path):
    """A trajectory retyped into a slide is one nobody can check. Rows that
    start in different years must still line up under the right year, and a
    negative balance must survive to the page."""
    recap = {"RECAP": [
        ["PROJECTIONS"],
        [None, "2019-2021", 2025, 2026, 2027],
        ["REVENUES BRUTS", None, 238939, 771190, 1081920],
        ["SOUS-TOTAL OPEX", None, None, 457300, 641557],   # starts a year later
        ["BALANCE", None, None, -556220, -197817],
    ]}
    ctx = ContextIn(modules=["trajectory"], timelines={"Plan": {
        "sheet": "RECAP", "unit": "USD",
        "rows": {"Revenus": "REVENUES BRUTS", "OPEX": "SOUS-TOTAL OPEX",
                 "Solde": "BALANCE"},
        "chart": ["Revenus", "OPEX"],
    }})
    blocks, _ = _run([recap], ctx, tmp_path)
    table = next(b for b in blocks if getattr(b, "type", "") == "table")
    assert [c.key for c in table.columns] == ["item", "y2025", "y2026", "y2027"]
    rows = {r["item"]: r for r in table.rows}
    # revenue starts in 2025, OPEX in 2026 — each under its own year
    assert rows["Revenus"]["y2025"].n == 238939
    assert "y2025" not in rows["OPEX"]
    assert rows["OPEX"]["y2026"].n == 457300
    # the plan's own negative balance reaches the page intact
    assert rows["Solde"]["y2026"].n == -556220
    # and every figure still carries the cell it came from
    assert rows["Revenus"]["y2025"].src.cells == "C3"
    assert rows["Solde"]["y2026"].src.cells == "D5"
    bar = next(b for b in blocks if getattr(b, "type", "") == "barPair")
    assert bar.x == ["2025", "2026", "2027"]


# --------------------------------------------------------------------------
# G4 · coverage: uncoded entries, and the balance column that is not an amount
# --------------------------------------------------------------------------

JOURNAL = {"journal": [
    ["Date", "Libellé", "CODE", "Sorties USD", "Sorties CDF", "Solde USD"],
    ["2026-01-05", "Achat pièces", "6022", 120, None, 880],
    ["2026-01-08", "Transport équipe", "", 60, None, 820],
    ["2026-01-12", "Ciment chantier", None, None, 300000, 820],
    ["2026-01-15", "Carburant", None, 40, None, 780],
]}
COV_CTX = ContextIn(modules=["coverage"], reconcile_sheets=["journal"],
                    journal_code_column="CODE",
                    units={"Sorties USD": "USD", "Sorties CDF": "CDF",
                           "Solde USD": "USD"})


def test_g4_coverage_counts_and_keeps_currencies_apart(tmp_path):
    """Hand-worked: four entries carry an amount, three have no code. The
    uncoded money is 100 USD (60 + 40) and 300 000 CDF — never added
    together, and the running balance is never mistaken for a payment."""
    blocks, _ = _run([JOURNAL], COV_CTX, tmp_path)
    k = _kpis(blocks)[0]
    assert k.value.n == 3
    assert k.lineage[0].n == 4                 # entries checked
    assert "100 USD" in k.sub.fr and "300 000 CDF" in k.sub.fr
    assert "400" not in k.sub.fr               # the two currencies never merge
    table = next(b for b in blocks if getattr(b, "type", "") == "table")
    assert all("F" not in r["amount"].src.cells for r in table.rows)  # not the balance


# --------------------------------------------------------------------------
# G5 · reconciliation: the same money in two journals
# --------------------------------------------------------------------------

def test_g5_same_date_and_amount_across_journals_matches_once(tmp_path):
    """Two journals sharing one payment on the same date for the same
    amount: exactly one match, and a near-miss on another date is not one."""
    from datetime import date

    j1 = {"caisse": [
        ["Date", "Libellé", "Sorties USD"],
        [date(2026, 1, 5), "Achat pièces", 120],
        [date(2026, 1, 8), "Transport", 60],
        [date(2026, 1, 9), "Divers", 15],
    ]}
    j2 = {"banque": [
        ["Date", "Libellé", "Sorties USD"],
        [date(2026, 1, 5), "Virement pièces", 120],   # the same money
        [date(2026, 1, 10), "Transport", 60],         # same amount, other day
        [date(2026, 1, 11), "Autre", 90],
    ]}
    ctx = ContextIn(modules=["reconciliation"],
                    reconcile_sheets=["caisse", "banque"])
    blocks, ran = _run([j1, j2], ctx, tmp_path)
    flag = next(b for b in blocks if getattr(b, "type", "") == "flag")
    assert "1 écriture" in flag.title.fr and "120" in flag.title.fr
    table = next(b for b in blocks if getattr(b, "type", "") == "table")
    assert len(table.rows) == 1


# --------------------------------------------------------------------------
# G6–G7 · the promises themselves
# --------------------------------------------------------------------------

def _all_values(obj):
    """Every Value anywhere in a block tree."""
    from app.schema import Value

    if isinstance(obj, Value):
        yield obj
        return
    if isinstance(obj, dict):
        items = obj.values()
    elif isinstance(obj, (list, tuple)):
        items = obj
    elif hasattr(obj, "__dict__"):
        items = vars(obj).values()
    else:
        return
    for v in items:
        yield from _all_values(v)


@pytest.mark.parametrize("sheets,ctx", [
    ([BUDGET_BOTH_ENDS, ACTUALS_3M], BVA_CTX),
    ([JOURNAL], COV_CTX),
])
def test_g6_every_module_figure_carries_a_source_cell(sheets, ctx, tmp_path):
    """CH-004 at module level: no figure without the cell it came from."""
    blocks, _ = _run(sheets, ctx, tmp_path)
    values = list(_all_values(blocks))
    assert values
    for v in values:
        assert v.src and v.src.cells, f"unsourced figure: {v}"


def test_g7_lineage_ends_at_the_number_it_explains(tmp_path):
    """A drill panel that does not arrive at the headline is worse than
    none: the last step must be the figure on the card."""
    for sheets, ctx in ([BUDGET_BOTH_ENDS, ACTUALS_3M], BVA_CTX), ([JOURNAL], COV_CTX):
        blocks, _ = _run(sheets, ctx, tmp_path)
        for k in _kpis(blocks):
            assert k.lineage, f"{k.label.fr} has no lineage"
            assert k.lineage[-1].n == pytest.approx(k.value.n, abs=0.05)
