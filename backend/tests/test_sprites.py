"""Tests for the sprite-recipes blueprint (Sprite Cutout Manager).

Stubs auth + db like test_themes.py: an in-memory store stands in for the
sprite_recipes / sprite_recipe_submissions tables. The flask-limiter decorators
run against the default in-memory storage and are loose enough not to trip in
tests.
"""

import sys
import types

import pytest
from flask import Flask, session

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
from backend.blueprints import sprites

import json as _json


class FakeDB:
    """In-memory stand-in for the two sprite tables."""

    def __init__(self):
        self.recipes = {}  # (dataset_version, target_id) -> recipe dict
        self.submissions = []  # list of dicts with id/ts/who/.../status
        self._next_id = 1

    def query(self, sql, params=(), fetch="all"):
        q = " ".join(sql.split())
        if q.startswith("SELECT target_id, recipe FROM sprite_recipes"):
            dv = params[0]
            return [
                {"target_id": tid, "recipe": recipe}
                for (v, tid), recipe in sorted(self.recipes.items())
                if v == dv
            ]
        if q.startswith("INSERT INTO sprite_recipe_submissions"):
            who, dv, tid, recipe, note = params
            self.submissions.append(
                {
                    "id": self._next_id,
                    "ts": None,
                    "who": who,
                    "dataset_version": dv,
                    "target_id": tid,
                    "recipe": _json.loads(recipe),
                    "note": note,
                    "status": "pending",
                }
            )
            self._next_id += 1
            return None
        if q.startswith("SELECT id, ts, who, target_id, recipe, note FROM sprite_recipe_submissions"):
            dv = params[0]
            tid = params[1] if len(params) > 1 else None
            return [
                s
                for s in self.submissions
                if s["dataset_version"] == dv
                and s["status"] == "pending"
                and (tid is None or s["target_id"] == tid)
            ]
        if q.startswith("SELECT id, dataset_version, target_id, recipe FROM sprite_recipe_submissions"):
            sid = params[0]
            for s in self.submissions:
                if s["id"] == sid and s["status"] == "pending":
                    return s
            return None
        if q.startswith("SELECT id FROM sprite_recipe_submissions"):
            sid = params[0]
            for s in self.submissions:
                if s["id"] == sid and s["status"] == "pending":
                    return {"id": sid}
            return None
        if q.startswith("INSERT INTO sprite_recipes"):
            dv, tid, recipe = params
            self.recipes[(dv, tid)] = _json.loads(recipe)
            return None
        if q.startswith("UPDATE sprite_recipe_submissions SET status = 'approved'"):
            for s in self.submissions:
                if s["id"] == params[0]:
                    s["status"] = "approved"
            return None
        if q.startswith("UPDATE sprite_recipe_submissions SET status = 'rejected'"):
            for s in self.submissions:
                if s["id"] == params[0]:
                    s["status"] = "rejected"
            return None
        raise AssertionError(f"unexpected SQL: {q}")


OWNER = {"id": 1, "discord_id": "owner-1", "username": "owner"}
PLEB = {"id": 2, "discord_id": "user-2", "username": "pleb"}


@pytest.fixture
def app(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(sprites, "db", fake)

    def fake_current_user():
        did = session.get("discord_id")
        if did == "owner-1":
            return OWNER
        if did == "user-2":
            return PLEB
        return None

    monkeypatch.setattr(sprites, "current_user", fake_current_user)
    monkeypatch.setattr(auth_utils, "current_user", fake_current_user)

    flask_app = Flask(__name__)
    flask_app.secret_key = "test"
    flask_app.config["OWNER_DISCORD_ID"] = "owner-1"
    flask_app.register_blueprint(sprites.bp, url_prefix="/api")
    flask_app._fake_db = fake
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def owner_client(app):
    c = app.test_client()
    with c.session_transaction() as sess:
        sess["discord_id"] = "owner-1"
    return c


@pytest.fixture
def user_client(app):
    c = app.test_client()
    with c.session_transaction() as sess:
        sess["discord_id"] = "user-2"
    return c


RECIPE = {"tolerance": 210, "borderSeeds": False, "seeds": [{"x": 0.5, "y": 0.25}]}


# --- validate_recipe ----------------------------------------------------------

def test_validate_recipe_normalizes():
    out = sprites.validate_recipe({"mode": "cutout", "tolerance": 210.7, "seeds": [{"x": 0.12345, "y": 1.0}]})
    assert out == {"tolerance": 210, "seeds": [{"x": 0.1235, "y": 1.0}]}


def test_validate_recipe_rejects_bad():
    assert sprites.validate_recipe(None) is None
    assert sprites.validate_recipe({"mode": "evil"}) is None
    assert sprites.validate_recipe({"tolerance": 10}) is None  # out of bounds
    assert sprites.validate_recipe({"tolerance": True}) is None
    assert sprites.validate_recipe({"seeds": [{"x": 2, "y": 0}]}) is None
    assert sprites.validate_recipe({"seeds": [{"x": 0.1}]}) is None
    assert sprites.validate_recipe({"feather": 99}) is None
    assert sprites.validate_recipe({"seeds": [{"x": 0, "y": 0}] * 17}) is None


def test_validate_recipe_empty_ok():
    assert sprites.validate_recipe({}) == {}
    assert sprites.validate_recipe({"mode": "boxed"}) == {"mode": "boxed"}


def test_validate_recipe_key_color():
    assert sprites.validate_recipe({"keyColor": "#1A2b3C"}) == {"keyColor": "#1a2b3c"}
    assert sprites.validate_recipe({"keyColor": "red"}) is None
    assert sprites.validate_recipe({"keyColor": "#12345"}) is None
    assert sprites.validate_recipe({"keyColor": 123456}) is None


# --- GET blob -----------------------------------------------------------------

def test_get_empty(client):
    resp = client.get("/api/sprite-recipes?dataset_version=v1")
    assert resp.status_code == 200
    assert resp.get_json() == {}


def test_get_missing_version(client):
    assert client.get("/api/sprite-recipes").get_json() == {}


def test_get_serves_approved(app, client):
    app._fake_db.recipes[("v1", 7)] = {"mode": "boxed"}
    body = client.get("/api/sprite-recipes?dataset_version=v1").get_json()
    assert body == {"recipes": {"7": {"mode": "boxed"}}}


# --- submit -------------------------------------------------------------------

def test_submit_anonymous_ok(app, client):
    resp = client.post(
        "/api/sprite-recipes/submit",
        json={"dataset_version": "v1", "target_id": 7, "recipe": RECIPE, "note": "scythe gap"},
    )
    assert resp.status_code == 201
    subs = app._fake_db.submissions
    assert len(subs) == 1
    assert subs[0]["target_id"] == 7
    assert subs[0]["recipe"]["tolerance"] == 210
    assert subs[0]["status"] == "pending"


def test_submit_invalid_recipe(client):
    resp = client.post(
        "/api/sprite-recipes/submit",
        json={"dataset_version": "v1", "target_id": 7, "recipe": {"tolerance": 1}},
    )
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "invalid_recipe"}


