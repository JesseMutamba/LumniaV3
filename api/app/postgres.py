"""PostgreSQL connections for the existing production portal and new Studio.

The portal keeps its public tables. Studio adds its own namespace and foreign
keys to public.orgs; it never copies or reseeds production users and reports.
Only the shared Studio SQL uses the qmark adapter below. Portal queries use
psycopg directly with native placeholders and explicit public table names.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from threading import Lock

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None
_lock = Lock()


def pool() -> ConnectionPool:
    global _pool
    with _lock:
        if _pool is None:
            dsn = os.getenv("DATABASE_URL", "")
            if not dsn:
                raise RuntimeError("DATABASE_URL is required for the production portal")
            _pool = ConnectionPool(
                dsn, min_size=1, max_size=5, timeout=15,
                kwargs={"row_factory": dict_row, "connect_timeout": 10},
            )
    return _pool


def close() -> None:
    global _pool
    with _lock:
        if _pool is not None:
            _pool.close()
            _pool = None


def init_studio() -> None:
    with pool().connection() as con:
        # Concurrent starts serialize additive DDL, including CREATE SCHEMA.
        con.execute("SELECT pg_advisory_xact_lock(742613905)")
        con.execute("CREATE SCHEMA IF NOT EXISTS lumnia_studio")
        con.execute("""CREATE TABLE IF NOT EXISTS lumnia_studio.contexts (
            org TEXT NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            doc TEXT NOT NULL,
            PRIMARY KEY (org, version)
        )""")


class StudioConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters=None):
        # All statements are fixed server SQL. Values are always separately
        # bound; no client-supplied SQL, quoted question marks, or SQL literals
        # with a percent sign enter this deliberately limited adapter.
        return self.connection.execute(statement.replace("?", "%s"), parameters)

    def executescript(self, statement):
        # psycopg supports multiple DDL statements without bound parameters.
        self.connection.execute("SELECT pg_advisory_xact_lock(742613905)")
        return self.connection.execute(statement)


@contextmanager
def connect_studio():
    with pool().connection() as con:
        con.execute("SET LOCAL search_path = lumnia_studio, public")
        yield StudioConnection(con)


def lock_definitions(con: StudioConnection, owner: str, org: str, fingerprint: str):
    # This covers an absent row too; SELECT FOR UPDATE alone cannot serialize
    # two first writes. After acquiring the lock READ COMMITTED sees the winner.
    import json
    scope = json.dumps(["definitions", owner, org, fingerprint])
    con.connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (scope,))
