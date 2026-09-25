"""Exercise the actual Railway entrypoint, persisted data and bundled web root."""
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from conftest import doc
from test_financial_reviews import document


def test_railway_port_restart_and_saved_reviews(tmp_path):
    api = Path(__file__).resolve().parents[1]
    database = tmp_path / 'volume' / 'lumnia.db'
    database.parent.mkdir()
    with sqlite3.connect(database) as con:
        con.executescript('''
        CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, sub TEXT NOT NULL);
        CREATE TABLE users (username TEXT PRIMARY KEY, org TEXT NOT NULL REFERENCES orgs(id),
          pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, created_at TEXT NOT NULL,
          last_seen TEXT, disabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE runs (org TEXT NOT NULL, ts TEXT NOT NULL, modules TEXT NOT NULL, facts TEXT NOT NULL);
        INSERT INTO orgs VALUES ('existing-client', 'Existing client', '{"fr":"Existing"}');
        INSERT INTO users VALUES ('existing-reader','existing-client','hash','salt','2025-01-01T00:00:00Z',NULL,0);
        INSERT INTO runs VALUES ('existing-client','2025-01-01','[]','[]');
        ''')
    static = tmp_path / 'static'
    static.mkdir()
    (static / 'index.html').write_text('<html><body>Lumnia runtime fixture</body></html>')
    expected_session = saved = report_key = None
    for boot in range(2):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env = {**os.environ, 'PORT':str(port), 'LUMNIA_DB':str(database),
               'LUMNIA_STATIC':str(static), 'LUMNIA_BOOTSTRAP_ORGS':'',
               'LUMNIA_ADMIN_TOKEN':'runtime-test-token',
               'LUMNIA_SESSION_SECRET':'runtime-test-session', 'LUMNIA_BUILD_SHA':'runtime-test-revision'}
        with (tmp_path / f'boot-{boot}.log').open('w+') as log:
            process = subprocess.Popen([sys.executable, '-m', 'app.serve'], cwd=api, env=env,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
            def request(path, payload=None, auth=False):
                headers = {'Content-Type':'application/json'}
                if auth:
                    headers['Authorization'] = 'Bearer runtime-test-token'
                req = Request(f'http://127.0.0.1:{port}'+path,
                              data=None if payload is None else json.dumps(payload).encode(), headers=headers)
                try:
                    response = urlopen(req, timeout=2)
                except HTTPError as exc:
                    response = exc
                with response:
                    body = response.read().decode()
                    return response.status, json.loads(body) if 'application/json' in response.headers.get('Content-Type','') else body
            try:
                deadline = time.monotonic()+15
                while True:
                    if process.poll() is not None:
                        log.seek(0)
                        raise AssertionError('Server exited before readiness: '+log.read()[-2000:])
                    try:
                        status, health = request('/v1/health')
                        if status == 200:
                            break
                    except (URLError, TimeoutError):
                        pass
                    assert time.monotonic()<deadline, 'Server did not listen on the supplied PORT.'
                    time.sleep(.05)
                assert health['ok'] and health['version'] == '0.3.0'
                assert health['revision'] == 'runtime-test-revision'
                assert 'combined-financial-upload' in health['features']
                assert request('/')[0] == 200
                assert request('/v1/financial-reviews?org=existing-client')[0] == 401
                assert request('/v1/analysis-studio/dashboards?org=existing-client', auth=True) == (200, [])
                if boot == 0:
                    status, saved = request('/v1/financial-reviews?org=existing-client', document(), auth=True)
                    assert status == 201
                    status, report = request('/v1/orgs/existing-client/reports', doc('runtime-report','existing-client'), auth=True)
                    assert status == 201
                    report_key = report['share_key']
                assert request('/v1/financial-reviews/'+saved['id']+'?org=existing-client', auth=True) == (200, saved)
                assert request('/v1/reports/runtime-report?k='+report_key)[0] == 200
                with sqlite3.connect(database) as con:
                    session = con.execute('SELECT session_id FROM users').fetchone()[0]
                    assert len(session) == 32
                    assert expected_session is None or session == expected_session
                    expected_session = session
                    assert con.execute('SELECT COUNT(*) FROM runs').fetchone()[0] == 1
                    assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
