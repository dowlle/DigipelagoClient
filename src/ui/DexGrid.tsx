import { memo, useMemo, useState } from 'react';
import { dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { entryStatus, type EntryStatus } from '../game/status';
import type { Digimon } from '../game/types';
import { attrColor } from './attrColor';
import { Sprite } from './Sprite';

const Cell = memo(function Cell({ d, status }: { d: Digimon; status: EntryStatus }) {
  return (
    <div className={`cell ${status}`} title={`${d.name} · ${d.level} · ${d.attribute}`}>
      <Sprite src={d.sprite} name={d.name} small shadow={status === 'locked'} />
      <span className="name">
        <span className="attr" style={{ background: attrColor(d.attribute) }} />
        {d.name}
      </span>
    </div>
  );
});

type Filter = 'active' | 'caught' | 'all';

export function DexGrid() {
  const { slotData, state } = useGame();
  const [filter, setFilter] = useState<Filter>('active');
  const sorted = useMemo(
    () => Object.values(dataset.meta).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
    [],
  );

  if (!slotData) return null;

  const withStatus = sorted.map((d) => ({ d, s: entryStatus(d, state, slotData) }));
  let caught = 0;
  let catchable = 0;
  for (const { s } of withStatus) {
    if (s === 'caught') caught += 1;
    else if (s === 'guessable') catchable += 1;
  }
  const visible = withStatus.filter(({ s }) =>
    filter === 'all' ? true : filter === 'caught' ? s === 'caught' : s !== 'locked',
  );

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        <strong>Digidex</strong>
        <span className="pill" style={{ borderColor: 'var(--good)' }}>{caught} caught</span>
        <span className="pill" style={{ borderColor: 'var(--accent)' }}>{catchable} catchable</span>
        <div className="spacer" />
        <div className="toggle row">
          {(['active', 'caught', 'all'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="dex">
        {visible.map(({ d, s }) => (
          <Cell key={d.id} d={d} status={s} />
        ))}
      </div>
      {filter === 'all' && (
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          Showing all {sorted.length} — large grids may render slowly (virtualization is a follow-up).
        </p>
      )}
    </div>
  );
}
