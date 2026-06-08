// Food inventory hook (silhouette-mode Stamina refills). Owns the EATEN counts
// (from AP DataStorage, re-synced on every reconnect) and exposes an `eat` action.
// available[item] = GameState.foodReceived[item] - eaten[item] is computed by the
// caller (AppShell), which has the received counts from GameState.
//
// eat() is client-side only: it writes the DataStorage counter and refills the
// Stamina meter. It NEVER checks a location or sends an AP item, so it can never
// affect beatability.

import { useCallback, useEffect, useState } from 'react';
import type { Client } from 'archipelago.js';
import { eatFood, watchFoodEaten } from '../ap/foodstorage';
import { FOOD_ITEMS } from '../game/food';

export interface FoodInventory {
  /** item name -> how many have been eaten (server-authoritative). */
  eaten: Record<string, number>;
  /** Consume one of `item`: increments the eaten counter (optimistic + persisted). */
  eat: (item: string) => void;
}

export function useFood(
  clientRef: React.MutableRefObject<Client | null>,
  connected: boolean,
): FoodInventory {
  const [eaten, setEaten] = useState<Record<string, number>>({});

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !connected) return;
    let cancelled = false;
    const self = client.players.self;
    void watchFoodEaten(client, self.team, self.slot, FOOD_ITEMS, (item, count) => {
      setEaten((prev) => ({ ...prev, [item]: count }));
    }).then((initial) => {
      if (!cancelled) setEaten(initial);
    });
    return () => {
      cancelled = true;
    };
  }, [clientRef, connected]);

  const eat = useCallback(
    (item: string) => {
      const client = clientRef.current;
      if (!client) return;
      const self = client.players.self;
      eatFood(client, self.team, self.slot, item);
      // Optimistic, monotonic local bump; the server notify reconciles to the same.
      setEaten((prev) => ({ ...prev, [item]: (prev[item] ?? 0) + 1 }));
    },
    [clientRef],
  );

  return { eaten, eat };
}
