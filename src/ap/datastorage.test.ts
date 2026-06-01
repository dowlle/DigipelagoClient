import { describe, expect, it } from 'vitest';
import { caughtKey, sanitizeCaughtList } from './datastorage';

describe('caughtKey', () => {
  it('is team+slot scoped (ADR-0002)', () => {
    expect(caughtKey(0, 1)).toBe('Digipelago:0:1:caught');
    expect(caughtKey(2, 17)).toBe('Digipelago:2:17:caught');
  });
});

describe('sanitizeCaughtList', () => {
  it('keeps a clean set of non-negative integer ids', () => {
    expect([...sanitizeCaughtList([3, 1, 4, 1, 5])]).toEqual([3, 1, 4, 5]);
  });

  it('drops non-integers, negatives, and non-numbers', () => {
    expect([...sanitizeCaughtList([1, -2, 3.5, '4', null, NaN, 6])]).toEqual([1, 6]);
  });

  it('returns an empty set for unset / non-array values', () => {
    expect(sanitizeCaughtList(undefined).size).toBe(0);
    expect(sanitizeCaughtList(null).size).toBe(0);
    expect(sanitizeCaughtList(42).size).toBe(0);
  });
});
