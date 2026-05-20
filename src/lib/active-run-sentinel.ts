import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Side-channel that records the cwd of an active TUI run.
 *
 * Why this exists: Docker HEALTHCHECK probes execute as fresh processes
 * starting from `/`, not from the container's WORKDIR. Without a way
 * to discover where the user mounted their repo, the probe can't find
 * `<repo>/.huu/debug-*.log` and `huu status` would always say "no log
 * found" — defeating the entire health story.
 *
 * The sentinel is a single line of text at SENTINEL_PATH containing
 * the absolute path of the repo the active `huu` process is operating
 * on. The TUI launcher writes it after debug-logger init and removes
 * it on exit. The HEALTHCHECK shell glue cd's there before invoking
 * `huu status --liveness`.
 *
 * /tmp is the right home: tmpfs-backed inside containers (no spurious
 * persistence across container lifetimes), world-writable thanks to
 * the sticky bit (works for any --user UID), and not part of the
 * user's repo (so a `huu init-docker` against a clean repo doesn't
 * leave artifacts).
 *
 * Best-effort throughout — if /tmp is read-only or the unlink races
 * with another exit handler, the run still proceeds. The sentinel is
 * an aid, not a contract.
 */

export const SENTINEL_PATH = '/tmp/huu/active';

export interface ActiveRunSentinel {
  cwd: string;
  /** PID of the huu process that wrote the sentinel. Optional for legacy
   * sentinels written before the PID field existed (single-line format). */
  pid?: number;
}

/**
 * Write the sentinel pointing at `cwd`, recording the writer's PID for
 * stale detection. Returns true on success.
 *
 * Format: line 1 = cwd, line 2 = pid. Legacy single-line readers (the
 * HEALTHCHECK shell `cat` glue) just see the cwd on line 1 and ignore
 * the PID — backward compatible.
 */
export function writeActiveRunSentinel(
  cwd: string,
  path: string = SENTINEL_PATH,
  pid: number = process.pid,
): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o777 });
    writeFileSync(path, `${cwd}\n${pid}\n`, { mode: 0o644 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the sentinel if it exists and points at `cwd`. The cwd guard
 * prevents one huu process from clobbering another's sentinel — if two
 * runs raced and the second wrote a different cwd, the first's exit
 * handler shouldn't blow away the second's pointer.
 */
export function clearActiveRunSentinel(
  cwd: string,
  path: string = SENTINEL_PATH,
): void {
  try {
    if (!existsSync(path)) return;
    const meta = parseSentinelContent(readFileSync(path, 'utf8'));
    if (meta?.cwd === cwd) unlinkSync(path);
  } catch {
    /* best effort */
  }
}

/**
 * Read the sentinel and return the recorded cwd, or null if not set.
 * Used by tests; the HEALTHCHECK does its own `cat` in shell.
 */
export function readActiveRunSentinel(path: string = SENTINEL_PATH): string | null {
  return readActiveRunSentinelMeta(path)?.cwd ?? null;
}

/**
 * Read the sentinel and return both cwd and pid (when available). Returns
 * null when the sentinel is absent or unreadable. The `pid` is `undefined`
 * for legacy single-line sentinels written before this format.
 */
export function readActiveRunSentinelMeta(
  path: string = SENTINEL_PATH,
): ActiveRunSentinel | null {
  try {
    if (!existsSync(path)) return null;
    return parseSentinelContent(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Probe whether the recorded PID is still alive. `signal 0` doesn't kill
 * the process — it just returns success/failure based on existence and
 * permission. Returns:
 *   - 'alive'    — PID exists and we have permission to signal it
 *   - 'dead'     — PID does not exist (sentinel is stale)
 *   - 'unknown'  — sentinel has no PID, or we lack permission to probe
 */
export function probeActiveRunLiveness(
  path: string = SENTINEL_PATH,
): 'alive' | 'dead' | 'unknown' {
  const meta = readActiveRunSentinelMeta(path);
  if (!meta || meta.pid === undefined) return 'unknown';
  try {
    process.kill(meta.pid, 0);
    return 'alive';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'dead';
    // EPERM means the PID exists but belongs to another user — alive.
    if (code === 'EPERM') return 'alive';
    return 'unknown';
  }
}

function parseSentinelContent(raw: string): ActiveRunSentinel | null {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const cwd = lines[0]!;
  const pidStr = lines[1];
  const pid = pidStr !== undefined && /^\d+$/.test(pidStr) ? Number(pidStr) : undefined;
  return pid === undefined ? { cwd } : { cwd, pid };
}
