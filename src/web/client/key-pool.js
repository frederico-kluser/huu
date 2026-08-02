/**
 * API-key pool rendering helpers — the PURE half of the ⚙ Settings key list.
 *
 * The server never returns a key's VALUE, only `{ index, masked, state, until,
 * reason }`, so everything the list shows is derived from that shape. This
 * module turns one entry into the state chip the row renders; `app.js` owns the
 * DOM around it.
 *
 * Deliberately NOT time-aware: `state` is the server's word (it owns the
 * cooldown clock and the burn ledger). Re-deciding "is this cooldown over yet?"
 * in the browser would make the panel disagree with the rotation that actually
 * happens.
 *
 * No DOM access at import or call time — `key-pool.test.js` runs it in Node.
 */

/** Local `HH:MM` for an ISO timestamp; `''` when absent or unparseable. */
export function coolingUntilLabel(until) {
  if (!until) return '';
  const at = new Date(until);
  const ms = at.getTime();
  if (!Number.isFinite(ms)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * Entry → `{ cls, text }` for the state chip.
 *
 * `cls` maps onto the panel's semantic palette: `ok` green (in rotation),
 * `warn` amber (temporarily skipped, self-healing), `bad` red (burned — it
 * stays out until reset). An unrecognized state degrades to `warn` with the
 * raw word rather than throwing or silently rendering as healthy.
 */
export function keyStateChip(entry) {
  const state = entry && typeof entry.state === 'string' ? entry.state : '';
  if (state === 'active') return { cls: 'ok', text: 'active' };
  if (state === 'cooling') {
    const until = coolingUntilLabel(entry && entry.until);
    return { cls: 'warn', text: until ? `cooling until ${until}` : 'cooling' };
  }
  if (state === 'burned') {
    const reason = entry && entry.reason ? String(entry.reason).trim() : '';
    return { cls: 'bad', text: reason ? `burned ${reason}` : 'burned' };
  }
  return { cls: 'warn', text: state || 'unknown' };
}

/**
 * Whether the pool has anything a "reset" would clear. Drives the affordance's
 * visibility — offering "reset burned/cooldowns" on an all-green pool is noise.
 */
export function poolNeedsReset(pool) {
  const keys = pool && Array.isArray(pool.keys) ? pool.keys : [];
  return keys.some((k) => k && k.state !== 'active');
}

/**
 * Normalize the pool payload for rendering: always an array, each entry with a
 * numeric index and an `isCurrent` flag. A malformed/absent payload yields `[]`
 * so the caller can hide the list instead of half-rendering it.
 */
export function poolRows(pool) {
  const keys = pool && Array.isArray(pool.keys) ? pool.keys : [];
  const current = pool && Number.isFinite(Number(pool.current)) ? Number(pool.current) : -1;
  return keys.map((k, i) => {
    const index = k && Number.isFinite(Number(k.index)) ? Number(k.index) : i;
    return {
      index,
      masked: (k && k.masked) || '—',
      chip: keyStateChip(k),
      isCurrent: index === current,
    };
  });
}
