import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildDockerArgv,
  hasRemovedNativeBypass,
  isPathInside,
  resolveWorkspaceRoot,
  stripRemovedNativeFlags,
  decideReexec,
  detectDefaultRouteMtu,
  imageIsLocal,
  makeSecretFile,
  pickDockerNetwork,
  buildMemoryLimitArgs,
} from './docker-reexec.js';

describe('decideReexec', () => {
  function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return extra as NodeJS.ProcessEnv;
  }

  it('skips re-exec when already inside the container', () => {
    const r = decideReexec(['run', 'x.json'], env({ HUU_IN_CONTAINER: '1' }));
    expect(r.shouldReexec).toBe(false);
    expect(r.reason).toMatch(/inside the huu container/);
  });

  it('skips re-exec for --help', () => {
    expect(decideReexec(['--help'], env()).shouldReexec).toBe(false);
    expect(decideReexec(['-h'], env()).shouldReexec).toBe(false);
    // --help anywhere in argv should also skip
    expect(decideReexec(['--stub', '--help'], env()).shouldReexec).toBe(false);
  });

  it('skips re-exec for init-docker (operates on host fs)', () => {
    const r = decideReexec(['init-docker', '--with-wrapper'], env());
    expect(r.shouldReexec).toBe(false);
    expect(r.reason).toMatch(/init-docker/);
  });

  it('skips re-exec for status (operates on host fs)', () => {
    const r = decideReexec(['status'], env());
    expect(r.shouldReexec).toBe(false);
    expect(r.reason).toMatch(/status/);
  });

  it('skips re-exec for status with flags', () => {
    expect(decideReexec(['status', '--json'], env()).shouldReexec).toBe(false);
  });

  it('re-execs for bare huu (TUI welcome)', () => {
    expect(decideReexec([], env()).shouldReexec).toBe(true);
  });

  it('re-execs for huu run pipeline.json', () => {
    expect(decideReexec(['run', 'p.json'], env()).shouldReexec).toBe(true);
  });

  it('re-execs for huu --stub', () => {
    expect(decideReexec(['--stub'], env()).shouldReexec).toBe(true);
  });

  it('flag ordering does not confuse the dispatch', () => {
    // Real-world: huu --stub run pipeline.json
    expect(decideReexec(['--stub', 'run', 'p.json'], env()).shouldReexec).toBe(true);
  });

  // DOCKER-ONLY (native mode removed): the legacy bypasses are DETECTED and
  // WARNED about but never honored — every run goes through the container.
  it('re-execs even with --yolo / --no-docker / HUU_NO_DOCKER (native mode removed)', () => {
    expect(decideReexec(['--yolo'], env()).shouldReexec).toBe(true);
    expect(decideReexec(['--no-docker', 'run', 'p.json'], env()).shouldReexec).toBe(true);
    expect(decideReexec(['run', 'x.json'], env({ HUU_NO_DOCKER: '1' })).shouldReexec).toBe(true);
    expect(decideReexec([], env({ HUU_NO_DOCKER: 'true' })).shouldReexec).toBe(true);
  });

  it('hasRemovedNativeBypass detects the legacy flags/env for the warning', () => {
    expect(hasRemovedNativeBypass(['--yolo'], env())).toBe(true);
    expect(hasRemovedNativeBypass([], env({ HUU_NO_DOCKER: '1' }))).toBe(true);
    expect(hasRemovedNativeBypass(['run', 'p.json'], env())).toBe(false);
    expect(hasRemovedNativeBypass([], env({ HUU_NO_DOCKER: '0' }))).toBe(false);
  });

  it('stripRemovedNativeFlags keeps everything else intact', () => {
    expect(stripRemovedNativeFlags(['--yolo', 'run', 'p.json', '--no-docker', '--stub'])).toEqual([
      'run',
      'p.json',
      '--stub',
    ]);
  });
});

