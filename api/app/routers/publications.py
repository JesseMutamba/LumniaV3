"""Account-private published snapshots of saved financial reviews.

Publishing adds a report to its verified owner's Reports tab. It does not
create a public link, change organization visibility, or mutate the legacy
portal's public.reports table. Snapshot content is immutable; trash/restore
and permanent deletion require the publication version the user opened.
"""
from __future__ import annotations

import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import Field, StrictInt, ValidationError

from .. import store
from .financial import (
    FinancialDocument, Model, OrgQuery, document_data, financial_owner,
    require_org, validate_document_context,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS review_publications (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    org TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    status TEXT NOT NULL CHECK (status IN ('published', 'trashed')),
    source_review_id TEXT NOT NULL,
    source_version INTEGER NOT NULL CHECK (source_version >= 1),
    published_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    trashed_at TEXT,
    doc TEXT NOT NULL,
    UNIQUE (owner, org, source_review_id, source_version),
    CHECK ((status = 'published' AND trashed_at IS NULL)
        OR (status = 'trashed' AND trashed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS review_publications_owner_org_status
ON review_publications(owner, org, status, updated_at);
"""


@asynccontextmanager
async def lifespan(_app):
    with store.connect() as con:
        con.executescript(SCHEMA)
    yield


router = APIRouter(prefix="/review-publications", tags=["published reviews"], lifespan=lifespan)


class VersionRequest(Model):
    expected_version: StrictInt = Field(ge=1)


class PublishRequest(VersionRequest):
    review_id: str = Field(min_length=1, max_length=100)


def metadata(row) -> dict:
    return {"id": row["id"], "org": row["org"], "kind": "financial",
            "title": row["title"], "version": row["version"], "status": row["status"],
            "source_review_id": row["source_review_id"], "source_version": row["source_version"],
            "published_at": row["published_at"], "updated_at": row["updated_at"],
            "trashed_at": row["trashed_at"]}


def result(row) -> dict:
    return {**json.loads(row["doc"]), **metadata(row)}


def locked_query(con, sql: str, parameters):
    """Serialize snapshot selection with edits and lifecycle transitions.

    SQLite reserves its writer before the read; PostgreSQL locks the selected
    row. Publication creation locks the saved review too, so it cannot report
    success against a revision concurrently replaced before this transaction.
    """
    if os.getenv("DATABASE_URL"):
        sql += " FOR UPDATE"
    else:
        con.execute("BEGIN IMMEDIATE")
    return con.execute(sql, parameters).fetchone()


def checked_document(row, context) -> FinancialDocument:
    try:
        document = FinancialDocument.model_validate_json(row["doc"])
    except ValidationError as exc:
        raise HTTPException(409, "This saved review needs to be reopened and saved before publishing.") from exc
    validate_document_context(document, context)
    return document


def require_publication(row, version: int | None = None, state: str | None = None) -> None:
    if row is None:
        raise HTTPException(404, "Published review not found for this account")
    if version is not None and row["version"] != version:
        raise HTTPException(409, "This report changed in another session. Refresh Reports before continuing.")
    if state is not None and row["status"] != state:
        detail = "Move this report to Trash before deleting it." if state == "trashed" else "This report is already in Trash."
        raise HTTPException(409, detail)


@router.get("")
def list_publications(org: OrgQuery, response: Response,
                      status: Literal["published", "trashed"] = "published",
                      owner: str = Depends(financial_owner)):
    require_org(org)
    response.headers["Cache-Control"] = "no-store"
    with store.connect() as con:
        rows = con.execute("""SELECT id,org,title,version,status,source_review_id,source_version,
            published_at,updated_at,trashed_at FROM review_publications
            WHERE owner=? AND org=? AND status=? ORDER BY updated_at DESC,id""", (owner, org, status)).fetchall()
    return [metadata(row) for row in rows]


@router.get("/{publication_id}")
def get_publication(publication_id: str, org: OrgQuery, response: Response,
                    owner: str = Depends(financial_owner)):
    require_org(org)
    response.headers["Cache-Control"] = "no-store"
    with store.connect() as con:
        row = con.execute("SELECT * FROM review_publications WHERE id=? AND owner=? AND org=?",
                          (publication_id, owner, org)).fetchone()
    require_publication(row)
    return result(row)


@router.post("", status_code=201)
def publish_review(body: PublishRequest, org: OrgQuery, response: Response,
                   owner: str = Depends(financial_owner)):
    require_org(org)
    response.headers["Cache-Control"] = "no-store"
    # Load policy before taking a database connection/row lock. Nested pool
    # checkouts could otherwise starve every concurrent publication request.
    context = store.get_context(org)
    with store.connect() as con:
        saved = locked_query(con, "SELECT * FROM financial_reviews WHERE id=? AND owner=? AND org=?",
                             (body.review_id, owner, org))
        if saved is None:
            raise HTTPException(404, "Saved financial review not found for this account")
        if saved["version"] != body.expected_version:
            raise HTTPException(409, "This financial review changed. Reopen or save the current version before publishing.")
        document = checked_document(saved, context)
        existing = con.execute("""SELECT * FROM review_publications
            WHERE owner=? AND org=? AND source_review_id=? AND source_version=?""",
            (owner, org, body.review_id, body.expected_version)).fetchone()
        if existing is not None:
            if existing["status"] == "trashed":
                raise HTTPException(409, "This version is in Trash. Restore it from Reports, or save a new review version.")
            response.status_code = 200
            return result(existing)
        now = datetime.now(timezone.utc).isoformat()
        snapshot = {"id": uuid.uuid4().hex, "owner": owner, "org": org, "title": document.title,
                    "version": 1, "status": "published", "source_review_id": body.review_id,
                    "source_version": body.expected_version, "published_at": now, "updated_at": now,
                    "trashed_at": None, "doc": json.dumps(document_data(document), allow_nan=False)}
        con.execute("""INSERT INTO review_publications
            (id,owner,org,title,version,status,source_review_id,source_version,published_at,updated_at,trashed_at,doc)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", tuple(snapshot.values()))
    return result(snapshot)


def change_status(publication_id: str, org: str, owner: str, version: int, status: str) -> dict:
    require_org(org)
    context = store.get_context(org) if status == "published" else None
    with store.connect() as con:
        row = locked_query(con, "SELECT * FROM review_publications WHERE id=? AND owner=? AND org=?",
                           (publication_id, owner, org))
        require_publication(row, version, "published" if status == "trashed" else "trashed")
        if status == "published":
            checked_document(row, context)
        now = datetime.now(timezone.utc).isoformat()
        trashed_at = now if status == "trashed" else None
        changed = con.execute("""UPDATE review_publications SET status=?,version=version+1,updated_at=?,trashed_at=?
            WHERE id=? AND owner=? AND org=? AND version=?""",
            (status, now, trashed_at, publication_id, owner, org, version))
        if changed.rowcount != 1:
            raise HTTPException(409, "This report changed in another session. Refresh Reports before continuing.")
        updated = {**dict(row), "status": status, "version": version + 1, "updated_at": now, "trashed_at": trashed_at}
    return result(updated)


@router.post("/{publication_id}/trash")
def trash_publication(publication_id: str, body: VersionRequest, org: OrgQuery,
                      owner: str = Depends(financial_owner)):
    return change_status(publication_id, org, owner, body.expected_version, "trashed")


@router.post("/{publication_id}/restore")
def restore_publication(publication_id: str, body: VersionRequest, org: OrgQuery,
                        owner: str = Depends(financial_owner)):
    return change_status(publication_id, org, owner, body.expected_version, "published")


@router.delete("/{publication_id}", status_code=204)
def delete_publication(publication_id: str, org: OrgQuery,
                       expected_version: Annotated[int, Query(ge=1)],
                       owner: str = Depends(financial_owner)):
    require_org(org)
    with store.connect() as con:
        row = locked_query(con, "SELECT * FROM review_publications WHERE id=? AND owner=? AND org=?",
                           (publication_id, owner, org))
        require_publication(row, expected_version, "trashed")
        deleted = con.execute("DELETE FROM review_publications WHERE id=? AND owner=? AND org=? AND version=? AND status='trashed'",
                              (publication_id, owner, org, expected_version))
        if deleted.rowcount != 1:
            raise HTTPException(409, "This report changed in another session. Refresh Reports before deleting.")
    return Response(status_code=204)
