import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sweeps orphan `inuse.<pid>.lock` files in a Copilot session-state
 * directory before we open a session there. Defends against issue
 * copilot-cli/2609 where SIGTERM during a session leaves a lock
 * with a now-dead PID, and the next createSession hangs on the
 * mutex forever.
 *
 * The community workaround (paperclip's adapter and several issue
 * comments): for each `inuse.<pid>.lock` file, send signal 0 to the
 * PID. If the PID is gone (`kill -0` errors with ESRCH), unlink the
 * lock. Bounded — at most a few files; cheap.
 *
 * No-op when the directory doesn't exist (first run or fresh worktree).
 * Errors are swallowed individually so one stuck file doesn't prevent
 * sweeping the rest.
 *
 * Returns the count of locks removed (for diagnostics / testing).
 */
export function sweepOrphanLocks(sessionStateDir: string): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(sessionStateDir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    // Each session subdir may contain its own locks.
    const sessionDir = join(sessionStateDir, entry);
    let isDir = false;
    try {
      isDir = statSync(sessionDir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    let inner: string[];
    try {
      inner = readdirSync(sessionDir);
    } catch {
      continue;
    }
    for (const file of inner) {
      const m = /^inuse\.(\d+)\.lock$/.exec(file);
      if (!m) continue;
      const pid = Number(m[1]);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      if (isPidAlive(pid)) continue;
      try {
        unlinkSync(join(sessionDir, file));
        removed++;
      } catch {
        /* best effort — another huu process may have already removed it */
      }
    }
  }
  return removed;
}

/**
 * `process.kill(pid, 0)` returns silently if the PID exists and is
 * killable by us, throws ESRCH if it doesn't exist, EPERM if it
 * exists but belongs to another user. EPERM means alive (we just
 * can't signal it) — keep the lock. ESRCH means dead — sweep.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    // Unknown errno — be conservative and assume alive (don't unlink).
    return true;
  }
}
