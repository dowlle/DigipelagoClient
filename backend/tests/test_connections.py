"""Tests for the connections blueprint (saved AP connections, encrypted pw).

These tests stub out the auth + db + crypto layers so they run without a live
Postgres and without the `cryptography` package installed. A tiny in-memory
store stands in for the `saved_connections` table; a fake crypto round-trips a
sentinel prefix so encryption/decryption is observable without real Fernet.

Security invariants under test:
- every route is owner-scoped (per-user isolation, 404 not 403 on foreign rows)
- the list endpoint NEVER returns the password, only `has_password`
- the password is only stored when present (opt-in), encrypted in password_enc
- the secret endpoint decrypts for the owner only
"""

import sys
import types

# The blueprint pulls in `backend.crypto` (-> cryptography) and `backend.db`
# (-> psycopg) at import time. Inject lightweight stubs so the module imports in
# environments where those native deps aren't installed; the tests monkeypatch
# `connections.crypto` and `connections.db` with in-memory fakes regardless, so
# these stubs are only there to satisfy the import graph.
if "cryptography" not in sys.modules:
    _fernet_mod = types.ModuleType("cryptography.fernet")
    _fernet_mod.Fernet = object  # never instantiated in tests
    _crypto_mod = types.ModuleType("cryptography")
    _crypto_mod.fernet = _fernet_mod
    sys.modules["cryptography"] = _crypto_mod
    sys.modules["cryptography.fernet"] = _fernet_mod

if "psycopg" not in sys.modules:
    _psycopg_mod = types.ModuleType("psycopg")
    _psycopg_mod.Connection = object
    _psycopg_mod.connect = lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("stubbed psycopg.connect")
    )
    _rows_mod = types.ModuleType("psycopg.rows")
    _rows_mod.dict_row = object
    _psycopg_mod.rows = _rows_mod
    sys.modules["psycopg"] = _psycopg_mod
    sys.modules["psycopg.rows"] = _rows_mod

import pytest  # noqa: E402
from flask import Flask, session  # noqa: E402

from backend import auth_utils  # noqa: E402
from backend.blueprints import connections  # noqa: E402


# --- In-memory fakes --------------------------------------------------------

class FakeDB:
    """Minimal stand-in for backend.db covering the connections SQL."""

    def __init__(self):
        self.rows = []          # list of dict rows
        self._next_id = 1

    def query(self, sql, params=(), fetch="all"):
        sql_norm = " ".join(sql.split())

        if sql_norm.startswith("SELECT id, label, server, port, slot_name, "
                               "password_enc FROM saved_connections"):
            (user_id,) = params
            return [
                dict(r) for r in self.rows if r["user_id"] == user_id
            ]

        if sql_norm.startswith("INSERT INTO saved_connections"):
            user_id, label, server, port, slot_name, password_enc = params
            row = {
                "id": self._next_id,
                "user_id": user_id,
                "label": label,
                "server": server,
                "port": port,
                "slot_name": slot_name,
                "password_enc": password_enc,
            }
            self._next_id += 1
            self.rows.append(row)
            return dict(row)

        if sql_norm.startswith("SELECT password_enc FROM saved_connections"):
            row_id, user_id = params
            for r in self.rows:
                if r["id"] == row_id and r["user_id"] == user_id:
                    return {"password_enc": r["password_enc"]}
            return None

        if sql_norm.startswith("DELETE FROM saved_connections"):
            row_id, user_id = params
            for r in list(self.rows):
                if r["id"] == row_id and r["user_id"] == user_id:
                    self.rows.remove(r)
                    return {"id": r["id"]}
            return None

        raise AssertionError(f"unexpected SQL: {sql_norm}")


class FakeCrypto:
    """Reversible fake that records every encrypt call for leak assertions."""

    def __init__(self):
        self.encrypted = []

    def encrypt(self, plaintext: str) -> bytes:
        self.encrypted.append(plaintext)
        return b"enc:" + plaintext.encode("utf-8")

    def decrypt(self, token: bytes) -> str:
        if isinstance(token, memoryview):
            token = token.tobytes()
        assert token.startswith(b"enc:")
        return token[len(b"enc:"):].decode("utf-8")


