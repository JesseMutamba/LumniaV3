# Lumnia Report Schema v0.1

The contract between `lumnia-api` and the platform renderer.

A report is **not a page**. It is an ordered list of typed blocks. The renderer
knows how to draw each block type; it knows nothing about the client's industry.
Adding a report is a POST, not a code change.

---

## Envelope

```json
{
  "id": "pvak-fy26-q1",
  "org": "pvak",
  "title": {"fr": "Budget contre réalité", "en": "Budget vs reality"},
  "period": {"label": {"fr": "T1 2026", "en": "Q1 2026"},
             "start": "2026-01-01", "end": "2026-03-31"},
  "status": "published",
  "generated_at": "2026-08-03T18:14:00Z",
  "pipeline_version": "0.9.3",
  "locales": ["fr", "en"],
  "default_locale": "fr",
  "sources": [ {...Source} ],
  "blocks":  [ {...Block} ]
}
```

`status` — `draft` | `published` | `retracted`. A retracted report stays
addressable and renders with a retraction banner. We retract, we do not delete.

---

## Source

Every ingested file is declared once, then referenced by index from any value.

```json
{
  "idx": 0,
  "filename": "Montage_financier_2025_a_2030_ok.xlsx",
  "sha256": "…",
  "sheets": 9,
  "rows_read": 1419,
  "checks_run": 12,
  "checks_passed": 12
}
```

## Value — the provenance primitive

**No number enters a report except as a Value.** A Value that cannot name its
source cell does not render; the renderer draws a `∅` and logs it. This is the
anti-fabrication gate expressed in the data model rather than in prose.

```json
{
  "n": 44623.60,
  "unit": "USD",
  "src": {"file": 1, "sheet": "COUT DE PRODUCTION (OPEX)", "cells": "D43:F43"},
  "derived": "sum"
}
```

- `n` — the number. Never a string, never pre-formatted.
- `unit` — `USD` | `CDF` | `t` | `ha` | `pct` | `ratio` | `USD/t` | `null`
- `src` — required. `file` indexes `sources[]`.
- `derived` — `null` when read directly from the cell. Otherwise `sum`,
  `mean`, `ratio`, `delta`, `extrapolation`, naming the operation applied to
  the cited range. Formatting is the renderer's job; locale is the viewer's.

---

## Block types

All blocks take an optional `id` (for deep links) and `note` (localized prose
under the block).

### `heading`
```json
{"type":"heading","level":2,"label":{"fr":"01 · Exécution","en":"01 · Execution"},
 "text":{"fr":"…","en":"…"},"dek":{"fr":"…","en":"…"}}
```

### `prose`
```json
{"type":"prose","text":{"fr":"…","en":"…"}}
```

### `kpiGrid`
```json
{"type":"kpiGrid","items":[
  {"label":{"fr":"Exécution T1","en":"Q1 execution"},
   "value":{Value},"sub":{"fr":"…","en":"…"},"tone":"warn"}]}
```
`tone` — `neutral` | `good` | `warn` | `bad`. Tone is asserted by the pipeline,
never inferred by the renderer. A pipeline that cannot justify a tone sends
`neutral`.

### `rail` — envelope vs pace vs actual
```json
{"type":"rail","rows":[
  {"label":{"fr":"CAPEX","en":"CAPEX"},
   "envelope":{Value},"pace":{Value},"actual":{Value}}]}
```
The signature block. `envelope` is the full-period budget, `pace` the
expected spend by the as-of date, `actual` what was spent. Renders as a
filled bar against a hatched envelope with a pace notch.

### `barPair` — plan vs actual over time
```json
{"type":"barPair","x":["Jan","Fév",…],
 "series":[{"key":"plan","label":{…},"values":[{Value}…]},
           {"key":"actual","label":{…},"values":[{Value}…]}],
 "cutoff":3}
```
`cutoff` marks where actuals stop. Series may be shorter than `x`.

### `table`
```json
{"type":"table","columns":[{"key":"year","label":{…},"align":"left"}],
 "rows":[{"year":{Value},…}],"total":{…}}
```

### `flag` — a finding that needs an argument, not just a number
```json
{"type":"flag","severity":"caught",
 "tag":{"fr":"Piège détecté","en":"Trap caught"},
 "title":{…},"body":{…},
 "evidence":{"kind":"tree","payload":{…}}}
```
`severity` — `caught` (we handled it) | `warn` (client should act) |
`blocked` (we refused to compute). `evidence.kind` — `tree` | `diff` | `cells`.

### `ledger`
```json
{"type":"ledger"}
```
Renders `sources[]`. Takes no payload — it is a view of the envelope.

---

## Renderer rules

1. A Value without `src` renders as `∅`, never as a number.
2. Unknown block types render a labelled placeholder, never a crash. Forward
   compatibility: the platform ships slower than the pipeline.
3. All formatting is locale-side. The API sends numbers; the renderer sends
   them through `Intl`.
4. Missing locale → fall back to `default_locale`, and mark it visibly.
5. Simulated or what-if figures carry `"derived":"simulation"` and the
   renderer stamps the block. Non-negotiable.

---

## Open (deliberately deferred)

- Threading/comments on blocks — Series A problem.
- Per-block access control — when we have more than one seat per client.
- Diffing report versions — worth doing at report #10, not report #2.
