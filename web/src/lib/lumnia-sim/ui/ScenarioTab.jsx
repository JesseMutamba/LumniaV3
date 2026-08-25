/**
 * lumnia-sim/ui / ScenarioTab
 *
 * Bear / base / bull / custom comparison over a projection window.
 * Ported from the PVAK dashboard. Data arrives as props; nothing is hardcoded.
 *
 *   <ScenarioTab rows={projectionRows} />
 */

import { useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { color as C, Panel, SectionTitle, RangeSlider, ChartTooltip, fmt } from "lumnia-ui";
import {
  DRIVERS, SCENARIO_DEFS, SCENARIO_KEYS, NEUTRAL, computeAll, factorsOf,
} from "../src/model.js";

const yAxisMoney = (v) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
  : v <= -1e6 ? `-$${(-v / 1e6).toFixed(1)}M`
  : `$${(v / 1e3).toFixed(0)}K`;

const marginTone = (pct) => (pct >= 50 ? C.forest : pct >= 20 ? C.gold : C.red);

/** Scenario headline card. Deliberately not StatCard: it carries four values. */
function ScenarioCard({ label, accent, totals }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `2px solid ${accent}55`,
        borderRadius: 10,
        padding: "14px 18px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />
      <p style={{ color: C.muted, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" }}>
        {label}
      </p>
      <p style={{ color: accent, fontSize: 20, fontWeight: 700, margin: "0 0 3px", fontFamily: "monospace" }}>
        {fmt(totals.revenue)}
      </p>
      <p style={{ color: C.muted, fontSize: 10, margin: 0 }}>Total revenue, full window</p>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <div>
          <p style={{ color: C.muted, fontSize: 9, margin: 0 }}>NET MARGIN</p>
          <p style={{ color: accent, fontSize: 13, fontWeight: 700, margin: 0, fontFamily: "monospace" }}>
            {fmt(totals.margin)}
          </p>
        </div>
        <div>
          <p style={{ color: C.muted, fontSize: 9, margin: 0 }}>FINAL YEAR MARGIN%</p>
          <p style={{ color: accent, fontSize: 13, fontWeight: 700, margin: 0, fontFamily: "monospace" }}>
            {totals.finalMarginPct.toFixed(0)}%
          </p>
        </div>
      </div>
    </div>
  );
}

function PresetButton({ label, accent, onClick, muted }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: muted ? C.panel2 : `${accent}18`,
        border: `1px solid ${muted ? C.border : accent + "44"}`,
        color: muted ? C.muted : accent,
        borderRadius: 6,
        padding: "5px 12px",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        marginRight: 6,
        marginBottom: 6,
      }}
    >
      {label}
    </button>
  );
}

