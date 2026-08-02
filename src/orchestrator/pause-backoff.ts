/**
 * Anti-churn backoff for memory-guard PAUSED tasks (Fase 2.3 follow-up).
 *
 * Under sustained pressure a resumed task can be re-victimized immediately —
 * a pause↔resume loop where every cycle re-issues the in-flight LLM turn
 * (re-hydration is not free) without the machine having actually recovered.
 * The backoff makes a paused task ineligible for re-spawn until an
 * exponentially growing window since its `pausedAt` has elapsed:
 *
 *   wait = min(baseMs × 2^(pauses−1), capMs)
 *
 * Deliberately NO cap on the number of pauses: a kill-after-N would discard
 * preserved work that a full machine couldn't progress anyway — the backoff
 * only paces the retries, liveness comes from the pool's poll tick observing
 * expiry. `HUU_PAUSE_BACKOFF_MS=0` disables (restores immediate re-spawn);
 * garbage values degrade to the default, never block.
 *
 * Pure module (injected `nowMs`) — the orchestrator wires it into the single
 * pending-task pull site.
 */

export const DEFAULT_PAUSE_BACKOFF_BASE_MS = 10_000;
export const DEFAULT_PAUSE_BACKOFF_CAP_MS = 120_000;

/** The full backoff window for the Nth pause. 0 when disabled or no pauses. */
export function pauseBackoffMs(pauses: number, baseMs: number, capMs: number): number {
  if (baseMs <= 0 || pauses <= 0) return 0;
  // Clamp the exponent so a pathological pause count can't overflow to
  // Infinity before the cap applies.
  const exponent = Math.min(pauses - 1, 30);
  return Math.min(baseMs * 2 ** exponent, Math.max(baseMs, capMs));
}

/**
 * Deterministic anti-herd jitter factor in [1, 1.5) — UP-ONLY, so the
 * documented window stays a floor (lower-bound assertions and "resumes after
 * at least N ms" semantics hold). Why it exists: a host-pressure storm pauses
 * EVERY run's agents within the same second with the SAME pauses count, so an
 * un-jittered exponential backoff expires them together and the thundering
 * herd re-forms, merely phase-shifted (the 8-project incident: pause-all →
 * resume-all → re-pause-all in 15 s cycles). Keying by `runId#agentId#pauses`
 * spreads the herd deterministically (testable, resume-order stable) — every
 * task gets a different, stable factor and consecutive pauses of the same
 * task decorrelate too. FNV-1a over the key.
 */
export function pauseBackoffJitterFactor(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 1 + (h % 1000) / 2000; // [1, 1.4995]
}

/**
 * Remaining wait before a PAUSED task may be re-pulled from the pending
 * queue. 0 (eligible now) when: the backoff is disabled, the card is missing,
 * the card is not in the `paused` phase (kill-requeues and user retries use
 * `pending` — never delayed), there is no `pausedAt` stamp, or the window has
 * already elapsed. `jitterKey` (recommended: `${runId}#${agentId}`) engages
 * the anti-herd jitter — the effective window becomes
 * `min(base×2^(pauses−1), cap) × [1, 1.5)`; deliberately applied AFTER the
 * cap, else every long-backing-off task would collapse onto the same cap
 * value and re-synchronize.
 */
export function pauseBackoffRemainingMs(
  card: { phase?: string; pauses?: number; pausedAt?: number } | undefined,
  nowMs: number,
  baseMs: number,
  capMs: number,
  jitterKey?: string,
): number {
  if (baseMs <= 0) return 0;
  if (!card || card.phase !== 'paused') return 0;
  const pausedAt = card.pausedAt;
  if (pausedAt === undefined || !Number.isFinite(pausedAt)) return 0;
  const pauses = card.pauses ?? 1;
  const jitter = jitterKey ? pauseBackoffJitterFactor(`${jitterKey}#${pauses}`) : 1;
  const wait = Math.round(pauseBackoffMs(pauses, baseMs, capMs) * jitter);
  return Math.max(0, pausedAt + wait - nowMs);
}

/** `HUU_PAUSE_BACKOFF_MS`: unset/garbage → default; `0` disables; N → N ms. */
export function parsePauseBackoffBaseMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PAUSE_BACKOFF_BASE_MS;
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_PAUSE_BACKOFF_BASE_MS;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PAUSE_BACKOFF_BASE_MS;
  return Math.floor(n);
}
