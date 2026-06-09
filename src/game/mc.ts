// Multiple-choice mode logic. MC is an "identify the silhouette" round: a hidden
// target Digimon (drawn from the currently-catchable pool, so catching it is
// always AP-valid) is shown shadowed; the player picks its name from N options.
// A correct pick catches the target; a wrong pick consumes the self-regenerating
// meter (useWrongPickMeter) — never an AP dependency.

import type { Digimon, GameState, SlotData } from './types';
import { guessable, isCaught } from './guess';

export type Rng = () => number;

/** Distractor-selection difficulty for multiple-choice rounds (client-side only,
 *  never an AP dependency). easy = anything, normal = same level, hard = same-base
 *  variants, telemetry = crowd-sourced confusable distractors + tier-weighted
 *  targets (the perceived-difficulty engine; client-side only). When the
 *  telemetry signal is absent/empty the telemetry mode degrades to the 'hard'
 *  heuristic, so it can never change what is beatable. Older seeds omit the
 *  field entirely; the client then falls back to 'normal'. */
export type McDifficulty = 'easy' | 'normal' | 'hard' | 'telemetry';

/**
 * The "variant base" of a Digimon name: its final whitespace-delimited token,
 * lowercased. Digi-API space-separates modifiers, so "Toy Agumon", "Yuki Agumon"
 * and "Agumon" all share the base "agumon" (and "Metal Greymon"/"War Greymon"
 * share "greymon"). Used only to gather maximally-confusable hard distractors;
 * a heuristic, not gating data. A future telemetry signal can supersede it (see
 * the perceived-difficulty design) without changing this contract.
 */
export function variantBase(name: string): string {
  const tokens = name.trim().split(/\s+/);
  return (tokens[tokens.length - 1] ?? name).toLowerCase();
}

/** Currently-catchable, not-yet-caught Digimon — the valid MC target pool. */
export function guessableTargets(entries: Iterable<Digimon>, st: GameState, slot: SlotData): Digimon[] {
  const out: Digimon[] = [];
  for (const d of entries) {
    if (!isCaught(d, st) && guessable(d, st, slot.level_tier)) out.push(d);
  }
  return out;
}

/**
 * Pick one target from the (already AP-filtered) pool. `weightOf` lets the
 * telemetry engine (Mode C) bias selection toward harder tiers WITHIN the same
 * pool: it never changes WHICH targets are eligible (the pool is still exactly
 * guessableTargets), only their selection probability. The default weight 1
 * preserves the original uniform behaviour and the seeded-rng tests. Every
 * eligible target keeps weight > 0, so all stay reachable in finite time.
 */
export function pickTarget(
  targets: Digimon[],
  rng: Rng = Math.random,
  weightOf?: (d: Digimon) => number,
): Digimon | undefined {
  if (targets.length === 0) return undefined;
  if (!weightOf) return targets[Math.floor(rng() * targets.length)];

  // Weighted pick over the SAME pool. Guard every weight to a positive finite
  // number so no eligible target can be starved to zero probability.
  const weights = targets.map((d) => {
    const w = weightOf(d);
    return Number.isFinite(w) && w > 0 ? w : 1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < targets.length; i += 1) {
    r -= weights[i];
    if (r < 0) return targets[i];
  }
  return targets[targets.length - 1];
}

/**
 * Per-round telemetry hint for the 'telemetry' difficulty (FEAT-03, Mode A).
 * `confusable` is this target's most-confusable distractor ids, ordered by
 * crowd-sourced confusability DESC (from GET /api/difficulty). When present and
 * non-empty those ids are layered first; otherwise the 'hard' heuristic runs.
 */
export interface BuildTelemetry {
  confusable?: number[];
}

/**
 * Build N options: the target plus distractors, shuffled. The `difficulty` knob
 * controls how confusable the distractors are (client-side only, never AP):
 *   easy      — drawn from anywhere (often a different level, easy to rule out).
 *   normal    — prefer the target's level (the original behaviour).
 *   hard      — prefer same-base variants of the target (e.g. Agumon -> Toy
 *               Agumon), topping up from same-level then anything when too few
 *               variants exist.
 *   telemetry — layer the crowd-sourced confusable[] ids first (mapped to real
 *               entries, target excluded), then top up via the SAME fallback
 *               chain as 'hard' (same-base, same-level, anything). When the
 *               telemetry hint is absent/empty this delegates to the 'hard'
 *               path verbatim, so it is purely additive and never gates beatability.
 * Only ever chooses which NAMES appear; the correct answer is always the target.
 * Returns fewer than n only if the dataset is too small (never throws).
 */
export function buildChoices(
  target: Digimon,
  allEntries: Digimon[],
  n: number,
  rng: Rng = Math.random,
  difficulty: McDifficulty = 'normal',
  telemetry?: BuildTelemetry,
): Digimon[] {
  const others = allEntries.filter((d) => d.id !== target.id);
  const need = n - 1;
  let distractors: Digimon[];
  if (difficulty === 'easy') {
    distractors = sampleWithout(others, need, rng);
  } else if (difficulty === 'hard' || difficulty === 'telemetry') {
    const base = variantBase(target.name);
    const sameBase = others.filter((d) => variantBase(d.name) === base);
    const sameLevel = others.filter((d) => d.level === target.level);
    // 'telemetry' with a non-empty confusable[] layers those crowd-sourced ids
    // first (in served order), then falls through to the 'hard' chain to top up;
    // with no hint it IS the 'hard' chain. The fallback is identical either way.
    const confusableIds = difficulty === 'telemetry' ? telemetry?.confusable ?? [] : [];
    const byId = new Map(others.map((d) => [d.id, d]));
    const confusable: Digimon[] = [];
    for (const id of confusableIds) {
      const d = byId.get(id);
      if (d) confusable.push(d);
    }
    // Prefer crowd-confusable, then same-base variants, then same-level, then anything.
    distractors = sampleLayered([confusable, sameBase, sameLevel, others], need, rng);
  } else {
    const sameLevel = others.filter((d) => d.level === target.level);
    const pool = sameLevel.length >= need ? sameLevel : others;
    distractors = sampleWithout(pool, need, rng);
  }
  return shuffle([target, ...distractors], rng);
}

/** Sample up to k unique Digimon, exhausting each layer (in order) before the next. */
function sampleLayered(layers: Digimon[][], k: number, rng: Rng): Digimon[] {
  const out: Digimon[] = [];
  const used = new Set<number>();
  for (const layer of layers) {
    if (out.length >= k) break;
    const avail = layer.filter((d) => !used.has(d.id));
    for (const d of sampleWithout(avail, k - out.length, rng)) {
      out.push(d);
      used.add(d.id);
    }
  }
  return out;
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
