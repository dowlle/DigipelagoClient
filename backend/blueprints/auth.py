"""Discord OAuth2 + session routes.

Auth flow:

  GET  /api/auth/login    -> redirect to Discord's authorize URL (scope
                             'identify'), after stashing a CSRF `state` in the
                             signed session cookie.
  GET  /api/auth/callback -> verify `state`, exchange `code` for an access
                             token, fetch the Discord user, UPSERT into `users`
                             (refreshing username/avatar/last_seen on every
                             login), store `discord_id` in the session, and
                             redirect to '/'.
  POST /api/auth/logout   -> clear the session.
  GET  /api/me            -> {discord_id, username, avatar} for the logged-in
                             user, or null.

Secrets (client id/secret, redirect URI) come exclusively from `Config`; nothing
is hardcoded here.
"""

import secrets

import requests
from flask import Blueprint, current_app, jsonify, redirect, request, session

from ..config import Config
from ..auth_utils import current_user
from .. import db

bp = Blueprint("auth", __name__)

cfg = Config()

# Discord OAuth2 / API endpoints.
DISCORD_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize"
DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_USER_URL = "https://discord.com/api/users/@me"

# OAuth scope: just enough to read the user's id/username/avatar.
OAUTH_SCOPE = "identify"

# Session key holding the per-request CSRF state during the OAuth round-trip.
_STATE_KEY = "oauth_state"

# Network timeout (seconds) for the two outbound Discord calls.
_HTTP_TIMEOUT = 10


@bp.route("/auth/login", methods=["GET"])
def login():
    """Redirect the browser to Discord's OAuth2 authorize URL.

    Generates a CSRF `state`, stores it in the session, and bounces the user to
    Discord. Discord will redirect back to DISCORD_REDIRECT_URI with `code` and
    `state` query params.
    """
    state = secrets.token_urlsafe(32)
    session[_STATE_KEY] = state

    params = {
        "client_id": cfg.DISCORD_CLIENT_ID,
        "redirect_uri": cfg.DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": OAUTH_SCOPE,
        "state": state,
        # Always show the consent screen so the active account is unambiguous.
        "prompt": "consent",
    }
    url = requests.Request(
        "GET", DISCORD_AUTHORIZE_URL, params=params
    ).prepare().url
    return redirect(url)


@bp.route("/auth/callback", methods=["GET"])
def callback():
    """Handle Discord's redirect: verify state, exchange code, upsert, log in."""
    error = request.args.get("error")
    if error:
        return jsonify({"error": "oauth_denied", "detail": error}), 400

    state = request.args.get("state")
    expected = session.pop(_STATE_KEY, None)
    if not state or not expected or not secrets.compare_digest(state, expected):
        return jsonify({"error": "invalid_state"}), 400

    code = request.args.get("code")
    if not code:
        return jsonify({"error": "missing_code"}), 400

    # --- Exchange the authorization code for an access token ----------------
    token_data = {
        "client_id": cfg.DISCORD_CLIENT_ID,
        "client_secret": cfg.DISCORD_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg.DISCORD_REDIRECT_URI,
    }
    try:
        token_resp = requests.post(
            DISCORD_TOKEN_URL,
            data=token_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=_HTTP_TIMEOUT,
        )
        token_resp.raise_for_status()
        access_token = token_resp.json().get("access_token")
    except requests.RequestException:
        return jsonify({"error": "token_exchange_failed"}), 502

    if not access_token:
        return jsonify({"error": "token_exchange_failed"}), 502

    # --- Fetch the Discord user profile -------------------------------------
    try:
        user_resp = requests.get(
            DISCORD_USER_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=_HTTP_TIMEOUT,
        )
        user_resp.raise_for_status()
        discord_user = user_resp.json()
    except requests.RequestException:
        return jsonify({"error": "userinfo_failed"}), 502

    discord_id = discord_user.get("id")
    if not discord_id:
        return jsonify({"error": "userinfo_failed"}), 502

    # Discord moved most accounts to the unique-username model: prefer
    # `username`, but keep the legacy discriminator suffix if one is present.
    username = discord_user.get("username")
    discriminator = discord_user.get("discriminator")
    if username and discriminator and discriminator != "0":
        username = f"{username}#{discriminator}"
    avatar = discord_user.get("avatar")

    # --- UPSERT the user, refreshing profile + last_seen on every login -----
    db.query(
        """
        INSERT INTO users (discord_id, username, avatar, last_seen)
        VALUES (%s, %s, %s, now())
        ON CONFLICT (discord_id) DO UPDATE
            SET username  = EXCLUDED.username,
                avatar    = EXCLUDED.avatar,
                last_seen = now()
        """,
        (str(discord_id), username, avatar),
        fetch=None,
    )

    # --- Establish the session ----------------------------------------------
    session["discord_id"] = str(discord_id)
    return redirect("/")


@bp.route("/auth/logout", methods=["POST"])
def logout():
    """Clear the session cookie and report success."""
    session.clear()
    return jsonify({"ok": True}), 200


@bp.route("/me", methods=["GET"])
def me():
    """Return the current user's public profile, or null when not logged in."""
    user = current_user()
    if user is None:
        return jsonify(None), 200
    owner_id = current_app.config.get("OWNER_DISCORD_ID", "")
    return (
        jsonify(
            {
                "discord_id": user["discord_id"],
                "username": user["username"],
                "avatar": user["avatar"],
                # Gates the in-app sprite-recipe review surface only; every
                # privileged route re-checks server-side.
                "is_owner": bool(owner_id) and str(user["discord_id"]) == str(owner_id),
            }
        ),
        200,
    )
