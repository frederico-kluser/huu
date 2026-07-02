/**
 * Self-cgroup wrap (ROADMAP Fase 2.1) — the KERNEL guarantee that the host
 * never freezes, no matter how wrong the software layers above are.
 *
 * On a NATIVE Linux run (the incident path: `HUU_NO_DOCKER=1` + web UI) huu
 * re-execs itself inside a transient systemd USER scope with:
 *
 *   MemoryHigh = total − OS reserve   → past this line the kernel THROTTLES
 *     huu's whole tree (agents + tool subprocesses) into direct reclaim
 *     instead of letting it push the host into swap-thrash — the desktop
 *     stays responsive while huu's own PSI spikes and the pressure ladder
 *     sheds agents (the senpai/TMO feedback loop, now kernel-backed).
 *   MemoryMax  = total − reserve/2    → final belt: the worst case becomes
 *     "the kernel OOM-kills huu inside its scope" instead of "the host dies".
 *   MemorySwapMax (default 4 GiB)     → bounds how much thrash huu's tree can
 *     inflict via swap before memory.high pressure takes over.
 *   TasksMax                          → runaway-fork backstop.
 *
 * The scope is sized from the OS RESERVE (host protection), NOT from the RAM
 * dial: the dial is the internal utilization target the scheduler enforces and
 * can be re-tuned live, while the scope is the safety line set once at boot.
 * huu's resource-monitor is already cgroup-aware, so once wrapped the sampler
 * automatically reads the scope's memory.max/current/pressure — budget math
 * and the PSI controller become scope-relative with zero extra wiring.
 *
 * Everything degrades, never blocks: no systemd / no user bus / non-Linux /
 * `HUU_NO_CGROUP=1` → run unwrapped exactly as before, with a one-line note.
 */

import { spawn, spawnSync } from 'node:child_process';
import { totalmem } from 'node:os';
import { osReserveBytes } from './budget.js';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Subcommands too short-lived to be worth a scope (mirrors the docker gate). */
const SKIP_SUBCOMMANDS = new Set(['init-docker', 'status', 'prune']);

export interface CgroupWrapDecision {
  shouldWrap: boolean;
  reason: string;
}

/**
 * Decide whether this invocation should wrap itself in a systemd scope.
 * Pure — tests drive every branch directly.
 */
export function decideCgroupWrap(
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): CgroupWrapDecision {
  if (platform !== 'linux') {
    return { shouldWrap: false, reason: 'cgroups are Linux-only' };
  }
  if (env.HUU_CGROUP_WRAPPED === '1') {
    return { shouldWrap: false, reason: 'already inside the huu scope' };
  }
  if (env.HUU_NO_CGROUP === '1' || env.HUU_NO_CGROUP === 'true') {
    return { shouldWrap: false, reason: 'HUU_NO_CGROUP set — no kernel memory ceiling' };
  }
  if (env.HUU_IN_CONTAINER === '1') {
    return { shouldWrap: false, reason: 'inside the container (docker --memory owns the ceiling)' };
  }
  if (args.includes('--help') || args.includes('-h')) {
    return { shouldWrap: false, reason: 'help flag — pure print' };
  }
  const firstNonFlag = args.find((a) => !a.startsWith('-'));
  if (firstNonFlag && SKIP_SUBCOMMANDS.has(firstNonFlag)) {
    return { shouldWrap: false, reason: `${firstNonFlag} is short-lived` };
  }
  return { shouldWrap: true, reason: 'native Linux run — kernel memory ceiling via systemd scope' };
}

export interface CgroupLimits {
  memoryHighBytes: number;
  memoryMaxBytes: number;
  memorySwapMaxBytes: number;
  tasksMax: number;
}

/**
 * Size the scope from the OS reserve. `HUU_SWAP_MAX_MB` bounds the scope's
 * swap use (default 4096 MiB; 0 = no swap for huu at all).
 */
