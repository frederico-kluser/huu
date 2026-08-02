/**
 * Selectable dev-mode methodologies (the /dev "Metodologia" toggles) — the
 * PURE half.
 *
 * The option list is NOT defined here: it arrives from `/api/bootstrap` as
 * `devMethodologyOptions`, served from the same table the POST parser reads —
 * one source of truth, so an option added server-side renders immediately and
 * the client can never disagree with what actually runs.
 *
 * The only decisions made here are what the POST body should carry and what a
 * persisted selection may restore:
 *
 *   - one or more options on → `{ methodology: { <key>: true, … } }`;
 *   - nothing on             → `{}` — a body byte-identical to today's, which
 *     is what keeps an untouched panel compiling the pipeline it compiles
 *     today (the server drops everything that is not literally `true` under a
 *     known key, so the payload stays minimal by construction);
 *   - a stored selection      → restored only for keys the server STILL
 *     advertises — a stale localStorage entry must never resurrect a toggle
 *     the current build no longer offers.
 *
 * No DOM access at import or call time — `dev-methodology.test.js` runs it in
 * Node.
 */

/**
 * The `methodology` half of `POST /api/dev`: each ON key becomes `true`,
 * `{}` when nothing is on (the key is omitted from the body entirely).
 */
export function buildDevMethodologyPayload(keys) {
  const on = [...new Set(Array.isArray(keys) ? keys : [])]
    .filter((k) => typeof k === 'string' && k.trim());
  if (!on.length) return {};
  const methodology = {};
  for (const key of on) methodology[key] = true;
  return { methodology };
}

/**
 * Parse the raw `huu.settings.v1` JSON and return the stored methodology keys
 * that are still valid. `validKeys` is the key list from the bootstrap
 * catalog; anything else in storage — junk, or an option a newer/older build
 * no longer serves — is dropped silently.
 */
export function parseStoredMethodology(raw, validKeys) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const stored = parsed && typeof parsed === 'object' ? parsed.devMethodology : null;
  if (!Array.isArray(stored)) return [];
  const valid = new Set(Array.isArray(validKeys) ? validKeys : []);
  return [...new Set(stored.filter((k) => typeof k === 'string' && valid.has(k)))];
}
