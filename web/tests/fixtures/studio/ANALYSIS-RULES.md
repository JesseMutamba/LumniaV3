# General analytics rules and independent controls

These synthetic fixtures are an independent oracle, generated with CSV/Decimal tooling rather than the application calculation engine. `expected-controls.json` contains the controls. They are intermediate engineering assets, not client data.

## Reusable semantic model

A column needs more than a primitive numeric/date type:

- `role`: identifier, period, dimension, measure, scenario, currency, unit, or unknown.
- `semantic`: revenue, cash_receipt, cash_payment, cogs, operating_cost, capital_cost, balance, stock_on_hand, unit_cost, output_quantity, input_quantity, defect_count, exposure_count, actual_hours, planned_hours, or generic_measure.
- `aggregation`: sum (flows/counts), latest (stocks/balances), ratio_of_sums (rates with verified components), or none (unknown rates and identifiers).
- `unit`: ISO currency, physical unit, count, hours, percent, or unverified. Preserve `USD/t` distinctly from `USD` and `t`.
- `basis`: actual, budget, forecast, baseline, or unspecified, derived per observation when present.
- `confidence`: inferred or confirmed, with evidence and candidate alternatives. Do not present a percentage confidence without calibration.
- `source`: original file hash, sheet, header cell, data-cell coordinates and raw representations; retain cleaned values separately.

A dataset also needs grain (e.g., transaction line, invoice, SKU/location/snapshot, site/month), candidate business keys, frequency, coverage, and coverage exclusions. The grain governs joins and permissible aggregation. Distinct invoice count cannot be inferred from row count when rows are invoice lines.

An analysis operation should explicitly declare required mappings, filtered scope, aggregation, grouping, dependencies, validation gates, and output unit. Formula/chart execution should consume this structured plan. A model can propose the plan; it must not supply the numeric answer or arbitrary executable code.

## Domain eligibility

| Profile | Eligible from available fields | Must not infer |
|---|---|---|
| Sales | Verified sales amount totals, product/region breakdowns, time trends; matched revenue/COGS gross profit and ratio; distinct order count from an order key | Generic Amount is sales; all receipts are revenue; margin without matching cost scope; order count from line count; all returns are data errors |
| Financial statements | Separate named measures, common-period Actual vs Budget, OPEX breakdown with reconciled disjoint categories, closing balance by latest observation | Sum stock balances over time; add financial subtotal and its components; call operating result net profit; compare an annual budget to incomplete Q1 |
| Inventory | On-hand quantity and extended value per common snapshot, grouped across distinct SKU/location rows; threshold alerts when reorder points exist | Sum historical snapshots; latest-of-each SKU means a complete common snapshot; turnover or days of supply without relevant flows/history |
| Operations | Output totals; sum cost divided by sum matching output; sum defects divided by sum matching production; actual hours / planned hours | Simple mean monthly unit costs or defect percentages; output was sold; downtime causes revenue loss absent an explicit model |
| Generic measures | Clearly named numeric summaries and dimensions where sum/mean is defensible and selected | Declare the dataset financial solely because it contains numbers or a dollar symbol |

Stock snapshots require special care: a “latest” table assembled from a different date per SKU/location is a mixed-date view. State those dates and do not call it one complete period-end inventory snapshot. Missing SKU rows can mean zero stock, missing data, or a changed assortment; no zero should be invented.

## Review gates and calculation behavior

