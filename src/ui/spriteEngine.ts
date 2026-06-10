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

/**
 * Per-sprite cutout recipe (Sprite Cutout Manager). cutout = flood-fill from a
 * SEED SET within a TOLERANCE; everything else is a variation:
 *   - enclosed white pocket  -> extra interior `seeds` (point-cascade)
 *   - fill leaks into body   -> `borderSeeds: false` and/or lower tolerance
 *   - halos / off-white bg   -> higher tolerance + `feather`
 *   - hopeless               -> mode 'boxed' (framed original) or 'raw' (the
 *                               original already has transparency; use as-is)
 * IP rule: recipes are params only, never pixels/masks; the cutout is always
 * recomputed on-device. Served recipes are keyed (dataset_version, target_id).
 */
export interface SpriteRecipe {
  mode?: 'cutout' | 'boxed' | 'raw';
  tolerance?: number; // key-distance threshold override (default 228; higher = stricter)
  borderSeeds?: boolean; // default true (today's border flood)
  seeds?: { x: number; y: number }[]; // EXTRA origins, normalized 0..1
  feather?: number; // edge alpha-feather passes (default 1, 0 = off)
  /**
   * Chroma key: the background colour ('#rrggbb') the border flood removes.
   * Default white. Interior seeds always flood the colour SAMPLED UNDER the
   * seed point, so mixed backgrounds (dark floor + black void, sky + clouds)
   * are removed one click each. Tolerance maps to a per-channel distance
   * budget of (255 - tolerance) around the key, which is byte-identical to
   * the legacy whiteness test when the key is white.
   */
  keyColor?: string;
}

