// Eaten-food contract (mirrors the caught-set, ADR-0002). Received food comes from
// the AP item stream (GameState.foodReceived); how much you've EATEN is per-player
// mutable state, so it lives in AP DataStorage under a team+slot+item-scoped key
// holding an append-only counter. available = received - eaten, reconstructable on
// any device and conflict-free across concurrent devices (atomic server-side add).

import type { Client } from 'archipelago.js';

/** team+slot+item-scoped key for the eaten counter. */
export function eatenKey(team: number, slot: number, item: string): string {
  return `Digipelago:${team}:${slot}:eaten:${item}`;
}

function sanitizeCount(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * Read the eaten counts for a set of food items and subscribe to live cross-device
 * updates. `onChange(item, count)` fires when any monitored counter changes. Per
 * archipelago.js, monitored keys must be re-notified after a reconnect, so call
 * this again inside onConnected. Returns the current {item: count} map.
 */
export async function watchFoodEaten(
  client: Client,
  team: number,
  slot: number,
  items: string[],
  onChange: (item: string, count: number) => void,
): Promise<Record<string, number>> {
  const keyToItem = new Map(items.map((it) => [eatenKey(team, slot, it), it]));
  const keys = [...keyToItem.keys()];
  const data = await client.storage.notify<Record<string, number>>(keys, (key, value) => {
    const item = keyToItem.get(key);
    if (item) onChange(item, sanitizeCount(value));
  });
  const out: Record<string, number> = {};
  for (const [key, item] of keyToItem) out[item] = sanitizeCount(data[key]);
  return out;
}

/** Eat one food item: atomic server-side increment of its eaten counter. */
export function eatFood(client: Client, team: number, slot: number, item: string): void {
  client.storage.prepare<number>(eatenKey(team, slot, item), 0).add(1).commit();
}
