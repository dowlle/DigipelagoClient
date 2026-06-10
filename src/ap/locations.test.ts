import { describe, expect, it } from 'vitest';
import type { Client } from 'archipelago.js';
import { catchSlotName, countCheckedCatchSlots, nextCatchSlotName, parseCatchSlot } from './locations';

/** Minimal fake client: a checkedLocations list + a Digipelago data package. */
function fakeClient(checked: number[], reverse: Record<number, string> | null): Client {
  return {
    room: { checkedLocations: checked },
    package: {
      findPackage: () => (reverse ? { reverseLocationTable: reverse } : null),
    },
  } as unknown as Client;
}

describe('catch-slot naming', () => {
  it('is 1-indexed with no leading zeros', () => {
    expect(catchSlotName(1)).toBe('Catch Slot #1');
    expect(catchSlotName(922)).toBe('Catch Slot #922');
  });

  it('nextCatchSlotName advances from the checked count', () => {
    expect(nextCatchSlotName(0)).toBe('Catch Slot #1'); // first catch
    expect(nextCatchSlotName(41)).toBe('Catch Slot #42');
  });

  it('round-trips through parseCatchSlot', () => {
    for (const k of [1, 7, 42, 922]) {
      expect(parseCatchSlot(catchSlotName(k))).toBe(k);
    }
  });

  it('rejects non-catch-slot and malformed names', () => {
    expect(parseCatchSlot('Digipelago Victory')).toBeNull();
    expect(parseCatchSlot('Catch Slot #0')).toBeNull(); // 1-indexed
    expect(parseCatchSlot('Catch Slot #01')).toBeNull(); // leading zero
    expect(parseCatchSlot('Catch Slot #')).toBeNull();
    expect(parseCatchSlot('Catch Slot #1x')).toBeNull();
  });
});

describe('countCheckedCatchSlots', () => {
  const REVERSE = { 1: 'Catch Slot #1', 2: 'Catch Slot #2', 3: 'Catch Slot #3' };

  it('counts distinct checked catch slots', () => {
    expect(countCheckedCatchSlots(fakeClient([1, 2], REVERSE))).toBe(2);
  });

  it('ignores duplicate ids (server re-broadcasts around !collect/!release)', () => {
    // The 2766/950 Storage bug: archipelago.js appends RoomUpdate lists without
    // dedup, so the same 922 ids can appear 3x. Distinct ids only.
    expect(countCheckedCatchSlots(fakeClient([1, 2, 3, 1, 2, 3, 1, 2, 3], REVERSE))).toBe(3);
  });

  it('skips non-catch locations', () => {
    expect(countCheckedCatchSlots(fakeClient([1, 99], { ...REVERSE, 99: 'Some Event' }))).toBe(1);
  });

  it('package-less fallback also dedupes', () => {
    expect(countCheckedCatchSlots(fakeClient([1, 1, 2, 2], null))).toBe(2);
  });
});