def test_submit_missing_fields(client):
    assert client.post("/api/sprite-recipes/submit", json={}).status_code == 400
    assert (
        client.post("/api/sprite-recipes/submit", json={"dataset_version": "v1", "recipe": {}}).status_code
        == 400
    )


# --- owner review -------------------------------------------------------------

def _submit(client, target_id=7):
    return client.post(
        "/api/sprite-recipes/submit",
        json={"dataset_version": "v1", "target_id": target_id, "recipe": RECIPE},
    )


def test_submissions_requires_owner(client, user_client):
    assert client.get("/api/sprite-recipes/submissions?dataset_version=v1").status_code == 401
    assert user_client.get("/api/sprite-recipes/submissions?dataset_version=v1").status_code == 403


def test_owner_lists_pending(client, owner_client):
    _submit(client, 7)
    _submit(client, 9)
    body = owner_client.get("/api/sprite-recipes/submissions?dataset_version=v1").get_json()
    assert {s["target_id"] for s in body["submissions"]} == {7, 9}
    body = owner_client.get("/api/sprite-recipes/submissions?dataset_version=v1&target_id=9").get_json()
    assert [s["target_id"] for s in body["submissions"]] == [9]


def test_approve_promotes_and_resolves(app, client, owner_client):
    _submit(client, 7)
    sub_id = app._fake_db.submissions[0]["id"]
    resp = owner_client.post("/api/sprite-recipes/approve", json={"id": sub_id})
    assert resp.status_code == 200
    assert app._fake_db.recipes[("v1", 7)]["tolerance"] == 210
    assert app._fake_db.submissions[0]["status"] == "approved"
    # approving again: no longer pending -> 404
    assert owner_client.post("/api/sprite-recipes/approve", json={"id": sub_id}).status_code == 404


def test_approve_requires_owner(client, user_client):
    _submit(client, 7)
    assert user_client.post("/api/sprite-recipes/approve", json={"id": 1}).status_code == 403


def test_reject_resolves(app, client, owner_client):
    _submit(client, 7)
    sub_id = app._fake_db.submissions[0]["id"]
    assert owner_client.post("/api/sprite-recipes/reject", json={"id": sub_id}).status_code == 200
    assert app._fake_db.submissions[0]["status"] == "rejected"
    assert ("v1", 7) not in app._fake_db.recipes


def test_owner_direct_put(app, owner_client, user_client):
    resp = owner_client.put(
        "/api/sprite-recipes",
        json={"dataset_version": "v1", "target_id": 3, "recipe": {"mode": "boxed"}},
    )
    assert resp.status_code == 200
    assert app._fake_db.recipes[("v1", 3)] == {"mode": "boxed"}
    assert (
        user_client.put(
            "/api/sprite-recipes",
            json={"dataset_version": "v1", "target_id": 3, "recipe": {}},
        ).status_code
        == 403
    )


def test_owner_gating_off_when_unconfigured(monkeypatch, app, owner_client):
    app.config["OWNER_DISCORD_ID"] = ""
    assert owner_client.get("/api/sprite-recipes/submissions?dataset_version=v1").status_code == 403
