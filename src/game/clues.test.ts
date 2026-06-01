import { describe, expect, it } from 'vitest';

import { dataset } from '../data/dataset';
import { computeClue, overlap } from './clues';

const byName = (n: string) => Object.values(dataset.meta).find((d) => d.name === n)!;

describe('overlap', () => {
  it('classifies set overlap', () => {
    expect(overlap(['a'], ['a'])).toBe('exact');
    expect(overlap(['a', 'b'], ['a', 'c'])).toBe('partial');
    expect(overlap(['a'], ['b'])).toBe('none');
    expect(overlap(['a', 'b'], ['b', 'a'])).toBe('exact'); // order-independent
  });
});

describe('computeClue', () => {
  const agumon = byName('Agumon'); // Rookie t2, Vaccine, Reptile, 1997, x:false
  const airdramon = byName('Airdramon'); // Champion t3, Vaccine, Mythical Beast, 1997

  it('reports tier direction toward the target', () => {
    expect(computeClue(agumon, airdramon).level).toBe('higher'); // target is higher tier
    expect(computeClue(airdramon, agumon).level).toBe('lower');
  });

  it('matches primary attribute and X-Antibody booleans', () => {
    const c = computeClue(agumon, airdramon);
    expect(c.attribute).toBe(true); // both Vaccine
    expect(c.xAntibody).toBe(true); // both false
  });

  it('classifies type/field overlap', () => {
    const c = computeClue(agumon, airdramon);
    expect(c.types).toBe('none'); // Reptile vs Mythical Beast
    expect(['partial', 'exact']).toContain(c.fields); // share Dragon's Roar / Nature Spirits
  });

  it('flags an exact self-guess as correct with all-matching dims', () => {
    const c = computeClue(agumon, agumon);
    expect(c.correct).toBe(true);
    expect(c.level).toBe('match');
    expect(c.types).toBe('exact');
    expect(c.year).toBe('match');
  });
});
