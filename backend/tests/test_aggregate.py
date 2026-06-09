"""Unit tests for the difficulty aggregation pure functions.

These exercise `aggregate_targets` / `aggregate_pairs` with hand-built row
lists and NO live database. As in `test_telemetry.py`, we provide a minimal
`psycopg` shim purely so importing `backend.db` (a transitive import of
`backend.aggregate`) does not require the real driver.

Run from the repo root:  python -m pytest backend/tests/test_aggregate.py
"""

import sys
import types

import pytest

# Minimal psycopg shim so `backend.db` imports without the real driver.
if "psycopg" not in sys.modules:
    _psycopg = types.ModuleType("psycopg")
    _psycopg.Connection = object

    def _no_connect(*args, **kwargs):  # pragma: no cover - never called in tests
        raise RuntimeError("psycopg.connect stubbed out in tests")

    _psycopg.connect = _no_connect
    _rows = types.ModuleType("psycopg.rows")
    _rows.dict_row = object
    _psycopg.rows = _rows
    sys.modules["psycopg"] = _psycopg
    sys.modules["psycopg.rows"] = _rows

from backend import aggregate as agg


def _by_target(rows):
    return {r["target_id"]: r for r in rows}


# --- shrinkage ---------------------------------------------------------------

def test_low_n_target_stays_near_prior():
    """A target with n=1 (even a single failure) stays close to p0."""
    rows = [{"target_id": 1, "who": "a", "correct": False, "ms": 1000}]
    out = _by_target(agg.aggregate_targets(rows))
    # D = (K*0.5 + 1) / (K + 1) = (8*0.5 + 1)/9 = 5/9 ~= 0.5556
    assert out[1]["n"] == 1
    assert out[1]["fail_rate"] == pytest.approx((agg.K * agg.PRIOR + 1) / (agg.K + 1))
    # raw fail rate here is 1.0; shrinkage must pull it well below that.
    assert out[1]["fail_rate"] < 0.6


def test_high_n_target_converges_to_raw_fail_rate():
    """With many observations, D(t) approaches the raw fail rate."""
    # 100 distinct named sessions, 80 of which failed -> raw fail rate 0.8.
    rows = []
    for i in range(100):
        rows.append(
            {
                "target_id": 7,
                "who": f"s{i}",
                "correct": i >= 80,  # first 80 are failures
                "ms": 1500,
            }
        )
    out = _by_target(agg.aggregate_targets(rows))
    assert out[7]["n"] == 100
    expected = (agg.K * agg.PRIOR + 80) / (agg.K + 100)
    assert out[7]["fail_rate"] == pytest.approx(expected)
    assert abs(out[7]["fail_rate"] - 0.8) < 0.03  # close to raw 0.8


def test_zero_observations_equals_prior_via_empty_input():
    """No rows -> no output (cold-start has nothing to upsert)."""
    assert agg.aggregate_targets([]) == []


# --- median_ms anti-skew -----------------------------------------------------

def test_absurd_zero_and_none_ms_excluded_from_median():
    rows = [
        {"target_id": 3, "who": "a", "correct": True, "ms": 1000},
        {"target_id": 3, "who": "b", "correct": True, "ms": 2000},
        {"target_id": 3, "who": "c", "correct": True, "ms": 3000},
        {"target_id": 3, "who": "d", "correct": True, "ms": None},  # dropped
        {"target_id": 3, "who": "e", "correct": True, "ms": 0},  # dropped
        {"target_id": 3, "who": "f", "correct": True, "ms": -50},  # dropped
        {"target_id": 3, "who": "g", "correct": True, "ms": agg.MS_CAP + 1},  # dropped
    ]
    out = _by_target(agg.aggregate_targets(rows))
    # median over survivors [1000, 2000, 3000] = 2000
    assert out[3]["median_ms"] == 2000
    # all 7 are still counted as observations for n / fail-rate purposes
    assert out[3]["n"] == 7


def test_median_none_when_no_surviving_ms():
    rows = [{"target_id": 9, "who": "a", "correct": True, "ms": None}]
    out = _by_target(agg.aggregate_targets(rows))
    assert out[9]["median_ms"] is None


# --- per-session dedupe + weight cap -----------------------------------------

