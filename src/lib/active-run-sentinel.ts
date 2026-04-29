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

/** Write the sentinel pointing at `cwd`. Returns true on success. */
export function writeActiveRunSentinel(cwd: string, path: string = SENTINEL_PATH): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o777 });
    writeFileSync(path, cwd + '\n', { mode: 0o644 });
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
    const current = readFileSync(path, 'utf8').trim();
    if (current === cwd) unlinkSync(path);
  } catch {
    /* best effort */
  }
}

/**
 * Read the sentinel and return the recorded cwd, or null if not set.
 * Used by tests; the HEALTHCHECK does its own `cat` in shell.
 */
export function readActiveRunSentinel(path: string = SENTINEL_PATH): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
