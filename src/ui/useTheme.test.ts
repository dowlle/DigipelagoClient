import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isThemeUnlocked,
  loadUnlockedThemeIds,
  loadUnlocks,
  mergeUnlockedThemeIds,
  recordGameCompletion,
} from './useTheme';

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

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = makeStorageStub();
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('win-gated palettes', () => {
  it('fresh player: only Tide is unlocked', () => {
    expect(isThemeUnlocked('tide')).toBe(true);
    expect(isThemeUnlocked('terminal')).toBe(false);
    expect(isThemeUnlocked('vapor')).toBe(false);
  });

  it('first win unlocks Terminal, second unlocks Vapor, third unlocks nothing', () => {
    expect(recordGameCompletion()).toEqual(['terminal']);
    expect(isThemeUnlocked('terminal')).toBe(true);
    expect(isThemeUnlocked('vapor')).toBe(false);

    expect(recordGameCompletion()).toEqual(['vapor']);
    expect(isThemeUnlocked('vapor')).toBe(true);

    expect(recordGameCompletion()).toEqual([]);
    expect(loadUnlocks().gamesCompleted).toBe(3);
  });

  it('wins persist as explicit unlockedThemes entries (the account-sync shape)', () => {
    recordGameCompletion();
    expect(loadUnlockedThemeIds()).toEqual(['terminal']);
  });

  it('a server-synced entry unlocks without any local wins', () => {
    mergeUnlockedThemeIds(['vapor', 'bogus-id']);
    expect(isThemeUnlocked('vapor')).toBe(true);
    expect(isThemeUnlocked('terminal')).toBe(false);
    expect(loadUnlockedThemeIds()).toEqual(['vapor']);
  });

  it('an already-synced entry is not re-reported as newly unlocked', () => {
    mergeUnlockedThemeIds(['terminal']);
    expect(recordGameCompletion()).toEqual([]); // win 1: terminal was already explicit
    expect(recordGameCompletion()).toEqual(['vapor']); // win 2 still progresses
  });

  it('without localStorage nothing unlocks and nothing throws', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(recordGameCompletion()).toEqual([]);
    expect(isThemeUnlocked('terminal')).toBe(false);
  });
});
