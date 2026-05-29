import { describe, expect, it } from 'vitest';

import { dataset, getDigimon, isRoot, priorsOf } from '../data/dataset';
import { buildState, summarizeReceived, assertDatasetMatches } from './state';
import { guessable, goalProgress } from './guess';
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

// Starter kit = precollected Rookie Digivolution + Vaccine Key.
function sphere0(caughtCount = 0, caught = new Set<number>()): GameState {
  return buildState(SLOT, ['Digivolution', 'Vaccine Key'], caughtCount, caught);
}

describe('dataset integrity', () => {
  it('has Rookie..Mega tiers and no Ultra', () => {
    expect(Object.keys(dataset.levelTier).sort()).toEqual(['Champion', 'Mega', 'Rookie', 'Ultimate']);
  });
  it('every non-root has a curated prior; roots have none', () => {
    for (const id of Object.keys(dataset.meta).map(Number)) {
      if (isRoot(id)) expect(priorsOf(id)).toHaveLength(0);
      else expect(priorsOf(id).length).toBeGreaterThan(0);
    }
  });
});

describe('summarizeReceived', () => {
  it('decodes by item name', () => {
    const r = summarizeReceived(['Digivolution', 'Digivolution', 'DigiStorage Upgrade', 'Virus Key']);
    expect(r.digivolutionCount).toBe(2);
    expect(r.upgradeCount).toBe(1);
    expect(r.heldAttributes.has('Virus')).toBe(true);
  });
});

describe('guessable', () => {
  const rookieVaccine = Object.values(dataset.meta).find(
    (d) => d.level === 'Rookie' && d.attribute === 'Vaccine' && isRoot(d.id),
  )!;

  it('sphere 0 can guess a Rookie Vaccine root', () => {
    expect(guessable(rookieVaccine, sphere0(), dataset.levelTier)).toBe(true);
  });

  it('sphere 0 cannot guess a Champion (level locked)', () => {
    const champ = Object.values(dataset.meta).find((d) => d.level === 'Champion' && d.attribute === 'Vaccine')!;
    expect(guessable(champ, sphere0(), dataset.levelTier)).toBe(false);
  });

  it('cannot guess a non-Vaccine Digimon without its attribute key', () => {
    const virusRookie = Object.values(dataset.meta).find((d) => d.level === 'Rookie' && d.attribute === 'Virus')!;
    expect(guessable(virusRookie, sphere0(), dataset.levelTier)).toBe(false);
  });

  it('capacity cap blocks guessing once full', () => {
    const full = sphere0(50); // caughtCount === capacity (50)
    expect(guessable(rookieVaccine, full, dataset.levelTier)).toBe(false);
  });

  it('a non-root Champion needs a caught prior (line ordering)', () => {
    const champ = Object.values(dataset.meta).find(
      (d) => d.level === 'Champion' && d.attribute === 'Vaccine' && !isRoot(d.id) && priorsOf(d.id).length > 0,
    )!;
    // Reach Champion tier + hold Vaccine, but caught nothing yet.
    const st = buildState(SLOT, ['Digivolution', 'Digivolution', 'Vaccine Key'], 0, new Set());
    expect(guessable(champ, st, dataset.levelTier)).toBe(false);
    // Now catch one of its priors -> becomes guessable.
    const withPrior = buildState(SLOT, ['Digivolution', 'Digivolution', 'Vaccine Key'], 1, new Set([priorsOf(champ.id)[0]]));
    expect(guessable(champ, withPrior, dataset.levelTier)).toBe(true);
  });
});

describe('goalProgress', () => {
  it('counts total caught for a total goal', () => {
    const st = sphere0(3, new Set([1, 2, 3]));
    expect(goalProgress(st, SLOT, getDigimon)).toEqual({ current: 3, target: 100 });
  });
  it('counts only the target level for a level goal', () => {
    const ultimate = Object.values(dataset.meta).find((d) => d.level === 'Ultimate')!;
    const rookie = Object.values(dataset.meta).find((d) => d.level === 'Rookie')!;
    const levelSlot: SlotData = { ...SLOT, goal: 'level', goal_level: 'Ultimate', goal_count: 20 };
    const st = sphere0(2, new Set([ultimate.id, rookie.id]));
    expect(goalProgress(st, levelSlot, getDigimon)).toEqual({ current: 1, target: 20 });
  });
});

describe('assertDatasetMatches', () => {
  it('passes when versions match', () => {
    expect(() => assertDatasetMatches(SLOT, dataset.version)).not.toThrow();
  });
  it('throws on mismatch', () => {
    expect(() => assertDatasetMatches({ ...SLOT, dataset_version: 'deadbeef' }, dataset.version)).toThrow(/mismatch/);
  });
});
