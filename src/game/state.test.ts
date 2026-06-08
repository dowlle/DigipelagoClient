import { describe, expect, it } from 'vitest';
import { buildState, summarizeReceived } from './state';
import type { SlotData } from './types';

const SLOT: SlotData = {
  dataset_version: 'test',
  starting_capacity: 50,
  capacity_per_upgrade: 50,
  goal: 'total',
  goal_level: null,
  goal_count: 30,
  starting_attribute: 'Vaccine',
  starting_stamina: 5,
  level_tier: { Rookie: 2, Champion: 3, Ultimate: 4, Mega: 5 },
  attributes: ['Vaccine', 'Virus', 'Data', 'Free'],
  cell_counts: {},
  pool_size: 922,
};

describe('Stamina Up tally (silhouette meter max boost)', () => {
  it('summarizeReceived counts "Stamina Up" items', () => {
    const r = summarizeReceived(['Digivice', 'Stamina Up', 'Vaccine Key', 'Stamina Up', 'Digivolution']);
    expect(r.staminaUps).toBe(2);
    expect(r.upgradeCount).toBe(0); // not confused with DigiStorage Upgrade
    expect(r.heldAttributes.has('Stamina')).toBe(false);
  });

  it('buildState surfaces staminaUps so the meter max can grow', () => {
    const three = buildState(SLOT, ['Stamina Up', 'Stamina Up', 'Stamina Up'], 0, new Set());
    expect(three.staminaUps).toBe(3);
    // AppShell computes the silhouette meter max as starting_stamina + staminaUps.
    expect((SLOT.starting_stamina ?? 5) + three.staminaUps).toBe(8);
  });
});

describe('Food tally (received counts for eating)', () => {
  it('summarizeReceived counts each food item by name', () => {
    const r = summarizeReceived(['Processed Meat', 'Processed Meat', 'Digimeat', 'DigiProtein', 'Digivice']);
    expect(r.foodReceived['Processed Meat']).toBe(2);
    expect(r.foodReceived['Digimeat']).toBe(1);
    expect(r.foodReceived['DigiProtein']).toBe(1);
  });

  it('buildState surfaces foodReceived (available = received - eaten)', () => {
    const s = buildState(SLOT, ['Processed Meat', 'Digimeat', 'Digimeat'], 0, new Set());
    expect(s.foodReceived['Processed Meat']).toBe(1);
    expect(s.foodReceived['Digimeat']).toBe(2);
    expect(s.foodReceived['DigiProtein']).toBeUndefined();
  });
});
