import { useCallback, useEffect, useMemo, useState } from 'react';
import { dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { buildChoices, guessableTargets, pickTarget } from '../game/mc';
import type { Digimon } from '../game/types';
import { useWrongPickMeter } from './useWrongPickMeter';
import { Sprite } from './Sprite';

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

  // Begin a round whenever there is none. `startRound` is recreated with fresh
  // `state` each render, so a post-catch round picks from the updated pool.
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
      window.setTimeout(() => setTarget(null), REVEAL_MS); // → effect starts next round
    } else {
      meter.registerWrong();
      window.setTimeout(() => setPicked(null), WRONG_FLASH_MS); // keep the same target, try again
    }
  };

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        <span className="pill" title="Wrong-pick charges (regenerate over time)">
          Meter {'●'.repeat(meter.remaining)}{'○'.repeat(meter.max - meter.remaining)}
        </span>
        {meter.blocked && <span className="muted">Recharging… {meter.secondsToRegen}s</span>}
      </div>

      {target ? (
        <div className="mc">
          <div className="mc-sprite">
            <Sprite src={target.sprite} name={target.name} shadow={!revealed} />
          </div>
          <div className="mc-options">
            {choices.map((c) => {
              const isCorrect = revealed && c.id === target.id;
              const isWrong = picked === c.id && c.id !== target.id;
              return (
                <button
                  key={c.id}
                  className={isCorrect ? 'correct' : isWrong ? 'wrong' : ''}
                  disabled={revealed || meter.blocked}
                  onClick={() => handlePick(c)}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="muted">No catchable Digimon right now — unlock more via the multiworld.</p>
      )}
    </div>
  );
}
