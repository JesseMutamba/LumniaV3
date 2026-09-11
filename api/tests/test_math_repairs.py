"""Math regression tests for repaired Lumnia semantics.

Prepared outside the checkout for the root agent to install/review. All
workbooks are in memory. No database, credentials, network, or original
workbook file is required.
"""
from datetime import date
from pathlib import Path

import pytest

from app.pipeline.ingest import Sheet, Workbook
from app.pipeline.modules import run_modules
from app.pipeline.parse import detect_tables
from app.schema import ContextIn, Source


def _run(sheets, context):
    books = [Workbook(Path(f"fixture-{i}.xlsx"),
                      {name: Sheet(name, rows) for name, rows in book.items()},
                      Source(idx=i, filename=f"fixture-{i}.xlsx"))
             for i, book in enumerate(sheets)]
    tables = [(i, table) for i, book in enumerate(books)
              for table in detect_tables(book, context)]
    blocks, _ = run_modules(context.modules, books, tables, context, {})
    return blocks


def _kpis(blocks):
    return [item for block in blocks if block.type == "kpiGrid" for item in block.items]


def _metric(name="Cost", unit="USD"):
    return {"budget": {"sheet": "Budget", "label": name},
            "actual": {"sheet": "Actual", "label": name}, "unit": unit}


def _context(**extra):
    return ContextIn(modules=["budget-vs-actual"],
                     metrics={"Cost": _metric()}, **extra)


def test_leading_missing_actual_uses_calendar_months_not_first_numeric_cell():
    blocks = _run([{
        "Budget": [["Metric", "January", "February", "March"], ["Cost", 100, 1000, 10000]],
        "Actual": [["Metric", "January", "February", "March"], ["Cost", None, 1000, 10000]],
    }], _context())
    kpi = _kpis(blocks)[0]
    assert kpi.value.n == 100.0
    assert kpi.lineage[0].n == 11000.0
    assert kpi.lineage[1].n == 11000.0
    chart = next(block for block in blocks if block.type == "barPair")
    assert [v.n if v is not None else None for v in chart.series[1].values] == [None, 1000, 10000]
    assert chart.series[1].values[1].src.cells == "C2"


def test_internal_missing_actual_is_not_fabricated_zero():
    blocks = _run([{
        "Budget": [["Metric", "Jan", "Fév", "Mar"], ["Cost", 100, 200, 300]],
        "Actual": [["Metric", "Jan", "Fév", "Mar"], ["Cost", 10, None, 30]],
    }], _context())
    kpi = _kpis(blocks)[0]
    assert kpi.value.n == 10.0  # (January 10 + March 30) / (100 + 300)
    assert kpi.lineage[1].n == 400.0
    chart = next(block for block in blocks if block.type == "barPair")
    assert [v.n if v is not None else None for v in chart.series[1].values] == [10, None, 30]
    assert chart.cutoff == 3
    assert any(block.type == "flag" and "common observed months" in (block.title.en or "") for block in blocks)


