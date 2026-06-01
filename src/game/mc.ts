// Multiple-choice mode logic. MC is an "identify the silhouette" round: a hidden
// target Digimon (drawn from the currently-catchable pool, so catching it is
// always AP-valid) is shown shadowed; the player picks its name from N options.
// A correct pick catches the target; a wrong pick consumes the self-regenerating
// meter (useWrongPickMeter) — never an AP dependency.

import type { Digimon, GameState, SlotData } from './types';
import { guessable, isCaught } from './guess';

export type Rng = () => number;

/** Currently-catchable, not-yet-caught Digimon — the valid MC target pool. */
export function guessableTargets(entries: Iterable<Digimon>, st: GameState, slot: SlotData): Digimon[] {
  const out: Digimon[] = [];
  for (const d of entries) {
    if (!isCaught(d, st) && guessable(d, st, slot.level_tier)) out.push(d);
  }
  return out;
}

export function pickTarget(targets: Digimon[], rng: Rng = Math.random): Digimon | undefined {
  if (targets.length === 0) return undefined;
  return targets[Math.floor(rng() * targets.length)];
}

/**
 * Build N options: the target plus distractors, shuffled. Distractors prefer the
 * target's level for plausibility, falling back to any Digimon. Returns fewer
 * than n only if the dataset is too small (never throws).
 */
export function buildChoices(
  target: Digimon,
  allEntries: Digimon[],
  n: number,
  rng: Rng = Math.random,
): Digimon[] {
  const others = allEntries.filter((d) => d.id !== target.id);
  const sameLevel = others.filter((d) => d.level === target.level);
  const pool = sameLevel.length >= n - 1 ? sameLevel : others;
  const distractors = sampleWithout(pool, n - 1, rng);
  return shuffle([target, ...distractors], rng);
}

function sampleWithout(pool: Digimon[], k: number, rng: Rng): Digimon[] {
  const copy = pool.slice();
  const out: Digimon[] = [];
  for (let i = 0; i < k && copy.length > 0; i += 1) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
