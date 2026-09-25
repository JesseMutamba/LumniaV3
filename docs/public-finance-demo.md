# Public Finance mode

Independent, French-first visitor demo at `/workspace/#/public-finance`. Enterprise demo remains at `/workspace/#/demo`; existing Studio, authentication, report APIs and database schema are unchanged. Root hash route also redirects through the portal bridge. Available from the enterprise demo and homepage footer.

## Demo story

An illustrative DRC public-finance review inspired by needs described in the supplied PSEN 2026–2030 workshop post: reliable collection, institutional coordination, programme monitoring and transparency. No claim of an official PSEN implementation, endorsement or actual government statistics. All institutions and programmes are illustrative.

- Six sections: overview, budget execution, programme results, sources/preparation, scenarios, citizen view.
- Filters by institution/province update all calculations and guided answers.
- Synthetic input: 10 CSV rows, eight accepted, one repeated ID, one missing payment. Totals: annual voted budget USD 9.7m, commitments USD 6.88m, payments USD 5.24m. Three programmes have an elapsed deadline and unmet target as at June 30, 2026.
- Source sheets retain original CSV row numbers and raw exclusions. Payments are included in commitments; do not add them together. Missing values are not zero-filled.
- Cost scenario applies to unspent annual budget. A 10% increase at unchanged funding yields a USD 446,000 gap. The model assumes voted budget as available funding; it is not a cash balance or calibrated probabilistic forecast.
- Local save/reopen preserves the source rows, exclusions, filters and scenario settings under a separate storage key. No database calls or shared reviews are created. Imports stay in browser memory unless the user elects to save locally.
- Citizen export contains aggregates for selected institutions, marked demonstration/non-official. It downloads a file, not a public online publication.

## Import contract

CSV UTF-8, semicolon or comma separator, exact normalized headers as in the downloadable template; at most 2MB and 5,000 rows. USD annual 2026 budgets with cumulative commitments/payments at June 30. This is a scoped intake prototype, not arbitrary workbook understanding. Dates are ISO; nonnegative amounts <= 1e12; positive budgets and targets; payment <= commitments <= budget; realised <= target. Duplicate IDs, invalid dates, missing values and other violations are excluded and disclosed. Imports require preview/application before replacing the active dataset.

## Intentional boundaries

No government system integration, real approvals, multi-user coordination, official publication, currency conversion, open-ended AI or Monte Carlo calibration. Coordination is demonstrated by consolidating institution views and surfacing review issues, not a live cross-agency workflow. Production integration requires the agency's data definitions, period/currency model, access controls and review workflow.

## Verification

`node web/scripts/test-public-finance.mjs` tests arithmetic, exclusions, changed source values, malformed input, invalid dates, saved raw-data roundtrip and scenarios. Existing route and portal assembly tests protect legacy entry points. Standard CI covers backend, financial pipeline and PostgreSQL compatibility.
