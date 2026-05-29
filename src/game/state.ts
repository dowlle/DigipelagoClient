// Reconstructs GameState entirely from the Archipelago server (ADR-0002:
// resumable from any device, no game-state in localStorage).
//
//   received item NAMES   -> capacity / tierReached / heldAttributes
//   checked catch slots   -> caughtCount
//   AP DataStorage        -> caught (identity set; append-only, conflict-free)
//
// Decoding by item NAME (not by reconstructing ID offsets) avoids the
// Pokepelago BUG-12 drift class entirely — archipelago.js resolves items to
// names for us.

import type { GameState, SlotData } from './types';
import { capacity, tierReached } from './guess';

const ATTR_KEY_RE = /^(.+) Key$/;

export interface ReceivedSummary {
  digivolutionCount: number;
  upgradeCount: number;
  heldAttributes: Set<string>;
}

/** Tally the received item names into the progression-bearing counts. */
export function summarizeReceived(itemNames: Iterable<string>): ReceivedSummary {
  let digivolutionCount = 0;
  let upgradeCount = 0;
  const heldAttributes = new Set<string>();
  for (const name of itemNames) {
    if (name === 'Digivolution') digivolutionCount += 1;
    else if (name === 'DigiStorage Upgrade') upgradeCount += 1;
    else {
      const m = ATTR_KEY_RE.exec(name);
      if (m) heldAttributes.add(m[1]);
    }
  }
  return { digivolutionCount, upgradeCount, heldAttributes };
}

/**
 * Build the live GameState from authoritative server inputs.
 * @param caughtCount number of checked catch-slot locations (cap accounting)
 * @param caught      identity set from DataStorage
 */
export function buildState(
  slot: SlotData,
  itemNames: Iterable<string>,
  caughtCount: number,
  caught: Set<number>,
): GameState {
  const r = summarizeReceived(itemNames);
  return {
    capacity: capacity(slot, r.upgradeCount),
    tierReached: tierReached(r.digivolutionCount),
    heldAttributes: r.heldAttributes,
    caught,
    caughtCount,
  };
}

/** Refuse to run on a dataset that doesn't match the seed (drift guard). */
export function assertDatasetMatches(slot: SlotData, bundledVersion: string): void {
  if (slot.dataset_version && slot.dataset_version !== bundledVersion) {
    throw new Error(
      `Digipelago dataset mismatch: seed expects ${slot.dataset_version}, ` +
      `client bundles ${bundledVersion}. Update the client to play this seed.`,
    );
  }
}
