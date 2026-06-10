// Moment orchestration (S5) — derives transient toasts from GameState diffs,
// purely as presentation. It NEVER drives logic: it only watches values the
// game already computed (the caught id-set and capacity) and the read-only feed
// rows, and turns transitions into short-lived toast payloads.
//
//   • catch toast    — a new id appears in state.caught → look up the Digimon
//                      (name + sprite) and pair it with the most recent
//                      "catch → shipped" feed row for the "<item> → <player>" line.
//   • capacity toast — state.capacity grew → "Storage expanded +N (from → to)".
//                      Also returns a synthetic capacity feed row to inject.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getDigimon } from '../../data/dataset';
import type { GameState } from '../../game/types';
import type { FeedRow } from '../../ap/feed';
import { capacityRow } from '../../ap/feed';
import type { CatchMoment } from './CatchToast';
import type { CapacityMoment } from './CapacityToast';

const TOAST_MS = 4200;

export interface MomentsResult {
  catchMoment: CatchMoment | null;
  capacityMoment: CapacityMoment | null;
  /** capacity beats to merge into the feed (newest first). */
  capacityRows: FeedRow[];
}

export function useMoments(state: GameState, feed: FeedRow[]): MomentsResult {
  const [catchMoment, setCatchMoment] = useState<CatchMoment | null>(null);
  const [capacityMoment, setCapacityMoment] = useState<CapacityMoment | null>(null);
  const [capacityRows, setCapacityRows] = useState<FeedRow[]>([]);

  // Baselines: seeded from the first render's state so we never fire a toast for
  // the authoritative reconnect/boot replay (only for genuinely new transitions).
  const prevCaught = useRef<Set<number> | null>(null);
  const prevCapacity = useRef<number | null>(null);
  const booted = useRef(false);

  // Latest feed snapshot for pairing a catch with its shipped item.
  const feedRef = useRef(feed);
  feedRef.current = feed;

  useEffect(() => {
    // First pass: record baselines without firing (boot/reconnect replay).
    if (!booted.current) {
      prevCaught.current = new Set(state.caught);
      prevCapacity.current = state.capacity;
      booted.current = true;
      return;
    }

    // New catch? find the id that just appeared.
    const before = prevCaught.current ?? new Set<number>();
    let newId: number | null = null;
    for (const id of state.caught) {
      if (!before.has(id)) {
        newId = id;
        break;
      }
    }
    if (newId != null) {
      const mon = getDigimon(newId);
      if (mon) {
        // Pair with the most recent "catch → shipped" row, if one is present.
        const ship = feedRef.current.find((r) => r.kind === 'catch');
        setCatchMoment({ name: mon.name, sprite: mon.sprite, id: mon.id, item: ship?.item, player: ship?.player });
      }
    }
    prevCaught.current = new Set(state.caught);

    // Capacity grew?
    const prevCap = prevCapacity.current ?? state.capacity;
    if (state.capacity > prevCap) {
      const m: CapacityMoment = { from: prevCap, to: state.capacity, by: state.capacity - prevCap };
      setCapacityMoment(m);
      setCapacityRows((rows) => [capacityRow(prevCap, state.capacity), ...rows].slice(0, 50));
    }
    prevCapacity.current = state.capacity;
    // state.caught is a Set rebuilt each recompute; depend on count + capacity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.caughtCount, state.capacity, state.caught]);

  // Auto-dismiss the catch toast.
  useEffect(() => {
    if (!catchMoment) return;
    const id = window.setTimeout(() => setCatchMoment(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [catchMoment]);

  // Auto-dismiss the capacity toast (slightly longer so both can co-exist).
  useEffect(() => {
    if (!capacityMoment) return;
    const id = window.setTimeout(() => setCapacityMoment(null), TOAST_MS + 600);
    return () => window.clearTimeout(id);
  }, [capacityMoment]);

  return useMemo(
    () => ({ catchMoment, capacityMoment, capacityRows }),
    [catchMoment, capacityMoment, capacityRows],
  );
}