export function computeCgroupLimits(
  totalBytes: number = totalmem(),
  env: NodeJS.ProcessEnv = process.env,
): CgroupLimits {
  const reserve = osReserveBytes(totalBytes, env);
  const high = Math.max(512 * MIB, Math.floor(totalBytes - reserve));
  const max = Math.max(high, Math.floor(totalBytes - reserve / 2));
  const rawSwap = Number(env.HUU_SWAP_MAX_MB?.trim() || NaN);
  const swapMb = Number.isFinite(rawSwap) && rawSwap >= 0 ? Math.floor(rawSwap) : 4096;
  return {
    memoryHighBytes: high,
    memoryMaxBytes: max,
    memorySwapMaxBytes: Math.min(swapMb * MIB, 64 * GIB),
    tasksMax: 8192,
  };
}

/**
 * The systemd-run argv (array form, no shell). `--scope` keeps huu in the
 * foreground on the caller's terminal; `--collect` garbage-collects a failed
 * unit so a crash doesn't leave residue in `systemctl --user`.
 */
export function buildSystemdRunArgv(
  limits: CgroupLimits,
  unitName: string,
  command: string[],
): string[] {
  return [
    '--user',
    '--scope',
    '--quiet',
    '--collect',
    `--unit=${unitName}`,
    '-p',
    'MemoryAccounting=yes',
    '-p',
    `MemoryHigh=${limits.memoryHighBytes}`,
    '-p',
    `MemoryMax=${limits.memoryMaxBytes}`,
    '-p',
    `MemorySwapMax=${limits.memorySwapMaxBytes}`,
    '-p',
    `TasksMax=${limits.tasksMax}`,
    '--',
    ...command,
  ];
}

/**
 * Cheap definitive probe: can this user start a transient scope WITH OUR
 * EXACT PROPERTY SET right now? Runs `true` in a throwaway scope carrying the
 * same -p properties as the real wrap — ~tens of ms, once per boot, native
 * path only. Probing with the full set matters: on older systemd,
 * `MemorySwapMax` is an UNKNOWN property and systemd-run errors out entirely
 * (systemd#7505) — a bare probe would pass while the real wrap died, turning
 * a should-degrade situation into a hard startup failure.
 */
export function probeSystemdRun(limits: CgroupLimits = computeCgroupLimits()): boolean {
  try {
    const r = spawnSync(
      'systemd-run',
      buildSystemdRunArgv(limits, `huu-probe-${process.pid}`, ['true']),
      { stdio: 'ignore', timeout: 5_000 },
    );
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Re-exec the CURRENT invocation inside the scope. Returns the child's exit
 * code, or null when systemd isn't usable (caller continues unwrapped —
 * degrade, never block). The child sees HUU_CGROUP_WRAPPED=1 so the gate
 * short-circuits on the second pass.
 */
export async function reexecInCgroupScope(): Promise<number | null> {
  const limits = computeCgroupLimits();
  if (!probeSystemdRun(limits)) return null;
  const unitName = `huu-${process.pid}`;
  // execPath + execArgv reproduce loader flags (tsx dev runs, --import hooks).
  const command = [process.execPath, ...process.execArgv, ...process.argv.slice(1)];
  const argv = buildSystemdRunArgv(limits, unitName, command);
  process.stderr.write(
    `huu: kernel memory ceiling on — systemd scope ${unitName}.scope ` +
      `(MemoryHigh ${(limits.memoryHighBytes / GIB).toFixed(1)}G, ` +
      `MemoryMax ${(limits.memoryMaxBytes / GIB).toFixed(1)}G, ` +
      `swap ≤ ${(limits.memorySwapMaxBytes / GIB).toFixed(1)}G). ` +
      `Disable with HUU_NO_CGROUP=1.\n`,
  );
  return await new Promise<number | null>((resolve) => {
    const child = spawn('systemd-run', argv, {
      stdio: 'inherit',
      env: { ...process.env, HUU_CGROUP_WRAPPED: '1' },
    });
    child.on('error', () => resolve(null));
    child.on('exit', (code, signal) => {
      resolve(signal ? 128 + 15 : (code ?? 0));
    });
  });
}
