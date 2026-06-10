// Renders a Digimon sprite from the on-device runtime cache (see spriteEngine).
// Digipelago hosts no art: until the user consents, this shows a placeholder and
// fetches nothing. Once consent is granted it resolves to an on-device cutout:
//   • colour mode    -> <img> of the transparent cutout (no white box)
//   • silhouette mode -> a CSS mask filled with a palette token (real-shape shadow)
// Boxed-fallback sprites (odd background) keep the legacy <img> + brightness(0).

import type { CSSProperties } from 'react';
import { useSprite } from './useSprite';

export function Sprite({
  src,
  name,
  shadow = false,
  className = '',
  fill,
  glow = 'var(--dp-silhouette-glow)',
}: {
  src: string | null;
  name: string;
  shadow?: boolean;
  className?: string;
  /** Silhouette fill (CSS color / gradient). Defaults to the primary token. */
  fill?: string;
  /** Drop-shadow glow color for silhouettes. */
  glow?: string;
}) {
  const { state, url, isCutout } = useSprite(src);

  // No image yet (no src, awaiting consent, loading, or failed): text placeholder.
  if (state !== 'ready' || !url) {
    return (
      <span
        className={`text-xs ${state === 'loading' ? 'animate-pulse' : ''}`}
        style={{ color: 'var(--dp-text-muted)' }}
      >
        {shadow ? '???' : name}
      </span>
    );
  }

  // Real-shape silhouette via CSS mask tinted with a palette token.
  if (shadow && isCutout) {
    const maskStyle: CSSProperties = {
      // A masked <div> has no intrinsic size (unlike the <img> paths), so fill
      // the parent and let the caller's max-w/max-h classes cap it; without
      // this the silhouette computes to 0x0 and renders as nothing.
      width: '100%',
      height: '100%',
      WebkitMaskImage: `url("${url}")`,
      maskImage: `url("${url}")`,
      WebkitMaskSize: 'contain',
      maskSize: 'contain',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
      background: fill ?? 'var(--dp-primary)',
      filter: `drop-shadow(0 0 6px ${glow})`,
    };
    return <div aria-label="Mystery Digimon" className={className} style={maskStyle} />;
  }

  // Colour cutout, or boxed-fallback; silhouette fallback uses brightness(0).
  return (
    <img
      className={`object-contain ${className}`}
      src={url}
      alt={shadow ? 'Mystery Digimon' : name}
      draggable={false}
      style={shadow ? { filter: `brightness(0) drop-shadow(0 0 3px ${glow})` } : undefined}
    />
  );
}
