/**
 * `huu status` doctor section for RAM containment — answers, at a glance:
 * which dial is in force (and where it came from), how much the budget really
 * is in bytes, whether a KERNEL ceiling (systemd scope / container cgroup) is
 * active, and what the pressure signals look like right now. Born from the
 * 33-run incident, where the user had NO way to tell whether the 50% dial had
 * taken effect at all.
 *
 * Shape follows pi-doctor: a PURE core (`resolveRamDoctorReport`) with every
 * fs/env input injected — unit-testable — plus one impure gatherer and a text
 * renderer. Everything degrades to nulls instead of throwing.
 */

import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import {
  DEFAULT_RAM_PERCENT,
  clampPercent,
  osReserveBytes,
  ramBudgetBytes,
} from './budget.js';
import { loadWebSettings } from './web-settings.js';
import { SystemMetricsSampler } from './resource-monitor.js';

const GIB = 1024 ** 3;

export interface RamDoctorReport {
  dialPercent: number;
  dialSource: 'web-settings' | 'env' | 'default';
  totalBytes: number;
  reserveBytes: number;
  budgetBytes: number;
  /** Kernel ceiling on the CURRENT cgroup (systemd scope or container). */
  cgroupMemoryHighBytes: number | null;
  cgroupMemoryMaxBytes: number | null;
  wrapped: boolean;
  swapTotalBytes: number;
  swapFreeBytes: number;
  psiSome10: number | null;
  psiFull10: number | null;
  /** RAM-safety HUU_* knobs currently set (names only). */
  activeKnobs: string[];
}

export interface RamDoctorInputs {
  env: NodeJS.ProcessEnv;
  totalBytes: number;
  webSettingsRamPercent: number | undefined;
  cgroupMemoryHighBytes: number | null;
  cgroupMemoryMaxBytes: number | null;
  swapTotalBytes: number;
  swapFreeBytes: number;
  psiSome10: number | null;
  psiFull10: number | null;
}

const KNOB_NAMES = [
  'HUU_RAM_PERCENT',
  'HUU_OS_RESERVE_MB',
  'HUU_AGENT_MEM_SEED_MB',
  'HUU_AGENT_MEM_EMA_ALPHA',
  'HUU_NO_PAUSE',
  'HUU_NO_CGROUP',
  'HUU_NO_MEM_LIMIT',
  'HUU_SWAP_MAX_MB',
  'HUU_MAX_LIVE_RUNS',
  'HUU_MAX_QUEUED_RUNS',
  'HUU_RUN_BASELINE_MB',
  'HUU_CHILD_OOM_SCORE_ADJ',
  'HUU_OOM_SCORE_ADJ',
  'HUU_GUARD_AVAIL_PCT',
  'HUU_GUARD_SWAP_FREE_PCT',
  'HUU_GUARD_AVAIL_PCT_EMERGENCY',
  'HUU_GUARD_SWAP_FREE_PCT_EMERGENCY',
  'HUU_GUARD_PSI_FULL_HIGH',
  'HUU_GUARD_PSI_FULL_EMERGENCY',
  'HUU_GUARD_SWAPIN_PAGES_SEC',
  'HUU_GUARD_SWAPIN_SUSTAIN_MS',
  'HUU_GUARD_OVER_BUDGET_MS',
  'HUU_GUARD_DESTROY_PCT',
  'HUU_GUARD_L1_REPREEMPT_MS',
];