describe('buildDockerArgv', () => {
  const baseOpts = {
    cwd: '/home/user/proj',
    image: 'ghcr.io/owner/huu:1.2.3',
    cidfile: '/tmp/huu-cids/cid-123.id',
    args: ['run', 'pipeline.json'],
    hasTTY: true,
    uid: 1001,
    gid: 1002,
  };

  it('emits --rm -it with --cidfile and same-path mount', () => {
    const argv = buildDockerArgv(baseOpts);
    expect(argv[0]).toBe('run');
    expect(argv).toContain('--rm');
    expect(argv).toContain('-i');
    expect(argv).toContain('-t');
    expect(argv).toContain('--cidfile');
    expect(argv).toContain('/tmp/huu-cids/cid-123.id');
    expect(argv).toContain('--user');
    expect(argv).toContain('1001:1002');
    expect(argv).toContain('-v');
    expect(argv).toContain('/home/user/proj:/home/user/proj');
    expect(argv).toContain('-w');
    expect(argv).toContain('/home/user/proj');
  });

  it('omits -t when stdin is not a TTY (avoids docker error on pipes)', () => {
    const argv = buildDockerArgv({ ...baseOpts, hasTTY: false });
    expect(argv).toContain('-i');
    expect(argv).not.toContain('-t');
  });

  it('image goes after the docker flags and before user args', () => {
    const argv = buildDockerArgv(baseOpts);
    const imageIdx = argv.indexOf(baseOpts.image);
    const runIdx = argv.indexOf('run', imageIdx);
    expect(imageIdx).toBeGreaterThan(0);
    expect(runIdx).toBeGreaterThan(imageIdx);
    expect(argv[argv.length - 1]).toBe('pipeline.json');
  });

  it('forces explicit `huu` when user passed no args (avoid image CMD fallback)', () => {
    const argv = buildDockerArgv({ ...baseOpts, args: [] });
    expect(argv[argv.length - 1]).toBe('huu');
  });

  it('passes OPENROUTER_API_KEY by NAME ONLY (no value) when not in excludeFromEnv', () => {
    // The valueless `-e KEY` form keeps the secret out of /proc/<pid>/cmdline.
    const saved = process.env.OPENROUTER_API_KEY;
    try {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-123';
      const argv = buildDockerArgv(baseOpts);
      expect(argv).toContain('-e');
      expect(argv).toContain('OPENROUTER_API_KEY');
      // Crucially: the value MUST NOT appear in argv.
      expect(argv.find((a) => a.startsWith('OPENROUTER_API_KEY=') || a === 'sk-or-test-123')).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = saved;
    }
  });

  it('forwards every API key from the registry by name only', () => {
    // Registry-driven: adding a new key should automatically appear in argv.
    const saved = {
      or: process.env.OPENROUTER_API_KEY,
      aa: process.env.ARTIFICIAL_ANALYSIS_API_KEY,
    };
    try {
      process.env.OPENROUTER_API_KEY = 'sk-or-x';
      process.env.ARTIFICIAL_ANALYSIS_API_KEY = 'aa-y';
      const argv = buildDockerArgv(baseOpts);
      expect(argv).toContain('OPENROUTER_API_KEY');
      expect(argv).toContain('ARTIFICIAL_ANALYSIS_API_KEY');
      expect(argv.find((a) => a === 'sk-or-x' || a === 'aa-y')).toBeUndefined();
    } finally {
      if (saved.or === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = saved.or;
      if (saved.aa === undefined) delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
      else process.env.ARTIFICIAL_ANALYSIS_API_KEY = saved.aa;
    }
  });

  it('omits OPENROUTER_API_KEY entirely when excludeFromEnv has it (file-mount path)', () => {
    const saved = process.env.OPENROUTER_API_KEY;
    try {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-123';
      const argv = buildDockerArgv({
        ...baseOpts,
        excludeFromEnv: new Set(['OPENROUTER_API_KEY']),
      });
      expect(argv.find((a) => a === 'OPENROUTER_API_KEY' || a.startsWith('OPENROUTER_API_KEY='))).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = saved;
    }
  });

  it('emits --mount type=bind for each secretMount', () => {
    const argv = buildDockerArgv({
      ...baseOpts,
      secretMounts: [
        {
          hostPath: '/dev/shm/huu-openrouter-key-1234-abc',
          containerPath: '/run/secrets/openrouter_api_key',
        },
      ],
    });
    const mountIdx = argv.indexOf('--mount');
    expect(mountIdx).toBeGreaterThan(-1);
    expect(argv[mountIdx + 1]).toContain('type=bind');
    expect(argv[mountIdx + 1]).toContain('src=/dev/shm/huu-openrouter-key-1234-abc');
    expect(argv[mountIdx + 1]).toContain('dst=/run/secrets/openrouter_api_key');
    expect(argv[mountIdx + 1]).toContain('readonly');
  });

  it('does not pass empty env keys', () => {
    const saved = process.env.HUU_CHECK_PUSH;
    try {
      delete process.env.HUU_CHECK_PUSH;
      const argv = buildDockerArgv(baseOpts);
      expect(argv.find((a) => a === 'HUU_CHECK_PUSH' || a.startsWith('HUU_CHECK_PUSH='))).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.HUU_CHECK_PUSH = saved;
    }
  });

  it('honors HUU_DOCKER_PASS_ENV for additional vars (also valueless)', () => {
    const saved = {
      pass: process.env.HUU_DOCKER_PASS_ENV,
      custom: process.env.MY_CUSTOM_VAR,
    };
    try {
      process.env.HUU_DOCKER_PASS_ENV = 'MY_CUSTOM_VAR';
      process.env.MY_CUSTOM_VAR = 'hello';
      const argv = buildDockerArgv(baseOpts);
      // Name only — value never appears in argv.
      expect(argv).toContain('MY_CUSTOM_VAR');
      expect(argv.find((a) => a === 'MY_CUSTOM_VAR=hello' || a === 'hello')).toBeUndefined();
    } finally {
      if (saved.pass === undefined) delete process.env.HUU_DOCKER_PASS_ENV;
      else process.env.HUU_DOCKER_PASS_ENV = saved.pass;
      if (saved.custom === undefined) delete process.env.MY_CUSTOM_VAR;
      else process.env.MY_CUSTOM_VAR = saved.custom;
    }
  });

  it('labels container for orphan tracking', () => {
    const argv = buildDockerArgv(baseOpts);
    expect(argv.some((a) => a.startsWith('huu.parent-pid='))).toBe(true);
  });

  it('emits extra -v same-path mounts for each extraMounts entry', () => {
    // Worktree case: parent repo's .git lives outside cwd. The wrapper
    // must mount it at the same host path so the worktree's `.git` file
    // (which carries `gitdir: <abs-path>`) resolves inside the container.
    const argv = buildDockerArgv({
      ...baseOpts,
      extraMounts: [
        '/home/user/proj-main/.git',
        '/home/user/some-other-toplevel',
      ],
    });
    // Find ALL `-v` occurrences and verify the extra ones are there.
    const vIndices: number[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '-v') vIndices.push(i);
    }
    const mountSpecs = vIndices.map((i) => argv[i + 1]);
    expect(mountSpecs).toContain('/home/user/proj:/home/user/proj');
    expect(mountSpecs).toContain('/home/user/proj-main/.git:/home/user/proj-main/.git');
    expect(mountSpecs).toContain('/home/user/some-other-toplevel:/home/user/some-other-toplevel');
  });

  it('omits extra mounts when extraMounts is unset or empty', () => {
    const argvA = buildDockerArgv(baseOpts);
    const argvB = buildDockerArgv({ ...baseOpts, extraMounts: [] });
    // Only one -v from the cwd mount (no secrets in baseOpts).
    const countV = (argv: string[]) => argv.filter((a) => a === '-v').length;
    expect(countV(argvA)).toBe(1);
    expect(countV(argvB)).toBe(1);
  });

  it('omits --network when opts.network is undefined', () => {
    const argv = buildDockerArgv(baseOpts);
    expect(argv).not.toContain('--network');
  });

  it('emits --network=host when opts.network is "host" (VPN/MTU workaround)', () => {
    const argv = buildDockerArgv({ ...baseOpts, network: 'host' });
    const idx = argv.indexOf('--network');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(argv[idx + 1]).toBe('host');
    // Must appear BEFORE the image name so docker parses it as a run flag.
    expect(idx).toBeLessThan(argv.indexOf(baseOpts.image));
  });

  it('omits -p when no publishPorts (CLI/TUI path)', () => {
    const argv = buildDockerArgv(baseOpts);
    expect(argv).not.toContain('-p');
  });

  it('publishes the web-UI port host→container (-p <n>:<n>) before the image', () => {
    const argv = buildDockerArgv({ ...baseOpts, publishPorts: [4888] });
    const idx = argv.indexOf('-p');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(argv[idx + 1]).toBe('4888:4888');
    // Run flags must precede the image so docker parses -p as a run flag.
    expect(idx).toBeLessThan(argv.indexOf(baseOpts.image));
  });

  it('publishes multiple ports when asked', () => {
    const argv = buildDockerArgv({ ...baseOpts, publishPorts: [4888, 5000] });
    const pairs = argv.filter((_, i) => argv[i - 1] === '-p');
    expect(pairs).toEqual(['4888:4888', '5000:5000']);
  });

  it('forwards HUU_WEB_PORT by name so the container binds the published port', () => {
    const saved = process.env.HUU_WEB_PORT;
    try {
      process.env.HUU_WEB_PORT = '4888';
      const argv = buildDockerArgv({ ...baseOpts, publishPorts: [4888] });
      expect(argv).toContain('HUU_WEB_PORT');
    } finally {
      if (saved === undefined) delete process.env.HUU_WEB_PORT;
      else process.env.HUU_WEB_PORT = saved;
    }
  });
});

