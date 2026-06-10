// React hook tying sprite consent + the on-device engine together. Returns a
// render-ready state for one Digimon sprite. Fetches nothing until consent is
// 'granted'; once granted, resolves to an on-device cached cutout (or boxed).
//
// When the caller passes the Digimon's id, the cutout recipe layer applies:
// the served (approved) recipe or the user's local draft is fed to the engine,
// and the sprite re-resolves whenever that recipe changes (Sprite Cutout
// Manager). Without an id the engine defaults apply, exactly as before.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSpriteConsent } from './spriteConsent';
import { loadSprite, recipeHash } from './spriteEngine';
import { ensureRecipesLoaded, getEffectiveRecipe, recipesVersion, subscribeRecipes } from '../api/spriteRecipes';

export type SpriteState = 'none' | 'no-consent' | 'loading' | 'ready';

export interface SpriteResult {
  state: SpriteState;
  url: string | null;
  /** true when `url` is a real-shape transparent cutout (mask/colour modes). */
  isCutout: boolean;
}

export function useSprite(src: string | null, digimonId?: number): SpriteResult {
  const consent = useSpriteConsent();
  // Re-render when the served recipe blob lands or a local draft changes.
  useSyncExternalStore(subscribeRecipes, recipesVersion, recipesVersion);
  const recipe = getEffectiveRecipe(digimonId);
  const rHash = recipeHash(recipe);

  const [res, setRes] = useState<{ url: string; isCutout: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  // Bounded auto-retry: a failed sprite re-attempts after a pause instead of
  // staying blank until its dex group remounts. attempt bumps re-run the effect.
  const [attempt, setAttempt] = useState(0);
  const RETRY_DELAYS_MS = [8_000, 30_000];

  // A different sprite/recipe starts with a fresh retry budget (no-op when 0).
  useEffect(() => {
    setAttempt(0);
  }, [src, rHash]);

  useEffect(() => {
    setRes(null);
    setFailed(false);
    if (!src || consent !== 'granted') return;
    ensureRecipesLoaded();
    let alive = true;
    let retryTimer: number | undefined;
    loadSprite(src, recipe)
      .then((r) => alive && setRes(r))
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          retryTimer = window.setTimeout(() => setAttempt((a) => a + 1), delay);
        }
      });
    return () => {
      alive = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
    // recipe identity is captured by its hash (a stable object is not guaranteed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, consent, rHash, attempt]);

  if (!src) return { state: 'none', url: null, isCutout: false };
  if (consent !== 'granted') return { state: 'no-consent', url: null, isCutout: false };
  if (failed) return { state: 'none', url: null, isCutout: false };
  if (!res) return { state: 'loading', url: null, isCutout: false };
  return { state: 'ready', url: res.url, isCutout: res.isCutout };
}
