"""Queries for the existing PostgreSQL client portal.

The production tables and account hashes predate Studio. Startup validates
their presence; it never seeds, rewrites, or replaces them. Studio creates its
own additive tables through its router lifespan.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

from .postgres import pool


def init() -> None:
    """Fail closed if the expected live portal schema is unavailable."""
    queries = (
        "SELECT id, name, sub FROM public.orgs LIMIT 0",
        "SELECT id, org_id, title, period, generated_at, status, share_key, doc FROM public.reports LIMIT 0",
        "SELECT id, org_id, username, pw_hash, disabled FROM public.users LIMIT 0",
        "SELECT token, user_id, expires_at FROM public.sessions LIMIT 0",
        "SELECT id, created_at, name, company, role, email, country, sector, note, source_ip FROM public.pilot_requests LIMIT 0",
    )
    with pool().connection() as conn:
        for query in queries:
            conn.execute(query)


def healthy() -> bool:
    with pool().connection() as conn:
        return conn.execute("SELECT 1 AS ok").fetchone()["ok"] == 1


def find_user(username: str) -> dict | None:
    with pool().connection() as conn:
        return conn.execute(
            """SELECT u.id, u.username, u.pw_hash, u.disabled, o.id AS org_id,
                      o.name AS org_name, o.sub AS org_sub
               FROM public.users u JOIN public.orgs o ON o.id = u.org_id
               WHERE u.username = %s""",
            (username,),
        ).fetchone()


def open_session(user_id: int) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=int(os.getenv("LUMNIA_SESSION_DAYS", "14")))
    with pool().connection() as conn:
        conn.execute("DELETE FROM public.sessions WHERE expires_at < now()")
        conn.execute(
            "INSERT INTO public.sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
            (token, user_id, expires),
        )
    return token, expires


def close_session(token: str) -> None:
    if token:
        with pool().connection() as conn:
            conn.execute("DELETE FROM public.sessions WHERE token = %s", (token,))


def session_user(token: str) -> dict | None:
    if not token:
        return None
    with pool().connection() as conn:
        return conn.execute(
            """SELECT u.id, u.username, u.disabled, o.id AS org_id,
                      o.name AS org_name, o.sub AS org_sub
               FROM public.sessions s JOIN public.users u ON u.id = s.user_id
                                      JOIN public.orgs o ON o.id = u.org_id
               WHERE s.token = %s AND s.expires_at > now()""",
            (token,),
        ).fetchone()


def org_reports(org_id: str) -> list[dict]:
    with pool().connection() as conn:
        return conn.execute(
            """SELECT id, title, period, generated_at, share_key
               FROM public.reports WHERE org_id = %s AND status = 'published'
               ORDER BY generated_at DESC""",
            (org_id,),
        ).fetchall()


def report_row(report_id: str) -> dict | None:
    with pool().connection() as conn:
        return conn.execute(
            "SELECT id, org_id, status, share_key, doc FROM public.reports WHERE id = %s",
            (report_id,),
        ).fetchone()


def org_row(org_id: str) -> dict | None:
    with pool().connection() as conn:
        return conn.execute("SELECT id, name, sub FROM public.orgs WHERE id = %s", (org_id,)).fetchone()


def add_pilot_request(fields: dict, source_ip: str | None) -> int:
    with pool().connection() as conn:
        row = conn.execute(
            """INSERT INTO public.pilot_requests
                 (name, company, role, email, country, sector, note, source_ip)
               VALUES (%(name)s, %(company)s, %(role)s, %(email)s, %(country)s,
                       %(sector)s, %(note)s, %(ip)s)
               RETURNING id""",
            {**fields, "ip": source_ip},
        ).fetchone()
        return row["id"]


def recent_pilot_requests(limit: int = 100) -> list[dict]:
    with pool().connection() as conn:
        return conn.execute(
            """SELECT id, created_at, name, company, role, email, country, sector, note
               FROM public.pilot_requests ORDER BY created_at DESC LIMIT %s""",
            (limit,),
        ).fetchall()
