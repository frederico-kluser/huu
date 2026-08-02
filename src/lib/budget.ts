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

/**
 * Budget when nothing is configured: 70% of total RAM. Lowered from 85 after
 * the 33-run incident: on a desktop the OS + browser + IDE routinely hold
 * 20–30% of RAM, so an 85% dial started every run already at the edge — 70
 * leaves honest headroom by default and the dial is right there for anyone
 * who wants more.
 */
export const DEFAULT_RAM_PERCENT = 70;
/**
 * Dial clamp. Below 10% nothing meaningful runs; above 95% there is no room for
 * the OS/page-cache to breathe before the kernel OOM-killer engages (the very
 * failure this dial exists to prevent).
 */
export const MIN_RAM_PERCENT = 10;
export const MAX_RAM_PERCENT = 95;
/**
 * Legacy absolute floor of the OS reserve (512 MiB) — kept as the minimum the
 * adaptive reserve can ever shrink to. On a desktop 512 MiB proved far too
 * thin (browser + compositor + 33 SSE streams), so the effective reserve is
 * now computed by {@link osReserveBytes}.
 */
export const MIN_OS_RESERVE_BYTES = 512 * 1024 * 1024;
const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

/**
 * RAM kept untouchable for the OS regardless of the dial:
 *
 *   reserve = max( min(2 GiB, 25% of total),  8% of total,  512 MiB )
 *
 * — 2 GiB on any desktop-sized machine (browser + desktop survive), scaling
 * down on small boxes (a 2 GiB host reserves 512 MiB, not everything) and up
 * on very large ones (8%). `HUU_OS_RESERVE_MB` overrides (clamped to at most
 * 90% of total so a typo can't zero the budget — degrade, never block).
 */
export function osReserveBytes(
  totalBytes: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return MIN_OS_RESERVE_BYTES;
  const raw = env.HUU_OS_RESERVE_MB?.trim();
  if (raw) {
    const mb = Number(raw);
    if (Number.isFinite(mb) && mb > 0) {
      return Math.min(Math.floor(mb * MIB), Math.floor(totalBytes * 0.9));
    }
  }
  return Math.max(
    Math.min(2 * GIB, totalBytes * 0.25),
    totalBytes * 0.08,
    MIN_OS_RESERVE_BYTES,
  );
}

/**
 * RAM a run costs BEFORE its first agent is counted (Node structures, repo
 * scan, worktree creation, SSE buffers). Charged against the byte headroom at
 * admission time, so a machine that can't even hold another run's fixed cost
 * stops admitting instead of discovering it one agent later.
 *
 * Lives here (not in a front-end) because every multi-run admission path needs
 * the same number: the web manager, the shared multi-run driver, and through it
 * the Ink TUI and `run-many`. `HUU_RUN_BASELINE_MB` overrides.
 */
export const DEFAULT_RUN_BASELINE_MB = 384;

export function runBaselineBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HUU_RUN_BASELINE_MB?.trim();
  if (raw) {
    const mb = Math.floor(Number(raw));
    if (Number.isFinite(mb) && mb > 0) {
      return Math.max(32, Math.min(16_384, mb)) * MIB;
    }
  }
  return DEFAULT_RUN_BASELINE_MB * MIB;
}

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
 * reserve` (adaptive — see {@link osReserveBytes}). Always >= 0. `pct` is
 * clamped defensively.
 *
 * `containerAware: true` skips the reserve ceiling: when `totalBytes` IS a
 * cgroup limit, the OS lives OUTSIDE the cgroup and the host-side wrapper
 * already subtracted the reserve when sizing `--memory` (docker-reexec) /
 * `MemoryMax` (cgroup-self-wrap) — re-subtracting it here double-charged the
 * reserve and capped high dials (≥86%) below what the user asked for. A
 * foreign limit (K8s, manual --memory) is itself the containment, and the
 * host stays protected by the live host-availability clamp
 * ({@link hostHeadroomBytes}).
 */
export function ramBudgetBytes(
  totalBytes: number,
  pct: number,
  opts?: { containerAware?: boolean },
): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  const byPercent = totalBytes * (clampPercent(pct) / 100);
  const ceiling = opts?.containerAware
    ? totalBytes
    : Math.max(0, totalBytes - osReserveBytes(totalBytes));
  return Math.max(0, Math.min(byPercent, ceiling));
}

/**
 * Live host-availability headroom: how many bytes huu may still claim before
 * the MACHINE (not the cgroup) runs out — `hostAvailable − the OS reserve`.
 *
 * Exists because the container cgroup is blind to every other host process: a
 * desktop's browser/IDE can eat 4–10 GiB that `memory.current` never shows,
 * and a container sized `--memory = hostTotal − reserve` will happily push the
 * whole host into swap/global-OOM without its own ceiling ever binding. The
 * clamp `min(budgetHeadroom, hostHeadroomBytes(...))` makes huu yield to the
 * rest of the machine instead. Reuses {@link osReserveBytes} so
 * `HUU_OS_RESERVE_MB` governs both the wrapper's --memory sizing and this
 * clamp consistently.
 *
 * Returns `null` (= no clamp, keep current behavior) when either input is
 * null/non-positive — /proc/meminfo unreadable (macOS, tests) — or when
 * `HUU_NO_HOST_CLAMP` is `1`/`true` (dedicated-host escape). Degrade, never
 * block.
 */
export function hostHeadroomBytes(
  hostAvailableBytes: number | null,
  hostTotalBytes: number | null,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  if (env.HUU_NO_HOST_CLAMP === '1' || env.HUU_NO_HOST_CLAMP === 'true') return null;
  if (
    hostAvailableBytes === null ||
    hostTotalBytes === null ||
    !Number.isFinite(hostAvailableBytes) ||
    !Number.isFinite(hostTotalBytes) ||
    hostAvailableBytes < 0 ||
    hostTotalBytes <= 0
  ) {
    return null;
  }
  return Math.max(0, hostAvailableBytes - osReserveBytes(hostTotalBytes, env));
}
