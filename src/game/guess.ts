// The client-side gating logic — strictly STRONGER than the apworld's
// `can_catch_n` (it adds digivolution-line ordering), so the client can never
// let you catch something AP logic considers unreachable. Pure + testable.
//
// Mirrors worlds/digipelago/__init__.py:
//   guessable(d) = caughtCount < capacity
//               && tierReached >= LEVEL_TIER[d.level]
//               && heldAttributes has d.attribute
//               && (isRoot(d) || some prior already caught)

import type { Digimon, GameState, SlotData } from './types';
import { isRoot, priorsOf } from '../data/dataset';

export function capacity(slot: SlotData, upgradeCount: number): number {
  return slot.starting_capacity + upgradeCount * slot.capacity_per_upgrade;
}

export function tierReached(digivolutionCount: number): number {
  // The Rookie step is precollected, so count is always >= 1.
  return 1 + digivolutionCount;
}

/** Whether a Digimon may be guessed right now. */
export function guessable(d: Digimon, st: GameState, levelTier: Record<string, number>): boolean {
  if (st.caughtCount >= st.capacity) return false;          // capacity cap (mirrors logic)
  if (st.tierReached < levelTier[d.level]) return false;    // level key
  if (!st.heldAttributes.has(d.attribute)) return false;    // attribute key
  if (isRoot(d.id)) return true;                            // roots need no prior
  return priorsOf(d.id).some((p) => st.caught.has(p));      // digivolution-line ordering
}

/** Already-caught Digimon are not re-guessable. */
export function isCaught(d: Digimon, st: GameState): boolean {
  return st.caught.has(d.id);
}

/** Goal progress: count of caught Digimon matching the goal (any, or a level). */
export function goalProgress(
  st: GameState,
  slot: SlotData,
  metaOf: (id: number) => Digimon | undefined,
): { current: number; target: number } {
  let current: number;
  if (slot.goal === 'level') {
    current = [...st.caught].filter((id) => metaOf(id)?.level === slot.goal_level).length;
  } else {
    current = st.caught.size;
  }
  return { current, target: slot.goal_count };
}

/** Whether the seed's goal is met (goal_count caught of the relevant pool). */
export function goalReached(
  st: GameState,
  slot: SlotData,
  metaOf: (id: number) => Digimon | undefined,
): boolean {
  const { current, target } = goalProgress(st, slot, metaOf);
  return target > 0 && current >= target;
}
