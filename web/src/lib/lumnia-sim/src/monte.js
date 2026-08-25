/**
 * lumnia-sim / monte
 *
 * Monte Carlo over the same applyFactors model the scenario tab uses.
 *
 * Two things changed from the original and both are load-bearing:
 *
 *  1. SEEDED. Same inputs, same distribution, every time. The original used
 *     Math.random(), so a client refreshing a signed report saw a different
 *     P10 each time.
 *
 *  2. PRICE IS A FACTOR, NOT A DIVISION. The original divided simulated
 *     revenue by a bare 1000 while the scenario path used a plain multiplier.
 *     The two only agreed because the default price mean happened to be 1000.
 *     Drag the mean to 1400 and the simulation silently inflated revenue 40%
 *     against a baseline that never moved. Here both paths divide by
 *     PRICE_BASE explicitly, so they agree by construction.
 */

import { applyFactors, aggregate, PRICE_BASE } from "./model.js";
import { mulberry32, normalSource, hashSeed } from "./random.js";

/** Distribution parameters, matching the PVAK dashboard's defaults. */
export const DEFAULT_PARAMS = {
  cpoPriceMu: 1000,
  cpoPriceSd: 150,
  yieldMu: 1.0,
  yieldSd: 0.1,
  extractMu: 1.0,
  extractSd: 0.03,
  opexMu: 1.0,
  opexSd: 0.08,
  capexMu: 1.0,
  capexSd: 0.0,
  N: 2000,
};

/** Floors, so a tail draw cannot produce a negative price or a zero yield. */
export const FLOORS = {
  cpoPrice: 400,
  yield: 0.3,
  extract: 0.12,
  opex: 0.5,
  capex: 0.5,
};

/**
 * Run N trials.
 *
 * @param {Array}  rows   projection rows. Never bundled with this package.
 * @param {Object} params distribution parameters, see DEFAULT_PARAMS
 * @param {Object} [opts]
 * @param {number} [opts.seed] explicit seed. Defaults to a stable hash of
 *                             params, so identical inputs reproduce exactly.
 * @returns {{trials: Array, seed: number, params: Object}}
 */
export function runMonteCarlo(rows, params = {}, opts = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const seed = opts.seed ?? hashSeed({ ...p, rowCount: rows?.length ?? 0 });
  const normal = normalSource(mulberry32(seed));

  const trials = [];
  for (let i = 0; i < p.N; i++) {
    const cpoPrice = Math.max(FLOORS.cpoPrice, p.cpoPriceMu + normal() * p.cpoPriceSd);
    const yieldFactor = Math.max(FLOORS.yield, p.yieldMu + normal() * p.yieldSd);
    const extractionFactor = Math.max(FLOORS.extract, p.extractMu + normal() * p.extractSd);
    const opexFactor = Math.max(FLOORS.opex, p.opexMu + normal() * p.opexSd);
    const capexFactor =
      p.capexSd > 0
        ? Math.max(FLOORS.capex, p.capexMu + normal() * p.capexSd)
        : p.capexMu;

    const factors = {
      cpoPriceFactor: cpoPrice / PRICE_BASE,
      yieldFactor,
      extractionFactor,
      opexFactor,
      capexFactor,
    };

    const t = aggregate(rows.map((r) => applyFactors(r, factors)));

    trials.push({
      totalRevenue: t.revenue,
      totalOpex: t.opex,
      totalCapex: t.capex, // the original accumulated this and never returned it
      totalMargin: t.margin,
      finalYearMarginPct: t.finalMarginPct,
      cpoPrice,
      yieldFactor,
      extractionFactor,
      opexFactor,
      volumeFactor: yieldFactor * extractionFactor,
    });
  }

  return { trials, seed, params: p };
}

/** Pull one metric out of a trial set, ready for stats or a histogram. */
export function metricValues(trials, key) {
  return trials.map((t) => t[key]);
}

/**
 * Baseline for "probability of beating plan".
 * Computed from the rows at neutral factors, so it moves with the data
 * instead of being compared against a constant that assumes price mean 1000.
 */
export function baselineTotals(rows) {
  return aggregate(rows.map((r) => applyFactors(r)));
}
