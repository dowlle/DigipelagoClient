import { dataset } from './data/dataset';

// Placeholder shell. The guessing UI, connection manager, clue feedback, dual
// input (free-text + multiple-choice), and DataStorage resumability come next.
// The domain core (data/dataset, game/guess, game/state) is in place and tested.
export default function App() {
  const count = Object.keys(dataset.meta).length;
  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      <h1>Digipelago</h1>
      <p>Digimon guessing-game randomizer for Archipelago — client foundation.</p>
      <p>
        Bundled dataset <code>{dataset.version}</code> · {count} Digimon ·{' '}
        {dataset.roots.size} roots · attributes: {dataset.attributes.join(', ')}.
      </p>
      <p style={{ color: '#888' }}>UI under construction.</p>
    </main>
  );
}
