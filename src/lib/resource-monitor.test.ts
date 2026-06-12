import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('node:os', () => {
  const mocked = {
    cpus: vi.fn(),
    totalmem: vi.fn(),
    freemem: vi.fn(),
    loadavg: vi.fn(),
  };
  return { ...mocked, default: mocked };
});

vi.mock('node:fs', () => {
  const mocked = {
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
  return { ...mocked, default: mocked };
});

vi.mock('node:child_process', () => {
  const mocked = {
    execFileSync: vi.fn(),
  };
  return { ...mocked, default: mocked };
});

import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  getSystemMetrics,
  resetCpuSnapshot,
  resetDarwinAvailableCache,
} from './resource-monitor.js';

function mockCpus(user: number, nice: number, sys: number, idle: number, irq: number) {
  (os.cpus as unknown as Mock).mockReturnValue([
    { times: { user, nice, sys, idle, irq } },
    { times: { user, nice, sys, idle, irq } },
  ]);
}

describe('getSystemMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (os.totalmem as unknown as Mock).mockReturnValue(16 * 1024 ** 3);
    (os.freemem as unknown as Mock).mockReturnValue(8 * 1024 ** 3);
    (os.loadavg as unknown as Mock).mockReturnValue([1.5, 1.2, 1.0]);
    mockCpus(1000, 200, 500, 7000, 50);

    (fs.existsSync as unknown as Mock).mockReturnValue(false);
    // vm_stat unavailable by default so the host fallback exercises
    // freemem() like before the darwin path existed.
    (execFileSync as unknown as Mock).mockImplementation(() => {
      throw new Error('vm_stat unavailable (mock)');
    });
    resetCpuSnapshot();
    resetDarwinAvailableCache();
  });

  it.runIf(process.platform === 'darwin')(
    'on macOS, host fallback derives available from vm_stat reclaimable pages (not bare freemem)',
    () => {
      const constrainedSpy = vi.spyOn(process, 'constrainedMemory').mockReturnValue(0);
      // 16 GiB page size 16384: free 100k + inactive 200k + purgeable 50k +
      // speculative 50k pages = 400k pages = 6.25 GiB available.
      (execFileSync as unknown as Mock).mockReturnValue(
        'Mach Virtual Memory Statistics: (page size of 16384 bytes)\n' +
          'Pages free:                              100000.\n' +
          'Pages active:                            500000.\n' +
          'Pages inactive:                          200000.\n' +
          'Pages speculative:                        50000.\n' +
          'Pages purgeable:                          50000.\n',
      );

      const m = getSystemMetrics();

      expect(m.ramAvailableBytes).toBe(400_000 * 16384);
      expect(m.containerAware).toBe(false);
      // os.freemem() (8 GiB mock) was NOT the source — the reclaimable-page
      // figure was. On a warmed-up Mac freemem() saturates ramPercent ≥95%
      // and permanently gates AutoScaler.shouldSpawn().
      expect(m.ramAvailableBytes).not.toBe(8 * 1024 ** 3);

      constrainedSpy.mockRestore();
    },
  );

  it('returns all SystemMetrics fields', () => {
    const m = getSystemMetrics();
    expect(m).toHaveProperty('cpuPercent');
    expect(m).toHaveProperty('ramPercent');
    expect(m).toHaveProperty('ramUsedBytes');
    expect(m).toHaveProperty('ramTotalBytes');
    expect(m).toHaveProperty('ramAvailableBytes');
    expect(m).toHaveProperty('processRssBytes');
    expect(m).toHaveProperty('loadAvg1');
    expect(m).toHaveProperty('containerAware');
  });

  it('keeps ramAvailableBytes within [0, ramTotalBytes]', () => {
    const m = getSystemMetrics();
    expect(m.ramAvailableBytes).toBeGreaterThanOrEqual(0);
    expect(m.ramAvailableBytes).toBeLessThanOrEqual(m.ramTotalBytes);
  });

  it('returns numbers in expected ranges', () => {
    getSystemMetrics();
    const m = getSystemMetrics();

    expect(typeof m.cpuPercent).toBe('number');
    expect(m.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(m.cpuPercent).toBeLessThanOrEqual(100);

    expect(typeof m.ramPercent).toBe('number');
    expect(m.ramPercent).toBeGreaterThanOrEqual(0);
    expect(m.ramPercent).toBeLessThanOrEqual(100);

    expect(typeof m.ramUsedBytes).toBe('number');
    expect(m.ramUsedBytes).toBeGreaterThan(0);

    expect(typeof m.ramTotalBytes).toBe('number');
    expect(m.ramTotalBytes).toBeGreaterThan(0);

    expect(typeof m.processRssBytes).toBe('number');
    expect(m.processRssBytes).toBeGreaterThan(0);

    expect(typeof m.loadAvg1).toBe('number');
    expect(m.loadAvg1).toBe(1.5);

    expect(typeof m.containerAware).toBe('boolean');
  });

  it('uses process.constrainedMemory() when it returns a valid limit', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(4 * 1024 ** 3);

    const m = getSystemMetrics();

    expect(m.ramTotalBytes).toBe(4 * 1024 ** 3);
    expect(m.containerAware).toBe(true);

    constrainedSpy.mockRestore();
  });

  it('ignores constrainedMemory() when it returns 0', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(0);

    const m = getSystemMetrics();

    expect(m.ramTotalBytes).toBe(16 * 1024 ** 3);
    expect(m.containerAware).toBe(false);

    constrainedSpy.mockRestore();
  });

  it('ignores constrainedMemory() when it returns Number.MAX_SAFE_INTEGER', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(Number.MAX_SAFE_INTEGER);

    const m = getSystemMetrics();

    expect(m.ramTotalBytes).toBe(16 * 1024 ** 3);
    expect(m.containerAware).toBe(false);

    constrainedSpy.mockRestore();
  });

  it('falls back to cgroup v2 when constrainedMemory is 0 and v2 files exist', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(0);

    (fs.existsSync as unknown as Mock).mockImplementation((path: string) =>
      path === '/sys/fs/cgroup/memory.max' || path === '/sys/fs/cgroup/memory.current',
    );
    (fs.readFileSync as unknown as Mock).mockImplementation((path: string) => {
      if (path === '/sys/fs/cgroup/memory.max') return '4294967296\n';
      if (path === '/sys/fs/cgroup/memory.current') return '1073741824\n';
      throw new Error('ENOENT');
    });

    const m = getSystemMetrics();

    expect(m.ramTotalBytes).toBe(4 * 1024 ** 3);
    expect(m.ramUsedBytes).toBe(1 * 1024 ** 3);
    expect(m.containerAware).toBe(true);

    constrainedSpy.mockRestore();
  });

  it('falls back to cgroup v1 when constrainedMemory and cgroup v2 are unavailable', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(0);

    (fs.existsSync as unknown as Mock).mockImplementation((path: string) =>
      path === '/sys/fs/cgroup/memory/memory.limit_in_bytes' ||
      path === '/sys/fs/cgroup/memory/memory.usage_in_bytes',
    );
    (fs.readFileSync as unknown as Mock).mockImplementation((path: string) => {
      if (path === '/sys/fs/cgroup/memory/memory.limit_in_bytes') return '8589934592\n';
      if (path === '/sys/fs/cgroup/memory/memory.usage_in_bytes') return '2147483648\n';
      throw new Error('ENOENT');
    });

    const m = getSystemMetrics();

    expect(m.ramTotalBytes).toBe(8 * 1024 ** 3);
    expect(m.ramUsedBytes).toBe(2 * 1024 ** 3);
    expect(m.containerAware).toBe(true);

    constrainedSpy.mockRestore();
  });

  it('falls back to host os when no container detection works', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(0);

    (fs.existsSync as unknown as Mock).mockReturnValue(false);

    const m = getSystemMetrics();

    expect(m.ramTotalBytes).toBe(16 * 1024 ** 3);
    expect(m.ramUsedBytes).toBe(8 * 1024 ** 3);
    expect(m.ramAvailableBytes).toBe(8 * 1024 ** 3);
    expect(m.containerAware).toBe(false);

    constrainedSpy.mockRestore();
  });

  it('prefers /proc/meminfo MemAvailable over freemem on Linux hosts', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(0);

    (fs.existsSync as unknown as Mock).mockImplementation(
      (path: string) => path === '/proc/meminfo',
    );
    (fs.readFileSync as unknown as Mock).mockImplementation((path: string) => {
      if (path === '/proc/meminfo') {
        return 'MemTotal:       16777216 kB\nMemFree:         1048576 kB\nMemAvailable:   12582912 kB\n';
      }
      throw new Error('ENOENT');
    });

    const m = getSystemMetrics();

    // 12582912 kB = 12 GiB available; used = total − available.
    expect(m.ramAvailableBytes).toBe(12 * 1024 ** 3);
    expect(m.ramUsedBytes).toBe(4 * 1024 ** 3);
    expect(m.containerAware).toBe(false);

    constrainedSpy.mockRestore();
  });

  it('derives availableBytes from the cgroup v2 limit minus current', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(0);

    (fs.existsSync as unknown as Mock).mockImplementation((path: string) =>
      path === '/sys/fs/cgroup/memory.max' || path === '/sys/fs/cgroup/memory.current',
    );
    (fs.readFileSync as unknown as Mock).mockImplementation((path: string) => {
      if (path === '/sys/fs/cgroup/memory.max') return '4294967296\n';
      if (path === '/sys/fs/cgroup/memory.current') return '1073741824\n';
      throw new Error('ENOENT');
    });

    const m = getSystemMetrics();

    expect(m.ramAvailableBytes).toBe(3 * 1024 ** 3);

    constrainedSpy.mockRestore();
  });

  it('uses cgroup current as "used" in the constrainedMemory branch when readable', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(4 * 1024 ** 3);

    (fs.existsSync as unknown as Mock).mockImplementation(
      (path: string) => path === '/sys/fs/cgroup/memory.current',
    );
    (fs.readFileSync as unknown as Mock).mockImplementation((path: string) => {
      if (path === '/sys/fs/cgroup/memory.current') return '2147483648\n';
      throw new Error('ENOENT');
    });

    const m = getSystemMetrics();

    expect(m.ramTotalBytes).toBe(4 * 1024 ** 3);
    expect(m.ramUsedBytes).toBe(2 * 1024 ** 3);
    expect(m.ramAvailableBytes).toBe(2 * 1024 ** 3);
    expect(m.containerAware).toBe(true);

    constrainedSpy.mockRestore();
  });

  it('returns 0 CPU on first call (no previous snapshot)', () => {
    const m = getSystemMetrics();
    expect(m.cpuPercent).toBe(0);
  });

  it('calculates CPU percent from delta between first and second call', () => {
    getSystemMetrics();

    mockCpus(1100, 200, 600, 7100, 50);
    const m = getSystemMetrics();

    expect(m.cpuPercent).toBeCloseTo(66.67, 1);
  });

  it('falls through cgroup v2 when memory.max is "max"', () => {
    const constrainedSpy = vi
      .spyOn(process, 'constrainedMemory')
      .mockReturnValue(0);

    (fs.existsSync as unknown as Mock).mockImplementation((path: string) =>
      path === '/sys/fs/cgroup/memory.max' ||
      path === '/sys/fs/cgroup/memory.current',
    );
    (fs.readFileSync as unknown as Mock).mockImplementation((path: string) => {
      if (path === '/sys/fs/cgroup/memory.max') return 'max\n';
      if (path === '/sys/fs/cgroup/memory.current') return '1073741824\n';
      throw new Error('ENOENT');
    });

    const m = getSystemMetrics();

    expect(m.ramTotalBytes).toBe(16 * 1024 ** 3);
    expect(m.ramUsedBytes).toBe(8 * 1024 ** 3);
    expect(m.containerAware).toBe(false);

    constrainedSpy.mockRestore();
  });

  it('reads process RSS from process.memoryUsage()', () => {
    const usageSpy = vi
      .spyOn(process, 'memoryUsage')
      .mockReturnValue({ rss: 123456789 } as NodeJS.MemoryUsage);

    const m = getSystemMetrics();

    expect(m.processRssBytes).toBe(123456789);

    usageSpy.mockRestore();
  });
});
