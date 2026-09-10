# Preserved production portal

These six public assets were captured from the existing Lumnia Railway service on September 10, 2026. The files in `public/` preserve their downloaded bytes. They retain the current landing and sign-in page, pilot-request form, public sample report, sample image, and two explicitly synthetic sample workbooks. The private uploaded PVAK workbooks are not included.

`public-snapshot.json` records the source URLs, byte counts, and SHA-256 hashes. The HTML was checked for private-key blocks and recognizable provider, GitHub, AWS, and JWT credential literals; none were found. Both public workbooks contain demonstration markers and neither contains the private uploaded workbook names. This is a focused release check, not a general credential audit.

| Public source | SHA-256 |
| --- | --- |
| [assets/sample-report.webp](https://lumnia-reports-production.up.railway.app/assets/sample-report.webp) | `3394245bf618c884c72b289a0555eae98d7b1c3dcb3972620f7950d781cb1e64` |
| [assets/sources/Journal_tresorerie_2026.xlsx](https://lumnia-reports-production.up.railway.app/assets/sources/Journal_tresorerie_2026.xlsx) | `bcadc9c17b1db7e4f1efce83c87983ba6d4e4fe444b4c00f18fcb9b4e304a571` |
| [assets/sources/Plan_budgetaire_2026_2030.xlsx](https://lumnia-reports-production.up.railway.app/assets/sources/Plan_budgetaire_2026_2030.xlsx) | `da6864e1def9f7242be8f0bce337526564a932243b471cefa55d3a0c8265fa16` |
| [index.html](https://lumnia-reports-production.up.railway.app/) | `7ad917e18e2b54663ff1db66fe09b11cfd5353a7f7ad6148f80e02c5f9fae0a2` |
| [reports/sample/index.html](https://lumnia-reports-production.up.railway.app/reports/sample/) | `e056f9e3cfc9bab5fbb19d5da94001867bc67aa93547c9a3f365082c24121b66` |
| [signup/index.html](https://lumnia-reports-production.up.railway.app/signup/) | `21ad233daa0e59ec9274a342d9f44314ba0b166119483a8bd80a3b24497badcc` |

## Assembly

Build the React application from `web/` with `npm run build -- --base ./`, then run `node scripts/build-portal.mjs`. The result is `static-portal/` beside `web/` (or `/static-portal/` in Docker):

- `/` keeps the existing application, with one branded “Analyze your data” entry added by the first-party bridge. It opens `/workspace/#/analysis`, which uses the existing client session or prompts for sign-in.
- `/#/analysis`, `/#/studio`, and `/#/financial` redirect to the equivalent workspace hash. Existing shared-report hashes remain on the original viewer.
- `/signup/` and `/reports/sample/` preserve their original content and public source URLs.
- `/workspace/` serves the new compiled application; `/brand/` makes its supplied LUMNIA assets available to existing root-relative component styles.

The build verifies every captured source hash before assembly. Only the assembled root HTML receives the bridge stylesheet, link, and script; no captured source is rewritten. The script does not read or modify session tokens. The preserved and new apps share the existing same-origin `lumnia.session` storage convention.

The standard SQLite application continues to use `web/dist/`; these public portal snapshots are assembled separately. The Docker build must include `portal/` and explicitly permit the two synthetic workbook paths through `.dockerignore`, which excludes private spreadsheets by default.
