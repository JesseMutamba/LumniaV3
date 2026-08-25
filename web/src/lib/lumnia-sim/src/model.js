/**
 * lumnia-sim / model
 *
 * The palm oil operating model. One factor application, used by both the
 * deterministic scenario path and the Monte Carlo path, so the two can
 * never drift apart again.
 *
 * Row shape (a projection year), as produced by the PVAK model:
 *   { year, revenue, cpo, ffb, ha, haMgd, capex, opex,
 *     opexPerTCpo, totalPerTCpo, opexPerHa, margin, marginPct }
 * Only year, revenue, cpo, opex and capex are read here. The rest ride along.
 *
 * NO CLIENT DATA LIVES IN THIS PACKAGE. Rows are always passed in.
 */

/** Reference CPO price in $/T. A price factor of 1.0 means exactly this. */
export const PRICE_BASE = 1000;

/** Reference oil extraction rate. Display only, never enters the maths. */
export const EXTRACTION_BASE = 0.23;

/** Neutral factor set. Applying this returns the input rows unchanged. */
export const NEUTRAL = {
  cpoPriceFactor: 1.0,
  yieldFactor: 1.0,
  extractionFactor: 1.0,
  opexFactor: 1.0,
  capexFactor: 1.0,
};

/**
 * Driver definitions. The UI builds its sliders from this list, so adding a
 * driver here is the only edit needed to expose it. `collinearWith` marks
 * levers that are mathematically indistinguishable from another, which the
 * UI surfaces rather than hides.
 */
export const DRIVERS = [
  {
    key: "cpoPriceFactor",
    label: "Prix CPO",
    min: 0.5,
    max: 1.8,
    step: 0.05,
    accent: "amber",
    format: (v) => `$${Math.round(PRICE_BASE * v)}/T`,
  },
  {
    key: "yieldFactor",
    label: "Facteur de Rendement",
    min: 0.5,
    max: 1.5,
    step: 0.05,
    accent: "leaf",
    format: (v) => `${Math.round(v * 100)}%`,
    collinearWith: "extractionFactor",
  },
  {
    key: "extractionFactor",
    label: "Taux d'Extraction",
    min: 0.7,
    max: 1.3,
    step: 0.05,
    accent: "forest",
    format: (v) => `${(EXTRACTION_BASE * v * 100).toFixed(1)}%`,
    collinearWith: "yieldFactor",
  },
  {
    key: "opexFactor",
    label: "Facteur OPEX",
    min: 0.7,
    max: 1.5,
    step: 0.05,
    accent: "earth",
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "capexFactor",
    label: "Facteur CAPEX",
    min: 0.7,
    max: 1.5,
    step: 0.05,
    accent: "clay",
    format: (v) => `${Math.round(v * 100)}%`,
  },
];

/** Preset scenarios. Factors verbatim from the PVAK dashboard. */
export const SCENARIO_DEFS = {
  bear: {
    key: "bear",
    label: "Baisse",
    accent: "red",
    cpoPriceFactor: 0.7,
    yieldFactor: 0.8,
    extractionFactor: 0.9,
    opexFactor: 1.2,
    capexFactor: 1.1,
  },
  base: {
    key: "base",
    label: "Base",
    accent: "gold",
    cpoPriceFactor: 1.0,
    yieldFactor: 1.0,
    extractionFactor: 1.0,
    opexFactor: 1.0,
    capexFactor: 1.0,
  },
  bull: {
    key: "bull",
    label: "Hausse",
    accent: "forest",
    cpoPriceFactor: 1.3,
    yieldFactor: 1.15,
    extractionFactor: 1.08,
    opexFactor: 0.9,
    capexFactor: 0.95,
  },
};

export const SCENARIO_KEYS = ["bear", "base", "bull", "custom"];

/**
 * Apply one factor set to one row. This is the whole model.
 *
 * Volume and extraction enter identically, which is why `volumeFactor` is
 * returned: it is the only volume degree of freedom the model actually has.
 * Two sliders, one lever. Say so in front of a client rather than letting
 * them believe they are tuning independent operations.
 */
export function applyFactors(row, factors = {}) {
  const f = { ...NEUTRAL, ...factors };
  const volumeFactor = f.yieldFactor * f.extractionFactor;

  const revenue = row.revenue * volumeFactor * f.cpoPriceFactor;
  const opex = row.opex * f.opexFactor;
  const capex = (row.capex ?? 0) * f.capexFactor;
  const margin = revenue - opex;

  return {
    year: row.year,
    revenue,
    opex,
    capex,
    margin,
    marginPct: revenue > 0 ? (margin / revenue) * 100 : 0,
    cpo: (row.cpo ?? 0) * volumeFactor,
    volumeFactor,
    priceFactor: f.cpoPriceFactor,
  };
}

/** Apply a factor set across every projection row. */
export function computeScenario(rows, factors) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((r) => applyFactors(r, factors));
}

/**
 * Totals for a computed scenario.
 * `finalMarginPct` reads the LAST row, not a hardcoded index 5. The original
 * indexed [5] in four places, so any window that was not exactly six years
 * silently produced undefined and NaN.
 */
export function aggregate(scenarioRows) {
  const empty = {
    revenue: 0, opex: 0, capex: 0, margin: 0, marginPct: 0, finalMarginPct: 0,
  };
  if (!scenarioRows || scenarioRows.length === 0) return empty;

  const t = scenarioRows.reduce(
    (s, r) => ({
      revenue: s.revenue + r.revenue,
      opex: s.opex + r.opex,
      capex: s.capex + r.capex,
      margin: s.margin + r.margin,
    }),
    { revenue: 0, opex: 0, capex: 0, margin: 0 }
  );

  const last = scenarioRows[scenarioRows.length - 1];
  return {
    ...t,
    marginPct: t.revenue > 0 ? (t.margin / t.revenue) * 100 : 0,
    finalMarginPct: last.marginPct,
  };
}

/** Compute all four scenarios at once, with their totals. */
export function computeAll(rows, custom) {
  const out = {};
  for (const key of ["bear", "base", "bull"]) {
    const scenarioRows = computeScenario(rows, SCENARIO_DEFS[key]);
    out[key] = { def: SCENARIO_DEFS[key], rows: scenarioRows, totals: aggregate(scenarioRows) };
  }
  const customRows = computeScenario(rows, custom ?? NEUTRAL);
  out.custom = {
    def: { key: "custom", label: "Personnalisé", accent: "amber", ...(custom ?? NEUTRAL) },
    rows: customRows,
    totals: aggregate(customRows),
  };
  return out;
}

/** Factors only, stripped of label/accent. For loading a preset into custom. */
export function factorsOf(def) {
  const { cpoPriceFactor, yieldFactor, extractionFactor, opexFactor, capexFactor } = def;
  return { cpoPriceFactor, yieldFactor, extractionFactor, opexFactor, capexFactor };
}
