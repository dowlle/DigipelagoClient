// Explicit-consent prompt for loading Digimon images. Shown lazily on the image
// surfaces (Silhouette mode, Digidex) until the user decides. Makes clear that
// Digipelago hosts no art: the browser fetches images from Digi-API and caches
// them on the user's device.

import { ImageOff } from 'lucide-react';
import { setSpriteConsent, useSpriteConsent } from './spriteConsent';

const BLURB =
  'Digipelago does not host Digimon art. Images are fetched by your browser directly from digi-api.com and cached on your device.';

/** Full card: used where images are required (Silhouette mode). */
export function SpriteConsentCard({ requiredFor }: { requiredFor?: string }) {
  const consent = useSpriteConsent();
  if (consent === 'granted') return null;
  const denied = consent === 'denied';
  return (
    <div className="dp-card flex flex-col items-center gap-3 p-6 text-center">
      <ImageOff size={28} style={{ color: 'var(--dp-text-faint)' }} aria-hidden />
      <div>
        <h3 className="text-base font-bold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          {denied ? 'Images are off' : 'Load Digimon images?'}
        </h3>
        <p className="mx-auto mt-1 max-w-md text-[13px]" style={{ color: 'var(--dp-text-mid)' }}>
          {requiredFor ? `${requiredFor} needs Digimon images. ` : ''}{BLURB}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="dp-btn dp-btn-primary px-4 py-2 text-sm" onClick={() => setSpriteConsent('granted')}>
          {denied ? 'Enable images' : 'Allow images'}
        </button>
        {!denied && (
          <button className="dp-toggle-btn px-4 py-2 text-sm" onClick={() => setSpriteConsent('denied')}>
            Not now
          </button>
        )}
      </div>
    </div>
  );
}

/** Slim banner: used where images are optional (Digidex). Dismissible to 'denied'. */
export function SpriteConsentBanner() {
  const consent = useSpriteConsent();
  if (consent !== null) return null; // only while undecided
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg p-2.5 text-[12px]"
      style={{ background: 'var(--dp-card-2)', border: '1px solid var(--dp-line)', color: 'var(--dp-text-mid)' }}
    >
      <ImageOff size={14} style={{ color: 'var(--dp-text-faint)' }} aria-hidden />
      <span className="flex-1">{BLURB}</span>
      <button className="dp-btn dp-btn-primary" onClick={() => setSpriteConsent('granted')}>
        Allow images
      </button>
      <button className="dp-toggle-btn" onClick={() => setSpriteConsent('denied')}>
        Not now
      </button>
    </div>
  );
}
