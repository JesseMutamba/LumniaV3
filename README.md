# Lumnia

Verified operating intelligence for markets with no system of record.

A report is not a page. It is an ordered list of typed blocks, and **every
number in it carries the address of the cell it came from**. You analyse the
client's files, publish a report document, and send one link. The stakeholder
opens it on a phone with no account.

The platform ships empty. It holds only what you publish.

## Three surfaces

| | Who | Where | Needs |
|---|---|---|---|
| **Studio** | you | `#/studio` | the author token |
| **Portal** | your client | `#/c/<org>?k=<key>` | the portal link |
| **Viewer** | your stakeholder | `#/r/<id>?k=<key>` | the link |

A reader cannot reach Studio, cannot list clients, and cannot open a report
they don't hold a key for. A portal key is scoped to one client: it lists
that client's published reports and nothing else. There is no navigation out
of a report because there is nowhere for them to go.

## Layout

```
lumnia/
├── api/                       FastAPI · Python 3.11+
│   ├── app/
│   │   ├── schema.py          the contract — Value cannot exist without Src
│   │   ├── auth.py            author token + per-report share keys
│   │   ├── store.py           SQLite, reports as JSON documents
│   │   ├── bootstrap.py       startup; creates nothing you didn't ask for
│   │   ├── pipeline/
│   │   │   ├── ingest.py      read a workbook, address every cell
│   │   │   └── checks.py      CH-001…CH-004, deterministic, tested
│   │   └── routers/
│   ├── templates/             report.template.json — every block type
│   ├── examples/              pvak_adapter.py — a worked build, not wired in
│   ├── Dockerfile · fly.toml
│   └── tests/                 22 tests
├── web/                       React 18 + Vite, hash routing
│   └── src/
│       ├── App.jsx            router · Home · Viewer
│       ├── pages/Studio.jsx   publish, share, retract
│       └── blocks/index.jsx   one component per block type
└── docs/
    ├── schema.md              the block contract
    ├── authoring.md           how a report gets published
    └── deploy.md              how to host it
```

## Run locally

```bash
make install
export LUMNIA_ADMIN_TOKEN=$(openssl rand -hex 24)
make api        # :8000/docs
make web        # :5173
make test
```

Open `#/studio`, paste the token, create a client, drop a report `.json`.

## Publish

Read [docs/authoring.md](docs/authoring.md). Short version: build a document
matching `api/templates/report.template.json`, drop it in Studio, send the
link that comes back.

## Host it

Read [docs/deploy.md](docs/deploy.md). Short version: container on Fly with a
1 GB volume, static build on Cloudflare Pages, two env vars.

## The one rule

`Value` requires `Src`. Pydantic will not construct a number without an
address, `CH-004` re-asserts it on every publish, `POST` returns 422 if it
fails, and the client renders `∅` rather than a number for anything that
arrives unsourced.

That constraint is the product. Everything else is replaceable.

## Block types

`heading` · `prose` · `kpiGrid` · `rail` · `barPair` · `flag` · `table` · `ledger`

Frozen at eight. Report #2 is the test of whether they hold. Unknown types
render a labelled placeholder rather than crashing, so the pipeline can ship
ahead of the client.

## Checks

| ID | Catches |
|---|---|
| CH-001 | Parent/child hierarchies flattened into one column. Naive summing double-counts. |
| CH-002 | A stated subtotal that disagrees with its own line items. |
| CH-003 | An implied unit price that silently changes between periods. |
| CH-004 | Any value that reached a report without a source cell. |

## Known gaps

- **Layer 02 (parse & normalize) is a first slice.** `POST /v1/studio/ingest`
  detects tables with confidence scores and returns a reviewable draft report
  in which every value carries its source cell. Header inference and column
  typing only: merged cells, multi-row headers and semantic mapping (which
  table is *the budget*?) still need a person, and
  `api/examples/pvak_adapter.py` remains the reference for a hand-built
  report. The machine writes the first draft; the author signs it.
- **Share keys are bearer tokens in a URL.** Unguessable, but a forwarded link
  is a granted read. Right trade for named stakeholders, wrong one for an
  enterprise buyer.
- No read audit log, no rate limiting, no accounts.
- `barPair` takes exactly two series.
