// DataStorage caught-set contract (ADR-0002). Catch locations are abstract
// slots, so `checked_locations` gives only the COUNT of catches, never their
// identity. Identity lives here, in AP DataStorage, under a team+slot-scoped
// key holding an append-only list of caught Digimon ids. Append-only ⇒ two
// devices catching concurrently converge with no conflict resolution.

import type { Client } from 'archipelago.js';

/** team+slot-scoped key; see State and Resumability (ADR-0002). */
export function caughtKey(team: number, slot: number): string {
  return `Digipelago:${team}:${slot}:caught`;
}

/** Coerce a raw DataStorage value into a clean set of caught ids. */
export function sanitizeCaughtList(raw: unknown): Set<number> {
  const out = new Set<number>();
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out.add(v);
    }
  }
  return out;
}

/**
 * Read the caught-id set and subscribe to live cross-device updates. The
 * returned set is the current value; `onChange` fires when another device
 * appends (or this one does). Per archipelago.js, monitored keys must be
 * re-`notify`'d after a reconnect — call this again inside onConnected.
 */
export async function watchCaught(
  client: Client,
  team: number,
  slot: number,
  onChange: (caught: Set<number>) => void,
): Promise<Set<number>> {
  const key = caughtKey(team, slot);
  const data = await client.storage.notify<Record<string, number[]>>([key], (_k, value) => {
    onChange(sanitizeCaughtList(value));
  });
  return sanitizeCaughtList(data[key]);
}

/**
 * Append a caught Digimon id (atomic server-side array concat — conflict-free).
 * `_default: []` so the first catch on a fresh seed initializes the list.
 */
export function appendCaught(client: Client, team: number, slot: number, id: number): void {
  client.storage.prepare<number[]>(caughtKey(team, slot), []).add([id]).commit();
}
