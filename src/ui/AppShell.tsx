// HUD layout shell (S3) — left sidebar nav rail + main column with a tiny
// view router. Presentation only: it reads game state and switches which
// presentation surface is mounted. No game/ap/data behaviour change.
//
//   Views: Play / Digidex / Multiworld / Settings.
//   Pre-connect, the connection screen is forced regardless of the view.
//
// Ports NavRail + the shell layout from hud-deep.jsx / hud-deep2.jsx, but
// token-driven and fed by real context state.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Play, Grid3x3, Globe, Settings as SettingsIcon, Palette, Lock, Image as ImageIcon, User } from 'lucide-react';
import { useGame } from '../game/context';
import { useAuth } from '../api/useAuth';
import { getThemes, putThemes, recordEvent } from '../api/backend';
import { loadUnlockedThemeIds, mergeUnlockedThemeIds } from './useTheme';
import { useFeed, type FeedRow } from '../ap/feed';
import { getDigimon } from '../data/dataset';
import type { McDifficulty } from '../game/mc';
import { PaletteSwitcher } from './PaletteSwitcher';
import { ConnectionPanel } from './ConnectionPanel';
import { FreeTextPanel } from './FreeTextPanel';
import { MultipleChoice } from './MultipleChoice';
import { DexGrid } from './DexGrid';
import { StatusCards } from './StatusCards';
import { FeedRail, FullFeed } from './Feed';
import { CatchToast } from './moments/CatchToast';
import { CapacityToast } from './moments/CapacityToast';
import { useMoments } from './moments/useMoments';
import { useWrongPickMeter, staminaStorageKey } from './useWrongPickMeter';
import { useFood } from './useFood';
import { FOODS, FOOD_REFILL } from '../game/food';
import { setSpriteConsent, useSpriteConsent } from './spriteConsent';

export type View = 'play' | 'dex' | 'multiworld' | 'settings';
type Mode = 'text' | 'mc' | 'random';

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
  feedCount,
  slotName,
}: {
  view: View;
  setView: (v: View) => void;
  caughtCount: number;
  feedCount: number;
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
        <NavItem
          icon={<Globe {...ic} />}
          label="Multiworld"
          badge={feedCount > 0 ? feedCount : undefined}
          active={view === 'multiworld'}
          onClick={() => setView('multiworld')}
        />
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

// The lock now reads ON the switch buttons themselves (backlog #5): when the
// seed fixes the mode (allow_mode_switch: false) every NON-active mode button
// shows a small lock glyph + a "Locked by seed" tooltip and dims, while the
// chosen mode reads normally. Pure presentation: the buttons stay non-interactive
// exactly as before and nothing here gates AP beatability (input mode never did).
const MODE_LOCK_TITLE = 'Locked by seed (mode switching is off)';

/** Per-button lock affordance for the mode switch. A button only reads as
 *  "locked" when modes are seed-locked AND it is not the active mode; the active
 *  button always reads normally so it shows the mode the seed fixed you to.
 *  Pure + DOM-free so it can be unit-tested without a renderer. */
export function modeButtonLock(active: boolean, locked: boolean): { showLock: boolean; title?: string } {
  const showLock = locked && !active;
  return { showLock, title: showLock ? MODE_LOCK_TITLE : undefined };
}

function ModeButton({
  label,
  active,
  locked,
  onSelect,
  title,
}: {
  label: string;
  active: boolean;
  locked: boolean;
  onSelect: () => void;
  title?: string;
}) {
  const { showLock, title: lockTitle } = modeButtonLock(active, locked);
  return (
    <button
      type="button"
      className="dp-toggle-btn inline-flex items-center gap-1"
      data-active={active}
      disabled={locked}
      onClick={() => !locked && onSelect()}
      // No .dp-toggle-btn:disabled rule exists in index.css, so dim the locked,
      // non-active buttons inline (mirrors FreeTextPanel's cursor-not-allowed/opacity).
      style={showLock ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
      title={lockTitle ?? title}
      aria-label={showLock ? `${label} (locked by seed)` : undefined}
    >
      {showLock && <Lock size={11} aria-hidden />}
      {label}
    </button>
  );
}

function ModeTabs({ mode, setMode, locked = false }: { mode: Mode; setMode: (m: Mode) => void; locked?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <ModeButton label="Free-text" active={mode === 'text'} locked={locked} onSelect={() => setMode('text')} />
      <ModeButton label="Silhouette" active={mode === 'mc'} locked={locked} onSelect={() => setMode('mc')} />
      <ModeButton
        label="Random"
        active={mode === 'random'}
        locked={locked}
        onSelect={() => setMode('random')}
        title="Each round randomly rolls type-the-name or multiple-choice"
      />
    </div>
  );
}

function SpriteSettings() {
  const consent = useSpriteConsent();
  const on = consent === 'granted';
  return (
    <div className="dp-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <ImageIcon size={16} style={{ color: 'var(--dp-primary)' }} aria-hidden />
        <span className="text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          Digimon images
        </span>
      </div>
      <p className="mb-3 text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
        Digipelago does not host Digimon art. With this on, your browser fetches images from
        digi-api.com and caches them on this device. Required for Silhouette mode.
      </p>
      <div className="flex items-center gap-2">
        <button className="dp-btn dp-btn-primary" disabled={on} onClick={() => setSpriteConsent('granted')}>
          {on ? 'Images on' : 'Allow images'}
        </button>
        <button className="dp-toggle-btn" disabled={!on} onClick={() => setSpriteConsent('denied')}>
          Turn off
        </button>
      </div>
    </div>
  );
}

const DIFFICULTY_OPTS: { value: McDifficulty; label: string; hint: string }[] = [
  { value: 'easy', label: 'Easy', hint: 'distractors from anywhere' },
  { value: 'normal', label: 'Normal', hint: 'same-level distractors' },
  { value: 'hard', label: 'Hard', hint: 'same-base variants' },
  { value: 'telemetry', label: 'Crowd', hint: 'sharpened by real play' },
];

function DifficultySettings({
  value,
  onChange,
  locked,
}: {
  value: McDifficulty;
  onChange: (v: McDifficulty) => void;
  locked: boolean;
}) {
  return (
    <div className="dp-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Grid3x3 size={16} style={{ color: 'var(--dp-primary)' }} aria-hidden />
        <span className="text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          Silhouette difficulty
        </span>
      </div>
      <p className="mb-3 text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
        How hard the wrong multiple-choice options are to tell apart. Affects Silhouette and
        Random modes only; never changes what is beatable.
      </p>
      <div className="flex flex-wrap gap-2">
        {DIFFICULTY_OPTS.map((o) => (
          <button
            key={o.value}
            type="button"
            className="dp-toggle-btn"
            data-active={value === o.value}
            disabled={locked}
            onClick={() => !locked && onChange(o.value)}
            title={o.hint}
          >
            {o.label}
          </button>
        ))}
      </div>
      {locked && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--dp-text-faint)' }}>
          <Lock size={11} aria-hidden /> locked by seed
        </p>
      )}
    </div>
  );
}

