import { memo, useMemo, useState, useLayoutEffect } from 'react';
import { dataset, getDigimon, priorsOf } from '../data/dataset';
import { useGame } from '../game/context';
import { entryStatus, lockReason } from '../game/status';
import type { GameState, Digimon, SlotData } from '../game/types';
import { attrColor } from './attrColor';
import { Sprite } from './Sprite';
import { useInViewport } from './useInViewport';

const CELL = 92; // column width (px)
const ROW_H = 112; // row height incl. gap (px) — used to reserve off-screen height

// The message lockReason() returns for the prior-evolution gate. Kept in sync
// with status.ts (read-only) so we can map it to the "behind a catch" cue.
const PRIOR_GATE_MSG = 'Catch a prior evolution first';

// Presentation-only refinement of EntryStatus: split 'locked' into the two
// distinct cues the design calls for, by *reading* the committed gate logic
// (lockReason + priorsOf). No gate is re-implemented here.
type Cue = 'caught' | 'guessable' | 'lockKey' | 'lockPrereq';

interface DexEntry {
  d: Digimon;
  cue: Cue;
  /** For lockPrereq: the name of the first un-caught prior, for "Catch X first". */
  priorName?: string;
}

function classify(d: Digimon, state: GameState, slotData: SlotData): DexEntry {
  const status = entryStatus(d, state, slotData);
  if (status === 'caught') return { d, cue: 'caught' };
  if (status === 'guessable') return { d, cue: 'guessable' };

  // Locked — distinguish "behind a key" (capacity / tier / attribute) from
  // "behind a prior catch" (the prior-evolution gate) via the read-only reason.
  const reason = lockReason(d, state, slotData);
  if (reason === PRIOR_GATE_MSG) {
    const prior = priorsOf(d.id)
      .filter((p) => !state.caught.has(p))
      .map((p) => getDigimon(p))
      .find((p): p is Digimon => p !== undefined);
    return { d, cue: 'lockPrereq', priorName: prior?.name };
  }
  return { d, cue: 'lockKey' };
}

