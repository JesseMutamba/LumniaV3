from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import store
from .bootstrap import bootstrap
from .routers import ingest, reports
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


@app.get("/v1/health", tags=["meta"])
def health():
    return {
        "ok": True,
        "version": VERSION,
        "block_types": list(BLOCK_TYPES),
        "orgs": len(store.list_orgs()),
        "reports": len(store.list_reports()),
        "publishing_enabled": bool(os.getenv("LUMNIA_ADMIN_TOKEN")),
    }
