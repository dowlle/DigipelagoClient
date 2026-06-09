// HUD status cards — the three top-of-Play numbers (ported from hud-deep.jsx
// StatHero), but fed by real game state and fully token-driven.
//
//   Storage  — caughtCount / capacity (ring + count)
//   Tier     — level ladder lit up to state.tierReached (generic, no attribute)
//   Goal     — goalProgress(state, slotData) with a GENERIC sublabel (Flag D:
//              "Total caught" or "<level> caught" — never an attribute goal).
//
// Presentation only: reads state / slotData / goalProgress outputs, computes
// nothing about gating.

import { useMemo } from 'react';
import { dataset, getDigimon } from '../data/dataset';
import { goalProgress } from '../game/guess';
import type { GameState, SlotData } from '../game/types';
import { attrColor } from './attrColor';
import { attrCue, type AttrShape } from './attrCue';

// Display order for the attribute unlock tracker. EVERY attribute in the seed's
// dataset gates progression - each one has a Key and its cells count toward
// pool_size - so the tracker shows them ALL, the four primaries first, then
// Variable/Unknown. Driven by dataset.attributes so it can never drift from the
// real gating set. (This previously hardcoded only Vaccine/Virus/Data/Free and hid
// Variable/Unknown; that was wrong - those ARE gating attributes, they just cannot
// be chosen as the STARTING attribute, so you only ever unlock them via a Key.)
const ATTR_DISPLAY_ORDER = ['Vaccine', 'Virus', 'Data', 'Free', 'Variable', 'Unknown'];

function orderAttributes(attributes: string[]): string[] {
  const rank = (a: string) => {
    const i = ATTR_DISPLAY_ORDER.indexOf(a);
    return i < 0 ? ATTR_DISPLAY_ORDER.length : i;
  };
  return [...attributes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Pure held/locked predicate for the tracker, kept testable in isolation. */
export interface AttrTrackerCell {
  attr: string;
  held: boolean;
}

/**
 * Map every gating attribute (from the dataset) to {attr, held} in display order,
 * driven by the held-attribute set (state.heldAttributes). Display only: this reads
 * unlock state, it never gates anything (AP beatability is untouched).
 */
export function attrTrackerCells(heldAttributes: Set<string>, attributes: string[]): AttrTrackerCell[] {
  return orderAttributes(attributes).map((attr) => ({ attr, held: heldAttributes.has(attr) }));
}

/** SVG progress ring (ported from hud-deep.jsx Ring), token-driven colour. */
function Ring({
  val,
  max,
  color,
  size = 56,
  sw = 6,
  children,
}: {
  val: number;
  max: number;
  color: string;
  size?: number;
  sw?: number;
  children?: React.ReactNode;
}) {
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, Math.max(0, val / max)) : 0;
  const off = c * (1 - frac);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dp-line-soft)" strokeWidth={sw} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'stroke-dashoffset .5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Ordered level names low→high tier, from the seed's level_tier map. */
function orderedLevels(slot: SlotData): string[] {
  return Object.entries(slot.level_tier)
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);
}

/** Generic goal sublabel (Flag D): never an attribute. */
function goalSublabel(slot: SlotData): string {
  if (slot.goal === 'level' && slot.goal_level) return `${slot.goal_level} caught`;
  return 'Total caught';
}

// Local, minimal shape switch (mirrors the AttrShapeIcon pattern in
// MultipleChoice.tsx). Kept local on purpose: lifting the SVG into a shared
// module would widen the MultipleChoice.tsx diff and risk colliding with the
// later modes+dex step, so a small amount of duplication is the tighter choice.
function AttrShapeIcon({ shape, color }: { shape: AttrShape; color: string }) {
  const common = { width: 11, height: 11, viewBox: '0 0 12 12', 'aria-hidden': true } as const;
  const glow = { filter: `drop-shadow(0 0 3px ${color})` } as const;
  switch (shape) {
    case 'square':
      return <svg {...common} style={glow}><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill={color} /></svg>;
    case 'triangle':
      return <svg {...common} style={glow}><path d="M6 1.5 L10.5 10 L1.5 10 Z" fill={color} /></svg>;
    case 'diamond':
      return <svg {...common} style={glow}><path d="M6 1 L11 6 L6 11 L1 6 Z" fill={color} /></svg>;
    case 'hexagon':
      return <svg {...common} style={glow}><path d="M3.2 1.7 H8.8 L11 6 L8.8 10.3 H3.2 L1 6 Z" fill={color} /></svg>;
    case 'ring':
      return <svg {...common} style={glow}><circle cx="6" cy="6" r="4.2" fill="none" stroke={color} strokeWidth="2" /></svg>;
    case 'circle':
    default:
      return <svg {...common} style={glow}><circle cx="6" cy="6" r="4.5" fill={color} /></svg>;
  }
}

/**
 * Attribute unlock tracker (HUD): an always-visible row of every gating
 * attribute showing held vs locked. Held cells carry the attribute hue
 * (attrColor) PLUS the shape + label (attrCue) so unlock state survives loss of
 * colour vision; locked cells dim and outline the shape so the locked state is
 * legible without relying on colour. Display only - reads state.heldAttributes,
 * adds no gate.
 */