FAKE_USER = {"id": 42, "discord_id": "u-42", "username": "tester"}
OTHER_USER = {"id": 99, "discord_id": "u-99", "username": "other"}


@pytest.fixture
def app(monkeypatch):
    fake = FakeDB()
    fake_crypto = FakeCrypto()
    monkeypatch.setattr(connections, "db", fake)
    monkeypatch.setattr(connections, "crypto", fake_crypto)

    def _fake_current_user():
        sid = session.get("discord_id")
        if sid == "u-42":
            return FAKE_USER
        if sid == "u-99":
            return OTHER_USER
        return None

    # Patch on the connections module (used by the view bodies) AND on
    # auth_utils (used by the login_required decorator's auth gate).
    monkeypatch.setattr(connections, "current_user", _fake_current_user)
    monkeypatch.setattr(auth_utils, "current_user", _fake_current_user)

    flask_app = Flask(__name__)
    flask_app.secret_key = "test"
    flask_app.register_blueprint(connections.bp, url_prefix="/api")
    flask_app._fake_db = fake
    flask_app._fake_crypto = fake_crypto
    return flask_app


def _client(app, discord_id="u-42"):
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["discord_id"] = discord_id
    return client


@pytest.fixture
def auth_client(app):
    return _client(app)


# --- Auth gating ------------------------------------------------------------

def test_list_requires_auth(app):
    resp = app.test_client().get("/api/me/connections")
    assert resp.status_code == 401
    assert resp.get_json() == {"error": "unauthorized"}


def test_create_requires_auth(app):
    resp = app.test_client().post("/api/me/connections", json={"server": "x"})
    assert resp.status_code == 401


def test_secret_requires_auth(app):
    assert app.test_client().get("/api/me/connections/1/secret").status_code == 401


def test_delete_requires_auth(app):
    assert app.test_client().delete("/api/me/connections/1").status_code == 401


# --- Listing ----------------------------------------------------------------

def test_list_empty(auth_client):
    resp = auth_client.get("/api/me/connections")
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_create_then_list_no_password(auth_client):
    resp = auth_client.post(
        "/api/me/connections",
        json={"label": "Home", "server": "ap.example.com",
              "port": 38281, "slot_name": "Stef"},
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert body == {
        "id": 1, "label": "Home", "server": "ap.example.com",
        "port": 38281, "slot_name": "Stef", "has_password": False,
    }
    assert "password" not in body

    resp = auth_client.get("/api/me/connections")
    assert resp.get_json() == [body]


def test_create_with_password_sets_has_password(auth_client, app):
    resp = auth_client.post(
        "/api/me/connections",
        json={"label": "Pw", "server": "s", "port": 1, "slot_name": "n",
              "password": "hunter2"},
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["has_password"] is True
    assert "password" not in body
    # Stored encrypted, plaintext captured only inside the fake crypto.
    assert app._fake_crypto.encrypted == ["hunter2"]
    stored = app._fake_db.rows[0]["password_enc"]
    assert stored == b"enc:hunter2"
    assert b"hunter2" in stored  # encrypted blob, never the bare string elsewhere


def test_list_never_returns_password(auth_client):
    auth_client.post(
        "/api/me/connections",
        json={"server": "s", "port": 1, "slot_name": "n", "password": "secret"},
    )
    rows = auth_client.get("/api/me/connections").get_json()
    assert all("password" not in r for r in rows)
    assert rows[0]["has_password"] is True


# --- Password opt-in semantics ---------------------------------------------

def test_empty_password_is_not_stored(auth_client, app):
    resp = auth_client.post(
        "/api/me/connections",
        json={"server": "s", "port": 1, "slot_name": "n", "password": ""},
    )
    assert resp.get_json()["has_password"] is False
    assert app._fake_crypto.encrypted == []
    assert app._fake_db.rows[0]["password_enc"] is None


def test_missing_password_is_not_stored(auth_client, app):
    auth_client.post(
        "/api/me/connections",
        json={"server": "s", "port": 1, "slot_name": "n"},
    )
    assert app._fake_crypto.encrypted == []
    assert app._fake_db.rows[0]["password_enc"] is None


# --- Validation -------------------------------------------------------------

def test_create_non_object_body(auth_client):
    resp = auth_client.post("/api/me/connections", json=["nope"])
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "invalid_json"}


def test_create_missing_server(auth_client):
    resp = auth_client.post(
        "/api/me/connections", json={"port": 1, "slot_name": "n"})
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "missing_server"}


