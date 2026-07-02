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
import { homedir, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { API_KEY_REGISTRY, resolveApiKeyWithSource } from './api-key.js';
import { osReserveBytes } from './budget.js';

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

/**
 * Standard docker bridge MTU. If the host's default-route MTU is
 * smaller (typical of VPN tunnels: WireGuard ~1420, OpenVPN ~1500-overhead,
 * Tailscale ~1280), the bridge silently drops TLS ClientHello packets
 * larger than the tunnel and every HTTPS handshake hangs. We
 * auto-create a per-MTU docker network when this is the case.
 */
const DOCKER_BRIDGE_DEFAULT_MTU = 1500;
/** Floor — below this we don't bother creating a network and just refuse politely. */
const MIN_USABLE_MTU = 576;

/**
 * Detect the MTU of the host interface carrying the default IPv4 route.
 * Linux-only (parses `ip route get` + `/sys/class/net/<iface>/mtu`).
 * Returns null on any platform where we can't determine it cheaply —
 * caller falls back to the docker default bridge in that case.
 */
export function detectDefaultRouteMtu(): number | null {
  // `ip` only ships on Linux distros by default; macOS/Windows Docker
  // Desktop runs on top of a VM that hides the host's networking, so
  // probing host MTU there is meaningless anyway.
  if (process.platform !== 'linux') return null;
  const r = spawnSync('ip', ['route', 'get', '1.1.1.1'], { encoding: 'utf8', timeout: 2000 });
  if (r.status !== 0 || !r.stdout) return null;
  // Sample output: "1.1.1.1 dev surfshark_wg table 300000 src 10.14.0.2 uid 1000"
  // or:           "1.1.1.1 via 192.168.1.1 dev wlp0s20f3 src 192.168.1.42 uid 1000"
  const m = /\bdev\s+(\S+)/.exec(r.stdout);
  if (!m) return null;
  const iface = m[1]!;
  try {
    const mtu = Number(readFileSync(`/sys/class/net/${iface}/mtu`, 'utf8').trim());
    return Number.isFinite(mtu) && mtu >= MIN_USABLE_MTU ? mtu : null;
  } catch {
    return null;
  }
}

/**
 * Ensure a docker bridge network exists with the requested MTU and
 * return its name. Idempotent — networks are named by MTU so multiple
 * concurrent VPN configurations don't collide and old networks linger
 * harmlessly. Returns null if the docker command fails (no daemon
 * permission, etc.) — caller falls back to the default bridge.
 */
export function ensureHuuDockerNetwork(mtu: number): string | null {
  const name = `huu-net-mtu${mtu}`;
  // Cheap fast-path: if it already exists, reuse.
  const inspect = spawnSync('docker', ['network', 'inspect', name], { stdio: 'ignore' });
  if (inspect.status === 0) return name;
  const create = spawnSync('docker', [
    'network', 'create',
    '--driver', 'bridge',
    '--opt', `com.docker.network.driver.mtu=${mtu}`,
    '--label', ORPHAN_LABEL,
    name,
  ], { stdio: 'ignore' });
  return create.status === 0 ? name : null;
}

/**
 * Decide the value for `docker run --network=…`. Resolution order:
 *   1. `HUU_DOCKER_NETWORK` env (explicit override, any value passed verbatim).
 *   2. Linux + default-route MTU < 1500 → auto-create / reuse `huu-net-mtu<N>`.
 *   3. Otherwise undefined → docker default bridge.
 *
 * Step 2 is what makes huu "just work" on VPN without the user opting in.
 * Exposed for testing.
 */
export function pickDockerNetwork(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = env.HUU_DOCKER_NETWORK?.trim();
  if (explicit) return explicit;
  const mtu = detectDefaultRouteMtu();
  if (mtu === null || mtu >= DOCKER_BRIDGE_DEFAULT_MTU) return undefined;
  const name = ensureHuuDockerNetwork(mtu);
  return name ?? undefined;
}

/**
 * `docker run` memory-limit flags derived from the host (the wrapper runs
 * host-side). `--memory` → cgroup memory.max; `--memory-swap` = memory + a
 * bounded swap allowance (HUU_SWAP_MAX_MB, default 4096 — 0 pins swap off for
 * the container). Pure over env + injectable total so tests drive it directly.
 */
export function buildMemoryLimitArgs(
  env: NodeJS.ProcessEnv = process.env,
  totalBytes: number = totalmem(),
): string[] {
  if (env.HUU_NO_MEM_LIMIT === '1' || env.HUU_NO_MEM_LIMIT === 'true') return [];
  const mib = 1024 * 1024;
  const overrideMb = Number(env.HUU_DOCKER_MEMORY_MB?.trim() || NaN);
  const memoryBytes =
    Number.isFinite(overrideMb) && overrideMb > 0
      ? Math.floor(overrideMb) * mib
      : Math.max(512 * mib, Math.floor(totalBytes - osReserveBytes(totalBytes, env)));
  const rawSwap = Number(env.HUU_SWAP_MAX_MB?.trim() || NaN);
  const swapAllowanceBytes =
    (Number.isFinite(rawSwap) && rawSwap >= 0 ? Math.floor(rawSwap) : 4096) * mib;
  return [
    '--memory',
    String(memoryBytes),
    '--memory-swap',
    String(memoryBytes + swapAllowanceBytes),
    '--pids-limit',
    '8192',
  ];
}

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
  // CLI aliases for HUU_NO_DOCKER=1. Listed before the env check so the flag
  // wins regardless of env: a user typing `--yolo` is making an explicit,
  // visible choice that should not be overridden by stale shell state.
  // `--no-docker` is the neutral spelling for CI runners, where the runner
  // is already an ephemeral container and Docker-in-Docker is unavailable.
  if (args.includes('--yolo')) {
    return { shouldReexec: false, reason: '--yolo flag — running native (no Docker isolation)' };
  }
  if (args.includes('--no-docker')) {
    return { shouldReexec: false, reason: '--no-docker flag — running native (no Docker isolation)' };
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
  /**
   * Additional host paths to bind-mount read-write, same path host and
   * container. Computed by `preflightGitOnHost` to expose the parent
   * repo's `.git` (worktree case) or a parent toplevel (subdir case).
   * git needs to write into `.git/worktrees/<name>/HEAD` etc., so the
   * mount is rw, not ro.
   */
  extraMounts?: string[];
  /**
   * `docker run --network=<value>`. Opt-in via `HUU_DOCKER_NETWORK`.
   * Use case: VPN users (WireGuard/OpenVPN) whose tunnel MTU is below
   * 1500 — the default `docker0` bridge silently drops large TLS
   * ClientHello packets, manifesting as "Request timed out" on every
   * agent. Setting `host` makes the container share the host netns and
   * inherit MSS-clamping. Omitted → docker default (bridge).
   */
  network?: string;
  /**
   * TCP ports to publish host→container (`docker run -p <p>:<p>`). Used by
   * web-UI mode so the browser on the host reaches the server that runs
   * INSIDE the container. Same number both sides — the container binds the
   * port it's told via HUU_WEB_PORT (forwarded through the passthrough env
   * set). Empty/omitted for the TUI (CLI) path.
   */
  publishPorts?: number[];
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
  if (opts.network) argv.push('--network', opts.network);
  // Kernel memory ceiling for the container (cgroup memory.max via --memory):
  // an unlimited container can consume 100% of host RAM and freeze the box —
  // the 33-run incident class. Sized like the native systemd scope: host total
  // minus the adaptive OS reserve, plus a bounded swap allowance. Worst case
  // becomes "the container dies with 137" instead of "the host dies".
  // HUU_DOCKER_MEMORY_MB overrides; HUU_NO_MEM_LIMIT=1 restores the old
  // unlimited behavior. --pids-limit is the runaway-fork backstop.
  for (const flag of buildMemoryLimitArgs(process.env)) argv.push(flag);
  // Publish the web-UI port(s) so the host browser can reach the in-container
  // server. Bound to the same number inside (HUU_WEB_PORT) and out.
  for (const port of opts.publishPorts ?? []) {
    argv.push('-p', `${port}:${port}`);
  }
  argv.push(
    '--cidfile', opts.cidfile,
    '--user', `${opts.uid}:${opts.gid}`,
    '--label', ORPHAN_LABEL,
    '--label', `huu.parent-pid=${process.pid}`,
    '-v', `${opts.cwd}:${opts.cwd}`,
    '-w', opts.cwd,
  );

  // Extra mounts discovered by the host-side git preflight: parent repo
  // .git for the worktree case, parent toplevel for the subdirectory
  // case. Same path host and container so absolute paths the .git file
  // points at resolve identically inside.
  for (const path of opts.extraMounts ?? []) {
    argv.push('-v', `${path}:${path}`);
  }

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
  const passthrough = new Set<string>([
    'HUU_CHECK_PUSH', 'HUU_WORKTREE_BASE', 'TERM',
    // Web-UI knobs: the in-container server must bind the SAME port the
    // wrapper published, and honor the host's front-end + token choices.
    'HUU_WEB_PORT', 'HUU_WEB_HOST', 'HUU_WEB_TOKEN', 'HUU_CLI',
    // Tells the in-container code (via getHuuHome()) where the host's
    // home is, so writes to `~/.huu/` and `~/Downloads/` land on the
    // bind-mounted host filesystem instead of the container's ephemeral
    // $HOME. Paired with the host-home bind mounts added below.
    'HUU_HOST_HOME',
    // Host git identity — populated by resolveHostGitIdentity() so the
    // container inherits the same author/committer as the host user.
    'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
    // Hermetic-pi escape hatch + RAM-tuning knobs must reach the in-container
    // orchestrator. Deliberately NOT forwarding PI_CODING_AGENT_DIR: the
    // container has no host ~/.pi to leak from, and the hermetic composition
    // sets its own huu-owned dir.
    'HUU_PI_HERMETIC', 'HUU_AGENT_MEM_SEED_MB', 'HUU_AGENT_MEM_EMA_ALPHA',
    // RAM-safety knobs (dial, guard ladder, admission, OS reserve, pause) —
    // set on the host, they must govern the in-container scheduler too.
    // (Before this passthrough a host HUU_RAM_PERCENT was silently ignored
    // inside the container.)
    'HUU_RAM_PERCENT', 'HUU_OOM_SCORE_ADJ', 'HUU_NO_PAUSE', 'HUU_OS_RESERVE_MB',
    'HUU_MAX_LIVE_RUNS', 'HUU_MAX_QUEUED_RUNS', 'HUU_RUN_BASELINE_MB',
    'HUU_GUARD_AVAIL_PCT', 'HUU_GUARD_SWAP_FREE_PCT',
    'HUU_GUARD_AVAIL_PCT_EMERGENCY', 'HUU_GUARD_SWAP_FREE_PCT_EMERGENCY',
    'HUU_GUARD_PSI_FULL_HIGH', 'HUU_GUARD_PSI_FULL_EMERGENCY',
    'HUU_GUARD_SWAPIN_PAGES_SEC', 'HUU_GUARD_SWAPIN_SUSTAIN_MS',
    'HUU_GUARD_OVER_BUDGET_MS', 'HUU_GUARD_DESTROY_PCT', 'HUU_GUARD_L1_REPREEMPT_MS',
  ]);
  // Every API key spec contributes both `<NAME>` and `<NAME>_FILE` to the
  // passthrough — secret-mounting (when present) supersedes it via
  // excludeFromEnv, but we still want the `_FILE` path forwarded for the
  // dev-only path where the user mounts a file outside Docker.
  for (const spec of API_KEY_REGISTRY) {
    passthrough.add(spec.envVar);
    passthrough.add(spec.envFileVar);
  }
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

/**
 * Read the host git user.name / user.email (respecting local > global >
 * system chain) and populate GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL,
 * GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL so they flow into the
 * container via the passthrough set.
 *
 * Only sets a var when it is not already in the environment -- explicit env
 * from the caller always wins.
 */
export function resolveHostGitIdentity(): void {
  const pairs: [string, string, string][] = [
    ['user.name', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME'],
    ['user.email', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL'],
  ];
  for (const [key, authorVar, committerVar] of pairs) {
    if (process.env[authorVar] && process.env[committerVar]) continue;
    const r = spawnSync('git', ['config', key], { encoding: 'utf8', timeout: 3000 });
    const val = r.stdout?.trim();
    if (!val) continue;
    if (!process.env[authorVar]) process.env[authorVar] = val;
    if (!process.env[committerVar]) process.env[committerVar] = val;
  }
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
    // sweeping so /dev/shm doesn't accumulate forever. The registry
    // owns the list of scope prefixes — adding a new key here is
    // automatic.
    const scopePatterns = API_KEY_REGISTRY.map(
      (s) => new RegExp(`^${escapeRegex(s.hostSecretScope)}-(\\d+)-`),
    );
    for (const dir of ['/dev/shm', tmpdir()]) {
      try {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
          let pid: number | null = null;
          for (const re of scopePatterns) {
            const m = re.exec(name);
            if (m) {
              pid = Number(m[1]);
              break;
            }
          }
          if (pid === null) continue;
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

export interface ReexecOptions {
  /** Extra host paths to bind-mount (forwarded to buildDockerArgv). */
  extraMounts?: string[];
  /**
   * TCP ports to publish host→container. Web-UI mode passes the resolved
   * web port so the host browser reaches the in-container server.
   */
  publishPorts?: number[];
}

/**
 * Spawn docker run, install signal traps, propagate exit code.
 *
 * Returns a Promise that resolves with the exit code. Caller is expected
 * to call `process.exit(code)` after — we don't do it here so unit tests
 * can inspect the result.
 */
export async function reexecInDocker(
  args: string[],
  opts: ReexecOptions = {},
): Promise<number> {
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

  // Capture the host git identity (user.name / user.email) as env vars
  // so the container's git commits are attributed to the same person.
  resolveHostGitIdentity();

  // Persist huu state on the host: bind-mount `~/.huu` (and `~/Downloads`
  // when it exists) into the container at the same absolute path. The
  // in-container code reads HUU_HOST_HOME via getHuuHome() to resolve
  // saves to these host-side paths. Without this, "save pipeline" lands
  // in the container's ephemeral $HOME and is wiped by `docker run --rm`.
  //
  // Targeted mounts only — never the full $HOME — so the agent can't read
  // ~/.ssh, ~/.aws, ~/.npmrc tokens. That's the whole point of Docker
  // isolation here (see file header).
  const hostHome = homedir();
  const hostHuuDir = join(hostHome, '.huu');
  if (!existsSync(hostHuuDir)) {
    mkdirSync(hostHuuDir, { recursive: true, mode: 0o700 });
  }
  const hostHomeMounts: string[] = [hostHuuDir];
  const hostDownloadsDir = join(hostHome, 'Downloads');
  if (existsSync(hostDownloadsDir)) {
    hostHomeMounts.push(hostDownloadsDir);
  }
  process.env.HUU_HOST_HOME = hostHome;

  const cidfile = makeCidfilePath();

  // For every API key in the registry, hand the value to the container
  // as a bind-mounted secret file rather than via -e KEY=value. The
  // container's resolver already checks `spec.secretMountPath` first
  // (lib/api-key.ts). Two wins over plain env:
  //   1. Value stays out of `docker inspect`.
  //   2. Value stays off `ps`/proc listings.
  //
  // resolveApiKey() walks secret-mount → global config store → `_FILE` → env,
  // so a key the user persisted in `~/.config/huu/config.json` wins over a
  // stale shell `OPENROUTER_API_KEY` and is forwarded automatically without
  // having to re-enter it.
  const secretMounts: SecretMount[] = [];
  const excludeFromEnv = new Set<string>();
  for (const spec of API_KEY_REGISTRY) {
    const res = resolveApiKeyWithSource(spec);
    if (!res.value) continue;
    // The saved key now takes precedence over the env var. When a saved key
    // wins while a DIFFERENT env var is also set, say so here on the host —
    // otherwise a user who expected the env var to apply is left wondering
    // why huu used another key (the in-container resolver can't see this,
    // since the key arrives pre-resolved via the secret mount).
    if (res.storedOverridesEnv) {
      process.stderr.write(
        `huu: note: ${spec.envVar} is set in your environment, but huu is using the ` +
          `${spec.label} key you saved in Options (a saved key takes precedence) — forwarding the ` +
          `saved key into the container. Clear the saved key in Options to use ${spec.envVar} instead.\n`,
      );
    }
    secretMounts.push({
      hostPath: makeSecretFile(res.value, spec.hostSecretScope),
      containerPath: spec.secretMountPath,
    });
    excludeFromEnv.add(spec.envVar);
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
    extraMounts: [...(opts.extraMounts ?? []), ...hostHomeMounts],
    network: pickDockerNetwork(),
    publishPorts: opts.publishPorts,
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
