import { describe, expect, it } from 'vitest';
import {
  parseCgroupV2Path,
  renderRamDoctorText,
  resolveRamDoctorReport,
  type RamDoctorInputs,
} from './ram-doctor.js';

const GiB = 1024 ** 3;

function inputs(partial: Partial<RamDoctorInputs> = {}): RamDoctorInputs {
  return {
    env: {},
    totalBytes: 32 * GiB,
    webSettingsRamPercent: undefined,
    cgroupMemoryHighBytes: null,
    cgroupMemoryMaxBytes: null,
    swapTotalBytes: 16 * GiB,
    swapFreeBytes: 16 * GiB,
    psiSome10: 0.1,
    psiFull10: 0,
    ...partial,
  };
}

describe('resolveRamDoctorReport', () => {
  it('reports the default dial with source', () => {
    const r = resolveRamDoctorReport(inputs());
    expect(r.dialPercent).toBe(85);
    expect(r.dialSource).toBe('default');
    expect(r.budgetBytes).toBeGreaterThan(0);
    expect(r.reserveBytes).toBeCloseTo(32 * GiB * 0.08, -6);
  });

  it('web-settings dial wins and is labeled', () => {
    const r = resolveRamDoctorReport(inputs({ webSettingsRamPercent: 50 }));
    expect(r.dialPercent).toBe(50);
    expect(r.dialSource).toBe('web-settings');
  });

  it('env dial is labeled when no web setting exists', () => {
    const r = resolveRamDoctorReport(
      inputs({ env: { HUU_RAM_PERCENT: '60' } }),
    );
    expect(r.dialPercent).toBe(60);
    expect(r.dialSource).toBe('env');
  });

  it('lists only the HUU_* knobs actually set', () => {
    const r = resolveRamDoctorReport(
      inputs({ env: { HUU_NO_PAUSE: '1', HUU_GUARD_PSI_FULL_HIGH: '3', UNRELATED: 'x' } }),
    );
    expect(r.activeKnobs).toEqual(['HUU_NO_PAUSE', 'HUU_GUARD_PSI_FULL_HIGH']);
  });

  it('marks wrapped when inside a scope or container', () => {
    expect(resolveRamDoctorReport(inputs({ env: { HUU_CGROUP_WRAPPED: '1' } })).wrapped).toBe(true);
    expect(resolveRamDoctorReport(inputs({ env: { HUU_IN_CONTAINER: '1' } })).wrapped).toBe(true);
    expect(resolveRamDoctorReport(inputs()).wrapped).toBe(false);
  });
});

describe('parseCgroupV2Path', () => {
  it('extracts the v2 relative path', () => {
    expect(parseCgroupV2Path('0::/user.slice/user-1000.slice/huu-9.scope\n')).toBe(
      '/user.slice/user-1000.slice/huu-9.scope',
    );
  });
  it('returns null for v1-only or garbage content', () => {
    expect(parseCgroupV2Path('12:memory:/foo\n')).toBeNull();
    expect(parseCgroupV2Path('')).toBeNull();
  });
});

describe('renderRamDoctorText', () => {
  it('renders the kernel ceiling when present and flags its absence loudly', () => {
    const withCeiling = renderRamDoctorText(
      resolveRamDoctorReport(
        inputs({
          cgroupMemoryHighBytes: 29 * GiB,
          cgroupMemoryMaxBytes: 30 * GiB,
          env: { HUU_CGROUP_WRAPPED: '1' },
        }),
      ),
    ).join('\n');
    expect(withCeiling).toContain('high=29.0G');
    expect(withCeiling).toContain('max=30.0G');

    const bare = renderRamDoctorText(resolveRamDoctorReport(inputs())).join('\n');
    expect(bare).toContain('NONE — software guard only');
  });
});
