import { describe, expect, it } from 'vitest';
import {
  noKernelCeilingWarning,
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
    hostMemTotalBytes: null,
    hostMemAvailableBytes: null,
    ...partial,
  };
}

describe('resolveRamDoctorReport', () => {
  it('reports the default dial with source', () => {
    const r = resolveRamDoctorReport(inputs());
    expect(r.dialPercent).toBe(70);
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

describe('host line + docker preview (host-aware accounting)', () => {
  it('reports the host claimable figure and the docker --memory preview', () => {
    const r = resolveRamDoctorReport(
      inputs({
        totalBytes: 16 * GiB,
        hostMemTotalBytes: 16 * GiB,
        hostMemAvailableBytes: 9.2 * GiB,
      }),
    );
    // reserve(16 GiB) = 2 GiB → claimable 7.2 GiB.
    expect(r.hostClaimableBytes).toBeCloseTo(7.2 * GiB, -6);
    expect(r.dockerMemoryBytes).toBe(Math.floor(16 * GiB - 2 * GiB));
    // In-container budget: dial% of the --memory ceiling, NO double reserve.
    expect(r.containerBudgetBytes).toBeCloseTo((16 * GiB - 2 * GiB) * 0.7, -6);

    const text = renderRamDoctorText(r).join('\n');
    expect(text).toContain('host:');
    expect(text).toContain('available 9.2G');
    expect(text).toContain('docker:');
    expect(text).toContain('--memory would be 14.0G');
  });

  it('renders the disabled-docker-ceiling line and a null host pair silently', () => {
    const r = resolveRamDoctorReport(inputs({ env: { HUU_NO_MEM_LIMIT: '1' } }));
    expect(r.dockerMemoryBytes).toBeNull();
    const text = renderRamDoctorText(r).join('\n');
    expect(text).toContain('--memory DISABLED');
    expect(text).not.toContain('host:'); // host pair null → no host line
  });

  it('HUU_NO_HOST_CLAMP renders the clamp as disabled', () => {
    const r = resolveRamDoctorReport(
      inputs({
        env: { HUU_NO_HOST_CLAMP: '1' },
        hostMemTotalBytes: 16 * GiB,
        hostMemAvailableBytes: 9 * GiB,
      }),
    );
    expect(r.hostClaimableBytes).toBeNull();
    expect(renderRamDoctorText(r).join('\n')).toContain('host clamp disabled');
  });
});

describe('noKernelCeilingWarning (gap B)', () => {
  it('fires only inside the container without a cgroup ceiling', () => {
    expect(
      noKernelCeilingWarning({ containerAware: false }, { HUU_IN_CONTAINER: '1' }),
    ).toContain('no kernel RAM ceiling');
    expect(noKernelCeilingWarning({ containerAware: true }, { HUU_IN_CONTAINER: '1' })).toBeNull();
    expect(noKernelCeilingWarning({ containerAware: false }, {})).toBeNull(); // native
  });

  it('names the cause', () => {
    expect(
      noKernelCeilingWarning(
        { containerAware: false },
        { HUU_IN_CONTAINER: '1', HUU_NO_MEM_LIMIT: '1' },
      ),
    ).toContain('HUU_NO_MEM_LIMIT=1');
    expect(
      noKernelCeilingWarning({ containerAware: false }, { HUU_IN_CONTAINER: '1' }),
    ).toContain('rootless');
  });
});
