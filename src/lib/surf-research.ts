/**
 * Bridge between huu and the `surf` web-research CLI (`surf-skill`).
 *
 * Three jobs, all of them defensive — web research is an OPTIONAL capability
 * and nothing here may ever fail a run:
 *
 *  1. {@link probeSurf} — is the CLI installed, and does the keyless tier
 *     (`surf-free-skill`) exist? Prompts branch on the truth, not on hope.
 *  2. {@link ensureSurfKeys} — MATERIALIZE `~/.config/surf/keys.json` from
 *     huu's key registry + pools. The surf CLI reads ONLY that file
 *     (`bin/surf-research-skill.mjs` → `loadState`), so env vars and Docker
 *     secret mounts alone never reach it.
 *  3. {@link readSurfUsage} — read surf's own ledger so web-research spend is
 *     reported SEPARATELY from huu's token budget. Mixing the two would
 *     corrupt the one number the user reasons about.
 *
 * `os.homedir()` is used everywhere, deliberately: it is the same function
 * surf itself uses (`surf-skill/src/lib/state.mjs`), and the container's
 * `$HOME` is not trustworthy (huu runs `--user` with no passwd entry, so HOME
 * can be `/tmp`). Resolving the path any other way would write a keys.json
 * the CLI never reads.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { findSpec, resolveApiKey } from './api-key.js';
import { loadKeyPool } from './api-key-pool.js';

/** The three keyed providers surf dispatches over, in surf's own order. */
export const SURF_PROVIDERS = ['tavily', 'parallel', 'brave'] as const;
export type SurfProvider = (typeof SURF_PROVIDERS)[number];

/** What the surf CLI offers on this machine/image. */
export interface SurfAvailability {
  /** `surf-research-skill` is on PATH and answers `--version`. */
  research: boolean;
  /**
   * `surf-free-skill` (the KEYLESS tier) is on PATH. Published surf 5.0.0
   * does NOT ship it — this flag tells the truth instead of assuming the
   * degradation step exists.
   */
  free: boolean;
  /** Version string reported by `surf-research-skill --version`. */
  version?: string;
  /** Why the probe failed (ENOENT, non-zero exit, timeout). */
  reason?: string;
}

const PROBE_TIMEOUT_MS = 5_000;

let probeCache: { pathKey: string; value: SurfAvailability } | null = null;

/**
 * Probe the surf CLI once per process (cached, keyed on `PATH` so a test
 * that changes PATH re-probes). Never throws: a missing binary is a normal,
 * expected answer.
 */
export function probeSurf(env: NodeJS.ProcessEnv = process.env): SurfAvailability {
  const pathKey = env.PATH ?? '';
  if (probeCache && probeCache.pathKey === pathKey) return probeCache.value;

  const research = probeBin('surf-research-skill', env);
  const free = probeBin('surf-free-skill', env);
  const value: SurfAvailability = {
    research: research.ok,
    free: free.ok,
    ...(research.version ? { version: research.version } : {}),
    ...(research.ok ? {} : { reason: research.reason ?? 'not found' }),
  };
  probeCache = { pathKey, value };
  return value;
}

/** Drop the per-process probe cache. Tests only. */
export function resetSurfProbeCache(): void {
  probeCache = null;
}

/** `~/.config/surf/keys.json` — the ONLY place the surf CLI looks. */
export function surfKeysPath(): string {
  return join(homedir(), '.config', 'surf', 'keys.json');
}

/** `~/.cache/surf/usage.jsonl` — surf's append-only spend ledger. */
export function surfUsagePath(): string {
  return join(homedir(), '.cache', 'surf', 'usage.jsonl');
}

/** Outcome of {@link ensureSurfKeys}. Never an exception. */
export interface EnsureSurfKeysResult {
  /** Path that was (or would have been) written. */
  path: string;
  /** False when nothing was written — see `reason`. */
  written: boolean;
  /** Providers huu contributed at least one key to. */
  providers: SurfProvider[];
  /** Total keys in the merged file, across providers. */
  keyCount: number;
  /** Why nothing was written, or what went wrong. */
  reason?: string;
}

interface SurfIndexed {
  index: number;
  [k: string]: unknown;
}

interface SurfProviderState {
  keys: string[];
  current: number;
  burned: SurfIndexed[];
  cooldowns: SurfIndexed[];
}

interface SurfKeysFile {
  schema_version: number;
  last_ok_provider: string | null;
  [provider: string]: unknown;
}

