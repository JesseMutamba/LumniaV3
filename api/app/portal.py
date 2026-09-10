"""Existing PostgreSQL client portal with the additive analytics workspace.

This application is selected when DATABASE_URL is configured. It preserves
the deployed portal API and PostgreSQL records; the SQLite authoring server
is a separate mode and is never used as a database failure fallback.
"""
from __future__ import annotations

import hmac
import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field, field_validator

from . import portal_db as db, postgres
from .portal_security import Throttle, verify_password
from .routers import analysis_studio, financial

VERSION = "0.3.0"

for _ext, _type in (
    (".webp", "image/webp"), (".woff2", "font/woff2"), (".woff", "font/woff"),
    (".svg", "image/svg+xml"), (".js", "text/javascript"), (".css", "text/css"),
    (".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
):
    mimetypes.add_type(_type, _ext)


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=1000)


class PilotBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    company: str = Field(min_length=1, max_length=160)
    email: EmailStr
    role: str = Field(default="", max_length=120)
    country: str = Field(default="", max_length=80)
    sector: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=2000)

    @field_validator("name", "company")
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required")
        return value


def _stub(row: dict) -> dict:
    return {key: row[key] for key in ("id", "title", "period", "generated_at", "share_key")}


def _identity(row: dict) -> dict:
    return {
        "user": {"id": row["id"], "username": row["username"], "org": row["org_id"]},
        "org": {"id": row["org_id"], "name": row["org_name"], "sub": row["org_sub"]},
    }


def _token(authorization: str) -> str:
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def current_user(authorization: str = Header(default="")) -> dict:
    user = db.session_user(_token(authorization))
    if not user or user["disabled"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in again.")
    return user


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        # Validate the live schema before making any additive Studio changes.
        # A connection or schema failure stops startup; there is no reseed or
        # fallback to a different database.
        db.init()
        postgres.init_studio()
        yield
    finally:
        postgres.close()


def create_app() -> FastAPI:
    app = FastAPI(title="Lumnia", version=VERSION, docs_url=None, redoc_url=None, lifespan=lifespan)
    throttle = Throttle(limit=int(os.getenv("LUMNIA_LOGIN_LIMIT", "8")))
    pilot_throttle = Throttle(limit=int(os.getenv("LUMNIA_PILOT_LIMIT", "5")), window=3600.0)
    static = Path(os.getenv("LUMNIA_PORTAL_STATIC") or os.getenv("LUMNIA_STATIC")
                  or str(Path(__file__).resolve().parent.parent / "static"))

    @app.middleware("http")
    async def private_cache_headers(request: Request, call_next):
        response = await call_next(request)
        if request.url.path == "/v1" or request.url.path.startswith("/v1/") or request.headers.get("authorization"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Pragma"] = "no-cache"
        elif "text/html" in response.headers.get("content-type", ""):
            response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.get("/v1/health")
    @app.get("/health")
    def health() -> dict:
        try:
            if not db.healthy():
                raise RuntimeError("Database unavailable")
        except Exception as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Database unavailable.") from exc
        return {
            "ok": True, "version": VERSION, "deployment_mode": "portal",
            "revision": os.getenv("LUMNIA_BUILD_SHA") or os.getenv("RAILWAY_GIT_COMMIT_SHA") or None,
            "features": ["analysis-studio", "combined-financial-upload", "client-financial-reviews"],
            "publishing_enabled": False,
        }

    @app.post("/v1/auth/login")
    def login(body: LoginBody, request: Request) -> dict:
        client = request.client.host if request.client else "?"
        key = f"{client}:{body.username.strip().lower()}"
        if not throttle.allow(key):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts.")
        user = db.find_user(body.username.strip())
        if not user or user["disabled"] or not verify_password(body.password, user["pw_hash"]):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password.")
        throttle.clear(key)
        token, expires = db.open_session(user["id"])
        return {"token": token, "expires_at": int(expires.timestamp()), **_identity(user)}

    @app.get("/v1/auth/me")
    def identity(user: dict = Depends(current_user)) -> dict:
        return _identity(user)

    @app.post("/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
    def logout(authorization: str = Header(default="")) -> Response:
        db.close_session(_token(authorization))
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/v1/me/reports")
    def my_reports(user: dict = Depends(current_user)) -> list[dict]:
        return [_stub(row) for row in db.org_reports(user["org_id"])]

    @app.get("/v1/reports/{report_id}")
    def read_report(report_id: str, k: str | None = Query(default=None), authorization: str = Header(default="")) -> dict:
        row = db.report_row(report_id)
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No such report.")
        if row["status"] == "retracted":
            raise HTTPException(status.HTTP_410_GONE, "This report has been withdrawn.")
        if k and row["share_key"] and hmac.compare_digest(k.encode(), row["share_key"].encode()):
            return row["doc"]
        user = db.session_user(_token(authorization))
        if user and not user["disabled"] and user["org_id"] == row["org_id"]:
            return row["doc"]
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such report.")

    @app.post("/v1/pilot-requests", status_code=status.HTTP_201_CREATED)
    def request_pilot(body: PilotBody, request: Request) -> dict:
        client = request.client.host if request.client else "?"
        if not pilot_throttle.allow(client):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Try again later, or email us.")
        fields = {
            "name": body.name, "company": body.company, "email": str(body.email).strip(),
            **{key: getattr(body, key).strip() or None for key in ("role", "country", "sector", "note")},
        }
        return {"ok": True, "id": db.add_pilot_request(fields, client)}

    @app.get("/v1/portal/{org_id}")
    def portal(org_id: str, k: str | None = Query(default=None)) -> dict:
        portal_key = os.getenv(f"LUMNIA_PORTAL_KEY_{org_id.upper()}", "")
        if not portal_key or not k or not hmac.compare_digest(k.encode(), portal_key.encode()):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No such portal.")
        org = db.org_row(org_id)
        if not org:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No such portal.")
        return {"org": {key: org[key] for key in ("id", "name", "sub")},
                "reports": [_stub(row) for row in db.org_reports(org_id)]}

    # FastAPI merges included router lifespans after the application's schema
    # validation, creating only Studio's additive tables on the same database.
    app.include_router(analysis_studio.router, prefix="/v1")
    app.include_router(financial.router, prefix="/v1")

    @app.get("/signup", include_in_schema=False)
    def signup_page():
        page = static / "signup" / "index.html"
        if page.is_file():
            return FileResponse(page)
        return RedirectResponse("/#/signup", status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    @app.exception_handler(404)
    async def spa_fallback(request: Request, exc):
        path = request.url.path
        names_a_file = "." in path.rsplit("/", 1)[-1]
        is_api_or_asset = path == "/v1" or path.startswith(("/v1/", "/api/", "/assets/", "/brand/"))
        if is_api_or_asset or names_a_file or not (static / "index.html").is_file():
            return JSONResponse({"detail": getattr(exc, "detail", "Not found.")}, status_code=404)
        return FileResponse(static / "index.html")

    if static.is_dir():
        app.mount("/", StaticFiles(directory=static, html=True), name="static")
    else:
        @app.get("/", include_in_schema=False)
        def root():
            return {"service": "lumnia-portal", "version": VERSION, "health": "/v1/health"}

    return app
