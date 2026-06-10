// Sprite Studio: the Digidex modal of the Sprite Cutout Manager.
//
// Everyone gets: a live preview (silhouette + colour cutout) of the current
// recipe, the "Improve cutout" tuner (click the original to drop flood-fill
// seed points, tolerance/feather sliders, border-seeds + mode toggles), a
// local draft (you see your fix immediately on this device), Copy recipe,
// Submit fix (anonymous proposal), and Report sprite issue.
// The owner additionally sees pending community submissions with live replay
// previews and Approve/Reject, plus direct Publish of the current recipe.
//
// IP rule: everything here manipulates RECIPES (numbers + normalized coords).
// No pixels or masks ever leave the device; previews run the same on-device
// engine that renders the game.
//
// Spoiler note: an uncaught Digimon's NAME stays hidden ('???'). The original
// sprite is shown inside the tuner only (you opened it to fix its shape).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Flag, Send, Trash2, X } from 'lucide-react';
import type { Digimon } from '../game/types';
import { useAuth } from '../api/useAuth';
import { recordEvent } from '../api/backend';
import {
  approveSubmission,
  fetchSubmissions,
  getDraft,
  getEffectiveRecipe,
  publishRecipe,
  rejectSubmission,
  setDraft,
  submitRecipe,
  type RecipeSubmission,
} from '../api/spriteRecipes';
import { loadRawSprite, previewSprite, recipeHash, type SpriteRecipe } from './spriteEngine';
import { useSpriteConsent } from './spriteConsent';

const TOL_MIN = 150;
const TOL_MAX = 254;
const TOL_DEFAULT = 228;
const MAX_SEEDS = 16;

/** A recipe with no overrides is "the default" (cleared draft). */
function isDefaultRecipe(r: SpriteRecipe): boolean {
  return Object.keys(r).length === 0;
}

/** Drop default-valued keys so stored/submitted recipes stay minimal. */
function normalize(r: SpriteRecipe): SpriteRecipe {
  const out: SpriteRecipe = {};
  if (r.mode && r.mode !== 'cutout') out.mode = r.mode;
  if (r.tolerance !== undefined && r.tolerance !== TOL_DEFAULT) out.tolerance = r.tolerance;
  if (r.borderSeeds === false) out.borderSeeds = false;
  if (r.feather !== undefined && r.feather !== 1) out.feather = r.feather;
  if (r.seeds && r.seeds.length > 0) out.seeds = r.seeds;
  if (r.keyColor) out.keyColor = r.keyColor.toLowerCase();
  return out;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
      <span className="shrink-0 w-28">{label}</span>
      {children}
    </label>
  );
}

