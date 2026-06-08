"""Telemetry ingest + difficulty serving routes.

Anonymous (no login) endpoints used by the Digipelago client to:

- POST /api/telemetry/rounds  -- batch-ingest played rounds (+ shown options)
- POST /api/telemetry/events  -- batch-ingest allow-listed client events
- GET  /api/difficulty        -- serve per-target / per-pair difficulty stats

Hardening:
- Every endpoint is rate limited (flask-limiter). A dedicated limiter is bound
  to the app when this blueprint registers; it inherits the app's configured
  storage backend, and the app-wide default limit still applies on top.
- Batch payloads are capped (`MAX_BATCH`) to bound a single request's work.
- Event types are checked against an allow-list; unknown types are rejected and
  no raw free text is persisted (only the structured `payload` object).
"""

import json

from flask import Blueprint, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from .. import db

bp = Blueprint("telemetry", __name__)

# Dedicated limiter for the telemetry namespace. It is bound to the Flask app
# in `_bind_limiter` (below) at blueprint-registration time, so it transparently
# picks up RATELIMIT_STORAGE_URI from the app config. The app-wide default limit
# from create_app() continues to apply in addition to these explicit limits.
limiter = Limiter(key_func=get_remote_address)


@bp.record_once
def _bind_limiter(state):
    """Attach the telemetry limiter to the app when the blueprint registers."""
    limiter.init_app(state.app)


# Maximum number of records accepted in a single batch request.
MAX_BATCH = 200

# Explicit per-endpoint write limit (in addition to the app-wide default).
INGEST_LIMIT = "120 per minute"
READ_LIMIT = "240 per minute"

# Allowed event_type values. Anything else is rejected; we never store raw
# free-text event names.
ALLOWED_EVENT_TYPES = frozenset(
    {
        "session_start",
        "session_end",
        "catch",
        "stamina_blocked",
        "food_eaten",
        "locked_guess",
        "unknown_guess",
        "mode_switch",
        "give_up",
        "connect_result",
        "palette_switch",
        "dex_open",
        "sprite_error",
        "login",
        "theme_unlock",
    }
)


# --- helpers -----------------------------------------------------------------

def _json_batch():
    """Parse the request body and return a list of record dicts.

    Accepts either a bare JSON array, or an object wrapping the array under a
    "rounds"/"events"/"records"/"batch"/"items" key. Returns (records, error)
    where `error` is a (response, status) tuple on failure, else None.
    """
    data = request.get_json(silent=True)
    if data is None:
        return None, (jsonify({"error": "invalid_json"}), 400)

    if isinstance(data, dict):
        records = None
        for key in ("rounds", "events", "records", "batch", "items"):
            if key in data:
                records = data[key]
                break
        if records is None:
            return None, (jsonify({"error": "invalid_batch"}), 400)
    else:
        records = data

    if not isinstance(records, list):
        return None, (jsonify({"error": "invalid_batch"}), 400)

    if len(records) > MAX_BATCH:
        return None, (
            jsonify(
                {
                    "error": "batch_too_large",
                    "detail": f"max {MAX_BATCH} records per request",
                }
            ),
            413,
        )

    return records, None


def _as_int(value):
    """Coerce to int, or None if not a finite integer-ish value."""
    if isinstance(value, bool):  # bool is a subclass of int; reject it here
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except (ValueError, AttributeError):
            return None
    return None


def _as_bool(value):
    """Coerce to bool, or None when absent/unrecognised."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ("1", "true", "yes", "on"):
            return True
        if v in ("0", "false", "no", "off"):
            return False
    return None


def _as_str(value):
    """Return a trimmed string for scalar inputs, else None."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return None


# --- routes ------------------------------------------------------------------

