import { describe, expect, it } from 'vitest';
import { classifyShippedItem, itemFlagColor, type ShippedItem } from './feed';

describe('itemFlagColor', () => {
  it('maps each single flag to the exact AP hex', () => {
    expect(itemFlagColor(0)).toBe('#00EEEE'); // none / filler
    expect(itemFlagColor(0b001)).toBe('#AF99EF'); // progression
    expect(itemFlagColor(0b010)).toBe('#6D8BE8'); // useful
    expect(itemFlagColor(0b100)).toBe('#FA8072'); // trap
  });

  it('applies AP precedence progression > useful > trap (elif chain, not max)', () => {
    expect(itemFlagColor(0b011)).toBe('#AF99EF'); // 3: progression beats useful
    expect(itemFlagColor(0b110)).toBe('#6D8BE8'); // 6: useful beats trap
    expect(itemFlagColor(0b101)).toBe('#AF99EF'); // 5: progression beats trap
    expect(itemFlagColor(0b111)).toBe('#AF99EF'); // 7: progression wins
  });

  it('returns undefined for undefined flags so the UI falls back to a token color', () => {
    expect(itemFlagColor(undefined)).toBeUndefined();
  });
});

const SELF = 7;

function shipped(over: Partial<ShippedItem> = {}): ShippedItem {
  return {
    name: 'Some Item',
    locationId: 100,
    flags: 0,
    sender: { slot: SELF },
    receiver: { slot: 2, alias: 'Other' },
    ...over,
  };
}

describe('classifyShippedItem', () => {
  it('produces a catch row for a self-ship from a Catch Slot, even when receiver === self (solo seed regression guard)', () => {
    const item = shipped({ receiver: { slot: SELF, alias: 'Me' }, locationId: 100 });
    const row = classifyShippedItem(item, SELF, 'Catch Slot #3');
    expect(row).not.toBeNull();
    expect(row?.kind).toBe('catch');
    expect(row?.slot).toBe(3);
    // No "to <player>" tail in solo: player stays undefined.
    expect(row?.player).toBeUndefined();
  });

  it('sets player to receiver.alias when the catch ships to another world', () => {
    const item = shipped({ receiver: { slot: 2, alias: 'Other' } });
    const row = classifyShippedItem(item, SELF, 'Catch Slot #1');
    expect(row?.player).toBe('Other');
    expect(row?.slot).toBe(1);
  });

  it('carries the AP item flags through onto the catch row', () => {
    const item = shipped({ flags: 0b001 });
    const row = classifyShippedItem(item, SELF, 'Catch Slot #5');
    expect(row?.flags).toBe(0b001);
  });

  it('returns null for a self-targeted item NOT shipped from a Catch Slot (non-catch source)', () => {
    const item = shipped({ receiver: { slot: SELF, alias: 'Me' } });
    expect(classifyShippedItem(item, SELF, 'Digipelago Victory')).toBeNull();
    expect(classifyShippedItem(item, SELF, undefined)).toBeNull();
  });

  it('returns null when the sender is another world', () => {
    const item = shipped({ sender: { slot: 99 } });
    expect(classifyShippedItem(item, SELF, 'Catch Slot #2')).toBeNull();
  });
});
