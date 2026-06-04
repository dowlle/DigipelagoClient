// Multiworld activity feed (S5) — an ADDITIVE, READ-ONLY subscriber over the
// archipelago.js streams the transport already binds. It NEVER sends packets,
// checks locations, or mutates game state; it only *reads* item/message events
// and maps them to typed presentation rows for the HUD feed + moment toasts.
//
//   • `itemSent`      (client.messages) → "your catch shipped <item> → <player>"
//                     for items YOU found (item.sender === self), and
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
  /** capacity: +N delta and the new max. */
  by?: number;
  to?: number;
  /** milestone free text. */
  text?: string;
}

/** Markers the apworld uses for catch-shipped items vs storage upgrades. */
const CAPACITY_ITEM = /storage upgrade/i;

function itemId(prefix: string, item: Item, idx: number): string {
  // Items don't carry a unique network index here, so compose a best-effort key.
  return `${prefix}:${item.locationId ?? idx}:${item.name}:${item.sender.slot}:${item.receiver.slot}`;
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
      });
    });

    const onItemSent = (_text: string, item: Item) => {
      // Only YOUR finds, and only those shipped to another world (a real "catch").
      if (item.sender.slot !== selfSlot) return;
      if (item.receiver.slot === selfSlot) return; // your own progression, not a ship
      push({
        id: itemId('sent', item, 0),
        kind: 'catch',
        at: Date.now(),
        item: item.name,
        player: item.receiver.alias,
      });
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
