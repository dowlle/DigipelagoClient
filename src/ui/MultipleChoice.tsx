import { useCallback, useEffect, useMemo, useState } from 'react';
import { dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { buildChoices, guessableTargets, pickTarget } from '../game/mc';
import type { Digimon } from '../game/types';
import { useWrongPickMeter } from './useWrongPickMeter';
import { SpriteReveal } from './SpriteReveal';

const NUM_CHOICES = 4;
const REVEAL_MS = 900;
const WRONG_FLASH_MS = 600;

// Identify-the-silhouette mode: a hidden target (drawn from the catchable pool)
// is shown shadowed on the left (top on mobile); pick its name from the options
// on the right (bottom on mobile). Correct → catch it. Wrong → consume the
// self-regenerating meter (never an AP dependency).
export function MultipleChoice() {
  const { slotData, state, catchDigimon } = useGame();
  const allEntries = useMemo(() => Object.values(dataset.meta), []);
  const meter = useWrongPickMeter();
  const [target, setTarget] = useState<Digimon | null>(null);
  const [choices, setChoices] = useState<Digimon[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

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
    setPicked(null);
  }, [slotData, state, allEntries]);

  useEffect(() => {
    if (!target) startRound();
  }, [target, startRound]);

  if (!slotData) return null;

  const handlePick = (choice: Digimon) => {
    if (revealed || meter.blocked || !target) return;
    setPicked(choice.id);
    if (choice.id === target.id) {
      setRevealed(true);
      catchDigimon(target.id);
      window.setTimeout(() => setTarget(null), REVEAL_MS);
    } else {
      meter.registerWrong();
      window.setTimeout(() => setPicked(null), WRONG_FLASH_MS);
    }
  };

  const optionClass = (c: Digimon) => {
    const base = 'w-full text-left rounded-lg px-4 py-3 text-sm font-medium border transition-colors disabled:cursor-not-allowed';
    if (revealed && c.id === target?.id) return `${base} bg-green-600 border-green-500 text-white`;
    if (picked === c.id && c.id !== target?.id) return `${base} bg-red-600 border-red-500 text-white`;
    return `${base} hover:border-[var(--dp-accent)]`;
  };

  return (
    <div className="dp-panel p-4">
      <div className="flex items-center gap-3 mb-4">
        <span className="dp-pill" title="Wrong-pick charges (regenerate over time)">
          <span style={{ color: 'var(--dp-text-muted)' }}>Meter</span>
          <span className="tracking-widest">
            <span className="text-green-400">{'●'.repeat(meter.remaining)}</span>
            <span style={{ color: 'var(--dp-text-muted)' }}>{'○'.repeat(meter.max - meter.remaining)}</span>
          </span>
        </span>
        {meter.blocked && (
          <span className="text-sm" style={{ color: 'var(--dp-text-muted)' }}>Recharging… {meter.secondsToRegen}s</span>
        )}
      </div>

      {target ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-center">
          <div
            className="flex justify-center items-center min-h-[160px] sm:min-h-[230px] rounded-xl"
            style={{ backgroundColor: 'var(--dp-bg-base)', border: '1px solid var(--dp-border)' }}
          >
            <SpriteReveal src={target.sprite} name={target.name} revealed={revealed} className="w-[180px] h-[180px]" />
          </div>
          <div className="flex flex-col gap-2.5">
            {choices.map((c) => (
              <button
                key={c.id}
                className={optionClass(c)}
                style={
                  (revealed && c.id === target.id) || (picked === c.id && c.id !== target.id)
                    ? undefined
                    : { backgroundColor: 'var(--dp-bg-elevated)', borderColor: 'var(--dp-border-subtle)' }
                }
                disabled={revealed || meter.blocked}
                onClick={() => handlePick(c)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--dp-text-muted)' }}>
          No catchable Digimon right now — unlock more via the multiworld.
        </p>
      )}
    </div>
  );
}
