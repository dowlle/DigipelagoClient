import { useState } from 'react';
import { FreeTextGuess } from './FreeTextGuess';
import { HardModeGuess } from './HardModeGuess';

// Free-text mode with the optional hard-mode toggle (decision 2026-06-01):
// default is pure catch-anything; the toggle switches to the hidden-target
// clue game. Same underlying catch dispatch either way.
export function FreeTextPanel() {
  const [hard, setHard] = useState(false);
  return (
    <div>
      <label className="hardmode-toggle">
        <input type="checkbox" checked={hard} onChange={(e) => setHard(e.target.checked)} />
        <span>Hard mode — identify the hidden Digimon from clues</span>
      </label>
      {hard ? <HardModeGuess /> : <FreeTextGuess />}
    </div>
  );
}
