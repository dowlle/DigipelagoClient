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
import { getDigimon } from '../data/dataset';
import { goalProgress } from '../game/guess';
import type { GameState, SlotData } from '../game/types';

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
    </div>
  );
}
