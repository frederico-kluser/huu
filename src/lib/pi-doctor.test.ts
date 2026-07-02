import { describe, it, expect } from 'vitest';
import { resolvePiRuntimeReport, renderPiRuntimeText } from './pi-doctor.js';

const BASE = {
  piVersion: '0.73.1',
  globalNpmRoot: '/g/root',
  globalPackageNames: ['pi-animations', 'typescript', '@scope/pi-footer', '@scope/other', 'pnpm'],
  huuHome: '/home/u',
  osHome: '/home/u',
};

describe('resolvePiRuntimeReport', () => {
  it('hermetic by default → huu-owned agent dir + pi-* filter (scoped included)', () => {
    const r = resolvePiRuntimeReport({ ...BASE, env: {} });
    expect(r.hermetic).toBe(true);
    expect(r.agentDir).toBe('/home/u/.huu/pi-agent');
    expect(r.agentDirSource).toBe('huu');
    expect(r.ignoredGlobalPiPackages).toEqual(['@scope/pi-footer', 'pi-animations']);
    expect(r.piVersion).toBe('0.73.1');
  });

  it('HUU_PI_HERMETIC=0 → host ~/.pi/agent', () => {
    const r = resolvePiRuntimeReport({ ...BASE, env: { HUU_PI_HERMETIC: '0' } });
    expect(r.hermetic).toBe(false);
    expect(r.agentDir).toBe('/home/u/.pi/agent');
    expect(r.agentDirSource).toBe('host');
  });

  it('PI_CODING_AGENT_DIR wins in BOTH modes (user override)', () => {
    for (const env of [{ PI_CODING_AGENT_DIR: '/custom' }, { PI_CODING_AGENT_DIR: '/custom', HUU_PI_HERMETIC: '0' }]) {
      const r = resolvePiRuntimeReport({ ...BASE, env });
      expect(r.agentDir).toBe('/custom');
      expect(r.agentDirSource).toBe('env');
    }
  });

  it('degrades on null/empty inputs without throwing', () => {
    const r = resolvePiRuntimeReport({
      env: {},
      piVersion: null,
      globalNpmRoot: null,
      globalPackageNames: [],
      huuHome: '/h',
      osHome: '/h',
    });
    expect(r.piVersion).toBeNull();
    expect(r.globalNpmRoot).toBeNull();
    expect(r.ignoredGlobalPiPackages).toEqual([]);
  });
});

describe('renderPiRuntimeText', () => {
  it('shows hermetic=on with the ignored list', () => {
    const lines = renderPiRuntimeText(resolvePiRuntimeReport({ ...BASE, env: {} }));
    expect(lines[0]).toContain('0.73.1');
    expect(lines[0]).toContain('hermetic=on');
    expect(lines[0]).toContain('/home/u/.huu/pi-agent (huu)');
    expect(lines[1]).toContain('ignored: @scope/pi-footer, pi-animations (2)');
  });

  it('flags LOADABLE when hermetic is off and pi-* packages exist', () => {
    const lines = renderPiRuntimeText(
      resolvePiRuntimeReport({ ...BASE, env: { HUU_PI_HERMETIC: 'false' } }),
    );
    expect(lines[0]).toContain('hermetic=OFF');
    expect(lines[1]).toContain('LOADABLE (hermetic off!)');
  });

  it('reports none-found when the npm root is clean', () => {
    const lines = renderPiRuntimeText(
      resolvePiRuntimeReport({ ...BASE, globalPackageNames: ['typescript'], env: {} }),
    );
    expect(lines[1]).toContain('none found');
  });

  it('reports unresolved version without throwing', () => {
    const lines = renderPiRuntimeText(
      resolvePiRuntimeReport({ ...BASE, piVersion: null, env: {} }),
    );
    expect(lines[0]).toContain('unresolved');
  });
});
