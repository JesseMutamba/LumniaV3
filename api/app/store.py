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

from .schema import Org, Report, ReportStub, Text

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
