import os, sys, tempfile
from pathlib import Path

os.environ["LUMNIA_ADMIN_TOKEN"] = "test-token"
os.environ["LUMNIA_BOOTSTRAP_ORGS"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# isolate the test database before anything imports store
from app import store  # noqa: E402
store.DB_PATH = Path(tempfile.gettempdir()) / "lumnia-test.db"
store.DB_PATH.unlink(missing_ok=True)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth():
    return AUTH


@pytest.fixture(scope="session")
def org(client):
    client.post(
        "/v1/orgs",
        json={"id": "acme", "name": "Acme", "sub": {"fr": "Kinshasa, RDC"}},
        headers=AUTH,
    )
    return "acme"


def xlsx(sheets: dict) -> bytes:
    """Build a workbook in memory: {sheet: [[row], ...]}."""
    import io

    from openpyxl import Workbook as XlsxWorkbook

    wb = XlsxWorkbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def doc(rid="r-1", org="acme", **kw):
    base = {
        "id": rid, "org": org,
        "title": {"fr": "Essai", "en": "Trial"},
        "period": {"label": {"fr": "T1 2026"}, "start": "2026-01-01", "end": "2026-03-31"},
        "status": "published",
        "sources": [{"idx": 0, "filename": "x.xlsx", "sheets": 1, "rows_read": 9}],
        "blocks": [{
            "type": "kpiGrid",
            "items": [{
                "label": {"fr": "Marge"},
                "value": {"n": 12.5, "unit": "pct",
                          "src": {"file": 0, "sheet": "S1", "cells": "B7"}},
            }],
        }],
    }
    base.update(kw)
    return base
