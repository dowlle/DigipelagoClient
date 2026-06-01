import { describe, expect, it } from 'vitest';

import { dataset, isRoot } from '../data/dataset';
import { buildState } from './state';
import { evaluateGuess, findByName, normalizeName } from './match';
import { entryStatus, lockReason } from './status';
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
const rookieVaccineRoot = entries.find(
  (d) => d.level === 'Rookie' && d.attribute === 'Vaccine' && isRoot(d.id),
)!;

describe('normalizeName', () => {
  it('strips case, spaces, punctuation and diacritics', () => {
    expect(normalizeName('  Wei Greymon ')).toBe('weigreymon');
    expect(normalizeName('Agumon (X-Antibody)')).toBe('agumonxantibody');
    expect(normalizeName('Angé')).toBe('ange');
  });
});

describe('findByName', () => {
  it('finds a known Digimon regardless of formatting', () => {
    const messy = `  ${rookieVaccineRoot.name.toUpperCase()} `;
    expect(findByName(messy, entries)?.id).toBe(rookieVaccineRoot.id);
  });
  it('returns undefined for empty or unknown input', () => {
    expect(findByName('', entries)).toBeUndefined();
    expect(findByName('zzzznotadigimon', entries)).toBeUndefined();
  });
});

describe('evaluateGuess', () => {
  it('catches a guessable Digimon', () => {
    const out = evaluateGuess(rookieVaccineRoot.name, entries, sphere0(), SLOT);
    expect(out).toEqual({ kind: 'catch', digimon: rookieVaccineRoot });
  });

  it('reports already-caught', () => {
    const st = sphere0(1, new Set([rookieVaccineRoot.id]));
    const out = evaluateGuess(rookieVaccineRoot.name, entries, st, SLOT);
    expect(out.kind).toBe('already');
  });

  it('reports unknown names', () => {
    expect(evaluateGuess('zzzznotadigimon', entries, sphere0(), SLOT).kind).toBe('unknown');
  });

  it('reports a lock reason for a level-locked guess', () => {
    const champ = entries.find((d) => d.level === 'Champion' && d.attribute === 'Vaccine')!;
    const out = evaluateGuess(champ.name, entries, sphere0(), SLOT);
    expect(out.kind).toBe('locked');
    if (out.kind === 'locked') expect(out.reason).toMatch(/Champion/);
  });
});

describe('entryStatus + lockReason', () => {
  it('caught > guessable > locked priority', () => {
    expect(entryStatus(rookieVaccineRoot, sphere0(1, new Set([rookieVaccineRoot.id])), SLOT)).toBe('caught');
    expect(entryStatus(rookieVaccineRoot, sphere0(), SLOT)).toBe('guessable');
    const virusRookie = entries.find((d) => d.level === 'Rookie' && d.attribute === 'Virus')!;
    expect(entryStatus(virusRookie, sphere0(), SLOT)).toBe('locked');
  });

  it('lockReason explains the binding gate, null when catchable', () => {
    expect(lockReason(rookieVaccineRoot, sphere0(), SLOT)).toBeNull();
    expect(lockReason(rookieVaccineRoot, sphere0(50), SLOT)).toMatch(/DigiStorage full/);
    const champ = entries.find((d) => d.level === 'Champion' && d.attribute === 'Vaccine')!;
    expect(lockReason(champ, sphere0(), SLOT)).toMatch(/not unlocked/);
    const virusRookie = entries.find((d) => d.level === 'Rookie' && d.attribute === 'Virus')!;
    expect(lockReason(virusRookie, sphere0(), SLOT)).toMatch(/Virus key/);
  });
});
