// Digi-API CDN sprite. `shadow` renders it as a silhouette with a themed glow
// (MC + hard mode + locked dex cells). Per IP posture (ADR-0003) self-hosting
// sprites is a later step.

export function Sprite({
  src,
  name,
  shadow = false,
  className = '',
}: {
  src: string | null;
  name: string;
  shadow?: boolean;
  className?: string;
}) {
  if (!src) {
    return <span className="text-xs" style={{ color: 'var(--dp-text-muted)' }}>{shadow ? '???' : name}</span>;
  }
  return (
    <img
      className={`object-contain ${className}`}
      src={src}
      alt={shadow ? 'Mystery Digimon' : name}
      loading="lazy"
      draggable={false}
      style={shadow ? { filter: 'brightness(0) drop-shadow(0 0 3px var(--dp-silhouette-glow))' } : undefined}
    />
  );
}
