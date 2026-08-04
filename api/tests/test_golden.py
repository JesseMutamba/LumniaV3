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
