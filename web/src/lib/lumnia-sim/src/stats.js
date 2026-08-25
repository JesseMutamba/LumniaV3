/**
 * lumnia-sim / stats
 *
 * Distribution summary. percentile and buildHistogram are the original
 * implementations with the degenerate cases closed.
 */

/** Linear-interpolated percentile. p in [0, 100]. */
export function percentile(arr, p) {
  if (!arr || arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Equal-width histogram.
 * The original divided by (mx - mn) with no guard, so a degenerate sample
 * where every draw is identical produced step = 0 and a bin array of NaN.
 */
export function buildHistogram(values, bins = 30) {
  if (!values || values.length === 0) return [];
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const span = mx - mn;

  if (span === 0) {
    return [{ x: mn, count: values.length, pct: 100 }];
  }

  const step = span / bins;
  const hist = Array.from({ length: bins }, (_, i) => ({
    x: mn + i * step + step / 2,
    count: 0,
    pct: 0,
  }));
  for (const v of values) {
    const i = Math.min(Math.floor((v - mn) / step), bins - 1);
    hist[i].count++;
  }
  const total = values.length;
  hist.forEach((h) => (h.pct = (h.count / total) * 100));
  return hist;
}

/** Mean, population sd, and the three percentiles every deck asks for. */
export function summarize(values) {
  if (!values || values.length === 0) {
    return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN, p10: NaN, p50: NaN, p90: NaN };
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    n,
    mean,
    sd: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
    p10: percentile(values, 10),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
  };
}

/** Share of draws at or above a threshold, as a percentage. */
export function probabilityAbove(values, threshold) {
  if (!values || values.length === 0) return 0;
  return (values.filter((v) => v >= threshold).length / values.length) * 100;
}