function AttrTracker({ state }: { state: GameState }) {
  const cells = attrTrackerCells(state.heldAttributes, dataset.attributes);
  return (
    <div className="dp-card flex flex-col justify-center px-4 py-3.5 sm:col-span-3">
      <div className="dp-stat-label mb-2">Attributes unlocked</div>
      <div className="flex flex-wrap items-center gap-2">
        {cells.map(({ attr, held }) => {
          const cue = attrCue(attr);
          const color = attrColor(attr);
          return (
            <span
              key={attr}
              className="flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[11px] font-semibold"
              title={held ? `${cue.full} - unlocked` : `${cue.full} - locked`}
              aria-label={held ? `${cue.full} attribute unlocked` : `${cue.full} attribute locked`}
              style={{
                fontFamily: 'var(--dp-font-disp)',
                background: held
                  ? `color-mix(in srgb, ${color} 14%, transparent)`
                  : 'var(--dp-line-soft)',
                border: `1px solid ${held ? color : 'var(--dp-line)'}`,
                color: held ? 'var(--dp-text)' : 'var(--dp-text-faint)',
                opacity: held ? 1 : 0.55,
              }}
            >
              <AttrShapeIcon shape={cue.shape} color={held ? color : 'var(--dp-text-faint)'} />
              <span aria-hidden>{cue.full}</span>
              <span
                className="text-[10px] font-bold leading-none"
                style={{ color: 'var(--dp-text-mid)' }}
                aria-hidden
              >
                {held ? cue.label : 'locked'}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function StatusCards({
  state,
  slotData,
  bump,
}: {
  state: GameState;
  slotData: SlotData;
  /** When set, the Storage card glows and shows a transient "+N" (S5). */
  bump?: number;
}) {
  const levels = useMemo(() => orderedLevels(slotData), [slotData]);
  const goal = useMemo(() => goalProgress(state, slotData, getDigimon), [state, slotData]);

  const cap = state.capacity;
  const held = state.caughtCount;
  const pct = cap > 0 ? Math.round((held / cap) * 100) : 0;
  const goalPct = goal.target > 0 ? Math.round((goal.current / goal.target) * 100) : 0;

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
      {/* Storage — glows + shows "+N" briefly on a capacity bump (S5). */}
      <div
        className="dp-stat"
        style={bump ? { boxShadow: '0 0 0 1px var(--dp-warn), 0 0 22px color-mix(in srgb, var(--dp-warn) 35%, transparent)' } : undefined}
      >
        <Ring val={held} max={cap} color="var(--dp-primary)">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--dp-primary)', fontFamily: 'var(--dp-font-disp)' }}>
            {pct}%
          </span>
        </Ring>
        <div>
          <div className="dp-stat-label">Storage</div>
          <div className="flex items-baseline gap-1.5" style={{ fontFamily: 'var(--dp-font-disp)' }}>
            <span className="text-[26px] font-bold" style={{ color: 'var(--dp-text)' }}>{held}</span>
            <span className="text-sm" style={{ color: 'var(--dp-text-faint)' }}>/ {cap}</span>
            {bump != null && (
              <span className="hud-pop text-sm font-bold" style={{ color: 'var(--dp-warn)', fontFamily: 'var(--dp-font-disp)' }}>
                +{bump}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tier ladder — lit up to tierReached. Generic, no attribute. */}
      <div className="dp-card flex flex-col justify-center px-4 py-3.5">
        <div className="dp-stat-label mb-2">Tier reached</div>
        <div className="flex items-center gap-1.5">
          {levels.map((lv, i) => {
            const tier = slotData.level_tier[lv];
            const on = state.tierReached >= tier;
            // current = the highest reached chip
            const cur = on && tier === state.tierReached;
            return (
              <div key={lv} className="contents">
                {i > 0 && (
                  <span
                    className="h-0.5 flex-1"
                    style={{ background: on ? 'var(--dp-primary)' : 'var(--dp-line-soft)', opacity: on ? 0.5 : 1 }}
                  />
                )}
                <span
                  className="whitespace-nowrap rounded-[7px] px-2 py-1.5 text-[11px] font-semibold"
                  style={{
                    fontFamily: 'var(--dp-font-disp)',
                    background: cur
                      ? 'var(--dp-primary)'
                      : on
                        ? 'color-mix(in srgb, var(--dp-primary) 12%, transparent)'
                        : 'var(--dp-line-soft)',
                    color: cur ? 'var(--dp-on-primary)' : on ? 'var(--dp-primary)' : 'var(--dp-text-faint)',
                    boxShadow: cur ? '0 0 12px color-mix(in srgb, var(--dp-primary) 40%, transparent)' : 'none',
                  }}
                >
                  {lv}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Goal — generic label only (Flag D). */}
      <div className="dp-stat">
        <Ring val={goal.current} max={goal.target} color="var(--dp-secondary)">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--dp-secondary)', fontFamily: 'var(--dp-font-disp)' }}>
            {goalPct}%
          </span>
        </Ring>
        <div>
          <div className="dp-stat-label">Goal</div>
          <div className="flex items-baseline gap-1.5" style={{ fontFamily: 'var(--dp-font-disp)' }}>
            <span className="text-[26px] font-bold" style={{ color: 'var(--dp-text)' }}>{goal.current}</span>
            <span className="text-sm" style={{ color: 'var(--dp-text-faint)' }}>/ {goal.target}</span>
          </div>
          <div className="text-[10px]" style={{ color: 'var(--dp-text-faint)', fontFamily: 'var(--dp-font-body)' }}>
            {goalSublabel(slotData)}
          </div>
        </div>
      </div>

      {/* Attribute unlock tracker - full-width row under the three stat cards. */}
      <AttrTracker state={state} />
    </div>
  );
}