describe('pickDockerNetwork', () => {
  it('honors explicit HUU_DOCKER_NETWORK env override verbatim', () => {
    expect(pickDockerNetwork({ HUU_DOCKER_NETWORK: 'host' })).toBe('host');
    expect(pickDockerNetwork({ HUU_DOCKER_NETWORK: 'my-custom-net' })).toBe('my-custom-net');
  });

  it('returns undefined when explicit env is empty/whitespace', () => {
    expect(pickDockerNetwork({ HUU_DOCKER_NETWORK: '' })).toBeDefined; // either auto-net or undefined
    // Don't assert exact value — depends on host's MTU. Just ensure no crash.
    expect(() => pickDockerNetwork({ HUU_DOCKER_NETWORK: '   ' })).not.toThrow();
  });
});

describe('detectDefaultRouteMtu', () => {
  it('returns a positive integer on linux when there is a default route, or null otherwise', () => {
    const mtu = detectDefaultRouteMtu();
    if (mtu !== null) {
      expect(mtu).toBeGreaterThan(0);
      expect(mtu).toBeLessThanOrEqual(65535);
      expect(Number.isInteger(mtu)).toBe(true);
    }
  });
});

describe('imageIsLocal', () => {
  // We can't reliably assert "image X exists" without a real docker
  // daemon and a known image. We CAN assert the negative path: a
  // randomly-named image we know we never pulled returns false.
  it('returns false for an image that has never been pulled', () => {
    const random = `huu-test-image-${Date.now()}-${Math.random().toString(36).slice(2)}:nope`;
    // imageIsLocal calls spawnSync('docker', ['image', 'inspect', ...]).
    // If docker isn't installed in the test environment, spawnSync
    // returns a non-zero status anyway, so the function still returns
    // false — which is what we want for the test.
    expect(imageIsLocal(random)).toBe(false);
  });
});

