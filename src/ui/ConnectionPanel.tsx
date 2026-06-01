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
    <form className="panel" onSubmit={onSubmit}>
      <h2 className="title" style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Connect to Archipelago</h2>
      <div className="row">
        <input aria-label="Host" style={{ flex: 2 }} value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="host" />
        <input aria-label="Port" style={{ width: 90 }} value={port} onChange={(e) => setPort(e.target.value)} placeholder="port" inputMode="numeric" />
      </div>
      <div className="row" style={{ marginTop: '0.6rem' }}>
        <input aria-label="Slot name" style={{ flex: 2 }} value={slotName} onChange={(e) => setSlotName(e.target.value)} placeholder="slot name" />
        <input aria-label="Password" style={{ flex: 1 }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password (optional)" />
        <button className="primary" type="submit" disabled={busy || !slotName || !hostname || !port}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
      {connectionError && <p className="toast bad" style={{ marginBottom: 0 }}>✗ {connectionError}</p>}
    </form>
  );
}
