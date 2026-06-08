"""Tests for the themes blueprint (theme-unlock sync).

These tests stub out the auth + db layer so they run without a live Postgres.
A tiny in-memory store stands in for the `unlocked_themes` table and the
`(user_id, theme_id)` UNION semantics.
"""

import sys
import types

import pytest
from flask import Flask, session

# The real db module imports psycopg at module load. The themes blueprint only
# ever talks to db through the helpers we monkeypatch below, so a stub module is
# enough to let the import chain (themes -> auth_utils -> db) resolve in CI/dev
# environments where the Postgres driver is not installed.
if "psycopg" not in sys.modules:
    _stub = types.ModuleType("psycopg")
    _stub.connect = lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("psycopg stub: no DB in tests")
    )
    _rows = types.ModuleType("psycopg.rows")
    _rows.dict_row = object()
    _stub.rows = _rows
    sys.modules["psycopg"] = _stub
    sys.modules["psycopg.rows"] = _rows

from backend import auth_utils
from backend.blueprints import themes


# --- In-memory fake for the unlocked_themes table ---------------------------

class FakeDB:
    """Minimal stand-in for backend.db that the themes blueprint needs."""

    def __init__(self):
        # set of (user_id, theme_id) tuples
        self.unlocks = set()

    def query(self, sql, params=(), fetch="all"):
        sql_norm = " ".join(sql.split())
        if sql_norm.startswith("SELECT theme_id FROM unlocked_themes"):
            user_id = params[0]
            ids = sorted(t for (u, t) in self.unlocks if u == user_id)
            return [{"theme_id": t} for t in ids]
        if sql_norm.startswith("INSERT INTO unlocked_themes"):
            user_id, theme_id = params
            self.unlocks.add((user_id, theme_id))
            return None
        raise AssertionError(f"unexpected SQL: {sql_norm}")


FAKE_USER = {"id": 42, "discord_id": "u-42", "username": "tester"}


@pytest.fixture
def app(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(themes, "db", fake)
    # Auth: only a request whose session carries discord_id is "logged in".
    # Patch in both places: themes.current_user (used by the view bodies) and
    # auth_utils.current_user (used by the login_required decorator wrapper).
    fake_current_user = lambda: FAKE_USER if session.get("discord_id") else None
    monkeypatch.setattr(themes, "current_user", fake_current_user)
    monkeypatch.setattr(auth_utils, "current_user", fake_current_user)

    flask_app = Flask(__name__)
    flask_app.secret_key = "test"
    flask_app.register_blueprint(themes.bp, url_prefix="/api")
    flask_app._fake_db = fake
    return flask_app


@pytest.fixture
def auth_client(app):
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["discord_id"] = "u-42"
    return client


def test_get_requires_auth(app):
    client = app.test_client()
    resp = client.get("/api/me/themes")
    assert resp.status_code == 401
    assert resp.get_json() == {"error": "unauthorized"}


def test_put_requires_auth(app):
    client = app.test_client()
    resp = client.put("/api/me/themes", json={"unlocked": ["x"]})
    assert resp.status_code == 401


def test_get_empty(auth_client):
    resp = auth_client.get("/api/me/themes")
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_put_then_get(auth_client):
    resp = auth_client.put("/api/me/themes", json={"unlocked": ["beta", "alpha"]})
    assert resp.status_code == 200
    assert resp.get_json() == ["alpha", "beta"]  # sorted

    resp = auth_client.get("/api/me/themes")
    assert resp.get_json() == ["alpha", "beta"]


def test_put_is_union_never_deletes(auth_client):
    auth_client.put("/api/me/themes", json={"unlocked": ["a", "b"]})
    # Second PUT with a disjoint set must not drop the earlier unlocks.
    resp = auth_client.put("/api/me/themes", json={"unlocked": ["c"]})
    assert resp.get_json() == ["a", "b", "c"]


def test_put_idempotent(auth_client):
    auth_client.put("/api/me/themes", json={"unlocked": ["a", "b"]})
    resp = auth_client.put("/api/me/themes", json={"unlocked": ["a", "b"]})
    assert resp.get_json() == ["a", "b"]


def test_put_dedupes_and_strips(auth_client):
    resp = auth_client.put(
        "/api/me/themes", json={"unlocked": [" a ", "a", "", "  ", "b"]}
    )
    assert resp.get_json() == ["a", "b"]


def test_put_empty_list_ok(auth_client):
    resp = auth_client.put("/api/me/themes", json={"unlocked": []})
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_put_missing_unlocked_defaults_empty(auth_client):
    resp = auth_client.put("/api/me/themes", json={})
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_put_non_object_body(auth_client):
    resp = auth_client.put("/api/me/themes", json=["not", "an", "object"])
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "invalid_body"}


def test_put_unlocked_not_list(auth_client):
    resp = auth_client.put("/api/me/themes", json={"unlocked": "nope"})
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "invalid_unlocked"}


def test_put_non_string_theme_id(auth_client):
    resp = auth_client.put("/api/me/themes", json={"unlocked": [1, 2]})
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "invalid_theme_id"}


def test_per_user_isolation(app):
    """A second user's unlocks must not appear for the first user."""
    fake = app._fake_db
    fake.unlocks.add((99, "other-user-theme"))
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["discord_id"] = "u-42"
    resp = client.put("/api/me/themes", json={"unlocked": ["mine"]})
    assert resp.get_json() == ["mine"]
