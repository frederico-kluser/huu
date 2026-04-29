import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Transparent re-exec from the host into the official Docker image.
 *
 * Why this exists: typing `huu` in any folder should run huu against
 * that folder, isolated. Without re-exec, the user has to either
 * remember a long `docker run -v ... -w ... huu:latest run x.json`
 * incantation or `npm install` the heavy LLM SDK deps locally and
 * accept that the agent has access to ~/.ssh, ~/.aws, etc. Neither
 * matches the design intent.
 *
 * What we DO NOT rely on: docker's own signal forwarding when a TTY
 * is attached. moby#28872 documents that `docker run -it` sometimes
 * drops SIGINT/SIGHUP. Instead we trap in the wrapper and issue an
 * explicit `docker kill <cid>` from our own handlers. The container
 * also has tini as PID 1 for in-container signal hygiene, but that's
 * unrelated to the wrapper-side problem.
 *
 * Edge cases handled:
 * - Stdin not a TTY (piped input, CI): omit `-t` so docker doesn't error.
 * - Wrapper SIGKILL (no trap fires): next invocation prunes any
 *   orphan containers whose parent PID is dead.
 * - User opt-out: HUU_NO_DOCKER=1 skips the re-exec entirely (dev work
 *   on huu itself).
 * - Inside the container: HUU_IN_CONTAINER=1 (set by the Dockerfile)
 *   short-circuits to native execution. Prevents recursion.
 * - Subcommands that operate on the host filesystem (status, init-docker)
 *   or just print (help): run native, no docker pull required.
 */

const DEFAULT_IMAGE = 'ghcr.io/frederico-kluser/huu:latest';
export const CIDFILE_DIR = join(tmpdir(), 'huu-cids');
export const ORPHAN_LABEL = 'org.opencontainers.image.source=huu-wrapper';

/** Subcommands that run native — no docker pull, no bind mount needed. */
const NATIVE_ONLY_SUBCOMMANDS = new Set(['init-docker', 'status', 'prune']);

export interface ReexecDecision {
  shouldReexec: boolean;
  reason: string;
}

/**
 * Decide whether the current invocation should re-exec into docker.
 * Pure function so tests can drive every branch directly.
 */
export function decideReexec(args: string[], env: NodeJS.ProcessEnv): ReexecDecision {
  if (env.HUU_IN_CONTAINER === '1') {
    return { shouldReexec: false, reason: 'already inside the huu container' };
  }
  // CLI alias for HUU_NO_DOCKER=1. Listed before the env check so the flag
  // wins regardless of env: a user typing `--yolo` is making an explicit,
  // visible choice that should not be overridden by stale shell state.
  if (args.includes('--yolo')) {
    return { shouldReexec: false, reason: '--yolo flag — running native (no Docker isolation)' };
  }
  if (env.HUU_NO_DOCKER === '1' || env.HUU_NO_DOCKER === 'true') {
    return { shouldReexec: false, reason: 'HUU_NO_DOCKER set — running native' };
  }
  // --help / -h are pure prints, no need to spin a container.
  if (args.includes('--help') || args.includes('-h')) {
    return { shouldReexec: false, reason: 'help flag — runs native' };
  }
  const firstNonFlag = args.find((a) => !a.startsWith('-'));
  if (firstNonFlag && NATIVE_ONLY_SUBCOMMANDS.has(firstNonFlag)) {
    return { shouldReexec: false, reason: `${firstNonFlag} runs native (operates on host fs)` };
  }
  return { shouldReexec: true, reason: 'TUI/run path — execute inside the container' };
}

export interface SecretMount {
  /** Absolute path on the host. The wrapper writes + unlinks this. */
  hostPath: string;
  /** Path to expose inside the container. */
  containerPath: string;
}

