"""Session/auth helpers shared by blueprints.

Auth model: a successful Discord OAuth callback stores the user's `discord_id`
in the signed Flask session cookie. `current_user()` resolves that to the
users row; `login_required` guards routes that need a logged-in user.
"""

from functools import wraps

from flask import jsonify, session

from . import db


def current_user() -> dict | None:
    """Return the logged-in user's row (dict) or None.

    Reads `discord_id` from the Flask session and looks it up in `users`.
    Returns None when there is no session or no matching row.
    """
    discord_id = session.get("discord_id")
    if not discord_id:
        return None
    return db.query(
        "SELECT * FROM users WHERE discord_id = %s",
        (discord_id,),
        fetch="one",
    )


def login_required(fn):
    """Decorator: respond 401 JSON unless a valid session user exists.

    On success, passes through to the wrapped view. The view can call
    `current_user()` itself to get the row.
    """

    @wraps(fn)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return jsonify({"error": "unauthorized"}), 401
        return fn(*args, **kwargs)

    return wrapper
