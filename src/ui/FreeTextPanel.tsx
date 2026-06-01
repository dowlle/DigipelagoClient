import { useState } from 'react';
import { FreeTextGuess } from './FreeTextGuess';
import { HardModeGuess } from './HardModeGuess';

// Free-text mode with the optional hard-mode toggle (decision 2026-06-01):
// default is pure catch-anything; the toggle switches to the hidden-target
// clue game. Same underlying catch dispatch either way.
export function FreeTextPanel() {
  const [hard, setHard] = useState(false);
  return (
    <div className="dp-panel p-4">
      <label className="inline-flex items-center gap-2 mb-3 cursor-pointer text-sm select-none">
        <input
          type="checkbox"
          checked={hard}
          onChange={(e) => setHard(e.target.checked)}
          className="w-4 h-4 accent-[var(--dp-accent)]"
        />
        <span>Hard mode — identify the hidden Digimon from clues</span>
      </label>
      {hard ? <HardModeGuess /> : <FreeTextGuess />}
    </div>
  );
}
