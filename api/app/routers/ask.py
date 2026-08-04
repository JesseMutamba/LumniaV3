"""The ask surface — a question in, a verified answer out.

Two modes, and the difference is what the platform is allowed to do:

  direct   answers from analyses already run. Nothing is recomputed and no
           model touches a number; the answer is the stored block, its cell
           provenance and its lineage exactly as computed at ingest.

  analyze  plans first, visibly, then runs. The plan says which modules will
           run against which workbooks under which context version; the
           author sees it before anything executes. Execution is the same
           module code the ingest path runs — a question cannot reach an
           analysis the platform would not otherwise perform.

In both modes the model's job is to read menus: which metric is this
question about, which named analyses answer it. It never computes, and
every name it returns is checked against the registry before use.
"""
from __future__ import annotations

import re
import tempfile
import unicodedata
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .. import store
from ..auth import require_author
from ..pipeline import llm
from ..pipeline.ingest import read_workbook
from ..pipeline.modules import DEFAULT_MODULES, MODULES, facts_of, run_modules
from ..pipeline.parse import detect_tables
from ..schema import Text

router = APIRouter()
author = Depends(require_author)


# --------------------------------------------------------------------------
# models
# --------------------------------------------------------------------------

class AskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    org: str
    question: str = Field(min_length=1, max_length=500)
    mode: str = "direct"          # "direct" | "analyze"
    execute: bool = False         # analyze: false returns the plan, true runs it
    plan: "Plan | None" = None    # the plan the author saw and accepted


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    modules: list[str] = []
    metrics: list[str] = []
    files: list[str] = []
    context_version: int | None = None
    rationale: Text
    planner: str = "rules"        # "rules" | "claude" — who chose


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: str
    question: str
    plan: Plan | None = None
    blocks: list[dict] = []
    sources: list[dict] = []
    as_of: str | None = None
    note: Text | None = None


AskIn.model_rebuild()


# --------------------------------------------------------------------------
# matching — deliberately dumb, deliberately deterministic
# --------------------------------------------------------------------------

STOP = {
    "le", "la", "les", "de", "des", "du", "un", "une", "et", "est", "quel",
    "quelle", "quels", "quelles", "combien", "pour", "sur", "dans", "au",
    "aux", "ce", "cette", "que", "qui", "the", "of", "is", "what", "how",
    "much", "many", "for", "on", "in", "a", "an", "and", "our", "notre",
}


def _tokens(s: str) -> set[str]:
    """Words, accents folded — « exécution » and « execution » are one word."""
    flat = "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )
    return {w for w in re.split(r"[^a-z0-9]+", flat) if len(w) > 2 and w not in STOP}


def _score(question: str, label: str) -> int:
    q, l = _tokens(question), _tokens(label)
    return len(q & l)


# Words that name an analysis rather than a metric. Client vocabulary lives
# in the context; this is the platform's own vocabulary for its own modules.
MODULE_WORDS = {
    "coverage": {"code", "codes", "routage", "route", "routees", "coded",
                 "uncoded", "routing", "manquant", "manquants"},
    "reconciliation": {"doublon", "doublons", "rapprochement", "rapprocher",
                       "duplicate", "duplicates", "reconciliation", "journaux",
                       "journals"},
    "movements": {"bouge", "bouges", "mouvement", "mouvements", "change",
                  "changed", "moved", "evolution", "varie"},
    "budget-vs-actual": {"budget", "execution", "reel", "reels", "actual",
                         "actuals", "depense", "depenses", "spend"},
}


def _plan_rules(question: str, ctx) -> tuple[list[str], list[str]]:
    """Which analyses answer this question, and about which metrics —
    decided by matching words, so it works with no model available."""
    q = _tokens(question)
    metrics = [m for m in (ctx.metrics if ctx else {}) if _tokens(m) & q]
    modules = [name for name, words in MODULE_WORDS.items() if q & words]
    if metrics and "budget-vs-actual" not in modules:
        modules.append("budget-vs-actual")
    if not modules:
        modules = list(ctx.modules) if ctx and ctx.modules else list(DEFAULT_MODULES)
    return [m for m in modules if m in MODULES and m != "narrate"], metrics


