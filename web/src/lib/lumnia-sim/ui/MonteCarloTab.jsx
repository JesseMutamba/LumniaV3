/**
 * lumnia-sim/ui / MonteCarloTab
 *
 * Distribution of outcomes across N seeded trials.
 * Ported from the PVAK dashboard. Data arrives as props.
 *
 *   <MonteCarloTab rows={projectionRows} />
 *
 * The seed is shown on screen and returned in onRun, so a number in a client
 * deck can be reproduced exactly months later. That is the point.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { color as C, Panel, SectionTitle, RangeSlider, fmt, fmtN } from "lumnia-ui";
import { DEFAULT_PARAMS, runMonteCarlo, metricValues, baselineTotals } from "../src/monte.js";
import { summarize, buildHistogram, probabilityAbove } from "../src/stats.js";

const METRICS = [
  { key: "totalRevenue", label: "Total revenue", accent: "forest", kind: "money" },
  { key: "totalMargin", label: "Total margin", accent: "leaf", kind: "money" },
  { key: "finalYearMarginPct", label: "Final year margin %", accent: "gold", kind: "pct" },
];

/** Slider groups, so adding a driver is one entry rather than four edits. */
const PARAM_GROUPS = [
  {
    heading: "CPO market price ($/T)",
    accent: "forest",
    fields: [
      { key: "cpoPriceMu", label: "Mean (μ)", min: 600, max: 1400, step: 25, format: (v) => `$${v}` },
      { key: "cpoPriceSd", label: "Std dev (σ)", min: 30, max: 300, step: 10, format: (v) => `±$${v}` },
    ],
  },
  {
    heading: "Yield factor",
    accent: "leaf",
    fields: [
      { key: "yieldMu", label: "Mean (μ)", min: 0.7, max: 1.3, step: 0.05, format: (v) => `${(v * 100).toFixed(0)}%` },
      { key: "yieldSd", label: "Std dev (σ)", min: 0.01, max: 0.2, step: 0.01, format: (v) => `±${(v * 100).toFixed(0)}%` },
    ],
  },
  {
    /* The original ran extraction as a live random variable with no slider.
       It moved every result and nobody could see or set it. */
    heading: "Extraction factor",
    accent: "leaf",
    fields: [
      { key: "extractMu", label: "Mean (μ)", min: 0.8, max: 1.2, step: 0.01, format: (v) => `${(v * 100).toFixed(0)}%` },
      { key: "extractSd", label: "Std dev (σ)", min: 0, max: 0.1, step: 0.01, format: (v) => `±${(v * 100).toFixed(0)}%` },
    ],
  },
  {
    heading: "OPEX factor",
    accent: "earth",
    fields: [
      { key: "opexMu", label: "Mean (μ)", min: 0.8, max: 1.3, step: 0.05, format: (v) => `${(v * 100).toFixed(0)}%` },
      { key: "opexSd", label: "Std dev (σ)", min: 0.02, max: 0.2, step: 0.01, format: (v) => `±${(v * 100).toFixed(0)}%` },
    ],
  },
];

