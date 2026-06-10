// Tiny same-origin fetch client for the Digipelago Flask backend.
//
// Design rules (these are load-bearing, do not relax them):
//   - Everything is OPTIONAL sugar on top of the localStorage baseline. When the
//     user is logged out, none of this runs and the client behaves exactly as it
//     did before the backend existed.
//   - Auth + theme + connection calls return real data / throw on failure, so
//     callers can react (show an error, fall back to local state).
//   - Telemetry is fire-and-forget: it batches, flushes best-effort, NEVER throws
//     and NEVER blocks gameplay. A failed flush silently drops the batch.
//
// All requests are same-origin (the Flask app serves dist/), so we rely on the
// session cookie and never send an Authorization header.

import { DATASET_VERSION } from '../data/dataset';

// --- shared fetch plumbing ---------------------------------------------------

/** Same-origin JSON fetch. Sends/receives the session cookie. */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
}

/** Fetch + parse JSON, throwing on a non-2xx status. */
async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
  }
  // 204 No Content has an empty body.
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

// --- auth --------------------------------------------------------------------

export interface Me {
  discord_id: string;
  username: string | null;
  avatar: string | null;
  /** True for the configured owner account (gates the sprite-recipe review UI). */
  is_owner?: boolean;
}

/** GET /api/me. Returns the profile, or null when logged out. Never throws on
 *  a clean "logged out" response; only throws on a transport/server error. */
export async function getMe(): Promise<Me | null> {
  const res = await apiFetch('/api/me');
  if (!res.ok) throw new Error(`GET /api/me failed: ${res.status}`);
  const body = (await res.json()) as Me | null;
  return body ?? null;
}

/** Begin the Discord OAuth flow by navigating the browser to the login route.
 *  The backend redirects to Discord and back to '/' once the session is set. */
export function login(): void {
  window.location.assign('/api/auth/login');
}

/** POST /api/auth/logout. Clears the server session cookie. */
export async function logout(): Promise<void> {
  await apiJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

// --- themes ------------------------------------------------------------------

/** GET /api/me/themes. The caller's unlocked theme ids (login required). */
export async function getThemes(): Promise<string[]> {
  return apiJson<string[]>('/api/me/themes');
}

/** PUT /api/me/themes. UNION-merges the posted ids server-side and returns the
 *  merged set. Monotonic: the server never removes an unlock. */
export async function putThemes(unlocked: string[]): Promise<string[]> {
  return apiJson<string[]>('/api/me/themes', {
    method: 'PUT',
    body: JSON.stringify({ unlocked }),
  });
}

// --- saved connections -------------------------------------------------------

export interface SavedConnection {
  id: number;
  label: string | null;
  server: string;
  port: number;
  slot_name: string;
  has_password: boolean;
}

export interface NewConnection {
  label?: string | null;
  server: string;
  port: number;
  slot_name: string;
  /** Only send when the user opted in to server-side password storage. */
  password?: string;
}

/** GET /api/me/connections. The caller's saved connections (no secrets). */
export async function getConnections(): Promise<SavedConnection[]> {
  return apiJson<SavedConnection[]>('/api/me/connections');
}

/** POST /api/me/connections. Creates a saved connection; the password is only
 *  included (and only stored, encrypted) when the caller opted in. */
export async function createConnection(conn: NewConnection): Promise<SavedConnection> {
  return apiJson<SavedConnection>('/api/me/connections', {
    method: 'POST',
    body: JSON.stringify(conn),
  });
}

/** GET /api/me/connections/:id/secret. The decrypted slot password, or null. */
export async function getConnectionSecret(id: number): Promise<string | null> {
  const body = await apiJson<{ password: string | null }>(`/api/me/connections/${id}/secret`);
  return body.password ?? null;
}

/** DELETE /api/me/connections/:id. */
export async function deleteConnection(id: number): Promise<void> {
  await apiJson<void>(`/api/me/connections/${id}`, { method: 'DELETE' });
}

// --- telemetry (fire-and-forget) ---------------------------------------------
//
// Two buffers (rounds + events) accumulate records and flush in batches. Flushes
// are best-effort: they swallow every error, never throw, and silently drop the
// batch on failure so gameplay is never blocked or interrupted. A short debounce
// coalesces bursts; a flush also fires on pagehide so the last batch is not lost.

/** A played round. Matches POST /api/telemetry/rounds record shape. */
export interface RoundRecord {
  dataset_version?: string;
  who?: string;
  target_id: number;
  options?: number[];
  picked_id?: number;
  correct?: boolean;
  ms?: number;
  mode?: string;
  difficulty?: string;
  wrong_ids?: number[];
}

/** An allow-listed client event. Matches POST /api/telemetry/events record. */
export interface EventRecord {
  dataset_version?: string;
  who?: string;
  event_type: string;
  payload?: Record<string, unknown>;
}

// Cap per request so a single flush can never be huge (backend MAX_BATCH = 200).
const MAX_BATCH = 200;
// Debounce window: coalesce a burst of telemetry into one flush.
const FLUSH_DEBOUNCE_MS = 4000;

let roundBuf: RoundRecord[] = [];
let eventBuf: EventRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Anonymous, per-page-load session tag. NOT an identity and never PII: it lets
// the backend dedupe and cap one session's weight on the aggregates. Rotates
// every page load by design (see the perceived-difficulty privacy rules).
const WHO: string = (() => {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID().slice(0, 18);
  } catch {
    /* fall through to the non-crypto tag */
  }
  return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
})();

