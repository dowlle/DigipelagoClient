import { describe, expect, it } from 'vitest';

import { attrCue } from './attrCue';

const KNOWN = ['Vaccine', 'Virus', 'Data', 'Free', 'Variable', 'Unknown'] as const;

describe('attrCue', () => {
  it('maps every known attribute to a distinct, non-empty short label', () => {
    const labels = KNOWN.map((a) => attrCue(a).label);
    for (const l of labels) {
      expect(l).toBeTruthy();
      expect(l.length).toBeGreaterThan(0);
      expect(l.length).toBeLessThanOrEqual(2);
    }
    // Distinctness is the accessibility guarantee: no two attributes collide.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every known attribute a distinct shape too (redundant non-colour channel)', () => {
    const shapes = KNOWN.map((a) => attrCue(a).shape);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('exposes the full attribute name for title / aria-label', () => {
    expect(attrCue('Vaccine').full).toBe('Vaccine');
    expect(attrCue('Variable').full).toBe('Variable');
  });

  it('falls back to the Unknown cue for an unknown or missing attribute', () => {
    const unknown = attrCue('Unknown');
    expect(attrCue('Nonexistent')).toEqual(unknown);
    expect(attrCue('')).toEqual(unknown);
  });
});
