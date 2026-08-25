/**
 * lumnia-ui / primitives
 *
 * The five building blocks every Lumnia report surface is made of.
 * Lifted from the PVAK dashboard, renamed, and given defaults.
 *
 * Zero dependencies beyond React. Inline styles on purpose: these drop
 * into any React app with no build config, no CSS import order problem,
 * and no chance of a client stylesheet leaking in.
 *
 *   Panel         raised card, the container for everything
 *   SectionTitle  accent bar + uppercase label + optional subtitle
 *   StatCard      the KPI tile
 *   RangeSlider   labelled input[type=range] with min/max rails
 *   ChartTooltip  Recharts <Tooltip content={<ChartTooltip />} />
 */

import { color as c, radius, type } from "./tokens.js";
import { fmt } from "./format.js";

/* ── Panel ────────────────────────────────────────────────────────────────── */

export const Panel = ({ children, style, ...rest }) => (
  <div
    {...rest}
    style={{
      background: c.panel,
      border: `1px solid ${c.border}`,
      borderRadius: radius.card,
      padding: 22,
      ...style,
    }}
  >
    {children}
  </div>
);

/* ── SectionTitle ─────────────────────────────────────────────────────────── */

export const SectionTitle = ({ children, sub, accent }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 3,
          height: 16,
          background: accent || c.forest,
          borderRadius: radius.bar,
        }}
      />
      <h2 style={{ color: c.text, ...type.sectionTitle, margin: 0 }}>
        {children}
      </h2>
    </div>
    {sub && (
      <p
        style={{
          color: c.muted,
          fontSize: 11,
          margin: "5px 0 0 11px",
          lineHeight: 1.4,
        }}
      >
        {sub}
      </p>
    )}
  </div>
);

/* ── StatCard ─────────────────────────────────────────────────────────────── */

export const StatCard = ({ label, value, sub, color, style }) => (
  <div
    style={{
      background: c.panel,
      border: `1px solid ${c.border}`,
      borderRadius: radius.card,
      padding: "16px 20px",
      flex: 1,
      minWidth: 0,
      position: "relative",
      overflow: "hidden",
      ...style,
    }}
  >
    {color && (
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg, ${color}55, transparent)`,
        }}
      />
    )}
    <p style={{ color: c.muted, ...type.label, margin: "0 0 7px" }}>{label}</p>
    <p
      style={{
        color: color || c.text,
        ...type.value,
        margin: "0 0 4px",
      }}
    >
      {value}
    </p>
    {sub && (
      <p style={{ color: c.muted, fontSize: 11, margin: 0, lineHeight: 1.4 }}>
        {sub}
      </p>
    )}
  </div>
);

/* ── RangeSlider ──────────────────────────────────────────────────────────── */

export const RangeSlider = ({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
  color,
}) => (
  <div style={{ marginBottom: 14 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 5,
      }}
    >
      <span style={{ color: c.muted, fontSize: 11 }}>{label}</span>
      <span
        style={{
          color: color || c.forest,
          fontWeight: 700,
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        {format ? format(value) : value}
      </span>
    </div>
    <input
      type="range"
      aria-label={typeof label === "string" ? label : undefined}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: "100%",
        accentColor: color || c.forest,
        height: 4,
        cursor: "pointer",
      }}
    />
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: `${c.muted}88`, ...type.axis }}>
        {format ? format(min) : min}
      </span>
      <span style={{ color: `${c.muted}88`, ...type.axis }}>
        {format ? format(max) : max}
      </span>
    </div>
  </div>
);

/* ── ChartTooltip ─────────────────────────────────────────────────────────── */

export const ChartTooltip = ({
  active,
  payload,
  label,
  suffix = "",
  formatter = fmt,
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: c.panel,
        border: `1px solid ${c.border}`,
        borderRadius: radius.tooltip,
        padding: "9px 13px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
      }}
    >
      <p
        style={{
          color: c.muted,
          fontSize: 10,
          marginBottom: 6,
          fontFamily: "monospace",
        }}
      >
        {label}
      </p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: 12, margin: "2px 0" }}>
          <span style={{ fontWeight: 600 }}>{p.name}: </span>
          {typeof p.value === "number"
            ? suffix
              ? `${p.value.toLocaleString()} ${suffix}`
              : formatter(p.value)
            : p.value}
        </p>
      ))}
    </div>
  );
};

/* ── Back-compat aliases ──────────────────────────────────────────────────── */
/* So the existing PVAK file compiles against this library unchanged:
     import { C, Pnl, STitle, KCard, Slider, Tip } from "lumnia-ui";
   Delete these once the old call sites are migrated.                       */

export const Pnl = Panel;
export const STitle = SectionTitle;
export const KCard = StatCard;
export const Slider = RangeSlider;
export const Tip = ChartTooltip;
