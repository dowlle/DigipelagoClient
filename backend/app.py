"""Application factory.

`create_app()` wires config, rate limiting, the schema bootstrap, the four API
blueprints (under /api), JSON error handlers, a health probe, and a SPA
catch-all that serves the built Vite `dist/`.

The factory is deliberately resilient to a missing/unreachable database: schema
init failures are logged and swallowed so the process still boots (and
`/api/health` reports 503), rather than crash-looping the container.
"""

import logging
import os

from flask import Flask, jsonify, send_from_directory
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.exceptions import HTTPException

from . import db
from .config import Config
from .blueprints.auth import bp as auth_bp
from .blueprints.themes import bp as themes_bp
from .blueprints.connections import bp as connections_bp
from .blueprints.telemetry import bp as telemetry_bp

log = logging.getLogger("digipelago")


def _resolve_dist(frontend_dist: str) -> str:
    """Resolve FRONTEND_DIST to an absolute path (relative -> to backend/)."""
    if os.path.isabs(frontend_dist):
        return frontend_dist
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, frontend_dist))


def create_app() -> Flask:
    cfg = Config()
    app = Flask(__name__, static_folder=None)
    app.config.update(cfg.as_flask_config())

    dist_dir = _resolve_dist(cfg.FRONTEND_DIST)

    # --- Rate limiting -------------------------------------------------------
    Limiter(
        key_func=get_remote_address,
        app=app,
        default_limits=[cfg.RATELIMIT_DEFAULT],
        storage_uri=cfg.RATELIMIT_STORAGE_URI,
    )

    # --- Schema bootstrap (never crash import/boot if DB is down) ------------
    try:
        db.init_db()
    except Exception as exc:  # noqa: BLE001 - boot must survive a down DB
        log.warning("init_db() skipped at startup: %s", exc)

    # --- API blueprints (all under /api) ------------------------------------
    app.register_blueprint(auth_bp, url_prefix="/api")
    app.register_blueprint(themes_bp, url_prefix="/api")
    app.register_blueprint(connections_bp, url_prefix="/api")
    app.register_blueprint(telemetry_bp, url_prefix="/api")

    # --- Health probe --------------------------------------------------------
    @app.route("/api/health", methods=["GET"])
    def health():
        try:
            db.query("SELECT 1", fetch="one")
        except Exception as exc:  # noqa: BLE001
            return jsonify({"status": "error", "db": str(exc)}), 503
        return jsonify({"status": "ok"}), 200

    # --- JSON error handlers -------------------------------------------------
    @app.errorhandler(NotImplementedError)
    def _not_implemented(_exc):
        return jsonify({"error": "not_implemented"}), 501

    @app.errorhandler(HTTPException)
    def _http_exc(exc: HTTPException):
        return jsonify({"error": exc.name, "detail": exc.description}), exc.code

    @app.errorhandler(Exception)
    def _unhandled(exc: Exception):  # noqa: BLE001
        log.exception("Unhandled error: %s", exc)
        return jsonify({"error": "internal_server_error"}), 500

    # --- SPA catch-all (serve built client) ----------------------------------
    @app.route("/", defaults={"path": ""}, methods=["GET"])
    @app.route("/<path:path>", methods=["GET"])
    def spa(path: str):
        # Never let the catch-all shadow the API namespace.
        if path.startswith("api/"):
            return jsonify({"error": "not_found"}), 404
        candidate = os.path.join(dist_dir, path)
        if path and os.path.isfile(candidate):
            return send_from_directory(dist_dir, path)
        return send_from_directory(dist_dir, "index.html")

    return app
