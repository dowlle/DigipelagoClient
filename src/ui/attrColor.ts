// Attribute → CSS colour-variable map (see styles.css). Falls back to Unknown.
const MAP: Record<string, string> = {
  Vaccine: 'var(--attr-vaccine)',
  Virus: 'var(--attr-virus)',
  Data: 'var(--attr-data)',
  Free: 'var(--attr-free)',
  Variable: 'var(--attr-variable)',
  Unknown: 'var(--attr-unknown)',
};

export function attrColor(attribute: string): string {
  return MAP[attribute] ?? 'var(--attr-unknown)';
}
