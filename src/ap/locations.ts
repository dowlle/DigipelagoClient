// Catch-slot location helpers. Catches map to abstract, 1-indexed locations
// "Catch Slot #1" .. "Catch Slot #922" (Locations.py). Checks MUST be sequential
// so that `caughtCount` === number of checked catch-slot locations, which is the
// capacity-cap accounting authority (the server's `can_catch_n` gate is
// `capacity >= k AND pool_size >= k`).

import type { Client } from 'archipelago.js';

export const GAME_NAME = 'Digipelago';
export const CATCH_SLOT_PREFIX = 'Catch Slot #';

/** Name of the kth catch slot (k is 1-indexed). */
export function catchSlotName(k: number): string {
  return `${CATCH_SLOT_PREFIX}${k}`;
}

/** The next catch slot to check given how many catches are already checked. */
export function nextCatchSlotName(caughtCount: number): string {
  return catchSlotName(caughtCount + 1);
}

/** Parse a catch-slot location name back to its k, or null if not a catch slot. */
export function parseCatchSlot(name: string): number | null {
  if (!name.startsWith(CATCH_SLOT_PREFIX)) return null;
  const rest = name.slice(CATCH_SLOT_PREFIX.length);
  if (!/^[1-9][0-9]*$/.test(rest)) return null; // 1-indexed, no leading zeros
  return Number(rest);
}

/**
 * Count how many of the server's checked locations are catch slots. The Victory
 * event has no address so it never appears in checkedLocations, but we filter by
 * name anyway to stay robust to any future non-catch locations.
 *
 * DEDUPED: archipelago.js appends RoomUpdate.checked_locations to its list
 * without de-duplicating, and the AP server re-broadcasts already-checked ids
 * (e.g. around !collect / !release). Counting raw occurrences inflated
 * caughtCount to a multiple of the real count (Storage read 2766/950 = 3x922),
 * which then wedges guessable() via the capacity cap. Count distinct ids only.
 */
export function countCheckedCatchSlots(client: Client): number {
  const checked = new Set(client.room.checkedLocations);
  const pkg = client.package.findPackage(GAME_NAME);
  if (!pkg) return checked.size; // fallback: all checked are catches
  let n = 0;
  for (const id of checked) {
    const name = pkg.reverseLocationTable[id];
    if (name && parseCatchSlot(name) !== null) n += 1;
  }
  return n;
}

/** Resolve a catch-slot name to its location id, or null if unknown. */
export function catchSlotId(client: Client, k: number): number | null {
  const pkg = client.package.findPackage(GAME_NAME);
  if (!pkg) return null;
  const id = pkg.locationTable[catchSlotName(k)];
  return typeof id === 'number' ? id : null;
}