const Cell = memo(function Cell({ entry }: { entry: DexEntry }) {
  const { d, cue } = entry;
  const ac = attrColor(d.attribute);
  const caught = cue === 'caught';
  const guess = cue === 'guessable';
  const prereq = cue === 'lockPrereq';
  const key = cue === 'lockKey';

  // It's a guessing game: never reveal an un-caught Digimon's name (in the cell
  // OR the tooltip). The prereq hint stays generic so it can't name a target.
  const shownName = caught ? d.name : '???';
  const lockLabel = prereq
    ? 'Catch its prior evolution first'
    : key
      ? 'Behind a key'
      : undefined;

  // Real-shape silhouette tint: guessable glows in its attribute hue; a
  // prereq-locked tile warms to --dp-warn; a key-locked tile stays cool/dim.
  const silFill = guess
    ? `linear-gradient(180deg, ${ac}, var(--dp-card-3))`
    : prereq
      ? 'color-mix(in srgb, var(--dp-warn) 66%, transparent)'
      : 'var(--dp-card-3)';

  return (
    <div
      className="relative flex flex-col items-center justify-between p-1.5 border transition-transform"
      style={{
        width: CELL,
        height: ROW_H - 8,
        borderRadius: 'var(--dp-slot-radius)',
        background: caught
          ? 'color-mix(in srgb, var(--dp-good) 14%, var(--dp-card))'
          : guess
            ? `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${ac} 22%, transparent), var(--dp-card))`
            : 'var(--dp-card)',
        borderColor: guess
          ? ac
          : caught
            ? 'var(--dp-line)'
            : prereq
              ? 'color-mix(in srgb, var(--dp-warn) 66%, transparent)'
              : 'var(--dp-line-soft)',
        borderStyle: prereq ? 'dashed' : 'solid',
        boxShadow: guess ? `0 0 8px color-mix(in srgb, ${ac} 35%, transparent)` : 'none',
        opacity: key ? 0.72 : 1,
        transform: guess ? undefined : undefined,
      }}
      title={`${shownName} · ${d.level} · ${d.attribute}${lockLabel ? ` · ${lockLabel}` : ''}`}
    >
      <div className="flex-1 flex items-center justify-center">
        <Sprite
          src={d.sprite}
          name={d.name}
          shadow={!caught}
          fill={caught ? undefined : silFill}
          glow={guess ? ac : 'var(--dp-silhouette-glow)'}
          className="max-w-[56px] max-h-[56px]"
        />
      </div>

      {/* guessable "?" badge */}
      {guess && (
        <span
          className="absolute top-1 right-1.5 text-[0.7rem] font-bold leading-none"
          style={{ color: ac, fontFamily: 'var(--dp-font-disp, inherit)' }}
        >
          ?
        </span>
      )}

      {/* behind-a-key badge (cool, key icon) */}
      {key && (
        <span
          className="absolute top-1 right-1 grid place-items-center"
          style={{
            width: 16,
            height: 16,
            borderRadius: 5,
            background: 'var(--dp-bg-base)',
            border: '1px solid var(--dp-line)',
          }}
          aria-hidden
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--dp-text-faint)" strokeWidth="2.4">
            <circle cx="8" cy="15" r="4" />
            <path d="M11 12l8-8M16 4l3 3" />
          </svg>
        </span>
      )}

      {/* behind-a-prior-catch badge (warm, chain-link icon) */}
      {prereq && (
        <span
          className="absolute top-1 right-1 grid place-items-center"
          style={{
            width: 16,
            height: 16,
            borderRadius: 5,
            background: 'var(--dp-bg-base)',
            border: '1px solid color-mix(in srgb, var(--dp-warn) 53%, transparent)',
          }}
          aria-hidden
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--dp-warn)"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M9 12a3 3 0 013-3h2M15 12a3 3 0 01-3 3h-2M8 8l-2 2a3 3 0 000 4M16 16l2-2a3 3 0 000-4" />
          </svg>
        </span>
      )}

      <span className="w-full text-center text-[0.68rem] leading-tight truncate flex items-center justify-center gap-1">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: ac, opacity: caught ? 1 : 0.5 }}
        />
        <span style={caught ? undefined : { color: 'var(--dp-text-faint)', letterSpacing: '0.08em' }}>
          {shownName}
        </span>
      </span>
    </div>
  );
});

function LevelGroup({ level, items }: { level: string; items: DexEntry[] }) {
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const [cols, setCols] = useState(8);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + 8) / (CELL + 8))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  if (items.length === 0) return null;
  const reserved = Math.ceil(items.length / cols) * ROW_H;

  return (
    <div ref={ref}>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-bold text-sm">{level}</h3>
        <span className="text-xs" style={{ color: 'var(--dp-text-muted)' }}>{items.length}</span>
      </div>
      {inView ? (
        <div className="grid gap-2 justify-start" style={{ gridTemplateColumns: `repeat(auto-fill, ${CELL}px)` }}>
          {items.map((entry) => (
            <Cell key={entry.d.id} entry={entry} />
          ))}
        </div>
      ) : (
        <div style={{ height: reserved }} />
      )}
    </div>
  );
}

function LegendSwatch({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      className="grid place-items-center shrink-0"
      style={{ width: 30, height: 30, borderRadius: 8, ...style }}
    >
      {children}
    </span>
  );
}

function LegendItem({
  swatch,
  title,
  sub,
}: {
  swatch: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {swatch}
      <div>
        <div className="text-xs font-semibold" style={{ color: 'var(--dp-text-primary)' }}>{title}</div>
        <div className="text-[0.68rem]" style={{ color: 'var(--dp-text-faint)' }}>{sub}</div>
      </div>
    </div>
  );
}

