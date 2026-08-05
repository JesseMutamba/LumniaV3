"""Client sign-in.

Most of these assert a refusal. A login is only as good as the doors it
keeps shut, so the interesting cases are the ones that must not work.
"""
from __future__ import annotations

import time

from conftest import AUTH, doc

PW = "correct-horse-battery"


def _org(client, oid):
    client.post("/v1/orgs", json={"id": oid, "name": oid.upper(), "sub": {"fr": "x"}},
                headers=AUTH)
    return oid


def _user(client, oid, username, password=PW):
    return client.post(f"/v1/studio/orgs/{oid}/users",
                       json={"username": username, "password": password}, headers=AUTH)


def _login(client, username, password=PW):
    return client.post("/v1/auth/login", json={"username": username, "password": password})


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------- issuing ---

def test_issuing_a_login_never_returns_the_password_or_its_hash(client):
    o = _org(client, "acc-a")
    body = _user(client, o, "acc-a-reader").json()
    assert body["username"] == "acc-a-reader" and body["org"] == o
    flat = str(body)
    assert PW not in flat
    assert "hash" not in flat and "salt" not in flat


def test_a_username_cannot_be_taken_twice(client):
    a, b = _org(client, "acc-b1"), _org(client, "acc-b2")
    assert _user(client, a, "shared-name").status_code == 201
    # Silently re-pointing it at org b would hand b's reports to a's reader.
    assert _user(client, b, "shared-name").status_code == 409


def test_a_short_password_is_refused_before_it_is_hashed(client):
    o = _org(client, "acc-c")
    assert _user(client, o, "acc-c-reader", "short").status_code == 422


def test_issuing_a_login_requires_the_author_token(client):
    o = _org(client, "acc-d")
    r = client.post(f"/v1/studio/orgs/{o}/users",
                    json={"username": "acc-d-reader", "password": PW})
    assert r.status_code == 401


# -------------------------------------------------------------- signing in ---

def test_signing_in_returns_a_session_for_the_right_client(client):
    o = _org(client, "acc-e")
    _user(client, o, "acc-e-reader")
    r = _login(client, "acc-e-reader")
    assert r.status_code == 200
    s = r.json()
    assert s["org"]["id"] == o and s["user"]["username"] == "acc-e-reader"
    assert s["expires_at"] > time.time()


def test_a_wrong_password_and_an_unknown_name_are_indistinguishable(client):
    o = _org(client, "acc-f")
    _user(client, o, "acc-f-reader")
    wrong = _login(client, "acc-f-reader", "not-the-password")
    missing = _login(client, "acc-f-nobody", "not-the-password")
    assert wrong.status_code == missing.status_code == 401
    # Same words, or the error tells an attacker which usernames are real.
    assert wrong.json()["detail"] == missing.json()["detail"]


def test_a_disabled_login_stops_working(client):
    o = _org(client, "acc-g")
    _user(client, o, "acc-g-reader")
    assert _login(client, "acc-g-reader").status_code == 200
    client.post("/v1/studio/users/acc-g-reader/disable", headers=AUTH)
    assert _login(client, "acc-g-reader").status_code == 401


def test_disabling_a_login_kills_a_session_already_issued(client):
    """The token is still unexpired and correctly signed. It must still stop
    working the moment the account is switched off."""
    o = _org(client, "acc-h")
    _user(client, o, "acc-h-reader")
    tok = _login(client, "acc-h-reader").json()["token"]
    assert client.get("/v1/auth/me", headers=_bearer(tok)).status_code == 200
    client.post("/v1/studio/users/acc-h-reader/disable", headers=AUTH)
    assert client.get("/v1/auth/me", headers=_bearer(tok)).status_code == 401


def test_a_tampered_token_is_refused(client):
    o = _org(client, "acc-i")
    _user(client, o, "acc-i-reader")
    tok = _login(client, "acc-i-reader").json()["token"]
    name, exp, sig = tok.rsplit(":", 2)
    for forged in (
        f"other-user:{exp}:{sig}",           # someone else's name, real signature
        f"{name}:{int(exp) + 99999}:{sig}",  # extended expiry, real signature
        f"{name}:{exp}:{'0' * len(sig)}",    # no signature worth the name
        "not-even-shaped-like-a-token",
    ):
        assert client.get("/v1/auth/me", headers=_bearer(forged)).status_code == 401


def test_an_expired_token_is_refused(client):
    from app.auth import new_session

    tok, _ = new_session("acc-j-reader", hours=-1)
    assert client.get("/v1/auth/me", headers=_bearer(tok)).status_code == 401


