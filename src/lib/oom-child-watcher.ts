/**
 * OOM victim shaping for agent TOOL SUBPROCESSES (Fase 3.2 brought forward in
 * its cheap form). huu's agents run in-process, but their bash tools spawn
 * real children (vitest workers, npm installs, builds) that inherit huu's
 * protective oom_score_adj (−100) — so under kernel OOM the WHOLE tree is
 * equally protected and the kernel kills something else on the desktop.
 *
 * This watcher sweeps /proc every couple of seconds, finds huu's descendants
 * and RAISES their oom_score_adj to +500. Raising your own descendants' score
 * needs no privilege, and the effect is exactly the right failure mode: the
 * kernel sacrifices a test runner (surfacing as a tool failure → task retry)
 * instead of the orchestrator or the user's session.
 *
 * The pi SDK owns the spawns (no PID hook exists), so a PPID sweep over /proc
 * is the only attachment point until agents become subprocesses (Fase 3).
 * Best-effort throughout: every read/write failure is silently skipped —
 * processes die mid-sweep all the time. Linux-only; no-op elsewhere.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCAN_INTERVAL_MS = 2_000;
export const DEFAULT_CHILD_OOM_SCORE_ADJ = 500;

/**
 * Parse the ppid out of a /proc/<pid>/stat line. The comm field is inside
 * parentheses and may itself contain spaces/parens, so parse from the LAST
 * `)` — everything after it is space-separated, with state then ppid first.
 * Pure — unit-tested directly.
 */
export function parsePpidFromStat(stat: string): number | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  const rest = stat.slice(close + 1).trim().split(/\s+/);
  const ppid = Number(rest[1]);
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}

/** All transitive descendants of `rootPid` per one /proc sweep. */
export function collectDescendantPids(rootPid: number, procDir = '/proc'): number[] {
  const byParent = new Map<number, number[]>();
  let entries: string[];
  try {
    entries = readdirSync(procDir);
  } catch {
    return [];
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === rootPid) continue;
    try {
      const ppid = parsePpidFromStat(readFileSync(join(procDir, name, 'stat'), 'utf8'));
      if (ppid === null) continue;
      const kids = byParent.get(ppid);
      if (kids) kids.push(pid);
      else byParent.set(ppid, [pid]);
    } catch {
      /* process vanished mid-sweep — normal */
    }
  }
  const out: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const kids = byParent.get(queue.shift()!) ?? [];
    for (const kid of kids) {
      out.push(kid);
      queue.push(kid);
    }
  }
  return out;
}

/** Resolve the child score from HUU_CHILD_OOM_SCORE_ADJ (0 disables). */
export function resolveChildOomScoreAdj(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HUU_CHILD_OOM_SCORE_ADJ?.trim();
  if (!raw) return DEFAULT_CHILD_OOM_SCORE_ADJ;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_CHILD_OOM_SCORE_ADJ;
  // Children may only be made MORE killable than huu — clamp to [0, 1000].
  return Math.max(0, Math.min(1000, Math.round(n)));
}

/**
 * One sweep: raise every not-yet-adjusted descendant's oom_score_adj.
 * `adjusted` carries state between sweeps (pruned of gone pids). Exposed for
 * tests; production runs it on the interval from startOomChildWatcher.
 */
export function sweepOnce(
  rootPid: number,
  adjusted: Set<number>,
  scoreAdj: number,
  procDir = '/proc',
): void {
  const descendants = collectDescendantPids(rootPid, procDir);
  const live = new Set(descendants);
  for (const pid of [...adjusted]) if (!live.has(pid)) adjusted.delete(pid);
  for (const pid of descendants) {
    if (adjusted.has(pid)) continue;
    try {
      writeFileSync(join(procDir, String(pid), 'oom_score_adj'), `${scoreAdj}\n`);
      adjusted.add(pid);
    } catch {
      /* gone, or not ours — skip */
    }
  }
}

/**
 * Start the watcher (Linux only; returns a stop function — a no-op elsewhere
 * or when disabled via HUU_CHILD_OOM_SCORE_ADJ=0). Unref'd timer: never keeps
 * the process alive.
 */
export function startOomChildWatcher(
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  if (process.platform !== 'linux') return () => {};
  const scoreAdj = resolveChildOomScoreAdj(env);
  if (scoreAdj === 0) return () => {};
  const adjusted = new Set<number>();
  const timer = setInterval(
    () => sweepOnce(process.pid, adjusted, scoreAdj),
    SCAN_INTERVAL_MS,
  );
  timer.unref?.();
  return () => clearInterval(timer);
}
