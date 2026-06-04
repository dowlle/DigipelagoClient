// Deterministic avatar colour for a player name (ported from the round-2
// shared.jsx `playerColor`). Pure presentation: a stable hash → palette index,
// so each peer keeps the same accent colour across the feed and avatars.

const PALETTE = ['#3F8DF6', '#E0445B', '#22B07A', '#15B6C6', '#E8A234', '#A06CF0', '#FF7A59'];

export function playerColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** First letter for the avatar chip. */
export function playerInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}
