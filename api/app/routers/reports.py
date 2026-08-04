from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import ValidationError

from .. import store
from ..auth import check_share_key, new_share_key, require_author
from ..pipeline.checks import check_provenance
from ..schema import Org, OrgIn, Portal, PortalReport, Report, ReportStub, StudioOrg

router = APIRouter()
author = Depends(require_author)


# --------------------------------------------------------------------------
# orgs
# --------------------------------------------------------------------------

@router.get("/orgs", response_model=list[Org], tags=["orgs"])
def get_orgs():
    return store.list_orgs()


@router.post(
    "/orgs",
    response_model=Org,
    status_code=status.HTTP_201_CREATED,
    tags=["orgs"],
    dependencies=[author],
)
def create_org(body: OrgIn):
    if store.get_org(body.id):
        raise HTTPException(409, f"Org already exists: {body.id}")
    store.put_org(body.id, body.name, body.sub)
    store.set_org_key(body.id, new_share_key())
    return store.get_org(body.id)


@router.get("/orgs/{org_id}/reports", response_model=list[ReportStub], tags=["orgs"])
def get_org_reports(org_id: str):
    if not store.get_org(org_id):
        raise HTTPException(404, f"Unknown org: {org_id}")
    return store.list_reports(org_id)


# --------------------------------------------------------------------------
# portal — one link per client, every published report behind it
# --------------------------------------------------------------------------

@router.get("/portal/{org_id}", response_model=Portal, tags=["portal"])
def get_portal(org_id: str, k: str | None = Query(default=None)):
    """Public read with the client's portal key. Lists published reports only
    — drafts and retracted reports are the author's business. Each entry
    carries its own share key so the reader can open it; that is the grant
    the portal key stands for."""
    org = store.get_org(org_id)
    actual = store.get_org_key(org_id) if org else None
    if not org or not check_share_key(k, actual):
        raise HTTPException(404, "Unknown client or bad key.")
    reports: list[PortalReport] = []
    for stub in store.list_reports(org_id):
        if stub.status != "published":
            continue
        rep = store.get_report(stub.id)
        if rep and rep.share_key:
            reports.append(PortalReport(**stub.model_dump(), share_key=rep.share_key))
    return Portal(org=org, reports=reports)


# --------------------------------------------------------------------------
# reading
# --------------------------------------------------------------------------

def _readable(rep: Report, key: str | None) -> Report:
    """A reader with the right key sees the report. Nobody else does.

    The key is stripped from the response — a stakeholder should not be able
    to forward a link they didn't mean to forward by copying it out of a
    devtools panel. They already have the URL; they don't need it twice.
    """
    if rep.status == "retracted":
        raise HTTPException(410, "This report has been retracted.")
    if not check_share_key(key, rep.share_key):
        raise HTTPException(404, "Unknown report or bad key.")
    return rep.model_copy(update={"share_key": None})


@router.get("/reports/{report_id}", response_model=Report, tags=["reports"])
def get_report(report_id: str, k: str | None = Query(default=None)):
    """Public read. Requires the share key that came with the link."""
    rep = store.get_report(report_id)
    if not rep:
        raise HTTPException(404, f"Unknown report: {report_id}")
    return _readable(rep, k)


@router.get(
    "/studio/reports/{report_id}",
    response_model=Report,
    tags=["studio"],
    dependencies=[author],
)
def get_report_as_author(report_id: str):
    """Same document, no key needed, share_key included so you can copy the link."""
    rep = store.get_report(report_id)
    if not rep:
        raise HTTPException(404, f"Unknown report: {report_id}")
    return rep


# --------------------------------------------------------------------------
# publishing
# --------------------------------------------------------------------------

