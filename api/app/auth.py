"""Authentication. Deliberately minimal.

Three principals:

  author  — you. Holds LUMNIA_ADMIN_TOKEN, can create orgs and publish reports.
  client  — a named account that signs in and sees its own org's reports.
  reader  — a stakeholder holding a per-report share key in a URL. Read only.

The keyed link stays because not every reader should need an account: a board
member or a lender gets a link that opens one report and nothing else. The
account exists for the client who comes back every month and should not have
to hunt through WhatsApp for last quarter's URL.

There is still no self-service signup and no password-reset email. You issue
the login, and you set a new password if it is forgotten. That is the whole
identity system, and it is small enough to audit in a minute.
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


# --------------------------------------------------------------------------
# client accounts
#
# The author still holds LUMNIA_ADMIN_TOKEN. What is new is a second, weaker
# principal: a named client who signs in and sees their own org's reports.
#
# No email is involved anywhere. You create the login and hand the password
# over once; if it is forgotten you set a new one. That is a deliberate
# trade: a plantation in Mwebe should not need a working inbox and a
# deliverable SMTP route to read its own numbers.
# --------------------------------------------------------------------------

_PBKDF2_ROUNDS = 600_000  # OWASP's floor for PBKDF2-HMAC-SHA256
MIN_PASSWORD = 10


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """Returns (hash, salt), both hex. Stdlib only — a dependency that signs
    passwords is a dependency that can go unmaintained."""
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS)
    return dk.hex(), salt


def verify_password(password: str, expected_hash: str, salt: str) -> bool:
    try:
        got, _ = hash_password(password, salt)
    except ValueError:
        return False  # malformed salt on a stored row; treat as no match
    return hmac.compare_digest(got, expected_hash)


def _session_secret() -> str:
    """Sessions are signed with their own secret where one is configured, so
    rotating the admin token does not have to sign every client out — but it
    falls back to the admin token so the feature needs no new configuration
    to work at all."""
    return os.getenv("LUMNIA_SESSION_SECRET") or admin_token()


SESSION_HOURS = 12


def new_session(username: str, hours: int = SESSION_HOURS) -> tuple[str, int]:
    """A signed bearer token: username, expiry, and an HMAC over both.

    Deliberately not a random token in a sessions table. Nothing here needs
    server-side revocation of a single session — disabling the account stops
    the next request, because every request re-reads the account.
    """
    exp = int(time.time()) + hours * 3600
    body = f"{username}:{exp}"
    sig = hmac.new(_session_secret().encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}:{sig}", exp


def read_session(token: str | None) -> str | None:
    """Returns the username a token vouches for, or None. Never raises on
    malformed input: a bad token is an anonymous request, not a crash."""
    if not token:
        return None
    parts = token.rsplit(":", 2)
    if len(parts) != 3:
        return None
    username, exp, sig = parts
    body = f"{username}:{exp}"
    want = hmac.new(_session_secret().encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, want):
        return None
    try:
        if int(exp) < time.time():
            return None
    except ValueError:
        return None
    return username


# Login is the one path where guessing pays, so it gets a tighter budget than
# the read paths: slow enough that a password list is useless, loose enough
# that a person who mistypes twice is not locked out of their own numbers.
_LOGIN_WINDOW_S = 300.0
_login_hits: dict[str, deque] = defaultdict(deque)


def login_rate_limit(request: Request) -> None:
    limit = int(os.getenv("LUMNIA_LOGIN_LIMIT", "10"))
    now = time.monotonic()
    q = _login_hits[_client_ip(request)]
    while q and now - q[0] > _LOGIN_WINDOW_S:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many sign-in attempts. Try again in a few minutes.",
        )
    q.append(now)
