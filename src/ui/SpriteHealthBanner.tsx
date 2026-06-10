// Shown when sprite fetches are MOSTLY failing. A clean browser loads the
// whole dex fine (verified: prod + stock Firefox renders every cell), so a
// high failure ratio almost always means a content blocker is blocking
// digi-api.com. Tell the player instead of leaving silent blank tiles.

import { useSyncExternalStore } from 'react';
import { ShieldAlert } from 'lucide-react';
import { getSpriteHealth, spriteHealthVersion, subscribeSpriteHealth } from './spriteEngine';

const MIN_FAILURES = 8;

export function SpriteHealthBanner() {
  useSyncExternalStore(subscribeSpriteHealth, spriteHealthVersion, spriteHealthVersion);
  const { successes, failures } = getSpriteHealth();
  if (failures < MIN_FAILURES || failures <= successes) return null;

  return (
    <div
      className="mb-3 flex items-start gap-2.5 rounded-lg p-3 text-sm"
      style={{
        background: 'color-mix(in srgb, var(--dp-warn) 12%, var(--dp-card))',
        border: '1px solid color-mix(in srgb, var(--dp-warn) 50%, transparent)',
        color: 'var(--dp-text-secondary)',
      }}
      role="status"
    >
      <ShieldAlert size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--dp-warn)' }} aria-hidden />
      <div>
        <strong style={{ color: 'var(--dp-text)' }}>Most Digimon images are failing to load.</strong>{' '}
        This usually means an ad or privacy blocker (uBlock Origin, Privacy Badger, strict
        tracking protection) is blocking <code className="text-[12px]">digi-api.com</code>, the
        fan-made database the images come from. Allow digi-api.com for this site and reload.
        ({failures} failed, {successes} loaded this session.)
      </div>
    </div>
  );
}