def test_different_series_start_months_align_to_declared_months():
    blocks = _run([{
        "Budget": [["Metric", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"],
                   ["Cost", 100, 200, 300, 400, 500, 600, 700, 800]],
        "Actual": [["Metric", "July", "August"], ["Cost", 70, 80]],
    }], _context())
    kpi = _kpis(blocks)[0]
    assert kpi.value.n == 10.0
    assert kpi.lineage[0].n == 150.0
    assert kpi.lineage[1].n == 1500.0
    chart = next(block for block in blocks if block.type == "barPair")
    assert [v.n if v is not None else None for v in chart.series[1].values] == [None] * 6 + [70, 80]


def test_coincidental_total_equality_does_not_delete_real_month():
    blocks = _run([{
        "Budget": [["Metric", "Jan", "Feb", "Mar", "Apr"], ["Cost", 100, 100, 100, 300]],
        "Actual": [["Metric", "Jan", "Feb", "Mar", "Apr"], ["Cost", 100, 100, 100, 300]],
    }], _context())
    assert _kpis(blocks)[0].lineage[1].n == 600.0
    chart = next(block for block in blocks if block.type == "barPair")
    assert [v.n for v in chart.series[0].values] == [100, 100, 100, 300]


def test_explicit_year_mismatch_is_prominently_unverified():
    blocks = _run([{
        "Budget": [["Budget 2026"], ["Metric", "January", "February"], ["Cost", 100, 200]],
        "Actual": [["Metric", date(2024, 1, 1), date(2024, 2, 1)], ["Cost", 50, 100]],
    }], _context())
    warnings = [block for block in blocks if block.type == "flag" and block.severity == "blocked"]
    assert warnings
    assert any("2024" in block.body.en and "2026" in block.body.en for block in warnings)
    assert "UNVERIFIED" in _kpis(blocks)[0].sub.en


def test_efficiency_recomputes_both_totals_over_common_observed_months():
    context = ContextIn(modules=["efficiency"],
                        metrics={"Cost": _metric(), "Volume": _metric("Volume", "t")},
                        ratios={"Cost per tonne": {"numerator": "Cost", "denominator": "Volume", "unit": "USD/t"}})
    blocks = _run([{
        "Budget": [["Metric", "Jan", "Feb", "Mar"], ["Cost", 100, 100, 100], ["Volume", 10, 10, 10]],
        "Actual": [["Metric", "Jan", "Feb", "Mar"], ["Cost", 100, 100, 100], ["Volume", 10, 10, None]],
    }], context)
    kpi = _kpis(blocks)[0]
    assert kpi.value.n == 10.0
    assert kpi.lineage[0].n == 200.0
    assert kpi.lineage[1].n == 20.0
    assert kpi.lineage[3].n == 10.0


def test_execution_honors_excluded_rows_and_keeps_original_cell_addresses():
    context = ContextIn(modules=["execution"], exclude_labels=["Subtotal"])
    blocks = _run([{"Budget": [
        ["Item", "Budget USD", "Actual USD"], ["Subtotal", 100, 100],
        ["Child", 100, 100], ["Other", 900, 0],
    ]}], context)
    assert _kpis(blocks)[0].value.n == 10.0
    rail = next(block for block in blocks if block.type == "rail")
    assert rail.rows[0].actual.src.cells == "C3"


def test_named_series_cannot_read_an_ignored_sheet():
    blocks = _run([{
        "Budget": [["Metric", "Jan", "Feb"], ["Cost", 100, 100]],
        "Actual": [["Metric", "Jan", "Feb"], ["Cost", 50, 50]],
    }], _context(ignore_sheets=["Actual"]))
    assert not _kpis(blocks)


def _journal(unit, amounts, column="Sorties"):
    return [["Date", "Description", f"{column} {unit}"]] + [
        [date(2026, 1, i + 1), f"Transaction {i + 1}", amount]
        for i, amount in enumerate(amounts)]


def test_reconciliation_never_matches_usd_to_cdf():
    blocks = _run([{"A": _journal("USD", [100, 200, 300]),
                    "B": _journal("CDF", [100, 200, 300])}],
                  ContextIn(modules=["reconciliation"]))
    assert not blocks


def test_reconciliation_never_matches_balances_or_inflows_to_outflows():
    blocks = _run([{"A": _journal("USD", [100, 200, 300]),
                    "B": _journal("USD", [100, 200, 300], "Solde"),
                    "C": _journal("USD", [100, 200, 300], "Entrées")}],
                  ContextIn(modules=["reconciliation"]))
    assert not blocks


def test_reconciliation_matches_one_to_one_and_retains_currency_and_both_sources():
    a = [["Date", "Description", "Sorties USD"],
         [date(2026, 1, 1), "First", 100],
         [date(2026, 1, 1), "Second", 100],
         [date(2026, 1, 2), "Third", 200]]
    b = [["Date", "Description", "Sorties USD"],
         [date(2026, 1, 1), "Match", 100],
         [date(2026, 1, 3), "Other", 50],
         [date(2026, 1, 4), "Another", 60]]
    blocks = _run([{"A": a}, {"B": b}], ContextIn(modules=["reconciliation"]))
    table = next(block for block in blocks if block.type == "table")
    assert len(table.rows) == 1
    assert table.rows[0]["amount"].unit == "USD"
    assert table.rows[0]["amount"].src.file == 0
    assert "fixture-1.xlsx" in table.rows[0]["also"]
    flag = next(block for block in blocks if block.type == "flag")
    assert "not confirmed" in flag.body.en


def test_trajectory_keeps_missing_year_at_its_original_position():
    context = ContextIn(modules=["trajectory"], timelines={"Plan": {
        "sheet": "Plan", "rows": {"Revenue": "Revenue", "Cost": "Cost"},
        "chart": ["Revenue", "Cost"],
    }})
    blocks = _run([{"Plan": [["Metric", 2025, 2026, 2027],
                             ["Revenue", 100, None, 300], ["Cost", 50, 60, 70]]}], context)
    chart = next(block for block in blocks if block.type == "barPair")
    assert chart.x == ["2025", "2026", "2027"]
    assert [v.n if v is not None else None for v in chart.series[0].values] == [100, None, 300]
    assert chart.series[0].values[2].src.cells == "D2"


def test_narration_only_reorders_immutable_fact_statements(monkeypatch):
    import httpx
    from app.pipeline.modules import _llm_polish
    class Response:
        status_code = 200
        def json(self):
            return {"content": [{"type": "text", "text": '{"order":[1,0]}'}]}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-placeholder")
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: Response())
    facts = [("Marge -12.", "Margin -12."), ("Coût 1,25.", "Cost 1.25.")]
    assert _llm_polish(facts) == ("Coût 1,25. Marge -12.", "Cost 1.25. Margin -12.")


@pytest.mark.parametrize("payload", ['{"order":[0,0]}', '{"order":[false,1]}',
                                    '{"fr":"Coût 125.","en":"Cost 125."}'])
def test_narration_rejects_rewritten_values_and_invalid_order(monkeypatch, payload):
    import httpx
    from app.pipeline.modules import _llm_polish
    class Response:
        status_code = 200
        def json(self):
            return {"content": [{"type": "text", "text": payload}]}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-placeholder")
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: Response())
    assert _llm_polish([("Marge -12.", "Margin -12."), ("Coût 1,25.", "Cost 1.25.")]) is None
