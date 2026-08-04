"""The real books, when they are on this machine.

`test_golden.py` guards the *shapes*; this guards the actual figures the
platform produced from a real client's workbooks and that a human analyst
independently arrived at by hand. It skips unless the books are present,
because private financial data does not live in a public repository.

To run it, point at a directory holding the two workbooks:

    LUMNIA_GOLDEN_DIR=/path/to/books python -m pytest tests/test_real_books.py

The expected numbers below are not this code's output — they come from the
hand-written PVAK Q1 2026 analysis. If the platform stops agreeing with the
analyst, the platform is what changed.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.pipeline.ingest import read_workbook
from app.pipeline.modules import run_modules
from app.pipeline.parse import detect_tables
from app.schema import ContextIn

BUDGET_BOOK = "Montage_financier.xlsx"
TRACKING_BOOK = "SUIVI_FINANCES.xlsx"

DIR = Path(os.environ.get("LUMNIA_GOLDEN_DIR", ""))
HAVE = DIR.is_dir() and (DIR / BUDGET_BOOK).exists() and (DIR / TRACKING_BOOK).exists()

pytestmark = pytest.mark.skipif(
    not HAVE, reason="real books absent; set LUMNIA_GOLDEN_DIR to run"
)

PVAK = ContextIn(
    modules=["coverage", "budget-vs-actual", "reconciliation"],
    reconcile_sheets=["JC DGO", "JC Consolidé"],
    journal_code_column="CODE",
    ignore_sheets=["GLOSSAIRE"],
    metrics={"OPEX": {
        "budget": {"sheet": "opex", "label": "TOTAL DEPENSES OPEX"},
        "actual": {"sheet": "COUT DE PRODUCTION (OPEX)", "label": "TOTAL SITE"},
        "unit": "USD",
    }},
)


@pytest.fixture(scope="module")
def blocks():
    wbs = [read_workbook(DIR / BUDGET_BOOK, idx=0),
           read_workbook(DIR / TRACKING_BOOK, idx=1)]
    tables = []
    for wb in wbs:
        tables += [(wb.source.idx, t) for t in detect_tables(wb, PVAK)]
    out, _ = run_modules(PVAK.modules, wbs, tables, PVAK, {})
    return out


def _kpi(blocks, needle):
    for b in blocks:
        if getattr(b, "type", "") == "kpiGrid":
            for k in b.items:
                if needle in k.label.fr:
                    return k
    raise AssertionError(f"no KPI matching {needle!r}")


def test_opex_execution_matches_the_hand_analysis(blocks):
    """The analyst's §2: 44 624 spent against 112 900 of phased budget over
    Q1 — 39,5 % execution."""
    k = _kpi(blocks, "Exécution · OPEX")
    assert k.value.n == pytest.approx(39.5, abs=0.1)
    assert k.lineage[0].n == pytest.approx(44_624, abs=1)
    assert k.lineage[1].n == pytest.approx(112_900, abs=1)


def test_double_counted_entries_match_the_hand_analysis(blocks):
    """The analyst's §6.2: entries present in both journals, same date and
    same amount — around 45 entries and $124k found by hand."""
    flag = next(b for b in blocks
                if getattr(b, "type", "") == "flag" and "Rapprochement" in b.tag.fr)
    assert "50 écriture" in flag.title.fr
    assert "133 302" in flag.title.fr


def test_uncoded_entries_are_still_the_open_worklist(blocks):
    """Not in the hand analysis — this is what the platform found that the
    analyst did not: 187 journal entries carrying money but no routing code."""
    consolidated = _kpi(blocks, "JC Consolidé")
    dgo = _kpi(blocks, "JC DGO")
    assert consolidated.value.n == 132
    assert dgo.value.n == 55
    assert dgo.lineage[0].n == 55        # every DGO entry is uncoded
