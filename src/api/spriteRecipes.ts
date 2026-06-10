// Sprite-recipe source for the runtime engine (Sprite Cutout Manager).
//
// Two layers, merged per target id:
//   - SERVED: GET /api/sprite-recipes?dataset_version=... (approved, DB-backed;
//     fetched once per session, mirrors difficulty.ts). Offline/empty -> {}.
//   - DRAFT: the tuning user's local edits in localStorage, keyed by dataset
//     version. A draft overlays the served recipe for THIS device only, so you
//     see your fix immediately; "Submit fix" proposes it to everyone.
//
// Exposed as a tiny external store (subscribe/getSnapshot) so every <Sprite>
// re-renders when the served blob arrives or a draft changes.

import { DATASET_VERSION } from '../data/dataset';
import type { SpriteRecipe } from '../ui/spriteEngine';

const DRAFTS_KEY = `digipelago:spriteDrafts:${DATASET_VERSION}`;

let served: Record<string, SpriteRecipe> = {};
let servedLoaded = false;
let fetching = false;
// Monotonic version stamp: bumped on every change so hooks can re-snapshot.
let version = 0;

const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const l of listeners) l();
}

export function subscribeRecipes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recipesVersion(): number {
  return version;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Fire the one-per-session served-blob fetch (no-op when done/in-flight). */
export function ensureRecipesLoaded(): void {
  if (servedLoaded || fetching) return;
  fetching = true;
  fetch(`/api/sprite-recipes?dataset_version=${encodeURIComponent(DATASET_VERSION)}`, {
    credentials: 'same-origin',
  })
    .then(async (res) => {
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (isObject(body) && isObject(body.recipes)) {
        const clean: Record<string, SpriteRecipe> = {};
        for (const [id, r] of Object.entries(body.recipes)) {
          if (isObject(r)) clean[id] = r as SpriteRecipe;
        }
        served = clean;
      }
    })
    .catch(() => undefined) // offline: engine defaults apply
    .finally(() => {
      servedLoaded = true;
      fetching = false;
      emit();
    });
}

// --- local drafts -------------------------------------------------------------

function loadDrafts(): Record<string, SpriteRecipe> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? (parsed as Record<string, SpriteRecipe>) : {};
  } catch {
    return {};
  }
}

export function getDraft(targetId: number): SpriteRecipe | null {
  return loadDrafts()[String(targetId)] ?? null;
}

/** Save (or with null: clear) the local draft for a target. */
export function setDraft(targetId: number, recipe: SpriteRecipe | null): void {
  try {
    const drafts = loadDrafts();
    if (recipe === null) delete drafts[String(targetId)];
    else drafts[String(targetId)] = recipe;
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* prefs are best-effort */
  }
  emit();
}

/** The recipe the engine should use for a target right now: the local draft
 *  when one exists, else the served (approved) recipe, else null (defaults). */
export function getEffectiveRecipe(targetId: number | undefined): SpriteRecipe | null {
  if (targetId === undefined) return null;
  return getDraft(targetId) ?? served[String(targetId)] ?? null;
}

export function getServedRecipe(targetId: number): SpriteRecipe | null {
  return served[String(targetId)] ?? null;
}

// --- submission ----------------------------------------------------------------

/** Propose the recipe to everyone (anonymous, rate-limited). True on success. */
export async function submitRecipe(
  targetId: number,
  recipe: SpriteRecipe,
  note?: string,
): Promise<boolean> {
  try {
    const res = await fetch('/api/sprite-recipes/submit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataset_version: DATASET_VERSION,
        target_id: targetId,
        recipe,
        note: note || undefined,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- owner review ----------------------------------------------------------------

export interface RecipeSubmission {
  id: number;
  ts: string | null;
  who: string | null;
  target_id: number;
  recipe: SpriteRecipe;
  note: string | null;
}

export async function fetchSubmissions(targetId?: number): Promise<RecipeSubmission[]> {
  try {
    const qs = new URLSearchParams({ dataset_version: DATASET_VERSION });
    if (targetId !== undefined) qs.set('target_id', String(targetId));
    const res = await fetch(`/api/sprite-recipes/submissions?${qs}`, { credentials: 'same-origin' });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (!isObject(body) || !Array.isArray(body.submissions)) return [];
    return body.submissions as RecipeSubmission[];
  } catch {
    return [];
  }
}

async function ownerPost(path: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function approveSubmission(id: number): Promise<boolean> {
  const ok = await ownerPost('/api/sprite-recipes/approve', { id });
  if (ok) {
    // Refresh the served blob so the approval is visible immediately.
    servedLoaded = false;
    ensureRecipesLoaded();
  }
  return ok;
}

export async function rejectSubmission(id: number): Promise<boolean> {
  return ownerPost('/api/sprite-recipes/reject', { id });
}

/** Owner direct upsert from the tuner (seeding the initial hand-tuned set). */
export async function publishRecipe(targetId: number, recipe: SpriteRecipe): Promise<boolean> {
  try {
    const res = await fetch('/api/sprite-recipes', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataset_version: DATASET_VERSION, target_id: targetId, recipe }),
    });
    if (res.ok) {
      servedLoaded = false;
      ensureRecipesLoaded();
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** Test-only reset. */
export function __resetRecipes(): void {
  served = {};
  servedLoaded = false;
  fetching = false;
  version = 0;
}
