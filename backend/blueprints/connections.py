"""Saved Archipelago connection routes (encrypted slot passwords).

Owner-scoped CRUD over `saved_connections`. Every route is `login_required`
and filters by the current user's id, so one user can never see, read the
secret of, or delete another user's connection. Rows that exist but aren't
owned by the caller 404 (never 403) to avoid leaking their existence.

The slot password is optional (opt-in checkbox client-side). When present it
is stored encrypted in `password_enc` via `crypto.encrypt`; the list endpoint
NEVER returns it (only a `has_password` boolean). Plaintext passwords are
never logged.
"""

from flask import Blueprint, jsonify, request

from .. import crypto, db
from ..auth_utils import current_user, login_required

bp = Blueprint("connections", __name__)


def _serialize(row: dict) -> dict:
    """Public shape of a saved connection (never includes the password)."""
    return {
        "id": row["id"],
        "label": row["label"],
        "server": row["server"],
        "port": row["port"],
        "slot_name": row["slot_name"],
        "has_password": row["password_enc"] is not None,
    }


def _coerce_port(value):
    """Return an int port from JSON value, or None if missing/invalid."""
    if value is None:
        return None
    if isinstance(value, bool):  # bool is an int subclass; reject it explicitly
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped == "":
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    return None


@bp.route("/me/connections", methods=["GET"])
@login_required
def list_connections():
    """List the current user's saved connections (without secrets)."""
    user = current_user()
    rows = db.query(
        """
        SELECT id, label, server, port, slot_name, password_enc
        FROM saved_connections
        WHERE user_id = %s
        ORDER BY id
        """,
        (user["id"],),
        fetch="all",
    )
    return jsonify([_serialize(row) for row in rows]), 200


@bp.route("/me/connections", methods=["POST"])
@login_required
def create_connection():
    """Create a saved connection; encrypt the password into password_enc.

    Body: {label, server, port, slot_name, password?}. The password is only
    stored (encrypted) when the opt-in field is present and non-empty; the
    response echoes the created row without any secret.
    """
    user = current_user()
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "invalid_json"}), 400

    label = body.get("label")
    server = body.get("server")
    slot_name = body.get("slot_name")
    port = _coerce_port(body.get("port"))

    if not isinstance(server, str) or server.strip() == "":
        return jsonify({"error": "missing_server"}), 400
    if not isinstance(slot_name, str) or slot_name.strip() == "":
        return jsonify({"error": "missing_slot_name"}), 400
    if port is None:
        return jsonify({"error": "missing_port"}), 400

    # Opt-in password: only encrypt/store when actually provided.
    password = body.get("password")
    password_enc = None
    if isinstance(password, str) and password != "":
        password_enc = crypto.encrypt(password)

    row = db.query(
        """
        INSERT INTO saved_connections
            (user_id, label, server, port, slot_name, password_enc)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, label, server, port, slot_name, password_enc
        """,
        (user["id"], label, server, port, slot_name, password_enc),
        fetch="one",
    )
    return jsonify(_serialize(row)), 201


@bp.route("/me/connections/<int:id>/secret", methods=["GET"])
@login_required
def get_connection_secret(id):
    """Return the decrypted slot password for one owned connection."""
    user = current_user()
    row = db.query(
        """
        SELECT password_enc FROM saved_connections
        WHERE id = %s AND user_id = %s
        """,
        (id, user["id"]),
        fetch="one",
    )
    # 404 (not 403) when missing or not owned, so existence never leaks.
    if row is None:
        return jsonify({"error": "not_found"}), 404
    if row["password_enc"] is None:
        return jsonify({"password": None}), 200
    return jsonify({"password": crypto.decrypt(row["password_enc"])}), 200


@bp.route("/me/connections/<int:id>", methods=["DELETE"])
@login_required
def delete_connection(id):
    """Delete one owned connection."""
    user = current_user()
    deleted = db.query(
        """
        DELETE FROM saved_connections
        WHERE id = %s AND user_id = %s
        RETURNING id
        """,
        (id, user["id"]),
        fetch="one",
    )
    if deleted is None:
        return jsonify({"error": "not_found"}), 404
    return "", 204
