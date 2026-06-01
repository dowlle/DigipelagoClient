import { memo, useMemo, useState, useLayoutEffect } from 'react';
import { dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { entryStatus, type EntryStatus } from '../game/status';
import type { Digimon } from '../game/types';
import { attrColor } from './attrColor';
import { Sprite } from './Sprite';
import { useInViewport } from './useInViewport';

const CELL = 92; // column width (px)
const ROW_H = 112; // row height incl. gap (px) — used to reserve off-screen height

const STATUS_CLASS: Record<EntryStatus, string> = {
  caught: 'bg-green-900/40 border-green-700/60',
  guessable: 'bg-emerald-950/70 border-green-500/70 shadow-[0_0_8px_rgba(34,197,94,0.30)] hover:scale-[1.04]',
  locked: 'bg-gray-800/40 border-gray-700/30 opacity-40',
};

const Cell = memo(function Cell({ d, status }: { d: Digimon; status: EntryStatus }) {
  return (
    <div
      className={`flex flex-col items-center justify-between p-1.5 border transition-transform ${STATUS_CLASS[status]}`}
      style={{ width: CELL, height: ROW_H - 8, borderRadius: 'var(--dp-slot-radius)' }}
      title={`${d.name} · ${d.level} · ${d.attribute}`}
    >
      <div className="flex-1 flex items-center justify-center">
        <Sprite src={d.sprite} name={d.name} shadow={status === 'locked'} className="max-w-[56px] max-h-[56px]" />
      </div>
      <span className="w-full text-center text-[0.68rem] leading-tight truncate flex items-center justify-center gap-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: attrColor(d.attribute) }} />
        {d.name}
      </span>
    </div>
  );
});

function LevelGroup({ level, items }: { level: string; items: { d: Digimon; s: EntryStatus }[] }) {
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const [cols, setCols] = useState(8);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + 8) / (CELL + 8))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  if (items.length === 0) return null;
  const reserved = Math.ceil(items.length / cols) * ROW_H;

  return (
    <div ref={ref}>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-bold text-sm">{level}</h3>
        <span className="text-xs" style={{ color: 'var(--dp-text-muted)' }}>{items.length}</span>
      </div>
      {inView ? (
        <div className="grid gap-2 justify-start" style={{ gridTemplateColumns: `repeat(auto-fill, ${CELL}px)` }}>
          {items.map(({ d, s }) => (
            <Cell key={d.id} d={d} status={s} />
          ))}
        </div>
      ) : (
        <div style={{ height: reserved }} />
      )}
    </div>
  );
}

type Filter = 'active' | 'caught' | 'all';
const LEVEL_ORDER = ['Rookie', 'Champion', 'Ultimate', 'Mega'];

export function DexGrid() {
  const { slotData, state } = useGame();
  const sorted = useMemo(
    () => Object.values(dataset.meta).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
    [],
  );
  const [filter, setFilter] = useState<Filter>('active');

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
  const byLevel = (lvl: string) => visible.filter(({ d }) => d.level === lvl);

  return (
    <div className="dp-panel p-4">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <strong className="text-base">Digidex</strong>
        <span className="dp-pill" style={{ borderColor: '#16a34a' }}>{caught} caught</span>
        <span className="dp-pill" style={{ borderColor: 'var(--dp-accent)' }}>{catchable} catchable</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          {(['active', 'caught', 'all'] as Filter[]).map((f) => (
            <button key={f} className="dp-toggle-btn" data-active={filter === f} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-5">
        {LEVEL_ORDER.map((lvl) => (
          <LevelGroup key={lvl} level={lvl} items={byLevel(lvl)} />
        ))}
      </div>
    </div>
  );
}
