import { useCallback, useEffect, useState } from 'react';

// CSS-only theming: a `data-theme` attribute on <html> selects the token set in
// index.css (mirrors Pokepelago's two-theme UX, without the JS var-writing).
export type ThemeId = 'default' | 'digimon';
const LS_KEY = 'digipelago:theme';

function load(): ThemeId {
  try {
    return localStorage.getItem(LS_KEY) === 'digimon' ? 'digimon' : 'default';
  } catch {
    return 'default';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(load);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'default' ? '' : theme;
    try {
      localStorage.setItem(LS_KEY, theme);
    } catch {
      /* prefs are best-effort */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'default' ? 'digimon' : 'default')), []);
  return { theme, toggle };
}
