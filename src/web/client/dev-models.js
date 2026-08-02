/**
 * Per-role model routing for the `/dev` launch form — the PURE half.
 *
 * The role list and the preset table are NOT defined here: they arrive from
 * `/api/bootstrap` as `devModelRoles` / `devModelPresets`, which are the very
 * `DEV_MODEL_ROLES` / `DEV_MODEL_PRESETS` the compiler and the CLI read. One
 * source of truth — a preset retuned server-side needs no client edit, and the
 * client can never disagree with what actually runs.
 *
 * The only decision made here is what the POST body should carry, and it is
 * deliberately unambiguous — exactly ONE of the two fields, never both:
 *
 *   - untouched, recognized preset → `{ modelsPreset }`, and the SERVER expands
 *     the table (so the ids the run uses are the ones the server knows);
 *   - anything typed by hand      → `{ models }`, the explicit role→id map;
 *   - nothing pinned at all       → `{}` — a body byte-identical to today's,
 *     which is what keeps opening /dev and pressing Start from silently
 *     re-routing a run that works fine.
 *
 * No DOM access at import or call time — `dev-models.test.js` runs it in Node.
 */

/** The role→id object a preset prescribes; `{}` for an unknown/absent preset. */
export function presetPolicy(presets, preset) {
  if (!presets || typeof presets !== 'object') return {};
  const policy = presets[preset];
  return policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {};
}

/**
 * Field values for a preset: every role gets an entry, `''` where the preset
 * pins nothing (that role falls back to the form's own model id).
 */
export function presetValues(roles, presets, preset) {
  const policy = presetPolicy(presets, preset);
  /** @type {Record<string, string>} */
  const values = {};
  for (const role of roles || []) {
    values[role] = typeof policy[role] === 'string' ? policy[role] : '';
  }
  return values;
}

/** True when the typed values still say exactly what `preset` prescribes. */
export function matchesPreset(roles, presets, preset, values) {
  const want = presetValues(roles, presets, preset);
  for (const role of roles || []) {
    const a = (want[role] || '').trim();
    const b = ((values && values[role]) || '').trim();
    if (a !== b) return false;
  }
  return true;
}

/**
 * The `models` / `modelsPreset` half of `POST /api/dev`. Both fields are
 * optional in the contract; this returns at most one of them, and `{}` when
 * nothing is pinned.
 * @param {object} [fields]
 * @param {string[]} [fields.roles] role names from devModelRoles
 * @param {Record<string, Record<string, string>>} [fields.presets] preset → role → model id
 * @param {string} [fields.preset] selected preset name
 * @param {Record<string, string>} [fields.values] role → hand-typed model id
 */
export function buildDevModelsPayload({ roles, presets, preset, values } = {}) {
  const list = Array.isArray(roles) ? roles : [];
  const pinned = {};
  for (const role of list) {
    const value = ((values && values[role]) || '').trim();
    if (value) pinned[role] = value;
  }
  const known = !!presets && typeof presets === 'object'
    && Object.prototype.hasOwnProperty.call(presets, preset);
  // An empty pin set means every role inherits the single fallback id —
  // `uniform`, and the pre-routing body. Naming a preset there would be a lie
  // the server would have to undo.
  if (!Object.keys(pinned).length) return {};
  if (known && matchesPreset(list, presets, preset, values)) return { modelsPreset: preset };
  return { models: pinned };
}

/** One-line description of what {@link buildDevModelsPayload} will send. */
export function describeDevModelsPayload(payload) {
  if (!payload) return '';
  if (payload.modelsPreset) return `preset “${payload.modelsPreset}”`;
  if (payload.models) {
    const n = Object.keys(payload.models).length;
    return `${n} role${n === 1 ? '' : 's'} pinned by hand`;
  }
  return 'every role on the same model';
}
