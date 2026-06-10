// The orchestrator. Owns SlotData + GameState, supplies the connection handlers,
// and rebuilds all state from the server on connect (ADR-0002: "connected" is the
// source-of-truth boot event; localStorage holds only connection + prefs).
//
// The once-bound connection handlers read latest values through refs, never
// closures, and every server-derived quantity is reconciled MONOTONICALLY
// (caughtCount and the caught id-set only ever grow) so an unrelated recompute
// between an optimistic catch and the server echo can't briefly undo it.

import {
  createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode,
} from 'react';
import type { Client } from 'archipelago.js';
import { useAPConnection, type ConnectionInfo } from '../ap/connection';
import { appendCaught, watchCaught } from '../ap/datastorage';
import { catchSlotId, countCheckedCatchSlots } from '../ap/locations';
import { recordEvent, flushTelemetry } from '../api/backend';
import { DATASET_VERSION, getDigimon } from '../data/dataset';
import { goalReached } from './guess';
import { assertDatasetMatches, buildState } from './state';
import type { GameState, SlotData } from './types';

const EMPTY_STATE: GameState = {
  capacity: 0,
  tierReached: 0,
  heldAttributes: new Set(),
  caught: new Set(),
  caughtCount: 0,
  staminaUps: 0,
  foodReceived: {},
};

interface Identity {
  team: number;
  slot: number;
}

export interface GameContextValue {
  isConnected: boolean;
  connectionError: string | null;
  slotData: SlotData | null;
  state: GameState;
  /** True once the seed's goal is met (derived; stays true for the session). */
  isGoalReached: boolean;
  connect: (info: ConnectionInfo) => Promise<void>;
  disconnect: () => void;
  /** Dispatch a correct guess: check the next catch slot + record caught identity. */
  catchDigimon: (digimonId: number) => void;
  /**
   * Read-only handle on the live AP client, for presentation-only subscribers
   * (e.g. the multiworld feed in src/ap/feed.ts). NEVER use this to drive game
   * logic or send packets — it exists purely to *read* item/message streams.
   */
  clientRef: React.MutableRefObject<Client | null>;
}

const GameContext = createContext<GameContextValue | undefined>(undefined);

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within a GameProvider');
  return ctx;
}

function unionInto(base: Set<number>, extra: Iterable<number>): Set<number> {
  const merged = new Set(base);
  for (const v of extra) merged.add(v);
  return merged.size === base.size ? base : merged;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const ap = useAPConnection();
  const [slotData, setSlotData] = useState<SlotData | null>(null);
  const [state, setState] = useState<GameState>(EMPTY_STATE);

  // Latest-value refs for the once-bound handlers (avoid stale closures).
  const slotDataRef = useRef<SlotData | null>(null);
  const caughtRef = useRef<Set<number>>(new Set());
  const caughtCountRef = useRef(0); // monotonic
  const identityRef = useRef<Identity | null>(null);
  const connectedAtRef = useRef<number | null>(null); // telemetry session timer

  const goalSentRef = useRef(false); // per-connection CLIENT_GOAL guard

  const recompute = useCallback((client: Client) => {
    const slot = slotDataRef.current;
    if (!slot) return;
    caughtCountRef.current = Math.max(caughtCountRef.current, countCheckedCatchSlots(client));
    const itemNames = client.items.received.map((i) => i.name);
    const next = buildState(slot, itemNames, caughtCountRef.current, caughtRef.current);
    setState(next);

    // Goal met: report CLIENT_GOAL to the server (once per connection; the
    // server ignores duplicates and the status can never be unset). This is
    // what marks the slot as finished for the room (release/collect etc.).
    if (!goalSentRef.current && goalReached(next, slot, getDigimon)) {
      goalSentRef.current = true;
      try {
        client.goal();
      } catch {
        /* best-effort; a reconnect retries */
      }
      recordEvent({ event_type: 'goal' });
    }
  }, []);

  const handlers = useMemo(
    () => ({
      onConnected: async (client: Client, slot: SlotData) => {
        assertDatasetMatches(slot, DATASET_VERSION); // refuse a drifted seed
        slotDataRef.current = slot;
        setSlotData(slot);
        goalSentRef.current = false; // fresh connection: (re)assert goal if met

        // Telemetry: anonymous session start (fire-and-forget).
        connectedAtRef.current = Date.now();
        recordEvent({ event_type: 'session_start' });

        const id: Identity = { team: client.players.self.team, slot: client.players.self.slot };
        identityRef.current = id;

        // Authoritative reset from the server (re-notify after every reconnect).
        const serverCaught = await watchCaught(client, id.team, id.slot, (remote) => {
          caughtRef.current = unionInto(caughtRef.current, remote);
          recompute(client);
        });
        caughtRef.current = serverCaught;
        caughtCountRef.current = countCheckedCatchSlots(client);
        recompute(client);
      },
      onDisconnected: () => {
        // Keep last-known state on screen; refs persist for a clean reconnect.
        // Telemetry: close the session out and flush the final batch.
        const startedAt = connectedAtRef.current;
        if (startedAt != null) {
          recordEvent({ event_type: 'session_end', payload: { duration_ms: Date.now() - startedAt } });
          connectedAtRef.current = null;
        }
        void flushTelemetry();
      },
      onItemsReceived: (client: Client) => recompute(client),
      onLocationsChecked: (client: Client) => recompute(client),
    }),
    [recompute],
  );

  const connect = useCallback(
    (info: ConnectionInfo) => ap.connect(info, handlers),
    [ap, handlers],
  );

  const catchDigimon = useCallback(
    (digimonId: number) => {
      const client = ap.clientRef.current;
      const id = identityRef.current;
      if (!client || !id) return;

      const nextK = caughtCountRef.current + 1;
      const locId = catchSlotId(client, nextK);
      if (locId == null) return; // dataset/package not ready

      client.check(locId); // sequential check keeps caughtCount === checked-slot count
      appendCaught(client, id.team, id.slot, digimonId); // append-only identity (ADR-0002)

      // Optimistic, monotonic local update; the server echo reconciles to the same.
      caughtRef.current = unionInto(caughtRef.current, [digimonId]);
      caughtCountRef.current = nextK;
      recompute(client);

      // Telemetry: a catch in ANY mode (free-text / hard / silhouette / typed).
      const mon = getDigimon(digimonId);
      if (mon) {
        recordEvent({
          event_type: 'catch',
          payload: { target_id: digimonId, level: mon.level, attribute: mon.attribute },
        });
      }
    },
    [ap.clientRef, recompute],
  );

  const isGoalReached = useMemo(
    () => (slotData ? goalReached(state, slotData, getDigimon) : false),
    [state, slotData],
  );

  const value: GameContextValue = {
    isConnected: ap.isConnected,
    connectionError: ap.connectionError,
    slotData,
    state,
    isGoalReached,
    connect,
    disconnect: ap.disconnect,
    catchDigimon,
    clientRef: ap.clientRef,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
