// Capacity moment toast (S5) — fired when a "DigiStorage Upgrade" item bumps
// your storage capacity. Shows "Storage expanded +N" and "from → to max".
// Ported from hud-deep2.jsx MomentCapacity, token-driven. Presentation only:
// the bump is derived by the UI diffing GameState.capacity (no AP write).

import { ArrowRight, Box } from 'lucide-react';

export interface CapacityMoment {
  from: number;
  to: number;
  by: number;
}

export function CapacityToast({ moment }: { moment: CapacityMoment }) {
  return (
    <div className="hud-toast pointer-events-none fixed left-1/2 top-5 z-50 -translate-x-1/2">
      <div
        className="flex items-center gap-3.5 rounded-2xl px-4 py-3.5"
        style={{
          background: 'var(--dp-card)',
          border: '1px solid var(--dp-warn)',
          boxShadow: '0 14px 44px rgba(0,0,0,.45), 0 0 24px color-mix(in srgb, var(--dp-warn) 27%, transparent)',
        }}
      >
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px]"
          style={{
            background: 'color-mix(in srgb, var(--dp-warn) 12%, transparent)',
            border: '1px solid var(--dp-warn)',
          }}
        >
          <Box size={22} style={{ color: 'var(--dp-warn)' }} />
        </div>
        <div>
          <div className="flex items-center gap-2 text-base font-bold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
            Storage expanded <span style={{ color: 'var(--dp-good)' }}>+{moment.by}</span>
          </div>
          <div
            className="mt-1 flex items-center gap-2 text-[13px]"
            style={{ color: 'var(--dp-text-mid)', fontFamily: 'var(--dp-font-body)' }}
          >
            <span className="font-semibold line-through" style={{ color: 'var(--dp-text-faint)', fontFamily: 'var(--dp-font-disp)' }}>
              {moment.from}
            </span>
            <ArrowRight size={14} style={{ color: 'var(--dp-good)' }} />
            <span className="font-bold" style={{ color: 'var(--dp-good)', fontFamily: 'var(--dp-font-disp)' }}>
              {moment.to} max
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
