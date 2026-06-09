import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getDigimon, dataset } from '../data/dataset';
import { useGame } from '../game/context';
import { goalProgress } from '../game/guess';
import { resolveByName, isStrictPrefixOfUncaughtGuessable } from '../game/match';

// Free-text mode = pure catch-anything: name any currently-catchable Digimon to
// catch it. The capacity cap is the only friction (Game Design).
//
// UX rework (backlog #2/#4): the input auto-submits as you type (no Enter, no
// button needed) once the typed text resolves to a catchable Digimon, with a
// small debounce when the text is still a strict prefix of a longer catchable
// name (so "Agumon" does not fire before you can finish "Agumon Hakase"). The
// input stays focused across catches, feedback is a transient toast that never
// interrupts typing, and a live caught/goal counter is always visible.
//
// Accessibility: Enter still force-submits (keyboard users), the toast is an
// aria-live region, and the auto-submit path and Enter path share one resolver
// so the behaviour is identical. None of this changes WHAT is catchable: the
// only catch gate is guessable() inside resolveByName, and the catch still flows
// through catchDigimon unchanged. Auto-submit only changes WHEN a catch fires.

const PREFIX_DEBOUNCE_MS = 250; // wait a beat when more typing could match a longer name
const TOAST_MS = 1500; // transient feedback, never blocks typing

export function FreeTextGuess() {
  const { slotData, state, catchDigimon } = useGame();
  const entries = useMemo(() => Object.values(dataset.meta), []);
  const [text, setText] = useState('');
  const [toast, setToast] = useState<{ msg: string; good: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Keep the latest values reachable from the auto-submit timer without
  // re-arming it on every state tick (the timer is keyed on `text`).
  const stateRef = useRef(state);
  stateRef.current = state;
  const slotRef = useRef(slotData);
  slotRef.current = slotData;

  // Transient toast: self-clears so it never sits in the way of the next guess.
  const showToast = (msg: string, good: boolean) => {
    setToast({ msg, good });
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  };

  const focusInput = () => {
    // Refocus without scrolling the page (keeps the input ready for the next name).
    inputRef.current?.focus({ preventScroll: true });
  };

  // One shared resolve + catch path used by both auto-submit and Enter.
  const commit = (raw: string) => {
    const slot = slotRef.current;
    if (!slot) return;
    const name = raw.trim();
    if (!name) return;
    const out = resolveByName(name, entries, stateRef.current, slot);
    switch (out.kind) {
      case 'catch':
        catchDigimon(out.digimon.id);
        showToast(`Caught ${out.digimon.name}!`, true);
        setText('');
        focusInput();
        break;
      case 'already':
        showToast(`${out.digimon.name} is already caught`, false);
        break;
      case 'locked':
        showToast(out.reason, false);
        break;
      case 'unknown':
        showToast(`No Digimon named "${name}"`, false);
        break;
    }
  };

  // Auto-submit: as `text` changes, resolve it; only ARM a timer when it already
  // resolves to a catch. Unambiguous catch fires immediately (0ms); if the text
  // is also a strict prefix of a longer catchable name, wait a beat so the player
  // can finish typing it. Non-catch outcomes never arm a timer (no churn) — they
  // surface only on explicit Enter. Cleanup clears the pending timer (debounce).
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const name = text.trim();
    if (!name) return;
    const out = resolveByName(name, entries, stateRef.current, slot);
    if (out.kind !== 'catch') return;
    const delay = isStrictPrefixOfUncaughtGuessable(name, entries, stateRef.current, slot)
      ? PREFIX_DEBOUNCE_MS
      : 0;
    const id = window.setTimeout(() => commit(name), delay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, entries]);

  // Always-focused input: refocus on mount and whenever the toast clears (e.g.
  // after a catch) so the next name can be typed without reaching for the mouse.
  useEffect(() => {
    focusInput();
  }, []);
  useEffect(() => {
    if (toast === null) focusInput();
  }, [toast]);

  // Clean up the toast timer on unmount.
  useEffect(() => () => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
  }, []);

  if (!slotData) return null;

  const goal = goalProgress(state, slotData, getDigimon);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    commit(text);
  };

  return (
    <div>
      <form className="flex gap-2" onSubmit={submit}>
        <input
          ref={inputRef}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="dp-input flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a Digimon name"
          aria-label="Digimon name"
        />
        <button className="dp-btn dp-btn-primary px-5 text-sm" type="submit">Guess</button>
      </form>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p
          aria-live="polite"
          className={`h-5 text-sm font-semibold ${toast?.good ? 'text-green-400' : 'text-red-400'}`}
        >
          {toast?.msg ?? ''}
        </p>
        <span
          className="shrink-0 text-xs tabular-nums"
          style={{ color: 'var(--dp-text-faint)', fontFamily: 'var(--dp-font-disp)' }}
          aria-label={`Goal progress: ${goal.current} of ${goal.target} caught`}
        >
          {goal.current} / {goal.target}
        </span>
      </div>
    </div>
  );
}
