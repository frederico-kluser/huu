/**
 * Multi-key POOL with rotation, layered on top of the single-key store in
 * `api-key.ts`. Deliberately mirrors the surf CLI's proven implementation
 * (`surf-skill/src/lib/state.mjs`): round-robin index that skips burned and
 * cooling keys, `markBurned` on auth failures, `setCooldown` on rate limits,
 * both persisted so the next process doesn't re-hit a sidelined key.
 *
 * ## Store schema — ADDITIVE and MIRRORED
 *
 * ```jsonc
 * {
 *   "openrouter": "sk-or-PRIMARY",   // UNCHANGED single-key field
 *   "_pools": {                      // NEW; an older huu ignores unknown keys
 *     "openrouter": {
 *       "keys": ["sk-or-A", "sk-or-B"], "current": 0,
 *       "burned":    [{ "index": 1, "at": "…", "reason": "auth" }],
 *       "cooldowns": [{ "index": 0, "until": "…" }]
 *     }
 *   }
 * }
 * ```
 *
 * - READ: `_pools[name].keys` when non-empty, else `[store[name]]` when
 *   non-empty, else `[]`. A legacy single-key config therefore reads as a
 *   pool of one and needs ZERO migration.
 * - WRITE: see {@link saveKeyPool} — `store[name]` is kept in sync with
 *   `keys[0]`. That mirror is the ENTIRE compatibility contract.
 *
 * `_pools` is `_`-prefixed and registry names are camelCase, so
 * `findSpec('_pools')` can never collide.
 *
 * ## No lockfile (unlike surf)
 *
 * surf needs one because concurrent CLI invocations are the norm. Here the
 * rotation path only mutates `burned`/`cooldowns`/`current`, and `keys` only
 * changes on an explicit UI action. Last-writer-wins loses at most one
 * cooldown — cosmetic. Porting the lock would add a failure mode (a stale
 * lock) for no gain.
 */

import { findSpec, readConfigStore, writeConfigStore, type ApiKeySpec } from './api-key.js';
import type { ProviderErrorKind } from './provider-error.js';

/** JSON property holding every pool, keyed by `ApiKeySpec.name`. */
export const POOL_STORE_FIELD = '_pools';

/** A key taken permanently out of rotation (401/403). */
export interface PoolBurn {
  /** Index into `KeyPoolState.keys`. */
  index: number;
  /** ISO timestamp of the burn. */
  at: string;
  /** Short machine-ish reason ('auth', '401', …). */
  reason: string;
}

/** A key temporarily sidelined (429 / 402) until `until`. */
export interface PoolCooldown {
  /** Index into `KeyPoolState.keys`. */
  index: number;
  /** ISO timestamp; entries in the past are pruned on normalize. */
  until: string;
}

/** Persisted pool state for ONE key spec. */
export interface KeyPoolState {
  keys: string[];
  /** Round-robin start position. Always a valid index (or 0 when empty). */
  current: number;
  burned: PoolBurn[];
  cooldowns: PoolCooldown[];
}

/**
 * Runtime view of a pool bound to ONE run. `current()` is the key to use for
 * the next attempt; `report()` records a failure and rotates.
 */
export interface KeyPoolHandle {
  /** Number of keys available to rotate through (1 for a singleton). */
  size(): number;
  /** The key for the next attempt. Empty string only when nothing is set. */
  current(): string;
  /**
   * Record that `key` failed with `kind`, sideline it, and rotate.
   *
   * Returns TRUE when the pool moved to a DIFFERENT usable key — i.e. a
   * retry is worth granting. Returns false when nothing changed: an unknown
   * key, `kind: 'other'` (nothing learned about the key), a singleton
   * handle, or no other usable key left.
   *
   * NOTE the caller's obligation for `'auth'`: burning is permanent for the
   * rest of the month, so only report `'auth'` after an independent probe
   * (`checkOpenRouterReachable`) also says unauthorized. See
   * `classifyProviderError`'s doc comment.
   */
  report(kind: ProviderErrorKind, key: string): boolean;
}