/**
 * Write `~/.config/surf/keys.json` from huu's resolved keys (`resolveApiKey`
 * precedence first, then the rest of the `_pools` entries — N keys map 1:1
 * onto surf's own `keys[]` array).
 *
 * MERGE RULE, NON-NEGOTIABLE: when the file already exists, the arrays are
 * UNIONED (huu's keys first) and surf's LEARNED state — `burned`,
 * `cooldowns`, `current`, `last_ok_provider` — is preserved. That file is the
 * only place rate-limit knowledge survives between executions; overwriting it
 * throws away the one thing surf learned the expensive way.
 *
 * Because huu's keys are PREPENDED, every preserved `index` is REMAPPED to
 * the key's new position. Keeping the raw indices would silently mark a fresh
 * huu key as burned — the exact opposite of preserving state.
 */
export function ensureSurfKeys(): EnsureSurfKeysResult {
  const path = surfKeysPath();
  try {
    const huuKeys = new Map<SurfProvider, string[]>();
    for (const provider of SURF_PROVIDERS) {
      huuKeys.set(provider, resolveHuuKeys(provider));
    }
    const contributed = SURF_PROVIDERS.filter((p) => (huuKeys.get(p) ?? []).length > 0);

    if (contributed.length === 0) {
      // Nothing to contribute: leave any existing surf state strictly alone.
      return {
        path,
        written: false,
        providers: [],
        keyCount: 0,
        reason: 'no surf provider keys configured in huu',
      };
    }

    const existing = readSurfKeysFile(path);
    const out: SurfKeysFile = {
      schema_version:
        typeof existing?.schema_version === 'number' ? existing.schema_version : 1,
      last_ok_provider:
        typeof existing?.last_ok_provider === 'string' ? existing.last_ok_provider : null,
    };

    let keyCount = 0;
    for (const provider of SURF_PROVIDERS) {
      const prev = readProviderState(existing?.[provider]);
      const merged = mergeProviderState(huuKeys.get(provider) ?? [], prev);
      out[provider] = merged;
      keyCount += merged.keys.length;
    }

    writeSurfKeysFile(path, out);
    return { path, written: true, providers: contributed, keyCount };
  } catch (err) {
    return {
      path,
      written: false,
      providers: [],
      keyCount: 0,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * In-container convenience wrapper: materialize the surf keys ONLY when running
 * inside the huu container (`HUU_IN_CONTAINER=1`), where the secret mounts and
 * the surf CLI actually exist. On the host it is a no-op (returns null) so huu
 * never touches a developer's own `~/.config/surf/keys.json`.
 *
 * This is the single production call site the bridge was missing: without it,
 * the mounted tavily/parallel/brave secrets are never seen by the CLI. Never
 * throws — {@link ensureSurfKeys} already returns its failures as data.
 */
export function ensureSurfKeysInContainer(
  env: NodeJS.ProcessEnv = process.env,
): EnsureSurfKeysResult | null {
  if (env.HUU_IN_CONTAINER !== '1') return null;
  return ensureSurfKeys();
}

/**
 * huu's keys for one surf provider, most-authoritative first: whatever the
 * standard resolver picked (secret mount → store → `_FILE` → env), then the
 * remaining pool entries.
 */
function resolveHuuKeys(provider: SurfProvider): string[] {
  const spec = findSpec(provider);
  if (!spec) return [];
  const out: string[] = [];
  const resolved = resolveApiKey(spec).trim();
  if (resolved) out.push(resolved);
  for (const key of loadKeyPool(spec).keys) {
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Union huu's keys (first) with surf's, remapping preserved indices. */
function mergeProviderState(huuKeys: string[], prev: SurfProviderState): SurfProviderState {
  const keys = [...huuKeys];
  for (const key of prev.keys) if (!keys.includes(key)) keys.push(key);

  // old position → new position, computed by VALUE so a key huu also holds
  // keeps its learned state instead of being duplicated.
  const remap = new Map<number, number>();
  prev.keys.forEach((key, oldIndex) => {
    const newIndex = keys.indexOf(key);
    if (newIndex >= 0) remap.set(oldIndex, newIndex);
  });
  const reindex = (entries: SurfIndexed[]): SurfIndexed[] =>
    entries
      .filter((e) => remap.has(e.index))
      .map((e) => ({ ...e, index: remap.get(e.index) as number }));

  return {
    keys,
    current: remap.get(prev.current) ?? 0,
    burned: reindex(prev.burned),
    cooldowns: reindex(prev.cooldowns),
  };
}

function readSurfKeysFile(path: string): SurfKeysFile | null {
  try {
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(parsed) ? (parsed as SurfKeysFile) : null;
  } catch {
    // A corrupt keys.json is not worth failing over — surf itself rebuilds
    // from blank in the same situation (`loadState`).
    return null;
  }
}

function writeSurfKeysFile(path: string, state: SurfKeysFile): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.huu.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    // `mode` is only honored on creation; an existing file keeps its old
    // bits after rename on some platforms.
    chmodSync(path, 0o600);
  } catch {
    /* Windows / fs without chmod — best effort */
  }
}

function readProviderState(raw: unknown): SurfProviderState {
  const obj = isRecord(raw) ? raw : {};
  return {
    keys: Array.isArray(obj.keys)
      ? obj.keys.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      : [],
    current: typeof obj.current === 'number' && Number.isInteger(obj.current) ? obj.current : 0,
    burned: readIndexed(obj.burned),
    cooldowns: readIndexed(obj.cooldowns),
  };
}

function readIndexed(raw: unknown): SurfIndexed[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is SurfIndexed =>
      isRecord(e) && typeof e.index === 'number' && Number.isInteger(e.index),
  );
}

// ────────────────────────────── usage ──────────────────────────────

/**
 * USD per surf "credit", per provider. ESTIMATES, and labelled as such:
 * surf models every provider on one unified credit scale
 * (`surf-skill/src/lib/cost.mjs`) and only Brave has a published per-query
 * price, which surf's own comment puts at ~$0.003 and reports as 1 credit.
 * Tavily bills in real credits; Parallel's per-request pricing is opaque and
 * surf approximates it with processor tiers.
 *
 * Override per provider with `HUU_SURF_CREDIT_USD_TAVILY` (etc.). If a future
 * surf ever writes a real `cost_usd` on a ledger line, that value WINS over
 * this table.
 */
export const SURF_CREDIT_USD: Record<string, number> = {
  tavily: 0.008,
  parallel: 0.005,
  brave: 0.003,
};
const FALLBACK_CREDIT_USD = 0.005;

export interface SurfProviderUsage {
  calls: number;
  credits: number;
  costUsd: number;
}

export interface SurfUsage {
  calls: number;
  costUsd: number;
  byProvider: Record<string, SurfProviderUsage>;
}

/**
 * Aggregate surf's `usage.jsonl` from `sinceMs` onward. Malformed lines are
 * skipped, not fatal; lines without a `provider` (surf ≤ 4.x wrote none) fall
 * into an `unknown` bucket rather than being dropped. Cached hits count as
 * calls with zero credits — that's how surf records them.
 */
export function readSurfUsage(sinceMs = 0): SurfUsage {
  const usage: SurfUsage = { calls: 0, costUsd: 0, byProvider: {} };
  let raw: string;
  try {
    const path = surfUsagePath();
    if (!existsSync(path)) return usage;
    raw = readFileSync(path, 'utf8');
  } catch {
    return usage;
  }

  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;

    if (typeof entry.ts === 'string') {
      const ts = Date.parse(entry.ts);
      if (Number.isFinite(ts) && ts < sinceMs) continue;
    } else if (sinceMs > 0) {
      // No timestamp and a window was asked for: can't prove it belongs.
      continue;
    }

    const provider = typeof entry.provider === 'string' && entry.provider ? entry.provider : 'unknown';
    const credits = typeof entry.credits === 'number' && Number.isFinite(entry.credits)
      ? entry.credits
      : 0;
    const explicitCost = typeof entry.cost_usd === 'number' && Number.isFinite(entry.cost_usd)
      ? entry.cost_usd
      : undefined;
    const cost = explicitCost ?? credits * creditUsd(provider);

    const bucket = usage.byProvider[provider] ?? { calls: 0, credits: 0, costUsd: 0 };
    bucket.calls += 1;
    bucket.credits += credits;
    bucket.costUsd += cost;
    usage.byProvider[provider] = bucket;

    usage.calls += 1;
    usage.costUsd += cost;
  }

  return usage;
}

/**
 * One-line run summary, e.g.
 * `web research: 14 calls, $0.0312 (tavily 9, parallel 5)`.
 * Empty string when there were no calls, so callers can skip printing.
 */
export function formatSurfUsage(usage: SurfUsage): string {
  if (usage.calls === 0) return '';
  const breakdown = Object.entries(usage.byProvider)
    .sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]))
    .map(([provider, u]) => `${provider} ${u.calls}`)
    .join(', ');
  const cost = `$${usage.costUsd.toFixed(4)}`;
  return `web research: ${usage.calls} call${usage.calls === 1 ? '' : 's'}, ${cost} (${breakdown})`;
}

function creditUsd(provider: string): number {
  const override = Number(process.env[`HUU_SURF_CREDIT_USD_${provider.toUpperCase()}`]);
  if (Number.isFinite(override) && override >= 0) return override;
  return SURF_CREDIT_USD[provider] ?? FALLBACK_CREDIT_USD;
}

function probeBin(
  bin: string,
  env: NodeJS.ProcessEnv,
): { ok: boolean; version?: string; reason?: string } {
  try {
    const res = spawnSync(bin, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (res.error) {
      const code = (res.error as NodeJS.ErrnoException).code;
      return { ok: false, reason: code ?? res.error.message };
    }
    if (res.status !== 0) return { ok: false, reason: `exit ${res.status}` };
    const version = (res.stdout ?? '').trim().split('\n')[0]?.trim();
    return version ? { ok: true, version } : { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
