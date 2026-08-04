"""Storage. SQLite, one table, reports stored as JSON.

Boring on purpose. A report is a document, we query it by id and by org, and
we do not join on it. When that stops being true, move to Postgres and keep
the same interface — that is a paying-customers problem, not a today problem.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from .schema import Context, ContextIn, ContextVersion, Org, Report, ReportStub, Text

# LUMNIA_DB lets a container point this at a mounted volume so reports
# survive a redeploy. Local development falls back to a file in api/.
DB_PATH = Path(os.getenv("LUMNIA_DB") or Path(__file__).resolve().parent.parent / "lumnia.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS orgs (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  sub       TEXT NOT NULL,     -- json Text
  share_key TEXT               -- portal key; grants read of this org's published reports
);
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  org          TEXT NOT NULL REFERENCES orgs(id),
  status       TEXT NOT NULL,
  generated_at TEXT,
  doc          TEXT NOT NULL   -- json Report
);
CREATE INDEX IF NOT EXISTS reports_org ON reports(org);
CREATE TABLE IF NOT EXISTS contexts (
  org        TEXT NOT NULL REFERENCES orgs(id),
  version    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  doc        TEXT NOT NULL,    -- json ContextIn
  PRIMARY KEY (org, version)
);
CREATE TABLE IF NOT EXISTS ingestions (
  org      TEXT NOT NULL,
  filename TEXT NOT NULL,
  seq      INTEGER NOT NULL,   -- per (org, filename); the recurrence counter
  ts       TEXT NOT NULL,
  sha256   TEXT,
  summary  TEXT NOT NULL,      -- json snapshot of detected tables
  PRIMARY KEY (org, filename, seq)
);
CREATE TABLE IF NOT EXISTS reads (
  ts     TEXT NOT NULL,
  kind   TEXT NOT NULL,        -- 'report' | 'portal'
  target TEXT NOT NULL,        -- report id or org id
  ok     INTEGER NOT NULL,     -- 1 = key accepted, 0 = refused
  client TEXT                  -- coarse fingerprint, not an identity
);
CREATE INDEX IF NOT EXISTS reads_target ON reads(kind, target, ts);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init() -> None:
    with connect() as con:
        con.executescript(SCHEMA)
        # Databases created before the portal existed lack the column.
        try:
            con.execute("ALTER TABLE orgs ADD COLUMN share_key TEXT")
        except sqlite3.OperationalError:
            pass  # already present


# --------------------------------------------------------------------------
# orgs
# --------------------------------------------------------------------------

def put_org(org_id: str, name: str, sub: Text) -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO orgs (id,name,sub) VALUES (?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, sub=excluded.sub",
            (org_id, name, sub.model_dump_json()),
        )


def list_orgs() -> list[Org]:
    with connect() as con:
        rows = con.execute(
            "SELECT o.id, o.name, o.sub, "
            "  (SELECT COUNT(*) FROM reports r WHERE r.org = o.id) AS n "
            "FROM orgs o ORDER BY o.name"
        ).fetchall()
    return [
        Org(
            id=r["id"],
            name=r["name"],
            sub=Text(**json.loads(r["sub"])),
            report_count=r["n"],
        )
        for r in rows
    ]


def get_org(org_id: str) -> Org | None:
    return next((o for o in list_orgs() if o.id == org_id), None)


def get_org_key(org_id: str) -> str | None:
    """The portal key lives beside the org but outside the public Org model,
    so no public endpoint can leak it by accident."""
    with connect() as con:
        row = con.execute("SELECT share_key FROM orgs WHERE id = ?", (org_id,)).fetchone()
    return row["share_key"] if row else None


def set_org_key(org_id: str, key: str) -> None:
    with connect() as con:
        con.execute("UPDATE orgs SET share_key = ? WHERE id = ?", (key, org_id))


# --------------------------------------------------------------------------
# contexts — append-only. A definition change is a new version, never an
# overwrite, so what the parser knew last month stays answerable.
# --------------------------------------------------------------------------

def put_context(org_id: str, doc: ContextIn) -> Context:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    with connect() as con:
        row = con.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM contexts WHERE org = ?",
            (org_id,),
        ).fetchone()
        version = row["v"] + 1
        con.execute(
            "INSERT INTO contexts (org, version, created_at, doc) VALUES (?,?,?,?)",
            (org_id, version, now.isoformat(), doc.model_dump_json()),
        )
    return Context(**doc.model_dump(), version=version, updated_at=now)


def get_context(org_id: str) -> Context | None:
    with connect() as con:
        row = con.execute(
            "SELECT version, created_at, doc FROM contexts "
            "WHERE org = ? ORDER BY version DESC LIMIT 1",
            (org_id,),
        ).fetchone()
    if not row:
        return None
    return Context(
        **json.loads(row["doc"]), version=row["version"], updated_at=row["created_at"]
    )


# --------------------------------------------------------------------------
# ingestions — the recurrence memory. Each ingest of (org, filename) appends
# a snapshot, so the next ingest of the same file can answer "what moved".
# --------------------------------------------------------------------------

def put_ingestion(org_id: str, filename: str, sha256: str | None, summary: dict) -> int:
    from datetime import datetime, timezone

    with connect() as con:
        row = con.execute(
            "SELECT COALESCE(MAX(seq), 0) AS s FROM ingestions "
            "WHERE org = ? AND filename = ?",
            (org_id, filename),
        ).fetchone()
        seq = row["s"] + 1
        con.execute(
            "INSERT INTO ingestions (org, filename, seq, ts, sha256, summary) "
            "VALUES (?,?,?,?,?,?)",
            (org_id, filename, seq, datetime.now(timezone.utc).isoformat(),
             sha256, json.dumps(summary)),
        )
    return seq


def last_ingestion(org_id: str, filename: str) -> dict | None:
    with connect() as con:
        row = con.execute(
            "SELECT seq, ts, summary FROM ingestions "
            "WHERE org = ? AND filename = ? ORDER BY seq DESC LIMIT 1",
            (org_id, filename),
        ).fetchone()
    if not row:
        return None
    return {"seq": row["seq"], "ts": row["ts"], "summary": json.loads(row["summary"])}


def list_ingestions(org_id: str) -> list[dict]:
    with connect() as con:
        rows = con.execute(
            "SELECT filename, seq, ts, sha256 FROM ingestions "
            "WHERE org = ? ORDER BY ts DESC",
            (org_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------
# reads — the audit trail. Every public read attempt lands here, accepted or
# refused, so "who opened this and when" has an answer and a burst of
# refused keys is visible instead of silent.
# --------------------------------------------------------------------------

def log_read(kind: str, target: str, ok: bool, client: str | None) -> None:
    from datetime import datetime, timezone

    with connect() as con:
        con.execute(
            "INSERT INTO reads (ts, kind, target, ok, client) VALUES (?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), kind, target, int(ok), client),
        )


def read_stats(kind: str, target: str) -> dict:
    with connect() as con:
        row = con.execute(
            "SELECT "
            "  SUM(ok) AS reads, "
            "  COUNT(DISTINCT CASE WHEN ok = 1 THEN client END) AS readers, "
            "  MAX(CASE WHEN ok = 1 THEN ts END) AS last_read, "
            "  SUM(1 - ok) AS refused "
            "FROM reads WHERE kind = ? AND target = ?",
            (kind, target),
        ).fetchone()
    return {
        "reads": row["reads"] or 0,
        "readers": row["readers"] or 0,
        "last_read": row["last_read"],
        "refused": row["refused"] or 0,
    }


def list_context_versions(org_id: str) -> list[ContextVersion]:
    with connect() as con:
        rows = con.execute(
            "SELECT version, created_at FROM contexts WHERE org = ? ORDER BY version DESC",
            (org_id,),
        ).fetchall()
    return [ContextVersion(version=r["version"], updated_at=r["created_at"]) for r in rows]


# --------------------------------------------------------------------------
# reports
# --------------------------------------------------------------------------

def put_report(rep: Report) -> Report:
    with connect() as con:
        con.execute(
            "INSERT INTO reports (id,org,status,generated_at,doc) VALUES (?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET status=excluded.status, "
            "  generated_at=excluded.generated_at, doc=excluded.doc",
            (
                rep.id,
                rep.org,
                rep.status,
                rep.generated_at.isoformat() if rep.generated_at else None,
                rep.model_dump_json(),
            ),
        )
    return rep


def get_report(report_id: str) -> Report | None:
    with connect() as con:
        row = con.execute(
            "SELECT doc FROM reports WHERE id = ?", (report_id,)
        ).fetchone()
    return Report(**json.loads(row["doc"])) if row else None


def list_reports(org_id: str | None = None) -> list[ReportStub]:
    q = "SELECT doc FROM reports"
    args: tuple = ()
    if org_id:
        q += " WHERE org = ?"
        args = (org_id,)
    q += " ORDER BY generated_at DESC"
    with connect() as con:
        rows = con.execute(q, args).fetchall()
    out = []
    for r in rows:
        d = json.loads(r["doc"])
        out.append(ReportStub(**{k: d[k] for k in ReportStub.model_fields if k in d}))
    return out


def delete_report(report_id: str) -> bool:
    """Reports are retracted, not deleted — but the scaffold needs a reset."""
    with connect() as con:
        cur = con.execute("DELETE FROM reports WHERE id = ?", (report_id,))
    return cur.rowcount > 0
