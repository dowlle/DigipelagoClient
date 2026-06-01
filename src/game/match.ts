// Free-text guess matching + evaluation. Pure and dependency-light so the catch
// loop is unit-testable without a live AP connection. Name matching strips
// diacritics and non-alphanumerics (Digimon names carry hyphens, dots, accents).

import type { Digimon, GameState, SlotData } from './types';
import { guessable } from './guess';
import { lockReason } from './status';

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** First Digimon whose name matches the typed text (normalized exact), or undefined. */
export function findByName(input: string, entries: Iterable<Digimon>): Digimon | undefined {
  const n = normalizeName(input);
  if (!n) return undefined;
  for (const d of entries) {
    if (normalizeName(d.name) === n) return d;
  }
  return undefined;
}

export type GuessOutcome =
  | { kind: 'catch'; digimon: Digimon }
  | { kind: 'already'; digimon: Digimon }
  | { kind: 'locked'; digimon: Digimon; reason: string }
  | { kind: 'unknown' };

/** Classify a free-text guess against the current state. Does not mutate. */
export function evaluateGuess(
  input: string,
  entries: Iterable<Digimon>,
  st: GameState,
  slot: SlotData,
): GuessOutcome {
  const d = findByName(input, entries);
  if (!d) return { kind: 'unknown' };
  if (st.caught.has(d.id)) return { kind: 'already', digimon: d };
  if (guessable(d, st, slot.level_tier)) return { kind: 'catch', digimon: d };
  return { kind: 'locked', digimon: d, reason: lockReason(d, st, slot) ?? 'Locked' };
}
