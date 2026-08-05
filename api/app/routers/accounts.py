"""Client sign-in, and the author endpoints that issue the logins.

The shape is deliberately small. A client signs in with a username and a
password you gave them, gets a bearer token that lasts a working day, and
uses it to list and read their own org's reports. Nothing here can reach
another org's data: every read re-derives the org from the account rather
than trusting anything the caller sends.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from .. import store
from ..auth import (
    MIN_PASSWORD,
    hash_password,
    login_rate_limit,
    new_session,
    rate_limit,
    read_session,
    require_author,
    verify_password,
)
from ..schema import ClientUser, LoginIn, Org, PasswordIn, PortalReport, Session, UserIn

router = APIRouter()
author = Depends(require_author)


# --------------------------------------------------------------------------
# the signed-in client
# --------------------------------------------------------------------------

def current_user(authorization: str = Header(default="")) -> ClientUser:
    """Resolve the bearer token to a live account.

    The account is re-read on every request, so disabling a login takes
    effect on the client's next click rather than whenever their token
    happens to expire.
    """
    username = read_session(authorization.removeprefix("Bearer ").strip())
    user = store.get_user(username) if username else None
    if not user or user.disabled:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


client = Depends(current_user)


@router.post(
    "/auth/login",
    response_model=Session,
    tags=["auth"],
    dependencies=[Depends(login_rate_limit)],
)
def login(body: LoginIn):
    """Sign in.

    One failure message for every failure — wrong password, unknown name,
    disabled account. Telling an attacker which usernames exist hands them
    half the problem, and telling a real user 'no such account' when they
    have simply mistyped helps nobody.

    The password is verified even when the account does not exist, against a
    throwaway hash, so the response time does not answer the question the
    error message refuses to.
    """
    secret = store.get_user_secret(body.username)
    user = store.get_user(body.username)
    if secret is None:
        # Same work, no account: keeps the timing flat.
        hash_password(body.password, "00" * 16)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password.")
    pw_hash, pw_salt = secret
    ok = verify_password(body.password, pw_hash, pw_salt)
    if not ok or user is None or user.disabled:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password.")
    org = store.get_org(user.org)
    if org is None:
        # The client was deleted out from under the login. Not the reader's
        # problem to debug, but it is not "wrong password" either.
        raise HTTPException(status.HTTP_409_CONFLICT, "This account has no client attached.")
    store.touch_user(user.username)
    token, exp = new_session(user.username)
    return Session(token=token, expires_at=exp, user=user, org=org)


@router.get("/auth/me", response_model=Session, tags=["auth"])
def whoami(user: ClientUser = client, authorization: str = Header(default="")):
    """Who the current token belongs to. Lets the client app decide on load
    whether to show the reports or the sign-in form, without guessing from
    an expiry it stored itself."""
    org = store.get_org(user.org)
    if org is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This account has no client attached.")
    # The same token back, not a fresh one: an idle tab should not be able to
    # extend its own session by asking who it is. The dependency has already
    # verified the signature and the expiry, so this only reads them.
    token = authorization.removeprefix("Bearer ").strip()
    exp = int(token.rsplit(":", 2)[1])
    return Session(token=token, expires_at=exp, user=user, org=org)


@router.get(
    "/me/reports",
    response_model=list[PortalReport],
    tags=["auth"],
    dependencies=[Depends(rate_limit)],
)
def my_reports(user: ClientUser = client):
    """Published reports belonging to the signed-in client's org.

    Each entry carries its share key, exactly as the portal does, so the
    client can open a report and forward that one link onward if they want
    to. Drafts and retracted reports stay the author's business.
    """
    out: list[PortalReport] = []
    for stub in store.list_reports(user.org):
        if stub.status != "published":
            continue
        rep = store.get_report(stub.id)
        if rep and rep.share_key:
            out.append(PortalReport(**stub.model_dump(), share_key=rep.share_key))
    return out


# --------------------------------------------------------------------------
# author: issuing and withdrawing logins
# --------------------------------------------------------------------------

@router.post(
    "/studio/orgs/{org_id}/users",
    response_model=ClientUser,
    status_code=201,
    tags=["studio"],
    dependencies=[author],
)
def create_user(org_id: str, body: UserIn):
    """Issue a login for a client. You hand the password over once; it is
    hashed here and is not recoverable afterwards, only replaceable."""
    if not store.get_org(org_id):
        raise HTTPException(404, f"Unknown org: {org_id}")
    existing = store.get_user(body.username)
    if existing:
        # Silently re-pointing an existing login at a different client would
        # hand one client's reports to another's reader.
        raise HTTPException(409, f"The username {body.username} is already taken.")
    pw_hash, salt = hash_password(body.password)
    return store.put_user(body.username, org_id, pw_hash, salt)


@router.get(
    "/studio/orgs/{org_id}/users",
    response_model=list[ClientUser],
    tags=["studio"],
    dependencies=[author],
)
def list_org_users(org_id: str):
    return store.list_users(org_id)


@router.put(
    "/studio/users/{username}/password",
    response_model=ClientUser,
    tags=["studio"],
    dependencies=[author],
)
def set_password(username: str, body: PasswordIn):
    """Set a new password. This is the whole of 'forgot password': there is
    no email channel, so the person who issued the login re-issues it."""
    user = store.get_user(username)
    if not user:
        raise HTTPException(404, f"Unknown user: {username}")
    pw_hash, salt = hash_password(body.password)
    return store.put_user(username, user.org, pw_hash, salt)


@router.post(
    "/studio/users/{username}/disable",
    response_model=ClientUser,
    tags=["studio"],
    dependencies=[author],
)
def disable_user(username: str, disabled: bool = True):
    """Switch a login off without destroying it, so the audit trail of who
    read what still has a name attached."""
    if not store.set_user_disabled(username, disabled):
        raise HTTPException(404, f"Unknown user: {username}")
    user = store.get_user(username)
    assert user is not None
    return user


@router.delete(
    "/studio/users/{username}",
    status_code=204,
    tags=["studio"],
    dependencies=[author],
)
def remove_user(username: str):
    if not store.delete_user(username):
        raise HTTPException(404, f"Unknown user: {username}")


# Re-exported so the reports router can let a signed-in client open their own
# reports without a key, without importing the whole module graph.
__all__ = ["router", "current_user", "MIN_PASSWORD", "Org"]
