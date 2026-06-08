// React hook tying sprite consent + the on-device engine together. Returns a
// render-ready state for one Digimon sprite. Fetches nothing until consent is
// 'granted'; once granted, resolves to an on-device cached cutout (or boxed).

import { useEffect, useState } from 'react';
import { useSpriteConsent } from './spriteConsent';
import { loadSprite } from './spriteEngine';

export type SpriteState = 'none' | 'no-consent' | 'loading' | 'ready';

export interface SpriteResult {
  state: SpriteState;
  url: string | null;
  /** true when `url` is a real-shape transparent cutout (mask/colour modes). */
  isCutout: boolean;
}

export function useSprite(src: string | null): SpriteResult {
  const consent = useSpriteConsent();
  const [res, setRes] = useState<{ url: string; isCutout: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setRes(null);
    setFailed(false);
    if (!src || consent !== 'granted') return;
    let alive = true;
    loadSprite(src)
      .then((r) => alive && setRes(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [src, consent]);

  if (!src) return { state: 'none', url: null, isCutout: false };
  if (consent !== 'granted') return { state: 'no-consent', url: null, isCutout: false };
  if (failed) return { state: 'none', url: null, isCutout: false };
  if (!res) return { state: 'loading', url: null, isCutout: false };
  return { state: 'ready', url: res.url, isCutout: res.isCutout };
}