function DexLegend() {
  return (
    <div className="dp-panel p-3.5 flex flex-col gap-3">
      <div
        className="text-xs font-bold uppercase tracking-wider"
        style={{ color: 'var(--dp-text-primary)' }}
      >
        States
      </div>
      <LegendItem
        swatch={
          <LegendSwatch style={{ background: 'color-mix(in srgb, var(--dp-good) 14%, var(--dp-card))' }}>
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: 'var(--dp-good)' }}
            />
          </LegendSwatch>
        }
        title="Caught"
        sub="Owned, full colour"
      />
      <LegendItem
        swatch={
          <LegendSwatch
            style={{
              background:
                'radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--dp-primary) 30%, transparent), var(--dp-card))',
              border: '1px solid var(--dp-primary)',
            }}
          >
            <span className="text-xs font-bold" style={{ color: 'var(--dp-primary)' }}>?</span>
          </LegendSwatch>
        }
        title="Guessable now"
        sub="Unlocked & catchable, glows"
      />
      <div className="h-px" style={{ background: 'var(--dp-line)' }} />
      <div
        className="text-[0.68rem] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--dp-text-mid, var(--dp-text-secondary))' }}
      >
        Two ways to be locked
      </div>
      <LegendItem
        swatch={
          <LegendSwatch style={{ background: 'var(--dp-card)', border: '1px solid var(--dp-line)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--dp-text-faint)" strokeWidth="2.2">
              <circle cx="8" cy="15" r="4" />
              <path d="M11 12l8-8M16 4l3 3" />
            </svg>
          </LegendSwatch>
        }
        title="Behind a key"
        sub="Its level/attribute family isn't unlocked yet"
      />
      <LegendItem
        swatch={
          <LegendSwatch
            style={{
              background: 'var(--dp-card)',
              border: '1px dashed color-mix(in srgb, var(--dp-warn) 53%, transparent)',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--dp-warn)"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M9 12a3 3 0 013-3h2M15 12a3 3 0 01-3 3h-2M8 8l-2 2a3 3 0 000 4M16 16l2-2a3 3 0 000-4" />
            </svg>
          </LegendSwatch>
        }
        title="Behind a catch"
        sub="Family open: catch its predecessor first"
      />
    </div>
  );
}

type Filter = 'active' | 'caught' | 'all';
const LEVEL_ORDER = ['Rookie', 'Champion', 'Ultimate', 'Mega'];

export function DexGrid() {
  const { slotData, state } = useGame();
  const sorted = useMemo(
    () => Object.values(dataset.meta).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
    [],
  );
  const [filter, setFilter] = useState<Filter>('active');

  if (!slotData) return null;

  const entries = sorted.map((d) => classify(d, state, slotData));
  let caught = 0;
  for (const e of entries) if (e.cue === 'caught') caught += 1;
  const total = entries.length;

  const visible = entries.filter((e) =>
    filter === 'all' ? true : filter === 'caught' ? e.cue === 'caught' : e.cue !== 'lockKey' && e.cue !== 'lockPrereq',
  );
  const byLevel = (lvl: string) => visible.filter((e) => e.d.level === lvl);

  return (
    <div className="dp-panel p-4">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <strong className="text-base">Digidex</strong>
        {/* Flag D: generic counts — captured / total, never an attribute goal. */}
        <span className="text-sm" style={{ color: 'var(--dp-text-muted)' }}>
          <b style={{ color: 'var(--dp-primary)' }}>{caught}</b> captured · {total} total
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          {(['active', 'caught', 'all'] as Filter[]).map((f) => (
            <button key={f} className="dp-toggle-btn" data-active={filter === f} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <div className="flex flex-col gap-5 flex-1 min-w-0">
          {LEVEL_ORDER.map((lvl) => (
            <LevelGroup key={lvl} level={lvl} items={byLevel(lvl)} />
          ))}
        </div>
        <div className="w-full lg:w-64 shrink-0 lg:sticky lg:top-4">
          <DexLegend />
        </div>
      </div>
    </div>
  );
}