/** Max burn records kept per pool (mirrors surf's `BURNED_CAP`). */
export const BURNED_CAP = 50;

/** Default sideline for a 429. Overridable via `HUU_KEY_COOLDOWN_MS`. */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
/**
 * Default sideline for a 402 (out of credits). Longer than a rate limit —
 * topping up an account is a human action, not a second-scale recovery.
 * Overridable via `HUU_KEY_QUOTA_COOLDOWN_MS`.
 */
export const DEFAULT_QUOTA_COOLDOWN_MS = 30 * 60_000;

// ─────────────────────────── pure helpers ───────────────────────────

/** An empty, valid pool. */
export function blankPool(): KeyPoolState {
  return { keys: [], current: 0, burned: [], cooldowns: [] };
}

/**
 * Coerce anything read off disk into a valid {@link KeyPoolState}: drops
 * non-string/empty keys, clamps `current` into range, drops burn/cooldown
 * entries whose index no longer exists, prunes EXPIRED cooldowns, dedupes by
 * index, and caps `burned` at {@link BURNED_CAP} (oldest dropped first).
 *
 * Pure: never touches disk, never mutates its argument.
 */
export function normalizePool(raw: unknown, now: number = Date.now()): KeyPoolState {
  const obj = isRecord(raw) ? raw : {};

  const keys = Array.isArray(obj.keys)
    ? obj.keys
        .filter((k): k is string => typeof k === 'string' && k.trim() !== '')
        .map((k) => k.trim())
    : [];
  const n = keys.length;

  const inRange = (i: unknown): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < n;

  const burnedByIndex = new Map<number, PoolBurn>();
  if (Array.isArray(obj.burned)) {
    for (const entry of obj.burned) {
      if (!isRecord(entry) || !inRange(entry.index)) continue;
      burnedByIndex.set(entry.index, {
        index: entry.index,
        at: typeof entry.at === 'string' ? entry.at : new Date(now).toISOString(),
        reason: typeof entry.reason === 'string' ? entry.reason : 'unknown',
      });
    }
  }
  const burned = [...burnedByIndex.values()];
  while (burned.length > BURNED_CAP) burned.shift();

  const cooldownByIndex = new Map<number, PoolCooldown>();
  if (Array.isArray(obj.cooldowns)) {
    for (const entry of obj.cooldowns) {
      if (!isRecord(entry) || !inRange(entry.index)) continue;
      if (typeof entry.until !== 'string') continue;
      const until = Date.parse(entry.until);
      // Expired entries are pruned on every load/save so the store stays
      // clean; ACTIVE ones persist so a rate-limited key isn't hammered
      // first on the next run.
      if (!Number.isFinite(until) || until <= now) continue;
      cooldownByIndex.set(entry.index, { index: entry.index, until: entry.until });
    }
  }

  const rawCurrent = obj.current;
  const current =
    n > 0 && typeof rawCurrent === 'number' && Number.isInteger(rawCurrent)
      ? Math.max(0, Math.min(rawCurrent, n - 1))
      : 0;

  return { keys, current, burned, cooldowns: [...cooldownByIndex.values()] };
}

/** Whether key `index` is currently sidelined by a cooldown. */
export function cooldownActive(
  state: KeyPoolState,
  index: number,
  now: number = Date.now(),
): boolean {
  const entry = state.cooldowns.find((c) => c.index === index);
  if (!entry) return false;
  const until = Date.parse(entry.until);
  return Number.isFinite(until) && until > now;
}

/**
 * Round-robin scan starting at `state.current`, skipping `skipIndex`, burned
 * keys and keys in cooldown. Returns -1 when nothing is usable.
 */
export function nextUsableKeyIndex(
  state: KeyPoolState,
  skipIndex: number = -1,
  now: number = Date.now(),
): number {
  const n = state.keys.length;
  if (n === 0) return -1;
  const burnedIdx = new Set(state.burned.map((b) => b.index));
  const start = Math.max(0, Math.min(state.current, n - 1));
  for (let off = 0; off < n; off++) {
    const i = (start + off) % n;
    if (i === skipIndex) continue;
    if (burnedIdx.has(i)) continue;
    if (cooldownActive(state, i, now)) continue;
    return i;
  }
  return -1;
}