def test_a_new_password_replaces_the_old_one(client):
    o = _org(client, "acc-k")
    _user(client, o, "acc-k-reader")
    client.put("/v1/studio/users/acc-k-reader/password",
               json={"password": "a-brand-new-secret"}, headers=AUTH)
    assert _login(client, "acc-k-reader", PW).status_code == 401
    assert _login(client, "acc-k-reader", "a-brand-new-secret").status_code == 200


# ------------------------------------------------------------ what they see ---

def test_a_client_sees_only_their_own_published_reports(client):
    a, b = _org(client, "acc-l1"), _org(client, "acc-l2")
    client.post(f"/v1/orgs/{a}/reports", json=doc("acc-l1-pub", org=a), headers=AUTH)
    client.post(f"/v1/orgs/{a}/reports", json=doc("acc-l1-draft", org=a, status="draft"),
                headers=AUTH)
    client.post(f"/v1/orgs/{b}/reports", json=doc("acc-l2-pub", org=b), headers=AUTH)
    _user(client, a, "acc-l1-reader")
    tok = _login(client, "acc-l1-reader").json()["token"]
    ids = [r["id"] for r in client.get("/v1/me/reports", headers=_bearer(tok)).json()]
    assert ids == ["acc-l1-pub"]


def test_a_signed_in_client_opens_their_report_without_a_key(client):
    o = _org(client, "acc-m")
    client.post(f"/v1/orgs/{o}/reports", json=doc("acc-m-rep", org=o), headers=AUTH)
    _user(client, o, "acc-m-reader")
    tok = _login(client, "acc-m-reader").json()["token"]
    r = client.get("/v1/reports/acc-m-rep", headers=_bearer(tok))
    assert r.status_code == 200
    # and the key still never comes back in the body
    assert r.json()["share_key"] is None


def test_a_signed_in_client_cannot_open_another_clients_report(client):
    """The whole point. A valid session is not a key to the building."""
    a, b = _org(client, "acc-n1"), _org(client, "acc-n2")
    client.post(f"/v1/orgs/{b}/reports", json=doc("acc-n2-rep", org=b), headers=AUTH)
    _user(client, a, "acc-n1-reader")
    tok = _login(client, "acc-n1-reader").json()["token"]
    assert client.get("/v1/reports/acc-n2-rep", headers=_bearer(tok)).status_code == 404


def test_a_keyed_link_still_works_for_someone_with_no_account(client):
    o = _org(client, "acc-o")
    rep = client.post(f"/v1/orgs/{o}/reports", json=doc("acc-o-rep", org=o),
                      headers=AUTH).json()
    assert client.get(f"/v1/reports/acc-o-rep?k={rep['share_key']}").status_code == 200


def test_a_retracted_report_is_closed_to_a_signed_in_client_too(client):
    o = _org(client, "acc-p")
    client.post(f"/v1/orgs/{o}/reports", json=doc("acc-p-rep", org=o), headers=AUTH)
    client.patch("/v1/studio/reports/acc-p-rep/status?new_status=retracted", headers=AUTH)
    _user(client, o, "acc-p-reader")
    tok = _login(client, "acc-p-reader").json()["token"]
    assert client.get("/v1/reports/acc-p-rep", headers=_bearer(tok)).status_code == 410


def test_reports_need_a_key_or_a_session_and_nothing_else(client):
    o = _org(client, "acc-q")
    client.post(f"/v1/orgs/{o}/reports", json=doc("acc-q-rep", org=o), headers=AUTH)
    assert client.get("/v1/reports/acc-q-rep").status_code == 404
    assert client.get("/v1/reports/acc-q-rep?k=wrong").status_code == 404


def test_deleting_a_client_takes_its_logins_with_it(client):
    o = _org(client, "acc-r")
    _user(client, o, "acc-r-reader")
    assert client.delete(f"/v1/studio/orgs/{o}", headers=AUTH).status_code == 204
    assert _login(client, "acc-r-reader").status_code == 401


def test_repeated_wrong_passwords_get_locked_out(client, monkeypatch):
    """The suite runs with the limiter wide open so ordering does not matter.
    Close it here: guessing has to stop being free."""
    from app import auth

    o = _org(client, "acc-s")
    _user(client, o, "acc-s-reader")
    monkeypatch.setenv("LUMNIA_LOGIN_LIMIT", "3")
    auth._login_hits.clear()
    codes = [_login(client, "acc-s-reader", "wrong").status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401]
    assert codes[3:] == [429, 429]
    # and the lockout is on attempts, not on the account: the right password
    # is refused too while the window is open
    assert _login(client, "acc-s-reader").status_code == 429
    auth._login_hits.clear()
    assert _login(client, "acc-s-reader").status_code == 200
