import { useCallback, useEffect, useState } from 'react';

// CSS-only theming: a `data-theme` attribute on <html> selects the token set in
// index.css. Three palettes share ONE token vocabulary, so each is a pure
// reskin (Tide default / Terminal / Vapor).
export type ThemeId = 'tide' | 'terminal' | 'vapor';

const LS_KEY = 'digipelago:theme';
const UNLOCKS_KEY = 'digipelago:unlocks';

// Unlock-aware palette catalogue. Tide is always available; Terminal/Vapor are
// gated by a `gamesCompleted` counter (§7). For MVP the gate ships as a no-op
// (all unlocked) but the data shape is kept so the unlock seam plugs in later.
export type Unlock = 'always' | { gamesCompleted: number };
export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  unlock: Unlock;
}

export const THEMES: ThemeMeta[] = [
  { id: 'tide', name: 'Tide', tagline: 'Default · calm deep-teal', unlock: 'always' },
  { id: 'terminal', name: 'Terminal', tagline: 'Phosphor green on near-black', unlock: { gamesCompleted: 0 } },
  { id: 'vapor', name: 'Vapor', tagline: 'Synthwave magenta + cyan', unlock: { gamesCompleted: 0 } },
];

const THEME_IDS = THEMES.map((t) => t.id);

interface Unlocks {
  gamesCompleted: number;
  unlockedThemes: ThemeId[];
}

function loadUnlocks(): Unlocks {
  try {
    const raw = localStorage.getItem(UNLOCKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Unlocks>;
      return {
        gamesCompleted: typeof parsed.gamesCompleted === 'number' ? parsed.gamesCompleted : 0,
        unlockedThemes: Array.isArray(parsed.unlockedThemes) ? parsed.unlockedThemes : [],
      };
    }
  } catch {
    /* best-effort */
  }
  return { gamesCompleted: 0, unlockedThemes: [] };
}

/** Is a palette currently unlocked? Tide always; others by gamesCompleted or an
 *  explicit unlockedThemes entry. MVP no-op flag keeps all three available. */
export function isThemeUnlocked(id: ThemeId, unlocks: Unlocks = loadUnlocks()): boolean {
  const meta = THEMES.find((t) => t.id === id);
  if (!meta || meta.unlock === 'always') return true;
  if (unlocks.unlockedThemes.includes(id)) return true;
  return unlocks.gamesCompleted >= meta.unlock.gamesCompleted;
}

function load(): ThemeId {
  try {
    const stored = localStorage.getItem(LS_KEY);
    // back-compat: map legacy two-state ids onto the new palettes.
    if (stored === 'digimon' || stored === 'default' || stored === '' || stored === null) return 'tide';
    if ((THEME_IDS as string[]).includes(stored)) return stored as ThemeId;
    return 'tide';
  } catch {
    return 'tide';
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(load);

  useEffect(() => {
    // Tide is the default (:root) — clear the attribute so the base tokens apply.
    document.documentElement.dataset.theme = theme === 'tide' ? '' : theme;
    try {
      localStorage.setItem(LS_KEY, theme);
    } catch {
      /* prefs are best-effort */
    }
  }, [theme]);

  // Only switch to an unlocked palette; locked ones are a no-op.
  const setTheme = useCallback((id: ThemeId) => {
    if (isThemeUnlocked(id)) setThemeState(id);
  }, []);

  // Convenience for a header quick-toggle: advance to the next unlocked palette.
  const cycle = useCallback(() => {
    setThemeState((cur) => {
      const start = THEME_IDS.indexOf(cur);
      for (let step = 1; step <= THEME_IDS.length; step += 1) {
        const next = THEME_IDS[(start + step) % THEME_IDS.length];
        if (isThemeUnlocked(next)) return next;
      }
      return cur;
    });
  }, []);

  return { theme, setTheme, cycle, themes: THEMES, isThemeUnlocked };
}