/** Account card: logged out shows a Discord login button; logged in shows the
 *  profile + logout. On a fresh login we MERGE the localStorage theme unlocks
 *  with the server's set (UNION both ways) so unlocks follow the account. */
function AccountSettings() {
  const { me, login, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const synced = useRef(false);

  // Once, after we know the user is logged in, reconcile theme unlocks: push the
  // local set to the server (UNION upsert) and merge the returned union back into
  // localStorage. Best-effort, never blocks the UI.
  useEffect(() => {
    if (!me || synced.current) return;
    synced.current = true;
    (async () => {
      try {
        const local = loadUnlockedThemeIds();
        // Seed the server with local unlocks, then merge the server union back.
        const serverUnion = await putThemes(local);
        const remote = serverUnion.length ? serverUnion : await getThemes();
        mergeUnlockedThemeIds(remote);
      } catch {
        /* unlock sync is best-effort; local stays the baseline */
      }
    })();
  }, [me]);

  const onLogout = async () => {
    setBusy(true);
    try {
      await logout();
      synced.current = false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dp-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <User size={16} style={{ color: 'var(--dp-primary)' }} aria-hidden />
        <span className="text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          Account
        </span>
      </div>
      {me ? (
        <>
          <p className="mb-3 text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
            Signed in with Discord. Your unlocked palettes sync to this account across devices.
          </p>
          <dl className="mb-3 text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
            <div className="flex justify-between py-1">
              <dt>Discord</dt>
              <dd style={{ color: 'var(--dp-text)' }}>{me.username ?? me.discord_id}</dd>
            </div>
          </dl>
          <button className="dp-toggle-btn" disabled={busy} onClick={onLogout}>
            {busy ? 'Signing out...' : 'Logout'}
          </button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
            Optional. Sign in to sync unlocked palettes and save connections to ap-pie.com.
            Logged out, everything stays on this device.
          </p>
          <button className="dp-btn dp-btn-primary" onClick={login}>
            Login with Discord
          </button>
        </>
      )}
    </div>
  );
}

function SettingsView({
  slotName,
  mcDifficulty,
  setMcDifficulty,
  modeLocked,
}: {
  slotName: string | null;
  mcDifficulty: McDifficulty;
  setMcDifficulty: (v: McDifficulty) => void;
  modeLocked: boolean;
}) {
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
      <AccountSettings />
      <DifficultySettings value={mcDifficulty} onChange={setMcDifficulty} locked={modeLocked} />
      <SpriteSettings />
      <div className="dp-card p-5">
        <span className="mb-2 block text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          Connection
        </span>
        <dl className="text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
          <div className="flex justify-between py-1">
            <dt>Slot</dt>
            <dd style={{ color: 'var(--dp-text)' }}>{slotName ?? '-'}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt>Server</dt>
            <dd style={{ color: 'var(--dp-text)' }}>{addr ?? '-'}</dd>
          </div>
        </dl>
      </div>
      <div className="dp-card p-5">
        <span className="mb-2 block text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          About
        </span>
        <p className="text-xs" style={{ color: 'var(--dp-text-secondary)' }}>
          Digipelago is an unofficial, non-commercial fan project. Digimon is the property of its
          respective owners; no Digimon artwork is hosted by this site.
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--dp-text-faint)' }}>
          Source (AGPL-3.0):{' '}
          <a
            href="https://github.com/dowlle/DigipelagoClient"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--dp-primary)' }}
          >
            github.com/dowlle/DigipelagoClient
          </a>
        </p>
      </div>
    </div>
  );
}

