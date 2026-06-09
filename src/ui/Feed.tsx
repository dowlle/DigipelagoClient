// Multiworld activity feed (S5) — renders the typed rows from the read-only
// feed subscriber (src/ap/feed.ts) as a Play-view right rail and the uncropped
// Multiworld view. Ported from hud-deep2.jsx FeedRow / FeedRail / FullFeed /
// DexLegend-style legend strip. Presentation only.
//
// Row kinds:
//   catch     — your catch + where the item it released went ("→ <player>")
//   received  — an item you got + from whom
//   capacity  — storage +N → new max
//   milestone — a peer milestone (only if the stream supplies one; never faked)

import { ArrowLeft, ArrowRight, Box } from 'lucide-react';
import type { FeedRow as Row } from '../ap/feed';
import { itemFlagColor } from '../ap/feed';
import { Avatar } from './moments/Avatar';

/** Compact "Xs / Xm / Xh ago" label. */
function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function FeedRowView({ row, now, big = false }: { row: Row; now: number; big?: boolean }) {
  const pad = big ? 'py-3.5' : 'py-3';
  const sz = big ? 'text-[13px]' : 'text-[12.5px]';
  const time = (
    <span className="ml-auto text-[11px]" style={{ color: 'var(--dp-text-faint)', fontFamily: 'var(--dp-font-body)' }}>
      {ago(row.at, now)}
    </span>
  );
  const base = `flex items-center gap-2 border-b ${pad}`;

  if (row.kind === 'catch') {
    return (
      <div className={`border-b ${pad}`} style={{ borderColor: 'var(--dp-line-soft)' }}>
        <div className="flex items-center gap-2">
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: 'var(--dp-primary)', boxShadow: '0 0 7px var(--dp-primary)' }}
          />
          <span className={`font-semibold ${sz}`} style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
            You caught
            {row.caughtName && (
              <span style={{ color: 'var(--dp-primary)' }}> {row.caughtName}</span>
            )}
          </span>
          {time}
        </div>
        <div
          className={`ml-[15px] mt-1.5 flex items-center gap-1.5 ${sz}`}
          style={{ color: 'var(--dp-text-mid)', fontFamily: 'var(--dp-font-body)' }}
        >
          <ArrowRight size={13} style={{ color: 'var(--dp-secondary)' }} />
          <span
            className="font-semibold"
            style={{ color: itemFlagColor(row.flags) ?? 'var(--dp-secondary)', fontFamily: 'var(--dp-font-disp)' }}
          >
            {row.item}
          </span>
          {row.player && (
            <span className="flex items-center gap-1">
              to <Avatar name={row.player} size={16} /> {row.player}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (row.kind === 'received') {
    return (
      <div className={base} style={{ borderColor: 'var(--dp-line-soft)' }}>
        <ArrowLeft size={13} style={{ color: 'var(--dp-good)' }} className="shrink-0" />
        <span className={sz} style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-body)' }}>
          <b style={{ color: itemFlagColor(row.flags) ?? 'var(--dp-good)', fontFamily: 'var(--dp-font-disp)' }}>{row.item}</b>
        </span>
        {row.player && (
          <span className="text-[11px]" style={{ color: 'var(--dp-text-faint)' }}>
            · from {row.player}
          </span>
        )}
        {time}
      </div>
    );
  }

  if (row.kind === 'capacity') {
    return (
      <div className={base} style={{ borderColor: 'var(--dp-line-soft)' }}>
        <Box size={13} style={{ color: 'var(--dp-warn)' }} className="shrink-0" />
        <span className={sz} style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-body)' }}>
          Storage <b style={{ color: 'var(--dp-warn)', fontFamily: 'var(--dp-font-disp)' }}>+{row.by}</b> → {row.to} max
        </span>
        {time}
      </div>
    );
  }

  // milestone
  return (
    <div className={`${base} ${sz}`} style={{ borderColor: 'var(--dp-line-soft)', color: 'var(--dp-text-faint)' }}>
      {row.player && <Avatar name={row.player} size={16} />}
      <span>
        {row.player && <b style={{ color: 'var(--dp-text-mid)' }}>{row.player} </b>}
        {row.text}
      </span>
      {time}
    </div>
  );
}

/** Live-seat indicator dot + count. */
function SeatPill({ seats }: { seats: number }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--dp-good)', fontFamily: 'var(--dp-font-body)' }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--dp-good)', boxShadow: '0 0 6px var(--dp-good)' }} />
      {seats} {seats === 1 ? 'seat' : 'seats'} · live
    </span>
  );
}

function EmptyFeed({ big = false }: { big?: boolean }) {
  return (
    <div className={`grid place-items-center py-10 text-center ${big ? '' : 'px-2'}`}>
      <p className="text-[12.5px]" style={{ color: 'var(--dp-text-faint)', fontFamily: 'var(--dp-font-body)' }}>
        Nothing yet. Catch a Digimon to ship your first item into the multiworld.
      </p>
    </div>
  );
}

/** Play-view right rail (desktop only — collapses below xl). */
export function FeedRail({ rows, seats, now }: { rows: Row[]; seats: number; now: number }) {
  return (
    <aside
      className="hidden w-[300px] shrink-0 flex-col p-[18px] xl:flex"
      style={{ background: 'var(--dp-rail)', borderLeft: '1px solid var(--dp-line)' }}
      aria-label="Multiworld activity"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-bold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          Multiworld
        </span>
        <SeatPill seats={seats} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? <EmptyFeed /> : rows.slice(0, 12).map((r) => <FeedRowView key={r.id} row={r} now={now} />)}
      </div>
    </aside>
  );
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--dp-text-mid)', fontFamily: 'var(--dp-font-body)' }}>
      {swatch}
      {label}
    </span>
  );
}

/** Uncropped Multiworld view. */
export function FullFeed({ rows, seats, now }: { rows: Row[]; seats: number; now: number }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
            Multiworld activity
          </h2>
          <p className="text-[13px]" style={{ color: 'var(--dp-text-mid)' }}>
            Every catch, every item: where it came from, where it went.
          </p>
        </div>
        <SeatPill seats={seats} />
      </div>
      <div
        className="mb-1 flex flex-wrap gap-4 border-b py-2.5"
        style={{ borderColor: 'var(--dp-line)' }}
      >
        <LegendItem swatch={<span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--dp-primary)' }} />} label="Your catch → sent" />
        <LegendItem swatch={<ArrowLeft size={12} style={{ color: 'var(--dp-good)' }} />} label="Item received" />
        <LegendItem swatch={<Box size={12} style={{ color: 'var(--dp-warn)' }} />} label="Capacity" />
        <LegendItem
          swatch={<span className="h-3 w-3 rounded-md" style={{ border: '1.5px solid var(--dp-text-faint)' }} />}
          label="Peer milestone"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? <EmptyFeed big /> : rows.map((r) => <FeedRowView key={r.id} row={r} now={now} big />)}
      </div>
    </div>
  );
}
