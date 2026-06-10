// Win moment (game wins = theme unlocks). Watches the context's isGoalReached
// flag; on the transition into "goal met" it counts the win once per seed+seat
// (game/wins.ts marker), converts it into palette unlocks (useTheme), pushes
// the unlock set to the account (best-effort, logged-out is fine), and surfaces
// a one-shot toast payload. Reconnecting to an already-won seed shows nothing.

import { useEffect, useRef, useState } from 'react';
import type { Client } from 'archipelago.js';
import { markWinCounted, winKey } from '../../game/wins';
import { putThemes } from '../../api/backend';
import { loadUnlockedThemeIds, recordGameCompletion, THEMES, type ThemeId } from '../useTheme';

const TOAST_MS = 8000;

export interface WinMoment {
  /** Palette names newly unlocked by this win (may be empty). */
  unlockedNames: string[];
}

export function useWinUnlocks(
  isGoalReached: boolean,
  clientRef: React.MutableRefObject<Client | null>,
  isConnected: boolean,
): WinMoment | null {
  const [moment, setMoment] = useState<WinMoment | null>(null);
  const firedRef = useRef(false); // once per mount; the seed marker covers remounts

  useEffect(() => {
    if (!isGoalReached || !isConnected || firedRef.current) return;
    firedRef.current = true;

    let key: string | null = null;
    try {
      const client = clientRef.current;
      const self = client?.players.self;
      const seed = client?.room.seedName;
      if (seed && self) key = winKey(seed, self.team, self.slot);
    } catch {
      /* identity unavailable: skip counting rather than risk double-counting */
    }
    if (!key || !markWinCounted(key)) return;

    const newly: ThemeId[] = recordGameCompletion();
    if (newly.length > 0) {
      // Sync the grown unlock set to the account (no-op when logged out).
      putThemes(loadUnlockedThemeIds()).catch(() => undefined);
    }
    const names = THEMES.filter((t) => newly.includes(t.id)).map((t) => t.name);
    setMoment({ unlockedNames: names });
  }, [isGoalReached, isConnected, clientRef]);

  // Auto-dismiss.
  useEffect(() => {
    if (!moment) return;
    const id = window.setTimeout(() => setMoment(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [moment]);

  return moment;
}
