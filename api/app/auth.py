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

import hmac
import os
import secrets

from fastapi import Header, HTTPException, status

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
