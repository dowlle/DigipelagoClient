// Digi-API CDN sprite. `shadow` renders it as a black silhouette (MC mode);
// per IP posture (ADR-0003) self-hosting sprites is a later step.

export function Sprite({
  src,
  name,
  shadow = false,
  small = false,
}: {
  src: string | null;
  name: string;
  shadow?: boolean;
  small?: boolean;
}) {
  if (!src) {
    return <span className="muted">{shadow ? '???' : name}</span>;
  }
  const cls = `sprite${shadow ? ' shadow' : ''}${small ? ' small' : ''}`;
  return <img className={cls} src={src} alt={shadow ? 'Mystery Digimon' : name} loading="lazy" />;
}
