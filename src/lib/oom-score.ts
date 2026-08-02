/**
 * Linux OOM-killer victim biasing for the huu process. Writing a NEGATIVE value
 * to `/proc/self/oom_score_adj` makes the kernel prefer to kill OTHER processes
 * first; a positive value makes this process a more likely victim.
 *
 * Configurable via `HUU_OOM_SCORE_ADJ`; the default is CONSERVATIVE (a mild
 * nudge that does NOT immunize the process). Full immunization (-1000) is unsafe
 * in the current single-process design — if huu can never be killed, the kernel
 * sacrifices something else on the machine — so it is intentionally NOT the
 * default; it becomes safe in Fase 3 once agents are subprocesses with their own
 * (higher) oom_score_adj as the legitimate victims.
 *
 * Pure + leaf (`src/lib`). `applyOomScoreAdj()` is best-effort: it is a no-op
 * off-Linux and silently does nothing when the write is not permitted (a
 * non-root process can only RAISE its own oom_score_adj, so a negative value
 * requires CAP_SYS_RESOURCE — it sticks in the root container, no-ops natively).
 */

import { writeFileSync } from 'node:fs';

/** Mild protection that does not immunize. */
export const DEFAULT_OOM_SCORE_ADJ = -100;
export const MIN_OOM_SCORE_ADJ = -1000;
export const MAX_OOM_SCORE_ADJ = 1000;

/**
 * Resolve the desired oom_score_adj from `HUU_OOM_SCORE_ADJ`, else the
 * conservative default. Non-finite / empty input falls back to the default;
 * the result is clamped to the kernel's valid range. Never throws.
 */
export function computeOomScoreAdj(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.HUU_OOM_SCORE_ADJ;
  if (raw === undefined || raw.trim() === '') return DEFAULT_OOM_SCORE_ADJ;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_OOM_SCORE_ADJ;
  return Math.max(MIN_OOM_SCORE_ADJ, Math.min(MAX_OOM_SCORE_ADJ, Math.round(n)));
}

/**
 * Apply the resolved oom_score_adj to THIS process (best-effort). Returns the
 * value written, or null when skipped (non-Linux) or not permitted. Never
 * throws — a failure here must not block startup (degrade, never block).
 */
export function applyOomScoreAdj(
  env: Record<string, string | undefined> = process.env,
): number | null {
  if (process.platform !== 'linux') return null;
  const value = computeOomScoreAdj(env);
  try {
    writeFileSync('/proc/self/oom_score_adj', `${value}\n`);
    return value;
  } catch {
    // No permission (non-root can't go negative) / not writable — best-effort.
    return null;
  }
}