1. **Numbers:** existing `parseNumber` parses `1,234` as 1234 and `1.234` as 1.234. The same strings can mean the opposite under other locales. Inspect original raw cells using provenance before accepting such conversions. Retain explicit choices per client; a mixed convention within one column is a conflict. Parentheses may indicate negative values. Percentage formats and percentage-point changes need distinct units.
2. **Dates:** ISO dates and explicit Excel date cells are strong evidence. A numeric customer ID is not an Excel serial date. If every slash date has both components at most 12 and unequal components occur, MDY versus DMY changes results and needs confirmation. A conflicting title year must not overwrite cell dates. Avoid reinterpreting annual numeric values such as 2026 as an Excel serial.
3. **Currencies:** combine only the same verified currency. A USD header and EUR row code conflict; do not silently choose one. `$` alone does not identify USD. Equivalent local-currency and USD-converted cash streams may be duplicate representations, not distinct cash flows.
4. **Totals/duplicates:** explicit total/subtotal rows should be separate summaries, with component reconciliation when possible. Do not remove an exact duplicate automatically: it may be a legitimate repeated sale. Flag duplicate business keys that differ on amounts separately from exact duplicates.
5. **Missingness:** preserve null separately from zero. A valid amount with no date can contribute to the overall total but not a time chart; display the excluded amount so totals reconcile. Paired ratios/profits use only the common valid row set; do not subtract costs from rows with invalid corresponding revenue.
6. **Time alignment:** observed March after January is not a month-on-month comparison. Show missing February; growth should require adjacent periods. Compare Actual and Budget only on common observed periods and disclose incomplete periods. A partial current month is not comparable to a complete prior month without an explicit method.
7. **Units:** a currency column called cost per tonne is a rate, not an additive expense. Numerators and denominators must have matching periods, site scope, and production basis. FFB tonnes and CPO tonnes are different physical measures despite both being tonnes.
8. **Provenance:** every result should identify included source cells, excluded rows and the formula. Maintain exact source sets; do not claim an entire range if some cells were excluded.
9. **File text:** labels, cell text and formulas are untrusted data. They must never act as agent instructions or directly become executable code/SQL.

## Forecast and simulation eligibility

- At minimum require a clearly selected measure, actual/history basis, unambiguous regular periods, no unreviewed gaps, compatible units, and sufficient observations for the selected model.
- “At least 12 monthly points” is an understandable initial product threshold for a simple baseline, not a statistical guarantee. A seasonal method needs enough complete cycles, usually more than one. Three quarterly actual months and future plan years are not enough to infer historical uncertainty.
- Compare a simple trend against a naive baseline on a trailing holdout or rolling origin. Label the method and evaluation period. Do not use held-out data to fit the model being evaluated.
- Store the chosen model, training scope, fitted coefficients or model version, validation errors, horizon and interval assumptions alongside the result.
- A Monte Carlo feature needs a specified business equation and uncertainty assumptions. If assumptions are user-entered, say so; do not call their distributions empirically calibrated. Seed reproducibility, positivity/bounds, correlated drivers where justified, and finite output checks matter.
- Inventory/snapshot or unspecified data should not automatically receive a revenue forecast simply because it has a date and number.

## Saved definitions and conversation

Persist client mappings together with the original header fingerprint, semantic role, units, grain, date/number convention, exclusions, confirmation status and recipe version. Reuse only after checking the next upload still matches. A client mapping is scoped to that client and cannot override newly conflicting currency or date evidence.

Conversational actions should refer to stable metric/dimension IDs and an allowed operation schema. Additive requests add views to the existing dashboard. Clarify only blocking missing definitions; unsupported actions should explain the missing requirement. Store dashboard config separately from source data and deterministic analysis results, with optimistic versioning for updates.

## Existing code traps found in read-only review

- `cleaning.ts::table` parses recognizable numeric columns before the semantics layer, and its numeric header regex is incomplete for stock/output fields. Use raw values through provenance when applying a different number convention.
- `analytics.ts::inferMapping` currently treats generic `amount`, `total`, and French `recettes` as revenue; broad capability must replace that automatic conclusion with a role proposal.
- `analytics.ts::analyze` requires a valid date even for total/regional outputs, so all undated valid revenue disappears. Broad summaries should declare scope per operation.
- `analytics.ts::parseDate` accepts any number from 1 to 200000 as an Excel date. Only call this on a verified period field, and handle Year separately.
- `financial.ts::financialAnalysis` computes change from the last two observed periods even when a period is absent. Avoid describing this as adjacent-period growth without checking continuity.
- `cleaning.ts` supplies `aggregation: last` for all percent/ratio measures; this prevents summation but is not a quarter-wide weighted metric. Reconstruct numerator/denominator where possible; otherwise keep reported observations.
- `import-spreadsheet.ts::csvRows` chooses delimiter by separator counts across raw lines, without excluding quoted separators. Semicolon data with many decimal commas can be incorrectly tokenized. Both `numbers_ambiguous.csv` and `numbers_decimal_comma.csv` are useful regression fixtures.
