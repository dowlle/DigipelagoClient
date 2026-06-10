// Goal moment toast: fired once when the seed's goal is reached (the win is
// also reported to the AP server by the game context). Mirrors CatchToast's
// look, slightly below it so both can co-exist on the final catch.

import { Trophy, Palette } from 'lucide-react';
import type { WinMoment } from './useWinUnlocks';

export function GoalToast({ moment }: { moment: WinMoment }) {
  return (
    <div className="hud-toast pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2">
      <div
        className="flex items-center gap-3 rounded-2xl py-2.5 pl-3 pr-4"
        style={{
          background: 'var(--dp-card)',
          border: '1px solid var(--dp-secondary)',
          boxShadow:
            '0 12px 40px rgba(0,0,0,.4), 0 0 22px color-mix(in srgb, var(--dp-secondary) 27%, transparent)',
        }}
      >
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px]"
          style={{ background: 'color-mix(in srgb, var(--dp-secondary) 15%, transparent)' }}
        >
          <Trophy size={22} style={{ color: 'var(--dp-secondary)' }} aria-hidden />
        </div>
        <div>
          <div className="text-sm font-bold" style={{ color: 'var(--dp-secondary)', fontFamily: 'var(--dp-font-disp)' }}>
            Goal complete! Your world is finished.
          </div>
          {moment.unlockedNames.length > 0 && (
            <div
              className="mt-0.5 flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--dp-text-mid)', fontFamily: 'var(--dp-font-body)' }}
            >
              <Palette size={12} style={{ color: 'var(--dp-primary)' }} aria-hidden />
              <span>
                Palette unlocked:{' '}
                <b style={{ color: 'var(--dp-primary)', fontFamily: 'var(--dp-font-disp)' }}>
                  {moment.unlockedNames.join(', ')}
                </b>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
