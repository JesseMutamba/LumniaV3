from __future__ import annotations

import os
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import store
from .bootstrap import bootstrap
from .routers import ask, ingest, reports
from .schema import BLOCK_TYPES

VERSION = "0.2.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap()
    yield


app = FastAPI(
    title="Lumnia API",
    version=VERSION,
    description=(
        "Verified analytics for markets with no system of record.\n\n"
        "Reads are public with a per-report share key. Writes need "
        "`Authorization: Bearer $LUMNIA_ADMIN_TOKEN`."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("LUMNIA_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reports.router, prefix="/v1")
app.include_router(ingest.router, prefix="/v1")
app.include_router(ask.router, prefix="/v1")


@app.get("/v1/health", tags=["meta"])
def health():
    return {
        "ok": True,
        "version": VERSION,
        "block_types": list(BLOCK_TYPES),
        "orgs": len(store.list_orgs()),
        "reports": len(store.list_reports()),
        "publishing_enabled": bool(os.getenv("LUMNIA_ADMIN_TOKEN")),
        # presence only, never the value: is the Claude narration polish on?
        "narration": "claude" if os.getenv("ANTHROPIC_API_KEY") else "templates",
    }


# One service, one URL: when the image carries the built web client, serve
# it at the root — same origin as /v1, so the browser needs no CORS at all.
# Without it (local dev, tests), the root stays a signpost. A mount at "/"
# matches everything after it, so it must be the LAST route registered.
STATIC = Path(os.getenv("LUMNIA_STATIC", "/nonexistent"))
if STATIC.is_dir():
    app.mount("/", StaticFiles(directory=STATIC, html=True), name="web")
else:

    @app.get("/", include_in_schema=False)
    def root():
        """The API has no pages here — point a stray visitor somewhere useful."""
        return {
            "service": "lumnia-api",
            "version": VERSION,
            "health": "/v1/health",
            "docs": "/docs",
        }
