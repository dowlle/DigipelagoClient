// Attribute → CSS colour token. Returns a `var(--dp-attr-*)` reference so the
// dex cell attribute dot (and any moment/feed accent) auto-reskins with the
// active palette — zero JS, the value resolves under the live `data-theme`.
const TOKEN: Record<string, string> = {
  Vaccine: 'var(--dp-attr-vaccine)',
  Virus: 'var(--dp-attr-virus)',
  Data: 'var(--dp-attr-data)',
  Free: 'var(--dp-attr-free)',
  Variable: 'var(--dp-attr-variable)',
  Unknown: 'var(--dp-attr-unknown)',
};

export function attrColor(attribute: string): string {
  return TOKEN[attribute] ?? 'var(--dp-attr-unknown)';
}
