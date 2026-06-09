// Client fetch + cache for the crowd-sourced perceived-difficulty engine
// (FEAT-03, telemetry McDifficulty). Reads GET /api/difficulty?dataset_version=...
// and returns the parsed {targets, confusable} shape, or null on any
// non-ok / network error / empty {} body.
//
// Design rules (mirrors backend.ts):
//   - NEVER throws. The telemetry difficulty signal is pure UX sugar: when the
//     backend is unreachable, logged out, rate-limited, or has no data for the
//     dataset_version, the caller gets null and falls back to the 'hard'
//     heuristic. Offline / logged-out play is identical to today.
//   - Same-origin (the Flask app serves dist/), session cookie, no auth header.
//   - This NEVER gates Archipelago beatability. It only sharpens which NAMES
//     appear as multiple-choice distractors and biases target selection WITHIN
//     the already-filtered guessable pool. See src/game/mc.ts.

/** Per-target difficulty stat as served by GET /api/difficulty. */
export interface TargetStat {
  /** Crowd-sourced tier bucket; falls back to the heuristic when absent. */
  difficulty: 'easy' | 'normal' | 'hard';
  /** Observation count behind the stat (informational; not used for gating). */
  n: number;
}

/** Parsed response of GET /api/difficulty. Keys are stringified target ids. */
export interface DifficultyData {
  /** stringId -> {difficulty, n} */
  targets: Record<string, TargetStat>;
  /** stringId -> distractor ids ordered by confusability DESC */
  confusable: Record<string, number[]>;
}

// Module-level cache keyed by dataset_version: a session loads each version's
// stats from the network at most once. `undefined` = not fetched yet.
const cache = new Map<string, DifficultyData | null>();
// In-flight promise dedupe so concurrent callers (multiple components, rapid
// rounds) within a session share one request instead of racing N of them.
const inflight = new Map<string, Promise<DifficultyData | null>>();

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Coerce the raw JSON body into DifficultyData, or null when it is empty/bad.
 *  Defensive: a malformed field degrades to empty rather than throwing. */
function parse(body: unknown): DifficultyData | null {
  if (!isObject(body)) return null;
  const rawTargets = isObject(body.targets) ? body.targets : {};
  const rawConfusable = isObject(body.confusable) ? body.confusable : {};

  const targets: Record<string, TargetStat> = {};
  for (const [id, stat] of Object.entries(rawTargets)) {
    if (!isObject(stat)) continue;
    const difficulty = stat.difficulty;
    if (difficulty === 'easy' || difficulty === 'normal' || difficulty === 'hard') {
      const n = typeof stat.n === 'number' ? stat.n : 0;
      targets[id] = { difficulty, n };
    }
  }

  const confusable: Record<string, number[]> = {};
  for (const [id, ids] of Object.entries(rawConfusable)) {
    if (!Array.isArray(ids)) continue;
    const nums = ids.filter((x): x is number => typeof x === 'number');
    if (nums.length) confusable[id] = nums;
  }

  // Empty {} (the backend's "no data" response) -> null so the caller falls back.
  if (Object.keys(targets).length === 0 && Object.keys(confusable).length === 0) {
    return null;
  }
  return { targets, confusable };
}

async function load(datasetVersion: string): Promise<DifficultyData | null> {
  try {
    const res = await fetch(
      `/api/difficulty?dataset_version=${encodeURIComponent(datasetVersion)}`,
      { credentials: 'same-origin' },
    );
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    // Network error / parse error / offline: degrade silently to the heuristic.
    return null;
  }
}

/**
 * Fetch (and cache) the crowd-sourced difficulty data for a dataset version.
 * Returns null on any error / empty data; never throws. Repeated calls within a
 * session hit the network at most once (cache + in-flight dedupe).
 */
export async function fetchDifficulty(datasetVersion: string): Promise<DifficultyData | null> {
  if (cache.has(datasetVersion)) return cache.get(datasetVersion) ?? null;
  const pending = inflight.get(datasetVersion);
  if (pending) return pending;

  const promise = load(datasetVersion)
    .then((data) => {
      cache.set(datasetVersion, data);
      return data;
    })
    .finally(() => {
      inflight.delete(datasetVersion);
    });
  inflight.set(datasetVersion, promise);
  return promise;
}

/** Test-only: clear the module cache + in-flight map. */
export function __resetDifficultyCache(): void {
  cache.clear();
  inflight.clear();
}