def _plan_claude(question: str, ctx, modules: list[str], metrics: list[str]):
    """Let the model refine the choice — from the menu, never beyond it."""
    menu_modules = [n for n in MODULES if n != "narrate"]
    menu_metrics = list(ctx.metrics if ctx else {})
    out = llm.choose(
        system=(
            "You route a finance question to named analyses. You never compute "
            "and never invent names. Reply with JSON only: "
            '{"modules": [...], "metrics": [...], "why_fr": "...", "why_en": "..."} '
            "where every module is from the modules menu and every metric is "
            "from the metrics menu. Choose the fewest that answer the question."
        ),
        user=(
            f"Question: {question}\n"
            f"Modules menu: {menu_modules}\n"
            f"Metrics menu: {menu_metrics}\n"
            f"Module meanings: "
            + "; ".join(f"{n}: {MODULES[n].description_en}" for n in menu_modules)
        ),
        max_tokens=400,
    )
    if not out:
        return None
    picked = [m for m in out.get("modules", []) if m in menu_modules]
    picked_metrics = [m for m in out.get("metrics", []) if m in menu_metrics]
    if not picked:
        return None
    why_fr = str(out.get("why_fr") or "").strip()
    why_en = str(out.get("why_en") or "").strip()
    return picked, picked_metrics, Text(fr=why_fr or "—", en=why_en or None)


def build_plan(question: str, ctx, org: str) -> Plan:
    modules, metrics = _plan_rules(question, ctx)
    planner = "rules"
    rationale = Text(
        fr=f"Analyses retenues d'après les mots de la question : {', '.join(modules)}.",
        en=f"Analyses chosen from the question's wording: {', '.join(modules)}.",
    )
    refined = _plan_claude(question, ctx, modules, metrics) if llm.available() else None
    if refined:
        modules, metrics, rationale = refined
        planner = "claude"
    return Plan(
        modules=modules,
        metrics=metrics,
        files=store.latest_file_names(org),
        context_version=getattr(ctx, "version", None),
        rationale=rationale,
        planner=planner,
    )


# --------------------------------------------------------------------------
# the endpoint
# --------------------------------------------------------------------------

def _direct(org: str, question: str) -> Answer:
    """Answer from what has already been computed. No workbook is opened, no
    module runs, no model sees a number — the stored block is the answer.

    Candidates come from several recent analyses, best match first and the
    newer run winning ties, so a narrow answer never buries a broader one."""
    runs = store.recent_run_blocks(org)
    if not runs:
        return Answer(
            mode="direct", question=question,
            note=Text(
                fr="Aucune analyse enregistrée pour ce client — passez par « Analyser » d'abord.",
                en="No stored analysis for this client — run Analyse first.",
            ),
        )
    scored: list[tuple[int, int, dict, dict]] = []  # (score, -age, block, run)
    seen: set = set()
    for age, run in enumerate(runs):
        for b in run["blocks"]:
            if b.get("type") == "kpiGrid":
                for it in b["items"]:
                    key = ("kpi", it["label"].get("fr", ""))
                    if key in seen:
                        continue
                    seen.add(key)
                    s = _score(question, it["label"].get("fr", "")) + _score(
                        question, (it.get("sub") or {}).get("fr", "")
                    )
                    if it.get("metric"):
                        s += 2 * _score(question, it["metric"])
                    scored.append((s, -age, {"type": "kpiGrid", "items": [it]}, run))
            elif b.get("type") == "flag":
                key = ("flag", b["title"].get("fr", ""))
                if key in seen:
                    continue
                seen.add(key)
                s = _score(question, b["tag"].get("fr", "")) + _score(
                    question, b["title"].get("fr", "")
                )
                scored.append((s, -age, b, run))
    best = sorted(scored, key=lambda x: (-x[0], -x[1]))
    hits = [(b, run) for s, _, b, run in best if s > 0][:3]
    if not hits:
        return Answer(
            mode="direct", question=question, as_of=runs[0]["ts"],
            sources=runs[0]["sources"],
            note=Text(
                fr="Rien d'enregistré ne répond à cette question. « Analyser » relit les classeurs.",
                en="Nothing stored answers this question. Analyse re-reads the workbooks.",
            ),
        )
    top_run = hits[0][1]
    return Answer(
        mode="direct", question=question, blocks=[b for b, _ in hits],
        sources=top_run["sources"], as_of=top_run["ts"],
    )


