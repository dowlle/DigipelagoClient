"""Database access layer (psycopg 3 / PostgreSQL).

Provides:
- `get_conn()`     : context manager yielding a connection from DATABASE_URL,
                     committing on success and rolling back on exception.
- `query(...)`     : one-shot SQL helper with `fetch='all'|'one'|None`.
                     Rows come back as dicts (psycopg dict_row row factory).
- `init_db()`      : idempotent schema creation (CREATE TABLE IF NOT EXISTS +
                     ALTER ... ADD COLUMN IF NOT EXISTS). Safe to run at every
                     startup.

DATABASE_URL is read lazily from the environment at call time so that importing
this module never requires a live database.
"""

import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


@contextmanager
def get_conn():
    """Yield a psycopg connection. Commits on clean exit, rolls back on error.

    Usage:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(...)
    """
    conn = psycopg.connect(_database_url(), row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def query(sql: str, params: tuple = (), fetch: str | None = "all"):
    """Execute one statement and optionally return rows.

    Args:
        sql:    SQL text with %s placeholders.
        params: sequence of parameters (use a tuple, even for one value).
        fetch:  'all'  -> list[dict] (possibly empty)
                'one'  -> dict | None
                None   -> None (for INSERT/UPDATE/DELETE/DDL)

    The surrounding `get_conn()` context manager handles commit/rollback.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            if fetch == "all":
                return cur.fetchall()
            if fetch == "one":
                return cur.fetchone()
            return None


# --- Schema ------------------------------------------------------------------

# Each statement is idempotent. Ordered so that foreign-key targets exist first.
_SCHEMA_STATEMENTS = (
    # users
    """
    CREATE TABLE IF NOT EXISTS users (
        id          serial PRIMARY KEY,
        discord_id  text UNIQUE NOT NULL,
        username    text,
        avatar      text,
        created_at  timestamptz DEFAULT now(),
        last_seen   timestamptz
    )
    """,
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS username text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now()",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen timestamptz",
    # unlocked_themes
    """
    CREATE TABLE IF NOT EXISTS unlocked_themes (
        user_id     int REFERENCES users(id) ON DELETE CASCADE,
        theme_id    text,
        unlocked_at timestamptz DEFAULT now(),
        PRIMARY KEY (user_id, theme_id)
    )
    """,
    "ALTER TABLE unlocked_themes ADD COLUMN IF NOT EXISTS unlocked_at timestamptz DEFAULT now()",
    # saved_connections
    """
    CREATE TABLE IF NOT EXISTS saved_connections (
        id           serial PRIMARY KEY,
        user_id      int REFERENCES users(id) ON DELETE CASCADE,
        label        text,
        server       text,
        port         int,
        slot_name    text,
        password_enc bytea,
        created_at   timestamptz DEFAULT now(),
        updated_at   timestamptz DEFAULT now()
    )
    """,
    "ALTER TABLE saved_connections ADD COLUMN IF NOT EXISTS label text",
    "ALTER TABLE saved_connections ADD COLUMN IF NOT EXISTS server text",
    "ALTER TABLE saved_connections ADD COLUMN IF NOT EXISTS port int",
    "ALTER TABLE saved_connections ADD COLUMN IF NOT EXISTS slot_name text",
    "ALTER TABLE saved_connections ADD COLUMN IF NOT EXISTS password_enc bytea",
    "ALTER TABLE saved_connections ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now()",
    "ALTER TABLE saved_connections ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()",
    # rounds
    """
    CREATE TABLE IF NOT EXISTS rounds (
        id              bigserial PRIMARY KEY,
        ts              timestamptz DEFAULT now(),
        dataset_version text NOT NULL,
        who             text,
        target_id       int NOT NULL,
        mode            text,
        difficulty      text,
        correct         boolean,
        picked_id       int,
        ms              int
    )
    """,
    "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ts timestamptz DEFAULT now()",
    "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS who text",
    "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS mode text",
    "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS difficulty text",
    "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS correct boolean",
    "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS picked_id int",
    "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ms int",
    # round_options
    """
    CREATE TABLE IF NOT EXISTS round_options (
        round_id   bigint REFERENCES rounds(id) ON DELETE CASCADE,
        option_id  int,
        was_wrong  boolean
    )
    """,
    "ALTER TABLE round_options ADD COLUMN IF NOT EXISTS was_wrong boolean",
    # events
    """
    CREATE TABLE IF NOT EXISTS events (
        id              bigserial PRIMARY KEY,
        ts              timestamptz DEFAULT now(),
        dataset_version text,
        who             text,
        event_type      text NOT NULL,
        payload         jsonb
    )
    """,
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS ts timestamptz DEFAULT now()",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS dataset_version text",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS who text",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS payload jsonb",
    # target_stats
    """
    CREATE TABLE IF NOT EXISTS target_stats (
        dataset_version text,
        target_id       int,
        n               int,
        fail_rate       real,
        median_ms       int,
        difficulty      text,
        PRIMARY KEY (dataset_version, target_id)
    )
    """,
    "ALTER TABLE target_stats ADD COLUMN IF NOT EXISTS n int",
    "ALTER TABLE target_stats ADD COLUMN IF NOT EXISTS fail_rate real",
    "ALTER TABLE target_stats ADD COLUMN IF NOT EXISTS median_ms int",
    "ALTER TABLE target_stats ADD COLUMN IF NOT EXISTS difficulty text",
    # pair_stats
    """
    CREATE TABLE IF NOT EXISTS pair_stats (
        dataset_version text,
        target_id       int,
        distractor_id   int,
        n_shown         int,
        n_wrong         int,
        confus          real,
        PRIMARY KEY (dataset_version, target_id, distractor_id)
    )
    """,
    "ALTER TABLE pair_stats ADD COLUMN IF NOT EXISTS n_shown int",
    "ALTER TABLE pair_stats ADD COLUMN IF NOT EXISTS n_wrong int",
    "ALTER TABLE pair_stats ADD COLUMN IF NOT EXISTS confus real",
)


def init_db() -> None:
    """Create/upgrade all tables idempotently. Safe to call on every boot."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            for stmt in _SCHEMA_STATEMENTS:
                cur.execute(stmt)
