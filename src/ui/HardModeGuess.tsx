import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { findByName } from '../game/match';
import { computeClue, type Clue, type Dir, type Overlap } from '../game/clues';
import { guessableTargets, pickTarget } from '../game/mc';
import type { Digimon } from '../game/types';
import { Sprite } from './Sprite';

interface Attempt {
  guess: Digimon;
  clue: Clue;
}

type ChipKind = 'hit' | 'partial' | 'miss';

function dirGlyph(d: Dir | 'unknown'): string {
  return d === 'higher' ? '↑' : d === 'lower' ? '↓' : d === 'match' ? '✓' : '?';
}
function dirKind(d: Dir | 'unknown'): ChipKind {
  return d === 'match' ? 'hit' : d === 'unknown' ? 'miss' : 'partial';
}
function overlapKind(o: Overlap): ChipKind {
  return o === 'exact' ? 'hit' : o === 'partial' ? 'partial' : 'miss';
}
function boolKind(b: boolean): ChipKind {
  return b ? 'hit' : 'miss';
}
function chipColor(kind: ChipKind): string {
  if (kind === 'hit') return 'bg-green-500/15 border-green-500/60 text-green-200';
  if (kind === 'partial') return 'bg-amber-500/15 border-amber-500/60 text-amber-200';
  return 'bg-red-500/12 border-red-500/60 text-red-200';
}

function Chip({ label, value, kind }: { label: string; value: string; kind: ChipKind }) {
  return (
    <span className={`inline-flex flex-col leading-tight px-2 py-1 rounded-md border text-[0.72rem] ${chipColor(kind)}`}>
      <span className="uppercase tracking-wide text-[0.6rem] opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

// Hard mode = identify the hidden target from Wordle-style clues. Any known
// Digimon is a valid guess (for information); only the exact target catches it.
export function HardModeGuess() {
  const { slotData, state, catchDigimon } = useGame();
  const allEntries = useMemo(() => Object.values(dataset.meta), []);
  const [target, setTarget] = useState<Digimon | null>(null);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [solved, setSolved] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);

  const startRound = useCallback(() => {
    if (!slotData) return;
    setTarget(pickTarget(guessableTargets(allEntries, state, slotData)) ?? null);
    setHistory([]);
    setSolved(false);
    setMsg(null);
  }, [slotData, state, allEntries]);

  useEffect(() => {
    if (!target) startRound();
  }, [target, startRound]);

  if (!slotData) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = text.trim();
    if (!name || !target || solved) return;
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
      setSolved(true);
      catchDigimon(target.id);
      setMsg({ text: `✓ Caught ${target.name} in ${history.length + 1} guess(es)!`, good: true });
      window.setTimeout(() => setTarget(null), 1400); // reveal, then roll a fresh target
    } else {
      setMsg(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        <div
          className="flex items-center justify-center w-20 h-20 rounded-lg shrink-0"
          style={{ backgroundColor: 'var(--dp-bg-base)', border: '1px solid var(--dp-border)' }}
        >
          {target && (
            <Sprite
              src={target.sprite}
              name={target.name}
              digimonId={target.id}
              shadow={!solved}
              className="max-w-[64px] max-h-[64px]"
            />
          )}
        </div>
        <p className="text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
          A hidden catchable Digimon is chosen. Guess any Digimon to get clues; name the exact one to catch it.
        </p>
      </div>

      <form className="flex gap-2" onSubmit={submit}>
        <input
          autoFocus
          className="dp-input flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={target ? 'Guess a Digimon for clues…' : 'No catchable Digimon right now'}
          aria-label="Hard-mode guess"
          disabled={!target || solved}
        />
        <button className="dp-btn dp-btn-primary px-5 text-sm" type="submit" disabled={!target || solved}>Guess</button>
      </form>
      {msg && <p className={`mt-2 text-sm font-semibold ${msg.good ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}

      <div className="flex flex-col gap-2 mt-3">
        {history.map(({ guess, clue }) => (
          <div
            key={guess.id}
            className={`flex flex-wrap gap-2 items-center p-2 rounded-lg border ${clue.correct ? 'border-green-500' : ''}`}
            style={{ backgroundColor: 'var(--dp-bg-elevated)', borderColor: clue.correct ? undefined : 'var(--dp-border)' }}
          >
            <span className="min-w-[130px] font-semibold">{guess.name}</span>
            <Chip label="lvl" value={`${guess.level} ${dirGlyph(clue.level)}`} kind={dirKind(clue.level)} />
            <Chip label="attr" value={guess.attribute} kind={boolKind(clue.attribute)} />
            <Chip label="type" value={guess.types.join('/') || '-'} kind={overlapKind(clue.types)} />
            <Chip label="field" value={clue.fields} kind={overlapKind(clue.fields)} />
            <Chip label="year" value={`${guess.year ?? '?'} ${dirGlyph(clue.year)}`} kind={dirKind(clue.year)} />
            <Chip label="X" value={guess.xAntibody ? 'yes' : 'no'} kind={boolKind(clue.xAntibody)} />
          </div>
        ))}
      </div>
    </div>
  );
}
