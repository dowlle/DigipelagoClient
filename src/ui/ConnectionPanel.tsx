import { useState, type FormEvent } from 'react';
import { useGame } from '../game/context';

// Connection form. localStorage holds ONLY these connection details + prefs
// (ADR-0002) — never game state.
const LS_KEY = 'digipelago:lastConnection';

interface Saved {
  hostname: string;
  port: string;
  slotName: string;
}

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { hostname: 'localhost', port: '38281', slotName: '', ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt prefs */
  }
  return { hostname: 'localhost', port: '38281', slotName: '' };
}

export function ConnectionPanel() {
  const { connect, connectionError } = useGame();
  const init = loadSaved();
  const [hostname, setHostname] = useState(init.hostname);
  const [port, setPort] = useState(init.port);
  const [slotName, setSlotName] = useState(init.slotName);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await connect({ hostname, port: Number(port), slotName, password: password || undefined });
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ hostname, port, slotName }));
      } catch {
        /* prefs are best-effort */
      }
    } catch {
      /* connectionError is surfaced from context */
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="dp-panel p-5 max-w-xl w-full mx-auto" onSubmit={onSubmit}>
      <h2 className="text-base font-bold mb-1">Connect to Archipelago</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--dp-text-secondary)' }}>
        Enter your multiworld server and slot to start catching.
      </p>
      <div className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          <input className="dp-input flex-[2]" aria-label="Host" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="host" />
          <input className="dp-input w-24" aria-label="Port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="port" inputMode="numeric" />
        </div>
        <input className="dp-input" aria-label="Slot name" value={slotName} onChange={(e) => setSlotName(e.target.value)} placeholder="slot name" />
        <input className="dp-input" aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password (optional)" />
        <button className="dp-btn dp-btn-primary py-2 text-sm" type="submit" disabled={busy || !slotName || !hostname || !port}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
      {connectionError && <p className="mt-3 text-sm font-semibold text-red-400">✗ {connectionError}</p>}
    </form>
  );
}