export default function ScenarioTab({ rows = [], initialCustom, onCustomChange }) {
  const [custom, setCustom] = useState(initialCustom ?? NEUTRAL);

  const setAndReport = (updater) =>
    setCustom((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (onCustomChange) onCustomChange(next);
      return next;
    });

  const years = useMemo(() => rows.map((r) => r.year), [rows]);
  const scen = useMemo(() => computeAll(rows, custom), [rows, custom]);

  const accentOf = (k) => C[scen[k].def.accent] ?? C.amber;
  const labelOf = (k) => scen[k].def.label;

  const revenueChartData = useMemo(
    () => years.map((y, i) => ({
      year: y,
      [labelOf("bear")]: scen.bear.rows[i].revenue,
      [labelOf("base")]: scen.base.rows[i].revenue,
      [labelOf("bull")]: scen.bull.rows[i].revenue,
      [labelOf("custom")]: scen.custom.rows[i].revenue,
    })),
    [years, scen]
  );

  const marginChartData = useMemo(
    () => years.map((y, i) => ({
      year: y,
      [labelOf("bear")]: scen.bear.rows[i].marginPct,
      [labelOf("base")]: scen.base.rows[i].marginPct,
      [labelOf("bull")]: scen.bull.rows[i].marginPct,
      [labelOf("custom")]: scen.custom.rows[i].marginPct,
    })),
    [years, scen]
  );

  /* The original chart was subtitled "revenue vs opex vs margin" and drew only
     the revenue bar. Draw all three, as advertised. */
  const totalsChartData = useMemo(
    () => SCENARIO_KEYS.map((k) => ({
      name: labelOf(k),
      Revenue: scen[k].totals.revenue,
      OPEX: scen[k].totals.opex,
      Margin: scen[k].totals.margin,
    })),
    [scen]
  );

  const lineFor = (k, extra = {}) => (
    <Line
      key={k}
      type="monotone"
      dataKey={labelOf(k)}
      stroke={accentOf(k)}
      strokeWidth={k === "base" ? 2.5 : 2}
      dot={{ r: k === "base" ? 4 : 3, fill: accentOf(k), strokeWidth: 0 }}
      {...extra}
    />
  );

  if (rows.length === 0) {
    return (
      <Panel>
        <SectionTitle sub="Pass a rows prop to render this tab">No projection data</SectionTitle>
      </Panel>
    );
  }

  return (
    <div>
      {/* Scenario headline row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {SCENARIO_KEYS.map((k) => (
          <ScenarioCard key={k} label={labelOf(k)} accent={accentOf(k)} totals={scen[k].totals} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, marginBottom: 16 }}>
        {/* Driver controls */}
        <Panel>
          <SectionTitle accent={C.amber} sub="Drag to build your own scenario">
            Custom scenario levers
          </SectionTitle>

          {DRIVERS.map((d) => (
            <RangeSlider
              key={d.key}
              label={d.label}
              min={d.min}
              max={d.max}
              step={d.step}
              value={custom[d.key] ?? NEUTRAL[d.key]}
              onChange={(v) => setAndReport((p) => ({ ...p, [d.key]: v }))}
              format={d.format}
              color={C[d.accent]}
            />
          ))}

          <p style={{ color: C.muted, fontSize: 10, lineHeight: 1.45, margin: "2px 0 0", fontStyle: "italic" }}>
            Yield and extraction enter the model as a single product. Moving one
            by 10% is identical to moving the other by 10%. Two sliders, one lever.
          </p>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <p style={{ color: C.muted, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>
              Preset assumptions
            </p>
            {["bear", "base", "bull"].map((k) => (
              <PresetButton
                key={k}
                label={`Load ${SCENARIO_DEFS[k].label}`}
                accent={C[SCENARIO_DEFS[k].accent]}
                onClick={() => setAndReport(factorsOf(SCENARIO_DEFS[k]))}
              />
            ))}
            <PresetButton label="Reset" muted onClick={() => setAndReport({ ...NEUTRAL })} />
          </div>
        </Panel>

        {/* Revenue by scenario */}
        <Panel>
          <SectionTitle accent={C.forest} sub="Annual revenue projection across all four scenarios">
            Revenue by scenario
          </SectionTitle>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={revenueChartData}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
              <XAxis dataKey="year" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={yAxisMoney} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={58} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ color: C.muted, fontSize: 11 }} />
              {lineFor("bear", { strokeDasharray: "5 3" })}
              {lineFor("base")}
              {lineFor("bull")}
              {lineFor("custom", { strokeDasharray: "3 2" })}
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Margin % */}
        <Panel>
          <SectionTitle accent={C.leaf} sub="Operating margin percentage by scenario, year on year">
            Margin % by scenario
          </SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={marginChartData}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
              <XAxis dataKey="year" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${Math.round(v)}%`} domain={[-20, 100]} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip suffix="%" />} />
              <Legend wrapperStyle={{ color: C.muted, fontSize: 11 }} />
              <ReferenceLine y={0} stroke={C.border} strokeWidth={1.5} />
              {lineFor("bear", { strokeDasharray: "5 3" })}
              {lineFor("base")}
              {lineFor("bull")}
              {lineFor("custom", { strokeDasharray: "3 2" })}
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        {/* Window totals */}
        <Panel>
          <SectionTitle accent={C.gold} sub="Cumulative revenue, opex and margin across the window">
            Window totals by scenario
          </SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={totalsChartData} barSize={16}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={yAxisMoney} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={64} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ color: C.muted, fontSize: 11 }} />
              {/* One fixed colour per series. The scenario is already on the X
                  axis, so tinting bars per scenario only made the legend lie. */}
              <Bar dataKey="Revenue" fill={C.leaf} radius={[3, 3, 0, 0]} fillOpacity={0.9} />
              <Bar dataKey="OPEX" fill={C.earth} radius={[3, 3, 0, 0]} fillOpacity={0.6} />
              <Bar dataKey="Margin" fill={C.gold} radius={[3, 3, 0, 0]} fillOpacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Comparison table */}
      <Panel>
        <SectionTitle accent={C.forest} sub="Revenue, opex and margin year by year, every scenario">
          Full scenario comparison
        </SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                <th style={{ color: C.muted, textAlign: "left", padding: "8px 10px", fontWeight: 600, fontSize: 10, letterSpacing: "0.06em" }}>
                  YEAR
                </th>
                {SCENARIO_KEYS.map((k) => (
                  <th
                    key={k}
                    colSpan={3}
                    style={{
                      color: accentOf(k), textAlign: "center", padding: "8px 10px",
                      fontWeight: 700, fontSize: 10, letterSpacing: "0.06em",
                      borderLeft: `1px solid ${C.border}`,
                    }}
                  >
                    {labelOf(k).toUpperCase()}
                  </th>
                ))}
              </tr>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th />
                {SCENARIO_KEYS.map((k) =>
                  ["Rev", "OPEX", "Margin%"].map((h) => (
                    <th
                      key={k + h}
                      style={{
                        color: C.muted, textAlign: "right", padding: "5px 8px",
                        fontWeight: 500, fontSize: 9,
                        borderLeft: h === "Rev" ? `1px solid ${C.border}` : "none",
                      }}
                    >
                      {h}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {years.map((y, i) => (
                <tr key={y} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.panel : `${C.panel2}66` }}>
                  <td style={{ padding: "8px 10px", color: C.text, fontWeight: 600, fontFamily: "monospace", fontSize: 11 }}>
                    {y}
                  </td>
                  {SCENARIO_KEYS.flatMap((k) => {
                    const d = scen[k].rows[i];
                    const accent = accentOf(k);
                    return [
                      <td key={k + "rev"} style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", fontSize: 10, color: accent, borderLeft: `1px solid ${C.border}` }}>
                        {fmt(d.revenue)}
                      </td>,
                      <td key={k + "opex"} style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", fontSize: 10, color: C.muted }}>
                        {fmt(d.opex)}
                      </td>,
                      <td key={k + "marg"} style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", fontSize: 10, color: marginTone(d.marginPct), fontWeight: 700 }}>
                        {d.marginPct.toFixed(0)}%
                      </td>,
                    ];
                  })}
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${C.border}`, background: `${C.gold}0A` }}>
                <td style={{ padding: "9px 10px", color: C.gold, fontWeight: 700, fontSize: 11 }}>TOTAL</td>
                {SCENARIO_KEYS.flatMap((k) => {
                  const t = scen[k].totals;
                  const accent = accentOf(k);
                  return [
                    <td key={k + "trev"} style={{ padding: "9px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: accent, fontWeight: 700, borderLeft: `1px solid ${C.border}` }}>
                      {fmt(t.revenue)}
                    </td>,
                    <td key={k + "topx"} style={{ padding: "9px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: C.muted }}>
                      {fmt(t.opex)}
                    </td>,
                    <td key={k + "tmg"} style={{ padding: "9px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: accent, fontWeight: 700 }}>
                      {fmt(t.margin)}
                    </td>,
                  ];
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
