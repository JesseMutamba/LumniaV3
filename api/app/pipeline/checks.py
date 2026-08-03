"""Deterministic checks. No model involved, no heuristics that can't be tested.

Each check takes plain data and returns a CheckResult. They are pure functions
so they can be pytest'd against known workbooks — the oracle is the spreadsheet
itself, not a judgement call.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str
    data: dict = field(default_factory=dict)


TOL = 0.01  # currency tolerance, in the workbook's own units


# --------------------------------------------------------------------------
# CH-001 — flattened parent/child hierarchy
# --------------------------------------------------------------------------

def detect_rollup_hierarchy(
    rows: list[tuple[str, float]], tol: float = TOL
) -> CheckResult:
    """Find rows that are the sum of a run of rows immediately beneath them.

    Spreadsheets routinely encode a hierarchy with no indentation and no level
    column: a division row followed by its own departments, all flat in one
    column. Summing that column double-counts every parent.

    A row is a parent iff some contiguous run starting at the next row sums to
    it within tolerance. Longest run wins, so nested structures resolve
    outermost-first. Rows consumed as children are never tested as parents in
    the same pass.

    Returns passed=True when the sheet is flat (nothing to catch) and
    passed=False when a rollup is present — "failed" here means "found
    something the caller must handle", not "the client made a mistake".
    """
    n = len(rows)
    parents: list[dict] = []
    consumed: set[int] = set()

    i = 0
    while i < n:
        if i in consumed:
            i += 1
            continue
        name, target = rows[i]
        if target is None or target == 0:
            i += 1
            continue

        best: list[int] | None = None
        run = 0.0
        for j in range(i + 1, n):
            child = rows[j][1]
            if child is None:
                break
            run += child
            if abs(run - target) <= tol and j > i:
                best = list(range(i + 1, j + 1))  # longest match wins
        if best:
            parents.append(
                {
                    "parent": name,
                    "parent_row": i,
                    "value": target,
                    "children": [
                        {"name": rows[k][0], "value": rows[k][1]} for k in best
                    ],
                    "delta": round(target - sum(rows[k][1] for k in best), 6),
                }
            )
            consumed.update(best)
            i = best[-1] + 1
        else:
            i += 1

    naive = sum(v for _, v in rows if v is not None)
    correct = naive - sum(
        sum(c["value"] for c in p["children"]) for p in parents
    )

    if not parents:
        return CheckResult(
            "CH-001 rollup-hierarchy", True, "Flat column, no rollup detected."
        )

    return CheckResult(
        "CH-001 rollup-hierarchy",
        False,
        f"{len(parents)} parent row(s) detected; naive sum overstates by "
        f"{naive - correct:,.2f}",
        {
            "parents": parents,
            "naive_sum": round(naive, 2),
            "correct_sum": round(correct, 2),
            "overstatement": round(naive - correct, 2),
        },
    )


# --------------------------------------------------------------------------
# CH-002 — stated subtotal vs computed subtotal
# --------------------------------------------------------------------------

def check_subtotal(
    lines: list[float], stated: float, label: str = "", tol: float = TOL
) -> CheckResult:
    computed = sum(v for v in lines if v is not None)
    ok = abs(computed - stated) <= tol
    return CheckResult(
        f"CH-002 subtotal{(' ' + label) if label else ''}",
        ok,
        f"stated {stated:,.2f} vs computed {computed:,.2f} "
        f"(delta {computed - stated:,.2f})",
        {"stated": stated, "computed": round(computed, 2)},
    )


# --------------------------------------------------------------------------
# CH-003 — implied unit price consistency across periods
# --------------------------------------------------------------------------

def check_implied_price(
    revenue: list[float], volume: list[float], labels: list[str], tol: float = 0.02
) -> CheckResult:
    """A plan that prices output at $1,000/t in one year and $940/t in another
    without saying so is not wrong, but the reader has to be told."""
    prices = {}
    for r, v, lab in zip(revenue, volume, labels):
        if v:
            prices[lab] = r / v
    if not prices:
        return CheckResult("CH-003 implied-price", True, "No volume to price.")
    lo, hi = min(prices.values()), max(prices.values())
    ok = hi == 0 or (hi - lo) / hi <= tol
    return CheckResult(
        "CH-003 implied-price",
        ok,
        f"implied unit price ranges {lo:,.2f}–{hi:,.2f}",
        {"by_period": {k: round(v, 2) for k, v in prices.items()}},
    )


# --------------------------------------------------------------------------
# CH-004 — no value may reach the renderer without a source cell
# --------------------------------------------------------------------------

def check_provenance(report) -> CheckResult:
    """Walk a built Report and assert every Value carries a Src.

    Pydantic already makes an unsourced Value unconstructable, so this should
    never fail. It runs anyway: it is the assertion the whole product claim
    rests on, and a check you only run when you doubt it is not a check.
    """
    missing: list[str] = []
    seen = 0

    def walk(node, path="report"):
        nonlocal seen
        if isinstance(node, dict):
            if {"n", "unit"} <= node.keys():
                seen += 1
                if not node.get("src"):
                    missing.append(path)
                return
            for k, v in node.items():
                walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    walk(report.model_dump(mode="json") if hasattr(report, "model_dump") else report)
    return CheckResult(
        "CH-004 provenance",
        not missing,
        f"{seen} value(s) checked, {len(missing)} without a source cell",
        {"missing": missing, "values_checked": seen},
    )


REGISTRY = {
    "CH-001": detect_rollup_hierarchy,
    "CH-002": check_subtotal,
    "CH-003": check_implied_price,
    "CH-004": check_provenance,
}
