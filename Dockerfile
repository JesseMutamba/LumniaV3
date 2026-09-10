# One service, one URL. Stage 1 builds the web client; stage 2 is the API
# image that also serves it. Same origin means no CORS, and the client's
# API base defaults to /v1 when built without VITE_API.

FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build -- --base ./
COPY portal /portal
RUN node scripts/build-portal.mjs

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY api/requirements.txt api/requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock

COPY api/app ./app
COPY --from=web /web/dist ./static
COPY --from=web /static-portal ./static-portal
ENV LUMNIA_STATIC=/app/static
ENV LUMNIA_PORTAL_STATIC=/app/static-portal

# Local/standalone mode uses SQLite on a mounted volume. Existing Railway
# production selects the PostgreSQL portal automatically through DATABASE_URL.
ENV LUMNIA_DB=/data/lumnia.db
VOLUME /data

EXPOSE 8000
CMD ["python", "-m", "app.serve"]