@bp.route("/telemetry/rounds", methods=["POST"])
@limiter.limit(INGEST_LIMIT)
def post_rounds():
    """Ingest a batch of played rounds (+ their shown options).

    Each record may contain:
        dataset_version (required), who, target_id (required), options[],
        picked_id, correct, ms, mode, difficulty, wrong_ids[].

    For every round we insert one `rounds` row and one `round_options` row per
    shown option, with `was_wrong` set for options in `wrong_ids`.
    """
    records, err = _json_batch()
    if err is not None:
        return err

    inserted = 0
    skipped = 0

    with db.get_conn() as conn:
        with conn.cursor() as cur:
            for rec in records:
                if not isinstance(rec, dict):
                    skipped += 1
                    continue

                dataset_version = _as_str(rec.get("dataset_version"))
                target_id = _as_int(rec.get("target_id"))
                # dataset_version and target_id are NOT NULL in the schema.
                if not dataset_version or target_id is None:
                    skipped += 1
                    continue

                who = _as_str(rec.get("who"))
                mode = _as_str(rec.get("mode"))
                difficulty = _as_str(rec.get("difficulty"))
                correct = _as_bool(rec.get("correct"))
                picked_id = _as_int(rec.get("picked_id"))
                ms = _as_int(rec.get("ms"))

                cur.execute(
                    """
                    INSERT INTO rounds
                        (dataset_version, who, target_id, mode, difficulty,
                         correct, picked_id, ms)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        dataset_version,
                        who,
                        target_id,
                        mode,
                        difficulty,
                        correct,
                        picked_id,
                        ms,
                    ),
                )
                round_id = cur.fetchone()["id"]
                inserted += 1

                options = rec.get("options")
                if not isinstance(options, list):
                    options = []

                wrong_ids = rec.get("wrong_ids")
                wrong_set = set()
                if isinstance(wrong_ids, list):
                    for w in wrong_ids:
                        wid = _as_int(w)
                        if wid is not None:
                            wrong_set.add(wid)

                for opt in options:
                    option_id = _as_int(opt)
                    if option_id is None:
                        continue
                    cur.execute(
                        """
                        INSERT INTO round_options (round_id, option_id, was_wrong)
                        VALUES (%s, %s, %s)
                        """,
                        (round_id, option_id, option_id in wrong_set),
                    )

    return jsonify({"inserted": inserted, "skipped": skipped}), 201


@bp.route("/telemetry/events", methods=["POST"])
@limiter.limit(INGEST_LIMIT)
def post_events():
    """Ingest a batch of allow-listed client events.

    Each record may contain:
        dataset_version, who, event_type (required, allow-listed), payload.

    Unknown `event_type` values are rejected. Only the structured `payload`
    object is stored (as jsonb); no raw free-text event name is persisted.
    """
    records, err = _json_batch()
    if err is not None:
        return err

    inserted = 0
    skipped = 0
    rejected = 0

    with db.get_conn() as conn:
        with conn.cursor() as cur:
            for rec in records:
                if not isinstance(rec, dict):
                    skipped += 1
                    continue

                event_type = _as_str(rec.get("event_type"))
                if event_type is not None:
                    event_type = event_type.strip()

                # event_type is NOT NULL and must be on the allow-list.
                if not event_type or event_type not in ALLOWED_EVENT_TYPES:
                    rejected += 1
                    continue

                dataset_version = _as_str(rec.get("dataset_version"))
                who = _as_str(rec.get("who"))

                payload = rec.get("payload")
                # Only persist structured objects; anything else -> NULL so we
                # never store arbitrary free text in the payload column.
                if isinstance(payload, dict):
                    payload_json = json.dumps(payload)
                else:
                    payload_json = None

                cur.execute(
                    """
                    INSERT INTO events
                        (dataset_version, who, event_type, payload)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (dataset_version, who, event_type, payload_json),
                )
                inserted += 1

    return jsonify({"inserted": inserted, "skipped": skipped, "rejected": rejected}), 201


@bp.route("/difficulty", methods=["GET"])
@limiter.limit(READ_LIMIT)
def get_difficulty():
    """Serve per-target/per-pair difficulty stats for a dataset version.

    Query params:
        dataset_version (required) -- which dataset's stats to return.

    Returns:
        {"targets": {id: {"difficulty": str, "n": int}},
         "confusable": {id: [distractor_ids ordered by confusability]}}
        or {} when there is no data for the requested version.
    """
    dataset_version = request.args.get("dataset_version", "").strip()
    if not dataset_version:
        return jsonify({}), 200

    target_rows = db.query(
        """
        SELECT target_id, difficulty, n
        FROM target_stats
        WHERE dataset_version = %s
        """,
        (dataset_version,),
        fetch="all",
    )

    pair_rows = db.query(
        """
        SELECT target_id, distractor_id, confus
        FROM pair_stats
        WHERE dataset_version = %s
        ORDER BY target_id, confus DESC NULLS LAST, distractor_id
        """,
        (dataset_version,),
        fetch="all",
    )

    if not target_rows and not pair_rows:
        return jsonify({}), 200

    targets = {}
    for row in target_rows:
        tid = row.get("target_id")
        if tid is None:
            continue
        targets[str(tid)] = {
            "difficulty": row.get("difficulty"),
            "n": row.get("n"),
        }

    confusable = {}
    for row in pair_rows:
        tid = row.get("target_id")
        did = row.get("distractor_id")
        if tid is None or did is None:
            continue
        confusable.setdefault(str(tid), []).append(did)

    return jsonify({"targets": targets, "confusable": confusable}), 200
