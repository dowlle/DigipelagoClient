"""Application configuration.

A single `Config` class reads all settings from environment variables so the
same image runs in dev, CI and production with only `.env` differing. Defaults
are chosen to be safe-by-default (secure, httponly, lax cookies).
"""

import os


def _bool_env(name: str, default: bool) -> bool:
    """Parse a boolean-ish env var. Accepts 1/true/yes/on (case-insensitive)."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


class Config:
    """Central config object. Instantiate once per app and read attributes.

    Also exposes the values Flask itself looks up (SECRET_KEY, SESSION_COOKIE_*)
    as UPPERCASE attributes so `app.config.from_object(Config())` wires them in.
    """

    # --- Core / session ---
    SECRET_KEY = os.environ.get("SECRET_KEY", "")
    SESSION_COOKIE_NAME = os.environ.get("SESSION_COOKIE_NAME", "apie_session")
    SESSION_COOKIE_DOMAIN = os.environ.get("SESSION_COOKIE_DOMAIN", "")
    SESSION_COOKIE_SECURE = _bool_env("SESSION_COOKIE_SECURE", True)
    SESSION_COOKIE_HTTPONLY = _bool_env("SESSION_COOKIE_HTTPONLY", True)
    SESSION_COOKIE_SAMESITE = os.environ.get("SESSION_COOKIE_SAMESITE", "Lax")

    # --- Database ---
    DATABASE_URL = os.environ.get("DATABASE_URL", "")

    # --- Discord OAuth2 ---
    DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
    DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
    DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "")

    # --- Credential encryption (Fernet key, urlsafe base64, 32 bytes) ---
    DIGIPELAGO_CRED_KEY = os.environ.get("DIGIPELAGO_CRED_KEY", "")

    # --- Owner (sprite-recipe review) ---
    # Discord id whose login may review/approve sprite-recipe submissions.
    # Empty (the default) means nobody is owner.
    OWNER_DISCORD_ID = os.environ.get("OWNER_DISCORD_ID", "")

    # --- Static frontend ---
    # Path (relative to this file's parent, or absolute) to the built Vite dist/.
    FRONTEND_DIST = os.environ.get("FRONTEND_DIST", "../dist")

    # --- Rate limiting (flask-limiter default limit string) ---
    RATELIMIT_DEFAULT = os.environ.get("RATELIMIT_DEFAULT", "200 per minute")
    # Storage backend for limiter counters. memory:// is fine for a single
    # gunicorn worker; point at redis:// for multi-worker deployments.
    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")

    def as_flask_config(self) -> dict:
        """Return the subset of settings Flask reads directly, as a dict."""
        return {
            "SECRET_KEY": self.SECRET_KEY,
            "SESSION_COOKIE_NAME": self.SESSION_COOKIE_NAME,
            # Flask wants None (not "") to mean "current host only".
            "SESSION_COOKIE_DOMAIN": self.SESSION_COOKIE_DOMAIN or None,
            "SESSION_COOKIE_SECURE": self.SESSION_COOKIE_SECURE,
            "SESSION_COOKIE_HTTPONLY": self.SESSION_COOKIE_HTTPONLY,
            "SESSION_COOKIE_SAMESITE": self.SESSION_COOKIE_SAMESITE,
        }
