import { renderToStaticMarkup } from "react-dom/server";
import {
  color, C, semantic, series, space, radius, type as t,
  fmt, fmtN, fmtPct, fmtInt, fmtUnit,
  Panel, SectionTitle, StatCard, RangeSlider, ChartTooltip,
  Pnl, STitle, KCard, Slider, Tip,
  gridProps, axisProps, seriesColor, seriesPalette,
} from "../src/index.js";

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

// --- tokens -------------------------------------------------------------
ok("palette has 14 tokens", Object.keys(color).length === 14, `got ${Object.keys(color).length}`);
ok("C alias === color", C === color);
ok("every token is a hex", Object.values(color).every(v => /^#[0-9A-F]{6}$/i.test(v)));
ok("semantic.primary is forest", semantic.primary === "#2C5F1A");
ok("series ramp has 8 entries", series.length === 8);
ok("seriesColor wraps", seriesColor(9) === series[1]);
ok("seriesPalette maps keys", seriesPalette(["a","b"]).b === series[1]);
ok("radius.card = 10", radius.card === 10);
ok("space scale ascends", [space.xs,space.sm,space.md,space.lg,space.xl,space.xxl].every((v,i,a)=> i===0 || v>a[i-1]));

// --- formatters ---------------------------------------------------------
ok("fmt millions", fmt(11680000) === "$11.68M", fmt(11680000));
ok("fmt thousands", fmt(362000) === "$362K", fmt(362000));
ok("fmt units", fmt(890) === "$890", fmt(890));
ok("fmtN default", fmtN(2821180) === "2.8M", fmtN(2821180));
ok("fmtPct percent-in", fmtPct(72.34) === "72.3%", fmtPct(72.34));
ok("fmtPct fraction-in", fmtPct(0.7234, 1, { fraction: true }) === "72.3%", fmtPct(0.7234,1,{fraction:true}));
ok("fmtInt separates", fmtInt(1187) === "1,187", fmtInt(1187));
ok("fmtUnit appends", fmtUnit(1187, "t") === "1,187 t", fmtUnit(1187,"t"));

// --- primitives render --------------------------------------------------
const r = (el) => renderToStaticMarkup(el);

const panel = r(<Panel><span>x</span></Panel>);
ok("Panel renders card bg", panel.includes("#FEFCF8") || panel.includes("rgb(254"), "");
ok("Panel renders children", panel.includes("<span>x</span>"));
ok("Panel style override wins", r(<Panel style={{padding:0}}>y</Panel>).includes("padding:0"));

const st = r(<SectionTitle sub="subtitle here">TRAJECTOIRE</SectionTitle>);
ok("SectionTitle uppercases", st.includes("text-transform:uppercase"));
ok("SectionTitle shows sub", st.includes("subtitle here"));
ok("SectionTitle accent override", r(<SectionTitle accent={color.gold}>T</SectionTitle>).includes("#A67C2A"));

const kc = r(<StatCard label="REVENUS" value="$11.68M" sub="2025-2030" color={color.forest} />);
ok("StatCard shows label/value/sub", kc.includes("REVENUS") && kc.includes("$11.68M") && kc.includes("2025-2030"));
ok("StatCard draws accent underline when colored", kc.includes("linear-gradient"));
const kcNo = r(<StatCard label="L" value="V" />);
ok("StatCard emits NO broken gradient when uncolored", !kcNo.includes("undefined"), "");

const sl = r(<RangeSlider label="Prix CPO" min={400} max={1200} step={10} value={800} onChange={()=>{}} format={(v)=>`$${v}`} />);
ok("RangeSlider renders input[type=range]", sl.includes('type="range"'));
ok("RangeSlider formats value + rails", sl.includes("$800") && sl.includes("$400") && sl.includes("$1200"));
ok("RangeSlider is labelled for a11y", sl.includes('aria-label="Prix CPO"'));

ok("ChartTooltip hidden when inactive", r(<ChartTooltip active={false} payload={[]} />) === "");
const tip = r(<ChartTooltip active payload={[{name:"Revenus", value:1081920, color:color.forest}]} label="2027" />);
ok("ChartTooltip renders label + formatted value", tip.includes("2027") && tip.includes("$1.08M"), tip.includes("$1.08M")?"":tip);
const tipS = r(<ChartTooltip active suffix="t" payload={[{name:"FFB", value:1187, color:color.leaf}]} label="2025" />);
ok("ChartTooltip honours suffix", tipS.includes("1,187 t"));

// --- back-compat aliases -------------------------------------------------
ok("Pnl/STitle/KCard/Slider/Tip alias correctly",
  Pnl === Panel && STitle === SectionTitle && KCard === StatCard && Slider === RangeSlider && Tip === ChartTooltip);

// --- chart presets -------------------------------------------------------
ok("gridProps + axisProps use palette", gridProps.stroke === color.border && axisProps.tick.fill === color.muted);

console.log(`\n${fails === 0 ? "GREEN" : "RED"} — ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
