/**
 * lumnia-ui / tokens
 *
 * Single source of truth for the Lumnia document aesthetic.
 * Extracted verbatim from the PVAK financial intelligence dashboard.
 * Change a value here and every surface follows.
 */

/** Core palette. Cream paper, forest/gold two-value accent system. */
export const color = {
  // Surfaces
  bg: "#F4F0E6", // page / paper
  panel: "#FEFCF8", // raised card
  panel2: "#EDE8DC", // recessed well, table stripe
  border: "#D5CEBC", // hairline

  // Ink
  text: "#1A1916",
  muted: "#8A8375",

  // Green value scale (primary metric family)
  forest: "#2C5F1A",
  leaf: "#4D8C2E",
  sage: "#7DA05A",

  // Gold value scale (secondary metric family)
  gold: "#A67C2A",
  amber: "#C8A04A",

  // Earth value scale (tertiary / cost family)
  earth: "#7A4E2E",
  clay: "#9E6845",

  // Signal
  red: "#B03A2A",
};

/** Back-compat alias. The PVAK file imports this as `C`. */
export const C = color;

/**
 * Semantic aliases. Prefer these in new code so a palette swap
 * does not mean a find-and-replace across every chart.
 */
export const semantic = {
  primary: color.forest,
  primarySoft: color.leaf,
  primaryFaint: color.sage,
  secondary: color.gold,
  secondarySoft: color.amber,
  cost: color.earth,
  costSoft: color.clay,
  danger: color.red,
  ink: color.text,
  inkMuted: color.muted,
  surface: color.panel,
  surfaceSunken: color.panel2,
  surfacePage: color.bg,
  line: color.border,
};

/** Ordered series ramp for multi-line and multi-bar charts. */
export const series = [
  color.forest,
  color.gold,
  color.leaf,
  color.earth,
  color.amber,
  color.sage,
  color.clay,
  color.red,
];

/** 4px base scale. */
export const space = { xs: 4, sm: 8, md: 14, lg: 18, xl: 22, xxl: 32 };

/** Radii, matched to the extracted primitives. */
export const radius = { tooltip: 6, card: 10, pill: 999, bar: 2 };

/**
 * Type scale. Labels are small, uppercase and letter-spaced.
 * Values are large and tight. That contrast is the whole look.
 */
export const type = {
  mono: "monospace",
  label: {
    fontSize: 10,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
  },
  value: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  body: { fontSize: 11, lineHeight: 1.4 },
  tooltipLabel: { fontSize: 10, fontFamily: "monospace" },
  tooltipValue: { fontSize: 12 },
  axis: { fontSize: 9, fontFamily: "monospace" },
};

export const shadow = {
  tooltip: "0 4px 12px rgba(0,0,0,0.08)",
};

export default { color, C, semantic, series, space, radius, type, shadow };
