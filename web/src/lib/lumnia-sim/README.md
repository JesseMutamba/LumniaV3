# lumnia-sim

Scenario analysis and Monte Carlo for the palm oil operating model, plus the two
dashboard tabs that drive them.

Lifted out of the PVAK financial intelligence dashboard. The engine is headless
and has no React, no charts and **no client data** — projection rows are always
passed in. The UI layer sits on `lumnia-ui`.

```
src/   engine   model · random · stats · monte     (no dependencies at all)
ui/    tabs     ScenarioTab · MonteCarloTab        (react + recharts + lumnia-ui)
test/  oracles  56 deterministic assertions
```

---

## Install

```
pvack-saas/src/lib/
  lumnia-ui/
  lumnia-sim/     <- this folder
```

```js
// vite.config.js
resolve: {
  alias: {
    "lumnia-ui":  "/src/lib/lumnia-ui/src/index.js",
    "lumnia-sim": "/src/lib/lumnia-sim/src/index.js",
  },
}
```

Requires `recharts >= 3` and `react >= 18` for the UI layer only.

---

## Use

```jsx
import { ScenarioTab, MonteCarloTab } from "lumnia-sim/ui";

const rows = await loadProjection(reportId);   // your data, your fetch

<ScenarioTab rows={rows} />
<MonteCarloTab rows={rows} onRun={(r) => saveSeed(reportId, r.seed)} />
```

Headless, for a server-rendered report or a pytest-style oracle:

```js
import { computeAll, runMonteCarlo, metricValues, summarize } from "lumnia-sim";

const scen = computeAll(rows, { cpoPriceFactor: 1.2 });
scen.bull.totals.revenue;          // number
scen.custom.rows[0].marginPct;     // number

const { trials, seed } = runMonteCarlo(rows, { N: 5000 }, { seed: 42 });
summarize(metricValues(trials, "totalRevenue"));  // { p10, p50, p90, mean, sd, ... }
```

### Row shape

Rows are one projection year each. Only five fields are read:

| Field | Used for |
| --- | --- |
| `year` | Axis label and table row |
| `revenue` | Scaled by volume and price factors |
| `opex` | Scaled by the opex factor |
| `capex` | Scaled by the capex factor |
| `cpo` | Carried through as adjusted tonnage |

Everything else on the row (`ffb`, `ha`, `haMgd`, `opexPerTCpo`, …) rides along
untouched. There is no fixed window length. Four years or forty both work.

---

## The model

One function, `applyFactors`, is the entire model. Both the scenario path and
the Monte Carlo path call it, so the two cannot drift apart.

```
volumeFactor = yieldFactor × extractionFactor

revenue   = row.revenue × volumeFactor × cpoPriceFactor
opex      = row.opex    × opexFactor
capex     = row.capex   × capexFactor
margin    = revenue − opex
marginPct = revenue > 0 ? margin / revenue × 100 : 0
```

`cpoPriceFactor` is relative to `PRICE_BASE` ($1,000/T). A simulated price of
$1,150 becomes a factor of 1.15.

### Presets

| | Price | Yield | Extraction | Opex | Capex |
| --- | --- | --- | --- | --- | --- |
| Baisse | 0.70 | 0.80 | 0.90 | 1.20 | 1.10 |
| Base | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| Hausse | 1.30 | 1.15 | 1.08 | 0.90 | 0.95 |

Verbatim from the dashboard.

### Distributions

Every driver is drawn from a normal and clamped at a floor.

| Driver | Default μ | Default σ | Floor |
| --- | --- | --- | --- |
| CPO price | 1000 | 150 | 400 |
| Yield | 1.00 | 0.10 | 0.30 |
| Extraction | 1.00 | 0.03 | 0.12 |
| Opex | 1.00 | 0.08 | 0.50 |
| Capex | 1.00 | 0.00 | 0.50 |

---

## What was wrong with the original, and what changed

Ten findings. Six were defects, four were things that had simply never been wired up.

### 1. Nothing was reproducible

