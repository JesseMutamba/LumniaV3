/**
 * lumnia-sim / oracle tests
 *
 * Deterministic. Every expected value is either computed from the ORIGINAL
 * PVAK formulas held here for comparison, or pinned by hand.
 *
 * Green or it didn't happen.
 */

import { renderToStaticMarkup } from "react-dom/server";
import {
  applyFactors, computeScenario, aggregate, computeAll, factorsOf,
  NEUTRAL, SCENARIO_DEFS, DRIVERS, PRICE_BASE,
  percentile, buildHistogram, summarize, probabilityAbove,
  runMonteCarlo, metricValues, baselineTotals, DEFAULT_PARAMS,
  mulberry32, hashSeed, seededNormal,
} from "../src/index.js";
import ScenarioTab from "../ui/ScenarioTab.jsx";
import MonteCarloTab from "../ui/MonteCarloTab.jsx";

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};
const near = (a, b, tol = 1e-9) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/* Synthetic rows. Deliberately not six, to catch the hardcoded index 5. */
const ROWS = [
  { year: "Y1", revenue: 100_000, cpo: 100, opex: 80_000, capex: 10_000 },
  { year: "Y2", revenue: 250_000, cpo: 240, opex: 150_000, capex: 20_000 },
  { year: "Y3", revenue: 400_000, cpo: 390, opex: 200_000, capex: 15_000 },
  { year: "Y4", revenue: 900_000, cpo: 880, opex: 300_000, capex: 5_000 },
];

/* ── The ORIGINAL formulas, kept verbatim as the oracle ──────────────── */
const origScenarioRow = (d, f) => {
  const basePricePerT = d.revenue / d.cpo;
  const adjCpo = d.cpo * f.yieldFactor * f.extractionFactor;
  const adjRevenue = adjCpo * basePricePerT * f.cpoPriceFactor;
  const adjOpex = d.opex * f.opexFactor;
  return { revenue: adjRevenue, opex: adjOpex, margin: adjRevenue - adjOpex };
};
const origMonteRow = (d, cpoPrice, yieldFac, extractFac, opexFac) => {
  const basePricePerT = d.revenue / d.cpo;
  const adjCpo = d.cpo * yieldFac * extractFac;
  return { revenue: (adjCpo * basePricePerT * cpoPrice) / 1000, opex: d.opex * opexFac };
};

/* ── 1. Faithfulness to the original ─────────────────────────────────── */
{
  const f = { cpoPriceFactor: 1.3, yieldFactor: 1.15, extractionFactor: 1.08, opexFactor: 0.9, capexFactor: 0.95 };
  const mine = computeScenario(ROWS, f);
  const orig = ROWS.map((d) => origScenarioRow(d, f));
  ok("scenario revenue matches the original formula exactly",
    mine.every((r, i) => near(r.revenue, orig[i].revenue)));
  ok("scenario opex matches the original formula exactly",
    mine.every((r, i) => near(r.opex, orig[i].opex)));
  ok("scenario margin matches the original formula exactly",
    mine.every((r, i) => near(r.margin, orig[i].margin)));

  const cpoPrice = 1150;
  const mineMC = ROWS.map((d) => applyFactors(d, {
    cpoPriceFactor: cpoPrice / PRICE_BASE, yieldFactor: 1.05, extractionFactor: 0.98, opexFactor: 1.1,
  }));
  const origMC = ROWS.map((d) => origMonteRow(d, cpoPrice, 1.05, 0.98, 1.1));
  ok("monte carlo revenue matches the original formula exactly",
    mineMC.every((r, i) => near(r.revenue, origMC[i].revenue)));
  ok("scenario and monte carlo paths now agree by construction",
    near(
      applyFactors(ROWS[0], { cpoPriceFactor: 1.4 }).revenue,
      ROWS[0].revenue * 1.4
    ));
}

