# Lumnia Railway release

This release adds the prepared Analytics Studio and seven-tab financial review to the existing production portal. It has not yet been deployed. Do not deploy the earlier SQLite-only package to the PostgreSQL production service.

## Confirmed production target

| Item | Existing value |
| --- | --- |
| Project | `lumnia-api` — `efec166d-2821-4444-9b2b-3cfd89b42845` |
| Environment | `production` — `a053b78a-e974-4fd4-b703-6cbff829b7cf` |
| Service | `lumnia-reports` — `d730f7b1-7d5e-45dd-a2d5-a6867e0eef64` |
| Domains | `https://lumnia.io` and `https://lumnia-reports-production.up.railway.app` |
| Successful rollback deployment | `52e2a54a-34d9-4b9a-a89f-9e8423598cca` |
| Source before upgrade | Uploaded snapshot; no GitHub repository or branch connected |
| Database | PostgreSQL 18, existing `DATABASE_URL` reference |
| Database volume | `postgres-volume`, `/var/lib/postgresql/data`, 5000 MB |
| App volume | None; the production app does not use SQLite |
| Public domain target | 8080; application binds Railway-assigned `PORT` |
| Existing health check | `/health`; the upgrade preserves this and `/v1/health` |

Inspection found 32 pre-existing staged changes across the environment. Do not commit all staged changes with `accept_deploy` as part of this code release. Preserve unrelated `lumnia-api` and Postgres settings, domain configuration, and existing secrets.

## Two runtime modes

The same image retains the standalone SQLite author application when `DATABASE_URL` is absent. When it is present, `app.main` selects the production PostgreSQL portal. It validates the existing `public.orgs`, `reports`, `users`, `sessions` and `pilot_requests` schema before creating anything. A database failure aborts startup; there is no SQLite fallback.

The new mode preserves existing password hashes, opaque sessions, report/share links, org portals, and pilot submissions. It does not reseed accounts or reports from environment values or bundled data. New client dashboards, financial reviews, definitions, preparation settings and optional encrypted AI connections live in `lumnia_studio`, with foreign keys to existing organizations. Ownership is derived from the verified PostgreSQL user ID and organization; browser-submitted identity is not trusted.

The live public landing, signup form, sample report, and two already-public synthetic source workbooks are preserved with a hash manifest under `portal/`. The new React workspace is served at `/workspace/#/analysis`. Root `/#/analysis`, `/#/studio` and `/#/financial` links redirect there. Existing reports continue at their original paths. The standalone SQLite author routes remain available only in that runtime mode.

## Build and database preservation

Use the root Dockerfile. It builds the current web client with `npm ci`, assembles the preserved portal plus new workspace, and installs the exact Python dependencies in `api/requirements.lock`. The image starts `python -m app.serve`, uses `PORT`, and exposes both health paths. Preserve the current domain target, database reference and one replica. A PostgreSQL deployment needs no app volume.

Preserve all existing Railway variables. Do not replace `DATABASE_URL` or reset `LUMNIA_CLIENT_*`, `LUMNIA_DEMO_*`, organization branding or portal-key variables. The upgraded app reads current database accounts directly. Optional `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` enables flexible conversational planning; financial calculations and the deterministic planner do not require a provider. Saved organization provider keys require a stable `LUMNIA_CREDENTIAL_KEY` containing a URL-safe base64-encoded 32-byte AES-GCM key. Credentials stay server-side.

Before rollout, obtain a verified backup of the existing Postgres volume/database through authenticated Railway access. No production backup or live row-count verification has been performed in this session. Do not publish client databases, uploaded financial workbooks or credentials. The two public synthetic workbook exceptions in `.dockerignore` are exact paths only.

## Required release gates

1. Run the full backend tests and production web build. Run `node scripts/test-portal-client.mjs`, the Studio intake checks and `node scripts/build-portal.mjs` from `web`.
2. Run the PostgreSQL 18 integration workflow (`.github/workflows/portal-postgres.yml`) against a disposable database. It verifies existing records and sessions, private saved reviews, concurrency, failed-startup behavior and actual process restart. Locally, `LUMNIA_TEST_POSTGRES_URL` must point to a disposable test cluster with create-database privileges. The suite never defaults to production `DATABASE_URL`.
3. Publish the exact prepared branch `feat/lumnia-demo-release` in `JesseMutamba/LumniaV3`. Confirm the tested commit is the commit being deployed. GitHub connection alone does not connect the existing Railway snapshot service to that branch.
4. Deliver the tested source to the existing service through an authenticated source upload, or connect the service to the tested GitHub branch. The current Railway connector can redeploy existing source but cannot upload the local archive or connect an existing service to GitHub. Do not redeploy the old snapshot and describe it as the upgrade.
5. Watch the Docker build and health check until the target deployment is successful. Local tests do not substitute for Railway image build success.
6. Verify `/v1/health`: version `0.3.0`, `deployment_mode: portal`, and features `analysis-studio`, `combined-financial-upload`, `client-financial-reviews`. Match `revision` when supplied by the source workflow; if a snapshot has no SHA, verify the deployment snapshot and build provenance directly.
7. Check the original landing, `/signup`, `/reports/sample/#/r/demo-estate-q1?k=sample`, existing authenticated reports and shared links. Sign in with an existing client account and open `/workspace/#/analysis`.
8. Upload both supplied workbooks together. Confirm Overview, Financial plan, Q1 vs plan, Cost per tonne, Forecast, Monte Carlo, and Sources & preparation. Save, refresh, reopen and verify the same assumptions and provenance. Confirm another account cannot open that private review.

The supplied PVAK financial oracles are $592.98/t CPO annual plan and $982.47/t Q1 actual. Conflicting source dates and cost scopes remain provisional; deployment must not remove those flags. Client workbook files are not public demo assets.

## Recovery

Keep the current successful deployment and verified database backup. Migrations add Studio tables without rewriting original portal records, so code rollback can preserve the original portal. Studio work remains in its namespace for a later corrected release. Restore a database backup only as an explicit recovery decision: it can discard writes since backup. Never automatically overwrite client work.
