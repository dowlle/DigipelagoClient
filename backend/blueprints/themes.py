"""Unlocked-theme routes.

Theme-unlock sync for the logged-in user. The unlock set is monotonic: the
server never deletes an unlock, it only ever grows by UNION. This lets several
clients (different browsers/devices) converge on the union of everything each
of them has unlocked.

Routes (all under /api):
    GET  /api/me/themes  -> ["theme_a", "theme_b", ...]  (the caller's unlocks)
    PUT  /api/me/themes  {"unlocked": [...]} -> merged unlock list (UNION upsert)
"""

from flask import Blueprint, jsonify, request

from ..auth_utils import current_user, login_required
from .. import db

bp = Blueprint("themes", __name__)


def _unlocked_theme_ids(user_id: int) -> list:
    """Return the user's unlocked theme ids, sorted for a stable response."""
    rows = db.query(
        "SELECT theme_id FROM unlocked_themes WHERE user_id = %s ORDER BY theme_id",
        (user_id,),
        fetch="all",
    )
    return [r["theme_id"] for r in rows]


@bp.route("/me/themes", methods=["GET"])
@login_required
def list_themes():
    """Return the current user's unlocked theme ids as a JSON array."""
    user = current_user()
    return jsonify(_unlocked_theme_ids(user["id"])), 200


@bp.route("/me/themes", methods=["PUT"])
@login_required
def set_themes():
    """Idempotently UNION the posted theme ids into the user's unlock set.

    Body: {"unlocked": ["theme_a", ...]}. Only ever adds (union); server-side
    unlocks are never removed. Returns the merged list.
    """
    user = current_user()

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "invalid_body"}), 400

    unlocked = body.get("unlocked", [])
    if not isinstance(unlocked, list):
        return jsonify({"error": "invalid_unlocked"}), 400

    # Normalize: keep non-empty strings only, de-duplicate while preserving
    # the order in which they first appear.
    seen = set()
    theme_ids = []
    for item in unlocked:
        if not isinstance(item, str):
            return jsonify({"error": "invalid_theme_id"}), 400
        item = item.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        theme_ids.append(item)

    # UNION upsert: insert each id, ignore ones that already exist for the user
    # (the (user_id, theme_id) primary key makes ON CONFLICT a no-op). This is
    # idempotent and never deletes an existing unlock.
    for theme_id in theme_ids:
        db.query(
            "INSERT INTO unlocked_themes (user_id, theme_id) VALUES (%s, %s) "
            "ON CONFLICT (user_id, theme_id) DO NOTHING",
            (user["id"], theme_id),
            fetch=None,
        )

    return jsonify(_unlocked_theme_ids(user["id"])), 200
