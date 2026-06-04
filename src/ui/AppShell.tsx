// HUD layout shell (S3) — left sidebar nav rail + main column with a tiny
// view router. Presentation only: it reads game state and switches which
// presentation surface is mounted. No game/ap/data behaviour change.
//
//   Views: Play / Digidex / Multiworld / Settings.
//   Pre-connect, the connection screen is forced regardless of the view.
//
// Ports NavRail + the shell layout from hud-deep.jsx / hud-deep2.jsx, but
// token-driven and fed by real context state.

import { useState, type ReactNode } from 'react';
import { Play, Grid3x3, Globe, Settings as SettingsIcon, Palette } from 'lucide-react';
import { useGame } from '../game/context';
import { PaletteSwitcher } from './PaletteSwitcher';
import { ConnectionPanel } from './ConnectionPanel';
import { FreeTextPanel } from './FreeTextPanel';
import { MultipleChoice } from './MultipleChoice';
import { DexGrid } from './DexGrid';
import { StatusCards } from './StatusCards';

export type View = 'play' | 'dex' | 'multiworld' | 'settings';
type Mode = 'text' | 'mc';

const LS_CONN = 'digipelago:lastConnection';

/** Best-effort read of the saved server address — pure presentation, no AP read. */
function savedAddress(): string | null {
  try {
    const raw = localStorage.getItem(LS_CONN);
    if (!raw) return null;
    const { hostname, port } = JSON.parse(raw) as { hostname?: string; port?: string };
    if (hostname && port) return `${hostname}:${port}`;
  } catch {
    /* ignore corrupt prefs */
  }
  return null;
}

/** Best-effort read of the saved slot name — pure presentation, no AP read. */
function savedSlotName(): string | null {
  try {
    const raw = localStorage.getItem(LS_CONN);
    if (!raw) return null;
    const { slotName } = JSON.parse(raw) as { slotName?: string };
    return slotName || null;
  } catch {
    return null;
  }
}

// Invented wordmark — non-commercial fan project, no trademarked branding.
function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden style={{ filter: 'drop-shadow(0 0 5px var(--dp-primary))' }}>
        <path d="M12 1l9 6.5v9L12 23l-9-6.5v-9z" fill="none" stroke="var(--dp-primary)" strokeWidth="1.6" />
        <path d="M12 6l5 3.6v5L12 18l-5-3.4v-5z" fill="var(--dp-primary)" opacity="0.18" />
        <circle cx="12" cy="12" r="2.4" fill="var(--dp-primary)" />
      </svg>
      <span className="text-[15px] font-bold tracking-wide" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
        DIGIPELAGO
      </span>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="dp-nav-item" data-active={active} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {badge != null && (
        <span className="text-[11px] font-semibold" style={{ color: 'var(--dp-text-faint)', fontFamily: 'var(--dp-font-disp)' }}>
          {badge}
        </span>
      )}
    </button>
  );
}