/** PURE: derive the report from injected inputs — no fs/env reads. */
export function resolveRamDoctorReport(inputs: RamDoctorInputs): RamDoctorReport {
  const fromWeb = inputs.webSettingsRamPercent;
  const envRaw = inputs.env.HUU_RAM_PERCENT?.trim();
  const envPct = envRaw && Number.isFinite(Number(envRaw)) ? Number(envRaw) : undefined;
  let dialPercent: number;
  let dialSource: RamDoctorReport['dialSource'];
  if (fromWeb !== undefined) {
    dialPercent = clampPercent(fromWeb);
    dialSource = 'web-settings';
  } else if (envPct !== undefined) {
    dialPercent = clampPercent(envPct);
    dialSource = 'env';
  } else {
    dialPercent = DEFAULT_RAM_PERCENT;
    dialSource = 'default';
  }
  return {
    dialPercent,
    dialSource,
    totalBytes: inputs.totalBytes,
    reserveBytes: osReserveBytes(inputs.totalBytes, inputs.env),
    budgetBytes: ramBudgetBytes(inputs.totalBytes, dialPercent),
    cgroupMemoryHighBytes: inputs.cgroupMemoryHighBytes,
    cgroupMemoryMaxBytes: inputs.cgroupMemoryMaxBytes,
    wrapped: inputs.env.HUU_CGROUP_WRAPPED === '1' || inputs.env.HUU_IN_CONTAINER === '1',
    swapTotalBytes: inputs.swapTotalBytes,
    swapFreeBytes: inputs.swapFreeBytes,
    psiSome10: inputs.psiSome10,
    psiFull10: inputs.psiFull10,
    activeKnobs: KNOB_NAMES.filter((k) => (inputs.env[k]?.trim() ?? '') !== ''),
  };
}

/**
 * Parse the cgroup v2 relative path out of /proc/self/cgroup ("0::<path>").
 * Pure — unit-tested directly.
 */
export function parseCgroupV2Path(text: string): string | null {
  const m = /^0::(.+)$/m.exec(text);
  return m ? m[1]!.trim() : null;
}

/** Read a cgroup memory limit file: number of bytes, or null ("max"/absent). */
function readCgroupLimit(file: string): number | null {
  try {
    const raw = readFileSync(file, 'utf8').trim();
    if (raw === 'max') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** IMPURE: read the machine + the current cgroup's memory limits. */
export function gatherRamDoctorInputs(): Omit<RamDoctorInputs, 'env'> {
  const m = new SystemMetricsSampler().sample();
  let high: number | null = null;
  let max: number | null = null;
  try {
    const rel = parseCgroupV2Path(readFileSync('/proc/self/cgroup', 'utf8'));
    if (rel) {
      high = readCgroupLimit(`/sys/fs/cgroup${rel}/memory.high`);
      max = readCgroupLimit(`/sys/fs/cgroup${rel}/memory.max`);
    }
  } catch {
    /* off-Linux / cgroup v1 — no kernel ceiling to report */
  }
  return {
    totalBytes: totalmem(),
    webSettingsRamPercent: loadWebSettings().ramPercent,
    cgroupMemoryHighBytes: high,
    cgroupMemoryMaxBytes: max,
    swapTotalBytes: m.swapTotalBytes,
    swapFreeBytes: m.swapFreeBytes,
    psiSome10: m.memPressureSome10,
    psiFull10: m.memPressureFull10,
  };
}

const gib = (b: number): string => `${(b / GIB).toFixed(1)}G`;

export function renderRamDoctorText(r: RamDoctorReport): string[] {
  const lines: string[] = [];
  lines.push('  ram containment:');
  lines.push(
    `    dial:        ${r.dialPercent}% of ${gib(r.totalBytes)} → budget ${gib(r.budgetBytes)} (source: ${r.dialSource}; OS reserve ${gib(r.reserveBytes)})`,
  );
  const ceiling =
    r.cgroupMemoryHighBytes !== null || r.cgroupMemoryMaxBytes !== null
      ? `high=${r.cgroupMemoryHighBytes !== null ? gib(r.cgroupMemoryHighBytes) : 'max'} max=${r.cgroupMemoryMaxBytes !== null ? gib(r.cgroupMemoryMaxBytes) : 'max'}`
      : 'NONE — software guard only';
  lines.push(`    kernel:      ${ceiling}${r.wrapped ? '' : ' (unwrapped process)'}`);
  const psi =
    r.psiSome10 === null
      ? 'unavailable'
      : `some ${r.psiSome10.toFixed(2)}% / full ${r.psiFull10?.toFixed(2) ?? '0.00'}%`;
  lines.push(
    `    pressure:    PSI ${psi} · swap free ${gib(r.swapFreeBytes)} of ${gib(r.swapTotalBytes)}`,
  );
  if (r.activeKnobs.length > 0) {
    lines.push(`    knobs:       ${r.activeKnobs.join(', ')}`);
  }
  return lines;
}
