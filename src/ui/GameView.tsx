import { useState } from 'react';
import { Moon, Sparkles } from 'lucide-react';
import { getDigimon } from '../data/dataset';
import { goalProgress } from '../game/guess';
import { useGame } from '../game/context';
import { useTheme } from './useTheme';
import { ConnectionPanel } from './ConnectionPanel';
import { FreeTextPanel } from './FreeTextPanel';
import { MultipleChoice } from './MultipleChoice';
import { DexGrid } from './DexGrid';

type Mode = 'text' | 'mc';

function Pill({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span className="dp-pill" title={title}>
      <span style={{ color: 'var(--dp-text-muted)' }}>{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

export function GameView() {
  const { isConnected, slotData, state, disconnect } = useGame();
  const { theme, toggle } = useTheme();
  const [mode, setMode] = useState<Mode>('text');
  const connected = isConnected && slotData;
  const goal = slotData ? goalProgress(state, slotData, getDigimon) : null;

  return (
    <div className="min-h-screen flex flex-col text-white font-sans themed-bg">
      {/* Header band */}
      <header
        className="sticky top-0 z-40 backdrop-blur-sm"
        style={{ backgroundColor: 'var(--dp-bg-surface)', borderBottom: '1px solid var(--dp-border)' }}
      >
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
          <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
            Digipelago
          </h1>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {connected && (
              <>
                <Pill label="Cap" value={`${state.caughtCount}/${state.capacity}`} title="Catches vs DigiStorage capacity" />
                <Pill label="Tier" value={String(state.tierReached)} title="Highest unlocked level tier" />
                {goal && <Pill label="Goal" value={`${goal.current}/${goal.target}`} />}
              </>
            )}
            <button
              className="dp-btn dp-btn-secondary inline-flex items-center gap-1.5"
              onClick={toggle}
              title={theme === 'default' ? 'Switch to Digital World theme' : 'Switch to default theme'}
            >
              {theme === 'default' ? <Sparkles size={14} /> : <Moon size={14} />}
              {theme === 'default' ? 'Digital' : 'Default'}
            </button>
            {connected && (
              <button className="dp-btn-danger" onClick={disconnect}>Disconnect</button>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-screen-xl mx-auto w-full px-3 sm:px-5 py-4 flex flex-col gap-4">
        {!connected ? (
          <ConnectionPanel />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button className="dp-toggle-btn" data-active={mode === 'text'} onClick={() => setMode('text')}>
                Free-text
              </button>
              <button className="dp-toggle-btn" data-active={mode === 'mc'} onClick={() => setMode('mc')}>
                Multiple choice
              </button>
            </div>
            {mode === 'text' ? <FreeTextPanel /> : <MultipleChoice />}
            <DexGrid />
          </>
        )}
      </main>
    </div>
  );
}