function NavRail({
  view,
  setView,
  caughtCount,
  slotName,
}: {
  view: View;
  setView: (v: View) => void;
  caughtCount: number;
  slotName: string | null;
}) {
  const addr = savedAddress();
  const ic = { size: 18, strokeWidth: 1.8 } as const;
  return (
    <nav className="dp-rail hidden w-[210px] shrink-0 flex-col p-4 md:flex" aria-label="Primary">
      <div className="mb-5">
        <Wordmark />
      </div>
      <div className="flex flex-col gap-1">
        <NavItem icon={<Play {...ic} fill="currentColor" />} label="Play" active={view === 'play'} onClick={() => setView('play')} />
        <NavItem icon={<Grid3x3 {...ic} />} label="Digidex" badge={caughtCount} active={view === 'dex'} onClick={() => setView('dex')} />
        <NavItem icon={<Globe {...ic} />} label="Multiworld" active={view === 'multiworld'} onClick={() => setView('multiworld')} />
        <NavItem icon={<SettingsIcon {...ic} />} label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
      </div>
      {/* Connection card */}
      <div className="mt-auto">
        <div className="dp-card p-3" style={{ background: 'var(--dp-card-2)' }}>
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold"
              style={{
                background: 'color-mix(in srgb, var(--dp-primary) 15%, transparent)',
                border: '1.5px solid var(--dp-primary)',
                color: 'var(--dp-primary)',
                fontFamily: 'var(--dp-font-disp)',
              }}
            >
              {(slotName ?? '?').charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
                {slotName ?? 'Not connected'}
              </div>
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--dp-good)' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--dp-good)', boxShadow: '0 0 6px var(--dp-good)' }} />
                connected
              </div>
            </div>
          </div>
          {addr && (
            <div
              className="mt-2.5 truncate border-t pt-2.5 text-[11px]"
              style={{ color: 'var(--dp-text-faint)', borderColor: 'var(--dp-line)' }}
            >
              {addr}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

/** Compact mobile bottom tab bar (rail collapses below md). */
function MobileTabs({ view, setView }: { view: View; setView: (v: View) => void }) {
  const ic = { size: 20, strokeWidth: 1.8 } as const;
  const tab = (v: View, label: string, icon: ReactNode) => (
    <button
      type="button"
      className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold"
      data-active={view === v}
      onClick={() => setView(v)}
      style={{
        color: view === v ? 'var(--dp-primary)' : 'var(--dp-text-mid)',
        fontFamily: 'var(--dp-font-disp)',
      }}
      aria-current={view === v ? 'page' : undefined}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex md:hidden"
      style={{ background: 'var(--dp-rail)', borderTop: '1px solid var(--dp-line)' }}
      aria-label="Primary"
    >
      {tab('play', 'Play', <Play {...ic} fill="currentColor" />)}
      {tab('dex', 'Digidex', <Grid3x3 {...ic} />)}
      {tab('multiworld', 'World', <Globe {...ic} />)}
      {tab('settings', 'Settings', <SettingsIcon {...ic} />)}
    </nav>
  );
}

function ModeTabs({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button className="dp-toggle-btn" data-active={mode === 'text'} onClick={() => setMode('text')}>
        Free-text
      </button>
      <button className="dp-toggle-btn" data-active={mode === 'mc'} onClick={() => setMode('mc')}>
        Silhouette
      </button>
    </div>
  );
}

function SettingsView({ slotName }: { slotName: string | null }) {
  const addr = savedAddress();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
        Settings
      </h2>
      <div className="dp-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Palette size={16} style={{ color: 'var(--dp-primary)' }} aria-hidden />
          <span className="text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
            Palette
          </span>
        </div>
        <p className="mb-3 text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
          Choose a colour palette. The whole HUD reskins instantly.
        </p>
        <PaletteSwitcher />
      </div>
      <div className="dp-card p-5">
        <span className="mb-2 block text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          Connection
        </span>
        <dl className="text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
          <div className="flex justify-between py-1">
            <dt>Slot</dt>
            <dd style={{ color: 'var(--dp-text)' }}>{slotName ?? '—'}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt>Server</dt>
            <dd style={{ color: 'var(--dp-text)' }}>{addr ?? '—'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="dp-card flex flex-col items-center justify-center gap-2 p-10 text-center">
      <h2 className="text-lg font-bold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
        {title}
      </h2>
      <p className="max-w-md text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
        {blurb}
      </p>
    </div>
  );
}

export function AppShell() {
  const { isConnected, slotData, state, disconnect } = useGame();
  const [view, setView] = useState<View>('play');
  const [mode, setMode] = useState<Mode>('text');
  const connected = isConnected && slotData;

  // Pre-connect: force the connection screen regardless of the selected view.
  if (!connected) {
    return (
      <div className="min-h-screen text-white font-sans themed-bg flex items-center justify-center p-4">
        <div className="w-full max-w-xl">
          <div className="mb-5 flex justify-center">
            <Wordmark />
          </div>
          <ConnectionPanel />
        </div>
      </div>
    );
  }

  const slot = savedSlotName();

  let main: ReactNode;
  if (view === 'play') {
    main = (
      <div className="flex flex-col gap-4">
        <StatusCards state={state} slotData={slotData} />
        <ModeTabs mode={mode} setMode={setMode} />
        {mode === 'text' ? <FreeTextPanel /> : <MultipleChoice />}
      </div>
    );
  } else if (view === 'dex') {
    main = <DexGrid />;
  } else if (view === 'multiworld') {
    main = (
      <ComingSoon
        title="Multiworld"
        blurb="The full multiworld activity feed — catches, items sent and received, capacity bumps and peer milestones — lands here."
      />
    );
  } else {
    main = <SettingsView slotName={slot} />;
  }

  return (
    <div className="min-h-screen text-white font-sans themed-bg">
      <div className="flex min-h-screen">
        <NavRail view={view} setView={setView} caughtCount={state.caughtCount} slotName={slot} />
        <main className="flex-1 px-3 pb-20 pt-4 sm:px-5 md:pb-6">
          <div className="mx-auto w-full max-w-screen-xl">
            {/* Top bar: quick palette toggle + disconnect (rail hosts nav). */}
            <div className="mb-4 flex items-center justify-end gap-2">
              <PaletteSwitcher />
              <button className="dp-btn-danger" onClick={disconnect}>
                Disconnect
              </button>
            </div>
            {main}
          </div>
        </main>
      </div>
      <MobileTabs view={view} setView={setView} />
    </div>
  );
}
