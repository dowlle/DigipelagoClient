import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { findByName } from '../game/match';
import { computeClue, type Clue, type Dir, type Overlap } from '../game/clues';
import { guessableTargets, pickTarget } from '../game/mc';
import type { Digimon } from '../game/types';

interface Attempt {
  guess: Digimon;
  clue: Clue;
}

function dirGlyph(d: Dir | 'unknown'): string {
  return d === 'higher' ? '↑' : d === 'lower' ? '↓' : d === 'match' ? '✓' : '?';
}
function dirClass(d: Dir | 'unknown'): string {
  return d === 'match' ? 'hit' : d === 'unknown' ? 'miss' : 'partial';
}
function overlapClass(o: Overlap): string {
  return o === 'exact' ? 'hit' : o === 'partial' ? 'partial' : 'miss';
}
function boolClass(b: boolean): string {
  return b ? 'hit' : 'miss';
}

function Chip({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <span className={`chip ${cls}`}>
      <span className="chip-k">{label}</span>
      <span className="chip-v">{value}</span>
    </span>
  );
}

// Hard mode = identify the hidden target from Wordle-style clues. Any known
// Digimon is a valid guess (for information); only the exact target catches.
export function HardModeGuess() {
  const { slotData, state, catchDigimon } = useGame();
  const allEntries = useMemo(() => Object.values(dataset.meta), []);
  const [target, setTarget] = useState<Digimon | null>(null);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);

  const startRound = useCallback(() => {
    if (!slotData) return;
    setTarget(pickTarget(guessableTargets(allEntries, state, slotData)) ?? null);
    setHistory([]);
    setMsg(null);
  }, [slotData, state, allEntries]);

  useEffect(() => {
    if (!target) startRound();
  }, [target, startRound]);

  if (!slotData) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = text.trim();
    if (!name || !target) return;
    const d = findByName(name, allEntries);
    if (!d) {
      setMsg({ text: `✗ No Digimon named “${name}”`, good: false });
      return;
    }
    if (history.some((a) => a.guess.id === d.id)) {
      setMsg({ text: `Already guessed ${d.name}`, good: false });
      setText('');
      return;
    }
    const clue = computeClue(d, target);
    setHistory((h) => [{ guess: d, clue }, ...h]);
    setText('');
    if (clue.correct) {
      catchDigimon(target.id);
      setMsg({ text: `✓ Caught ${target.name} in ${history.length + 1} guess(es)!`, good: true });
      window.setTimeout(() => setTarget(null), 1200); // → effect rolls a fresh target
    } else {
      setMsg(null);
    }
  };

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        A hidden catchable Digimon is chosen. Guess any Digimon to get clues; nail the exact one to catch it.
      </p>
      <form className="row" onSubmit={submit}>
        <input
          autoFocus
          style={{ flex: 1 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={target ? 'Guess a Digimon for clues…' : 'No catchable Digimon right now'}
          aria-label="Hard-mode guess"
          disabled={!target}
        />
        <button className="primary" type="submit" disabled={!target}>Guess</button>
      </form>
      {msg && <p className={`toast ${msg.good ? 'good' : 'bad'}`} style={{ marginBottom: 0 }}>{msg.text}</p>}

      <div className="clue-list">
        {history.map(({ guess, clue }) => (
          <div key={guess.id} className={`clue-row${clue.correct ? ' correct' : ''}`}>
            <span className="clue-name">{guess.name}</span>
            <Chip label="lvl" value={`${guess.level} ${dirGlyph(clue.level)}`} cls={dirClass(clue.level)} />
            <Chip label="attr" value={guess.attribute} cls={boolClass(clue.attribute)} />
            <Chip label="type" value={guess.types.join('/') || '—'} cls={overlapClass(clue.types)} />
            <Chip label="field" value={`${clue.fields}`} cls={overlapClass(clue.fields)} />
            <Chip label="year" value={`${guess.year ?? '?'} ${dirGlyph(clue.year)}`} cls={dirClass(clue.year)} />
            <Chip label="X" value={guess.xAntibody ? 'yes' : 'no'} cls={boolClass(clue.xAntibody)} />
          </div>
        ))}
      </div>
    </div>
  );
}