`runMonteCarlo` called `Math.random()`. A client opening a signed report saw a
different P10, P50 and P90 every refresh. For a platform whose differentiator is
provenance, this was the worst one in the file.

Now seeded with mulberry32. The seed defaults to a stable hash of the parameters,
is returned from `runMonteCarlo`, and is printed under the Run button. Same
inputs, same distribution, months later.

### 2. The two engines disagreed as soon as you touched the price

`computeScenario` treated price as a plain multiplier. `runMonteCarlo` divided
simulated revenue by a bare `1000`. The two only agreed because the default price
mean happened to be 1000. Drag the mean to 1400 and the simulation silently
inflated revenue 40% against a plan baseline that never moved — and that baseline
was exactly what "probability of beating plan" compared against.

Both paths now divide by `PRICE_BASE` explicitly. A test asserts that μ=2000 with
σ=0 doubles plan revenue exactly.

### 3. Yield and extraction are the same lever

`adjRevenue = adjCpo × (revenue / cpo) × priceFactor` where
`adjCpo = cpo × yield × extraction`. The `cpo` cancels. Revenue is just
`revenue × yield × extraction × price`. Moving yield to 1.15 is arithmetically
identical to moving extraction to 1.15. Two sliders, one degree of freedom.

Kept both sliders, because you show them to clients and they mean different
things operationally. But the UI now says so on screen, and `DRIVERS` marks the
collinearity so nobody rediscovers it in front of a client.

### 4. The Monte Carlo had a hidden variable

`extractMu` and `extractSd` were in state and consumed by the engine, but there
was no slider for either. Extraction moved every result and nobody could see or
set it. It now has controls.

### 5. `capexFactor` was decoration

Defined in all three presets, never read. Capex passed through unfactored while
the bear case claimed to model a 10% overrun. Now applied, with a slider.

### 6. A hardcoded index 5

`yearlyRevenue[5]`, `BASE[5]`, `scenarios[key][5]` in four places. Any window
that was not exactly six years returned `undefined` and propagated `NaN` into the
final-year margin. Now reads the last row. Tested with four rows and with eight.

### 7. The totals chart did not match its own subtitle

Subtitled "revenue vs opex vs margin", it rendered only the revenue bar — and
tinted that bar per scenario, which made the legend wrong as well. All three
series now render, one fixed colour each.

### 8. The percentile markers never appeared

`<ReferenceLine x={stats.p10}>` on a categorical bar axis matches no category, so
P10, P50 and P90 silently did not draw. Markers now snap to the nearest bin
centre and render.

### 9. Missing React keys

The comparison table mapped to bare `<>` fragments with keys on the inner `<td>`s,
where React ignores them. A console warning per row per render. Now flat arrays
with keys where they belong, asserted by a test that fails on the warning.

### 10. Small stuff

`totalCapex` was accumulated and thrown away — now returned. `buildHistogram`
divided by `(max − min)` with no guard, so a degenerate sample produced a bin
array of `NaN` — now returns a single bin. `marginPct` was rounded to whole
integers inside the engine — now a float, rounded only for display. Box-Muller
discarded its second deviate on every call — now cached, halving the uniform draws.

---

## Test

56 assertions, all deterministic. The first five re-implement the **original**
formulas inline and assert the port is numerically identical, so nothing above
was a silent rewrite.

```bash
npx esbuild test/oracle.test.jsx --bundle --platform=node --format=esm \
  --jsx=automatic --outfile=/tmp/o.mjs \
  --alias:lumnia-ui=../lumnia-ui/src/index.js \
  --external:react --external:react-dom --external:react/jsx-runtime \
  --external:recharts && node /tmp/o.mjs
```

---

## Not in here

The remaining dashboard tabs (production cost, capex detail, opex breakdown,
plantation progress), the report header and the tab bar. And the model is palm
oil shaped on purpose — drivers are named for CPO, yield and extraction. When a
non-palm client signs, `applyFactors` and `DRIVERS` are the two things that
change; everything else is already generic.
