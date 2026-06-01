// Loads the bundled, pinned Digimon dataset (built by the apworld's
// tools/build_digimon_data.py from a Digi-API snapshot — non-commercial fan
// project). This is the static reference data; per-seed config arrives via
// Archipelago slot_data. The two are tied together by `version` /
// `slot_data.dataset_version` so a mismatched client can't silently drift.

import type { Dataset, Digimon } from '../game/types';
import raw from './digimon_mvp.json';

interface RawDataset {
  version?: string;
  level_tier: Record<string, number>;
  attributes: string[];
  cell_counts: Record<string, number>;
  roots: number[];
  lines: Record<string, number[]>;
  meta: Record<string, Omit<Digimon, 'id'> & { tier: number }>;
}

const _raw = raw as unknown as RawDataset;

// Embedded by tools/build_digimon_data.py into digimon_mvp.json and READ here,
// so the apworld (data.py) and this client share one token and can't drift.
// Asserted against slot_data.dataset_version at connect. The fallback covers a
// pre-embed bundle only.
export const DATASET_VERSION = _raw.version ?? '0ba713b32382';

export const dataset: Dataset = {
  version: DATASET_VERSION,
  levelTier: _raw.level_tier,
  attributes: _raw.attributes,
  roots: new Set(_raw.roots),
  lines: _raw.lines,
  meta: Object.fromEntries(
    Object.entries(_raw.meta).map(([id, m]) => [id, { ...m, id: Number(id) }]),
  ) as Record<string, Digimon>,
};

export function getDigimon(id: number): Digimon | undefined {
  return dataset.meta[String(id)];
}

export function isRoot(id: number): boolean {
  return dataset.roots.has(id);
}

/** Curated prior ids for a Digimon (empty for roots). */
export function priorsOf(id: number): number[] {
  return dataset.lines[String(id)] ?? [];
}
