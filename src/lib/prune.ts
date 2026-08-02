import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CIDFILE_DIR, ORPHAN_LABEL } from './docker-reexec.js';

/**
 * `huu prune` — manual companion to the auto-prune that runs at the
 * start of every wrapper invocation.
 *
 * Auto-prune is conservative: it only kills containers whose recorded
 * parent PID is provably dead. That's the right default but it doesn't
 * help when:
 *   - The user wants to inspect what's still running ("did anything
 *     survive my last crash?")
 *   - Multiple huu sessions are racing and the user wants to clear
 *     the slate
 *   - A previous wrapper exited cleanly but its container kept running
 *     for some reason (kernel weirdness, docker daemon hiccup)
 *
 * This module is the explicit lever. It uses the same labels the
 * wrapper applies (ORPHAN_LABEL) and the same cidfile layout, so it
 * never touches containers it didn't create.
 */

export interface HuuContainer {
  id: string;
  /** Image reference. */
  image: string;
  /** Parent wrapper PID, parsed from the huu.parent-pid label. */
  parentPid: number | null;
  /** Whether the recorded parent PID is still alive on this host. */
  parentAlive: boolean;
  /** Container created-at, ISO8601 from `docker ps`. */
  createdAt: string;
  /** Status string from `docker ps`. */
  status: string;
}

export interface StaleCidfile {
  path: string;
  pid: number;
  cid: string | null;
}

/**
 * Run `docker ps --filter label=…` and parse the JSON-per-line output.
 * Returns an empty array on any failure (docker missing, daemon down,
 * permissions issue) — `huu prune` should always exit gracefully.
 */
export function findHuuContainers(): HuuContainer[] {
  const r = spawnSync(
    'docker',
    [
      'ps',
      '--all', // include exited but not yet --rm'd
      '--filter', `label=${ORPHAN_LABEL}`,
      '--format', '{{json .}}',
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0 || !r.stdout) return [];

  const out: HuuContainer[] = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as {
        ID?: string;
        Image?: string;
        Labels?: string;
        CreatedAt?: string;
        Status?: string;
      };
      if (!parsed.ID) continue;
      const labels = parseLabels(parsed.Labels ?? '');
      const parentPid = labels['huu.parent-pid']
        ? Number(labels['huu.parent-pid'])
        : null;
      out.push({
        id: parsed.ID,
        image: parsed.Image ?? '',
        parentPid: Number.isFinite(parentPid as number) ? (parentPid as number) : null,
        parentAlive: parentPid !== null ? isPidAlive(parentPid) : false,
        createdAt: parsed.CreatedAt ?? '',
        status: parsed.Status ?? '',
      });
    } catch {
      // Skip malformed lines — docker version skew or parser regression
      // shouldn't crash the prune command.
    }
  }
  return out;
}

/** Find cidfiles in CIDFILE_DIR whose parent PID is no longer alive. */
export function findStaleCidfiles(dir: string = CIDFILE_DIR): StaleCidfile[] {
  if (!existsSync(dir)) return [];
  const out: StaleCidfile[] = [];
  for (const name of readdirSync(dir)) {
    const m = /^cid-(\d+)-/.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!Number.isFinite(pid)) continue;
    if (isPidAlive(pid)) continue;
    const path = join(dir, name);
    let cid: string | null = null;
    try {
      cid = readFileSync(path, 'utf8').trim() || null;
    } catch {
      /* leave cid null */
    }
    out.push({ path, pid, cid });
  }
  return out;
}

/**
 * Return true if a process with the given PID exists. Uses
 * `process.kill(pid, 0)` which probes liveness without delivering a
 * signal. EPERM means the process exists but we can't signal it (still
 * alive). ESRCH means the process is gone.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseLabels(labelStr: string): Record<string, string> {
  // Docker's --format outputs labels as "k1=v1,k2=v2"
  const out: Record<string, string> = {};
  for (const part of labelStr.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/** Send SIGTERM to a container. Returns true on success. */
