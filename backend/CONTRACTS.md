# Digipelago backend contracts

Frozen helper signatures, JSON conventions, and the route contract. Blueprint
implementers MUST use these helpers and conventions verbatim so the four
blueprints stay consistent.

## Layout

```
backend/
  __init__.py
  config.py
  db.py
  crypto.py
  auth_utils.py
  app.py
  blueprints/
    __init__.py
    auth.py
    themes.py
    connections.py
    telemetry.py
  requirements.txt
  CONTRACTS.md
```

The React/Vite client stays at the repo ROOT. Flask serves the built `dist/`.

## config.py

```python
class Config:
    SECRET_KEY: str                 # env SECRET_KEY, default ""
    SESSION_COOKIE_NAME: str        # env, default "apie_session"
    SESSION_COOKIE_DOMAIN: str      # env, default "" (-> None in Flask config)
    SESSION_COOKIE_SECURE: bool     # env, default True
    SESSION_COOKIE_HTTPONLY: bool   # env, default True
    SESSION_COOKIE_SAMESITE: str    # env, default "Lax"
    DATABASE_URL: str               # env, default ""
    DISCORD_CLIENT_ID: str          # env, default ""
    DISCORD_CLIENT_SECRET: str      # env, default ""
    DISCORD_REDIRECT_URI: str       # env, default ""
    DIGIPELAGO_CRED_KEY: str        # env, default "" (Fernet key)
    FRONTEND_DIST: str              # env, default "../dist"
    RATELIMIT_DEFAULT: str          # env, default "200 per minute"
    RATELIMIT_STORAGE_URI: str      # env, default "memory://"

    def as_flask_config(self) -> dict: ...  # SECRET_KEY + SESSION_COOKIE_* for Flask
```

Class attributes are read from the environment at import time. `as_flask_config()`
maps an empty `SESSION_COOKIE_DOMAIN` to `None` (Flask's "current host only").

## db.py

```python
@contextmanager
def get_conn() -> psycopg.Connection:
    """Yield a psycopg3 connection (row_factory=dict_row) from DATABASE_URL.
    Commits on clean exit, rolls back on exception, always closes."""

def query(sql: str, params: tuple = (), fetch: str | None = "all"):
    """fetch='all' -> list[dict]; 'one' -> dict | None; None -> None.
    Params is a tuple even for a single value: (val,)."""

def init_db() -> None:
    """Idempotently CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS
    for every table. Safe to call at every startup."""
```

Rows are dicts. Always pass parameters via `%s` placeholders + the `params`
tuple — never string-format SQL.

### Tables
`users`, `unlocked_themes`, `saved_connections`, `rounds`, `round_options`,
`events`, `target_stats`, `pair_stats` (full DDL in `db.py::_SCHEMA_STATEMENTS`).

## crypto.py

```python
def encrypt(plaintext: str) -> bytes:
    """Fernet token (bytes) for a bytea column. Key = DIGIPELAGO_CRED_KEY."""

def decrypt(token: bytes) -> str:
    """Decrypt a Fernet token (accepts bytes / memoryview / str)."""
```

Store the result of `encrypt()` directly into `saved_connections.password_enc`
(bytea). When reading, pass the column value straight to `decrypt()`.

## auth_utils.py

```python
def current_user() -> dict | None:
    """users row for session['discord_id'], or None if absent/unknown."""

def login_required(fn):
    """Decorator. Returns ({"error": "unauthorized"}, 401) when not authed,
    otherwise calls the view. The view re-reads current_user() if it needs the row."""
```

Login state = `session['discord_id']` set by the OAuth callback.

## app.py

```python
def create_app() -> Flask:
    """Load Config, init flask-limiter, call init_db() (guarded), register the
    four blueprints under /api, add GET /api/health, JSON error handlers, and a
    SPA catch-all serving FRONTEND_DIST."""
```

- `init_db()` failures at boot are logged and swallowed (process still starts).
- `GET /api/health` -> 200 `{"status":"ok"}`; 503 `{"status":"error","db":...}` on DB error.
- Catch-all never serves `/api/*` (those 404 as JSON).

## JSON + error conventions

- Success: return a JSON object (or list) with an explicit status code
  (`return jsonify(payload), 200`). Use 201 for resource creation, 204 for
  delete (empty body).
- Errors: `{"error": "<machine_code>"}` plus optional `"detail"`, with the
  matching HTTP status. Use snake_case machine codes.
- Standard codes used by handlers in `app.py`:
  - 401 `{"error": "unauthorized"}` — not logged in (`login_required`).
  - 404 `{"error": "not_found"}` — unknown resource / unmatched API path.
  - 501 `{"error": "not_implemented"}` — `raise NotImplementedError` (current stubs).
  - 4xx HTTPException — `{"error": <name>, "detail": <description>}`.
  - 500 `{"error": "internal_server_error"}` — unhandled exception (logged).
- Auth-scoped resources (themes, connections) MUST filter by
  `current_user()['id']` and 404 (not 403) when a row exists but isn't owned by
  the caller, to avoid leaking existence.

## Route contract (all under /api)

| Method | Path | Blueprint |
|---|---|---|
| GET | /api/auth/login | auth |
| GET | /api/auth/callback | auth |
| POST | /api/auth/logout | auth |
| GET | /api/me | auth |
| GET | /api/me/themes | themes |
| PUT | /api/me/themes | themes |
| GET | /api/me/connections | connections |
| POST | /api/me/connections | connections |
| GET | /api/me/connections/<int:id>/secret | connections |
| DELETE | /api/me/connections/<int:id> | connections |
| POST | /api/telemetry/rounds | telemetry |
| POST | /api/telemetry/events | telemetry |
| GET | /api/difficulty | telemetry |
| GET | /api/health | app.py |