def _load_workbooks(org: str):
    """The client's latest kept books, in their original file order."""
    wbs, names = [], []
    for i, f in enumerate(store.latest_files(org)):
        suffix = Path(f["filename"]).suffix.lower() or ".xlsx"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(f["body"])
            path = Path(tmp.name)
        try:
            wb = read_workbook(path, idx=i)
        finally:
            path.unlink(missing_ok=True)
        wb.source.filename = f["filename"]
        wbs.append(wb)
        names.append(f["filename"])
    return wbs, names


def _analyze(org: str, question: str, plan: Plan, ctx) -> Answer:
    wbs, names = _load_workbooks(org)
    if not wbs:
        return Answer(
            mode="analyze", question=question, plan=plan,
            note=Text(
                fr="Aucun classeur conservé pour ce client — analysez-en un au panneau 01.",
                en="No workbook kept for this client — analyse one in panel 01.",
            ),
        )
    tables = []
    for wb in wbs:
        tables += [(wb.source.idx, t) for t in detect_tables(wb, ctx)]
    names_to_run = [m for m in plan.modules if m in MODULES]
    if "narrate" in MODULES:
        names_to_run.append("narrate")
    blocks, ran = run_modules(names_to_run, wbs, tables, ctx, {})
    if not blocks:
        return Answer(
            mode="analyze", question=question, plan=plan,
            sources=[wb.source.model_dump(mode="json") for wb in wbs],
            note=Text(
                fr="Les analyses retenues n'ont rien produit sur ces classeurs.",
                en="The chosen analyses produced nothing on these workbooks.",
            ),
        )
    dumped = [b.model_dump(mode="json") for b in blocks]
    sources = [wb.source.model_dump(mode="json") for wb in wbs]
    # An answer is an analysis: it joins the timeline like any other run.
    store.put_run(org, ran, facts_of(blocks), blocks=dumped, sources=sources)
    plan = plan.model_copy(update={"files": names})
    return Answer(mode="analyze", question=question, plan=plan,
                  blocks=dumped, sources=sources)


@router.post("/studio/ask", response_model=Answer, tags=["studio"],
             dependencies=[author])
def ask(body: AskIn):
    """Direct answers from stored analyses; Analyze plans, shows the plan,
    and — on a second call carrying that plan — runs it."""
    if not store.get_org(body.org):
        raise HTTPException(404, f"Unknown org: {body.org}")
    if body.mode not in ("direct", "analyze"):
        raise HTTPException(422, "mode must be 'direct' or 'analyze'")
    if body.mode == "direct":
        return _direct(body.org, body.question)

    ctx = store.get_context(body.org)
    if not body.execute:
        return Answer(mode="analyze", question=body.question,
                      plan=build_plan(body.question, ctx, body.org))
    plan = body.plan or build_plan(body.question, ctx, body.org)
    unknown = [m for m in plan.modules if m not in MODULES]
    if unknown:
        raise HTTPException(422, f"Unknown module(s): {unknown}")
    return _analyze(body.org, body.question, plan, ctx)
