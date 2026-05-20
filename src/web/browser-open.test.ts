import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    unref: vi.fn(),
  })),
}));

describe('openBrowser', () => {
  const originalEnv = process.env[ 'HUU_WEB_NO_OPEN' ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['HUU_WEB_NO_OPEN'];
    } else {
      process.env['HUU_WEB_NO_OPEN'] = originalEnv;
    }
  });

  it('skips spawn when HUU_WEB_NO_OPEN is set', async () => {
    process.env['HUU_WEB_NO_OPEN'] = '1';
    const { spawn } = await import('node:child_process');
    const { openBrowser } = await import('./browser-open.js');
    await openBrowser('https://example.com');
    expect(spawn).not.toHaveBeenCalled();
  });
});
