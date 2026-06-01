// Wordle-style clue engine for hard mode. Compares a guessed Digimon against the
// hidden target across the design's clue dimensions (Game Design "Clue
// dimensions"). Pure + testable. Direction is always "where the TARGET sits
// relative to the guess" (higher/lower) so the arrow tells the player which way
// to move.

import type { Digimon } from './types';

export type Dir = 'higher' | 'lower' | 'match';
export type Overlap = 'exact' | 'partial' | 'none';

export interface Clue {
  level: Dir; // by tier ordinal
  attribute: boolean; // primary (gating) attribute exact match
  types: Overlap; // multi-valued
  fields: Overlap; // multi-valued, noisy
  year: Dir | 'unknown'; // debut year hi/lo
  xAntibody: boolean; // same X-Antibody status
  correct: boolean; // the guess IS the target
}

function dir(guessVal: number, targetVal: number): Dir {
  if (targetVal > guessVal) return 'higher';
  if (targetVal < guessVal) return 'lower';
  return 'match';
}

/** Set overlap: exact (same set), partial (some shared), or none. */
export function overlap(a: string[], b: string[]): Overlap {
  const sb = new Set(b);
  const common = a.filter((x) => sb.has(x)).length;
  if (common === 0) return 'none';
  if (common === a.length && a.length === b.length) return 'exact';
  return 'partial';
}

export function computeClue(guess: Digimon, target: Digimon): Clue {
  const gy = Number(guess.year);
  const ty = Number(target.year);
  const year: Dir | 'unknown' =
    Number.isFinite(gy) && Number.isFinite(ty) && guess.year && target.year ? dir(gy, ty) : 'unknown';
  return {
    level: dir(guess.tier, target.tier),
    attribute: guess.attribute === target.attribute,
    types: overlap(guess.types, target.types),
    fields: overlap(guess.fields, target.fields),
    year,
    xAntibody: guess.xAntibody === target.xAntibody,
    correct: guess.id === target.id,
  };
}