/**
 * Sideline key `index` until `untilMs` without burning it (429/402).
 * Mutates `state` in place (mirrors surf); does no I/O.
 */
export function setCooldown(state: KeyPoolState, index: number, untilMs: number): void {
  if (index < 0 || index >= state.keys.length) return;
  const until = new Date(untilMs).toISOString();
  const existing = state.cooldowns.find((c) => c.index === index);
  if (existing) existing.until = until;
  else state.cooldowns.push({ index, until });
}

/**
 * Take key `index` permanently out of rotation (401/403). Idempotent.
 * Mutates `state` in place; does no I/O.
 */
export function markBurned(state: KeyPoolState, index: number, reason: string): void {
  if (index < 0 || index >= state.keys.length) return;
  if (state.burned.some((b) => b.index === index)) return;
  state.burned.push({
    index,
    at: new Date().toISOString(),
    reason: String(reason || 'unknown'),
  });
  while (state.burned.length > BURNED_CAP) state.burned.shift();
}

// ───────────────────────────── I/O layer ─────────────────────────────
// Everything below delegates the actual file to `api-key.ts` and NEVER
// throws: a broken store degrades to "no pool", exactly like the rest of
// the key stack.

/**
 * Read the pool for `spec`, applying the READ rule: `_pools[name]` when it
 * has keys, else the legacy flat `store[name]` as a pool of ONE, else empty.
 */
export function loadKeyPool(spec: ApiKeySpec): KeyPoolState {
  try {
    const store = readConfigStore();
    const pools = isRecord(store[POOL_STORE_FIELD]) ? store[POOL_STORE_FIELD] : {};
    const pool = normalizePool(pools[spec.name]);
    if (pool.keys.length > 0) return pool;

    const flat = store[spec.name];
    const single = typeof flat === 'string' ? flat.trim() : '';
    if (single) return { ...blankPool(), keys: [single] };
    return blankPool();
  } catch {
    return blankPool();
  }
}

/**
 * Persist `state` for `spec` and return what was actually written
 * (normalized). Never throws.
 *
 * THE COMPATIBILITY MIRROR: whenever the pool has keys, the legacy flat
 * field `store[spec.name]` is rewritten to `keys[0]`. That single line is
 * the whole backwards-compatibility contract — an OLDER huu, or an older
 * IMAGE sharing the same `HUU_CONFIG_DIR`, knows nothing about `_pools` and
 * would otherwise find no key at all. It has its own regression test.
 *
 * Symmetrically, emptying a pool clears BOTH the pool entry and the mirror:
 * leaving the flat field behind would resurrect the removed key as a pool of
 * one on the next read.
 */
export function saveKeyPool(spec: ApiKeySpec, state: KeyPoolState): KeyPoolState {
  const normalized = normalizePool(state);
  try {
    const store = readConfigStore();
    const pools: Record<string, unknown> = isRecord(store[POOL_STORE_FIELD])
      ? { ...store[POOL_STORE_FIELD] }
      : {};

    if (normalized.keys.length === 0) {
      delete pools[spec.name];
      delete store[spec.name];
    } else {
      pools[spec.name] = normalized;
      store[spec.name] = normalized.keys[0];
    }

    if (Object.keys(pools).length === 0) delete store[POOL_STORE_FIELD];
    else store[POOL_STORE_FIELD] = pools;

    writeConfigStore(store);
  } catch {
    /* a read-only/unwritable store must never take a run down */
  }
  return normalized;
}

/**
 * Append `value` to `spec`'s pool (no-op on empty or already-present values)
 * and persist. Returns the resulting pool.
 */