export function killContainer(cid: string): boolean {
  const r = spawnSync('docker', ['kill', '--signal', 'TERM', cid], { stdio: 'ignore' });
  return r.status === 0;
}

export interface RunPruneCliOptions {
  args: string[];
  /** Test seam — defaults to console.log. */
  stdout?: (line: string) => void;
  /** Test seam — defaults to console.error. */
  stderr?: (line: string) => void;
  /** Test seam — defaults to findHuuContainers / findStaleCidfiles / killContainer. */
  containerLister?: () => HuuContainer[];
  cidfileLister?: () => StaleCidfile[];
  killer?: (cid: string) => boolean;
  /** Test seam — defaults to unlinkSync. */
  unlinker?: (path: string) => void;
}

/**
 * CLI entry point.
 *
 * Flags:
 *   --list      Print containers + stale cidfiles, exit 0. No mutation.
 *   --dry-run   Print what `huu prune` WOULD kill, exit 0. No mutation.
 *   --json      Machine output (use with --list).
 *   (none)      Kill running huu containers and remove stale cidfiles.
 *
 * Exit codes:
 *   0 — success (or nothing to do)
 *   1 — docker unavailable or partial failure
 */
export function runPruneCli(options: RunPruneCliOptions): number {
  const stdout = options.stdout ?? ((l: string) => console.log(l));
  const stderr = options.stderr ?? ((l: string) => console.error(l));
  const lister = options.containerLister ?? findHuuContainers;
  const cidfileLister = options.cidfileLister ?? (() => findStaleCidfiles());
  const killer = options.killer ?? killContainer;
  const unlinker = options.unlinker ?? ((p: string) => unlinkSync(p));

  const list = options.args.includes('--list');
  const dryRun = options.args.includes('--dry-run');
  const json = options.args.includes('--json');

  const containers = lister();
  const cidfiles = cidfileLister();

  if (list || dryRun) {
    if (json) {
      stdout(JSON.stringify({ containers, staleCidfiles: cidfiles }, null, 2));
    } else {
      renderTextSummary(containers, cidfiles, dryRun, stdout);
    }
    return 0;
  }

  // Mutation path.
  if (containers.length === 0 && cidfiles.length === 0) {
    stdout('huu prune: no huu containers or stale cidfiles found.');
    return 0;
  }

  let failed = 0;
  for (const c of containers) {
    if (!killer(c.id)) {
      stderr(`huu prune: failed to kill ${c.id}`);
      failed++;
    } else {
      stdout(`huu prune: killed ${c.id.slice(0, 12)} (image=${c.image})`);
    }
  }
  for (const f of cidfiles) {
    try {
      unlinker(f.path);
      stdout(`huu prune: removed stale cidfile ${f.path}`);
    } catch {
      stderr(`huu prune: failed to remove ${f.path}`);
      failed++;
    }
  }
  return failed === 0 ? 0 : 1;
}

function renderTextSummary(
  containers: HuuContainer[],
  cidfiles: StaleCidfile[],
  dryRun: boolean,
  stdout: (line: string) => void,
): void {
  const verb = dryRun ? 'would kill' : 'found';
  if (containers.length === 0) {
    stdout('huu containers: (none)');
  } else {
    stdout(`huu containers (${verb} ${containers.length}):`);
    for (const c of containers) {
      const aliveTag = c.parentAlive ? '[parent alive]' : '[parent dead]';
      stdout(
        `  ${c.id.slice(0, 12)}  ${c.image}  ${c.status}  parent_pid=${c.parentPid ?? '?'}  ${aliveTag}`,
      );
    }
  }
  if (cidfiles.length === 0) {
    stdout('stale cidfiles: (none)');
  } else {
    stdout(`stale cidfiles (${verb} ${cidfiles.length}):`);
    for (const f of cidfiles) {
      stdout(`  ${f.path}  pid=${f.pid}  cid=${f.cid ?? '(unreadable)'}`);
    }
  }
}