/** Live engine preview pair: tinted silhouette + colour cutout. */
function PreviewPair({ src, recipe }: { src: string; recipe: SpriteRecipe }) {
  const [res, setRes] = useState<{ url: string; isCutout: boolean } | null>(null);
  const hash = recipeHash(recipe);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    previewSprite(src, recipe)
      .then((r) => {
        if (!alive) {
          URL.revokeObjectURL(r.url);
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = r.url;
        setRes(r);
      })
      .catch(() => alive && setRes(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, hash]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const box = 'grid h-28 w-28 place-items-center rounded-lg';
  if (!res) {
    return (
      <div className="flex gap-3">
        <div className={box} style={{ background: 'var(--dp-card-2)' }}>
          <span className="text-xs animate-pulse" style={{ color: 'var(--dp-text-muted)' }}>...</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className={box} style={{ background: 'var(--dp-card-2)' }} title="Silhouette (as the game shows it)">
        {res.isCutout ? (
          <div
            className="h-24 w-24"
            style={{
              WebkitMaskImage: `url("${res.url}")`,
              maskImage: `url("${res.url}")`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
              background: 'var(--dp-primary)',
            }}
          />
        ) : (
          <img src={res.url} alt="" className="h-24 w-24 object-contain" style={{ filter: 'brightness(0)' }} />
        )}
      </div>
      <div className={box} style={{ background: '#eef1f5' }} title="Cutout result">
        <img src={res.url} alt="" className="h-24 w-24 object-contain" />
      </div>
    </div>
  );
}

/** The original sprite as a seeding surface: click to add a flood-fill origin
 *  (or, in pick mode, sample the background colour), click a dot to remove it.
 *  Coordinates are normalized 0..1 over the IMAGE (not the letterboxed box),
 *  matching how the engine maps seeds onto pixels - important for non-square
 *  sources like anime screenshots. */
function SeedSurface({
  src,
  seeds,
  onChange,
  pickMode,
  onPickColor,
}: {
  src: string;
  seeds: { x: number; y: number }[];
  onChange: (seeds: { x: number; y: number }[]) => void;
  pickMode: boolean;
  onPickColor: (hex: string) => void;
}) {
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ nw: number; nh: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    loadRawSprite(src)
      .then((u) => {
        url = u;
        if (alive) setRawUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setRawUrl(null));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      sampleCanvasRef.current = null;
    };
  }, [src]);

  // object-contain box of the image inside the square container, as fractions.
  const box = (() => {
    if (!dims || dims.nw <= 0 || dims.nh <= 0) return { ox: 0, oy: 0, dw: 1, dh: 1 };
    const dw = dims.nw >= dims.nh ? 1 : dims.nw / dims.nh;
    const dh = dims.nh >= dims.nw ? 1 : dims.nh / dims.nw;
    return { ox: (1 - dw) / 2, oy: (1 - dh) / 2, dw, dh };
  })();

  /** Click position -> normalized image coords, or null when outside the image. */
  const toImageCoords = (e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    const x = (cx - box.ox) / box.dw;
    const y = (cy - box.oy) / box.dh;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4 };
  };

  /** Sample the pixel colour at normalized image coords from the original. */
  const sampleAt = (x: number, y: number): string | null => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    let cv = sampleCanvasRef.current;
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      sampleCanvasRef.current = cv;
    }
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const px = Math.min(cv.width - 1, Math.max(0, Math.round(x * (cv.width - 1))));
    const py = Math.min(cv.height - 1, Math.max(0, Math.round(y * (cv.height - 1))));
    const d = ctx.getImageData(px, py, 1, 1).data;
    const hex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${hex(d[0])}${hex(d[1])}${hex(d[2])}`;
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const pos = toImageCoords(e);
    if (!pos) return;
    if (pickMode) {
      const c = sampleAt(pos.x, pos.y);
      if (c) onPickColor(c);
      return;
    }
    if (seeds.length >= MAX_SEEDS) return;
    onChange([...seeds, pos]);
  };

  if (!rawUrl) {
    return (
      <div className="grid h-44 w-44 place-items-center rounded-lg" style={{ background: 'var(--dp-card-2)' }}>
        <span className="text-xs animate-pulse" style={{ color: 'var(--dp-text-muted)' }}>loading original...</span>
      </div>
    );
  }
  return (
    <div
      className="relative h-44 w-44 cursor-crosshair select-none rounded-lg"
      style={{ background: '#fff', border: pickMode ? '2px solid var(--dp-primary)' : '1px solid var(--dp-line)' }}
      onClick={onClick}
      title={
        pickMode
          ? 'Click the background colour to key out'
          : 'Click a trapped background area to add a flood-fill seed'
      }
    >
      <img
        ref={imgRef}
        src={rawUrl}
        alt="Original sprite"
        className="h-full w-full object-contain"
        draggable={false}
        crossOrigin="anonymous"
        onLoad={(e) => setDims({ nw: e.currentTarget.naturalWidth, nh: e.currentTarget.naturalHeight })}
      />
      {seeds.map((s, i) => (
        <button
          key={`${s.x}-${s.y}-${i}`}
          type="button"
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${(box.ox + s.x * box.dw) * 100}%`,
            top: `${(box.oy + s.y * box.dh) * 100}%`,
            background: 'var(--dp-warn)',
            border: '1.5px solid #000',
            boxShadow: '0 0 4px rgba(0,0,0,.6)',
          }}
          title="Remove this seed"
          onClick={(e) => {
            e.stopPropagation();
            onChange(seeds.filter((_, j) => j !== i));
          }}
        />
      ))}
    </div>
  );
}

