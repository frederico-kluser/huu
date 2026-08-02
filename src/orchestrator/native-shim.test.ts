import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir, platform as osPlatform } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureNativeShim } from './native-shim.js';
import { writeAgentEnvFile, AGENT_ENV_FILE } from './agent-env.js';
import { PortAllocator } from './port-allocator.js';

// LD_PRELOAD only works on Linux. macOS DYLD_INSERT_LIBRARIES requires
// disabling SIP for system binaries; node from a typical install is not
// SIP-protected, but the test runner conditions are uncertain — keep it
// Linux-only to stay deterministic in CI.
const isLinux = osPlatform() === 'linux';
const describeOnLinux = isLinux ? describe : describe.skip;

describeOnLinux('native bind() shim end-to-end', () => {
  let scratch: string;
  let shimLib: string | null = null;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'huu-shim-'));
    const shim = ensureNativeShim(scratch);
    shimLib = shim?.libPath ?? null;
  });

  it('compiled the shim into the cache dir', () => {
    expect(shimLib).not.toBeNull();
    expect(existsSync(shimLib!)).toBe(true);
  });

  it('rewrites a hardcoded bind(3000) to the allocated port', () => {
    if (!shimLib) return;
    const allocator = new PortAllocator({ basePort: 56700, windowSize: 10, maxAgents: 3 });
    // Synchronous path: allocate is async but we resolve immediately for test
    // determinism — the helper returns a Promise; we await with a sync-ish IIFE
    // via execFileSync below. Just compute the bundle:
    return allocator.allocate(1).then((bundle) => {
      writeAgentEnvFile(scratch, bundle, 'test-run', { libPath: shimLib!, envVar: 'LD_PRELOAD', os: 'linux' });
      const envPath = join(scratch, AGENT_ENV_FILE);
      expect(existsSync(envPath)).toBe(true);

      // Spawn a child node that asks for port 3000 and reports what it got.
      const probe = `
        const net = require('net');
        const s = net.createServer();
        s.listen({ port: 3000, host: '127.0.0.1' }, () => {
          process.stdout.write(String(s.address().port));
          s.close();
        });
        s.on('error', (e) => { process.stderr.write(e.message); process.exit(2); });
      `;
      const out = execFileSync('node', ['-e', probe], {
        env: {
          ...process.env,
          LD_PRELOAD: shimLib!,
          HUU_PORT_REMAP: `3000:${bundle.http}`,
        },
        encoding: 'utf8',
      });
      expect(parseInt(out, 10)).toBe(bundle.http);
    });
  });

  it('lets two parallel children both "bind 3000" without EADDRINUSE', async () => {
    if (!shimLib) return;
    const allocator = new PortAllocator({ basePort: 56800, windowSize: 10, maxAgents: 3 });
    const a = await allocator.allocate(1);
    const b = await allocator.allocate(2);

    const probe = `
      const net = require('net');
      const s = net.createServer();
      s.listen({ port: 3000, host: '127.0.0.1' }, () => {
        process.stdout.write(String(s.address().port));
        // Hold the port briefly so the parallel child must coexist.
        setTimeout(() => s.close(), 150);
      });
      s.on('error', (e) => { process.stderr.write(e.message); process.exit(2); });
    `;
    const run = (port: number) =>
      new Promise<string>((resolve, reject) => {
        try {
          const out = execFileSync('node', ['-e', probe], {
            env: {
              ...process.env,
              LD_PRELOAD: shimLib!,
              HUU_PORT_REMAP: `3000:${port}`,
            },
            encoding: 'utf8',
            timeout: 3000,
          });
          resolve(out);
        } catch (err) {
          reject(err);
        }
      });

    const [outA, outB] = await Promise.all([run(a.http), run(b.http)]);
    expect(parseInt(outA, 10)).toBe(a.http);
    expect(parseInt(outB, 10)).toBe(b.http);
    expect(a.http).not.toBe(b.http);

    rmSync(scratch, { recursive: true, force: true });
  });
});

// HUU_NATIVE_SHIM_PATH short-circuits compile-on-demand. This is the path
// the official Docker image takes: gcc lives in the builder, not the
// runtime, so the .so is built ahead of time and the runtime points at it
// via env. Tests don't need a real shared library — ensureNativeShim() only
// checks existence, not validity (the dynamic linker validates at exec).
describe('HUU_NATIVE_SHIM_PATH (prebuilt shim path)', () => {
  let scratch: string;
  const originalEnv = process.env.HUU_NATIVE_SHIM_PATH;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'huu-shim-prebuilt-'));
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HUU_NATIVE_SHIM_PATH;
    else process.env.HUU_NATIVE_SHIM_PATH = originalEnv;
  });

  it('returns the prebuilt path verbatim when the file exists', () => {
    if (osPlatform() === 'win32') return; // detectOs() returns null on Windows
    const fakeLib = join(scratch, 'fake-prebuilt.so');
    writeFileSync(fakeLib, 'not a real shared library', 'utf8');
    process.env.HUU_NATIVE_SHIM_PATH = fakeLib;

    const warnings: string[] = [];
    const shim = ensureNativeShim(scratch, (m) => warnings.push(m));

    expect(shim).not.toBeNull();
    expect(shim!.libPath).toBe(fakeLib);
    expect(warnings).toEqual([]); // happy path emits no warning
  });

  it('warns and falls through when the prebuilt path does not exist', () => {
    if (osPlatform() === 'win32') return;
    process.env.HUU_NATIVE_SHIM_PATH = join(scratch, 'does-not-exist.so');

    const warnings: string[] = [];
    const shim = ensureNativeShim(scratch, (m) => warnings.push(m));

    // Fall-through behavior depends on host: cc available → compiles a
    // real shim (shim != null); no cc → null. Either way, the warning
    // about the bogus prebuilt path must surface.
    expect(warnings.some((m) => m.includes('does-not-exist.so'))).toBe(true);
    if (shim) {
      // If we did fall through to compile, the result is NOT the bogus path.
      expect(shim.libPath).not.toBe(process.env.HUU_NATIVE_SHIM_PATH);
    }
  });
});
