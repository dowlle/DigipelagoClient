import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markWinCounted, winKey } from './wins';
import { goalReached } from './guess';
import type { Digimon, GameState, SlotData } from './types';

// Tiny in-memory Storage stub (same pattern as useWrongPickMeter.test.ts) so the
// node test env can exercise the localStorage paths.
function makeStorageStub(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

describe('winKey', () => {
  it('is namespaced per seed, team, and slot', () => {
    expect(winKey('seed123', 0, 2)).toBe('digipelago:win:seed123:0:2');
    expect(winKey('seed123', 0, 2)).not.toBe(winKey('seed123', 0, 3));
    expect(winKey('seedA', 0, 2)).not.toBe(winKey('seedB', 0, 2));
  });
});

describe('markWinCounted', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeStorageStub();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('counts only the first call per key', () => {
    const key = winKey('seed123', 0, 1);
    expect(markWinCounted(key)).toBe(true);
    expect(markWinCounted(key)).toBe(false);
    expect(markWinCounted(winKey('other', 0, 1))).toBe(true);
  });

  it('returns false without localStorage (never double-counts)', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(markWinCounted(winKey('seed123', 0, 1))).toBe(false);
  });
});

describe('goalReached', () => {
  const mons: Record<number, Digimon> = {
    1: { id: 1, name: 'A', level: 'Rookie', attribute: 'Vaccine' } as Digimon,
    2: { id: 2, name: 'B', level: 'Ultimate', attribute: 'Vaccine' } as Digimon,
    3: { id: 3, name: 'C', level: 'Ultimate', attribute: 'Virus' } as Digimon,
  };
  const metaOf = (id: number) => mons[id];
  const baseState = (caught: number[]): GameState =>
    ({ caught: new Set(caught), caughtCount: caught.length } as unknown as GameState);
  const slot = (over: Partial<SlotData>): SlotData =>
    ({ goal: 'total', goal_level: null, goal_count: 2, ...over } as SlotData);

  it('total goal: reached at goal_count caught', () => {
    expect(goalReached(baseState([1]), slot({}), metaOf)).toBe(false);
    expect(goalReached(baseState([1, 2]), slot({}), metaOf)).toBe(true);
    expect(goalReached(baseState([1, 2, 3]), slot({}), metaOf)).toBe(true);
  });

  it('level goal: only the target level counts', () => {
    const s = slot({ goal: 'level', goal_level: 'Ultimate', goal_count: 2 });
    expect(goalReached(baseState([1, 2]), s, metaOf)).toBe(false);
    expect(goalReached(baseState([2, 3]), s, metaOf)).toBe(true);
  });

  it('a zero/absent target never reads as reached', () => {
    expect(goalReached(baseState([1, 2]), slot({ goal_count: 0 }), metaOf)).toBe(false);
  });
});