export function addPoolKey(spec: ApiKeySpec, value: string): KeyPoolState {
  const trimmed = value.trim();
  const state = loadKeyPool(spec);
  if (!trimmed || state.keys.includes(trimmed)) return state;
  state.keys.push(trimmed);
  return saveKeyPool(spec, state);
}

/**
 * Remove the key at `index` and REINDEX the derived state: burn/cooldown
 * entries for the removed key are dropped, and every entry above it shifts
 * down by one so it keeps pointing at the same key. `current` shifts the
 * same way. Returns the resulting pool.
 */
export function removePoolKey(spec: ApiKeySpec, index: number): KeyPoolState {
  const state = loadKeyPool(spec);
  if (index < 0 || index >= state.keys.length) return state;

  const shift = (i: number): number => (i > index ? i - 1 : i);
  const next: KeyPoolState = {
    keys: state.keys.filter((_, i) => i !== index),
    current: state.current === index ? 0 : shift(state.current),
    burned: state.burned
      .filter((b) => b.index !== index)
      .map((b) => ({ ...b, index: shift(b.index) })),
    cooldowns: state.cooldowns
      .filter((c) => c.index !== index)
      .map((c) => ({ ...c, index: shift(c.index) })),
  };
  return saveKeyPool(spec, next);
}

// ───────────────────────────── runtime ─────────────────────────────

/**
 * Bind a pool to one run, seeded with the key that run ALREADY resolved.
 *
 * CRITICAL CONTRACT — when `seed` is NOT a member of the persisted pool, the
 * handle is a SINGLETON over `seed` and never rotates. That preserves
 * `pickRunKey` precedence (a browser session key must never be silently
 * swapped for another) and covers the Docker case, where the secret mount
 * outranks the store, so the in-container pool may hold entirely different
 * values. Rotation is opt-in by construction: it only happens when the run is
 * demonstrably using a key the pool owns.
 */
export function createKeyPoolHandle(spec: ApiKeySpec, seed: string): KeyPoolHandle {
  const seedValue = seed.trim();
  const state = loadKeyPool(spec);
  const seedIndex = seedValue ? state.keys.indexOf(seedValue) : -1;

  if (seedIndex === -1) {
    return {
      size: () => (seedValue ? 1 : 0),
      current: () => seedValue,
      report: () => false,
    };
  }

  let index = seedIndex;
  state.current = seedIndex;

  return {
    size: () => state.keys.length,
    current: () => state.keys[index] ?? seedValue,
    report(kind: ProviderErrorKind, key: string): boolean {
      const failed = state.keys.indexOf(key.trim());
      if (failed === -1) return false;

      switch (kind) {
        case 'auth':
          markBurned(state, failed, 'auth');
          break;
        case 'rate_limit':
          setCooldown(state, failed, Date.now() + cooldownMs('HUU_KEY_COOLDOWN_MS', DEFAULT_RATE_LIMIT_COOLDOWN_MS));
          break;
        case 'quota':
          setCooldown(state, failed, Date.now() + cooldownMs('HUU_KEY_QUOTA_COOLDOWN_MS', DEFAULT_QUOTA_COOLDOWN_MS));
          break;
        default:
          // 'other' says nothing about the key — a timeout, a 500, a bad
          // model id. Sidelining here would burn the pool on provider blips.
          return false;
      }

      const next = nextUsableKeyIndex(state, failed);
      const rotated = next >= 0 && next !== failed;
      if (rotated) {
        index = next;
        state.current = next;
      }
      saveKeyPool(spec, state);
      return rotated;
    },
  };
}

/**
 * Convenience for callers holding a spec NAME (the web endpoints, the dev
 * driver). Unknown name → a pool-less singleton over `seed`.
 */
export function createKeyPoolHandleByName(name: string, seed: string): KeyPoolHandle {
  const spec = findSpec(name);
  if (!spec) {
    const seedValue = seed.trim();
    return { size: () => (seedValue ? 1 : 0), current: () => seedValue, report: () => false };
  }
  return createKeyPoolHandle(spec, seed);
}

function cooldownMs(envVar: string, fallback: number): number {
  const raw = Number(process.env[envVar]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
