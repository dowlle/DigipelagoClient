// tools/bake-sprites.mjs — build-time sprite cutout baker (dev-only, NOT in `npm run build`).
//
// Ports the border flood-fill + feather from the round-2 design's spritecache.js
// (which ran in the browser on a <canvas> at runtime) and runs it ONCE here, over
// the pinned Digi-API sprite snapshot the dataset already references, to emit
// transparent-cutout PNGs that get bundled with the app. This removes the
// cold-load placeholder flash, the live cross-origin fetch, and the canvas-taint
// risk (Flag A): the runtime only ever reads same-origin bundled PNGs or the
// boxed-sprite fallback — it never fetches a sprite in production.
//
// White removal is a BORDER FLOOD-FILL: only near-white pixels connected to the
// image edge are cleared, so white *inside* a creature (wings, dress) is kept.
// A light feather then softens light, low-saturation pixels that touch the
// cleared background.
//
// Source bytes: the repo does NOT ship a local mirror of the pinned snapshot, so
// this script fetches each sprite ONCE from the `sprite` URL in the dataset
// (the same pinned `https://digi-api.com/images/digimon/w/<Name>.png` contract)
// and caches the raw PNG on disk under tools/sprites-src/ so repeat/CI bakes do
// not refetch. Network happens at bake time only, never at runtime. To make the
// bake fully offline + reproducible, commit tools/sprites-src/ (the cached
// snapshot) — see the README note this script prints.
//
// Outputs:
//   public/cutouts/<Name>.png            transparent cutout (or absent on fallback)
//   src/assets/cutouts/manifest.json     { "<Name>": "ok" | "fallback" } — runtime resolver reads this
//   tools/out/contact-sheet.html         QA sheet: every cutout on a checkerboard (Flag B)
//   tools/out/bake-report.json           per-sprite status + flags + summary
//
// Usage: node tools/bake-sprites.mjs   (or `npm run bake-sprites`)
//   --limit=N   bake only the first N entries (smoke test)
//   --no-fetch  use only on-disk cached sources; skip anything missing (offline)

import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATASET = join(ROOT, 'src', 'data', 'digimon_mvp.json');
const SRC_CACHE = join(__dirname, 'sprites-src');
const OUT_CUTOUTS = join(ROOT, 'public', 'cutouts');
const OUT_MANIFEST_DIR = join(ROOT, 'src', 'assets', 'cutouts');
const OUT_REPORT_DIR = join(__dirname, 'out');

const args = process.argv.slice(2);
const LIMIT = (() => {
  const a = args.find((s) => s.startsWith('--limit='));
  return a ? Number(a.split('=')[1]) : Infinity;
})();
const NO_FETCH = args.includes('--no-fetch');

// --- cutout algorithm (ported verbatim from spritecache.js, lines 20-71) -----

const WHITE = 228; // isWhitish threshold
const FEATHER_MIN = 205; // light pixel floor for feather
const FEATHER_SAT = 22; // max (max-min) saturation spread for feather
const FEATHER_ALPHA = 0.35; // feathered edge alpha multiplier

/**
 * @param {Buffer} data RGBA buffer, length w*h*4
 * @returns {{ opaqueAfter: number, opaqueBefore: number }} pixel counts (for QA)
 */
function carveCutout(data, w, h) {
  const N = w * h;
  const isWhitish = (i) => {
    const p = i * 4;
    return data[p] > WHITE && data[p + 1] > WHITE && data[p + 2] > WHITE;
  };

  let opaqueBefore = 0;
  for (let i = 0; i < N; i++) if (data[i * 4 + 3] > 8) opaqueBefore++;

  // flood-fill from all border pixels through the whitish region
  const visited = new Uint8Array(N);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    if (i < 0 || i >= N || visited[i]) continue;
    visited[i] = 1;
    if (!isWhitish(i)) continue;
    data[i * 4 + 3] = 0; // clear background alpha
    const x = i % w, y = (i - x) / w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }

  // feather: soften light, low-saturation pixels bordering the cleared bg
  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] === 0) continue;
    const x = i % w, y = (i - x) / w;
    const p = i * 4;
    const mn = Math.min(data[p], data[p + 1], data[p + 2]);
    const mx = Math.max(data[p], data[p + 1], data[p + 2]);
    if (mn > FEATHER_MIN && (mx - mn) < FEATHER_SAT) {
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
  return { opaqueBefore, opaqueAfter };
}

// --- source acquisition ------------------------------------------------------

function basenameFromSprite(sprite) {
  // "https://digi-api.com/images/digimon/w/Agumon.png" -> "Agumon"
  const file = sprite.split('/').pop() || '';
  return file.replace(/\.png$/i, '');
}

async function getSourceBytes(base, sprite) {
  const cachePath = join(SRC_CACHE, `${base}.png`);
  if (existsSync(cachePath)) return readFile(cachePath);
  if (NO_FETCH) return null;
  // one-time fetch, then cache on disk so repeat/CI bakes don't refetch
  const res = await fetch(sprite);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(SRC_CACHE, { recursive: true });
  await writeFile(cachePath, buf);
  return buf;
}

// --- main --------------------------------------------------------------------