function GroupHeading({ children, first }) {
  return (
    <p style={{ color: C.muted, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", margin: first ? "0 0 10px" : "12px 0 10px" }}>
      {children}
    </p>
  );
}

function StatTile({ label, value, sub, accent }) {
  return (
    <div style={{ flex: 1, background: C.panel, border: `1px solid ${accent}44`, borderRadius: 9, padding: "12px 14px" }}>
      <p style={{ color: C.muted, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>{label}</p>
      <p style={{ color: accent, fontSize: 17, fontWeight: 700, fontFamily: "monospace", margin: "0 0 2px" }}>{value}</p>
      <p style={{ color: C.muted, fontSize: 9, margin: 0 }}>{sub}</p>
    </div>
  );
}

function Empty({ height, children }) {
  return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>
      <span>{children}</span>
    </div>
  );
}

export default function MonteCarloTab({ rows = [], initialParams, seed, onRun }) {
  const [params, setParams] = useState({ ...DEFAULT_PARAMS, ...initialParams });
  const [run, setRun] = useState(null); // { trials, seed, params }
  const [running, setRunning] = useState(false);
  const [metric, setMetric] = useState("totalRevenue");

  const execute = useCallback(() => {
    if (rows.length === 0) return;
    setRunning(true);
    setTimeout(() => {
      const result = runMonteCarlo(rows, params, seed != null ? { seed } : {});
      setRun(result);
      setRunning(false);
      if (onRun) onRun(result);
    }, 20);
  }, [rows, params, seed, onRun]);

  useEffect(() => {
    execute();
    // Deliberately once on mount. Re-running on every slider tick would make
    // a 5,000-draw simulation fight the drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mc = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const accent = C[mc.accent];

  const formatMetric = useCallback(
    (v) => (mc.kind === "pct" ? `${v.toFixed(1)}%` : fmt(v)),
    [mc.kind]
  );

  const analysis = useMemo(() => {
    if (!run) return null;
    const vals = metricValues(run.trials, metric);
    const stats = summarize(vals);
    const hist = buildHistogram(vals, 35);
    /* The x axis of a bar chart is categorical, so a ReferenceLine at an
       arbitrary numeric x matches no category and silently does not render,
       which is what happened in the original. Snap each marker onto the
       nearest real bin centre. */
    const snap = (v) =>
      hist.length === 0
        ? v
        : hist.reduce((best, b) => (Math.abs(b.x - v) < Math.abs(best - v) ? b.x : best), hist[0].x);
    return { vals, stats, hist, marks: { p10: snap(stats.p10), p50: snap(stats.p50), p90: snap(stats.p90) } };
  }, [run, metric]);

  /* Baseline comes from the rows at neutral factors, so "probability of
     beating plan" tracks the data. The original compared against a constant
     that only made sense while the price mean sat at exactly 1000. */
  const baseline = useMemo(() => (rows.length ? baselineTotals(rows) : null), [rows]);

  const targets = useMemo(() => {
    if (!baseline) return [];
    const r = baseline.revenue, m = baseline.margin, fp = baseline.finalMarginPct;
    return [
      { label: "Total revenue beats plan", target: r, key: "totalRevenue", kind: "money" },
      { label: "Total revenue > plan +15%", target: r * 1.15, key: "totalRevenue", kind: "money" },
      { label: "Total revenue > plan +30%", target: r * 1.3, key: "totalRevenue", kind: "money" },
      { label: "Total margin beats plan", target: m, key: "totalMargin", kind: "money" },
      { label: "Total margin > plan +25%", target: m * 1.25, key: "totalMargin", kind: "money" },
      { label: "Final year margin holds", target: fp, key: "finalYearMarginPct", kind: "pct" },
      { label: "Final year margin > plan +10pp", target: fp + 10, key: "finalYearMarginPct", kind: "pct" },
    ];
  }, [baseline]);

  const scatter = useMemo(() => {
    if (!run) return [];
    return run.trials
      .filter((_, i) => i % 20 === 0)
      .map((t) => ({ cpoPrice: Math.round(t.cpoPrice), outcome: t[metric] }))
      .slice()
      .sort((a, b) => a.cpoPrice - b.cpoPrice);
  }, [run, metric]);

  if (rows.length === 0) {
    return (
      <Panel>
        <SectionTitle sub="Pass a rows prop to render this tab">No projection data</SectionTitle>
      </Panel>
    );
  }

  const stats = analysis?.stats;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, marginBottom: 16 }}>
        {/* Parameters */}
        <Panel>
          <SectionTitle accent={C.forest} sub="Distribution parameters for each variable">
            Simulation parameters
          </SectionTitle>

          {PARAM_GROUPS.map((g, gi) => (
            <div key={g.heading}>
              <GroupHeading first={gi === 0}>{g.heading}</GroupHeading>
              {g.fields.map((f) => (
                <RangeSlider
                  key={f.key}
                  label={f.label}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={params[f.key]}
                  onChange={(v) => setParams((p) => ({ ...p, [f.key]: v }))}
                  format={f.format}
                  color={C[g.accent]}
                />
              ))}
            </div>
          ))}

          <GroupHeading>Trials</GroupHeading>
          <RangeSlider
            label="Number of draws (N)"
            min={500}
            max={5000}
            step={500}
            value={params.N}
            onChange={(v) => setParams((p) => ({ ...p, N: v }))}
            format={(v) => v.toLocaleString()}
            color={C.gold}
          />

          <button
            type="button"
            onClick={execute}
            disabled={running}
            style={{
              width: "100%", marginTop: 14,
              background: running ? C.muted : C.forest,
              color: "#fff", border: "none", borderRadius: 8,
              padding: "11px 0", fontSize: 12, fontWeight: 700,
              cursor: running ? "not-allowed" : "pointer",
              letterSpacing: "0.06em", transition: "background 0.2s",
            }}
          >
            {running ? "Running…" : `Run ${params.N.toLocaleString()} trials`}
          </button>

          {run && (
            <p style={{ color: C.muted, fontSize: 9, fontFamily: "monospace", margin: "8px 0 0", textAlign: "center" }}>
              seed {run.seed} · reproducible
            </p>
          )}
        </Panel>

        {/* Distribution */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                style={{
                  background: metric === m.key ? C[m.accent] : C.panel,
                  border: `1px solid ${metric === m.key ? C[m.accent] : C.border}`,
                  color: metric === m.key ? "#fff" : C.muted,
                  borderRadius: 7, padding: "7px 16px", fontSize: 11,
                  fontWeight: 600, cursor: "pointer",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {stats && (
            <div style={{ display: "flex", gap: 10 }}>
              <StatTile label="P10 · downside" value={formatMetric(stats.p10)} sub="10% of draws below" accent={C.red} />
              <StatTile label="P50 · median" value={formatMetric(stats.p50)} sub="Half above, half below" accent={C.gold} />
              <StatTile label="P90 · upside" value={formatMetric(stats.p90)} sub="90% of draws below" accent={C.forest} />
              <StatTile label="Mean ± σ" value={formatMetric(stats.mean)} sub={`σ = ${formatMetric(stats.sd)}`} accent={accent} />
            </div>
          )}

          <Panel style={{ flex: 1 }}>
            <SectionTitle accent={accent} sub={`${mc.label} across ${params.N.toLocaleString()} trials`}>
              Outcome distribution
            </SectionTitle>
            {analysis && stats ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={analysis.hist} barCategoryGap="2%">
                  <CartesianGrid strokeDasharray="2 4" stroke={C.border} vertical={false} />
                  <XAxis
                    dataKey="x"
                    tickFormatter={(v) => (mc.kind === "pct" ? `${v.toFixed(0)}%` : fmtN(v))}
                    tick={{ fill: C.muted, fontSize: 9 }}
                    axisLine={false} tickLine={false} interval={6}
                  />
                  <YAxis tickFormatter={(v) => `${v.toFixed(1)}%`} tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip
                    formatter={(v, n, p) => [`${p.payload.pct.toFixed(2)}%`, "Frequency"]}
                    labelFormatter={(v) => (mc.kind === "pct" ? `${Number(v).toFixed(1)}%` : fmt(v))}
                  />
                  <ReferenceLine x={analysis.marks.p10} stroke={C.red} strokeDasharray="4 2" label={{ value: "P10", fill: C.red, fontSize: 8, position: "top" }} />
                  <ReferenceLine x={analysis.marks.p50} stroke={C.gold} strokeWidth={2} label={{ value: "P50", fill: C.gold, fontSize: 8, position: "top" }} />
                  <ReferenceLine x={analysis.marks.p90} stroke={C.forest} strokeDasharray="4 2" label={{ value: "P90", fill: C.forest, fontSize: 8, position: "top" }} />
                  <Bar dataKey="pct" name="Frequency %">
                    {analysis.hist.map((h, i) => (
                      <Cell
                        key={i}
                        fill={h.x < stats.p10 ? C.red : h.x > stats.p90 ? C.forest : accent}
                        fillOpacity={0.75}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty height={280}>Press Run to generate trials</Empty>
            )}
          </Panel>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Price sensitivity */}
        <Panel>
          <SectionTitle accent={C.gold} sub="Sampled trials, showing sensitivity to CPO price">
            CPO price vs outcome
          </SectionTitle>
          {scatter.length > 0 ? (
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={scatter}>
                <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                <XAxis
                  dataKey="cpoPrice" tickFormatter={(v) => `$${v}`} minTickGap={28}
                  tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false}
                  label={{ value: "CPO price ($/T)", fill: C.muted, fontSize: 9, position: "insideBottom", offset: -2 }}
                />
                <YAxis
                  tickFormatter={(v) => (mc.kind === "pct" ? `${v.toFixed(0)}%` : fmtN(v))}
                  tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} width={50}
                />
                <Tooltip formatter={(v) => [formatMetric(v), mc.label]} labelFormatter={(v) => `CPO price $${v}/T`} />
                <Line dataKey="outcome" name={mc.label} stroke="none" dot={{ r: 2, fill: accent, fillOpacity: 0.5, strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <Empty height={190}>Run a simulation first</Empty>
          )}
        </Panel>

        {/* Probability of beating plan */}
        <Panel>
          <SectionTitle accent={C.forest} sub="Chance of clearing each threshold, measured against plan">
            Probability analysis
          </SectionTitle>
          {run && baseline ? (
            <div>
              {targets.map((t) => {
                const pct = probabilityAbove(metricValues(run.trials, t.key), t.target);
                const tone = pct >= 70 ? C.forest : pct >= 40 ? C.gold : C.red;
                return (
                  <div key={t.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ color: C.muted, fontSize: 11 }}>
                      {t.label}
                      <span style={{ color: `${C.muted}99`, fontFamily: "monospace", fontSize: 10, marginLeft: 6 }}>
                        {t.kind === "pct" ? `${t.target.toFixed(0)}%` : fmt(t.target)}
                      </span>
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 70, height: 5, borderRadius: 3, background: C.panel2, overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: tone, borderRadius: 3 }} />
                      </div>
                      <span style={{ color: tone, fontWeight: 700, fontFamily: "monospace", fontSize: 12, minWidth: 42, textAlign: "right" }}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
              <p style={{ color: C.muted, fontSize: 10, marginTop: 12, fontStyle: "italic", lineHeight: 1.5 }}>
                {run.params.N.toLocaleString()} draws, seed {run.seed}. CPO price
                N(${run.params.cpoPriceMu}, {run.params.cpoPriceSd}), yield
                N({run.params.yieldMu.toFixed(2)}, {run.params.yieldSd.toFixed(2)}), extraction
                N({run.params.extractMu.toFixed(2)}, {run.params.extractSd.toFixed(2)}), opex
                N({run.params.opexMu.toFixed(2)}, {run.params.opexSd.toFixed(2)}). Thresholds are
                relative to the plan as loaded.
              </p>
            </div>
          ) : (
            <Empty height={190}>Run a simulation to see probabilities</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
