"""Authentication. Deliberately minimal.

Two roles and no user table:

  author  — you. Holds LUMNIA_ADMIN_TOKEN, can create orgs and publish reports.
  reader  — the stakeholder. Holds a per-report share key in a URL. Read only.

There is no login, no session, no password reset. A real identity system is a
paying-customers problem; a shared secret in an env var and an unguessable key
per report is the correct amount of security for a platform with one author
and a handful of named readers, and it is small enough to audit in a minute.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request, status

TOKEN_ENV = "LUMNIA_ADMIN_TOKEN"


def new_share_key() -> str:
    """32 hex chars. Unguessable, and safe to put in a URL or a WhatsApp message."""
    return secrets.token_hex(16)


def admin_token() -> str:
    tok = os.getenv(TOKEN_ENV, "")
    if not tok:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"{TOKEN_ENV} is not set. Publishing is disabled until it is.",
        )
    return tok


def require_author(authorization: str = Header(default="")) -> None:
    """Bearer token on every write path."""
    expected = admin_token()
    supplied = authorization.removeprefix("Bearer ").strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Author token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def check_share_key(supplied: str | None, actual: str | None) -> bool:
    if not supplied or not actual:
        return False
    return hmac.compare_digest(supplied, actual)


# --------------------------------------------------------------------------
# read-path assurance: a coarse reader fingerprint for the audit log, and a
# per-IP rate limit so a script guessing keys makes noise and then stops.
# --------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def fingerprint(request: Request) -> str:
    """Hashed IP + user agent, truncated. Enough to say 'three distinct
    readers opened this' — deliberately not enough to say who they are."""
    ua = request.headers.get("user-agent", "")
    return hashlib.sha256(f"{_client_ip(request)}|{ua}".encode()).hexdigest()[:12]


_WINDOW_S = 60.0
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request) -> None:
    """Sliding window per IP on the public read paths. Share keys are
    unguessable by size; this makes sure they are unguessable by patience
    too. LUMNIA_RATE_LIMIT reads per minute, default 120."""
    limit = int(os.getenv("LUMNIA_RATE_LIMIT", "120"))
    now = time.monotonic()
    q = _hits[_client_ip(request)]
    while q and now - q[0] > _WINDOW_S:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many requests. Try again in a minute.",
        )
    q.append(now)
