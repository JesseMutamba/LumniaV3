# Current Railway release

See [docs/railway-release.md](docs/railway-release.md) for the current upload flow, named-client financial persistence, PostgreSQL compatibility, deployment settings and verification. Notes below record earlier implementation stages, including standalone SQLite instructions that do not apply to the live portal. Source version 0.3.0 is prepared locally; PostgreSQL integration and source delivery remain release gates. Production has not been upgraded.

# Lumnia Studio demo release

The Studio opens with data preparation and a persistent assistant. Existing report operations remain available from the workspace.

## Demo walkthrough

1. Open Studio and choose a client/workspace.
2. Choose New dashboard → Try sample data, or upload XLSX/XLSM/CSV/TSV.
3. Inspect the detected table, source/prepared previews, cleaning steps and warnings. Check mappings and currency; optionally exclude exact duplicate rows. Approve the prepared data.
4. Ask “Show monthly revenue”. Then ask “Add revenue by region”. The second request adds to the same dashboard. Product, quarterly and annual revenue views are also supported.
5. Save the dashboard. Open Saved dashboards, reopen it, and continue the conversation. Data, provenance, mappings, charts and messages are restored together.
6. For financial workbooks choose a detected financial table and measure. “Uncover insights” describes calculated values with source references. Annual projections stay annual; source currencies remain separate.
7. Reports & operations retains Ask, client context, monitoring, financial modules, report publication, portals and simulations. Generated drafts can now be saved, reviewed and explicitly published.

## Repairs included

- Cross-client report ID replacement rejected at route and database layers; metadata listing requires author access; client readers cannot open drafts.
- Credential reset, disable/re-enable and username recreation revoke previous sessions.
- Finite typed report values, valid addresses, declared positional source indexes; generic tables expose all sources and totals.
- Calendar alignment, missing-period chart gaps, common-period ratios, excluded labels/sheets, currency-aware payment reconciliation candidates.
- Accepted analysis plans enforce retained file versions and context versions and scope selected metrics. Direct matching reads both languages; unsupported period filters do not silently return broad totals.
- Duplicate row/table identities preserved in recurring comparisons; significant alerts prioritized before display limits; upload commits are atomic.
- CSV/TSV, numeric year headers and localized numbers supported by the legacy loader; invalid files and formula/cache issues return actionable feedback. Explicit subtotal and revenue/volume checks run on eligible detected structures.
- Studio displays quality checks, handles stale client requests and rejected tokens, lists saved reports and exposes deletion of retained workbook copies.
- Empty readers, zero-budget rails and mobile source details repaired. Simulation settings and seeded runs persist in the current browser; changed parameters show a rerun notice. Existing simulation model explicitly requires USD monetary inputs.

## Validation

162 backend tests passed, including the two supplied financial workbooks and new audit regressions. The prepared-data pipeline detected 19 selectable source tables (12 in Montage financier, seven in SUIVI FINANCES). Regression controls include annual revenue, separate USD/CDF movements, original cell references, date conflicts and formula errors. The simulation oracle passed 61 assertions. Vite production build passed.

The hosted analytics adapter separately validates the same prepared snapshot schema and enforces per-user ownership and optimistic version checks. A local API test exercised messy sample import → monthly chart → added regional chart → create/update/reopen, plus invalid input, cross-owner access, stale updates and a competing write. These are local automated checks; no browser interaction or Railway production deployment was performed for validation.

## Current boundaries

The conversational layer supports explicit analytical operations; it is not an unrestricted AI analyst. Arbitrary filters, new forecasts and currency conversion are declined. Unknown dimensions are not invented. Formula results depend on cached workbook values; missing or errored formulas stay flagged. Ambiguous structures and dates require review. Provenance establishes the source reference and preparation history, not independent verification of every imported financial assertion.

Original report draft excerpts remain bounded; use Studio Data to inspect the full prepared table. Uploaded browser files are limited to 8 MB and prepared snapshots to 20,000 rows / 750,000 cells / 12 MB. Simulation preferences are local to the reader's browser; dashboard saves are server-backed.

The privately hosted demo runs the same preparation/core/Studio component with an authenticated storage adapter. Its Reports & operations link opens the existing Railway application. Production backend repairs require deploying this repository to Railway; publishing the analytics demo does not update Railway.

## Railway release

Deploy the repository branch `feat/lumnia-demo-release` using the existing Docker/Railway setup and persistent database volume. The startup migrations add revocable session identity and saved analytics dashboards. Take the normal database backup before rollout. Existing client sessions require signing in again after this session-format change. Re-upload a workbook once to refresh an older recurrence baseline. Existing reports, clients, portals and contexts are retained.

## Financial review and automated upload analysis — September 10

A new Financial review workspace is available alongside Analytics Studio and Reports & operations. Open `#/studio?workspace=financial`, select a client, and upload an annual USD palm-oil plan with optional Q1 actuals. The source worksheets are prepared automatically; a review screen exposes the selected measures and unresolved issues before opening the seven dashboard tabs.

The shared profile calculates source-linked unit economics, a provisional Q1 comparison, editable multi-year scenarios, seeded Monte Carlo distributions, and plan capacity warnings. It validates periods and currencies, reconciles monthly plans to annual totals, and retains missing values. `ANALYSIS_PIPELINE.md` records the supported profile, exact formulas, selection rules and limitations.

Financial reviews save under the existing author authentication and client organization. The API uses strict 4 MB document limits, source membership checks, retention/sheet exclusions and compare-and-swap versions. The new table is created additively during application startup. Named client author accounts remain a separate authentication extension.

Validation: production web build; 22 synthetic financial-analysis checks; 157 backend tests plus all 6 real-workbook tests with `LUMNIA_GOLDEN_DIR` supplied. Private demo validation also covers the two supplied financial workbooks, saved source evidence, scenario restoration, owner isolation and concurrent-save rejection. No browser/end-to-end interaction test was run for this release.

Hosted demo: https://folio-sales-studio.jrippyjay.chatgpt.site (private). It contains the client review and preserves the generic Studio at `/lumnia`. GitHub push remains unavailable in this environment, so this source branch/patch has not changed the Railway deployment.