/* ── 2. Model identities ─────────────────────────────────────────────── */
{
  const neutral = computeScenario(ROWS, NEUTRAL);
  ok("neutral factors return the rows unchanged",
    neutral.every((r, i) => near(r.revenue, ROWS[i].revenue) && near(r.opex, ROWS[i].opex)));

  const a = applyFactors(ROWS[1], { yieldFactor: 1.15, extractionFactor: 1.0 });
  const b = applyFactors(ROWS[1], { yieldFactor: 1.0, extractionFactor: 1.15 });
  ok("yield and extraction are the same lever (collinear, as documented)",
    near(a.revenue, b.revenue) && near(a.volumeFactor, b.volumeFactor));
  ok("DRIVERS marks that collinearity so the UI can say so",
    DRIVERS.find((d) => d.key === "yieldFactor").collinearWith === "extractionFactor");

  ok("capexFactor is actually applied (the original defined it and ignored it)",
    near(applyFactors(ROWS[0], { capexFactor: 1.1 }).capex, 11_000));

  ok("zero-revenue row yields marginPct 0, not NaN",
    applyFactors({ year: "Z", revenue: 0, cpo: 0, opex: 500, capex: 0 }).marginPct === 0);

  ok("bear is worse than bull on every year",
    computeScenario(ROWS, SCENARIO_DEFS.bear)
      .every((r, i) => r.revenue < computeScenario(ROWS, SCENARIO_DEFS.bull)[i].revenue));
}

/* ── 3. Aggregation, and the hardcoded-index-5 bug ───────────────────── */
{
  const t = aggregate(computeScenario(ROWS, NEUTRAL));
  ok("totals sum the rows", near(t.revenue, 1_650_000) && near(t.opex, 730_000));
  ok("total margin is revenue minus opex", near(t.margin, 920_000));
  ok("finalMarginPct reads the LAST row, with only 4 rows present",
    near(t.finalMarginPct, ((900_000 - 300_000) / 900_000) * 100));

  const eight = aggregate(computeScenario([...ROWS, ...ROWS], NEUTRAL));
  ok("an 8-row window aggregates without NaN",
    Number.isFinite(eight.revenue) && Number.isFinite(eight.finalMarginPct));
  ok("empty rows aggregate to zeros, not NaN", aggregate([]).revenue === 0);

  const all = computeAll(ROWS, NEUTRAL);
  ok("computeAll returns four scenarios", Object.keys(all).length === 4);
  ok("custom at neutral equals base", near(all.custom.totals.revenue, all.base.totals.revenue));
  ok("factorsOf strips label and accent",
    Object.keys(factorsOf(SCENARIO_DEFS.bull)).length === 5);
}

/* ── 4. Statistics ───────────────────────────────────────────────────── */
{
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  ok("percentile p50 interpolates", near(percentile(v, 50), 5.5));
  ok("percentile p0 is the min", percentile(v, 0) === 1);
  ok("percentile p100 is the max", percentile(v, 100) === 10);
  ok("percentile of empty is NaN", Number.isNaN(percentile([], 50)));
  ok("percentile of one value is that value", percentile([42], 90) === 42);

  const h = buildHistogram(v, 5);
  ok("histogram bins sum to 100%", near(h.reduce((s, b) => s + b.pct, 0), 100, 1e-9));
  ok("histogram counts sum to n", h.reduce((s, b) => s + b.count, 0) === 10);
  ok("degenerate histogram does not produce NaN (original divided by zero)",
    buildHistogram([7, 7, 7], 30).every((b) => Number.isFinite(b.x) && Number.isFinite(b.pct)));

  const s = summarize(v);
  ok("summarize mean", near(s.mean, 5.5));
  ok("summarize population sd", near(s.sd, Math.sqrt(8.25)));
  ok("probabilityAbove counts inclusively", near(probabilityAbove(v, 8), 30));
}

/* ── 5. Seeded randomness ────────────────────────────────────────────── */
{
  const r1 = mulberry32(12345), r2 = mulberry32(12345);
  ok("same seed gives the same uniform stream",
    Array.from({ length: 5 }, () => r1()).join() === Array.from({ length: 5 }, () => r2()).join());
  ok("uniforms stay inside [0,1)",
    Array.from({ length: 2000 }, () => mulberry32(9)()).every((x) => x >= 0 && x < 1));
  ok("hashSeed is stable across calls", hashSeed({ a: 1, b: 2 }) === hashSeed({ a: 1, b: 2 }));
  ok("hashSeed separates different inputs", hashSeed({ a: 1 }) !== hashSeed({ a: 2 }));

  const n = seededNormal(7);
  const draws = Array.from({ length: 20000 }, n);
  const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
  const sd = Math.sqrt(draws.reduce((s, x) => s + (x - mean) ** 2, 0) / draws.length);
  ok("normals are ~N(0,1)", Math.abs(mean) < 0.03 && Math.abs(sd - 1) < 0.03,
    `mean=${mean.toFixed(4)} sd=${sd.toFixed(4)}`);
}

