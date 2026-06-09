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

// ── Presentation-only helpers (UX) ───────────────────────────────────────────
// resolveByName and isStrictPrefixOfUncaughtGuessable exist to make the free-text
// input *feel* responsive (auto-submit + smart debounce). They are ADDITIVE and
// must never widen reachability: guessable() and st.caught are read ONLY to rank
// presentation or pick a debounce delay, never to make a non-guessable Digimon
// catchable. evaluateGuess/findByName stay byte-identical (the real catch path).

/** uncaught + currently guessable = the player can catch this right now. */
function isUncaughtGuessable(d: Digimon, st: GameState, slot: SlotData): boolean {
  return !st.caught.has(d.id) && guessable(d, st, slot.level_tier);
}

/**
 * Multi-match resolver: among ALL Digimon whose normalized name equals the typed
 * input, pick the one the player most likely means and classify it the same way
 * evaluateGuess would. Preference order (presentation ranking only):
 *   1. uncaught + guessable (catchable now)
 *   2. already caught
 *   3. locked
 *   4. first normalized-exact match (stable fallback)
 *
 * The dataset currently has no colliding normalized names, so for real data this
 * behaves exactly like evaluateGuess(findByName(...)). It generalizes gracefully
 * if a future dataset introduces a collision, always preferring the catchable one.
 * It can NEVER catch a non-guessable Digimon: a 'catch' outcome is only returned
 * for an entry that passes guessable().
 */
export function resolveByName(
  input: string,
  entries: Iterable<Digimon>,
  st: GameState,
  slot: SlotData,
): GuessOutcome {
  const n = normalizeName(input);
  if (!n) return { kind: 'unknown' };

  let catchable: Digimon | undefined;
  let caught: Digimon | undefined;
  let locked: Digimon | undefined;
  let first: Digimon | undefined;

  for (const d of entries) {
    if (normalizeName(d.name) !== n) continue;
    if (!first) first = d;
    if (!catchable && isUncaughtGuessable(d, st, slot)) catchable = d;
    else if (!caught && st.caught.has(d.id)) caught = d;
    else if (!locked) locked = d;
  }

  if (catchable) return { kind: 'catch', digimon: catchable };
  if (caught) return { kind: 'already', digimon: caught };
  if (locked) return { kind: 'locked', digimon: locked, reason: lockReason(locked, st, slot) ?? 'Locked' };
  if (first) {
    // Single match that is neither uncaught-guessable, caught, nor classified
    // above (e.g. it was the `first` but skipped by the else-if chain): classify
    // it exactly as evaluateGuess would so the toast text stays consistent.
    if (st.caught.has(first.id)) return { kind: 'already', digimon: first };
    if (guessable(first, st, slot.level_tier)) return { kind: 'catch', digimon: first };
    return { kind: 'locked', digimon: first, reason: lockReason(first, st, slot) ?? 'Locked' };
  }
  return { kind: 'unknown' };
}

/**
 * True when the typed input is a STRICT prefix (normalized, strictly shorter) of
 * some Digimon that is uncaught + guessable right now. Drives ONLY the auto-submit
 * debounce delay (wait a beat so the player can finish typing a longer name that
 * starts the same way, e.g. "Agumon" vs "Agumon Hakase"); it never gates a catch.
 * Mirrors Pokepelago's couldBePrefix, adapted to one language (no aliases).
 */
export function isStrictPrefixOfUncaughtGuessable(
  input: string,
  entries: Iterable<Digimon>,
  st: GameState,
  slot: SlotData,
): boolean {
  const n = normalizeName(input);
  if (!n) return false;
  for (const d of entries) {
    const dn = normalizeName(d.name);
    if (dn.length > n.length && dn.startsWith(n) && isUncaughtGuessable(d, st, slot)) {
      return true;
    }
  }
  return false;
}