async function main() {
  const rawText = await readFile(DATASET, 'utf-8');
  const ds = JSON.parse(rawText);
  let entries = Object.values(ds.meta)
    .filter((m) => typeof m.sprite === 'string' && m.sprite)
    .map((m) => ({ name: m.name, sprite: m.sprite, base: basenameFromSprite(m.sprite) }));
  if (Number.isFinite(LIMIT)) entries = entries.slice(0, LIMIT);

  await mkdir(OUT_CUTOUTS, { recursive: true });
  await mkdir(OUT_MANIFEST_DIR, { recursive: true });
  await mkdir(OUT_REPORT_DIR, { recursive: true });

  const manifest = {};
  const report = [];
  let baked = 0, fallback = 0, missing = 0;

  for (let idx = 0; idx < entries.length; idx++) {
    const { name, sprite, base } = entries[idx];
    let status = 'ok';
    let flag = null;
    try {
      const bytes = await getSourceBytes(base, sprite);
      if (!bytes) { status = 'fallback'; flag = 'source-unavailable'; missing++; }
      else {
        const png = PNG.sync.read(bytes);
        const { width: w, height: h, data } = png;

        // Reject sources that don't look like white-box sprites: sample the
        // four corners — if any corner is already transparent or non-white,
        // the flood-fill premise breaks → fall back to the boxed sprite.
        const corner = (x, y) => {
          const p = (y * w + x) * 4;
          return { r: data[p], g: data[p + 1], b: data[p + 2], a: data[p + 3] };
        };
        const corners = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
        const whiteCorners = corners.filter((c) => c.a > 250 && c.r > WHITE && c.g > WHITE && c.b > WHITE).length;
        if (whiteCorners < 3) {
          status = 'fallback';
          flag = 'non-white-bg';
        } else {
          const { opaqueBefore, opaqueAfter } = carveCutout(data, w, h);
          const keptRatio = opaqueBefore ? opaqueAfter / opaqueBefore : 0;
          // Very light creatures: the flood-fill ate most of the creature.
          if (keptRatio < 0.12) {
            status = 'fallback';
            flag = 'too-light';
          } else {
            const outBuf = PNG.sync.write(png);
            await writeFile(join(OUT_CUTOUTS, `${base}.png`), outBuf);
            report.push({ name, base, status, keptRatio: Number(keptRatio.toFixed(3)), w, h });
          }
        }
      }
    } catch (e) {
      status = 'fallback';
      flag = `decode-error:${e.message}`;
    }
    manifest[base] = status;
    if (status === 'ok') baked++;
    else {
      fallback++;
      report.push({ name, base, status, flag });
    }
    if ((idx + 1) % 100 === 0) process.stdout.write(`  …${idx + 1}/${entries.length}\n`);
  }

  await writeFile(join(OUT_MANIFEST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 0) + '\n');

  const summary = { total: entries.length, baked, fallback, missing, generatedAt: new Date().toISOString() };
  await writeFile(join(OUT_REPORT_DIR, 'bake-report.json'), JSON.stringify({ summary, entries: report }, null, 2) + '\n');

  // QA contact sheet (Flag B): every cutout on a checkerboard background.
  const okNames = Object.keys(manifest).filter((k) => manifest[k] === 'ok');
  const checker =
    'background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0';
  const tiles = okNames
    .map(
      (n) =>
        `<figure style="margin:0;width:96px;text-align:center"><div style="width:96px;height:96px;${checker}"><img src="../../public/cutouts/${encodeURIComponent(n)}.png" style="width:100%;height:100%;object-fit:contain" loading="lazy"></div><figcaption style="font:10px sans-serif;color:#333;word-break:break-all">${n}</figcaption></figure>`,
    )
    .join('');
  const flaggedRows = report
    .filter((r) => r.status === 'fallback')
    .map((r) => `<li>${r.name} — ${r.flag}</li>`)
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Digipelago cutout QA</title>
<body style="font:13px sans-serif;background:#fff;color:#111;padding:16px">
<h1>Cutout contact sheet</h1>
<p>${baked} baked · ${fallback} fallback (${missing} source-unavailable) · ${entries.length} total. Eyeball the cutouts below before committing.</p>
<details><summary>${fallback} flagged (rendered boxed at runtime)</summary><ul>${flaggedRows}</ul></details>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">${tiles}</div>
</body>`;
  await writeFile(join(OUT_REPORT_DIR, 'contact-sheet.html'), html);

  console.log(`\nBake complete: ${baked} baked, ${fallback} fallback (${missing} source-unavailable), ${entries.length} total.`);
  console.log(`  cutouts:   public/cutouts/*.png`);
  console.log(`  manifest:  src/assets/cutouts/manifest.json`);
  console.log(`  QA sheet:  tools/out/contact-sheet.html`);
  console.log(`  report:    tools/out/bake-report.json`);
  if (!NO_FETCH) {
    const cached = existsSync(SRC_CACHE) ? (await readdir(SRC_CACHE)).length : 0;
    console.log(`\nNote: ${cached} source PNGs cached in tools/sprites-src/. Commit that dir to make the bake fully offline + reproducible (the pinned snapshot).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
