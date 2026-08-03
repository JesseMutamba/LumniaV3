"""Startup. Creates nothing you did not ask for.

The platform boots empty. Clients are created by an author, either in Studio
or with one POST. LUMNIA_BOOTSTRAP_ORGS exists so a fresh deploy can come up
with your client list already in place:

    LUMNIA_BOOTSTRAP_ORGS='pvak:PVAK:Mwebe & Kwenge, RDC'

Semicolon-separated, each entry id:name:subtitle. Idempotent — running it
again updates names rather than duplicating rows.
"""
from __future__ import annotations

import os

from . import store
from .schema import Text


def bootstrap() -> None:
    store.init()
    spec = os.getenv("LUMNIA_BOOTSTRAP_ORGS", "").strip()
    if not spec:
        return
    for entry in spec.split(";"):
        parts = [p.strip() for p in entry.split(":", 2)]
        if len(parts) < 2 or not parts[0]:
            continue
        oid, name = parts[0], parts[1]
        sub = parts[2] if len(parts) > 2 else ""
        store.put_org(oid, name, Text(fr=sub, en=sub))
