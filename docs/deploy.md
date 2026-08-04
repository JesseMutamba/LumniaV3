# Hosting Lumnia

One service. The API is a small container with a SQLite file on a volume,
and the same container serves the built web client — one origin, no CORS,
one bill. Total cost at this scale: the host's smallest paid instance.

## The wired-in path: Render

This repo ships ready for Render. The root `Dockerfile` builds the web
client in a Node stage and serves it from the FastAPI image at `/`; the
API lives under `/v1` on the same hostname.

1. In the Render dashboard: **New → Blueprint**, select this repository,
   Apply. `render.yaml` creates the `lumnia-api` service (Docker, Frankfurt,
   1 GB disk at `/data`) and generates `LUMNIA_ADMIN_TOKEN` for you.
2. Copy the generated token from **lumnia-api → Environment** — it is what
   you paste into Studio to publish.
3. Open the service URL (currently
   `https://lumnia-api-lkfg.onrender.com`). The site is at `/`, health at
   `/v1/health`, API docs at `/docs`. If Render assigned a different
   hostname, update `.github/workflows/smoke.yml` and `seed.yml`, then push.

Optional env var: `ANTHROPIC_API_KEY` enables the Claude rewrite in the
`narrate` module; without it, narration falls back to deterministic
templates.

The disk requires Render's starter plan; on the free tier the SQLite file
would reset on every restart, which defeats the point of publishing.

Everything below is the generic recipe for other hosts.

## 1. One container anywhere

Any container host works — Railway, Fly, a $5 VPS. Build the root
`Dockerfile`; the requirements are a persistent volume at `/data` and the
env vars below.

| Variable | Purpose |
|---|---|
| `LUMNIA_ADMIN_TOKEN` | Required to publish. Unset means the platform is read-only. |
| `LUMNIA_DB` | SQLite path. `/data/lumnia.db` in the container. |
| `LUMNIA_STATIC` | Where the built web client lives. `/app/static` in the image. |
| `LUMNIA_ORIGINS` | Only needed if the web client is hosted on a *different* origin. |
| `LUMNIA_BOOTSTRAP_ORGS` | Optional. `pvak:PVAK:Mwebe, RDC;kamoa:Kamoa:Kolwezi, RDC` |
| `ANTHROPIC_API_KEY` | Optional. Claude narration polish; templates otherwise. |

## 2. Hosting the web client separately (optional)

The client is still plain static files if you ever want a CDN in front:

```bash
cd web
VITE_API=https://your-api-host/v1 npm run build
npx wrangler pages deploy dist --project-name lumnia
```

Routing is hash-based (`#/r/...`) precisely so it needs no server rewrite
rules. If you do this, set `LUMNIA_ORIGINS` on the API to that origin.

## 3. Check it end to end

```bash
curl https://your-host/v1/health
# {"ok":true,"orgs":0,"reports":0,"publishing_enabled":true}
```

Open the site, go to `#/studio`, paste the token, create PVAK, publish a
report, copy the link, open it in a private window. If the private window
renders the report, a stakeholder can too.

## Backups

The whole platform is one file.

```bash
# Render: Shell tab on the service
cat /data/lumnia.db > /tmp/backup.db   # then download it
```

Worth a weekly cron until reports start mattering, then worth more than that.

## What is here now

Share keys are unguessable but they are bearer tokens in a URL — anyone who
receives a forwarded link can read that report. Every read attempt (accepted
or refused) lands in the audit log, public reads are rate-limited, and keys
rotate per report or per portal. For PVAK and a handful of named
stakeholders that is the right trade. No user accounts and no SOC 2 — that
is the gate the next stage of assurance work opens.
