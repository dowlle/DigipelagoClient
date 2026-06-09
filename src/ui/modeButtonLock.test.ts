import { describe, expect, it } from 'vitest';

import { modeButtonLock } from './AppShell';

// #5: the seed mode-lock now reads ON the switch buttons. The lock affordance
// logic is extracted as a pure helper so it can be tested without a DOM renderer
// (the test harness runs in the node environment, no React testing library).
describe('modeButtonLock', () => {
  it('shows no lock when modes are not seed-locked', () => {
    expect(modeButtonLock(true, false)).toEqual({ showLock: false, title: undefined });
    expect(modeButtonLock(false, false)).toEqual({ showLock: false, title: undefined });
  });

  it('shows no lock on the active (seed-fixed) button even when locked', () => {
    // The button you are fixed to reads as the chosen mode, never as locked.
    expect(modeButtonLock(true, true)).toEqual({ showLock: false, title: undefined });
  });

  it('shows the lock on every NON-active button when modes are seed-locked', () => {
    const out = modeButtonLock(false, true);
    expect(out.showLock).toBe(true);
    expect(out.title).toBeTruthy();
    // The tooltip names the lock so the button self-describes.
    expect(out.title).toContain('Locked');
  });

  it('keeps the lock tooltip free of em dashes (build check guards user strings)', () => {
    const out = modeButtonLock(false, true);
    expect(out.title).not.toContain(String.fromCharCode(0x2014));
  });
});
