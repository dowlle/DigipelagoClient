// Multiworld activity feed (S5) — an ADDITIVE, READ-ONLY subscriber over the
// archipelago.js streams the transport already binds. It NEVER sends packets,
// checks locations, or mutates game state; it only *reads* item/message events
// and maps them to typed presentation rows for the HUD feed + moment toasts.
//
//   • `itemSent`      (client.messages) → "your catch shipped <item> → <player>"
//                     for items YOU found (item.sender === self). A "catch" is
//                     defined by its SOURCE (the item shipped FROM a Catch Slot
//                     #k in your world), NOT by the receiver, so solo seeds where
//                     you ship items to yourself still produce catch rows.
//                     "received <item> · from <player>" for items sent TO you.
//   • `itemsReceived` (client.items)    → backfill of received items (capacity
//                     beats are derived from GameState.capacity in the UI layer).
//
// Capacity / peer-milestone beats that depend on derived game state are surfaced
// by the UI (StatusCards / AppShell) diffing GameState; this hook owns the raw
// multiworld stream only. Everything here reads existing AP state — no change to
// transport behaviour (connection.ts) or game computation.

import { useEffect, useRef, useState } from 'react';
import type { Client, Item } from 'archipelago.js';
import { GAME_NAME, parseCatchSlot } from './locations';

export type FeedKind = 'catch' | 'received' | 'capacity' | 'milestone';

export interface FeedRow {
  /** Stable-ish key for React lists. */
  id: string;
  kind: FeedKind;
  /** Wall-clock time the row was observed (for relative "Xs ago" labels). */
  at: number;
  /** Display: catch → the Digimon item name you shipped / received item name. */
  item?: string;
  /** Display: the other player involved (recipient for catch, sender for received). */
  player?: string;
  /** catch: the 1-indexed Catch Slot #k this ship came from (for caught-name lookup). */
  slot?: number;
  /** catch: the Digimon you caught, resolved by the UI from slot ↔ caught order. */
  caughtName?: string;
  /** AP item classification bitfield (progression=1, useful=2, trap=4), for the
   *  item-name color. Undefined on synthetic/legacy rows so the UI falls back. */
  flags?: number;
  /** capacity: +N delta and the new max. */
  by?: number;
  to?: number;
  /** milestone free text. */
  text?: string;
}

/** Markers the apworld uses for catch-shipped items vs storage upgrades. */
const CAPACITY_ITEM = /storage upgrade/i;

// AP item classification bitflags (NetworkItem.flags).
const FLAG_PROGRESSION = 0b001;
const FLAG_USEFUL = 0b010;
const FLAG_TRAP = 0b100;

// AP-standard item-name colors, matching the Archipelago text client
// (ArchipelagoPokepelago/NetUtils.py `_handle_item_name`). These are fixed AP
// hex values, NOT theme tokens, for parity with the AP client.
const COLOR_NONE = '#00EEEE'; // cyan: no special flags (filler)
const COLOR_PROGRESSION = '#AF99EF'; // plum
const COLOR_USEFUL = '#6D8BE8'; // slateblue
const COLOR_TRAP = '#FA8072'; // salmon

/**
 * Map an AP item classification bitfield to its AP-standard item-name color.
 * Precedence is an elif chain (progression > useful > trap), matching the AP
 * text client exactly — NOT a bitwise max. Returns undefined when `flags` is
 * undefined so the UI can fall back to its theme token color.
 */
export function itemFlagColor(flags?: number): string | undefined {
  if (flags === undefined) return undefined;
  if (flags === 0) return COLOR_NONE;
  if (flags & FLAG_PROGRESSION) return COLOR_PROGRESSION;
  if (flags & FLAG_USEFUL) return COLOR_USEFUL;
  if (flags & FLAG_TRAP) return COLOR_TRAP;
  return COLOR_NONE;
}

function itemId(prefix: string, item: Item, idx: number): string {
  // Items don't carry a unique network index here, so compose a best-effort key.
  return `${prefix}:${item.locationId ?? idx}:${item.name}:${item.sender.slot}:${item.receiver.slot}`;
}

/** Minimal shape of the fields `classifyShippedItem` reads off an AP Item. */
export interface ShippedItem {
  name: string;
  locationId: number;
  flags?: number;
  sender: { slot: number };
  receiver: { slot: number; alias: string };
}