def _publish(org_id: str, rep: Report) -> Report:
    if not store.get_org(org_id):
        raise HTTPException(404, f"Unknown org: {org_id}. Create it first.")
    if rep.org != org_id:
        raise HTTPException(400, f"Body org '{rep.org}' does not match path '{org_id}'")

    prov = check_provenance(rep)
    if not prov.passed:
        raise HTTPException(
            422,
            {
                "error": "CH-004 provenance failed",
                "detail": prov.detail,
                "missing": prov.data["missing"],
            },
        )

    existing = store.get_report(rep.id)
    rep.share_key = (existing.share_key if existing else None) or new_share_key()
    rep.generated_at = rep.generated_at or datetime.now(timezone.utc)
    return store.put_report(rep)


@router.post(
    "/orgs/{org_id}/reports",
    response_model=Report,
    status_code=status.HTTP_201_CREATED,
    tags=["reports"],
    dependencies=[author],
)
def create_report(org_id: str, rep: Report):
    return _publish(org_id, rep)


@router.post(
    "/studio/import",
    response_model=Report,
    status_code=status.HTTP_201_CREATED,
    tags=["studio"],
    dependencies=[author],
)
async def import_report(file: UploadFile = File(...)):
    """Upload a report document as a .json file.

    This is the whole authoring path. You produce the document however you
    like — by hand, from a notebook, from Claude Code — and drop it here.
    Validation is the same as the API route, so a malformed document is
    rejected with the field that broke rather than half-rendered.
    """
    raw = await file.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Not valid JSON: {e}")
    try:
        rep = Report(**payload)
    except ValidationError as e:
        raise HTTPException(422, {"error": "Schema validation failed", "errors": e.errors()})
    return _publish(rep.org, rep)


@router.patch(
    "/studio/reports/{report_id}/status",
    response_model=Report,
    tags=["studio"],
    dependencies=[author],
)
def set_status(report_id: str, new_status: str):
    rep = store.get_report(report_id)
    if not rep:
        raise HTTPException(404, f"Unknown report: {report_id}")
    if new_status not in ("draft", "published", "retracted"):
        raise HTTPException(400, f"Bad status: {new_status}")
    rep.status = new_status  # type: ignore[assignment]
    return store.put_report(rep)


@router.get(
    "/studio/orgs",
    response_model=list[StudioOrg],
    tags=["studio"],
    dependencies=[author],
)
def get_orgs_as_author():
    """Orgs with their portal keys. Orgs created before the portal existed
    get a key minted on first read."""
    out = []
    for o in store.list_orgs():
        key = store.get_org_key(o.id)
        if not key:
            key = new_share_key()
            store.set_org_key(o.id, key)
        out.append(StudioOrg(**o.model_dump(), share_key=key))
    return out


@router.post(
    "/studio/orgs/{org_id}/rotate-key",
    response_model=StudioOrg,
    tags=["studio"],
    dependencies=[author],
)
def rotate_org_key(org_id: str):
    """Invalidate the client's portal link. Individual report links keep
    working — rotate those separately if they need to die too."""
    org = store.get_org(org_id)
    if not org:
        raise HTTPException(404, f"Unknown org: {org_id}")
    key = new_share_key()
    store.set_org_key(org_id, key)
    return StudioOrg(**org.model_dump(), share_key=key)


@router.post(
    "/studio/reports/{report_id}/rotate-key",
    response_model=Report,
    tags=["studio"],
    dependencies=[author],
)
def rotate_key(report_id: str):
    """Invalidate every link previously sent for this report."""
    rep = store.get_report(report_id)
    if not rep:
        raise HTTPException(404, f"Unknown report: {report_id}")
    rep.share_key = new_share_key()
    return store.put_report(rep)


@router.delete(
    "/studio/reports/{report_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["studio"],
    dependencies=[author],
)
def delete_report(report_id: str):
    """Hard delete. Prefer status=retracted — a retracted report keeps its
    address and tells a reader it was withdrawn, which is the honest thing
    when a number turns out to be wrong."""
    if not store.delete_report(report_id):
        raise HTTPException(404, f"Unknown report: {report_id}")
