"""Unit tests for the telemetry blueprint.

These tests exercise the request/validation logic without a live database by
stubbing `backend.db` (get_conn / query). They cover: batch parsing, the
batch-size cap, the event allow-list, round + round_options fan-out, and the
difficulty read endpoint (incl. the empty-data {} contract).

Run from the repo root:  python -m pytest backend/tests/test_telemetry.py
"""

import json
import sys
import types

import pytest
from flask import Flask

# The real `psycopg` driver may not be installed in the test environment. These
# tests stub `backend.db.get_conn`/`query` and never touch a live database, so
# we provide a minimal `psycopg` shim purely to satisfy `backend.db`'s import.
if "psycopg" not in sys.modules:
    _psycopg = types.ModuleType("psycopg")
    _psycopg.Connection = object

    def _no_connect(*args, **kwargs):  # pragma: no cover - never called in tests
        raise RuntimeError("psycopg.connect stubbed out in tests")

    _psycopg.connect = _no_connect
    _rows = types.ModuleType("psycopg.rows")
    _rows.dict_row = object
    _psycopg.rows = _rows
    sys.modules["psycopg"] = _psycopg
    sys.modules["psycopg.rows"] = _rows

from backend.blueprints import telemetry as tel


# --- fakes -------------------------------------------------------------------

class FakeCursor:
    """Minimal cursor recording executed statements; fakes RETURNING id."""

    def __init__(self, sink):
        self._sink = sink
        self._next_id = 1
        self._last_returns_id = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self._sink.append((" ".join(sql.split()), params))
        self._last_returns_id = "RETURNING id" in sql

    def fetchone(self):
        if self._last_returns_id:
            rid = self._next_id
            self._next_id += 1
            return {"id": rid}
        return None


class FakeConn:
    def __init__(self, sink):
        self._sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return FakeCursor(self._sink)


@pytest.fixture
def app(monkeypatch):
    statements = []

    class _ConnCtx:
        def __enter__(self):
            return FakeConn(statements)

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(tel.db, "get_conn", lambda: _ConnCtx())
    flask_app = Flask(__name__)
    flask_app.register_blueprint(tel.bp, url_prefix="/api")
    flask_app.config["statements"] = statements
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


# --- rounds ------------------------------------------------------------------

def test_post_rounds_inserts_round_and_options(client, app):
    body = [
        {
            "dataset_version": "v1",
            "who": "anon",
            "target_id": 25,
            "options": [25, 26, 4],
            "wrong_ids": [26],
            "picked_id": 25,
            "correct": True,
            "ms": 1200,
            "mode": "classic",
            "difficulty": "easy",
        }
    ]
    resp = client.post("/api/telemetry/rounds", json=body)
    assert resp.status_code == 201
    assert resp.get_json() == {"inserted": 1, "skipped": 0}

    stmts = app.config["statements"]
    inserts_rounds = [s for s in stmts if "INSERT INTO rounds" in s[0]]
    inserts_opts = [s for s in stmts if "INSERT INTO round_options" in s[0]]
    assert len(inserts_rounds) == 1
    assert len(inserts_opts) == 3
    # option 26 was the wrong one
    was_wrong = {params[1]: params[2] for _, params in inserts_opts}
    assert was_wrong == {25: False, 26: True, 4: False}


def test_post_rounds_skips_missing_required(client):
    body = [{"who": "anon", "target_id": 1}, {"dataset_version": "v1"}]
    resp = client.post("/api/telemetry/rounds", json=body)
    assert resp.status_code == 201
    assert resp.get_json() == {"inserted": 0, "skipped": 2}


def test_post_rounds_accepts_wrapped_object(client):
    body = {"rounds": [{"dataset_version": "v1", "target_id": 7, "options": []}]}
    resp = client.post("/api/telemetry/rounds", json=body)
    assert resp.status_code == 201
    assert resp.get_json()["inserted"] == 1


def test_batch_too_large(client):
    body = [{"dataset_version": "v1", "target_id": 1} for _ in range(tel.MAX_BATCH + 1)]
    resp = client.post("/api/telemetry/rounds", json=body)
    assert resp.status_code == 413
    assert resp.get_json()["error"] == "batch_too_large"


def test_invalid_json(client):
    resp = client.post(
        "/api/telemetry/rounds", data="not json", content_type="application/json"
    )
    assert resp.status_code == 400


# --- events ------------------------------------------------------------------

def test_post_events_allowlist(client, app):
    body = [
        {"dataset_version": "v1", "event_type": "catch", "payload": {"id": 1}},
        {"event_type": "totally_unknown", "payload": {"x": 1}},
        {"event_type": "session_start"},
    ]
    resp = client.post("/api/telemetry/events", json=body)
    assert resp.status_code == 201
    data = resp.get_json()
    assert data == {"inserted": 2, "skipped": 0, "rejected": 1}

    stmts = app.config["statements"]
    event_inserts = [s for s in stmts if "INSERT INTO events" in s[0]]
    assert len(event_inserts) == 2
    # payload serialized to JSON string for the dict case, None otherwise
    first_payload = event_inserts[0][1][3]
    assert json.loads(first_payload) == {"id": 1}
    assert event_inserts[1][1][3] is None  # session_start had no payload


def test_post_events_rejects_nondict_payload(client, app):
    body = [{"event_type": "catch", "payload": "free text here"}]
    resp = client.post("/api/telemetry/events", json=body)
    assert resp.status_code == 201
    assert resp.get_json()["inserted"] == 1
    stmts = app.config["statements"]
    event_inserts = [s for s in stmts if "INSERT INTO events" in s[0]]
    assert event_inserts[0][1][3] is None  # free text not stored


# --- difficulty --------------------------------------------------------------

def test_difficulty_empty_when_no_param(client):
    resp = client.get("/api/difficulty")
    assert resp.status_code == 200
    assert resp.get_json() == {}


def test_difficulty_returns_stats(client, monkeypatch):
    def fake_query(sql, params=(), fetch="all"):
        if "target_stats" in sql:
            return [
                {"target_id": 25, "difficulty": "hard", "n": 40},
                {"target_id": 4, "difficulty": "easy", "n": 10},
            ]
        if "pair_stats" in sql:
            return [
                {"target_id": 25, "distractor_id": 26, "confus": 0.8},
                {"target_id": 25, "distractor_id": 4, "confus": 0.3},
            ]
        return []

    monkeypatch.setattr(tel.db, "query", fake_query)
    resp = client.get("/api/difficulty?dataset_version=v1")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["targets"]["25"] == {"difficulty": "hard", "n": 40}
    assert data["confusable"]["25"] == [26, 4]


def test_difficulty_empty_data_returns_empty_object(client, monkeypatch):
    monkeypatch.setattr(tel.db, "query", lambda *a, **k: [])
    resp = client.get("/api/difficulty?dataset_version=nope")
    assert resp.status_code == 200
    assert resp.get_json() == {}
