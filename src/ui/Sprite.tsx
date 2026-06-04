// Renders a Digimon sprite. When a build-time-baked transparent cutout exists
// (manifest === 'ok'), it uses the real-shape cutout:
//   • colour mode    → <img> of the transparent cutout (no white box)
//   • silhouette mode → a CSS mask filled with a palette token (--dp-primary by
//     default, or a passed `fill`), giving a real-shape silhouette tinted to the
//     active theme — not the old flat brightness(0) blob.
// When the cutout is flagged 'fallback' (non-white/transparent bg, very light
// creatures) it keeps the legacy boxed rendering: a plain <img>, silhouette via
// a brightness(0) filter — so odd-background sprites still render.
//
// Cutouts are baked offline by tools/bake-sprites.mjs and bundled same-origin;
// nothing is fetched at runtime (Flag A). Same-origin bundling also makes the
// CSS mask reliable (no CORS on mask-image).

import type { CSSProperties } from 'react';
import { cutoutSrc } from './cutout';

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
  const { url, isCutout } = cutoutSrc(src);

  if (!url) {
    return (
      <span className="text-xs" style={{ color: 'var(--dp-text-muted)' }}>
        {shadow ? '???' : name}
      </span>
    );
  }

  // Real-shape silhouette via CSS mask tinted with a palette token.
  if (shadow && isCutout) {
    const maskStyle: CSSProperties = {
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

  // Colour cutout, or boxed-fallback (cutout/colour); silhouette fallback uses
  // the legacy brightness(0) filter so odd-bg sprites still read as a shadow.
  return (
    <img
      className={`object-contain ${className}`}
      src={url}
      alt={shadow ? 'Mystery Digimon' : name}
      loading="lazy"
      draggable={false}
      style={shadow ? { filter: `brightness(0) drop-shadow(0 0 3px ${glow})` } : undefined}
    />
  );
}
