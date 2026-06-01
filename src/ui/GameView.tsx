import { useState } from 'react';
import { getDigimon } from '../data/dataset';
import { goalProgress } from '../game/guess';
import { useGame } from '../game/context';
import { ConnectionPanel } from './ConnectionPanel';
import { FreeTextGuess } from './FreeTextGuess';
import { MultipleChoice } from './MultipleChoice';
import { DexGrid } from './DexGrid';

type Mode = 'text' | 'mc';

export function GameView() {
  const { isConnected, slotData, state, disconnect } = useGame();
  const [mode, setMode] = useState<Mode>('text');
  const connected = isConnected && slotData;
  const goal = slotData ? goalProgress(state, slotData, getDigimon) : null;

  return (
    <div className="app">
      <div className="row" style={{ marginBottom: '1rem' }}>
        <h1 className="title">Digipelago</h1>
        <div className="spacer" />
        {connected && (
          <>
            <span className="pill" title="Catches vs DigiStorage capacity">
              Cap {state.caughtCount}/{state.capacity}
            </span>
            <span className="pill" title="Highest unlocked level tier">Tier {state.tierReached}</span>
            {goal && <span className="pill">Goal {goal.current}/{goal.target}</span>}
            <button onClick={disconnect}>Disconnect</button>
          </>
        )}
      </div>

      {!connected ? (
        <ConnectionPanel />
      ) : (
        <>
          <div className="row toggle" style={{ marginBottom: '1rem' }}>
            <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
              Free-text
            </button>
            <button className={mode === 'mc' ? 'active' : ''} onClick={() => setMode('mc')}>
              Multiple choice
            </button>
          </div>
          {mode === 'text' ? <FreeTextGuess /> : <MultipleChoice />}
          <DexGrid />
        </>
      )}
    </div>
  );
}
