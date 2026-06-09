// Self-regenerating wrong-pick meter for multiple-choice mode. Each wrong pick
// consumes one charge; charges regenerate SEQUENTIALLY, one dot every regenMs, so
// a burst of wrong picks comes back one at a time (not all at once) and a player
// can NEVER get permanently stuck. Because it self-heals it is purely client-side
// and must never gate AP progression (input mode never affects beatability).
//
// regenMs is seed-configurable (slot_data.tries_regen_seconds). regenMs <= 0 means
// "free guesses": the meter never drains and never blocks.
//
// Model: `spent` = dots currently consumed; `nextRefillAt` = when the next single
// dot comes back. remaining = max - spent, so a Tries Upgrade (raising max) adds a
// filled dot for free. The refill effect catches up multiple dots if a lot of wall
// time passed (e.g. a backgrounded tab or a multi-hour async regen).

import { useCallback, useEffect, useState } from 'react';

export interface WrongPickMeter {
  remaining: number;
  max: number;
  blocked: boolean;
  /** Seconds until the next single charge regenerates (0 when full or free-guess). */
  secondsToRegen: number;
  /** The configured regen interval in ms (0 = free guesses). For UI progress fill. */
  regenMs: number;
  registerWrong: () => void;
  /** Instantly restore `amount` spent points (Infinity = full). Used by eating food. */
  refill: (amount: number) => void;
}

interface MeterState {
  spent: number;
  nextRefillAt: number | null;
}

// --- Persistence (additive, cosmetic-only) ---------------------------------
// The meter is purely client-side UX (see header) and never gates AP. We persist
// MeterState across refreshes so an F5 no longer snaps the meter back to full;
// because nextRefillAt is an absolute wall-clock timestamp, the existing catch-up
// refill effect immediately regenerates by elapsed time on rehydrate. Free-guess
// seeds (regenMs <= 0) persist nothing, so they are byte-for-byte unaffected.

/** Per-seat key, matching datastorage.ts team+slot convention so two seeds do
 *  not share a meter. Reconnecting to the same seat reuses its meter. */
export function staminaStorageKey(team: number, slot: number): string {
  return `digipelago:stamina:${team}:${slot}`;
}

/** Rehydrate a saved MeterState. SSR/Node-safe and strict: any missing, corrupt,
 *  or legacy-shaped value returns null so the caller falls back to a full meter. */
export function loadMeterState(key: string): MeterState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { spent, nextRefillAt } = parsed as Record<string, unknown>;
    if (typeof spent !== 'number' || !Number.isInteger(spent) || spent < 0) return null;
    if (nextRefillAt !== null && (typeof nextRefillAt !== 'number' || !Number.isFinite(nextRefillAt))) {
      return null;
    }
    return { spent, nextRefillAt: nextRefillAt as number | null };
  } catch {
    return null;
  }
}

/** Best-effort persist (mirrors useTheme.ts / spriteConsent.ts). Never throws. */
export function saveMeterState(key: string, state: MeterState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* prefs are best-effort */
  }
}

export function useWrongPickMeter(opts?: { max?: number; regenMs?: number; storageKey?: string }): WrongPickMeter {
  const max = opts?.max ?? 5;
  const regenMs = opts?.regenMs ?? 30_000;
  const noPenalty = regenMs <= 0;
  const storageKey = opts?.storageKey;

  // Lazy initializer: rehydrate from storage when a key is set, else start full.
  // The catch-up refill effect (below) recomputes elapsed regen against the saved
  // absolute nextRefillAt, so a closed/refreshed tab regenerates by elapsed time.
  const [m, setM] = useState<MeterState>(
    () => (storageKey ? loadMeterState(storageKey) : null) ?? { spent: 0, nextRefillAt: null },
  );
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while a refill is pending so the countdown stays live.
  useEffect(() => {
    if (m.nextRefillAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [m.nextRefillAt]);

  // Process due refills: one dot per regenMs, sequential, catching up if needed.
  useEffect(() => {
    if (m.nextRefillAt === null || now < m.nextRefillAt) return;
    setM((cur) => {
      if (cur.nextRefillAt === null) return cur;
      let spent = cur.spent;
      let nextRefillAt: number | null = cur.nextRefillAt;
      while (nextRefillAt !== null && now >= nextRefillAt && spent > 0) {
        spent -= 1;
        nextRefillAt = spent > 0 ? nextRefillAt + regenMs : null;
      }
      if (spent <= 0) nextRefillAt = null;
      return { spent, nextRefillAt };
    });
  }, [now, m.nextRefillAt, regenMs]);

  // Persist every spend / refill / catch-up so a refresh resumes mid-regen. Skip
  // for free-guess seeds (noPenalty): spent stays 0 so there is nothing to save.
  useEffect(() => {
    if (storageKey && !noPenalty) saveMeterState(storageKey, m);
  }, [storageKey, noPenalty, m]);

  const remaining = Math.max(0, max - m.spent);
  const blocked = !noPenalty && remaining <= 0;
  const secondsToRegen = m.nextRefillAt ? Math.max(0, Math.ceil((m.nextRefillAt - now) / 1000)) : 0;

  const registerWrong = useCallback(() => {
    if (noPenalty) return; // free guesses: never drain
    // Refresh `now` so the countdown label is correct on the very first frame
    // (the 1s ticker only starts once a refill is pending).
    setNow(Date.now());
    setM((cur) => {
      if (cur.spent >= max) return cur; // already empty, don't over-spend
      return {
        spent: cur.spent + 1,
        nextRefillAt: cur.nextRefillAt ?? Date.now() + regenMs, // start the queue if idle
      };
    });
  }, [noPenalty, max, regenMs]);

  const refill = useCallback((amount: number) => {
    if (amount <= 0) return;
    setM((cur) => {
      if (cur.spent <= 0) return cur;
      const spent = Math.max(0, cur.spent - amount);
      return { spent, nextRefillAt: spent > 0 ? cur.nextRefillAt : null };
    });
  }, []);

  return { remaining, max, blocked, secondsToRegen, regenMs, registerWrong, refill };
}
