/**
 * Env knobs for the AutoScaler's per-agent memory model — the EVIDENCE-BASED
 * tuning surface for "the machine never fills up to the RAM dial".
 *
 * The pessimistic 1536MiB cold-start seed is a deliberate OOM fix (the scaler
 * once over-admitted on an optimistic seed and the machine OOM'd), so the
 * DEFAULTS never change here: unset/garbage env resolves to `undefined` and
 * the AutoScaler keeps its own constants. These knobs exist so a user who has
 * MEASURED their real per-agent footprint (see the `scaler`/`ema_move` debug
 * log and `AutoScaleStatus.observedAgentMemoryMb`) can lower the seed — or
 * speed up the EMA — deliberately. Values clamp to the scaler's own estimate
 * clamps; parsing never throws (validation must never block a run).
 */

/** Clamp bounds mirror the AutoScaler's estimate clamps (min/maxAgentMemoryMb). */
const SEED_MIN_MB = 128;
const SEED_MAX_MB = 4096;
const ALPHA_MIN = 0.01;
const ALPHA_MAX = 1;

/** `HUU_AGENT_MEM_SEED_MB` → clamped integer MiB, or undefined (keep default). */
export function resolveAgentMemSeedMb(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.HUU_AGENT_MEM_SEED_MB?.trim();
  if (!raw) return undefined;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(SEED_MIN_MB, Math.min(SEED_MAX_MB, n));
}

/** `HUU_AGENT_MEM_EMA_ALPHA` → clamped factor (0.01–1), or undefined. */
export function resolveEmaAlpha(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.HUU_AGENT_MEM_EMA_ALPHA?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, n));
}

/**
 * Spreadable AutoScaler config fragment: `{ ...resolveRamTuning() }`. Keys are
 * OMITTED (not set to undefined) when the env doesn't override them, so the
 * AutoScaler's `??` defaults keep working and explicit caller config wins.
 */
export function resolveRamTuning(
  env: NodeJS.ProcessEnv = process.env,
): { agentMemoryEstimateMb?: number; emaAlpha?: number } {
  const out: { agentMemoryEstimateMb?: number; emaAlpha?: number } = {};
  const seed = resolveAgentMemSeedMb(env);
  if (seed !== undefined) out.agentMemoryEstimateMb = seed;
  const alpha = resolveEmaAlpha(env);
  if (alpha !== undefined) out.emaAlpha = alpha;
  return out;
}
