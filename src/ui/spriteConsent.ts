// Explicit consent gate for loading Digimon images. Digipelago ships and hosts
// NO sprite art: images are fetched by the user's own browser directly from
// Digi-API and cached on their device, and ONLY after they opt in here. Nothing
// is fetched until consent === 'granted'.
//
// A tiny localStorage-backed store (useSyncExternalStore) so every <Sprite>, the
// consent prompts, and the Settings toggle all react to changes together.

import { useSyncExternalStore } from 'react';

export type SpriteConsent = 'granted' | 'denied' | null; // null = not asked yet

const KEY = 'digipelago:spriteConsent';

function read(): SpriteConsent {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

let current: SpriteConsent = read();
const listeners = new Set<() => void>();

export function getSpriteConsent(): SpriteConsent {
  return current;
}

export function setSpriteConsent(value: SpriteConsent): void {
  current = value;
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore storage errors */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSpriteConsent(): SpriteConsent {
  return useSyncExternalStore(subscribe, getSpriteConsent, getSpriteConsent);
}
