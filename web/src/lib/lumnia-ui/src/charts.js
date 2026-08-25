/**
 * lumnia-ui / charts
 *
 * Recharts prop presets. Spread these instead of re-typing axis config
 * on every chart, which is how six charts end up with five tick sizes.
 *
 *   <CartesianGrid {...gridProps} />
 *   <XAxis dataKey="year" {...axisProps} />
 *   <YAxis {...axisProps} tickFormatter={fmt} />
 *   <Tooltip content={<ChartTooltip />} {...tooltipProps} />
 *   <Legend {...legendProps} />
 *
 * Note: these are calibrated to the PVAK dashboard's rendered look, not
 * copied line-for-line out of it. Diff them against a chart you like
 * before you trust them on a client deliverable.
 */

import { color as c, series } from "./tokens.js";

export const gridProps = {
  strokeDasharray: "3 3",
  stroke: c.border,
  vertical: false,
};

export const axisProps = {
  stroke: c.muted,
  tick: { fill: c.muted, fontSize: 10, fontFamily: "monospace" },
  tickLine: false,
  axisLine: { stroke: c.border },
};

export const tooltipProps = {
  cursor: { stroke: c.border, strokeWidth: 1 },
};

export const legendProps = {
  iconType: "plainline",
  wrapperStyle: { fontSize: 11, color: c.muted, paddingTop: 8 },
};

/** Consistent line styling across every trend chart. */
export const lineProps = {
  strokeWidth: 2,
  dot: { r: 3, strokeWidth: 0 },
  activeDot: { r: 5 },
};

export const barProps = {
  radius: [2, 2, 0, 0],
  maxBarSize: 44,
};

/** Deterministic colour per series index. Never random, never re-ordered. */
export const seriesColor = (i) => series[i % series.length];

/** Map an array of series keys to fixed colours, so a legend never shifts. */
export const seriesPalette = (keys = []) =>
  Object.fromEntries(keys.map((k, i) => [k, seriesColor(i)]));

export default {
  gridProps,
  axisProps,
  tooltipProps,
  legendProps,
  lineProps,
  barProps,
  seriesColor,
  seriesPalette,
};
