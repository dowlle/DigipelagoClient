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
 *  variants. Older seeds omit it; the client falls back to 'normal'. */
export type McDifficulty = 'easy' | 'normal' | 'hard';

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

export function pickTarget(targets: Digimon[], rng: Rng = Math.random): Digimon | undefined {
  if (targets.length === 0) return undefined;
  return targets[Math.floor(rng() * targets.length)];
}

/**
 * Build N options: the target plus distractors, shuffled. The `difficulty` knob
 * controls how confusable the distractors are (client-side only, never AP):
 *   easy   — drawn from anywhere (often a different level, easy to rule out).
 *   normal — prefer the target's level (the original behaviour).
 *   hard   — prefer same-base variants of the target (e.g. Agumon -> Toy Agumon),
 *            topping up from same-level then anything when too few variants exist.
 * Returns fewer than n only if the dataset is too small (never throws).
 */
export function buildChoices(
  target: Digimon,
  allEntries: Digimon[],
  n: number,
  rng: Rng = Math.random,
  difficulty: McDifficulty = 'normal',
): Digimon[] {
  const others = allEntries.filter((d) => d.id !== target.id);
  const need = n - 1;
  let distractors: Digimon[];
  if (difficulty === 'easy') {
    distractors = sampleWithout(others, need, rng);
  } else if (difficulty === 'hard') {
    const base = variantBase(target.name);
    const sameBase = others.filter((d) => variantBase(d.name) === base);
    const sameLevel = others.filter((d) => d.level === target.level);
    // Prefer same-base variants, then same-level fillers, then anything.
    distractors = sampleLayered([sameBase, sameLevel, others], need, rng);
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
