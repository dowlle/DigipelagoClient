// Tests for the Stamina (wrong-pick) meter persistence helpers. The meter is
// cosmetic, client-side UX and never gates AP, so these cover the pure storage
// helpers (vite test env is 'node', no jsdom/@testing-library installed): the
// per-seat key, the save/load round-trip, strict rejection of corrupt/legacy
// values (so a tampered or stale value can only ever fall back to a full meter),
// and SSR/Node-safety when localStorage is absent.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMeterState, saveMeterState, staminaStorageKey } from './useWrongPickMeter';

// Tiny in-memory Storage stub so we can exercise the `typeof localStorage` guard
// under the node test env (where there is no real localStorage).
function makeStorageStub(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe('staminaStorageKey', () => {
  it('produces the team+slot-scoped key', () => {
    expect(staminaStorageKey(0, 3)).toBe('digipelago:stamina:0:3');
  });

  it('gives distinct keys for distinct seats so two seeds/seats do not share a meter', () => {
    expect(staminaStorageKey(0, 1)).not.toBe(staminaStorageKey(0, 2));
    expect(staminaStorageKey(0, 1)).not.toBe(staminaStorageKey(1, 1));
  });
});

describe('saveMeterState / loadMeterState with localStorage present', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeStorageStub();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('round-trips a state with a numeric nextRefillAt', () => {
    const key = staminaStorageKey(0, 1);
    const state = { spent: 2, nextRefillAt: 1_700_000_000_000 };
    saveMeterState(key, state);
    expect(loadMeterState(key)).toEqual(state);
  });

  it('round-trips a state with a null nextRefillAt', () => {
    const key = staminaStorageKey(0, 1);
    const state = { spent: 0, nextRefillAt: null };
    saveMeterState(key, state);
    expect(loadMeterState(key)).toEqual(state);
  });

  it('returns null for an absent key (caller falls back to a full meter)', () => {
    expect(loadMeterState('digipelago:stamina:9:9')).toBeNull();
  });

  it('returns null for non-JSON garbage', () => {
    const key = staminaStorageKey(0, 1);
    localStorage.setItem(key, 'not json {');
    expect(loadMeterState(key)).toBeNull();
  });

  it('returns null for a non-object JSON value', () => {
    const key = staminaStorageKey(0, 1);
    localStorage.setItem(key, '42');
    expect(loadMeterState(key)).toBeNull();
    localStorage.setItem(key, 'null');
    expect(loadMeterState(key)).toBeNull();
  });

  it('rejects corrupt / legacy shapes -> null', () => {
    const key = staminaStorageKey(0, 1);
    const bad = [
      { spent: -1, nextRefillAt: null }, // negative spent
      { spent: 1.5, nextRefillAt: null }, // non-integer spent
      { spent: 2, nextRefillAt: 'soon' }, // nextRefillAt a string
      { spent: 2, nextRefillAt: true }, // nextRefillAt a non-number
      { remaining: 5, max: 5 }, // totally different legacy object
      { nextRefillAt: 123 }, // missing spent
    ];
    for (const v of bad) {
      localStorage.setItem(key, JSON.stringify(v));
      expect(loadMeterState(key)).toBeNull();
    }
  });
});

describe('SSR/Node-safety when localStorage is undefined', () => {
  beforeEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('loadMeterState returns null and saveMeterState does not throw', () => {
    expect(typeof (globalThis as { localStorage?: Storage }).localStorage).toBe('undefined');
    expect(loadMeterState('digipelago:stamina:0:1')).toBeNull();
    expect(() => saveMeterState('digipelago:stamina:0:1', { spent: 3, nextRefillAt: null })).not.toThrow();
  });
});
