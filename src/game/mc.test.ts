import { describe, expect, it } from 'vitest';

import { dataset, isRoot } from '../data/dataset';
import { buildState } from './state';
import { buildChoices, guessableTargets, pickTarget, type Rng } from './mc';
import type { GameState, SlotData } from './types';

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

  it('prefers same-level distractors when enough exist', () => {
    const choices = buildChoices(target, entries, 4, seq([0.42]));
    const distractors = choices.filter((d) => d.id !== target.id);
    expect(distractors.every((d) => d.level === target.level)).toBe(true);
  });
});
