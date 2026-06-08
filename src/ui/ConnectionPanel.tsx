import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useGame } from '../game/context';
import { useAuth } from '../api/useAuth';
import {
  getConnections,
  createConnection,
  getConnectionSecret,
  type SavedConnection,
} from '../api/backend';

// Connection form. localStorage holds ONLY these connection details + prefs
// (ADR-0002) — never game state. When the user is logged in, saved connections
// from the backend appear as quick-pick chips and can be saved; logged out, the
// form behaves exactly as before (localStorage only).
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
  const { me, login, logout } = useAuth();
  const init = loadSaved();
  const [hostname, setHostname] = useState(init.hostname);
  const [port, setPort] = useState(init.port);
  const [slotName, setSlotName] = useState(init.slotName);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Logged-in extras: saved-connection chips + a "store my password" opt-in.
  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const [storePassword, setStorePassword] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const refreshSaved = useCallback(async () => {
    if (!me) {
      setSaved([]);
      return;
    }
    try {
      setSaved(await getConnections());
    } catch {
      setSaved([]);
    }
  }, [me]);

  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  // Fill the form from a saved connection chip. Pulls the decrypted password
  // only when one is stored, so the user does not have to retype it.
  const pickSaved = async (conn: SavedConnection) => {
    setHostname(conn.server);
    setPort(String(conn.port));
    setSlotName(conn.slot_name);
    setSaveNote(null);
    if (conn.has_password) {
      try {
        const secret = await getConnectionSecret(conn.id);
        setPassword(secret ?? '');
      } catch {
        setPassword('');
      }
    } else {
      setPassword('');
    }
  };

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

  // Save the current form as a backend connection (login required). The password
  // is only sent when the opt-in checkbox is ticked.
  const onSave = async () => {
    if (!me) return;
    setSaveBusy(true);
    setSaveNote(null);
    try {
      await createConnection({
        label: slotName || hostname,
        server: hostname,
        port: Number(port),
        slot_name: slotName,
        password: storePassword && password ? password : undefined,
      });
      setSaveNote('Saved to your account.');
      await refreshSaved();
    } catch {
      setSaveNote('Could not save. Check the fields and try again.');
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <form className="dp-panel p-5 max-w-xl w-full mx-auto" onSubmit={onSubmit}>
      <h2 className="text-base font-bold mb-1">Connect to Archipelago</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--dp-text-secondary)' }}>
        Enter your multiworld server and slot to start catching.
      </p>

      {/* Account: optional Discord login, available BEFORE connecting so saved
          connections + theme sync can load up front (logged-out play is unchanged). */}
      <div className="mb-4 border-b pb-4" style={{ borderColor: 'var(--dp-line)' }}>
        {me ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span style={{ color: 'var(--dp-text-secondary)' }}>
              Logged in as <span style={{ color: 'var(--dp-text)' }}>{me.username || 'your account'}</span>
            </span>
            <button type="button" className="dp-toggle-btn text-xs" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="dp-btn dp-btn-primary py-2 text-sm w-full" onClick={() => login()}>
              Log in with Discord
            </button>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--dp-text-faint)' }}>
              Optional. Syncs your unlocked themes and saved connections across devices. You can play without it.
            </p>
          </>
        )}
      </div>

      {me && saved.length > 0 && (
        <div className="mb-4">
          <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--dp-text-faint)' }}>
            Saved connections
          </span>
          <div className="flex flex-wrap gap-2">
            {saved.map((conn) => (
              <button
                key={conn.id}
                type="button"
                className="dp-toggle-btn text-xs"
                onClick={() => void pickSaved(conn)}
                title={`${conn.server}:${conn.port} (${conn.slot_name})`}
              >
                {conn.label || conn.slot_name || conn.server}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          <input className="dp-input flex-[2]" aria-label="Host" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="host" />
          <input className="dp-input w-24" aria-label="Port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="port" inputMode="numeric" />
        </div>
        <input className="dp-input" aria-label="Slot name" value={slotName} onChange={(e) => setSlotName(e.target.value)} placeholder="slot name" />
        <input className="dp-input" aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password (optional)" />
        <button className="dp-btn dp-btn-primary py-2 text-sm" type="submit" disabled={busy || !slotName || !hostname || !port}>
          {busy ? 'Connecting...' : 'Connect'}
        </button>
      </div>

      {me && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--dp-line)' }}>
          <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--dp-text-secondary)' }}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={storePassword}
              onChange={(e) => setStorePassword(e.target.checked)}
            />
            <span>Let ap-pie.com store my room password (encrypted)</span>
          </label>
          <button
            type="button"
            className="dp-toggle-btn mt-2.5 text-sm"
            onClick={() => void onSave()}
            disabled={saveBusy || !slotName || !hostname || !port}
          >
            {saveBusy ? 'Saving...' : 'Save this connection'}
          </button>
          {saveNote && (
            <p className="mt-2 text-xs" style={{ color: 'var(--dp-text-faint)' }}>
              {saveNote}
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-xs" style={{ color: 'var(--dp-text-faint)' }}>
        This page is served over HTTPS, so it can only reach secure (wss) Archipelago servers, like
        archipelago.gg. A plain unencrypted server only works at localhost.
      </p>
      {connectionError && <p className="mt-3 text-sm font-semibold text-red-400">✗ {connectionError}</p>}
    </form>
  );
}
