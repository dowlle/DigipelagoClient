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

  useEffect(() => {
    setRes(null);
    setFailed(false);
    if (!src || consent !== 'granted') return;
    ensureRecipesLoaded();
    let alive = true;
    loadSprite(src, recipe)
      .then((r) => alive && setRes(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // recipe identity is captured by its hash (a stable object is not guaranteed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, consent, rHash]);

  if (!src) return { state: 'none', url: null, isCutout: false };
  if (consent !== 'granted') return { state: 'no-consent', url: null, isCutout: false };
  if (failed) return { state: 'none', url: null, isCutout: false };
  if (!res) return { state: 'loading', url: null, isCutout: false };
  return { state: 'ready', url: res.url, isCutout: res.isCutout };
}
