"""Crowd-sourced perceived-difficulty aggregation (FEAT-03, backend half).

Reads the raw telemetry tables (`rounds`, `round_options`) and recomputes the
served difficulty-hint tables (`target_stats`, `pair_stats`) per dataset
version. The output is consumed only by `GET /api/difficulty` to *sharpen* the
client's multiple-choice distractors and bias target selection within an
already-chosen difficulty tier.

AP-beatability invariant: these are cosmetic/UX hints. Nothing here gates which
Digimon are catchable; the client always falls back to its heuristic when this
data is absent or the backend is unreachable.

Design: the heavy lifting lives in two PURE functions that take already-fetched
row dicts and return rows to upsert. They are unit-testable with hand-built
lists and need no database (mirrors the read path in `blueprints/telemetry.py`).
`aggregate_dataset()` is the only DB-touching wrapper; it is intentionally thin.

Aggregation model
-----------------
Targets (per dataset_version, target_id):
  - One observation per *named* session (`who`) contributes, capped at weight 1,
    so a single grinder/bot cannot skew a target. Anonymous rounds (who is None)
    cannot be deduped, so each counts as its own weight-1 observation.
  - `median_ms` is taken over response times after dropping None, <= 0, and
    absurd values (> MS_CAP).
  - The served fail rate is Bayesian-shrunk toward a prior `p0`:
        D(t) = (K * p0 + fails) / (K + n)
    With K pseudo-counts a target with n=1 stays near p0 (no ugly cold-start);
    as n grows D(t) -> raw fail rate.
  - D(t) is bucketed into 'easy' / 'normal' / 'hard' via two thresholds.

Pairs (per dataset_version, target_id, distractor_id):
  - n_shown = times the distractor appeared alongside the target,
    n_wrong = times that distractor was the wrong pick.
  - The served confusability is Bayesian-shrunk toward a low prior `pp`:
        confus = (KP * pp + n_wrong) / (KP + n_shown)
    so a distractor shown once-and-missed does not rocket to confus = 1.0.
"""

import statistics

# --- Tunable constants -------------------------------------------------------

# Target fail-rate shrinkage.
PRIOR = 0.5  # p0: prior fail rate for a brand-new target (safe MVP prior).
K = 8  # pseudo-counts pulling D(t) toward PRIOR at low n.

# Response-time anti-skew: drop ms that are None, <= 0, or above this cap.
MS_CAP = 120_000  # 2 minutes; anything longer is almost certainly idle/AFK.

# Tier thresholds on the shrunk fail rate D(t).
EASY_MAX = 0.34  # D(t) <= EASY_MAX            -> 'easy'
HARD_MIN = 0.55  # D(t) >= HARD_MIN            -> 'hard'
# (EASY_MAX < D(t) < HARD_MIN -> 'normal')

# Pair confusability shrinkage.
PAIR_PRIOR = 0.15  # pp: prior wrong-rate for a brand-new distractor.
PAIR_K = 4  # KP: pseudo-counts pulling confus toward PAIR_PRIOR at low n_shown.


# --- Pure functions (no DB) --------------------------------------------------

def tier_of(fail_rate: float) -> str:
    """Bucket a (shrunk) fail rate into an 'easy'/'normal'/'hard' tier."""
    if fail_rate <= EASY_MAX:
        return "easy"
    if fail_rate >= HARD_MIN:
        return "hard"
    return "normal"


def aggregate_targets(round_rows, *, prior: float = PRIOR, k: int = K):
    """Compute target_stats rows from raw `rounds` rows.

    Args:
        round_rows: iterable of dicts with at least:
            target_id (int), who (str | None), correct (bool | None), ms (int | None).
            Rows are assumed to already be scoped to ONE dataset_version.
        prior: p0, the cold-start fail rate a brand-new target shrinks toward.
        k:     pseudo-counts controlling how fast D(t) moves off the prior.

    Returns:
        list[dict] of {target_id, n, fail_rate, median_ms, difficulty}, where
        `fail_rate` is the Bayesian-shrunk D(t) and `difficulty` is its tier.

    Per-session weight cap: for a given target, at most one round per (who)
    contributes (the first seen, for determinism). who=None rounds cannot be
    attributed to a session, so each counts as an independent weight-1
    observation and is never collapsed.
    """
    # Accumulator per target_id.
    #   seen_who: set of named whos already counted (dedupe + weight cap)
    #   n, fails: weight-1 observation count and failures among them
    #   ms_values: surviving response times for the median
    acc = {}

    for row in round_rows:
        target_id = row.get("target_id")
        if target_id is None:
            continue

        bucket = acc.get(target_id)
        if bucket is None:
            bucket = {"seen_who": set(), "n": 0, "fails": 0, "ms_values": []}
            acc[target_id] = bucket

        who = row.get("who")
        # Per-session dedupe + weight cap. Named sessions count once; anonymous
        # (None) rounds each count as their own independent observation.
        if who is not None:
            if who in bucket["seen_who"]:
                continue
            bucket["seen_who"].add(who)

        bucket["n"] += 1
        # A failure is an explicit `correct is False`. None (unknown) is treated
        # as not-a-failure so partial/legacy rows don't inflate difficulty.
        if row.get("correct") is False:
            bucket["fails"] += 1

        ms = row.get("ms")
        if isinstance(ms, bool):  # bool is an int subclass; never a valid ms
            ms = None
        if isinstance(ms, (int, float)) and ms > 0 and ms <= MS_CAP:
            bucket["ms_values"].append(ms)

    results = []
    for target_id, bucket in acc.items():
        n = bucket["n"]
        fails = bucket["fails"]
        # Bayesian shrinkage toward the prior. With n=0 this is exactly p0.
        shrunk = (k * prior + fails) / (k + n)

        ms_values = bucket["ms_values"]
        median_ms = int(round(statistics.median(ms_values))) if ms_values else None

        results.append(
            {
                "target_id": target_id,
                "n": n,
                "fail_rate": shrunk,
                "median_ms": median_ms,
                "difficulty": tier_of(shrunk),
            }
        )

    return results


