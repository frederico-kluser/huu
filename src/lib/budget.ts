/**
 * RAM budget dial — the user-facing "use up to X% of total RAM" control that
 * becomes the ADMISSION INVARIANT (replacing the tool-imposed conservative
 * 10%/512MiB margin). It is MACHINE-GLOBAL (one machine, one RAM): in multi-run
 * it configures the single budget AutoScaler owned by the GlobalScheduler; in
 * single-run it configures that run's AutoScaler.
 *
 * Pure + leaf (`src/lib`): importable by the orchestrator and the web layer
 * without an upward dependency. Nothing here reads the machine — callers pass
 * `totalBytes` from the resource-monitor.
 *
 * Degrade-never-block (see the project principle): a malformed dial value is
 * clamped to a sane range, never thrown.
 */

/** Budget when nothing is configured: 85% of total RAM. */
export const DEFAULT_RAM_PERCENT = 85;
/**
 * Dial clamp. Below 10% nothing meaningful runs; above 95% there is no room for
 * the OS/page-cache to breathe before the kernel OOM-killer engages (the very
 * failure this dial exists to prevent).
 */
export const MIN_RAM_PERCENT = 10;
export const MAX_RAM_PERCENT = 95;
/**
 * Absolute floor of RAM the budget will never claim, regardless of the percent —
 * the non-negotiable OS reserve. 512 MiB. (Larger turbo-mode reserves are a
 * Fase 2 cgroup concern.)
 */
export const MIN_OS_RESERVE_BYTES = 512 * 1024 * 1024;

/**
 * Clamp an arbitrary percent into [MIN_RAM_PERCENT, MAX_RAM_PERCENT], rounding
 * to an integer. Non-finite input falls back to the default.
 */
export function clampPercent(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_RAM_PERCENT;
  return Math.max(MIN_RAM_PERCENT, Math.min(MAX_RAM_PERCENT, Math.round(pct)));
}

/**
 * Resolve the effective RAM percent: an explicit value (CLI flag / web Setting /
 * run config) wins; otherwise the `HUU_RAM_PERCENT` env var; otherwise the
 * default. The result is always clamped — a bad dial degrades, never blocks.
 */
export function resolveRamPercent(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit)) return clampPercent(explicit);
  const fromEnv = Number(process.env.HUU_RAM_PERCENT);
  if (Number.isFinite(fromEnv) && process.env.HUU_RAM_PERCENT !== undefined && process.env.HUU_RAM_PERCENT !== '') {
    return clampPercent(fromEnv);
  }
  return DEFAULT_RAM_PERCENT;
}

/**
 * Bytes the budget may claim: `pct` of total, but never above `total − the OS
 * reserve floor`. Always >= 0. `pct` is clamped defensively.
 */
export function ramBudgetBytes(totalBytes: number, pct: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  const byPercent = totalBytes * (clampPercent(pct) / 100);
  const ceiling = Math.max(0, totalBytes - MIN_OS_RESERVE_BYTES);
  return Math.max(0, Math.min(byPercent, ceiling));
}
