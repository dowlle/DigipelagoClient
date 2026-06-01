import './ui/styles.css';
import { GameProvider } from './game/context';
import { GameView } from './ui/GameView';

// Digipelago — Digimon guessing-game randomizer client for Archipelago.
// Domain core (data/dataset, game/*) + transport (ap/*) are unit-tested; this
// shell wires the provider to the playable UI (connection → guess → catch loop).
export default function App() {
  return (
    <GameProvider>
      <GameView />
    </GameProvider>
  );
}
