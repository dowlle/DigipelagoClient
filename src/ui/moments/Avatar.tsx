// Small circular player avatar — a coloured initials chip (ported from the
// round-2 mock's HudAvatar). Presentation only.

import { playerColor, playerInitial } from './playerColor';

export function Avatar({ name, size = 18 }: { name: string; size?: number }) {
  const color = playerColor(name);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold"
      title={name}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, size * 0.45),
        background: `color-mix(in srgb, ${color} 22%, transparent)`,
        border: `1px solid ${color}`,
        color,
        fontFamily: 'var(--dp-font-disp)',
      }}
    >
      {playerInitial(name)}
    </span>
  );
}
