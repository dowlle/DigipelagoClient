// Per-entry visual/gameplay status for the dex grid. Delegates entirely to the
// committed gating predicates (guess.ts) so the grid never re-implements gates.

import type { Digimon, GameState, SlotData } from './types';
import { guessable, isCaught } from './guess';
import { isRoot, priorsOf } from '../data/dataset';

export type EntryStatus = 'caught' | 'guessable' | 'locked';

export function entryStatus(d: Digimon, st: GameState, slot: SlotData): EntryStatus {
  if (isCaught(d, st)) return 'caught';
  if (guessable(d, st, slot.level_tier)) return 'guessable';
  return 'locked';
}

/**
 * Human-readable reason a Digimon can't be caught right now, or null if it can.
 * Checked in the same order as guessable() so the first failing gate is reported.
 */
export function lockReason(d: Digimon, st: GameState, slot: SlotData): string | null {
  if (st.caughtCount >= st.capacity) return 'DigiStorage full — need a capacity upgrade';
  if (st.tierReached < slot.level_tier[d.level]) return `${d.level} not unlocked yet`;
  if (!st.heldAttributes.has(d.attribute)) return `Need the ${d.attribute} key`;
  if (!isRoot(d.id) && !priorsOf(d.id).some((p) => st.caught.has(p))) {
    return 'Catch a prior evolution first';
  }
  return null;
}
