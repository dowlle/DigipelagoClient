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

export function useWrongPickMeter(opts?: { max?: number; regenMs?: number }): WrongPickMeter {
  const max = opts?.max ?? 5;
  const regenMs = opts?.regenMs ?? 30_000;
  const noPenalty = regenMs <= 0;

  const [m, setM] = useState<MeterState>({ spent: 0, nextRefillAt: null });
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
