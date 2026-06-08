// Silhouette mode (S4) — the hero "identify the silhouette" experience, rebuilt
// over the UNCHANGED game logic (src/game/mc.ts) and the UNCHANGED self-healing
// wrong-pick meter (useWrongPickMeter). Presentation only: every logic call here
// (guessableTargets / pickTarget / buildChoices / catchDigimon / meter.*) is
// identical to before; only the rendering changed.
//
// Ports SilhouetteMode + TriesMeter + OptionBtn + Burst from the round-2
// hud-deep.jsx mock, token-driven so all three palettes reskin it:
//   • Hero stage  — SpriteReveal (real-shape masked silhouette → full-colour
//     cutout on solve) over a radial gradient, with a scan sweep + dot grid and,
//     on solve, a 12-ray Burst + "<Name>!" caption.
//   • Option buttons — idle / hover / wrong (X badge, shake, strikethrough, dim)
//     / correct (check badge, pop, "CAUGHT").
//   • Tries meter — segmented pips (calm good → tense bad as charges drain), a
//     partially-filled "refilling" pip, and a "Ns to +1" / "Full" / "Recharging"
//     read-out, all derived from the hook's existing outputs (no behaviour change).
//
// Flag C: neutral catchphrase — "Name the silhouette" (never the trademarked
// Pokémon-anime line).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Heart, Drumstick } from 'lucide-react';
import { dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { buildChoices, guessableTargets, pickTarget } from '../game/mc';
import { FOODS } from '../game/food';
import type { Digimon } from '../game/types';
import type { WrongPickMeter } from './useWrongPickMeter';
import { SpriteReveal } from './SpriteReveal';
import { attrColor } from './attrColor';

const NUM_CHOICES = 4;
const REVEAL_MS = 1300;

type OptionState = 'idle' | 'wrong' | 'correct' | 'dim';

// The wrong-pick meter is owned by AppShell (which stays mounted while connected)
// and passed in, so its charges persist across mode/view switches — you can't
// dodge the penalty by toggling to Free-text and back.
export function MultipleChoice({
  meter,
  foodAvailable,
  onEat,
}: {
  meter: WrongPickMeter;
  foodAvailable: Record<string, number>;
  onEat: (item: string) => void;
}) {
  const { slotData, state, catchDigimon } = useGame();
  const allEntries = useMemo(() => Object.values(dataset.meta), []);
  const [target, setTarget] = useState<Digimon | null>(null);
  const [choices, setChoices] = useState<Digimon[]>([]);
  const [revealed, setRevealed] = useState(false);
  // Presentation-only: which option ids the player has wrong-picked this round.
  const [wrongPicks, setWrongPicks] = useState<Set<number>>(() => new Set());

  const startRound = useCallback(() => {
    if (!slotData) return;
    const t = pickTarget(guessableTargets(allEntries, state, slotData));
    if (!t) {
      setTarget(null);
      setChoices([]);
      return;
    }
    setTarget(t);
    setChoices(buildChoices(t, allEntries, NUM_CHOICES));
    setRevealed(false);
    setWrongPicks(new Set());
  }, [slotData, state, allEntries]);

  useEffect(() => {
    if (!target) startRound();
  }, [target, startRound]);

  if (!slotData) return null;

  const handlePick = (choice: Digimon) => {
    if (revealed || meter.blocked || !target) return;
    if (choice.id === target.id) {
      setRevealed(true);
      catchDigimon(target.id);
      window.setTimeout(() => setTarget(null), REVEAL_MS);
    } else if (!wrongPicks.has(choice.id)) {
      setWrongPicks((s) => new Set(s).add(choice.id));
      meter.registerWrong();
    }
  };

  const optionState = (c: Digimon): OptionState => {
    if (revealed) return c.id === target?.id ? 'correct' : 'dim';
    if (wrongPicks.has(c.id)) return 'wrong';
    return 'idle';
  };

  // Refill progress of the next pip, derived from the hook (additive read-only):
  // secondsToRegen counts down toward the next charge; map it to a 0..1 bar.
  const progress = meter.secondsToRegen > 0 && meter.regenMs > 0
    ? Math.min(1, Math.max(0, 1 - (meter.secondsToRegen * 1000) / meter.regenMs))
    : 0;
  // Free guesses (regen 0): the Tries meter is meaningless, so hide it.
  const showMeter = meter.regenMs > 0;

  return (
    <div className="dp-card overflow-hidden p-5">
      {target ? (
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* ── hero stage ── */}
          <div className="flex shrink-0 flex-col gap-3 lg:w-[300px]">
            <div
              className="relative grid aspect-square place-items-center overflow-hidden rounded-2xl"
              style={{
                border: '1px solid var(--dp-line)',
                background: 'radial-gradient(circle at 50% 42%, var(--dp-card-3), var(--dp-bg-base))',
              }}
            >
              {/* scan sweep — hidden once solved */}
              {!revealed && (
                <div
                  className="hud-scan pointer-events-none absolute inset-x-0"
                  style={{
                    height: 2,
                    top: '50%',
                    background: 'linear-gradient(90deg, transparent, var(--dp-primary), transparent)',
                    boxShadow: '0 0 12px var(--dp-primary)',
                  }}
                />
              )}
              {/* dot grid overlay */}
              <div
                className="pointer-events-none absolute inset-0 opacity-50"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, color-mix(in srgb, var(--dp-primary) 10%, transparent) 1px, transparent 1px)',
                  backgroundSize: '14px 14px',
                }}
              />
              {/* reveal reward rays */}
              {revealed && <Burst />}
              <div className="relative grid h-[78%] w-[78%] place-items-center">
                <SpriteReveal
                  src={target.sprite}
                  name={target.name}
                  revealed={revealed}
                  fill="linear-gradient(180deg, var(--dp-primary), var(--dp-card-3))"
                  className="h-full w-full"
                />
              </div>
              {/* caption */}
              <div className="absolute inset-x-0 bottom-3 text-center">
                {revealed ? (
                  <span
                    className="hud-pop text-lg font-bold"
                    style={{ color: 'var(--dp-good)', fontFamily: 'var(--dp-font-disp)' }}
                  >
                    {target.name}!
                  </span>
                ) : (
                  <span
                    className="text-[11px] tracking-[0.25em]"
                    style={{ color: 'var(--dp-primary)', opacity: 0.8, fontFamily: 'var(--dp-font-body)' }}
                  >
                    SCANNING…
                  </span>
                )}
              </div>
            </div>
            {showMeter && (
              <TriesMeter
                remaining={meter.remaining}
                max={meter.max}
                blocked={meter.blocked}
                secondsToRegen={meter.secondsToRegen}
                progress={progress}
              />
            )}
            {showMeter && (
              <FoodBar
                available={foodAvailable}
                onEat={onEat}
                full={meter.remaining >= meter.max}
              />
            )}
          </div>

          {/* ── prompt + options ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            <h2
              className="mb-1 text-[22px] font-bold"
              style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}
            >
              Name the silhouette
            </h2>
            <p className="mb-4 text-[13px]" style={{ color: 'var(--dp-text-mid)' }}>
              Pick the name. Wrong picks cost Stamina, but it refills over time (or eat food), so you can&apos;t get stuck.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {choices.map((c, i) => (
                <OptionBtn
                  key={c.id}
                  idx={i}
                  label={c.name}
                  attribute={c.attribute}
                  state={optionState(c)}
                  disabled={revealed || (meter.blocked && optionState(c) === 'idle')}
                  onPick={() => handlePick(c)}
                />
              ))}
            </div>

            <div className="mt-auto pt-4">
              {meter.blocked && !revealed ? (
                <div
                  className="flex items-center gap-2 text-[12px]"
                  style={{ color: 'var(--dp-warn)', fontFamily: 'var(--dp-font-body)' }}
                >
                  <span
                    className="hud-pulse h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--dp-warn)' }}
                  />
                  Out of Stamina. A point refills in {meter.secondsToRegen}s, or eat food to refill now.
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 text-[12px]"
                  style={{ color: 'var(--dp-text-faint)', fontFamily: 'var(--dp-font-body)' }}
                >
                  Tip: the attribute dot under each name is a clue.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--dp-text-mid)' }}>
          No catchable Digimon right now. Unlock more via the multiworld.
        </p>
      )}
    </div>
  );
}

// ── 12-ray reward burst behind the reveal ──────────────────────────────────
function Burst() {
  return (
    <svg
      viewBox="0 0 200 200"
      className="hud-burst pointer-events-none absolute"
      style={{ inset: '-20%', width: '140%', height: '140%' }}
      aria-hidden
    >
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <line
            key={i}
            x1={100 + Math.cos(a) * 42}
            y1={100 + Math.sin(a) * 42}
            x2={100 + Math.cos(a) * 78}
            y2={100 + Math.sin(a) * 78}
            stroke="var(--dp-good)"
            strokeWidth={i % 2 ? 2 : 4}
            strokeLinecap="round"
            opacity={0.8}
          />
        );
      })}
    </svg>
  );
}

// ── Tries meter — segmented pips, calm→tense, with a refilling pip ──────────
function TriesMeter({
  remaining,
  max,
  blocked,
  secondsToRegen,
  progress,
}: {
  remaining: number;
  max: number;
  blocked: boolean;
  secondsToRegen: number;
  progress: number;
}) {
  const low = remaining <= 1;
  const pipColor = low ? 'var(--dp-bad)' : 'var(--dp-good)';
  const label = remaining === max ? 'Full' : blocked ? 'Recharging' : `${secondsToRegen}s to +1`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: 'var(--dp-text-mid)', fontFamily: 'var(--dp-font-body)' }}
        >
          <Heart size={13} style={{ color: pipColor }} fill={blocked ? 'none' : pipColor} />
          Stamina
        </span>
        <span
          className="flex items-center gap-1.5 text-[11px] font-semibold"
          style={{ color: blocked ? 'var(--dp-warn)' : 'var(--dp-text-faint)', fontFamily: 'var(--dp-font-body)' }}
        >
          {blocked && (
            <span className="hud-pulse h-1.5 w-1.5 rounded-full" style={{ background: 'var(--dp-warn)' }} />
          )}
          {label}
        </span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: max }).map((_, i) => {
          const filled = i < remaining;
          const isNext = i === remaining && remaining < max; // the refilling pip
          return (
            <div
              key={i}
              className="relative h-2.5 flex-1 overflow-hidden rounded"
              style={{
                background: 'var(--dp-line-soft)',
                border: `1px solid ${filled ? 'transparent' : 'var(--dp-line)'}`,
              }}
            >
              {filled && (
                <div
                  className="absolute inset-0"
                  style={{ background: pipColor, boxShadow: `0 0 8px color-mix(in srgb, ${pipColor} 55%, transparent)` }}
                />
              )}
              {isNext && (
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                    background: 'color-mix(in srgb, var(--dp-warn) 80%, transparent)',
                    boxShadow: '0 0 8px var(--dp-warn)',
                    transition: 'width .3s linear',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── food inventory — eat to refill Stamina (received via the multiworld) ─────
function FoodBar({
  available,
  onEat,
  full,
}: {
  available: Record<string, number>;
  onEat: (item: string) => void;
  full: boolean;
}) {
  const owned = FOODS.filter((f) => (available[f.item] ?? 0) > 0);
  if (owned.length === 0) return null;
  return (
    <div className="mt-3">
      <div
        className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: 'var(--dp-text-mid)', fontFamily: 'var(--dp-font-body)' }}
      >
        <Drumstick size={13} style={{ color: 'var(--dp-secondary)' }} />
        Food
      </div>
      <div className="flex flex-col gap-1.5">
        {owned.map((f) => {
          const count = available[f.item] ?? 0;
          const refillLabel = f.refill === Infinity ? 'full' : `+${f.refill}`;
          const disabled = full || count <= 0;
          return (
            <button
              key={f.item}
              type="button"
              disabled={disabled}
              onClick={() => onEat(f.item)}
              title={full ? 'Stamina already full' : `Eat to restore ${refillLabel} Stamina`}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                background: 'var(--dp-card-2)',
                border: '1px solid var(--dp-line)',
                color: 'var(--dp-text)',
                fontFamily: 'var(--dp-font-body)',
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              <Drumstick size={13} style={{ color: 'var(--dp-secondary)' }} aria-hidden />
              <span className="flex-1 font-semibold">{f.label}</span>
              <span style={{ color: 'var(--dp-good)', fontFamily: 'var(--dp-font-disp)' }}>{refillLabel}</span>
              <span
                className="grid h-5 min-w-[20px] place-items-center rounded-md px-1 text-[11px] font-bold"
                style={{
                  background: 'color-mix(in srgb, var(--dp-secondary) 14%, transparent)',
                  color: 'var(--dp-secondary)',
                  fontFamily: 'var(--dp-font-disp)',
                }}
              >
                x{count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── option button — idle / hover / wrong / correct ─────────────────────────
function OptionBtn({
  idx,
  label,
  attribute,
  state,
  disabled,
  onPick,
}: {
  idx: number;
  label: string;
  attribute: string;
  state: OptionState;
  disabled: boolean;
  onPick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const wrong = state === 'wrong';
  const correct = state === 'correct';
  const dim = state === 'dim';

  let bg = 'var(--dp-card-2)';
  let border = 'var(--dp-line)';
  let fg = 'var(--dp-text)';
  let shadow = 'none';
  if (correct) {
    bg = 'color-mix(in srgb, var(--dp-good) 14%, transparent)';
    border = 'var(--dp-good)';
    fg = 'var(--dp-good)';
    shadow = '0 0 18px color-mix(in srgb, var(--dp-good) 35%, transparent)';
  } else if (wrong) {
    bg = 'color-mix(in srgb, var(--dp-bad) 10%, transparent)';
    border = 'var(--dp-bad)';
    fg = 'var(--dp-bad)';
  } else if (hover && !disabled) {
    bg = 'var(--dp-card-3)';
    border = 'var(--dp-primary)';
    shadow = '0 0 0 3px color-mix(in srgb, var(--dp-primary) 18%, transparent)';
  }

  const anim = wrong ? 'hud-shake' : correct ? 'hud-pop' : '';

  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      disabled={disabled}
      className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-all ${anim}`}
      style={{
        background: bg,
        border: `1.5px solid ${border}`,
        color: fg,
        boxShadow: shadow,
        opacity: dim ? 0.4 : 1,
        textDecoration: wrong ? 'line-through' : 'none',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-bold"
        style={{
          background: correct ? 'var(--dp-good)' : wrong ? 'var(--dp-bad)' : 'color-mix(in srgb, var(--dp-primary) 12%, transparent)',
          color: correct || wrong ? 'var(--dp-on-primary)' : 'var(--dp-primary)',
          border: `1px solid ${correct ? 'var(--dp-good)' : wrong ? 'var(--dp-bad)' : 'var(--dp-line)'}`,
          fontFamily: 'var(--dp-font-disp)',
        }}
      >
        {correct ? '✓' : wrong ? '✕' : idx + 1}
      </span>
      <span
        className="flex-1 truncate text-[15px] font-semibold"
        style={{ fontFamily: 'var(--dp-font-disp)' }}
      >
        {label}
      </span>
      {/* attribute dot clue */}
      {!correct && !wrong && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: attrColor(attribute), boxShadow: `0 0 6px ${attrColor(attribute)}` }}
          aria-hidden
        />
      )}
      {correct && (
        <span className="text-[11px] font-bold" style={{ color: 'var(--dp-good)', fontFamily: 'var(--dp-font-disp)' }}>
          CAUGHT
        </span>
      )}
    </button>
  );
}
