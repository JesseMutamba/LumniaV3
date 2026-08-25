/**
 * lumnia-ui / format
 *
 * Display formatters. Extracted verbatim from the PVAK dashboard,
 * plus the two that were being written inline at call sites.
 *
 * These are DISPLAY ONLY. Never round in the compute layer.
 */

/** 1234567 -> "$1.23M" | 45678 -> "$46K" | 890 -> "$890" */
export const fmt = (n) =>
  n >= 1e6
    ? `$${(n / 1e6).toFixed(2)}M`
    : n >= 1e3
    ? `$${(n / 1e3).toFixed(0)}K`
    : `$${Math.round(n).toLocaleString()}`;

/** Unitless sibling of fmt. 1234567 -> "1.2M" */
export const fmtN = (n, d = 1) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(d)}M`
    : n >= 1e3
    ? `${(n / 1e3).toFixed(d)}K`
    : String(Math.round(n));

/** 0.7234 -> "72.3%" when fraction, 72.34 -> "72.3%" when already a percent. */
export const fmtPct = (n, d = 1, { fraction = false } = {}) =>
  `${((fraction ? n * 100 : n)).toFixed(d)}%`;

/** Thousands-separated integer. */
export const fmtInt = (n) => Math.round(n).toLocaleString();

/** Physical quantities: 1187 -> "1 187 t" */
export const fmtUnit = (n, unit, d = 0) =>
  `${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })} ${unit}`;

export default { fmt, fmtN, fmtPct, fmtInt, fmtUnit };
