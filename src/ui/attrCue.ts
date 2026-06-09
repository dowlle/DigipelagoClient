// Colourblind-safe attribute cue. Sibling to attrColor.ts (which stays the single
// source of COLOUR): attrColor drives the dot's hue, attrCue gives a short text
// label + a distinct shape token so attribute identity is conveyed by label and
// shape, not colour alone. Pure, dependency-free, additive.
//
// The accessibility guarantee is that every known attribute maps to a DISTINCT,
// non-empty short label (verified by attrCue.test.ts). Unknown / missing falls
// back to the Unknown cue.

export type AttrShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon' | 'ring';

export interface AttrCue {
  /** Two-letter abbreviation rendered next to the colour dot. */
  label: string;
  /** A distinct shape token (redundant non-colour channel). */
  shape: AttrShape;
  /** Full attribute name for title / aria-label. */
  full: string;
}

const CUES: Record<string, AttrCue> = {
  Vaccine: { label: 'Vc', shape: 'circle', full: 'Vaccine' },
  Virus: { label: 'Vi', shape: 'triangle', full: 'Virus' },
  Data: { label: 'Da', shape: 'square', full: 'Data' },
  Free: { label: 'Fr', shape: 'diamond', full: 'Free' },
  Variable: { label: 'Va', shape: 'hexagon', full: 'Variable' },
  Unknown: { label: '?', shape: 'ring', full: 'Unknown' },
};

const UNKNOWN_CUE = CUES.Unknown;

/** Resolve an attribute name to its colourblind-safe cue (label + shape + full). */
export function attrCue(attribute: string): AttrCue {
  return CUES[attribute] ?? UNKNOWN_CUE;
}
