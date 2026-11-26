"""Accounts, sessions, request-forgery protection and per-user isolation."""

import io
import time

import pytest
from conftest import TEST_PASSWORD, register
from sqlalchemy import text
from starlette.websockets import WebSocketDisconnect

from engine import auth


def _login(client, email, password=TEST_PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_everything_but_health_defaults_and_sign_in_requires_a_session(anon_client):
    assert anon_client.get("/api/health").status_code == 200
    assert anon_client.get("/api/defaults").status_code == 200
    assert anon_client.get("/api/auth/config").json() == {"signup_allowed": True, "password_min_length": 12}
    for method, path in (("get", "/api/experiments"), ("get", "/api/experiments/" + "a" * 32),
                         ("post", "/api/experiments/validate"), ("get", "/api/simulations/" + "a" * 32),
                         ("get", "/api/studies/" + "a" * 32), ("get", "/api/datasets/" + "a" * 32),
                         ("get", "/api/terrain-models"), ("get", "/api/auth/me")):
        res = getattr(anon_client, method)(path, **({"json": {}} if method == "post" else {}))
        assert res.status_code == 401, (path, res.text)
        assert res.json()["error"]["code"] == "not_authenticated"


def test_register_sign_in_sign_out(anon_client):
    user = register(anon_client, "  Ada@Example.ORG ", name="Ada Lovelace")
    assert user["email"] == "ada@example.org" and "password_hash" not in user
    cookie = anon_client.cookies.get(auth.SESSION_COOKIE)
    assert cookie and len(cookie) >= 40
    assert anon_client.get("/api/auth/me").json()["user"]["display_name"] == "Ada Lovelace"
    assert anon_client.post("/api/auth/logout").status_code == 204
    assert anon_client.get("/api/auth/me").status_code == 401
    assert _login(anon_client, "ada@example.org", "wrong password!!").status_code == 401
    res = _login(anon_client, "ADA@example.org")
    assert res.status_code == 200 and res.json()["user"]["email"] == "ada@example.org"
    duplicate = anon_client.post("/api/auth/register", json={"email": "ada@example.org", "display_name": "X",
                                                             "password": TEST_PASSWORD})
    assert duplicate.status_code == 409


def test_session_cookie_attributes(anon_client):
    res = anon_client.post("/api/auth/register", json={"email": "c@example.org", "display_name": "C",
                                                       "password": TEST_PASSWORD})
    header = res.headers["set-cookie"].lower()
    assert "httponly" in header and "samesite=strict" in header and "path=/" in header


@pytest.mark.parametrize("password, fragment", [
    ("short", "at least 12"), ("aaaaaaaaaaaaaaaa", "repetitive"), ("x" * 300, "at most 256"),
])
def test_password_policy(anon_client, password, fragment):
    res = anon_client.post("/api/auth/register", json={"email": "p@example.org", "display_name": "P",
                                                       "password": password})
    assert res.status_code == 422
    assert fragment in " ".join(f["message"] for f in res.json()["error"]["fields"])


def test_passwords_and_tokens_are_never_stored_in_clear(anon_client):
    register(anon_client, "store@example.org")
    token = anon_client.cookies.get(auth.SESSION_COOKIE)
    with anon_client.app.state.store.engine.connect() as db:
        password_hash = db.execute(text("SELECT password_hash FROM users")).scalar_one()
        token_hash = db.execute(text("SELECT token_hash FROM sessions")).scalar_one()
    assert password_hash.startswith("$argon2id$") and TEST_PASSWORD not in password_hash
    assert token_hash == auth.token_hash(token) and token not in token_hash


def test_expired_and_idle_sessions_are_refused(client):
    assert client.get("/api/experiments").status_code == 200
    client.post("/api/_test/expire-sessions")
    res = client.get("/api/experiments")
    assert res.status_code == 401 and res.json()["error"]["code"] == "session_expired"
    assert client.get("/api/experiments").json()["error"]["code"] == "not_authenticated"  # the session is gone


def test_idle_timeout(client, monkeypatch):
    real = time.time
    monkeypatch.setattr("engine.api_common.time.time", lambda: real() + auth.IDLE_TIMEOUT_S + 1)
    res = client.get("/api/experiments")
    assert res.status_code == 401 and res.json()["error"]["code"] == "session_expired"


def test_state_changes_need_the_application_header_and_origin(client, small_config):
    no_header = client.post("/api/experiments", json={"config": small_config}, headers={"X-Requested-With": ""})
    assert no_header.status_code == 403 and no_header.json()["error"]["code"] == "csrf_rejected"
    foreign = client.post("/api/experiments", json={"config": small_config},
                          headers={"Origin": "https://evil.example"})
    assert foreign.status_code == 403
    same = client.post("/api/experiments", json={"config": small_config}, headers={"Origin": "http://testserver"})
    assert same.status_code == 201
    dev = client.post("/api/experiments", json={"config": small_config}, headers={"Origin": "http://127.0.0.1:5173"})
    assert dev.status_code == 201


def test_password_change(anon_client):
    from fastapi.testclient import TestClient

    from engine.main import app

    register(anon_client, "pw@example.org")
    with TestClient(app) as other:
        other.headers["X-Requested-With"] = "XMLHttpRequest"
        assert _login(other, "pw@example.org").status_code == 200
        wrong = anon_client.post("/api/auth/password", json={"current_password": "nope nope nope",
                                                             "new_password": "another long passphrase"})
        assert wrong.status_code == 422
        ok = anon_client.post("/api/auth/password", json={"current_password": TEST_PASSWORD,
                                                          "new_password": "another long passphrase"})
        assert ok.status_code == 204
        assert anon_client.get("/api/auth/me").status_code == 200  # this session continues
        assert other.get("/api/auth/me").status_code == 401  # every other session ends
    assert _login(anon_client, "pw@example.org", "another long passphrase").status_code == 200


def test_failed_sign_ins_are_throttled(anon_client):
    register(anon_client, "t@example.org")
    for _ in range(auth.THROTTLE_PER_ACCOUNT):
        assert _login(anon_client, "t@example.org", "wrong password!!").status_code == 401
    res = _login(anon_client, "t@example.org")  # even the right password waits
    assert res.status_code == 429 and int(res.headers["retry-after"]) > 0


def test_users_see_only_their_own_data(client, small_config):
    exp = client.post("/api/experiments", json={"config": small_config}).json()
    sim = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "instant"}).json()
    study = client.post(f"/api/experiments/{exp['id']}/studies",
                        json={"kind": "repeat", "runs": 5}).json()
    csv = ("station,time_utc,x_m,y_m,height_m,fractional_shift,uncertainty\n" + "".join(
        f"S{i},2027-03-01T10:{i:02d}:00Z,{i * 100},0,1,0,1e-18\n" for i in range(12))).encode()
    dataset = client.post(f"/api/experiments/{exp['id']}/datasets", data={"name": "d"},
                          files={"file": ("d.csv", io.BytesIO(csv), "text/csv")}).json()
    client.post("/api/auth/logout")
    register(client, "intruder@example.org")
    assert client.get("/api/experiments").json()["items"] == []
    for path in (f"/api/experiments/{exp['id']}", f"/api/experiments/{exp['id']}/simulations",
                 f"/api/experiments/{exp['id']}/plan", f"/api/simulations/{sim['id']}",
                 f"/api/simulations/{sim['id']}/measurements", f"/api/simulations/{sim['id']}/export",
                 f"/api/studies/{study['id']}", f"/api/datasets/{dataset['id']}",
                 f"/api/experiments/{exp['id']}/datasets"):
        res = client.get(path)
        assert res.status_code == 404, path
    assert client.delete(f"/api/experiments/{exp['id']}").status_code == 404
    assert client.put(f"/api/experiments/{exp['id']}",
                      json={"config": small_config, "expected_version": 1}).status_code == 404
    assert client.post(f"/api/simulations/{sim['id']}/cancel").status_code == 404
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(f"/api/simulations/{sim['id']}/stream") as ws:
            ws.receive_text()
    assert closed.value.code == 4404
    # Experiment codes are numbered per account.
    assert client.post("/api/experiments", json={"config": small_config}).json()["code"] == "EXP-00001"


