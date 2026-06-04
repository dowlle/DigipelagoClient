// Resolves a Digimon to its build-time-baked transparent cutout (or the boxed
// original sprite as a fallback). The cutouts are produced offline by
// `tools/bake-sprites.mjs` (port of the round-2 spritecache.js flood-fill, run
// once over the pinned snapshot) and bundled under public/cutouts/. The
// manifest marks which bakes are usable ("ok") vs flagged ("fallback" → render
// the boxed original). This is a presentation-only read; it fetches nothing at
// runtime in production.

import manifest from '../assets/cutouts/manifest.json';

const STATUS = manifest as Record<string, 'ok' | 'fallback'>;

/**
 * The cutout filename basename for a sprite URL, matching how the bake script
 * derived it: the URL's file part minus the `.png` extension.
 * "https://digi-api.com/images/digimon/w/Metal_Mamemon.png" -> "Metal_Mamemon"
 */
export function spriteBasename(sprite: string | null): string | null {
  if (!sprite) return null;
  const file = sprite.split('/').pop();
  if (!file) return null;
  return file.replace(/\.png$/i, '');
}

export interface CutoutRef {
  /** URL to render: the bundled transparent cutout, or the boxed original. */
  url: string | null;
  /** true when `url` is a real-shape transparent cutout (mask/colour modes),
   *  false when it's the boxed original sprite (legacy fallback rendering). */
  isCutout: boolean;
}

/**
 * Resolve a Digimon's sprite to a cutout (when baked ok) or the boxed original.
 * `base: './'` in vite.config means assets are served relative to BASE_URL.
 */
export function cutoutSrc(sprite: string | null): CutoutRef {
  const base = spriteBasename(sprite);
  if (base && STATUS[base] === 'ok') {
    return {
      url: `${import.meta.env.BASE_URL}cutouts/${encodeURIComponent(base)}.png`,
      isCutout: true,
    };
  }
  // 'fallback', unknown, or missing manifest entry → boxed original sprite.
  return { url: sprite, isCutout: false };
}
