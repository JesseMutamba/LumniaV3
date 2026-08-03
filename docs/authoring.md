# Publishing a report

The platform holds no data until you put some there. Three steps.

## 1. Create the client, once

Studio → **03 · Clients**, or:

```bash
curl -X POST $API/v1/orgs \
  -H "Authorization: Bearer $LUMNIA_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"pvak","name":"PVAK","sub":{"fr":"Mwebe & Kwenge, RDC"}}'
```

## 2. Build the report document

A `.json` file matching `api/templates/report.template.json`. You analyse the
workbooks however you like — Claude Code, a notebook, by hand — and the output
is this document. Two rules:

- **Every number is a `Value`**: `{"n": …, "unit": …, "src": {"file": …, "sheet": …, "cells": …}}`.
  `file` indexes your `sources` array. No `src`, no publish.
- **Only the eight block types.** `heading` `prose` `kpiGrid` `rail` `barPair`
  `flag` `table` `ledger`.

Prompt that works in Claude Code:

> Read `docs/schema.md` and `api/templates/report.template.json`. Analyse the
> workbooks in `./data`. Produce `out/pvak-fy26-q2.json` conforming to the
> schema. Every Value must carry the real sheet name and A1 range it was read
> from — if you can't cite a cell, leave the figure out. Use FR and EN for all
> text. Validate with:
> `python -c "import json,sys;sys.path.insert(0,'api');from app.schema import Report;Report(**json.load(open('out/pvak-fy26-q2.json')));print('ok')"`

## 3. Publish and send the link

Studio → **01 · Publier un rapport** → drop the `.json`. Or:

```bash
curl -X POST $API/v1/studio/import \
  -H "Authorization: Bearer $LUMNIA_ADMIN_TOKEN" \
  -F file=@out/pvak-fy26-q2.json
```

Either way you get back a `share_key`. The stakeholder link is:

```
https://<your-site>/#/r/<report id>?k=<share key>
```

Send it. No account, no password, no app. It opens on a phone.

## Corrections

**Republishing the same `id` keeps the same link.** Fix a number, re-import,
and everyone already holding the URL sees the corrected version. This is the
main reason to keep report ids stable and meaningful (`pvak-fy26-q2`).

**A wrong number gets retracted, not deleted.** Set status to `retracted` and
the link returns 410 with a plain message that the report was withdrawn — the
reader learns something rather than hitting a dead URL.

**Rotate the key** if a link went somewhere it shouldn't have. Old links stop
working immediately.

## What a reader can and cannot do

Can: open their report, switch FR/EN, hover any `⌖` chip to see the source cell.

Cannot: see other reports, see the client list, see Studio, upload anything.
There is no navigation out of a report because a reader has nowhere else to go.