/** Stamp the shared dataset_version + anonymous session tag when omitted. */
function stamp<T extends { dataset_version?: string; who?: string }>(rec: T): T {
  return {
    ...rec,
    dataset_version: rec.dataset_version ?? DATASET_VERSION,
    who: rec.who ?? WHO,
  };
}

/** Best-effort POST of a batch under one of the wrapper keys the backend
 *  accepts. Swallows every error; returns nothing. */
async function postBatch(path: string, key: 'rounds' | 'events', batch: unknown[]): Promise<void> {
  try {
    await apiFetch(path, { method: 'POST', body: JSON.stringify({ [key]: batch }) });
  } catch {
    /* telemetry is best-effort: silently drop on any failure */
  }
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushTelemetry();
  }, FLUSH_DEBOUNCE_MS);
}

/** Queue a played round for the next best-effort flush. Never throws. */
export function recordRound(round: RoundRecord): void {
  try {
    roundBuf.push(stamp(round));
    if (roundBuf.length >= MAX_BATCH) void flushTelemetry();
    else scheduleFlush();
  } catch {
    /* never let telemetry affect gameplay */
  }
}

/** Queue an allow-listed event for the next best-effort flush. Never throws. */
export function recordEvent(event: EventRecord): void {
  try {
    eventBuf.push(stamp(event));
    if (eventBuf.length >= MAX_BATCH) void flushTelemetry();
    else scheduleFlush();
  } catch {
    /* never let telemetry affect gameplay */
  }
}

/** Flush both buffers best-effort. Drains the buffers first so a failing POST
 *  drops (rather than retries forever) the batch. Never throws, never blocks. */
export async function flushTelemetry(): Promise<void> {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const rounds = roundBuf.splice(0, roundBuf.length);
  const events = eventBuf.splice(0, eventBuf.length);
  const jobs: Promise<void>[] = [];
  if (rounds.length) jobs.push(postBatch('/api/telemetry/rounds', 'rounds', rounds));
  if (events.length) jobs.push(postBatch('/api/telemetry/events', 'events', events));
  if (jobs.length) await Promise.allSettled(jobs);
}

// Flush whatever is buffered when the page is hidden/unloaded so the final batch
// is not lost. Guarded for non-browser (test) environments.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => {
    void flushTelemetry();
  });
}