export interface DockerCommandOptions {
  cwd: string;
  image: string;
  cidfile: string;
  args: string[];
  hasTTY: boolean;
  uid: number;
  gid: number;
  /**
   * Files to bind-mount read-only into the container. Used for
   * OPENROUTER_API_KEY so the value is reachable inside the container
   * (via the existing /run/secrets/openrouter_api_key resolver in
   * lib/api-key.ts) WITHOUT being exposed in `docker inspect` (which
   * is what `-e KEY=value` would do).
   */
  secretMounts?: SecretMount[];
  /**
   * Env var names that must be excluded from the regular `-e` passthrough
   * — typically because they're being delivered via secretMounts instead.
   */
  excludeFromEnv?: Set<string>;
}

/**
 * Build the argv we pass to spawn(). Returns array form (no shell).
 * Exposed so tests can assert on the command shape without invoking
 * docker.
 */
export function buildDockerArgv(opts: DockerCommandOptions): string[] {
  const argv: string[] = ['run', '--rm', '-i'];
  // -t requires a real terminal; passing it without one makes docker
  // error out with "the input device is not a TTY".
  if (opts.hasTTY) argv.push('-t');
  argv.push(
    '--cidfile', opts.cidfile,
    '--user', `${opts.uid}:${opts.gid}`,
    '--label', ORPHAN_LABEL,
    '--label', `huu.parent-pid=${process.pid}`,
    '-v', `${opts.cwd}:${opts.cwd}`,
    '-w', opts.cwd,
  );

  // Secret-file mounts (e.g. OPENROUTER_API_KEY → /run/secrets/...).
  // Read-only bind so the container can't accidentally clobber the
  // host file even if it tried.
  for (const m of opts.secretMounts ?? []) {
    argv.push(
      '--mount',
      `type=bind,src=${m.hostPath},dst=${m.containerPath},readonly`,
    );
  }

  // Pass-through env. Always include keys the Pi SDK / git layer reads;
  // additional env keys can be added via HUU_DOCKER_PASS_ENV.
  //
  // We use the VALUELESS form (`-e KEY` instead of `-e KEY=value`) for
  // two reasons:
  //   1. argv (visible via /proc/<pid>/cmdline → `ps auxf`) only contains
  //      the variable name, never the value.
  //   2. The docker client reads its own env at run time and forwards
  //      to the daemon over the socket — same end behavior in the
  //      container, less leakage on the host.
  // Secrets that should ALSO be hidden from `docker inspect` go through
  // secretMounts above, not env at all.
  const passthrough = new Set([
    'OPENROUTER_API_KEY',
    'OPENROUTER_API_KEY_FILE',
    'HUU_CHECK_PUSH',
    'HUU_WORKTREE_BASE',
    'TERM',
  ]);
  const extra = (process.env.HUU_DOCKER_PASS_ENV ?? '').split(/\s+/).filter(Boolean);
  for (const k of extra) passthrough.add(k);
  const exclude = opts.excludeFromEnv ?? new Set<string>();

  for (const k of passthrough) {
    if (exclude.has(k)) continue;
    if (process.env[k] !== undefined) argv.push('-e', k);
  }

  argv.push(opts.image);
  if (opts.args.length > 0) {
    argv.push(...opts.args);
  } else {
    // No user args = bare `huu` invocation. Without this branch docker
    // would fall back to the image CMD (which is ["huu", "--help"]) and
    // the user would see the help text instead of the TUI welcome.
    // Passing an explicit `huu` makes the entrypoint exec it with no
    // args, which opens the TUI as expected.
    argv.push('huu');
  }
  return argv;
}

