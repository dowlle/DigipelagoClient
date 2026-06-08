// useAuth — a tiny module-level auth store exposed via useSyncExternalStore.
//
// A single shared store (not per-component state) so every consumer sees the
// same { me } at once. Logged-out is the baseline: `me === null` means the user
// gets the unchanged localStorage-only experience.
//
//   me      — the current profile, or null when logged out (or not yet loaded)
//   login   — kick off the Discord OAuth redirect
//   logout  — clear the server session, then null out `me`
//   refresh — re-fetch GET /api/me (used after returning from the OAuth redirect)

import { useSyncExternalStore } from 'react';
import { getMe, login as apiLogin, logout as apiLogout, type Me } from './backend';

type Listener = () => void;

let me: Me | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

function setMe(next: Me | null): void {
  if (next === me) return;
  me = next;
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Me | null {
  return me;
}

/** Re-fetch the current user. Resolves to the new value; null on any failure
 *  (treat failure as logged out so the localStorage baseline stays intact). */
async function refresh(): Promise<Me | null> {
  try {
    const next = await getMe();
    setMe(next);
    return next;
  } catch {
    setMe(null);
    return null;
  }
}

/** Begin the Discord OAuth redirect. The page navigates away; on return, a
 *  fresh mount calls refresh() to pick up the new session. */
function login(): void {
  apiLogin();
}

/** Clear the server session, then drop the local profile. Never throws. */
async function logout(): Promise<void> {
  try {
    await apiLogout();
  } catch {
    /* best-effort: clear locally regardless */
  }
  setMe(null);
}

// Resolve auth state once at module load (best-effort). Guarded for tests.
let bootStarted = false;
function ensureBoot(): void {
  if (bootStarted) return;
  bootStarted = true;
  void refresh();
}

export interface AuthApi {
  me: Me | null;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<Me | null>;
}

export function useAuth(): AuthApi {
  ensureBoot();
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { me: value, login, logout, refresh };
}