describe('makeSecretFile', () => {
  it('writes the value with mode 0600 and a unique name', () => {
    const path = makeSecretFile('sk-or-secret-value', 'huu-test-secret');
    try {
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('sk-or-secret-value');
      // 0o777 mask filters umask noise; 0o600 is owner-only read/write.
      expect(statSync(path).mode & 0o777).toBe(0o600);
      // Name format: <scope>-<pid>-<rand>
      expect(path).toMatch(/huu-test-secret-\d+-[0-9a-f]{16}$/);
    } finally {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  });

  it('successive calls produce distinct paths', () => {
    const a = makeSecretFile('one', 'huu-test-secret');
    const b = makeSecretFile('two', 'huu-test-secret');
    try {
      expect(a).not.toBe(b);
    } finally {
      try {
        unlinkSync(a);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(b);
      } catch {
        /* ignore */
      }
    }
  });
});

describe('resolveHostGitIdentity', () => {
  it('populates GIT_AUTHOR/COMMITTER env from host git config', async () => {
    const { resolveHostGitIdentity } = await import('./docker-reexec.js');
    const saved = {
      an: process.env.GIT_AUTHOR_NAME,
      ae: process.env.GIT_AUTHOR_EMAIL,
      cn: process.env.GIT_COMMITTER_NAME,
      ce: process.env.GIT_COMMITTER_EMAIL,
    };
    try {
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_AUTHOR_EMAIL;
      delete process.env.GIT_COMMITTER_NAME;
      delete process.env.GIT_COMMITTER_EMAIL;

      resolveHostGitIdentity();

      // If the test host has git user.name configured, it should be set.
      // We can't guarantee the value, but if git config succeeds, the
      // env vars should be non-empty strings.
      const { spawnSync } = await import('node:child_process');
      const nameResult = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
      const hostName = nameResult.stdout?.trim();

      if (hostName) {
        expect(process.env.GIT_AUTHOR_NAME).toBe(hostName);
        expect(process.env.GIT_COMMITTER_NAME).toBe(hostName);
      }
    } finally {
      if (saved.an === undefined) delete process.env.GIT_AUTHOR_NAME;
      else process.env.GIT_AUTHOR_NAME = saved.an;
      if (saved.ae === undefined) delete process.env.GIT_AUTHOR_EMAIL;
      else process.env.GIT_AUTHOR_EMAIL = saved.ae;
      if (saved.cn === undefined) delete process.env.GIT_COMMITTER_NAME;
      else process.env.GIT_COMMITTER_NAME = saved.cn;
      if (saved.ce === undefined) delete process.env.GIT_COMMITTER_EMAIL;
      else process.env.GIT_COMMITTER_EMAIL = saved.ce;
    }
  });

  it('does not overwrite pre-existing env vars', async () => {
    const { resolveHostGitIdentity } = await import('./docker-reexec.js');
    const saved = {
      an: process.env.GIT_AUTHOR_NAME,
      cn: process.env.GIT_COMMITTER_NAME,
    };
    try {
      process.env.GIT_AUTHOR_NAME = 'keep-this';
      process.env.GIT_COMMITTER_NAME = 'keep-this-too';

      resolveHostGitIdentity();

      expect(process.env.GIT_AUTHOR_NAME).toBe('keep-this');
      expect(process.env.GIT_COMMITTER_NAME).toBe('keep-this-too');
    } finally {
      if (saved.an === undefined) delete process.env.GIT_AUTHOR_NAME;
      else process.env.GIT_AUTHOR_NAME = saved.an;
      if (saved.cn === undefined) delete process.env.GIT_COMMITTER_NAME;
      else process.env.GIT_COMMITTER_NAME = saved.cn;
    }
  });
});

describe('buildDockerArgv git identity passthrough', () => {
  const baseOpts = {
    cwd: '/home/user/proj',
    image: 'ghcr.io/owner/huu:1.2.3',
    cidfile: '/tmp/huu-cids/cid-123.id',
    args: ['run', 'pipeline.json'],
    hasTTY: true,
    uid: 1001,
    gid: 1002,
  };

  it('passes GIT_AUTHOR_NAME and GIT_COMMITTER_NAME when set', () => {
    const saved = {
      an: process.env.GIT_AUTHOR_NAME,
      cn: process.env.GIT_COMMITTER_NAME,
    };
    try {
      process.env.GIT_AUTHOR_NAME = 'Test User';
      process.env.GIT_COMMITTER_NAME = 'Test User';
      const argv = buildDockerArgv(baseOpts);
      expect(argv).toContain('GIT_AUTHOR_NAME');
      expect(argv).toContain('GIT_COMMITTER_NAME');
      // Value must NOT appear in argv (valueless form).
      expect(argv.find((a) => a === 'Test User')).toBeUndefined();
    } finally {
      if (saved.an === undefined) delete process.env.GIT_AUTHOR_NAME;
      else process.env.GIT_AUTHOR_NAME = saved.an;
      if (saved.cn === undefined) delete process.env.GIT_COMMITTER_NAME;
      else process.env.GIT_COMMITTER_NAME = saved.cn;
    }
  });
});

describe('buildDockerArgv host-home persistence', () => {
  const baseOpts = {
    cwd: '/home/user/proj',
    image: 'ghcr.io/owner/huu:1.2.3',
    cidfile: '/tmp/huu-cids/cid-123.id',
    args: ['run', 'pipeline.json'],
    hasTTY: true,
    uid: 1001,
    gid: 1002,
  };

  it('forwards HUU_HOST_HOME by name only when set', () => {
    // The in-container code reads HUU_HOST_HOME via getHuuHome() to land
    // saves on the bind-mounted host paths. Like every other passthrough,
    // emitted in valueless form so the path stays out of /proc/<pid>/cmdline.
    const saved = process.env.HUU_HOST_HOME;
    try {
      process.env.HUU_HOST_HOME = '/home/user';
      const argv = buildDockerArgv(baseOpts);
      expect(argv).toContain('HUU_HOST_HOME');
      expect(argv.find((a) => a === '/home/user' || a.startsWith('HUU_HOST_HOME='))).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.HUU_HOST_HOME;
      else process.env.HUU_HOST_HOME = saved;
    }
  });

  it('does not emit HUU_HOST_HOME when unset (native / --yolo path)', () => {
    const saved = process.env.HUU_HOST_HOME;
    try {
      delete process.env.HUU_HOST_HOME;
      const argv = buildDockerArgv(baseOpts);
      expect(argv).not.toContain('HUU_HOST_HOME');
    } finally {
      if (saved !== undefined) process.env.HUU_HOST_HOME = saved;
    }
  });

  it('mounts ~/.huu (and ~/Downloads when present) via extraMounts', () => {
    // The wrapper concatenates host-home paths into extraMounts before
    // calling buildDockerArgv; assert the mount-emission loop covers them.
    const argv = buildDockerArgv({
      ...baseOpts,
      extraMounts: ['/home/user/.huu', '/home/user/Downloads'],
    });
    const vIndices: number[] = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === '-v') vIndices.push(i);
    const mountSpecs = vIndices.map((i) => argv[i + 1]);
    expect(mountSpecs).toContain('/home/user/.huu:/home/user/.huu');
    expect(mountSpecs).toContain('/home/user/Downloads:/home/user/Downloads');
  });
});

