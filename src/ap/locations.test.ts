import { describe, expect, it } from 'vitest';
import { catchSlotName, nextCatchSlotName, parseCatchSlot } from './locations';

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
