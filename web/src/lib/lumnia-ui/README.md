# lumnia-ui

The Lumnia design system. One palette, five primitives, shared chart config.

Lifted out of the PVAK financial intelligence dashboard so that every report
surface we ship looks like it came from the same company. Zero dependencies
beyond React. Inline styles on purpose: drops into any React app with no build
config and no chance of a client stylesheet leaking in.

---

## Install

Copy the folder into the repo and alias it:

```
pvack-saas/
  src/
    lib/lumnia-ui/     <- this folder
```

```js
// vite.config.js
resolve: { alias: { "lumnia-ui": "/src/lib/lumnia-ui/src/index.js" } }
```

Then once, at the app root:

```js
import "lumnia-ui/tokens.css";  // exposes the palette as CSS custom properties
```

---

## Use

```jsx
import {
  color, series, fmt, fmtPct,
  Panel, SectionTitle, StatCard, RangeSlider, ChartTooltip,
  gridProps, axisProps, legendProps, lineProps, seriesColor,
} from "lumnia-ui";

<Panel>
  <SectionTitle sub="Projected CPO revenue, 2025-2030">
    Revenue trajectory
  </SectionTitle>

  <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
    <StatCard label="Total revenue" value={fmt(11680000)} sub="+2,086% vs 2025" color={color.forest} />
    <StatCard label="Total margin"  value={fmt(4210000)}  sub="Cumulative"      color={color.gold} />
    <StatCard label="2030 margin"   value={fmtPct(71.4)}  sub="Of revenue"      color={color.leaf} />
  </div>

  <ResponsiveContainer width="100%" height={260}>
    <LineChart data={rows}>
      <CartesianGrid {...gridProps} />
      <XAxis dataKey="year" {...axisProps} />
      <YAxis {...axisProps} tickFormatter={fmt} />
      <Tooltip content={<ChartTooltip />} />
      <Legend {...legendProps} />
      <Line dataKey="revenue" stroke={seriesColor(0)} {...lineProps} />
    </LineChart>
  </ResponsiveContainer>
</Panel>
```

---

## What is in here

| File | What it holds |
| --- | --- |
| `src/tokens.js` | Palette, semantic aliases, series ramp, spacing, radii, type scale |
| `src/tokens.css` | Same palette as CSS custom properties (`--ln-*`) for non-React surfaces |
| `src/format.js` | `fmt` `fmtN` `fmtPct` `fmtInt` `fmtUnit`. Display only, never round in compute |
| `src/primitives.jsx` | `Panel` `SectionTitle` `StatCard` `RangeSlider` `ChartTooltip` |
| `src/charts.js` | Recharts prop presets so six charts do not end up with five tick sizes |
| `test/smoke.test.jsx` | 34 assertions covering tokens, formatters and every primitive |

## The palette

Cream paper, forest and gold as a two-value accent system, earth for costs,
one red for signal. Three colour families, three steps each. If a chart needs a
seventh colour, the chart is doing too much.

| Role | Token | Hex |
| --- | --- | --- |
| Page | `bg` | `#F4F0E6` |
| Card | `panel` | `#FEFCF8` |
| Well | `panel2` | `#EDE8DC` |
| Hairline | `border` | `#D5CEBC` |
| Ink | `text` | `#1A1916` |
| Ink muted | `muted` | `#8A8375` |
| Primary | `forest` / `leaf` / `sage` | `#2C5F1A` `#4D8C2E` `#7DA05A` |
| Secondary | `gold` / `amber` | `#A67C2A` `#C8A04A` |
| Cost | `earth` / `clay` | `#7A4E2E` `#9E6845` |
| Signal | `red` | `#B03A2A` |

Prefer the semantic names (`semantic.primary`, `semantic.cost`) in new code.
A palette swap then costs one file instead of a find-and-replace across every chart.

---

## Migrating the existing PVAK dashboard

The old names are exported as aliases, so the current `App.js` compiles against
this library with a single import line and no other edits:

```js
import { C, Pnl, STitle, KCard, Slider, Tip } from "lumnia-ui";
```

Then delete lines 19-35 (the `C` block), 183-196 (`fmt`, `fmtN`) and 278-470
(the shared components) from `App.js`. That is roughly 200 lines out of 3,462.

Rename map, for when you migrate the call sites properly:

| Old | New |
| --- | --- |
| `C` | `color` |
| `Pnl` | `Panel` |
| `STitle` | `SectionTitle` |
| `KCard` | `StatCard` |
| `Slider` | `RangeSlider` |
| `Tip` | `ChartTooltip` |

Drop the alias block from `primitives.jsx` once nothing imports the old names.

---

## Deliberate changes from the extracted source

1. **`StatCard` no longer emits a broken gradient.** The original always rendered
   `linear-gradient(90deg, undefined55, transparent)` when no `color` prop was
   passed. Invalid CSS, so it painted nothing. Now the underline element is
   simply not rendered. Identical output, valid markup.
2. **`RangeSlider` carries an `aria-label`.** The original range input had no
   accessible name.
3. **`ChartTooltip` takes a `formatter` prop**, defaulting to `fmt`, so a chart
   in tonnes or hectares does not need its own tooltip component.
4. **`Panel` and `StatCard` forward `style`**, so layout tweaks stop forking the
   component.

Everything else is byte-for-byte the extracted styling.

## Not in here yet

Charts themselves, the tab bar, the report header, tables, the print/PDF
stylesheet. Those are the next lift, and they are worth doing only once a second
surface actually needs them.

## Test

```bash
npx esbuild test/smoke.test.jsx --bundle --platform=node --format=esm \
  --jsx=automatic --outfile=/tmp/t.mjs \
  --external:react --external:react-dom --external:react/jsx-runtime && node /tmp/t.mjs
```
