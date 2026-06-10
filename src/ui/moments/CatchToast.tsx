// Catch moment toast (S5) — a floating top-centre toast fired when YOU catch a
// Digimon: shows the cutout sprite + "Caught <Name>!" + the "<item> → <player>"
// ship line. Ported from hud-deep2.jsx CatchToast, token-driven. Presentation
// only; the data comes from the read-only feed (src/ap/feed.ts).

import { ArrowRight } from 'lucide-react';
import { Sprite } from '../Sprite';
import { Avatar } from './Avatar';

export interface CatchMoment {
  name: string;
  sprite: string | null;
  /** Dataset id of the caught Digimon (enables the cutout-recipe layer). */
  id?: number;
  /** The AP item this catch shipped, when known from the feed. */
  item?: string;
  /** The recipient world, when known from the feed. */
  player?: string;
}

export function CatchToast({ moment }: { moment: CatchMoment }) {
  return (
    <div className="hud-toast pointer-events-none fixed left-1/2 top-5 z-50 -translate-x-1/2">
      <div
        className="flex items-center gap-3 rounded-2xl py-2.5 pl-3 pr-4"
        style={{
          background: 'var(--dp-card)',
          border: '1px solid var(--dp-good)',
          boxShadow: '0 12px 40px rgba(0,0,0,.4), 0 0 22px color-mix(in srgb, var(--dp-good) 27%, transparent)',
        }}
      >
        <div
          className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[10px]"
          style={{ background: '#eef1f5' }}
        >
          <Sprite src={moment.sprite} name={moment.name} digimonId={moment.id} className="h-10 w-10" />
        </div>
        <div>
          <div className="text-sm font-bold" style={{ color: 'var(--dp-good)', fontFamily: 'var(--dp-font-disp)' }}>
            Caught {moment.name}!
          </div>
          {moment.item && moment.player && (
            <div
              className="mt-0.5 flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--dp-text-mid)', fontFamily: 'var(--dp-font-body)' }}
            >
              <ArrowRight size={12} style={{ color: 'var(--dp-secondary)' }} />
              <b style={{ color: 'var(--dp-secondary)', fontFamily: 'var(--dp-font-disp)' }}>{moment.item}</b>
              <span className="flex items-center gap-1">
                → <Avatar name={moment.player} size={16} /> {moment.player}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