/* ── 6. Monte Carlo ──────────────────────────────────────────────────── */
{
  const a = runMonteCarlo(ROWS, { N: 800 });
  const b = runMonteCarlo(ROWS, { N: 800 });
  ok("identical params reproduce identical trials (the original did not)",
    JSON.stringify(a.trials) === JSON.stringify(b.trials));
  ok("the seed is returned so a client number can be reproduced later",
    Number.isInteger(a.seed));
  ok("an explicit seed overrides the derived one",
    runMonteCarlo(ROWS, { N: 50 }, { seed: 1 }).seed === 1);
  ok("different seeds give different draws",
    JSON.stringify(runMonteCarlo(ROWS, { N: 50 }, { seed: 1 }).trials) !==
    JSON.stringify(runMonteCarlo(ROWS, { N: 50 }, { seed: 2 }).trials));
  ok("N is honoured", a.trials.length === 800);
  ok("totalCapex is returned (the original computed and discarded it)",
    a.trials.every((t) => Number.isFinite(t.totalCapex)));

  /* The bug that mattered: with sd=0 the draw is deterministic, so revenue
     must be exactly the plan scaled by price/PRICE_BASE. The original divided
     by a bare 1000 and only agreed with the scenario path at mu=1000. */
  const zero = { cpoPriceMu: 2000, cpoPriceSd: 0, yieldMu: 1, yieldSd: 0, extractMu: 1, extractSd: 0, opexMu: 1, opexSd: 0, N: 10 };
  const plan = baselineTotals(ROWS);
  ok("price enters as a factor: mu=2000 doubles plan revenue exactly",
    near(runMonteCarlo(ROWS, zero).trials[0].totalRevenue, plan.revenue * 2, 1e-9));
  ok("at mu=PRICE_BASE with no variance the simulation equals the plan",
    near(runMonteCarlo(ROWS, { ...zero, cpoPriceMu: PRICE_BASE }).trials[0].totalRevenue, plan.revenue));

  const vals = metricValues(a.trials, "totalRevenue");
  const st = summarize(vals);
  ok("p10 <= p50 <= p90", st.p10 <= st.p50 && st.p50 <= st.p90);
  ok("median lands near plan with default params",
    Math.abs(st.p50 - plan.revenue) / plan.revenue < 0.10,
    `p50=${Math.round(st.p50)} plan=${Math.round(plan.revenue)}`);
  ok("floors hold: no trial has a price below the floor",
    a.trials.every((t) => t.cpoPrice >= 400));
  ok("DEFAULT_PARAMS still carries the dashboard's numbers",
    DEFAULT_PARAMS.cpoPriceMu === 1000 && DEFAULT_PARAMS.cpoPriceSd === 150 && DEFAULT_PARAMS.N === 2000);
}

/* ── 7. The tabs render ──────────────────────────────────────────────── */
{
  const warnings = [];
  const realError = console.error;
  console.error = (...args) => warnings.push(String(args[0]));

  const s = renderToStaticMarkup(<ScenarioTab rows={ROWS} />);
  ok("ScenarioTab renders", s.length > 2000);
  ok("ScenarioTab shows every scenario label",
    ["Baisse", "Base", "Hausse", "Personnalisé"].every((l) => s.includes(l)));
  ok("ScenarioTab renders one row per projection year",
    ROWS.every((r) => s.includes(">" + r.year + "<")));
  ok("ScenarioTab surfaces the collinearity note", s.includes("one lever"));
  ok("ScenarioTab handles empty rows", renderToStaticMarkup(<ScenarioTab rows={[]} />).includes("No projection data"));

  const m = renderToStaticMarkup(<MonteCarloTab rows={ROWS} />);
  ok("MonteCarloTab renders", m.length > 2000);
  ok("MonteCarloTab exposes an extraction control (the original had none)",
    m.includes("Extraction factor"));
  ok("MonteCarloTab handles empty rows", renderToStaticMarkup(<MonteCarloTab rows={[]} />).includes("No projection data"));

  console.error = realError;
  var keyWarnings = warnings.filter((w) => /unique .?key/i.test(w));
  ok("no missing-key warnings (the original table used unkeyed fragments)",
    keyWarnings.length === 0, keyWarnings.join(" | "));
}

console.log(`\n${fails === 0 ? "GREEN" : "RED"} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
