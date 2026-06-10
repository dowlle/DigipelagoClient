"""Sprite cutout recipe routes (Sprite Cutout Manager).

IP rule that shapes everything here: we never host or persist cutout bitmaps or
alpha masks (a silhouette mask IS the copyrighted shape). Only RECIPES are
stored: numbers + normalized seed coordinates. The cutout itself is recomputed
deterministically on the player's device by the client spriteEngine.

Routes:
- GET  /api/sprite-recipes?dataset_version=   -> approved recipes blob
- POST /api/sprite-recipes/submit             -> anonymous community proposal
- GET  /api/sprite-recipes/submissions        -> pending proposals (owner only)
- POST /api/sprite-recipes/approve            -> promote a proposal (owner only)
- POST /api/sprite-recipes/reject             -> dismiss a proposal (owner only)
- PUT  /api/sprite-recipes                    -> direct upsert (owner only)

Recipes are keyed (dataset_version, target_id) so they never bleed across
dataset rebuilds, mirroring the difficulty stats.
"""

import json
import re

from flask import Blueprint, current_app, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from .. import db
from ..auth_utils import current_user, login_required

bp = Blueprint("sprites", __name__)

limiter = Limiter(key_func=get_remote_address)


@bp.record_once
def _bind_limiter(state):
    limiter.init_app(state.app)


READ_LIMIT = "240 per minute"
SUBMIT_LIMIT = "30 per hour"

# Validation bounds for a community-submitted recipe.
MODES = ("cutout", "boxed", "raw")
TOLERANCE_MIN, TOLERANCE_MAX = 150, 254
FEATHER_MAX = 4
MAX_SEEDS = 16
MAX_NOTE_LEN = 500
KEY_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _is_owner() -> bool:
    """The logged-in user is the configured owner (empty config = nobody)."""
    owner_id = current_app.config.get("OWNER_DISCORD_ID", "")
    if not owner_id:
        return False
    user = current_user()
    return bool(user) and str(user.get("discord_id")) == str(owner_id)


def validate_recipe(raw) -> dict | None:
    """Sanity-check and normalize a recipe object. Returns the clean recipe
    dict, or None when the input is not a sane recipe. Unknown keys are
    dropped; all values are bounded so a hostile submission cannot smuggle
    arbitrary payloads into the approved blob."""
    if not isinstance(raw, dict):
        return None
    clean: dict = {}

    mode = raw.get("mode", "cutout")
    if mode not in MODES:
        return None
    if mode != "cutout":
        clean["mode"] = mode

    if "tolerance" in raw and raw["tolerance"] is not None:
        tol = raw["tolerance"]
        if not isinstance(tol, (int, float)) or isinstance(tol, bool):
            return None
        tol = int(tol)
        if not TOLERANCE_MIN <= tol <= TOLERANCE_MAX:
            return None
        clean["tolerance"] = tol

    if "borderSeeds" in raw and raw["borderSeeds"] is not None:
        if not isinstance(raw["borderSeeds"], bool):
            return None
        clean["borderSeeds"] = raw["borderSeeds"]

    if "feather" in raw and raw["feather"] is not None:
        f = raw["feather"]
        if not isinstance(f, (int, float)) or isinstance(f, bool):
            return None
        f = int(f)
        if not 0 <= f <= FEATHER_MAX:
            return None
        clean["feather"] = f

    if "keyColor" in raw and raw["keyColor"] is not None:
        kc = raw["keyColor"]
        if not isinstance(kc, str) or not KEY_COLOR_RE.match(kc):
            return None
        clean["keyColor"] = kc.lower()

    if "seeds" in raw and raw["seeds"] is not None:
        seeds = raw["seeds"]
        if not isinstance(seeds, list) or len(seeds) > MAX_SEEDS:
            return None
        clean_seeds = []
        for s in seeds:
            if not isinstance(s, dict):
                return None
            x, y = s.get("x"), s.get("y")
            if not isinstance(x, (int, float)) or isinstance(x, bool):
                return None
            if not isinstance(y, (int, float)) or isinstance(y, bool):
                return None
            if not (0.0 <= float(x) <= 1.0 and 0.0 <= float(y) <= 1.0):
                return None
            clean_seeds.append({"x": round(float(x), 4), "y": round(float(y), 4)})
        if clean_seeds:
            clean["seeds"] = clean_seeds

    # A recipe that changes nothing (mode cutout, no overrides) is not useful,
    # but it is harmless; accept it so "reset to default" can be submitted.
    return clean


def _as_int(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


# --- routes ------------------------------------------------------------------

@bp.route("/sprite-recipes", methods=["GET"])
@limiter.limit(READ_LIMIT)
def get_recipes():
    """Approved recipe blob for one dataset version: {"<target_id>": recipe}.
    Returns {} when there is no data (the client falls back to engine defaults)."""
    dataset_version = request.args.get("dataset_version", "").strip()
    if not dataset_version:
        return jsonify({}), 200

    rows = db.query(
        "SELECT target_id, recipe FROM sprite_recipes WHERE dataset_version = %s",
        (dataset_version,),
        fetch="all",
    )
    if not rows:
        return jsonify({}), 200
    out = {}
    for row in rows:
        tid, recipe = row.get("target_id"), row.get("recipe")
        if tid is None or not isinstance(recipe, dict):
            continue
        out[str(tid)] = recipe
    return jsonify({"recipes": out}), 200


@bp.route("/sprite-recipes/submit", methods=["POST"])
@limiter.limit(SUBMIT_LIMIT)
def submit_recipe():
    """Anonymous community recipe proposal. Stored append-only for review."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "invalid_body"}), 400

    dataset_version = body.get("dataset_version")
    if not isinstance(dataset_version, str) or not dataset_version.strip():
        return jsonify({"error": "invalid_dataset_version"}), 400
    target_id = _as_int(body.get("target_id"))
    if target_id is None:
        return jsonify({"error": "invalid_target_id"}), 400
    recipe = validate_recipe(body.get("recipe"))
    if recipe is None:
        return jsonify({"error": "invalid_recipe"}), 400

    who = body.get("who")
    who = who.strip()[:64] if isinstance(who, str) and who.strip() else None
    note = body.get("note")
    note = note.strip()[:MAX_NOTE_LEN] if isinstance(note, str) and note.strip() else None

    db.query(
        """
        INSERT INTO sprite_recipe_submissions
            (who, dataset_version, target_id, recipe, note)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (who, dataset_version.strip(), target_id, json.dumps(recipe), note),
        fetch=None,
    )
    return jsonify({"ok": True}), 201


