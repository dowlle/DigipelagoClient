// Pixel-perfect reveal: a real-shape silhouette and the full-colour cutout,
// stacked and crossfaded on `revealed` — identical shape, so the silhouette
// resolves into the creature it always was. Ports DigiReveal from the round-2
// shared.jsx (the masked-div silhouette + <img> colour, spring crossfade).
//
// Requires a baked transparent cutout (manifest === 'ok'); when the sprite is a
// 'fallback' (odd background), it degrades to the boxed Sprite, swapping the
// silhouette filter for the colour image on reveal. Used by silhouette mode (MC).

import type { CSSProperties } from 'react';
import { useSprite } from './useSprite';
import { Sprite } from './Sprite';

export function SpriteReveal({
  src,
  name,
  digimonId,
  revealed,
  fill = 'var(--dp-primary)',
  glow = 'var(--dp-silhouette-glow)',
  className = '',
}: {
  src: string | null;
  name: string;
  /** Enables the per-sprite cutout recipe layer (served + local drafts). */
  digimonId?: number;
  revealed: boolean;
  /** Silhouette fill (CSS color / gradient). */
  fill?: string;
  glow?: string;
  className?: string;
}) {
  const { state, url, isCutout } = useSprite(src, digimonId);

  // No ready cutout to mask/stack (awaiting consent, loading, or boxed-fallback)
  // -> defer to Sprite, which renders the placeholder / boxed image + shadow swap.
  if (state !== 'ready' || !url || !isCutout) {
    return <Sprite src={src} name={name} digimonId={digimonId} shadow={!revealed} className={className} />;
  }

  const maskBase: CSSProperties = {
    position: 'absolute',
    inset: 0,
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  };

  return (
    <div className={`relative ${className}`}>
      <div
        aria-hidden
        style={{
          ...maskBase,
          background: fill,
          opacity: revealed ? 0 : 1,
          transform: revealed ? 'scale(1.04)' : 'scale(1)',
          transition: 'opacity .5s ease, transform .5s ease',
          filter: `drop-shadow(0 0 8px ${glow})`,
        }}
      />
      <img
        src={url}
        alt={name}
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          opacity: revealed ? 1 : 0,
          transform: revealed ? 'scale(1)' : 'scale(0.92)',
          transition: 'opacity .55s ease .05s, transform .55s cubic-bezier(.2,1.3,.4,1) .05s',
        }}
      />
    </div>
  );
}