/** One pending community submission, replayable + approvable (owner only). */
function SubmissionRow({
  sub,
  src,
  onResolved,
}: {
  sub: RecipeSubmission;
  src: string;
  onResolved: (id: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: (id: number) => Promise<boolean>) => {
    setBusy(true);
    try {
      if (await fn(sub.id)) onResolved(sub.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-lg p-2" style={{ background: 'var(--dp-card-2)' }}>
      <PreviewPair src={src} recipe={sub.recipe ?? {}} />
      <div className="min-w-0 flex-1 text-xs" style={{ color: 'var(--dp-text-secondary)' }}>
        <div>{sub.ts ? sub.ts.slice(0, 16).replace('T', ' ') : 'undated'}</div>
        {sub.note && <div className="mt-1 break-words" style={{ color: 'var(--dp-text)' }}>{sub.note}</div>}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        <button className="dp-btn dp-btn-primary text-xs" disabled={busy} onClick={() => void act(approveSubmission)}>
          <Check size={12} aria-hidden /> Approve
        </button>
        <button className="dp-toggle-btn text-xs" disabled={busy} onClick={() => void act(rejectSubmission)}>
          <Trash2 size={12} aria-hidden /> Reject
        </button>
      </div>
    </div>
  );
}

export function SpriteStudio({ d, caught, onClose }: { d: Digimon; caught: boolean; onClose: () => void }) {
  const consent = useSpriteConsent();
  const { me } = useAuth();
  const isOwner = !!me?.is_owner;

  // The working recipe: start from the local draft, else the effective
  // (served) recipe, else defaults. Every edit auto-saves the draft, so the
  // whole app re-renders this sprite with your fix immediately.
  const [recipe, setRecipe] = useState<SpriteRecipe>(
    () => getDraft(d.id) ?? getEffectiveRecipe(d.id) ?? {},
  );
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(false);
  const [subs, setSubs] = useState<RecipeSubmission[] | null>(null);
  // Eyedropper: the next click on the original samples the key colour.
  const [pickMode, setPickMode] = useState(false);

  const update = useCallback(
    (patch: Partial<SpriteRecipe>) => {
      setRecipe((cur) => {
        const next = normalize({ ...cur, ...patch });
        setDraft(d.id, isDefaultRecipe(next) ? null : next);
        return next;
      });
      setStatus(null);
    },
    [d.id],
  );

  const resetDraft = useCallback(() => {
    setDraft(d.id, null);
    setRecipe(getEffectiveRecipe(d.id) ?? {});
    setStatus('Draft cleared; using the served recipe.');
  }, [d.id]);

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    fetchSubmissions(d.id).then((s) => alive && setSubs(s));
    return () => {
      alive = false;
    };
  }, [isOwner, d.id]);

  const mode = recipe.mode ?? 'cutout';
  const shownName = caught ? d.name : '???';
  const seeds = useMemo(() => recipe.seeds ?? [], [recipe.seeds]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(recipe));
      setStatus('Recipe copied to clipboard.');
    } catch {
      setStatus('Could not access the clipboard.');
    }
  };

  const onSubmit = async () => {
    setBusy(true);
    try {
      const ok = await submitRecipe(d.id, recipe, note.trim() || undefined);
      setStatus(ok ? 'Fix submitted for review. Thanks!' : 'Submit failed (rate limit?). Try later.');
    } finally {
      setBusy(false);
    }
  };

  const onPublish = async () => {
    setBusy(true);
    try {
      const ok = await publishRecipe(d.id, recipe);
      if (ok) setDraft(d.id, null);
      setStatus(ok ? 'Published live for everyone.' : 'Publish failed.');
    } finally {
      setBusy(false);
    }
  };

  const onReport = () => {
    recordEvent({ event_type: 'sprite_error', payload: { target_id: d.id } });
    setReported(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sprite studio"
    >
      <div
        className="dp-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
              {shownName}
            </h3>
            <p className="text-xs" style={{ color: 'var(--dp-text-faint)' }}>
              {d.level} · {d.attribute} · sprite cutout studio
            </p>
          </div>
          <button type="button" className="dp-toggle-btn" onClick={onClose} aria-label="Close">
            <X size={14} aria-hidden />
          </button>
        </div>

        {consent !== 'granted' ? (
          <p className="text-sm" style={{ color: 'var(--dp-text-secondary)' }}>
            Tuning needs the Digimon images permission (Settings, or the prompt in Silhouette
            mode). Digipelago hosts no art; your browser fetches it from digi-api.com.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-start gap-4">
              <SeedSurface
                src={d.sprite ?? ''}
                seeds={seeds}
                onChange={(s) => update({ seeds: s })}
                pickMode={pickMode}
                onPickColor={(hex) => {
                  setPickMode(false);
                  update({ keyColor: hex === '#ffffff' ? undefined : hex });
                }}
              />
              <PreviewPair src={d.sprite ?? ''} recipe={recipe} />
            </div>
            <p className="mb-3 text-xs" style={{ color: 'var(--dp-text-faint)' }}>
              Click the original (left) to drop a flood-fill seed into a trapped background
              pocket; click a dot to remove it. Each seed removes the colour UNDER it, so
              dark floors and skies come out one click each. The previews run the exact
              engine the game uses. Edits save as a local draft and apply on this device
              immediately.
            </p>

            <div className="flex flex-col gap-2.5">
              <Row label="Mode">
                <div className="flex flex-1 gap-2">
                  {(['cutout', 'boxed', 'raw'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="dp-toggle-btn text-xs"
                      data-active={mode === m}
                      onClick={() => update({ mode: m === 'cutout' ? undefined : m })}
                      title={
                        m === 'cutout'
                          ? 'White-keyout flood fill (default)'
                          : m === 'boxed'
                            ? 'Hopeless background: show the framed original'
                            : 'Source already has transparency: use it as-is'
                      }
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Row>
              {mode === 'cutout' && (
                <>
                  <Row label="Key colour">
                    <span
                      className="h-5 w-5 shrink-0 rounded"
                      style={{
                        background: recipe.keyColor ?? '#ffffff',
                        border: '1px solid var(--dp-line)',
                      }}
                      title={recipe.keyColor ?? 'auto (white / detected corners)'}
                    />
                    <button
                      type="button"
                      className="dp-toggle-btn text-xs"
                      data-active={pickMode}
                      onClick={() => setPickMode((v) => !v)}
                    >
                      {pickMode ? 'Click the image...' : 'Pick from image'}
                    </button>
                    {recipe.keyColor && (
                      <button type="button" className="dp-toggle-btn text-xs" onClick={() => update({ keyColor: undefined })}>
                        Auto
                      </button>
                    )}
                    <span className="flex-1 text-xs" style={{ color: 'var(--dp-text-faint)' }}>
                      the background colour the border flood removes
                    </span>
                  </Row>
                  <Row label={`Tolerance ${recipe.tolerance ?? TOL_DEFAULT}`}>
                    <input
                      type="range"
                      min={TOL_MIN}
                      max={TOL_MAX}
                      value={recipe.tolerance ?? TOL_DEFAULT}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        update({ tolerance: v === TOL_DEFAULT ? undefined : v });
                      }}
                      className="flex-1"
                      aria-label="White tolerance"
                    />
                  </Row>
                  <Row label={`Feather ${recipe.feather ?? 1}`}>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      value={recipe.feather ?? 1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        update({ feather: v === 1 ? undefined : v });
                      }}
                      className="flex-1"
                      aria-label="Edge feather passes"
                    />
                  </Row>
                  <Row label="Border seeds">
                    <input
                      type="checkbox"
                      checked={recipe.borderSeeds !== false}
                      onChange={(e) => update({ borderSeeds: e.target.checked ? undefined : false })}
                      aria-label="Flood from the image border"
                    />
                    <span className="flex-1 text-xs" style={{ color: 'var(--dp-text-faint)' }}>
                      off = only your seed points flood (for fills that leak into the body)
                    </span>
                  </Row>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" className="dp-toggle-btn text-xs" onClick={resetDraft}>
                Reset
              </button>
              <button type="button" className="dp-toggle-btn text-xs" onClick={() => void onCopy()}>
                <Copy size={12} aria-hidden /> Copy recipe
              </button>
              <button
                type="button"
                className="dp-btn dp-btn-primary text-xs"
                disabled={busy}
                onClick={() => void onSubmit()}
              >
                <Send size={12} aria-hidden /> Submit fix
              </button>
              {isOwner && (
                <button type="button" className="dp-btn dp-btn-primary text-xs" disabled={busy} onClick={() => void onPublish()}>
                  Publish now
                </button>
              )}
              <button
                type="button"
                className="dp-toggle-btn text-xs"
                disabled={reported}
                onClick={onReport}
                title="Anonymously flag this sprite as rendering badly"
              >
                <Flag size={12} aria-hidden /> {reported ? 'Reported' : 'Report sprite issue'}
              </button>
            </div>
            <input
              className="dp-input mt-2 w-full text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the reviewer (what was wrong?)"
              maxLength={500}
              aria-label="Submission note"
            />
            {status && (
              <p className="mt-2 text-xs" style={{ color: 'var(--dp-text-faint)' }}>
                {status}
              </p>
            )}

            {isOwner && subs && subs.length > 0 && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--dp-line)' }}>
                <span className="mb-2 block text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
                  Community submissions ({subs.length})
                </span>
                <div className="flex flex-col gap-2">
                  {subs.map((s) => (
                    <SubmissionRow
                      key={s.id}
                      sub={s}
                      src={d.sprite ?? ''}
                      onResolved={(id) => setSubs((cur) => (cur ? cur.filter((x) => x.id !== id) : cur))}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SpriteStudio;
