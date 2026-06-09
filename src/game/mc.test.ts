import { describe, expect, it } from 'vitest';

import { dataset, isRoot } from '../data/dataset';
import { buildState } from './state';
import { buildChoices, guessableTargets, pickTarget, variantBase, type Rng } from './mc';
import type { Digimon, GameState, SlotData } from './types';

const SLOT: SlotData = {
  dataset_version: dataset.version,
  starting_capacity: 50,
  capacity_per_upgrade: 50,
  goal: 'total',
  goal_level: null,
  goal_count: 100,
  starting_attribute: 'Vaccine',
  level_tier: dataset.levelTier,
  attributes: dataset.attributes,
  cell_counts: {},
  pool_size: Object.keys(dataset.meta).length,
};

function sphere0(caughtCount = 0, caught = new Set<number>()): GameState {
  return buildState(SLOT, ['Digivolution', 'Vaccine Key'], caughtCount, caught);
}

const entries = Object.values(dataset.meta);

/** Deterministic rng cycling through given fractions. */
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('guessableTargets', () => {
  it('returns only catchable, uncaught Digimon', () => {
    const targets = guessableTargets(entries, sphere0(), SLOT);
    expect(targets.length).toBeGreaterThan(0);
    // sphere 0 = Rookie + Vaccine only
    expect(targets.every((d) => d.level === 'Rookie' && d.attribute === 'Vaccine')).toBe(true);
  });

  it('excludes already-caught', () => {
    const one = guessableTargets(entries, sphere0(), SLOT)[0];
    const after = guessableTargets(entries, sphere0(1, new Set([one.id])), SLOT);
    expect(after.some((d) => d.id === one.id)).toBe(false);
  });
});

describe('pickTarget', () => {
  it('picks deterministically with a seeded rng', () => {
    const targets = guessableTargets(entries, sphere0(), SLOT);
    expect(pickTarget(targets, () => 0)).toBe(targets[0]);
    expect(pickTarget([], () => 0)).toBeUndefined();
  });
});

describe('buildChoices', () => {
  const target = entries.find((d) => d.level === 'Champion' && isRoot(d.id))!;

  it('returns n unique options including the target', () => {
    const choices = buildChoices(target, entries, 4, seq([0.1, 0.3, 0.7, 0.5, 0.2]));
    expect(choices).toHaveLength(4);
    expect(new Set(choices.map((d) => d.id)).size).toBe(4);
    expect(choices.some((d) => d.id === target.id)).toBe(true);
  });

  it('prefers same-level distractors when enough exist (normal default)', () => {
    const choices = buildChoices(target, entries, 4, seq([0.42]));
    const distractors = choices.filter((d) => d.id !== target.id);
    expect(distractors.every((d) => d.level === target.level)).toBe(true);
  });
});

describe('variantBase', () => {
  it('groups space-separated modifier variants by the family tail', () => {
    expect(variantBase('Agumon')).toBe('agumon');
    expect(variantBase('Toy Agumon')).toBe('agumon');
    expect(variantBase('Metal Greymon')).toBe('greymon');
  });
});

describe('buildChoices difficulty (FEAT-01)', () => {
  const byName = (n: string) => entries.find((d) => d.name === n)!;

  it('hard fills distractors with same-base variants when available', () => {
    const t = byName('Agumon');
    expect(t).toBeTruthy();
    const base = variantBase(t.name);
    const available = entries.filter((d) => d.id !== t.id && variantBase(d.name) === base).length;
    const choices = buildChoices(t, entries, 4, seq([0.1, 0.5, 0.3, 0.7, 0.2, 0.9, 0.4]), 'hard');
    const sameBase = choices.filter((d) => d.id !== t.id && variantBase(d.name) === base);
    expect(sameBase.length).toBe(Math.min(3, available));
  });

  it('easy still returns n unique options including the target', () => {
    const t = byName('Agumon');
    const choices = buildChoices(t, entries, 4, seq([0.2, 0.4, 0.6, 0.8, 0.1, 0.3]), 'easy');
    expect(choices).toHaveLength(4);
    expect(new Set(choices.map((d) => d.id)).size).toBe(4);
    expect(choices.some((d) => d.id === t.id)).toBe(true);
  });
});