/**
 * Pure classifier for an `itemSent` event: decide whether it is a "catch" row
 * and, if so, build it. A catch is defined by its SOURCE — the item must have
 * been shipped BY you (sender === self) FROM one of your `Catch Slot #k`
 * locations. The receiver is irrelevant to whether it's a catch, so solo seeds
 * (you ship to yourself) still produce catch rows; `player` is only set when the
 * recipient is another world, so the solo case renders "You caught X -> item"
 * with no "to <player>" tail.
 *
 * Returns null when the event is not a catch (foreign sender, or a self-targeted
 * item that did NOT come from a Catch Slot, e.g. an internal event). Read-only:
 * builds a presentation row, never touches AP state or reachability.
 *
 * @param item the shipped network item
 * @param selfSlot this client's slot number
 * @param locName the source location name (pkg.reverseLocationTable[locationId])
 */
export function classifyShippedItem(
  item: ShippedItem,
  selfSlot: number,
  locName: string | undefined,
): FeedRow | null {
  if (item.sender.slot !== selfSlot) return null; // only YOUR finds
  const slot = locName ? parseCatchSlot(locName) ?? undefined : undefined;
  if (slot == null) return null; // not a Catch Slot source → not a catch (cosmetic-only)
  return {
    id: itemId('sent', item as unknown as Item, 0),
    kind: 'catch',
    at: Date.now(),
    item: item.name,
    // Only name the recipient when it's another world; solo ships leave it
    // undefined so the UI renders "You caught X -> item" with no "to" tail.
    player: item.receiver.slot === selfSlot ? undefined : item.receiver.alias,
    slot,
    flags: item.flags,
  };
}

/**
 * Subscribe to the live multiworld streams and accumulate newest-first feed rows.
 * Read-only: binds listeners on the current client and tears them down on change.
 *
 * @param clientRef the context's read-only client handle
 * @param connected re-subscribe whenever a (re)connection completes
 */
export function useFeed(
  clientRef: React.MutableRefObject<Client | null>,
  connected: boolean,
): FeedRow[] {
  const [rows, setRows] = useState<FeedRow[]>([]);
  // De-dupe across reconnect replays.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !connected) return;

    const selfSlot = client.players.self.slot;
    const push = (row: FeedRow) => {
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);
      setRows((prev) => [row, ...prev].slice(0, 200));
    };

    // Backfill any items received before this subscription bound (reconnect).
    client.items.received.forEach((item, idx) => {
      if (CAPACITY_ITEM.test(item.name)) return; // capacity beats come from state diff
      push({
        id: itemId('recv', item, idx),
        kind: 'received',
        at: Date.now(),
        item: item.name,
        player: item.sender.alias,
        flags: item.flags,
      });
    });

    const pkg = client.package.findPackage(GAME_NAME);
    const onItemSent = (_text: string, item: Item) => {
      // A "catch" is defined by its SOURCE Catch Slot #k, not the receiver, so
      // solo seeds (you ship to yourself) still produce catch rows. The pure
      // classifier returns null for non-catch sends (foreign sender or a
      // self-targeted item that did NOT come from a Catch Slot).
      const locName = pkg?.reverseLocationTable[item.locationId];
      const row = classifyShippedItem(item, selfSlot, locName);
      if (row) push(row);
    };

    const onItemsReceived = (items: Item[], startingIndex: number) => {
      items.forEach((item, i) => {
        if (CAPACITY_ITEM.test(item.name)) return;
        push({
          id: itemId('recv', item, startingIndex + i),
          kind: 'received',
          at: Date.now(),
          item: item.name,
          player: item.sender.alias,
          flags: item.flags,
        });
      });
    };

    client.messages.on('itemSent', onItemSent);
    client.items.on('itemsReceived', onItemsReceived);
    return () => {
      client.messages.off('itemSent', onItemSent);
      client.items.off('itemsReceived', onItemsReceived);
    };
  }, [clientRef, connected]);

  return rows;
}

/** A capacity beat assembled by the UI from a GameState capacity diff. */
export function capacityRow(from: number, to: number): FeedRow {
  return {
    id: `cap:${from}->${to}:${Date.now()}`,
    kind: 'capacity',
    at: Date.now(),
    by: to - from,
    to,
  };
}