@bp.route("/sprite-recipes/submissions", methods=["GET"])
@login_required
def list_submissions():
    """Pending submissions (owner only), optionally filtered by target_id."""
    if not _is_owner():
        return jsonify({"error": "forbidden"}), 403
    dataset_version = request.args.get("dataset_version", "").strip()
    if not dataset_version:
        return jsonify({"submissions": []}), 200

    target_id = _as_int(request.args.get("target_id"))
    if target_id is not None:
        rows = db.query(
            """
            SELECT id, ts, who, target_id, recipe, note
            FROM sprite_recipe_submissions
            WHERE dataset_version = %s AND target_id = %s AND status = 'pending'
            ORDER BY ts DESC
            """,
            (dataset_version, target_id),
            fetch="all",
        )
    else:
        rows = db.query(
            """
            SELECT id, ts, who, target_id, recipe, note
            FROM sprite_recipe_submissions
            WHERE dataset_version = %s AND status = 'pending'
            ORDER BY ts DESC
            """,
            (dataset_version,),
            fetch="all",
        )
    subs = [
        {
            "id": r["id"],
            "ts": r["ts"].isoformat() if r.get("ts") else None,
            "who": r.get("who"),
            "target_id": r.get("target_id"),
            "recipe": r.get("recipe"),
            "note": r.get("note"),
        }
        for r in (rows or [])
    ]
    return jsonify({"submissions": subs}), 200


@bp.route("/sprite-recipes/approve", methods=["POST"])
@login_required
def approve_submission():
    """Promote a pending submission into the live sprite_recipes table."""
    if not _is_owner():
        return jsonify({"error": "forbidden"}), 403
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "invalid_body"}), 400
    sub_id = _as_int(body.get("id"))
    if sub_id is None:
        return jsonify({"error": "invalid_id"}), 400

    row = db.query(
        "SELECT id, dataset_version, target_id, recipe FROM sprite_recipe_submissions "
        "WHERE id = %s AND status = 'pending'",
        (sub_id,),
        fetch="one",
    )
    if not row:
        return jsonify({"error": "not_found"}), 404
    recipe = validate_recipe(row.get("recipe"))
    if recipe is None:
        return jsonify({"error": "invalid_recipe"}), 400

    db.query(
        """
        INSERT INTO sprite_recipes (dataset_version, target_id, recipe, updated_at)
        VALUES (%s, %s, %s, now())
        ON CONFLICT (dataset_version, target_id)
        DO UPDATE SET recipe = EXCLUDED.recipe, updated_at = now()
        """,
        (row["dataset_version"], row["target_id"], json.dumps(recipe)),
        fetch=None,
    )
    db.query(
        "UPDATE sprite_recipe_submissions SET status = 'approved' WHERE id = %s",
        (sub_id,),
        fetch=None,
    )
    return jsonify({"ok": True}), 200


@bp.route("/sprite-recipes/reject", methods=["POST"])
@login_required
def reject_submission():
    """Dismiss a pending submission (owner only)."""
    if not _is_owner():
        return jsonify({"error": "forbidden"}), 403
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "invalid_body"}), 400
    sub_id = _as_int(body.get("id"))
    if sub_id is None:
        return jsonify({"error": "invalid_id"}), 400
    row = db.query(
        "SELECT id FROM sprite_recipe_submissions WHERE id = %s AND status = 'pending'",
        (sub_id,),
        fetch="one",
    )
    if not row:
        return jsonify({"error": "not_found"}), 404
    db.query(
        "UPDATE sprite_recipe_submissions SET status = 'rejected' WHERE id = %s",
        (sub_id,),
        fetch=None,
    )
    return jsonify({"ok": True}), 200


@bp.route("/sprite-recipes", methods=["PUT"])
@login_required
def put_recipe():
    """Direct owner upsert (e.g. seeding the initial hand-tuned set from the
    tuner without the submit/approve round-trip)."""
    if not _is_owner():
        return jsonify({"error": "forbidden"}), 403
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "invalid_body"}), 400
    dataset_version = body.get("dataset_version")
    if not isinstance(dataset_version, str) or not dataset_version.strip():
        return jsonify({"error": "invalid_dataset_version"}), 400
    target_id = _as_int(body.get("target_id"))
    if target_id is None:
        return jsonify({"error": "invalid_target_id"}), 400
    recipe = validate_recipe(body.get("recipe"))
    if recipe is None:
        return jsonify({"error": "invalid_recipe"}), 400

    db.query(
        """
        INSERT INTO sprite_recipes (dataset_version, target_id, recipe, updated_at)
        VALUES (%s, %s, %s, now())
        ON CONFLICT (dataset_version, target_id)
        DO UPDATE SET recipe = EXCLUDED.recipe, updated_at = now()
        """,
        (dataset_version.strip(), target_id, json.dumps(recipe)),
        fetch=None,
    )
    return jsonify({"ok": True}), 200
