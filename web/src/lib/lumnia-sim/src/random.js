/**
 * lumnia-sim / random
 *
 * Seeded pseudo-randomness. The original engine called Math.random(),
 * which meant a signed client report showed different P10 / P50 / P90
 * every time somebody refreshed the page. For a deliverable whose whole
 * pitch is provenance, that is the single worst defect in the model.
 *
 * Everything here is deterministic given a seed.
 */

/** mulberry32. Small, fast, good enough for a financial Monte Carlo. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of any JSON-serialisable value. FNV-1a. */
export function hashSeed(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Standard normal deviates via Box-Muller.
 * The original threw away the second deviate on every call. This one keeps it,
 * which halves the uniform draws needed. Same distribution, half the work.
 */
export function normalSource(rand) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0,
      v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

/** Convenience: a seeded normal generator in one call. */
export function seededNormal(seed) {
  return normalSource(mulberry32(seed));
}