def test_create_missing_slot_name(auth_client):
    resp = auth_client.post(
        "/api/me/connections", json={"server": "s", "port": 1})
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "missing_slot_name"}


def test_create_missing_port(auth_client):
    resp = auth_client.post(
        "/api/me/connections", json={"server": "s", "slot_name": "n"})
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "missing_port"}


def test_create_port_as_string_coerced(auth_client):
    resp = auth_client.post(
        "/api/me/connections",
        json={"server": "s", "port": "38281", "slot_name": "n"})
    assert resp.status_code == 201
    assert resp.get_json()["port"] == 38281


def test_create_port_bool_rejected(auth_client):
    resp = auth_client.post(
        "/api/me/connections",
        json={"server": "s", "port": True, "slot_name": "n"})
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "missing_port"}


# --- Secret retrieval -------------------------------------------------------

def test_get_secret_owner(auth_client):
    auth_client.post(
        "/api/me/connections",
        json={"server": "s", "port": 1, "slot_name": "n", "password": "pw!"},
    )
    resp = auth_client.get("/api/me/connections/1/secret")
    assert resp.status_code == 200
    assert resp.get_json() == {"password": "pw!"}


def test_get_secret_none_when_no_password(auth_client):
    auth_client.post(
        "/api/me/connections",
        json={"server": "s", "port": 1, "slot_name": "n"},
    )
    resp = auth_client.get("/api/me/connections/1/secret")
    assert resp.status_code == 200
    assert resp.get_json() == {"password": None}


def test_get_secret_unknown_id_404(auth_client):
    resp = auth_client.get("/api/me/connections/999/secret")
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "not_found"}


# --- Ownership / isolation --------------------------------------------------

def test_foreign_secret_is_404_not_403(app):
    # User 42 creates a connection with a password.
    owner = _client(app, "u-42")
    owner.post(
        "/api/me/connections",
        json={"server": "s", "port": 1, "slot_name": "n", "password": "topsecret"},
    )
    # User 99 must not be able to read it, and must get 404 (no existence leak).
    intruder = _client(app, "u-99")
    resp = intruder.get("/api/me/connections/1/secret")
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "not_found"}


def test_list_is_per_user(app):
    owner = _client(app, "u-42")
    owner.post("/api/me/connections",
               json={"server": "s", "port": 1, "slot_name": "n"})
    intruder = _client(app, "u-99")
    assert intruder.get("/api/me/connections").get_json() == []


# --- Deletion ---------------------------------------------------------------

def test_delete_owner(auth_client):
    auth_client.post("/api/me/connections",
                     json={"server": "s", "port": 1, "slot_name": "n"})
    resp = auth_client.delete("/api/me/connections/1")
    assert resp.status_code == 204
    assert resp.data == b""
    assert auth_client.get("/api/me/connections").get_json() == []


def test_delete_unknown_id_404(auth_client):
    resp = auth_client.delete("/api/me/connections/999")
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "not_found"}


def test_delete_foreign_is_404(app):
    owner = _client(app, "u-42")
    owner.post("/api/me/connections",
               json={"server": "s", "port": 1, "slot_name": "n"})
    intruder = _client(app, "u-99")
    resp = intruder.delete("/api/me/connections/1")
    assert resp.status_code == 404
    # And the owner's row still exists.
    assert len(app._fake_db.rows) == 1
