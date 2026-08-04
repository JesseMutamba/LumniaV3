# One service, one URL. Stage 1 builds the web client; stage 2 is the API
# image that also serves it. Same origin means no CORS, and the client's
# API base defaults to /v1 when built without VITE_API.

FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build -- --base ./

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/app ./app
COPY --from=web /web/dist ./static
ENV LUMNIA_STATIC=/app/static

# SQLite lives on a mounted volume so reports survive a redeploy.
ENV LUMNIA_DB=/data/lumnia.db
VOLUME /data

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
