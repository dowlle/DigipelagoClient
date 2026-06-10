// Win accounting: a multiworld win (goal reached) counts toward palette unlocks
// exactly once per seed+seat, marked in localStorage. The marker is deliberately
// device-local like the rest of the prefs (ADR-0002): the durable artefacts of a
// win are the explicit unlockedThemes entries, which sync to the account.
//
// Pure + storage-guarded so it is unit-testable under the node env (same
// pattern as useWrongPickMeter's MeterState persistence).

const PREFIX = 'digipelago:win:';

/** Per-seed, per-seat win marker key. seedName comes from the AP room (stable
 *  for a generated multiworld, random in race seeds, which is fine: a race
 *  reconnect still sees the same room's seedName for the session). */
export function winKey(seedName: string, team: number, slot: number): string {
  return `${PREFIX}${seedName}:${team}:${slot}`;
}

/** Mark this seed's win as counted. Returns true only the FIRST time (the win
 *  should be counted), false when already counted or storage is unavailable. */
export function markWinCounted(key: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(key) != null) return false;
    localStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}