function isDockerInstalled(): boolean {
  const r = spawnSync('docker', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

/**
 * Check whether a docker image is already present locally. Used to
 * decide whether to surface a "pulling first time" message before the
 * `docker run` blocks for several minutes on a fresh machine.
 */
export function imageIsLocal(image: string): boolean {
  const r = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
  return r.status === 0;
}

/**
 * Best-effort cleanup of orphan containers. Reads cidfiles whose parent
 * PID is no longer alive on the host and `docker kill`s the recorded
 * container. Safe to call on every invocation — doesn't kill the
 * current run because we use the live process.pid to avoid self-prune.
 */
function pruneOrphans(): void {
  try {
    if (existsSync(CIDFILE_DIR)) {
      for (const name of readdirSync(CIDFILE_DIR)) {
        const path = join(CIDFILE_DIR, name);
        // Parse pid from filename: cid-<pid>-<random>.id
        const m = /^cid-(\d+)-/.exec(name);
        if (!m) continue;
        const pid = Number(m[1]);
        if (pid === process.pid) continue;
        // process.kill(pid, 0) probes liveness without sending a signal.
        // Throws ESRCH when the process is gone, EPERM when it exists
        // but we can't signal it (still alive — leave the cidfile alone).
        try {
          process.kill(pid, 0);
          continue; // alive → don't prune
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EPERM') continue; // alive
        }
        // Dead. Read cid and kill.
        let cid = '';
        try {
          cid = readFileSync(path, 'utf8').trim();
        } catch {
          /* ignore */
        }
        if (cid) {
          spawnSync('docker', ['kill', cid], { stdio: 'ignore' });
        }
        try {
          unlinkSync(path);
        } catch {
          /* ignore */
        }
      }
    }
    // Same prune pass for orphan secret files. SIGKILL of the wrapper
    // (no traps fire) leaves these in /dev/shm or os.tmpdir() with
    // mode 0600 — harmless to anyone but the original user, but worth
    // sweeping so /dev/shm doesn't accumulate forever.
    for (const dir of ['/dev/shm', tmpdir()]) {
      try {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
          const m = /^huu-openrouter-key-(\d+)-/.exec(name);
          if (!m) continue;
          const pid = Number(m[1]);
          if (pid === process.pid) continue;
          try {
            process.kill(pid, 0);
            continue; // alive
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'EPERM') continue;
          }
          try {
            unlinkSync(join(dir, name));
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* readdir on a strange fs — skip */
      }
    }
  } catch {
    /* never let pruning crash the wrapper */
  }
}

function makeCidfilePath(): string {
  if (!existsSync(CIDFILE_DIR)) {
    mkdirSync(CIDFILE_DIR, { recursive: true, mode: 0o700 });
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return join(CIDFILE_DIR, `cid-${process.pid}-${rand}.id`);
}

/**
 * Write a secret value to a host file with restrictive permissions and
 * return the path. The wrapper bind-mounts this read-only into the
 * container at `/run/secrets/<name>` and unlinks it on exit.
 *
 * Storage location: `/dev/shm` on Linux (tmpfs — never hits the disk),
 * `os.tmpdir()` everywhere else (macOS APFS, Windows). On Linux this
 * means a wrapper crash before unlink leaves the secret in RAM only.
 */
export function makeSecretFile(value: string, scope: string = 'huu-secret'): string {
  const shm = '/dev/shm';
  const baseDir = existsSync(shm) ? shm : tmpdir();
  const rand = randomBytes(8).toString('hex');
  const path = join(baseDir, `${scope}-${process.pid}-${rand}`);
  writeFileSync(path, value, { mode: 0o600 });
  return path;
}

/**
 * Spawn docker run, install signal traps, propagate exit code.
 *
 * Returns a Promise that resolves with the exit code. Caller is expected
 * to call `process.exit(code)` after — we don't do it here so unit tests
 * can inspect the result.
 */
export async function reexecInDocker(args: string[]): Promise<number> {
  if (!isDockerInstalled()) {
    process.stderr.write(
      'huu: docker is not installed.\n\n' +
        'huu uses Docker by default to isolate LLM agents from your shell\n' +
        'credentials (~/.ssh, ~/.aws, ~/.npmrc tokens, etc.). Install Docker:\n' +
        '  https://docs.docker.com/engine/install/\n\n' +
        'Or set HUU_NO_DOCKER=1 to bypass and run huu natively. The native\n' +
        'path requires Node ≥ 18 and a working git, plus all of huu\'s npm\n' +
        'dependencies, and the agent will see your shell credentials.\n',
    );
    return 127;
  }

  // Best-effort orphan sweep before starting a new run.
  pruneOrphans();

  // Friendly first-run UX: warn the user that the next ~30s is a pull,
  // not a hang. docker run pulls implicitly on demand and prints its
  // own progress, but without context the silence-then-progress-bar
  // sequence is confusing to a new user.
  const image = process.env.HUU_IMAGE ?? DEFAULT_IMAGE;
  if (!imageIsLocal(image)) {
    process.stderr.write(
      `huu: pulling ${image} (~600MB, first time only — subsequent runs are instant)\n`,
    );
  }

  const cidfile = makeCidfilePath();

  // Hand OPENROUTER_API_KEY to the container as a bind-mounted secret
  // file rather than via -e KEY=value. The container's resolver already
  // checks /run/secrets/openrouter_api_key first (lib/api-key.ts). This
  // keeps the value out of `docker inspect` AND off process listings.
  const secretMounts: SecretMount[] = [];
  const excludeFromEnv = new Set<string>();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    secretMounts.push({
      hostPath: makeSecretFile(apiKey, 'huu-openrouter-key'),
      containerPath: '/run/secrets/openrouter_api_key',
    });
    excludeFromEnv.add('OPENROUTER_API_KEY');
  }

  const argv = buildDockerArgv({
    cwd: process.cwd(),
    image,
    cidfile,
    args,
    hasTTY: Boolean(process.stdin.isTTY),
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    gid: typeof process.getgid === 'function' ? process.getgid() : 0,
    secretMounts,
    excludeFromEnv,
  });

  const child = spawn('docker', argv, { stdio: 'inherit' });

  let killed = false;
  const killContainer = (signal: NodeJS.Signals): void => {
    if (killed) return;
    killed = true;
    // Read the cid recorded by docker run --cidfile. May not yet exist
    // if the user hammered Ctrl+C before docker had a chance to start.
    let cid = '';
    try {
      // Wait briefly for the cidfile to materialize. Docker writes it
      // very early in the run, but there's a small race window.
      for (let i = 0; i < 20 && !cid; i++) {
        try {
          if (existsSync(cidfile)) {
            cid = readFileSync(cidfile, 'utf8').trim();
            if (cid) break;
          }
        } catch {
          /* ignore */
        }
        // Tight sleep without using setTimeout (we may be in a sync
        // signal handler). 50ms total max.
        const end = Date.now() + 5;
        while (Date.now() < end) {
          /* spin */
        }
      }
    } catch {
      /* ignore */
    }
    if (cid) {
      // SIGTERM by default; the container's tini forwards to huu's
      // signal-exit cleanup chain, which restores the terminal and
      // drops the active-run sentinel before exiting.
      spawnSync('docker', ['kill', '--signal', signal === 'SIGINT' ? 'INT' : 'TERM', cid], {
        stdio: 'ignore',
      });
    } else {
      // No cid yet → docker run is still starting. Killing the docker
      // client itself is the only lever we have.
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    }
  };

  // Trap host signals. moby#28872 means we can't trust docker's own
  // sig-proxy with -t attached; explicit kill is the reliable path.
  process.on('SIGINT', () => killContainer('SIGINT'));
  process.on('SIGTERM', () => killContainer('SIGTERM'));
  process.on('SIGHUP', () => killContainer('SIGHUP'));

  // Wait for the child to exit, then clean up.
  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => {
      // Code 130 = 128 + SIGINT (2), 143 = 128 + SIGTERM (15), etc.
      // Match the shell convention so callers can branch on it.
      if (signal) resolve(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
      else resolve(code ?? 0);
    });
    child.on('error', (err) => {
      process.stderr.write(`huu: failed to spawn docker: ${err.message}\n`);
      resolve(127);
    });
  });

  // Cleanup cidfile (docker --rm already removed the container).
  try {
    if (existsSync(cidfile)) unlinkSync(cidfile);
  } catch {
    /* ignore */
  }
  // Cleanup any secret files we created. The container is gone, so the
  // bind mount is gone with it; the host file is now harmless to remove.
  for (const m of secretMounts) {
    try {
      if (existsSync(m.hostPath)) unlinkSync(m.hostPath);
    } catch {
      /* ignore */
    }
  }

  return exitCode;
}
