// Attribute → accent hex. Used for the dex cell attribute dot + grouping accents.
const MAP: Record<string, string> = {
  Vaccine: '#3b82f6', // blue
  Virus: '#ef4444', // red
  Data: '#22c55e', // green
  Free: '#14b8a6', // teal
  Variable: '#f59e0b', // amber
  Unknown: '#64748b', // slate
};

export function attrColor(attribute: string): string {
  return MAP[attribute] ?? '#64748b';
}
