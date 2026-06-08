// Runtime sprite engine. Digipelago hosts NO sprite art. With the user's consent
// (see spriteConsent.ts), this fetches a Digimon image directly from Digi-API in
// the user's browser, computes the transparent cutout on a <canvas> (the same
// white-keyout flood-fill the dev bake uses), and caches the result on the user's
// DEVICE via the Cache API. Subsequent loads (even across reloads) are served
// from that on-device cache, so Digi-API is hit at most once per sprite per
// device. Nothing is fetched or cached unless a caller has consent.
//
// Digi-API sends Access-Control-Allow-Origin: *, so fetch->blob->ImageBitmap is
// CORS-clean and the canvas read is not tainted.

import { DATASET_VERSION } from '../data/dataset';
import manifest from '../assets/cutouts/manifest.json';

const STATUS = manifest as Record<string, 'ok' | 'fallback'>;

// Cutout tuning (ported verbatim from tools/bake-sprites.mjs).
const WHITE = 228;
const FEATHER_MIN = 205;
const FEATHER_SAT = 22;
const FEATHER_ALPHA = 0.35;
const MIN_KEPT = 0.12; // below this the flood-fill ate the creature -> boxed fallback

// Versioned so a dataset change can't serve stale cutouts.
const CACHE_NAME = `digipelago-sprites-v${DATASET_VERSION}`;

/** "https://digi-api.com/images/digimon/w/Agumon.png" -> "Agumon". */
export function spriteBasename(sprite: string | null): string | null {
  if (!sprite) return null;
  const file = sprite.split('/').pop();
  return file ? file.replace(/\.png$/i, '') : null;
}

/** Known non-white-bg / too-light sprites: skip the cutout, keep the boxed image. */
export function isKnownFallback(sprite: string | null): boolean {
  const b = spriteBasename(sprite);
  return !!b && STATUS[b] === 'fallback';
}

/**
 * Border flood-fill cutout, in place on an RGBA buffer. Returns the kept-opaque
 * ratio, or -1 when the source isn't a white-box sprite (so the caller boxes it).
 */
function carve(data: Uint8ClampedArray, w: number, h: number): number {
  const whiteCorner = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    return data[p + 3] > 250 && data[p] > WHITE && data[p + 1] > WHITE && data[p + 2] > WHITE;
  };
  const whiteCorners =
    Number(whiteCorner(0, 0)) + Number(whiteCorner(w - 1, 0)) +
    Number(whiteCorner(0, h - 1)) + Number(whiteCorner(w - 1, h - 1));
  if (whiteCorners < 3) return -1;

  const N = w * h;
  const isWhitish = (i: number) => {
    const p = i * 4;
    return data[p] > WHITE && data[p + 1] > WHITE && data[p + 2] > WHITE;
  };
  let opaqueBefore = 0;
  for (let i = 0; i < N; i++) if (data[i * 4 + 3] > 8) opaqueBefore++;

  const visited = new Uint8Array(N);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop() as number;
    if (i < 0 || i >= N || visited[i]) continue;
    visited[i] = 1;
    if (!isWhitish(i)) continue;
    data[i * 4 + 3] = 0;
    const x = i % w, y = (i - x) / w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }

  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] === 0) continue;
    const x = i % w, y = (i - x) / w, p = i * 4;
    const mn = Math.min(data[p], data[p + 1], data[p + 2]);
    const mx = Math.max(data[p], data[p + 1], data[p + 2]);
    if (mn > FEATHER_MIN && mx - mn < FEATHER_SAT) {
      let edge = false;
      if (x > 0 && data[(i - 1) * 4 + 3] === 0) edge = true;
      else if (x < w - 1 && data[(i + 1) * 4 + 3] === 0) edge = true;
      else if (y > 0 && data[(i - w) * 4 + 3] === 0) edge = true;
      else if (y < h - 1 && data[(i + w) * 4 + 3] === 0) edge = true;
      if (edge) data[p + 3] = Math.round(data[p + 3] * FEATHER_ALPHA);
    }
  }

  let opaqueAfter = 0;
  for (let i = 0; i < N; i++) if (data[i * 4 + 3] > 8) opaqueAfter++;
  return opaqueBefore ? opaqueAfter / opaqueBefore : 0;
}

/** Fetch the sprite and produce a blob: a transparent cutout, or the boxed original. */
async function buildBlob(srcUrl: string, allowCutout: boolean): Promise<{ blob: Blob; isCutout: boolean }> {
  const res = await fetch(srcUrl, { mode: 'cors' });
  if (!res.ok) throw new Error(`sprite fetch ${res.status}`);
  const raw = await res.blob();
  if (!allowCutout || typeof createImageBitmap === 'undefined') return { blob: raw, isCutout: false };
  try {
    const bmp = await createImageBitmap(raw);
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { blob: raw, isCutout: false };
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const kept = carve(img.data, cv.width, cv.height);
    if (kept < MIN_KEPT) return { blob: raw, isCutout: false }; // -1 or too-light -> boxed
    ctx.putImageData(img, 0, 0);
    const out = await new Promise<Blob | null>((resolve) => cv.toBlob(resolve, 'image/png'));
    return out ? { blob: out, isCutout: true } : { blob: raw, isCutout: false };
  } catch {
    return { blob: raw, isCutout: false };
  }
}

// Per-session memo of resolved object URLs, so repeated mounts reuse one URL.
const resolved = new Map<string, { url: string; isCutout: boolean }>();

/**
 * Resolve a sprite URL to an on-device, ready-to-render object URL (transparent
 * cutout when possible, else boxed). Caller MUST have consent. Hits Digi-API at
 * most once per sprite per device (Cache API persists across reloads).
 */
export async function loadSprite(srcUrl: string): Promise<{ url: string; isCutout: boolean }> {
  const base = spriteBasename(srcUrl) ?? srcUrl;
  const memo = resolved.get(base);
  if (memo) return memo;

  const allowCutout = !isKnownFallback(srcUrl);
  const cacheKey = `https://digipelago.sprite-cache/${encodeURIComponent(base)}`;

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(cacheKey);
      if (hit) {
        const isCutout = hit.headers.get('x-cutout') === '1';
        const url = URL.createObjectURL(await hit.blob());
        const out = { url, isCutout };
        resolved.set(base, out);
        return out;
      }
      const { blob, isCutout } = await buildBlob(srcUrl, allowCutout);
      await cache.put(
        cacheKey,
        new Response(blob, { headers: { 'content-type': 'image/png', 'x-cutout': isCutout ? '1' : '0' } }),
      );
      const out = { url: URL.createObjectURL(blob), isCutout };
      resolved.set(base, out);
      return out;
    } catch {
      /* fall through to no-cache build */
    }
  }

  const { blob, isCutout } = await buildBlob(srcUrl, allowCutout);
  const out = { url: URL.createObjectURL(blob), isCutout };
  resolved.set(base, out);
  return out;
}