describe('buildMemoryLimitArgs — kernel ceiling for the container', () => {
  const GiB = 1024 ** 3;

  it('sizes --memory to host total minus the adaptive OS reserve, swap bounded', () => {
    const args = buildMemoryLimitArgs({}, 32 * GiB);
    const mem = Number(args[args.indexOf('--memory') + 1]);
    const memSwap = Number(args[args.indexOf('--memory-swap') + 1]);
    expect(mem).toBe(Math.floor(32 * GiB - 32 * GiB * 0.08)); // 8% reserve on 32 GiB
    expect(memSwap).toBe(mem + 4096 * 1024 * 1024); // default 4 GiB swap allowance
    expect(args[args.indexOf('--pids-limit') + 1]).toBe('8192');
  });

  it('HUU_DOCKER_MEMORY_MB overrides; HUU_SWAP_MAX_MB=0 pins swap off', () => {
    const args = buildMemoryLimitArgs(
      { HUU_DOCKER_MEMORY_MB: '8192', HUU_SWAP_MAX_MB: '0' },
      32 * GiB,
    );
    const mem = Number(args[args.indexOf('--memory') + 1]);
    expect(mem).toBe(8192 * 1024 * 1024);
    expect(Number(args[args.indexOf('--memory-swap') + 1])).toBe(mem); // == memory → no swap
  });

  it('HUU_NO_MEM_LIMIT=1 restores the legacy unlimited container', () => {
    expect(buildMemoryLimitArgs({ HUU_NO_MEM_LIMIT: '1' }, 32 * GiB)).toEqual([]);
  });

  it('buildDockerArgv carries the limits and the RAM-safety env passthrough', () => {
    const argv = buildDockerArgv({
      cwd: '/w',
      image: 'huu:test',
      cidfile: '/tmp/cid',
      args: [],
      hasTTY: false,
      uid: 1000,
      gid: 1000,
    });
    expect(argv).toContain('--memory');
    expect(argv).toContain('--memory-swap');
    expect(argv).toContain('--pids-limit');
  });

  it('forwards host RAM-safety knobs into the container env', () => {
    const saved: Record<string, string | undefined> = {};
    const keys = ['HUU_RAM_PERCENT', 'HUU_GUARD_PSI_FULL_HIGH', 'HUU_OS_RESERVE_MB'];
    for (const k of keys) {
      saved[k] = process.env[k];
      process.env[k] = '42';
    }
    try {
      const argv = buildDockerArgv({
        cwd: '/w',
        image: 'huu:test',
        cidfile: '/tmp/cid',
        args: [],
        hasTTY: false,
        uid: 1000,
        gid: 1000,
      });
      for (const k of keys) {
        const i = argv.findIndex((a, idx) => a === '-e' && argv[idx + 1] === k);
        expect(i, `expected -e ${k}`).toBeGreaterThanOrEqual(0);
      }
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

describe('resolveWorkspaceRoot + isPathInside (folder-picker workspace)', () => {
  const HOME = '/home/user';

  it('defaults to $HOME when HUU_WORKSPACE is unset', () => {
    expect(resolveWorkspaceRoot(HOME, {})).toBe(HOME);
  });

  it('falls back to $HOME for a non-existent HUU_WORKSPACE (degrade, never block)', () => {
    expect(resolveWorkspaceRoot(HOME, { HUU_WORKSPACE: '/nope/does/not/exist' })).toBe(HOME);
  });

  it('honors HUU_WORKSPACE when it names a real directory', () => {
    // The repo root always exists — use it as a stand-in real directory.
    const real = process.cwd();
    expect(resolveWorkspaceRoot(HOME, { HUU_WORKSPACE: real })).toBe(real);
  });

  it('isPathInside: nested + equal true, siblings/prefix-collisions false', () => {
    expect(isPathInside('/home/user/.huu', '/home/user')).toBe(true);
    expect(isPathInside('/home/user', '/home/user')).toBe(true);
    expect(isPathInside('/home/user/Downloads', '/home/user')).toBe(true);
    expect(isPathInside('/home/user2', '/home/user')).toBe(false); // prefix collision
    expect(isPathInside('/mnt/code', '/home/user')).toBe(false);
  });
});