describe('buildChoices telemetry (FEAT-03)', () => {
  const byName = (n: string) => entries.find((d) => d.name === n)!;

  it('places supplied confusable[] ids first as distractors', () => {
    const t = byName('Agumon');
    expect(t).toBeTruthy();
    // Pick three real, distinct, non-target ids to mark as crowd-confusable.
    const confusable = entries
      .filter((d) => d.id !== t.id)
      .slice(0, 3)
      .map((d) => d.id);
    // rng = 0 always takes the first element of each layer, so the confusable
    // layer (layered first) is consumed in served order before any heuristic fill.
    const choices = buildChoices(t, entries, 4, () => 0, 'telemetry', { confusable });
    const distractorIds = new Set(choices.filter((d) => d.id !== t.id).map((d) => d.id));
    expect(distractorIds.size).toBe(3);
    for (const id of confusable) expect(distractorIds.has(id)).toBe(true);
    expect(choices.some((d) => d.id === t.id)).toBe(true);
  });

  it('ignores confusable ids that are the target or not in the dataset', () => {
    const t = byName('Agumon');
    const valid = entries.find((d) => d.id !== t.id)!.id;
    // target id + a bogus id should be skipped; only `valid` survives the mapping.
    const choices = buildChoices(t, entries, 4, () => 0, 'telemetry', {
      confusable: [t.id, 999999, valid],
    });
    const distractorIds = choices.filter((d) => d.id !== t.id).map((d) => d.id);
    expect(distractorIds).toContain(valid);
    expect(distractorIds).not.toContain(t.id);
    expect(distractorIds).not.toContain(999999);
  });

  it('with empty/absent telemetry data equals the hard result', () => {
    const t = byName('Agumon');
    const rngSeq = [0.1, 0.5, 0.3, 0.7, 0.2, 0.9, 0.4];
    const hard = buildChoices(t, entries, 4, seq(rngSeq), 'hard');
    const teleEmpty = buildChoices(t, entries, 4, seq(rngSeq), 'telemetry', { confusable: [] });
    const teleAbsent = buildChoices(t, entries, 4, seq(rngSeq), 'telemetry');
    expect(teleEmpty.map((d) => d.id)).toEqual(hard.map((d) => d.id));
    expect(teleAbsent.map((d) => d.id)).toEqual(hard.map((d) => d.id));
  });
});

describe('pickTarget weighted (FEAT-03 Mode C)', () => {
  it('only ever returns members of the supplied pool', () => {
    const targets = guessableTargets(entries, sphere0(), SLOT);
    expect(targets.length).toBeGreaterThan(1);
    // A bias that strongly favours one tier must still never widen eligibility:
    // every drawn target is a member of the input pool.
    const ids = new Set(targets.map((d) => d.id));
    const weightOf = (d: Digimon) => (d.id === targets[targets.length - 1].id ? 5 : 1);
    const rng = seq([0.0, 0.25, 0.5, 0.75, 0.99]);
    for (let i = 0; i < 50; i += 1) {
      const picked = pickTarget(targets, rng, weightOf)!;
      expect(ids.has(picked.id)).toBe(true);
    }
  });

  it('is deterministic under a seeded rng', () => {
    const targets = guessableTargets(entries, sphere0(), SLOT);
    const weightOf = (d: Digimon) => (d.level === 'Rookie' ? 1.6 : 1);
    const a = pickTarget(targets, () => 0.5, weightOf);
    const b = pickTarget(targets, () => 0.5, weightOf);
    expect(a).toBe(b);
  });

  it('rng=0 with uniform-ish weights returns the first pool member', () => {
    const targets = guessableTargets(entries, sphere0(), SLOT);
    // With rng()=0, the cumulative-weight walk stops at the first element.
    expect(pickTarget(targets, () => 0, () => 1)).toBe(targets[0]);
  });

  it('a zero/negative/NaN weight is floored to a positive weight (no starvation)', () => {
    const targets = guessableTargets(entries, sphere0(), SLOT);
    // weightOf returns 0 for everything; the guard floors each to 1, so the pick
    // is well-defined (uniform) rather than dividing by a zero total.
    const picked = pickTarget(targets, () => 0, () => 0);
    expect(targets.some((d) => d.id === picked!.id)).toBe(true);
  });
});
