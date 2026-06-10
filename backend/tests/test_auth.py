"""Unit tests for backend/blueprints/auth.py.

These tests build a minimal Flask app registering only the auth blueprint, and
monkeypatch the outbound Discord HTTP calls plus the db.query helper so nothing
touches the network or a real database.
"""

import sys
import types
from pathlib import Path

import pytest
from flask import Flask

# Make `backend` importable as a top-level package when tests run standalone.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND_DIR.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# The auth blueprint's import chain pulls in backend.db, which imports psycopg.
# These tests never touch a real database (db.query is monkeypatched), so stub
# psycopg if it isn't installed in this environment.
if "psycopg" not in sys.modules:
    try:
        import psycopg  # noqa: F401
    except ModuleNotFoundError:
        _psycopg = types.ModuleType("psycopg")
        _psycopg.Connection = object
        _rows = types.ModuleType("psycopg.rows")
        _rows.dict_row = object
        _psycopg.rows = _rows
        sys.modules["psycopg"] = _psycopg
        sys.modules["psycopg.rows"] = _rows

from backend.blueprints import auth as auth_mod  # noqa: E402


@pytest.fixture
def app(monkeypatch):
    # Deterministic config so we can assert on the authorize URL.
    monkeypatch.setattr(auth_mod.cfg, "DISCORD_CLIENT_ID", "cid123", raising=False)
    monkeypatch.setattr(
        auth_mod.cfg, "DISCORD_CLIENT_SECRET", "secret456", raising=False
    )
    monkeypatch.setattr(
        auth_mod.cfg,
        "DISCORD_REDIRECT_URI",
        "https://digipelago.ap-pie.com/api/auth/callback",
        raising=False,
    )

    flask_app = Flask(__name__)
    flask_app.config["SECRET_KEY"] = "test-secret"
    flask_app.config["SESSION_COOKIE_SECURE"] = False
    flask_app.register_blueprint(auth_mod.bp, url_prefix="/api")
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


def _fake_resp(json_data, status=200):
    resp = types.SimpleNamespace()
    resp.json = lambda: json_data
    resp.status_code = status

    def raise_for_status():
        if status >= 400:
            raise auth_mod.requests.HTTPError(f"status {status}")

    resp.raise_for_status = raise_for_status
    return resp


def test_login_redirects_to_discord_with_state(client):
    resp = client.get("/api/auth/login")
    assert resp.status_code == 302
    loc = resp.headers["Location"]
    assert loc.startswith(auth_mod.DISCORD_AUTHORIZE_URL)
    assert "client_id=cid123" in loc
    assert "scope=identify" in loc
    assert "state=" in loc

    with client.session_transaction() as sess:
        assert sess[auth_mod._STATE_KEY]


def test_callback_rejects_missing_state(client):
    resp = client.get("/api/auth/callback?code=abc&state=whatever")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_state"


def test_callback_rejects_mismatched_state(client):
    with client.session_transaction() as sess:
        sess[auth_mod._STATE_KEY] = "expected"
    resp = client.get("/api/auth/callback?code=abc&state=wrong")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_state"


def test_callback_happy_path_upserts_and_sets_session(client, monkeypatch):
    captured = {}

    def fake_post(url, data=None, headers=None, timeout=None):
        captured["token_data"] = data
        return _fake_resp({"access_token": "tok-xyz"})

    def fake_get(url, headers=None, timeout=None):
        return _fake_resp(
            {"id": "42", "username": "stef", "discriminator": "0", "avatar": "av"}
        )

    def fake_query(sql, params=(), fetch="all"):
        captured["sql"] = sql
        captured["params"] = params
        return None

    monkeypatch.setattr(auth_mod.requests, "post", fake_post)
    monkeypatch.setattr(auth_mod.requests, "get", fake_get)
    monkeypatch.setattr(auth_mod.db, "query", fake_query)

    with client.session_transaction() as sess:
        sess[auth_mod._STATE_KEY] = "good-state"

    resp = client.get("/api/auth/callback?code=the-code&state=good-state")
    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/")

    # Token exchange used config secrets + the code.
    assert captured["token_data"]["code"] == "the-code"
    assert captured["token_data"]["client_secret"] == "secret456"
    # UPSERT ran with the discord id/username/avatar.
    assert "ON CONFLICT (discord_id) DO UPDATE" in captured["sql"]
    assert captured["params"] == ("42", "stef", "av")

    with client.session_transaction() as sess:
        assert sess["discord_id"] == "42"


def test_callback_keeps_legacy_discriminator(client, monkeypatch):
    captured = {}

    monkeypatch.setattr(
        auth_mod.requests, "post", lambda *a, **k: _fake_resp({"access_token": "t"})
    )
    monkeypatch.setattr(
        auth_mod.requests,
        "get",
        lambda *a, **k: _fake_resp(
            {"id": "7", "username": "old", "discriminator": "1234", "avatar": None}
        ),
    )
    monkeypatch.setattr(
        auth_mod.db,
        "query",
        lambda sql, params=(), fetch="all": captured.update(params=params),
    )

    with client.session_transaction() as sess:
        sess[auth_mod._STATE_KEY] = "s"
    resp = client.get("/api/auth/callback?code=c&state=s")
    assert resp.status_code == 302
    assert captured["params"] == ("7", "old#1234", None)


def test_callback_token_failure_returns_502(client, monkeypatch):
    monkeypatch.setattr(
        auth_mod.requests, "post", lambda *a, **k: _fake_resp({}, status=400)
    )
    with client.session_transaction() as sess:
        sess[auth_mod._STATE_KEY] = "s"
    resp = client.get("/api/auth/callback?code=c&state=s")
    assert resp.status_code == 502
    assert resp.get_json()["error"] == "token_exchange_failed"


def test_logout_clears_session(client):
    with client.session_transaction() as sess:
        sess["discord_id"] = "99"
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True}
    with client.session_transaction() as sess:
        assert "discord_id" not in sess


def test_me_returns_null_when_logged_out(client, monkeypatch):
    monkeypatch.setattr(auth_mod, "current_user", lambda: None)
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.get_json() is None


def test_me_returns_profile_when_logged_in(client, monkeypatch):
    monkeypatch.setattr(
        auth_mod,
        "current_user",
        lambda: {"discord_id": "42", "username": "stef", "avatar": "av"},
    )
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.get_json() == {
        "discord_id": "42",
        "username": "stef",
        "avatar": "av",
        "is_owner": False,
    }
