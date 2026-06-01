// Self-regenerating wrong-pick meter for multiple-choice mode. Each wrong pick
// consumes one charge; charges regenerate on a timer, so a player can NEVER get
// permanently stuck. Because it self-heals it is purely client-side and must
// never gate AP progression (input mode never affects beatability — Game Design).
//
// Model: store the timestamps of wrong picks still "counting". A pick fully
// regenerates regenMs after it happened. remaining = max − (still-counting picks).
// One state value per pick, self-expiring — no per-tick mutation (the timer only
// advances `now` so derived values recompute).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface WrongPickMeter {
  remaining: number;
  max: number;
  blocked: boolean;
  /** Seconds until the next charge regenerates (0 when full). */
  secondsToRegen: number;
  registerWrong: () => void;
}

export function useWrongPickMeter(opts?: { max?: number; regenMs?: number }): WrongPickMeter {
  const max = opts?.max ?? 5;
  const regenMs = opts?.regenMs ?? 30_000;

  const [losses, setLosses] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const nowRef = useRef(now);
  nowRef.current = now;

  // While any losses are counting, tick `now` so derived values self-expire.
  useEffect(() => {
    if (losses.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [losses.length]);

  const active = useMemo(() => losses.filter((t) => now - t < regenMs), [losses, now, regenMs]);

  const remaining = Math.max(0, max - active.length);
  const blocked = remaining <= 0;
  const secondsToRegen = active.length
    ? Math.max(0, Math.ceil((Math.min(...active.map((t) => t + regenMs)) - now) / 1000))
    : 0;

  const registerWrong = useCallback(() => {
    setLosses((prev) => {
      const cur = prev.filter((t) => Date.now() - t < regenMs);
      if (max - cur.length <= 0) return cur; // already blocked — don't stack penalties
      return [...cur, Date.now()];
    });
    setNow(Date.now());
  }, [max, regenMs]);

  return { remaining, max, blocked, secondsToRegen, registerWrong };
}
