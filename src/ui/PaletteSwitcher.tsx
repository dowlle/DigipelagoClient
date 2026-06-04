import { Lock, Palette } from 'lucide-react';
import { useTheme } from './useTheme';

/**
 * Compact header palette switcher — a segmented control over the three HUD
 * palettes (Tide / Terminal / Vapor). Locked palettes show a lock affordance
 * and are non-selectable. The Settings view (§3) hosts the canonical gallery;
 * this is the quick-toggle. All visuals are token-driven.
 */
export function PaletteSwitcher() {
  const { theme, setTheme, themes, isThemeUnlocked } = useTheme();

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg p-0.5"
      style={{ backgroundColor: 'var(--dp-bg-elevated)', border: '1px solid var(--dp-border)' }}
      role="group"
      aria-label="Palette"
    >
      <Palette size={14} className="mx-1 shrink-0" style={{ color: 'var(--dp-text-muted)' }} aria-hidden />
      {themes.map((t) => {
        const active = t.id === theme;
        const unlocked = isThemeUnlocked(t.id);
        return (
          <button
            key={t.id}
            type="button"
            disabled={!unlocked}
            data-active={active}
            onClick={() => setTheme(t.id)}
            title={unlocked ? t.tagline : `${t.name} — locked (${t.tagline})`}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              color: active ? 'var(--dp-on-primary)' : 'var(--dp-text-secondary)',
              backgroundColor: active ? 'var(--dp-primary)' : 'transparent',
            }}
          >
            {!unlocked && <Lock size={11} aria-hidden />}
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
