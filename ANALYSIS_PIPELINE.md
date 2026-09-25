# Automated financial review pipeline

Lumnia now runs the same analysis code on new client uploads that generates the financial dashboard. `inspectSpreadsheet()` reads the workbooks; `analyzeWorkbooks()` selects and reconciles measures; `forecast()` and `simulate()` produce the editable scenarios. The UI is a view of this review document, not a set of hardcoded client figures.

## Supported scope

This first automated financial profile recognizes annual palm-oil plans denominated in USD with revenue, total OPEX, total CAPEX, fresh fruit bunches (FFB), and crude palm oil (CPO), plus optional monthly cost/production actuals for Q1. It uses normalized labels and reconciliation, not filenames, fixed cell coordinates, or a hardcoded budget year. French and English measure labels are recognized. The existing Analytics Studio remains available for ordinary tables, ledgers, financial matrices and conversational sales dashboards.

This is a deterministic profile, not a promise that any arbitrary unstructured file will yield a valid financial forecast. Unrecognized summaries, ambiguous equivalent totals, unsupported units and missing currency evidence require source review. Further industries need additional explicit profiles and mapping interfaces. Production is interpreted in tonnes from source tonne labels and the cost/production relationships; this inference is disclosed for client confirmation.

## Preparation and analysis recipe

1. Hash each source file. Read active cells, locale-formatted numbers, cached formula results, merged labels and hidden-sheet metadata. Preserve original sheet and cell references. Do not rewrite source workbooks or recalculate unavailable external links.
2. Detect flat tables, ledgers and multi-period matrices. Ignore formatting-only rows. Surface formula errors and missing caches. Keep blanks unavailable; never convert missing actuals to zero. Exclude unconfirmed template periods.
3. Recognize a unique annual summary. Require independent USD evidence for every monetary total. Select explicit totals rather than component categories, and preserve measured quantities separately from money.
4. Select projection years from the prepared row basis. Require complete revenue, OPEX, CAPEX, FFB and CPO values. The model requires positive production, extraction between 1% and 45%, and nonnegative revenue and expenditure. Recorded baselines do not become forecast years.
5. Reconcile each complete monthly budget to the annual total. Prefer explicit grand totals and additive consolidated production formulas. Never sum site and consolidated copies together. Detect alternative subtotal schedules with different monthly timing. If conflicting schedules have no justified priority winner, leave that monthly mapping unavailable.
6. Validate every actual series for unique full year/month keys. Never override an explicit currency conflict using numerical similarity. Unspecified actual cost currency may be inferred from a USD cost-per-tonne identity only with consistent evidence. Conflicting source years remain visible; no automatic year correction occurs.
7. Compare Q1 using the same common observed months across costs, FFB and CPO on both sides. Mark incomplete periods and cost-scope differences. Production rates use summed matching production, and unit cost is summed matching costs divided by summed matching CPO. Never average monthly ratios.
8. Generate the seven tabs, a review queue, and source-linked explanations. Annual plan categories and quarterly actual categories remain separate; no unreviewed category mapping is presented as a variance. Do not infer actual sales revenue from cash receipts or production.
9. Save a versioned review document with source hashes/cells, bindings, review flags, drivers, Monte Carlo settings and selected tab. Reopening recomputes the simulation with the same seed. Concurrent stale updates fail instead of overwriting another session.

## Forecast and Monte Carlo definitions

- CPO = FFB × extraction. Revenue = CPO × selling price.
- Annual reported OPEX = source OPEX × cost pressure × [(1 − variable share) + variable share × volume factor]. Initial variable share is 30%, an editable user assumption.
- Reported OPEX per tonne = OPEX / CPO; CAPEX is excluded.
- Total planned expenditure per tonne = (OPEX + CAPEX) / CPO, labeled separately.
- Funding balance after CAPEX = revenue − OPEX − CAPEX. It excludes financing, working capital and taxes; it is not net profit or a full cash-flow forecast.
- Price, FFB volume and OPEX uncertainty use independent mean-adjusted lognormal multipliers. Inputs are coefficients of variation. Extraction uses a normal shock measured in percentage points, bounded to 1–45%. CAPEX is fixed at its scenario amount.
- Default uncertainty: price 15%, volume 20%, OPEX 10%, extraction 1 percentage point; 3,000 seeded trials. These are disclosed scenario assumptions, not estimates fitted to the workbook's future plan years. Capacity constraints and correlations are not modeled.
- P10/P50/P90 and probabilities use every trial. Histogram tails are included in its first and last buckets. Changed inputs mark previous results stale until rerun.

## Deployment boundaries

The private hosted demo uses trusted workspace identity and owner-scoped D1 metadata with immutable object snapshots. The Railway adapter retains the current product's author-token authorization and organization scope. Named client author identities are a separate authentication extension; a shared admin token does not create per-client logins. The included financial assistant handles supported metric navigation and bounded scenario commands deterministically. It is not unrestricted language-model analysis.


# Upload-to-dashboard dispatch

Studio and the financial review use `lib/studio/intake.ts`. Uploaded workbooks are inspected with the client's excluded-sheet settings before dispatch. Annual cost, revenue and palm-oil production measures identify a plan; monthly costs, FFB and CPO identify operating results. Filenames, source hashes and the private example never select or fill financial values.

One compatible plan and optional results workbook generate the same validated `Review` and the same seven-tab `FinancialReview` used by the example. Multiple plans, duplicate inputs, extra workbooks and invalid financial definitions require source selection or correction. Unrelated datasets continue through general table preparation. This is a supported financial profile, not a claim that every dataset has meaningful palm-oil forecasts or Monte Carlo inputs.

Fresh uploads disable last-review restoration. Saving retains the full analysis, cell references, warning flags, chosen tab and scenario assumptions. Financial reviews appear in Studio's saved dashboard list. Unsaved reviews receive a leave prompt; edits made during a save remain marked unsaved.

Regression: `node scripts/test-studio-intake.mjs`. Set `UPLOAD_FIXTURES_DIR` to a private directory containing the plan and results XLSX files to check actual parser output against the example; workbook bytes are not included in the test source.


Named client accounts use the verified analysis-studio principal for financial review CRUD. Ownership is bound to account creation identity and organization. Author snapshots remain under the existing author identity. Retention and excluded-sheet settings are enforced before saving. The client workspace passes a dedicated JSON-returning financial API adapter; its credentials cannot be forwarded to another origin or API path.

Client persistence regression: `cd api` then `pytest tests/test_financial_clients.py`. Upload dispatch regression: `cd web` then `node scripts/test-studio-intake.mjs`.
