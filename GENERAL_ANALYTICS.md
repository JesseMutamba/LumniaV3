# Lumnia general analytics studio

The general workspace lives at `/studio`. The existing PVAK financial review stays at `/`, including plan/Q1 comparisons, cost per tonne, forecasts and Monte Carlo. The previous exploratory workspace stays at `/lumnia`.

## The six implemented layers

1. **Preparation** — inspect XLSX/XLSM/CSV/TSV, detect table/matrix/ledger layouts, recover original numeric text, trim labels, preserve source rows/cells, flag missing/formula/duplicate/format issues, and reshape financial matrices. Ledger measures and currencies are separated; end-of-day running balances use the last source row within each date, with an explicit chronology warning. Exact duplicate removal is optional; labeled totals are excluded by an explicit setting. Source files are never edited.
2. **Understanding** — infer field types, business roles, units, aggregation, row grain, history/plan basis, date and currency fields. Preserve leading-zero identifiers. Optional AI suggests definitions from metadata. Users review definitions; compatible confirmed definitions are reused by client and schema fingerprint, with fresh data-quality checks.
3. **Planning** — choose summaries, trends, breakdowns, distributions, matched comparisons and weighted ratios according to the fields. Separate currencies and scenario values. Conversation adds declared analyses to the same canvas. Unsupported built-in wording asks for exact controls; optional AI provides broader interpretation through a strict proposal contract.
4. **Calculation** — deterministic tools compute all displayed numbers. Supported tools: summary, trend, breakdown, distribution/IQR flags, Pearson correlation, paired comparison, ratio, and monthly forecast. Forecasting compares naive, drift and linear baselines using rolling one-step holdouts and requires at least 12 consecutive observed months. Forecast error ranges are illustrative, not calibrated confidence intervals. Historical forecast tooling does not fit plans or combine currencies.
5. **Validation** — ambiguous formats and conflicting units block affected calculations, including filtered fields. Missing periods remain gaps. Snapshots cannot be summed across dates; repeated entity/date keys block snapshot totals. Ratios use matching summed inputs. Strict bounded schemas reject invented fields, arbitrary tools, SQL/code, incompatible AI mappings, and stale writes. Findings are computed from the same results shown on the canvas.
6. **Workspace** — preparation, dashboard and data/source tabs; eight analysis controls; conversational additions; encrypted AI settings; server save, reopen, copy and delete; client definition reuse; explicit version conflicts. Saved documents contain source data, references, definitions, cards, filters and conversation, and are recomputed on reopening.

## AI connection

The built-in workflow is usable without a provider. Settings accepts an OpenAI or Anthropic key and configurable model. The server stores the key encrypted with AES-GCM; neither keys nor raw rows are included in AI prompts. AI receives the question, field names, roles, units, min/max and completeness statistics, and existing card definitions. Provider output proposes choices only. Numerical results come from the verified tools.

`LUMNIA_CREDENTIAL_KEY` is a base64 encoding of 32 random bytes, managed as a server secret. Preserve it across releases or existing saved connections cannot be decrypted. Environment `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` is also supported, with optional `LUMNIA_OPENAI_MODEL` / `LUMNIA_ANTHROPIC_MODEL`. Defaults are `gpt-5-mini` and `claude-sonnet-4-5`. Saving a key marks it configured; a successful provider request establishes that it works. Mocked provider tests verify contracts; live provider access was not available during implementation.

## Data boundaries and current scope

- The private Site binds every document to the authenticated workspace owner and client scope. D1 stores metadata/definitions; R2 stores private immutable source snapshots. Delete removes all source versions beneath the dashboard prefix. Writes use compare-and-swap version checks.
- The original FastAPI integration adds `/v1/analysis-studio`, author studio access and a separate signed-client `#/analysis` route. A client can write only their own documents in their verified organization. Only administrators configure organization provider credentials. Existing retention and ignored-sheet context remains enforced.
- Uploaded files are limited to 8 MB each, 20,000 rows, 150 columns and 750,000 prepared cells. Saved conversations have a 100-message bound; dashboards have 20 cards. The general workspace analyzes one detected table at a time. Arbitrary cross-file joins and unknown domain-specific accounting models require explicit definitions; they are not inferred as facts. The existing financial workspace handles the specialized two-workbook comparison and Monte Carlo.
- Interpretation adapts to supported data structures; it does not guarantee equal statistical depth from sparse or ambiguous datasets. Definitions and assumptions remain reviewable.

## Verification

`node scripts/test-studio-core.mjs`: 24 controls across sales, messy rows, locale ambiguity, currency conflicts, identifiers, snapshots, weighted operations ratios, scenarios, forecasting and conversation.

`node scripts/test-studio-api.mjs`: 22 controls covering persistence, CAS conflicts, source retention/deletion, owner/client isolation, definition validation, AI provider contracts/fallback, rate limits and encryption.

The two supplied workbooks also passed preparation and saved-document validation for all 12 and 17 detected/derived tables respectively. Existing financial calculations remain in their specialized tested pipeline.

## Original SaaS release

Author entry: `#/studio?workspace=analysis`. Client entry: `#/analysis`, reached from Analyze your data after named sign-in. Reports, the financial workspace, client portals, publishing and previous analysis tools are preserved.

Run `python -m pytest tests -q` from `api` (165 tests passed, including supplied-workbook controls when `LUMNIA_GOLDEN_DIR` is configured). Run `node scripts/test-studio-core.mjs` and `npm run build` from `web`. The Site API test harness belongs to the separate Site checkout; original API checks live in `api/tests/test_analysis_studio.py`.

The build is on the local feature branch pending authenticated GitHub push and deployment to Railway. Updating the private demo does not update the Railway service.
