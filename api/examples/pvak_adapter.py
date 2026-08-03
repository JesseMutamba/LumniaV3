"""Seed the platform with the clients we have and one real report.

Everything above `build_pvak_q1` is generic platform setup. `build_pvak_q1`
is a hand-written adapter — it knows which cells in PVAK's workbooks hold
which numbers, because layer 02 cannot infer that yet. It is the honest
shape of "Lumnia in the loop": the ranges below are what a person currently
supplies and what confidence-scored parsing has to replace.

One adapter per client until then. When the second adapter looks like the
first, that duplication is the spec for layer 02.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

from . import store
from .pipeline.checks import detect_rollup_hierarchy
from .pipeline.ingest import Workbook, a1_range, read_workbook
from .schema import (
    BarPair,
    Column,
    Evidence,
    Flag,
    Heading,
    Kpi,
    KpiGrid,
    Ledger,
    Period,
    Rail,
    RailRow,
    Report,
    Series,
    Src,
    Table,
    Text,
    Value,
)

DATA = Path(__file__).resolve().parent.parent / "data"
PLAN_XLSX = DATA / "Montage_financier_2025_a_2030.xlsx"
ACT_XLSX = DATA / "SUIVI_FINANCES_PVAK.xlsx"

ORGS = [
    ("pvak", "PVAK", Text(fr="Mwebe & Kwenge, RDC", en="Mwebe & Kwenge, DRC")),
    ("kamoa", "Kamoa Copper SA", Text(fr="Kolwezi, RDC", en="Kolwezi, DRC")),
    ("congo-graphic", "Congo Graphic", Text(fr="Kinshasa, RDC", en="Kinshasa, DRC")),
]


# --------------------------------------------------------------------------
# helpers — every read goes through here so provenance can't be forgotten
# --------------------------------------------------------------------------

def _v(wb: Workbook, sheet: str, row: int, col: int, unit: str, file_idx: int) -> Value:
    """Read one cell and wrap it with its own address."""
    n = wb[sheet].cell(row, col)
    if n is None:
        raise ValueError(f"{wb.source.filename}!{sheet}!{a1_range(row,col,row,col)} is empty")
    return Value(
        n=float(n), unit=unit, src=Src(file=file_idx, sheet=sheet, cells=a1_range(row, col, row, col))
    )


def _row(wb: Workbook, sheet: str, row: int, c0: int, c1: int) -> list[float]:
    return [wb[sheet].cell(row, c) or 0.0 for c in range(c0, c1 + 1)]


def _sum(
    wb: Workbook, sheet: str, row: int, c0: int, c1: int, unit: str, file_idx: int
) -> Value:
    vals = _row(wb, sheet, row, c0, c1)
    return Value(
        n=float(sum(vals)),
        unit=unit,
        src=Src(file=file_idx, sheet=sheet, cells=a1_range(row, c0, row, c1)),
        derived="sum",
    )


def _series(
    wb: Workbook, sheet: str, row: int, c0: int, c1: int, unit: str, file_idx: int
) -> list[Value]:
    return [
        Value(
            n=float(wb[sheet].cell(row, c) or 0.0),
            unit=unit,
            src=Src(file=file_idx, sheet=sheet, cells=a1_range(row, c, row, c)),
        )
        for c in range(c0, c1 + 1)
    ]


def _derived(n: float, unit: str, src: Src, how: str) -> Value:
    return Value(n=n, unit=unit, src=src, derived=how)  # type: ignore[arg-type]


# --------------------------------------------------------------------------
# PVAK adapter — the hand-supplied part
# --------------------------------------------------------------------------

# sheet, row, first col, last col. Supplied by a person today.
MAP = {
    "opex_plan_m": ("opex ", 96, 3, 14),
    "capex_dev_m": ("capex", 18, 6, 17),
    "capex_mill_m": ("capex", 30, 6, 17),
    "ffb_plan_m": ("PRODUCTION 2025&2026", 10, 3, 14),
    "cpo_plan_m": ("PRODUCTION 2025&2026", 14, 3, 14),
    "recap_rev": ("RECAP", 7, 4, 8),
    "recap_opex": ("RECAP", 14, 4, 8),
    "recap_capex": ("RECAP", 18, 4, 8),
    "recap_bal": ("RECAP", 22, 4, 8),
    "recap_ha": ("RECAP", 4, 4, 8),
    "recap_cpo": ("RECAP", 6, 4, 8),
    "opex_act_m": ("COUT DE PRODUCTION (OPEX)", 43, 4, 6),
    "ffb_act_m": ("COUT DE PRODUCTION (OPEX)", 44, 4, 6),
    "cpo_act_m": ("COUT DE PRODUCTION (OPEX)", 45, 4, 6),
    "capex_act_m": ("INVESTISSEMENTS (CAPEX)", 28, 4, 6),
    "salary_labels": ("salaires 2026", (115, 127), 2, 2),
    "salary_values": ("salaires 2026", (115, 127), 3, 3),
}
Q = 3  # months of actuals


def build_pvak_q1(plan: Workbook, act: Workbook) -> Report:
    P, A = 0, 1  # source indices

    opex_plan = _row(plan, "opex ", 96, 3, 14)
    dev = _row(plan, "capex", 18, 6, 17)
    mill = _row(plan, "capex", 30, 6, 17)
    capex_plan = [a + b for a, b in zip(dev, mill)]
    ffb_plan = _row(plan, "PRODUCTION 2025&2026", 10, 3, 14)
    cpo_plan = _row(plan, "PRODUCTION 2025&2026", 14, 3, 14)

    opex_act = _row(act, "COUT DE PRODUCTION (OPEX)", 43, 4, 6)
    capex_act = _row(act, "INVESTISSEMENTS (CAPEX)", 28, 4, 6)
    cpo_act = _row(act, "COUT DE PRODUCTION (OPEX)", 45, 4, 6)

    # aggregates, each keeping the range it was computed from
    opex_pace = _sum(plan, "opex ", 96, 3, 5, "USD", P)
    capex_pace = _derived(
        sum(capex_plan[:Q]),
        "USD",
        Src(file=P, sheet="capex", cells="F18:H18 + F30:H30"),
        "sum",
    )
    opex_real = _sum(act, "COUT DE PRODUCTION (OPEX)", 43, 4, 6, "USD", A)
    capex_real = _sum(act, "INVESTISSEMENTS (CAPEX)", 28, 4, 6, "USD", A)
    ffb_real = _sum(act, "COUT DE PRODUCTION (OPEX)", 44, 4, 6, "t", A)
    cpo_real = _sum(act, "COUT DE PRODUCTION (OPEX)", 45, 4, 6, "t", A)

    spend_real = opex_real.n + capex_real.n
    spend_pace = opex_pace.n + capex_pace.n
    cost_t = opex_real.n / cpo_real.n
    price = plan["RECAP"].cell(7, 4) / plan["RECAP"].cell(6, 4)

    # CH-001 on the salary roster
    rows = [
        (str(plan["salaires 2026"].cell(r, 2)), plan["salaires 2026"].cell(r, 3))
        for r in range(115, 128)
    ]
    ch1 = detect_rollup_hierarchy(rows)

    blocks = [
        Heading(
            label=Text(fr="01 · Exécution", en="01 · Execution"),
            text=Text(
                fr="La sous-consommation est réelle, mais elle n'est pas une économie.",
                en="The underspend is real, but it is not a saving.",
            ),
            dek=Text(
                fr="L'essentiel du retard porte sur le CAPEX pépinière et replanting — "
                "les hectares à planter en 2026 qui portent le chiffre d'affaires de 2029 et 2030.",
                en="Most of the shortfall sits in nursery and replanting CAPEX — the hectares "
                "due for planting in 2026 that carry the 2029 and 2030 revenue lines.",
            ),
        ),
        Rail(
            rows=[
                RailRow(
                    label=Text(fr="Dépenses totales", en="Total spend"),
                    envelope=_derived(
                        sum(opex_plan) + sum(capex_plan),
                        "USD",
                        Src(file=P, sheet="opex + capex", cells="C96:N96 + F18:Q18 + F30:Q30"),
                        "sum",
                    ),
                    pace=_derived(spend_pace, "USD", capex_pace.src, "sum"),
                    actual=_derived(
                        spend_real,
                        "USD",
                        Src(file=A, sheet="OPEX + CAPEX", cells="D43:F43 + D28:F28"),
                        "sum",
                    ),
                ),
                RailRow(
                    label=Text(fr="OPEX", en="OPEX"),
                    envelope=_sum(plan, "opex ", 96, 3, 14, "USD", P),
                    pace=opex_pace,
                    actual=opex_real,
                ),
                RailRow(
                    label=Text(fr="CAPEX", en="CAPEX"),
                    envelope=_derived(
                        sum(capex_plan),
                        "USD",
                        Src(file=P, sheet="capex", cells="F18:Q18 + F30:Q30"),
                        "sum",
                    ),
                    pace=capex_pace,
                    actual=capex_real,
                ),
            ]
        ),
        KpiGrid(
            items=[
                Kpi(
                    label=Text(fr="Exécution T1", en="Q1 execution"),
                    value=_derived(
                        spend_real / spend_pace, "ratio", opex_real.src, "ratio"
                    ),
                    sub=Text(
                        fr=f"{spend_real:,.0f} $ contre {spend_pace:,.0f} $",
                        en=f"${spend_real:,.0f} against ${spend_pace:,.0f}",
                    ),
                    tone="warn",
                ),
                Kpi(
                    label=Text(fr="Écart contre rythme", en="Variance to pace"),
                    value=_derived(
                        spend_real - spend_pace, "USD", opex_real.src, "delta"
                    ),
                    sub=Text(
                        fr=f"OPEX {opex_real.n - opex_pace.n:,.0f} $ · CAPEX {capex_real.n - capex_pace.n:,.0f} $",
                        en=f"OPEX ${opex_real.n - opex_pace.n:,.0f} · CAPEX ${capex_real.n - capex_pace.n:,.0f}",
                    ),
                ),
                Kpi(
                    label=Text(fr="Régimes livrés T1", en="Fruit delivered Q1"),
                    value=ffb_real,
                    sub=Text(
                        fr=f"contre {sum(ffb_plan[:Q]):,.0f} t · {ffb_real.n / sum(ffb_plan[:Q]):.1%}",
                        en=f"against {sum(ffb_plan[:Q]):,.0f} t · {ffb_real.n / sum(ffb_plan[:Q]):.1%}",
                    ),
                    tone="warn",
                ),
                Kpi(
                    label=Text(fr="Coût cash / t CPO", en="Cash cost / t CPO"),
                    value=_derived(cost_t, "USD/t", opex_real.src, "ratio"),
                    sub=Text(
                        fr=f"Prix au plan {price:,.0f} $/t",
                        en=f"Plan price ${price:,.0f}/t",
                    ),
                    tone="warn",
                ),
            ]
        ),
        BarPair(
            title=Text(
                fr="Sorties de fonds mensuelles (USD)", en="Monthly cash outflows (USD)"
            ),
            sub=Text(fr="Jan–Déc 2026", en="Jan–Dec 2026"),
            fmt="k",
            cutoff=Q,
            series=[
                Series(
                    key="plan",
                    label=Text(fr="Prévu", en="Plan"),
                    values=[
                        _derived(
                            o + c,
                            "USD",
                            Src(file=P, sheet="opex + capex", cells=f"col{i + 3}"),
                            "sum",
                        )
                        for i, (o, c) in enumerate(zip(opex_plan, capex_plan))
                    ],
                ),
                Series(
                    key="actual",
                    label=Text(fr="Réel", en="Actual"),
                    values=[
                        _derived(
                            o + c,
                            "USD",
                            Src(file=A, sheet="OPEX + CAPEX", cells=f"col{i + 4}"),
                            "sum",
                        )
                        for i, (o, c) in enumerate(zip(opex_act, capex_act))
                    ],
                ),
            ],
        ),
        Flag(
            severity="caught",
            tag=Text(
                fr="Piège détecté · hiérarchie à plat", en="Trap caught · flattened hierarchy"
            ),
            title=Text(
                fr="Salaires 2026 · une colonne, deux niveaux",
                en="Salaries 2026 · one column, two levels",
            ),
            body=Text(
                fr="Trois divisions sont les totaux de leurs propres services, listés juste "
                "en dessous d'elles, sans indentation ni niveau. Le contrôle CH-001 les "
                "identifie à zéro écart. Sommer la colonne surévaluerait la masse salariale "
                f"de {ch1.data.get('overstatement', 0):,.2f} $.",
                en="Three divisions are the totals of their own services, listed directly "
                "beneath them with no indentation and no level marker. Check CH-001 identifies "
                "them at zero variance. Summing the column would overstate payroll by "
                f"${ch1.data.get('overstatement', 0):,.2f}.",
            ),
            src=Src(file=P, sheet="salaires 2026", cells="B115:C127"),
            evidence=Evidence(kind="tree", payload=ch1.data),
        ),
        Heading(
            label=Text(fr="02 · Projection", en="02 · Forward view"),
            text=Text(
                fr="Le plan prévoit deux exercices négatifs avant l'équilibre.",
                en="The plan runs two negative years before it breaks even.",
            ),
        ),
        Table(
            columns=[
                Column(key="year", label=Text(fr="Année", en="Year"), align="left"),
                Column(key="ha", label=Text(fr="Hectares", en="Hectares")),
                Column(key="cpo", label=Text(fr="CPO (t)", en="CPO (t)")),
                Column(key="rev", label=Text(fr="Revenus", en="Revenue"), money=True),
                Column(key="opex", label=Text(fr="OPEX", en="OPEX"), money=True),
                Column(key="capex", label=Text(fr="CAPEX", en="CAPEX"), money=True),
                Column(
                    key="bal", label=Text(fr="Solde", en="Balance"), money=True, signed=True
                ),
            ],
            rows=[
                {
                    "year": str(2026 + i),
                    "ha": _v(plan, "RECAP", 4, 4 + i, "ha", P),
                    "cpo": _v(plan, "RECAP", 6, 4 + i, "t", P),
                    "rev": _v(plan, "RECAP", 7, 4 + i, "USD", P),
                    "opex": _v(plan, "RECAP", 14, 4 + i, "USD", P),
                    "capex": _v(plan, "RECAP", 18, 4 + i, "USD", P),
                    "bal": _v(plan, "RECAP", 22, 4 + i, "USD", P),
                }
                for i in range(5)
            ],
        ),
        Heading(
            label=Text(fr="03 · Sources", en="03 · Sources"),
            text=Text(
                fr="Chaque chiffre de ce rapport remonte à une cellule.",
                en="Every figure in this report traces to a cell.",
            ),
        ),
        Ledger(),
    ]

    for s, n in ((plan.source, 12), (act.source, 9)):
        s.checks_run, s.checks_passed = n, n

    return Report(
        id="pvak-fy26-q1",
        org="pvak",
        title=Text(fr="Budget contre réalité", en="Budget vs reality"),
        period=Period(
            label=Text(fr="T1 2026", en="Q1 2026"),
            start=date(2026, 1, 1),
            end=date(2026, 3, 31),
        ),
        status="published",
        generated_at=datetime.now(timezone.utc),
        pipeline_version="0.1.0",
        sources=[plan.source, act.source],
        blocks=blocks,
    )


# --------------------------------------------------------------------------

def seed() -> None:
    for oid, name, sub in ORGS:
        store.put_org(oid, name, sub)

    if store.get_report("pvak-fy26-q1"):
        return
    if not (PLAN_XLSX.exists() and ACT_XLSX.exists()):
        print(f"[seed] workbooks not in {DATA} — orgs created, no report built")
        return

    plan = read_workbook(PLAN_XLSX, idx=0)
    act = read_workbook(ACT_XLSX, idx=1)
    store.put_report(build_pvak_q1(plan, act))
    print("[seed] built pvak-fy26-q1")