def test_websocket_requires_a_session_and_this_origin(client, small_config):
    exp = client.post("/api/experiments", json={"config": small_config}).json()
    sim = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "instant"}).json()
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(f"/api/simulations/{sim['id']}/stream",
                                      headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_text()
    assert closed.value.code == 4403
    client.post("/api/auth/logout")
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(f"/api/simulations/{sim['id']}/stream") as ws:
            ws.receive_text()
    assert closed.value.code == 4401


def test_security_headers_and_size_limits(client):
    res = client.get("/api/experiments")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY" and res.headers["cache-control"] == "no-store"
    big = client.post("/api/experiments/validate", content=b"{" + b" " * (3 * 1024 * 1024) + b"}",
                      headers={"Content-Type": "application/json"})
    assert big.status_code == 413
    exp_id = "a" * 32
    huge = client.post(f"/api/experiments/{exp_id}/datasets", data={"name": "x"},
                       files={"file": ("x.csv", io.BytesIO(b"0" * (21 * 1024 * 1024)), "text/csv")})
    assert huge.status_code == 413 and huge.json()["error"]["code"] == "file_too_large"


def test_signup_can_be_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("ENGINE_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ENGINE_ALLOW_SIGNUP", "0")
    from fastapi.testclient import TestClient

    from engine.main import app

    with TestClient(app) as c:
        c.headers["X-Requested-With"] = "XMLHttpRequest"
        res = c.post("/api/auth/register", json={"email": "n@example.org", "display_name": "N",
                                                 "password": TEST_PASSWORD})
        assert res.status_code == 403 and res.json()["error"]["code"] == "signup_disabled"
        assert c.get("/api/auth/config").json()["signup_allowed"] is False