export function AppShell() {
  const { isConnected, slotData, state, disconnect, clientRef } = useGame();
  const [view, setView] = useState<View>('play');
  const [mode, setMode] = useState<Mode>('text');
  // Hard-mode (clue) toggle is lifted here so the seed can set/lock it (it used to
  // live inside FreeTextPanel). 'free_text_hard' = mode 'text' + hard true.
  const [hard, setHard] = useState(false);
  // Silhouette distractor difficulty (FEAT-01): seed sets the default, the player
  // can retune it in Settings unless the seed locked modes.
  const [mcDifficulty, setMcDifficulty] = useState<McDifficulty>('normal');
  const connected = isConnected && slotData;

  // Apply the seed's starting input mode + difficulty once, when slot_data first
  // arrives. Older seeds omit these, so we leave the client's free-choice defaults.
  const modeInited = useRef(false);
  useEffect(() => {
    if (modeInited.current || !slotData) return;
    modeInited.current = true;
    switch (slotData.starting_mode) {
      case 'silhouette': setMode('mc'); setHard(false); break;
      case 'mixed': setMode('random'); setHard(false); break;
      case 'free_text_hard': setMode('text'); setHard(true); break;
      case 'free_text': setMode('text'); setHard(false); break;
      default: break; // undefined: keep free-choice defaults
    }
    if (slotData.mc_difficulty) setMcDifficulty(slotData.mc_difficulty);
  }, [slotData]);

  // Lock is advisory/client-side: the seed can set allow_mode_switch:false to fix
  // the mode + hard toggle. Default (or older seeds) = free choice.
  const modeLocked = slotData?.allow_mode_switch === false;

  // Silhouette-mode Stamina meter, owned here so it survives switching between
  // Free-text/Silhouette modes and between views (MultipleChoice unmounts).
  // Max = seed's starting_stamina + every received "Stamina Up"; regen pace is
  // seed-configured (stamina_regen_seconds; 0 = free guesses, default 30s/point).
  const staminaMax = (slotData?.starting_stamina ?? 5) + state.staminaUps;
  const staminaRegenMs = (slotData?.stamina_regen_seconds ?? 30) * 1000;
  // Per-seat persistence key from the live client's numeric team+slot (the same
  // identity datastorage.ts keys catches on). Undefined until connected/identity
  // is known, so the meter stays in-memory pre-connect; it adopts the key once
  // identity resolves. Same client/players access pattern as the `seats` memo,
  // but keyed only on isConnected/clientRef: self's team+slot is fixed per seat
  // and (unlike the seat COUNT) never changes when peers join, and apRows is
  // declared further down so it cannot be a dependency here.
  const staminaKey = useMemo(() => {
    if (!isConnected) return undefined;
    try {
      const self = clientRef.current?.players.self;
      const team = self?.team;
      const slot = self?.slot;
      return team != null && slot != null ? staminaStorageKey(team, slot) : undefined;
    } catch {
      return undefined;
    }
  }, [isConnected, clientRef]);
  const mcMeter = useWrongPickMeter({ max: staminaMax, regenMs: staminaRegenMs, storageKey: staminaKey });

  // Telemetry (fire-and-forget): input-mode switches + stamina exhaustion.
  const prevModeRef = useRef<Mode | null>(null);
  useEffect(() => {
    if (prevModeRef.current && prevModeRef.current !== mode) {
      recordEvent({ event_type: 'mode_switch', payload: { from: prevModeRef.current, to: mode } });
    }
    prevModeRef.current = mode;
  }, [mode]);
  const wasBlockedRef = useRef(false);
  useEffect(() => {
    if (mcMeter.blocked && !wasBlockedRef.current) {
      recordEvent({ event_type: 'stamina_blocked' });
    }
    wasBlockedRef.current = mcMeter.blocked;
  }, [mcMeter.blocked]);

  // Food inventory: received counts come from GameState (AP item stream); eaten
  // counts come from DataStorage via useFood. Eating refills Stamina instantly.
  const foodInv = useFood(clientRef, isConnected);
  const foodAvailable = useMemo(() => {
    const avail: Record<string, number> = {};
    for (const f of FOODS) {
      avail[f.item] = Math.max(0, (state.foodReceived[f.item] ?? 0) - (foodInv.eaten[f.item] ?? 0));
    }
    return avail;
  }, [state.foodReceived, foodInv.eaten]);
  const eatFoodItem = (item: string) => {
    if ((foodAvailable[item] ?? 0) <= 0) return;
    if (mcMeter.remaining >= mcMeter.max) return; // already full, don't waste it
    foodInv.eat(item);
    mcMeter.refill(FOOD_REFILL[item] ?? 0);
  };

  // Read-only multiworld streams (S5) → activity feed + moment toasts.
  const apRows = useFeed(clientRef, isConnected);
  const { catchMoment, capacityMoment, capacityRows } = useMoments(state, apRows);

  // Merge AP rows with synthetic capacity beats, newest first. Catch rows are
  // enriched with the Digimon you caught: the feed stream only knows the shipped
  // item + recipient, so we resolve identity via the stable Catch Slot #k ↔ k-th
  // caught invariant (state.caught keeps catch order — see context.tsx).
  const feedRows = useMemo(() => {
    const order = [...state.caught];
    const enrich = (r: FeedRow): FeedRow => {
      if (r.kind === 'catch' && r.slot && r.slot >= 1 && r.slot <= order.length) {
        const mon = getDigimon(order[r.slot - 1]);
        if (mon) return { ...r, caughtName: mon.name };
      }
      return r;
    };
    return [...apRows.map(enrich), ...capacityRows].sort((a, b) => b.at - a.at);
  }, [apRows, capacityRows, state.caught]);

  // Live seat count from the room (peers in our team); falls back to 1.
  const seats = useMemo(() => {
    if (!isConnected) return 1;
    const client = clientRef.current;
    try {
      const self = client?.players.self;
      const team = client?.players.teams[self?.team ?? 0];
      return team?.length ?? 1;
    } catch {
      return 1;
    }
    // recompute when connection or feed activity changes (peers may join).
  }, [isConnected, clientRef, apRows.length]);

  // 1s ticker so the feed's relative timestamps stay fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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

  // capacity bump (for the Storage card glow): the most recent capacity beat.
  const capBump = capacityMoment?.by;

  let main: ReactNode;
  if (view === 'play') {
    main = (
      <div className="flex flex-col gap-4">
        <StatusCards state={state} slotData={slotData} bump={capBump} />
        <ModeTabs mode={mode} setMode={setMode} locked={modeLocked} />
        {mode === 'text'
          ? (
              // Free-text play pairs the input with the live Digidex so you can
              // browse what's catchable while you type (mirrors Pokepelago). The
              // dex is read-only and name-hides uncaught entries, so it changes
              // nothing about AP beatability.
              <div className="flex flex-col gap-4">
                <FreeTextPanel hard={hard} setHard={setHard} locked={modeLocked} />
                <DexGrid />
              </div>
            )
          : <MultipleChoice
              meter={mcMeter}
              foodAvailable={foodAvailable}
              onEat={eatFoodItem}
              difficulty={mcDifficulty}
              random={mode === 'random'}
            />}
      </div>
    );
  } else if (view === 'dex') {
    main = <DexGrid />;
  } else if (view === 'multiworld') {
    main = <FullFeed rows={feedRows} seats={seats} now={now} />;
  } else {
    main = (
      <SettingsView
        slotName={slot}
        mcDifficulty={mcDifficulty}
        setMcDifficulty={setMcDifficulty}
        modeLocked={modeLocked}
      />
    );
  }

  return (
    <div className="min-h-screen text-white font-sans themed-bg">
      {/* Moment toasts — fixed top-centre, above everything (S5). */}
      {catchMoment && <CatchToast moment={catchMoment} />}
      {capacityMoment && <CapacityToast moment={capacityMoment} />}

      <div className="flex min-h-screen">
        <NavRail
          view={view}
          setView={setView}
          caughtCount={state.caughtCount}
          feedCount={feedRows.length}
          slotName={slot}
        />
        <main className="min-w-0 flex-1 px-3 pb-20 pt-4 sm:px-5 md:pb-6">
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
        {/* Play-view live feed rail (desktop ≥ xl). */}
        {view === 'play' && <FeedRail rows={feedRows} seats={seats} now={now} />}
      </div>
      <MobileTabs view={view} setView={setView} />
    </div>
  );
}
