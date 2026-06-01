import { useMemo, useState, type FormEvent } from 'react';
import { dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { evaluateGuess } from '../game/match';

// Free-text mode = pure catch-anything: name any currently-catchable Digimon to
// catch it. The capacity cap is the only friction (Game Design).
export function FreeTextGuess() {
  const { slotData, state, catchDigimon } = useGame();
  const entries = useMemo(() => Object.values(dataset.meta), []);
  const [text, setText] = useState('');
  const [toast, setToast] = useState<{ msg: string; good: boolean } | null>(null);

  if (!slotData) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = text.trim();
    if (!name) return;
    const out = evaluateGuess(name, entries, state, slotData);
    switch (out.kind) {
      case 'catch':
        catchDigimon(out.digimon.id);
        setToast({ msg: `✓ Caught ${out.digimon.name}!`, good: true });
        break;
      case 'already':
        setToast({ msg: `${out.digimon.name} is already caught`, good: false });
        break;
      case 'locked':
        setToast({ msg: `✗ ${out.reason}`, good: false });
        break;
      case 'unknown':
        setToast({ msg: `✗ No Digimon named “${name}”`, good: false });
        break;
    }
    setText('');
  };

  return (
    <div>
      <form className="flex gap-2" onSubmit={submit}>
        <input
          autoFocus
          className="dp-input flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a Digimon name…"
          aria-label="Digimon name"
        />
        <button className="dp-btn dp-btn-primary px-5 text-sm" type="submit">Guess</button>
      </form>
      <p className={`mt-2 h-5 text-sm font-semibold ${toast?.good ? 'text-green-400' : 'text-red-400'}`}>
        {toast?.msg ?? ''}
      </p>
    </div>
  );
}