/** Stable short hash of a recipe for cache keys ('' = engine default). */
export function recipeHash(recipe?: SpriteRecipe | null): string {
  if (!recipe || Object.keys(recipe).length === 0) return '';
  const canonical = JSON.stringify(recipe, Object.keys(recipe as Record<string, unknown>).sort());
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) h = ((h << 5) + h + canonical.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

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

type RGB = [number, number, number];
const WHITE_RGB: RGB = [255, 255, 255];
const CORNER_AGREE = 12; // per-channel slack for "the corners share a colour"

/** '#rrggbb' -> RGB, or null when malformed. */
export function parseHexColor(c?: string | null): RGB | null {
  if (!c || !/^#[0-9a-fA-F]{6}$/.test(c)) return null;
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/**
 * Flood-fill cutout from a seed set, in place on an RGBA buffer. Returns the
 * kept-opaque ratio, or -1 when the default heuristic decides the source has
 * no keyable uniform background (so the caller boxes it). An explicit recipe
 * skips that heuristic and is applied verbatim (recipe beats heuristic).
 *
 * Chroma model: the border flood removes pixels within (255 - tolerance) per
 * channel of the KEY colour - recipe.keyColor, else the colour the corners
 * agree on (pure white snaps to the legacy whiteness test), else pure white
 * for explicit recipes. Interior seeds each flood the colour sampled UNDER
 * the seed, so mixed backgrounds are removed one click each.
 */
export function carve(data: Uint8ClampedArray, w: number, h: number, recipe?: SpriteRecipe | null): number {
  const tolerance = recipe?.tolerance ?? WHITE;
  const D = 255 - tolerance; // per-channel distance budget
  const borderSeeds = recipe?.borderSeeds ?? true;
  const extraSeeds = recipe?.seeds ?? [];
  const featherPasses = recipe?.feather ?? 1;
  const explicit = !!recipe && Object.keys(recipe).length > 0;
  const N = w * h;

  const colorAt = (i: number): RGB => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const near = (i: number, c: RGB): boolean => {
    const p = i * 4;
    return (
      Math.abs(data[p] - c[0]) < D &&
      Math.abs(data[p + 1] - c[1]) < D &&
      Math.abs(data[p + 2] - c[2]) < D
    );
  };

  // Resolve the border-flood key colour.
  let key = parseHexColor(recipe?.keyColor);
  if (!key) {
    if (explicit) {
      key = WHITE_RGB; // tuned recipe without a key keeps the legacy white key
    } else {
      // Untuned: do >=3 opaque corners agree on a colour? That colour is the
      // key (snapped to pure white when whitish, preserving the legacy path).
      // No agreement = no keyable background -> boxed fallback.
      const cornerIdx = [0, w - 1, (h - 1) * w, (h - 1) * w + w - 1];
      const corners = cornerIdx
        .filter((i) => data[i * 4 + 3] > 250)
        .map((i) => colorAt(i));
      let detected: RGB | null = null;
      for (const cand of corners) {
        const agree = corners.filter(
          (c) =>
            Math.abs(c[0] - cand[0]) <= CORNER_AGREE &&
            Math.abs(c[1] - cand[1]) <= CORNER_AGREE &&
            Math.abs(c[2] - cand[2]) <= CORNER_AGREE,
        ).length;
        if (agree >= 3) {
          detected = cand;
          break;
        }
      }
      if (!detected) return -1;
      const whitish = detected[0] > tolerance && detected[1] > tolerance && detected[2] > tolerance;
      key = whitish ? WHITE_RGB : detected;
    }
  }

  let opaqueBefore = 0;
  for (let i = 0; i < N; i++) if (data[i * 4 + 3] > 8) opaqueBefore++;

  // Sample every seed's flood colour BEFORE any flood clears pixels.
  const seedFloods: { start: number; color: RGB }[] = [];
  for (const s of extraSeeds) {
    const sx = Math.min(w - 1, Math.max(0, Math.round(s.x * (w - 1))));
    const sy = Math.min(h - 1, Math.max(0, Math.round(s.y * (h - 1))));
    const idx = sy * w + sx;
    seedFloods.push({ start: idx, color: colorAt(idx) });
  }

  const flood = (starts: number[], color: RGB) => {
    const visited = new Uint8Array(N);
    const stack = [...starts];
    while (stack.length) {
      const i = stack.pop() as number;
      if (i < 0 || i >= N || visited[i]) continue;
      visited[i] = 1;
      if (!near(i, color)) continue;
      data[i * 4 + 3] = 0;
      const x = i % w, y = (i - x) / w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - w);
      if (y < h - 1) stack.push(i + w);
    }
  };

  if (borderSeeds) {
    const border: number[] = [];
    for (let x = 0; x < w; x++) { border.push(x); border.push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { border.push(y * w); border.push(y * w + w - 1); }
    flood(border, key);
  }
  // Interior seed points (point-cascade): each floods its own connected region
  // of its own sampled colour, reaching pockets a border fill never can.
  for (const sf of seedFloods) flood([sf.start], sf.color);

  // Edge feather. The white key keeps the exact legacy near-white test; other
  // keys fade edge pixels that sit just outside the removal budget.
  const isFeatherable = (p: number): boolean => {
    if (key === WHITE_RGB || (key[0] === 255 && key[1] === 255 && key[2] === 255)) {
      const mn = Math.min(data[p], data[p + 1], data[p + 2]);
      const mx = Math.max(data[p], data[p + 1], data[p + 2]);
      return mn > FEATHER_MIN && mx - mn < FEATHER_SAT;
    }
    return (
      Math.abs(data[p] - key[0]) < D + 25 &&
      Math.abs(data[p + 1] - key[1]) < D + 25 &&
      Math.abs(data[p + 2] - key[2]) < D + 25
    );
  };
  for (let pass = 0; pass < featherPasses; pass++) {
    for (let i = 0; i < N; i++) {
      if (data[i * 4 + 3] === 0) continue;
      const x = i % w, y = (i - x) / w, p = i * 4;
      if (!isFeatherable(p)) continue;
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

/** Auto-fallback safety net: true when an UN-tuned cutout looks mangled (the
 *  fill ate the creature, or the image centre went fully transparent) so the
 *  boxed original renders instead. Never applied over an explicit recipe. */
function looksMangled(data: Uint8ClampedArray, w: number, h: number, kept: number): boolean {
  if (kept < MIN_KEPT) return true;
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (data[(y * w + x) * 4 + 3] > 8) return false; // centre still has body
    }
  }
  return true;
}

// --- polite fetching ---------------------------------------------------------
// A whole Digidex level can mount ~90 cells at once; an uncapped burst gets
// throttled by Digi-API and the failures used to stick until remount. Cap the
// concurrent fetches, queue the rest, and retry transient failures with backoff.

const MAX_CONCURRENT_FETCHES = 6;
let activeFetches = 0;
const fetchWaiters: (() => void)[] = [];

async function withFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) {
    await new Promise<void>((resolve) => fetchWaiters.push(resolve));
  }
  activeFetches++;
  try {
    return await fn();
  } finally {
    activeFetches--;
    fetchWaiters.shift()?.();
  }
}

const RETRIES = 3;

/** Fetch with backoff. Retries network errors, 429, and 5xx; other 4xx are final. */
async function fetchSpriteBlob(srcUrl: string): Promise<Blob> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = 600 * 2 ** (attempt - 1) + Math.random() * 400;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const res = await fetch(srcUrl, { mode: 'cors' });
      if (res.ok) return await res.blob();
      lastError = new Error(`sprite fetch ${res.status}`);
      if (res.status !== 429 && res.status < 500) break; // permanent 4xx
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Get the ORIGINAL sprite bytes: device cache first, network once. Cached
 *  separately from processed outputs so re-tuning a recipe (new cache key)
 *  never re-hits Digi-API. */
async function getRawBlob(srcUrl: string, base: string, cache: Cache | null): Promise<Blob> {
  const rawKey = `https://digipelago.sprite-cache/${encodeURIComponent(base)}?raw`;
  if (cache) {
    try {
      const hit = await cache.match(rawKey);
      if (hit) return await hit.blob();
    } catch {
      /* fall through to network */
    }
  }
  const blob = await withFetchSlot(() => fetchSpriteBlob(srcUrl));
  if (cache) {
    try {
      await cache.put(rawKey, new Response(blob, { headers: { 'content-type': 'image/png' } }));
    } catch {
      /* cache write is best-effort */
    }
  }
  return blob;
}

/** Produce the render blob from the original: cutout when possible. */
async function buildBlob(
  raw: Blob,
  allowCutout: boolean,
  recipe?: SpriteRecipe | null,
): Promise<{ blob: Blob; isCutout: boolean }> {
  const mode = recipe?.mode ?? 'cutout';
  if (mode === 'boxed') return { blob: raw, isCutout: false };
  if (mode === 'raw') return { blob: raw, isCutout: true }; // source already transparent
  const explicit = !!recipe && Object.keys(recipe).length > 0;
  // The manifest's known-fallback list is only the DEFAULT; an explicit cutout
  // recipe overrides it (that is the whole point of tuning).
  if ((!allowCutout && !explicit) || typeof createImageBitmap === 'undefined') {
    return { blob: raw, isCutout: false };
  }
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
    const kept = carve(img.data, cv.width, cv.height, recipe);
    if (kept < 0) return { blob: raw, isCutout: false }; // not a white-box sprite
    if (!explicit && looksMangled(img.data, cv.width, cv.height, kept)) {
      return { blob: raw, isCutout: false }; // heuristic safety net (untuned only)
    }
    ctx.putImageData(img, 0, 0);
    const out = await new Promise<Blob | null>((resolve) => cv.toBlob(resolve, 'image/png'));
    return out ? { blob: out, isCutout: true } : { blob: raw, isCutout: false };
  } catch {
    return { blob: raw, isCutout: false };
  }
}

// Per-session memo of resolved object URLs, so repeated mounts reuse one URL.
const resolved = new Map<string, { url: string; isCutout: boolean }>();
// In-flight dedupe: many dex cells can share a sprite; one fetch serves all.
const inflight = new Map<string, Promise<{ url: string; isCutout: boolean }>>();

async function resolveSprite(
  srcUrl: string,
  base: string,
  recipe: SpriteRecipe | null,
  rHash: string,
): Promise<{ url: string; isCutout: boolean }> {
  const allowCutout = !isKnownFallback(srcUrl);
  // The recipe hash is part of the cache key, so a re-tuned sprite recomputes
  // on the device while everything else stays cached.
  const cacheKey = `https://digipelago.sprite-cache/${encodeURIComponent(base)}${rHash ? `?r=${rHash}` : ''}`;

  // Device cache read (errors here must not trigger a second network fetch).
  let cache: Cache | null = null;
  if (typeof caches !== 'undefined') {
    try {
      cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(cacheKey);
      if (hit) {
        const isCutout = hit.headers.get('x-cutout') === '1';
        return { url: URL.createObjectURL(await hit.blob()), isCutout };
      }
    } catch {
      cache = null; // cache unusable: build without it
    }
  }

  const raw = await getRawBlob(srcUrl, base, cache);
  const { blob, isCutout } = await buildBlob(raw, allowCutout, recipe);
  if (cache) {
    try {
      await cache.put(
        cacheKey,
        new Response(blob, { headers: { 'content-type': 'image/png', 'x-cutout': isCutout ? '1' : '0' } }),
      );
    } catch {
      /* cache write is best-effort */
    }
  }
  return { url: URL.createObjectURL(blob), isCutout };
}

/**
 * Resolve a sprite URL (+ optional cutout recipe) to an on-device,
 * ready-to-render object URL (transparent cutout when possible, else boxed).
 * Caller MUST have consent. Hits Digi-API at most once per sprite per device
 * (Cache API persists across reloads); fetches are capped/queued and retried,
 * and concurrent callers share one resolution per (sprite, recipe).
 */
export function loadSprite(
  srcUrl: string,
  recipe?: SpriteRecipe | null,
): Promise<{ url: string; isCutout: boolean }> {
  const base = spriteBasename(srcUrl) ?? srcUrl;
  const rHash = recipeHash(recipe);
  const key = rHash ? `${base}|${rHash}` : base;
  const memo = resolved.get(key);
  if (memo) return Promise.resolve(memo);
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = resolveSprite(srcUrl, base, recipe ?? null, rHash)
    .then((out) => {
      resolved.set(key, out);
      return out;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Tuner live preview: run the engine on the (raw-cached) original with an
 *  arbitrary recipe, WITHOUT memoizing or writing processed cache entries, so
 *  slider scrubbing neither pollutes the device cache nor re-hits Digi-API.
 *  The caller owns the returned object URL (revoke it when replaced). */
export async function previewSprite(
  srcUrl: string,
  recipe: SpriteRecipe | null,
): Promise<{ url: string; isCutout: boolean }> {
  const base = spriteBasename(srcUrl) ?? srcUrl;
  let cache: Cache | null = null;
  if (typeof caches !== 'undefined') {
    try {
      cache = await caches.open(CACHE_NAME);
    } catch {
      cache = null;
    }
  }
  const raw = await getRawBlob(srcUrl, base, cache);
  const { blob, isCutout } = await buildBlob(raw, !isKnownFallback(srcUrl), recipe);
  return { url: URL.createObjectURL(blob), isCutout };
}

/** The untouched original (boxed) for the tuner's seeding surface. */
export async function loadRawSprite(srcUrl: string): Promise<string> {
  const base = spriteBasename(srcUrl) ?? srcUrl;
  let cache: Cache | null = null;
  if (typeof caches !== 'undefined') {
    try {
      cache = await caches.open(CACHE_NAME);
    } catch {
      cache = null;
    }
  }
  return URL.createObjectURL(await getRawBlob(srcUrl, base, cache));
}