def test_named_session_capped_to_weight_one():
    """One session repeating a target cannot dominate fail_rate or n."""
    rows = [
        {"target_id": 5, "who": "grinder", "correct": False, "ms": 100}
        for _ in range(50)
    ]
    # one honest other session got it right
    rows.append({"target_id": 5, "who": "honest", "correct": True, "ms": 900})
    out = _by_target(agg.aggregate_targets(rows))
    # grinder collapses to a single observation -> n = 2, fails = 1
    assert out[5]["n"] == 2
    expected = (agg.K * agg.PRIOR + 1) / (agg.K + 2)
    assert out[5]["fail_rate"] == pytest.approx(expected)
    # only the first grinder ms is kept, plus honest -> median of [100, 900]
    assert out[5]["median_ms"] == 500


def test_anonymous_rounds_each_count_once_not_collapsed():
    """who=None rounds cannot be deduped; each is an independent observation."""
    rows = [
        {"target_id": 8, "who": None, "correct": False, "ms": 700}
        for _ in range(4)
    ]
    out = _by_target(agg.aggregate_targets(rows))
    assert out[8]["n"] == 4  # not collapsed to 1
    expected = (agg.K * agg.PRIOR + 4) / (agg.K + 4)
    assert out[8]["fail_rate"] == pytest.approx(expected)


def test_first_seen_kept_for_named_session_determinism():
    """The first round per (who) is the one that contributes (deterministic)."""
    rows = [
        {"target_id": 2, "who": "x", "correct": False, "ms": 111},  # kept
        {"target_id": 2, "who": "x", "correct": True, "ms": 999},  # ignored
    ]
    out = _by_target(agg.aggregate_targets(rows))
    assert out[2]["n"] == 1
    # First-seen failure is kept (fail count 1); the second round is ignored.
    expected = (agg.K * agg.PRIOR + 1) / (agg.K + 1)
    assert out[2]["fail_rate"] == pytest.approx(expected)
    assert out[2]["median_ms"] == 111  # the second round's ms was ignored


# --- tier bucketing ----------------------------------------------------------

def test_tier_of_thresholds():
    assert agg.tier_of(0.0) == "easy"
    assert agg.tier_of(agg.EASY_MAX) == "easy"
    assert agg.tier_of(agg.EASY_MAX + 0.001) == "normal"
    assert agg.tier_of(agg.HARD_MIN - 0.001) == "normal"
    assert agg.tier_of(agg.HARD_MIN) == "hard"
    assert agg.tier_of(1.0) == "hard"


def test_aggregate_targets_assigns_difficulty_tiers():
    # Easy target: many correct -> low shrunk fail rate.
    easy = [
        {"target_id": 10, "who": f"e{i}", "correct": True, "ms": 800}
        for i in range(50)
    ]
    # Hard target: many wrong -> high shrunk fail rate.
    hard = [
        {"target_id": 11, "who": f"h{i}", "correct": False, "ms": 800}
        for i in range(50)
    ]
    out = _by_target(agg.aggregate_targets(easy + hard))
    assert out[10]["difficulty"] == "easy"
    assert out[11]["difficulty"] == "hard"


# --- pairs -------------------------------------------------------------------

def test_pairs_shrunk_confus_and_counts():
    rows = [
        {"target_id": 1, "option_id": 2, "was_wrong": True},
        {"target_id": 1, "option_id": 2, "was_wrong": True},
        {"target_id": 1, "option_id": 2, "was_wrong": False},
    ]
    out = {(r["target_id"], r["distractor_id"]): r for r in agg.aggregate_pairs(rows)}
    pair = out[(1, 2)]
    assert pair["n_shown"] == 3
    assert pair["n_wrong"] == 2
    expected = (agg.PAIR_K * agg.PAIR_PRIOR + 2) / (agg.PAIR_K + 3)
    assert pair["confus"] == pytest.approx(expected)


def test_pairs_once_and_missed_stays_below_one():
    """A distractor shown once and missed must not rocket to confus = 1.0."""
    rows = [{"target_id": 1, "option_id": 2, "was_wrong": True}]
    out = agg.aggregate_pairs(rows)
    assert len(out) == 1
    assert out[0]["confus"] < 1.0
    expected = (agg.PAIR_K * agg.PAIR_PRIOR + 1) / (agg.PAIR_K + 1)
    assert out[0]["confus"] == pytest.approx(expected)


def test_pairs_exclude_self_as_distractor():
    """option_id == target_id (the correct answer) is never a distractor."""
    rows = [
        {"target_id": 1, "option_id": 1, "was_wrong": False},
        {"target_id": 1, "option_id": 3, "was_wrong": True},
    ]
    out = agg.aggregate_pairs(rows)
    keys = {(r["target_id"], r["distractor_id"]) for r in out}
    assert (1, 1) not in keys
    assert (1, 3) in keys


def test_pairs_empty_input():
    assert agg.aggregate_pairs([]) == []