def aggregate_pairs(option_rows, *, prior: float = PAIR_PRIOR, k: int = PAIR_K):
    """Compute pair_stats rows from the round_options/rounds join.

    Args:
        option_rows: iterable of dicts with at least:
            target_id (int), option_id (int), was_wrong (bool | None).
            Rows are assumed to already be scoped to ONE dataset_version. The
            caller is expected to exclude the target itself (option_id ==
            target_id), but we defensively skip those here too.
        prior: pp, the cold-start wrong-rate a brand-new distractor shrinks toward.
        k:     pseudo-counts controlling how fast confus moves off the prior.

    Returns:
        list[dict] of {target_id, distractor_id, n_shown, n_wrong, confus},
        where `confus` is the Bayesian-shrunk wrong-rate.
    """
    acc = {}  # (target_id, distractor_id) -> {n_shown, n_wrong}

    for row in option_rows:
        target_id = row.get("target_id")
        distractor_id = row.get("option_id")
        if target_id is None or distractor_id is None:
            continue
        if distractor_id == target_id:  # the correct answer is not a distractor
            continue

        key = (target_id, distractor_id)
        bucket = acc.get(key)
        if bucket is None:
            bucket = {"n_shown": 0, "n_wrong": 0}
            acc[key] = bucket

        bucket["n_shown"] += 1
        if row.get("was_wrong") is True:
            bucket["n_wrong"] += 1

    results = []
    for (target_id, distractor_id), bucket in acc.items():
        n_shown = bucket["n_shown"]
        n_wrong = bucket["n_wrong"]
        confus = (k * prior + n_wrong) / (k + n_shown)
        results.append(
            {
                "target_id": target_id,
                "distractor_id": distractor_id,
                "n_shown": n_shown,
                "n_wrong": n_wrong,
                "confus": confus,
            }
        )

    return results


# --- Thin DB wrapper (NOT covered by the pure unit tests) --------------------

def aggregate_dataset(conn, dataset_version: str) -> dict:
    """Recompute and upsert target_stats + pair_stats for one dataset version.

    SELECTs the raw rounds and the round_options/rounds join for this version,
    runs the pure aggregators, then UPSERTs the results. Returns a small summary
    dict ({"targets": N, "pairs": M}) for the CLI to print.

    `conn` is a live psycopg connection (row_factory=dict_row), e.g. from
    `db.get_conn()`. This function is intentionally thin; all interesting logic
    lives in the pure functions above.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT target_id, who, correct, ms
            FROM rounds
            WHERE dataset_version = %s
            """,
            (dataset_version,),
        )
        round_rows = cur.fetchall()

        cur.execute(
            """
            SELECT r.target_id AS target_id,
                   o.option_id AS option_id,
                   o.was_wrong AS was_wrong
            FROM round_options o
            JOIN rounds r ON r.id = o.round_id
            WHERE r.dataset_version = %s
              AND o.option_id IS DISTINCT FROM r.target_id
            """,
            (dataset_version,),
        )
        option_rows = cur.fetchall()

        target_stats = aggregate_targets(round_rows)
        pair_stats = aggregate_pairs(option_rows)

        for t in target_stats:
            cur.execute(
                """
                INSERT INTO target_stats
                    (dataset_version, target_id, n, fail_rate, median_ms, difficulty)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (dataset_version, target_id) DO UPDATE SET
                    n         = EXCLUDED.n,
                    fail_rate = EXCLUDED.fail_rate,
                    median_ms = EXCLUDED.median_ms,
                    difficulty = EXCLUDED.difficulty
                """,
                (
                    dataset_version,
                    t["target_id"],
                    t["n"],
                    t["fail_rate"],
                    t["median_ms"],
                    t["difficulty"],
                ),
            )

        for p in pair_stats:
            cur.execute(
                """
                INSERT INTO pair_stats
                    (dataset_version, target_id, distractor_id, n_shown, n_wrong, confus)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (dataset_version, target_id, distractor_id) DO UPDATE SET
                    n_shown = EXCLUDED.n_shown,
                    n_wrong = EXCLUDED.n_wrong,
                    confus  = EXCLUDED.confus
                """,
                (
                    dataset_version,
                    p["target_id"],
                    p["distractor_id"],
                    p["n_shown"],
                    p["n_wrong"],
                    p["confus"],
                ),
            )

    return {"targets": len(target_stats), "pairs": len(pair_stats)}
