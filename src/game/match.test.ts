import { describe, expect, it } from 'vitest';

import { dataset, isRoot } from '../data/dataset';
import { buildState } from './state';
import {
  evaluateGuess,
  findByName,
  isStrictPrefixOfUncaughtGuessable,
  normalizeName,
  resolveByName,
} from './match';
import { entryStatus, lockReason } from './status';
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

// Real-data prefix anchors (verified against the bundled dataset):
//   Agumon (id 1)      normalizes to "agumon"        — Rookie Vaccine root
//   Agumon Hakase (801) normalizes to "agumonhakase" — Rookie Vaccine root (a
//     strict, longer prefix-match of "agumon"); both guessable in sphere0.
//   Burgamon (521)     normalizes to "burgamon"      — Rookie Vaccine root
//   Burgamon Adult (522) "burgamonadult" — Champion (locked in sphere0).
//   Tentomon (85) "tentomon" — Rookie Vaccine root, prefix of nothing.
const agumon = entries.find((d) => d.id === 1)!;
const agumonHakase = entries.find((d) => d.id === 801)!;
const burgamon = entries.find((d) => d.id === 521)!;
const burgamonAdult = entries.find((d) => d.id === 522)!;
const tentomon = entries.find((d) => d.id === 85)!;

describe('resolveByName', () => {
  it('classifies a single match exactly like evaluateGuess (catch / already / unknown / locked)', () => {
    // catch
    expect(resolveByName(rookieVaccineRoot.name, entries, sphere0(), SLOT)).toEqual({
      kind: 'catch',
      digimon: rookieVaccineRoot,
    });
    // already
    const caughtSt = sphere0(1, new Set([rookieVaccineRoot.id]));
    expect(resolveByName(rookieVaccineRoot.name, entries, caughtSt, SLOT).kind).toBe('already');
    // unknown
    expect(resolveByName('zzzznotadigimon', entries, sphere0(), SLOT).kind).toBe('unknown');
    expect(resolveByName('', entries, sphere0(), SLOT).kind).toBe('unknown');
    // locked
    const champ = entries.find((d) => d.level === 'Champion' && d.attribute === 'Vaccine')!;
    expect(resolveByName(champ.name, entries, sphere0(), SLOT).kind).toBe('locked');
  });

  it('prefers the uncaught + guessable entry when several share a normalized name', () => {
    // Two synthetic entries that normalize identically: one catchable now
    // (Rookie Vaccine root), one locked (Virus, no key). resolveByName must
    // return the catchable one even though the locked one is listed first.
    // The catchable entry reuses a real root id (rookieVaccineRoot) so guessable()
    // passes (root, Rookie, Vaccine); the locked entry is a non-root Virus, listed
    // first. resolveByName must return the catchable one regardless of order.
    const locked: Digimon = { ...rookieVaccineRoot, id: 900001, attribute: 'Virus', name: 'Sharedname' };
    const catchable: Digimon = { ...rookieVaccineRoot, name: 'Shared Name' };
    const out = resolveByName('sharedname', [locked, catchable], sphere0(), SLOT);
    expect(out).toEqual({ kind: 'catch', digimon: catchable });
  });

  it('prefers caught (already) over locked among colliding names', () => {
    const caughtOne: Digimon = { ...rookieVaccineRoot, id: 900003, name: 'Twins' };
    const lockedOne: Digimon = { ...rookieVaccineRoot, id: 900004, attribute: 'Virus', name: 'Twins' };
    const st = sphere0(1, new Set([caughtOne.id]));
    const out = resolveByName('twins', [lockedOne, caughtOne], st, SLOT);
    expect(out).toEqual({ kind: 'already', digimon: caughtOne });
  });

  it('falls back to the first match (as locked) when none are guessable or caught', () => {
    const a: Digimon = { ...rookieVaccineRoot, id: 900005, attribute: 'Virus', name: 'Dupe' };
    const b: Digimon = { ...rookieVaccineRoot, id: 900006, attribute: 'Virus', name: 'Dupe' };
    const out = resolveByName('dupe', [a, b], sphere0(), SLOT);
    expect(out.kind).toBe('locked');
    if (out.kind === 'locked') expect(out.digimon.id).toBe(a.id);
  });
});

describe('isStrictPrefixOfUncaughtGuessable', () => {
  it('is true when the input is a strict prefix of a longer uncaught + guessable name', () => {
    // "agumon" is a strict prefix of "agumonhakase" (801), which is an uncaught,
    // guessable Rookie Vaccine root in sphere0.
    expect(agumon.name).toBeTruthy();
    expect(isStrictPrefixOfUncaughtGuessable('agumon', entries, sphere0(), SLOT)).toBe(true);
  });

  it('is false for an exact match with no longer guessable continuation', () => {
    // Tentomon is a guessable Rookie Vaccine root but a prefix of nothing.
    expect(isStrictPrefixOfUncaughtGuessable(tentomon.name, entries, sphere0(), SLOT)).toBe(false);
  });

  it('is false when the only longer name is locked', () => {
    // "burgamon" is a strict prefix of "burgamonadult" (522, Champion = locked
    // in sphere0), so no uncaught+guessable continuation exists.
    expect(burgamon.id).toBe(521);
    expect(burgamonAdult.level).toBe('Champion');
    expect(isStrictPrefixOfUncaughtGuessable('burgamon', entries, sphere0(), SLOT)).toBe(false);
  });

  it('is false when the only longer continuation is already caught', () => {
    // Catch Agumon Hakase (the longer match), then "agumon" no longer has an
    // uncaught+guessable continuation.
    const st = sphere0(1, new Set([agumonHakase.id]));
    expect(isStrictPrefixOfUncaughtGuessable('agumon', entries, st, SLOT)).toBe(false);
  });

  it('is false on empty input', () => {
    expect(isStrictPrefixOfUncaughtGuessable('', entries, sphere0(), SLOT)).toBe(false);
    expect(isStrictPrefixOfUncaughtGuessable('   ', entries, sphere0(), SLOT)).toBe(false);
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
