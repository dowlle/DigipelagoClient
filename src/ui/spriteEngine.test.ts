import { describe, expect, it } from 'vitest';
import { carve, recipeHash, type SpriteRecipe } from './spriteEngine';

// Build a w x h RGBA buffer filled with a color.
function image(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

function setPx(data: Uint8ClampedArray, w: number, x: number, y: number, rgb: [number, number, number]) {
  const p = (y * w + x) * 4;
  data[p] = rgb[0];
  data[p + 1] = rgb[1];
  data[p + 2] = rgb[2];
}

function alphaAt(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  return data[(y * w + x) * 4 + 3];
}

const WHITE: [number, number, number] = [255, 255, 255];
const BODY: [number, number, number] = [200, 40, 40];

/** 12x12 white image with a solid body ring from (3,3) to (8,8) enclosing a
 *  white pocket at (5..6, 5..6) the border flood can never reach. */
function pocketImage(): { data: Uint8ClampedArray; w: number; h: number } {
  const w = 12, h = 12;
  const data = image(w, h, WHITE);
  for (let y = 3; y <= 8; y++) {
    for (let x = 3; x <= 8; x++) setPx(data, w, x, y, BODY);
  }
  for (let y = 5; y <= 6; y++) {
    for (let x = 5; x <= 6; x++) setPx(data, w, x, y, WHITE);
  }
  return { data, w, h };
}

describe('carve (recipe-driven flood fill)', () => {
  it('default: clears border-connected white, keeps the body and the pocket', () => {
    const { data, w, h } = pocketImage();
    const kept = carve(data, w, h);
    expect(kept).toBeGreaterThan(0);
    expect(alphaAt(data, w, 0, 0)).toBe(0); // background gone
    expect(alphaAt(data, w, 4, 4)).toBe(255); // body kept
    expect(alphaAt(data, w, 5, 5)).toBe(255); // enclosed pocket SURVIVES (the bug class)
  });

  it('an interior seed floods the enclosed pocket (point-cascade)', () => {
    const { data, w, h } = pocketImage();
    const recipe: SpriteRecipe = { seeds: [{ x: 5 / 11, y: 5 / 11 }] };
    carve(data, w, h, recipe);
    expect(alphaAt(data, w, 5, 5)).toBe(0); // pocket cleared
    expect(alphaAt(data, w, 4, 4)).toBe(255); // body still kept
    expect(alphaAt(data, w, 0, 0)).toBe(0); // border flood still on by default
  });

  it('borderSeeds: false floods only from explicit seeds', () => {
    const { data, w, h } = pocketImage();
    carve(data, w, h, { borderSeeds: false, seeds: [{ x: 5 / 11, y: 5 / 11 }] });
    expect(alphaAt(data, w, 0, 0)).toBe(255); // background untouched (no border seeds)
    expect(alphaAt(data, w, 5, 5)).toBe(0); // pocket cleared via the seed
  });

  it('non-white-box image without a recipe returns -1 (boxed fallback)', () => {
    const w = 8, h = 8;
    const data = image(w, h, [10, 10, 60]); // dark background, no white corners
    expect(carve(data, w, h)).toBe(-1);
  });

  it('an explicit recipe skips the corner heuristic', () => {
    const w = 8, h = 8;
    const data = image(w, h, [10, 10, 60]);
    // Explicit (empty-ish via tolerance) recipe: applies verbatim, removes nothing.
    const kept = carve(data, w, h, { tolerance: 250 });
    expect(kept).toBe(1); // ran (not -1), nothing was whitish enough to remove
  });

  it('tolerance controls what counts as background', () => {
    const w = 8, h = 8;
    const data = image(w, h, [220, 220, 220]); // light grey, above default? no: 220 < 228
    expect(carve(data, w, h, { tolerance: 210 })).toBeLessThan(1); // grey removed
    const data2 = image(w, h, [220, 220, 220]);
    expect(carve(data2, w, h, { tolerance: 240 })).toBe(1); // grey kept
  });
});

describe('recipeHash', () => {
  it('is empty for no/empty recipe and stable per content', () => {
    expect(recipeHash()).toBe('');
    expect(recipeHash(null)).toBe('');
    expect(recipeHash({})).toBe('');
    const a = recipeHash({ tolerance: 200, seeds: [{ x: 0.5, y: 0.5 }] });
    const b = recipeHash({ tolerance: 200, seeds: [{ x: 0.5, y: 0.5 }] });
    expect(a).toBe(b);
    expect(recipeHash({ tolerance: 201 })).not.toBe(recipeHash({ tolerance: 200 }));
  });
});
