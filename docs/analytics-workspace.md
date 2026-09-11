# Lumnia analytics workspace

This update extends the existing React/Vite and FastAPI application. It does
not replace the landing page, client accounts, portals, published report
viewer, source drilldowns, scenario/Monte Carlo tools, existing Ask modes,
named modules, or report schema.

## Product changes

- Studio separates **Reports & operations** and **Explore data**. Both remain
  mounted when switching, keeping work in progress available.
- Existing workbook ingestion now displays its returned quality checks and
  opens failed checks for review. Pending questions, tiles, and ingestion
  results are checked against the selected client before display.
- Explore data imports a workbook or delimited file, detects candidate tables,
  shows source/prepared previews, and reviews mappings before use.
- Charts append to the current dashboard. Authors can remove a chart directly,
  change the financial measure, review original cell addresses, and ask further
  questions without rebuilding the whole dashboard.
- Save/reopen persists a dataset snapshot, cleaning report, mapping, views,
  selected measure, and the most recent 100 conversation messages. Save a copy
  creates a new identity. Version conflicts preserve the current server copy.

## Architecture

The portable preparation/calculation logic is in `web/src/lib/analytics`.
`AnalyticsWorkspace.jsx` uses Lumnia's existing visual tokens and API client.
ExcelJS loads only when an upload needs it; the analytics page is lazy-loaded.

`api/app/routers/analytics.py` provides author-only, organization-scoped routes:

| Method | Route suffix under `/v1/studio/orgs/{org}/analytics` | Purpose |
|---|---|---|
| GET | `/dashboards` | Saved dashboard summaries |
| POST | `/dashboards` | Create a dashboard snapshot |
| GET | `/dashboards/{id}` | Reopen a dashboard and prepared source |
| PUT | `/dashboards/{id}` | Save changes with `expected_version` |

The additive `analytics_dashboards` table is created during normal startup.
It uses the existing `LUMNIA_DB` SQLite database, has an organization foreign
key, and cascades on organization deletion. No existing table or report
document is rewritten. No new environment variables or credentials are needed.

Prepared snapshots are user-authored analysis state, not trusted published
report values. They do not bypass the existing report schema or publication
checks. The new workspace does not automatically send uploaded values to an
external model. Existing optional model behavior remains on its original path.

## Data integrity

- Flat tables retain original row numbers and column positions after blank or
  repeated rows are removed. Financial observations retain exact source cells.
- Every plotted aggregate lists all contributing amount cells; disjoint source
  ranges are not represented as one continuous range.
- Currency evidence from amount text, number formats, or a currency column is
  preserved. Mixed currency evidence blocks grouped sales totals. Selecting a
  currency labels values; it does not convert them.
- A calendar-year column is treated as calendar years. Localized numbers work
  for manually selected amount columns as well as inferred ones.
- Financial period headers, measure/currency matches, source sheet identity,
  table dimensions, finite values, and request sizes are validated on save.
- Client sheet exclusions apply before Excel preparation and again on save.
  A client that disables file retention cannot save a prepared-data snapshot.
- Workbook formulas are not executed or recalculated. Missing/error results
  stay missing and produce review notes.

## Verification

Run the existing backend suite and the added integration tests:

```bash
cd api
python -m pytest tests/ -q
```

Run the preparation and conversational state checks and build the frontend:

```bash
cd web
npm ci
npm run test:analytics
npm run build
```

To run the optional real workbook checks, pass the local paths to the supplied
financial-model and finance-tracker workbooks to `npm run test:analytics --`.
Those files and their financial contents are not committed to this repository.

Validation for this update includes both supplied workbooks (19 detected
tables), matching annual revenue and separate USD/CDF cash controls, and
saving/reopening each detected table through the real FastAPI routes against
an isolated SQLite database. Automated API tests cover authorization, client
scope, source validation, data retention, deletion cleanup, and save conflicts.
No browser or visual testing was performed.

## Rollout

Review the feature branch before merging. Use the project's existing Docker
build and Railway deployment process. Preserve the current persistent SQLite
volume and environment variables. On first startup, the application creates
the new analytics table automatically. Open Studio and choose Explore data.

This source update alone does not deploy or modify the current Railway service.
