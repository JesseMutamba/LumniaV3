# Hosting Lumnia

Two pieces. The web client is static files; the API is one small container
with a SQLite file on a volume. Total cost at this scale: the API host's
smallest instance, or free tiers.

## The wired-in path: Render + GitHub Pages

This repo ships ready for Render (API) and GitHub Pages (web client).

**Web client** — automatic. `.github/workflows/deploy-web.yml` builds
`web/` and publishes it to GitHub Pages on every push that touches it.
Nothing to configure; the site lives at
`https://jessemutamba.github.io/LumniaV3/`.

**API** — one manual step, because it needs your Render account:

1. In the Render dashboard: **New → Blueprint**, select this repository,
   Apply. `render.yaml` creates the `lumnia-api` service (Docker, Frankfurt,
   1 GB disk at `/data`) and generates `LUMNIA_ADMIN_TOKEN` for you.
2. Copy the generated token from **lumnia-api → Environment** — it is what
   you paste into Studio to publish.
3. Check the service URL against `VITE_API` in
   `.github/workflows/deploy-web.yml` (currently
   `https://lumnia-api-lkfg.onrender.com`). If Render assigned a different
   hostname, update `VITE_API` there and in
   `.github/workflows/smoke.yml`, then push.

The disk requires Render's starter plan; on the free tier the SQLite file
would reset on every restart, which defeats the point of publishing.

Everything below is the generic recipe for other hosts.

## 1. The API

```bash
cd api
fly launch --no-deploy          # accept the generated app name or edit fly.toml
fly volumes create lumnia_data --size 1
fly secrets set LUMNIA_ADMIN_TOKEN=$(openssl rand -hex 24)
fly deploy
```

Keep that token. It is the only thing standing between the internet and your
publish endpoint. `fly secrets list` confirms it is set; the value is not
retrievable afterwards.

Any container host works — Railway, Render, a $5 VPS. The requirements are a
persistent volume at `/data` and the two env vars below.

| Variable | Purpose |
|---|---|
| `LUMNIA_ADMIN_TOKEN` | Required to publish. Unset means the platform is read-only. |
| `LUMNIA_ORIGINS` | Comma-separated origins allowed to call the API. Set it to your site. |
| `LUMNIA_DB` | SQLite path. `/data/lumnia.db` in the container. |
| `LUMNIA_BOOTSTRAP_ORGS` | Optional. `pvak:PVAK:Mwebe, RDC;kamoa:Kamoa:Kolwezi, RDC` |

## 2. The web client

```bash
cd web
VITE_API=https://lumnia-api.fly.dev/v1 npm run build
npx wrangler pages deploy dist --project-name lumnia
```

Cloudflare Pages, Netlify, GitHub Pages — anything that serves a folder.
Routing is hash-based (`#/r/...`) precisely so it needs no server rewrite
rules and works on the dumbest possible host.

Then set `LUMNIA_ORIGINS` on the API to the Pages URL and redeploy.

## 3. Check it end to end

```bash
curl https://lumnia-api.fly.dev/v1/health
# {"ok":true,"orgs":0,"reports":0,"publishing_enabled":true}
```

Open the site, go to `#/studio`, paste the token, create PVAK, publish a
report, copy the link, open it in a private window. If the private window
renders the report, a stakeholder can too.

## Backups

The whole platform is one file.

```bash
fly ssh console -C "cat /data/lumnia.db" > backup-$(date +%F).db
```

Worth a weekly cron until reports start mattering, then worth more than that.

## What is not here

No user accounts, no audit log of who read what, no rate limiting, no SOC 2.
Share keys are unguessable but they are bearer tokens in a URL — anyone who
receives a forwarded link can read that report. For PVAK and a handful of
named stakeholders that is the right trade. For an enterprise buyer it is not,
and that is the gate the assurance work opens.
