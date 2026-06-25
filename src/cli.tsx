#!/usr/bin/env node
// Top-level docker re-exec gate. Must be evaluated BEFORE the Ink/React
// imports below so that on the host (re-exec path) we don't pay the
// cost of mounting React or pulling in the LLM SDKs we never use.
//
// The check is intentionally placed before any other side-effect:
// running `huu` in a host shell should be indistinguishable from
// running it inside the container — the only thing the user notices
// is a slightly slower first invocation while the image pulls.
import { resolve as resolvePath } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { decideReexec, reexecInDocker } from './lib/docker-reexec.js';
import { API_KEY_REGISTRY, configFilePath } from './lib/api-key.js';
import { preflightGitOnHost } from './lib/git-preflight.js';
// Pure, dependency-light: safe to load on the wrapper path without pulling
// in React/Ink (which we deliberately avoid until after the re-exec gate).
import { decideInterfaceMode, resolveWebPort } from './web/interface-mode.js';

// `--dir=<path>` chooses WHERE to run — the default is the current directory.
// Honor it at the very top (before the Docker gate) so every downstream
// consumer — the container mount, the host git preflight, the web/headless
// working dir and the TUI repo root — sees the chosen directory through
// `process.cwd()`. Runtime folder-picking (web/TUI) threads a per-run cwd
// instead; this flag only moves the process baseline.
{
  const dirArg = process.argv.slice(2).find((a) => a.startsWith('--dir='));
  if (dirArg) {
    const target = resolvePath(dirArg.slice('--dir='.length));
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      process.stderr.write(`huu: --dir=${target}: not a directory\n`);
      process.exit(1);
    }
    process.chdir(target);
  }
}

const reexec = decideReexec(process.argv.slice(2), process.env);
if (reexec.shouldReexec) {
  // Host-side git preflight: fail fast BEFORE pulling/launching docker.
  // Also discovers any git paths (worktree common-dir, parent toplevel)
  // that the wrapper must additionally bind-mount so `git` resolves
  // inside the container with only `-v <cwd>:<cwd>` otherwise in effect.
  const pre = preflightGitOnHost(process.cwd());
  if (!pre.ok) {
    process.stderr.write(pre.message);
    process.exit(1);
  }
  // Web is the default front-end. When the run will land in the container,
  // publish the web port so the host browser reaches the in-container
  // server, and pin HUU_WEB_PORT so both sides agree on the number.
  const webMode = decideInterfaceMode(process.argv.slice(2), process.env) === 'web';
  const webPort = resolveWebPort(process.argv.slice(2), process.env);
  if (webMode) {
    process.env.HUU_WEB_PORT = String(webPort);
    process.stderr.write(
      `\nhuu: launching the web UI inside Docker — open ` +
        `\x1b[1mhttp://localhost:${webPort}\x1b[0m once the container is up ` +
        `(a few seconds on first run, longer while the image pulls).\n` +
        `     Prefer the terminal UI? Run \x1b[1mhuu --cli\x1b[0m.\n\n`,
    );
  }
  // Top-level await is fine here: tsconfig targets ES2022 / ESNext
  // module, both of which support it. The await blocks the rest of the
  // module from evaluating, so none of the React/Ink imports below
  // ever load when we're going to re-exec.
  const code = await reexecInDocker(process.argv.slice(2), {
    extraMounts: pre.extraGitMounts,
    publishPorts: webMode ? [webPort] : [],
  });
  process.exit(code);
}

import { execFileSync } from 'node:child_process';
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { importPipeline } from './lib/pipeline-io.js';
import { runInitDockerCli } from './lib/init-docker.js';
import { runStatusCli } from './lib/status.js';
import { runPruneCli } from './lib/prune.js';
import { loadRunConfig, applyRunConfig } from './lib/run-config.js';
import { runHeadless } from './lib/headless-run.js';
import { findSpec, resolveApiKey } from './lib/api-key.js';
import {
  clearActiveRunSentinel,
  writeActiveRunSentinel,
} from './lib/active-run-sentinel.js';
import {
  selectBackend,
  parseBackendKind,
  ALL_BACKENDS,
  type AgentBackendKind,
} from './orchestrator/backends/registry.js';
import { parseProvider, providerToBackend } from './lib/providers.js';
import type { AppConfig, Pipeline, LlmProvider } from './lib/types.js';
import { installSafeTerminal } from './ui/safe-terminal.js';
import { initDebugLogger, log as dlog } from './lib/debug-logger.js';
import { enqueueProcessLog } from './lib/process-log-bridge.js';
import { startWebServer } from './web/serve.js';
import { EventEmitter } from 'node:events';

// Subcommands that don't render the TUI shouldn't pay the side-effects
// of the lifecycle logger (creating .huu/) or terminal restorers. We
// detect them BEFORE initializing those layers — the user expects a
// scaffolding command to be a quiet Unix citizen.
const NON_TUI_SUBCOMMANDS = new Set(['init-docker', 'status', 'prune']);
const firstNonFlagArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const isNonTui = firstNonFlagArg !== undefined && NON_TUI_SUBCOMMANDS.has(firstNonFlagArg);

if (!isNonTui) {
  // Init the debug logger BEFORE installSafeTerminal so the SIGINT/exit
  // handlers from both layers are recorded in order. Logger writes to
  // `<cwd>/.huu/debug-<ISO>.log` so a freeze leaves a complete trail.
  initDebugLogger(process.cwd());

  // Install BEFORE render() so even a crash during initial mount restores
  // the terminal. Ink's signal-exit covers clean unmounts, but uncaught
  // rejections from the orchestrator (e.g., a worktree teardown failure
  // during the summary transition) can land outside ink's reach.
  installSafeTerminal();

  // Record the cwd of this run at /tmp/huu/active so a Docker
  // HEALTHCHECK probe (which runs from / with no inherited WORKDIR)
  // can find the .huu/debug-*.log to inspect. Cleared by the exit
  // handlers below.
  writeActiveRunSentinel(process.cwd());
}

/**
 * Hard-fail if `cwd` is not inside a git repository. huu's whole model
 * is "isolate each agent in a worktree" — without git there's nothing
 * to branch from.
 *
 * Authoritative gate is `preflightGitOnHost` at the top of this file
 * (runs BEFORE the docker re-exec). This function remains as a defensive
 * backup for the in-container path and for `--yolo` native runs, where
 * the host preflight didn't fire (`shouldReexec === false`).
 *
 * If `git` itself isn't on PATH (ENOENT), defer to upstream: an ENOENT
 * inside the container would be a packaging bug; on the host with --yolo
 * we let the orchestrator's git layer surface the real error.
 */
function ensureGitRepoOrExit(cwd: string): void {
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return;
    process.stderr.write(
      `huu: not a git repository: ${cwd}\n` +
        `huu runs each agent in an isolated git worktree, so it requires a repo.\n` +
        `Run 'git init' here, or cd into an existing repo, then try again.\n`,
    );
    process.exit(1);
  }
}

function printUsage(): void {
  const envLines = API_KEY_REGISTRY.map(
    (s) => `  ${s.envVar.padEnd(34)} ${s.label} key. Asked in the TUI when missing.`,
  ).join('\n');
  console.log(`huu — Humans Underwrite Undertakings · guided pipeline execution TUI with kanban

Usage:
  huu                       Open the web UI (default) — dashboard in your browser
  huu --cli                 Open the terminal UI (Ink TUI) instead of the web UI
  huu run <pipeline.json>   Preload a pipeline (web UI, or TUI model picker with --cli)
  huu auto <p.json> --config <c.json>
                            Headless run — no TUI. Config JSON supplies
                            model, backend, per-step file selection.
  huu init-docker [...]     Scaffold compose.huu.yaml into the current repo
  huu status [...]          Inspect the latest run via .huu/debug-*.log
  huu prune [...]           List/kill orphan huu containers + stale cidfiles
  huu --dir=<path>          Run in this directory instead of the current one (default: cwd)
  huu --provider=<name>     Pick the LLM provider for pi: openrouter (default), azure
  huu --backend=<kind>      Advanced: pick dispatch backend pi (default), azure, stub
  huu --stub                Alias for --backend=stub (no real LLM)
  huu --yolo                Skip Docker, run native on the host (agent sees your shell creds)
  huu --no-docker           Alias for --yolo / HUU_NO_DOCKER=1 — neutral spelling for CI runners
  huu --cli                 Use the terminal UI instead of the default web UI
  huu --web                 Force the web UI (overrides HUU_CLI=1)
  huu --port=<n>            Web UI port (default 4888; or HUU_WEB_PORT)
  huu --concurrency=<n>     Pin manual concurrency at n (disables memory-based auto-scale)
  huu --no-auto-scale       Disable memory-based auto-scale (on by default; guard stays on)
  huu --auto-scale          Deprecated: auto-scale is now the default
  huu --help                Show this help

init-docker flags:
  --force                   Overwrite files that already exist
  --with-wrapper            Also write scripts/huu-docker (bash launcher)
  --with-devcontainer       Also write .devcontainer/devcontainer.json
  --image <ref>             Override the image reference (default: ghcr.io/frederico-kluser/huu:latest)

status flags:
  --json                    Machine-readable output
  --liveness                Suppress output; exit 0 if running, 1 otherwise (HEALTHCHECK use)
  --stalled-after <sec>     Stall threshold (default: 30)

prune flags:
  --list                    Show containers + stale cidfiles, exit 0 (no mutation)
  --dry-run                 Show what 'huu prune' WOULD kill, exit 0 (no mutation)
  --json                    Machine-readable output (combines with --list / --dry-run)

Environment:
${envLines}
  HUU_WEB_PORT                       Web UI port (default 4888). Same as --port=<n>.
  HUU_WEB_HOST                       Web UI bind address (default 0.0.0.0; set 127.0.0.1 for localhost-only).
  HUU_WEB_TOKEN                      Require this shared secret (?token=…) for the web UI's data + actions.
  HUU_CLI                            Set to 1 to default to the terminal UI (same as --cli).

Persisted globally at: ${configFilePath()}
(written when you accept "Save globally" in the TUI prompt; mode 0600).
`);
}

// Belt-and-suspenders terminal restore. Ink's componentWillUnmount already
// disables raw mode and shows the cursor on a clean exit, but it relies on
// React's reconciler running cleanups synchronously inside signal-exit. On
// uncaughtException, SIGTERM, EPIPE during a child execSync, or any path
// where the React tree is torn down asynchronously, the terminal can be left
// in raw mode with the cursor hidden — making the user's shell appear
// "stuck" (typed keys don't echo, no cursor) until they run `stty sane` or
// reopen the terminal. These handlers force-restore the bare minimum (raw
// mode off, cursor visible, mouse tracking off) on every exit path.
let terminalRestored = false;
function restoreTerminal(): void {
  if (terminalRestored) return;
  terminalRestored = true;
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
  } catch {
    /* best effort */
  }
  try {
    if (process.stdout.isTTY) {
      // Show cursor + disable any mouse tracking modes that might have been
      // enabled by a third-party Ink component or a stray ANSI sequence.
      process.stdout.write('\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l');
    }
  } catch {
    /* best effort */
  }
  // Drop the HEALTHCHECK sentinel as part of the exit dance. Cheap,
  // best-effort, and prevents stale pointers if the same /tmp survives
  // between runs (rare outside containers, but possible).
  if (!isNonTui) {
    clearActiveRunSentinel(process.cwd());
  }
}

process.on('exit', restoreTerminal);
process.on('SIGINT', () => {
  restoreTerminal();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restoreTerminal();
  process.exit(143);
});
process.on('SIGHUP', () => {
  restoreTerminal();
  process.exit(129);
});
process.on('uncaughtException', (err) => {
  restoreTerminal();
  // Bypass any console patch: fatal errors must reach the terminal even
  // after installLogCaptures() has redirected console.* into the LogArea.
  process.stderr.write(`uncaughtException: ${err?.stack ?? String(err)}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  restoreTerminal();
  process.stderr.write(`unhandledRejection: ${String(reason)}\n`);
  process.exit(1);
});

// Installed exactly once. Idempotent so accidental re-entry is harmless.
let logCapturesInstalled = false;

/**
 * Redirect Node `warning` events and every `console.*` call into the
 * process log bridge so they surface inside LogArea (the "Logs (all)"
 * panel) instead of bleeding above the Ink frame and corrupting the
 * rendered kanban.
 *
 * Must run BEFORE `render(<App />, { patchConsole: false })` — flipping
 * Ink's patchConsole off without our own console patch in place would
 * let any stray `console.log` mangle the rendered frame directly.
 */
function installLogCaptures(): void {
  if (logCapturesInstalled) return;
  logCapturesInstalled = true;

  // Most MaxListenersExceededWarning hits in this codebase are benign:
  // workers + integrators all subscribe to the same abort/signal emitter
  // for the duration of a stage. Bump the default cap so the warning
  // stops firing in the common case; a real leak (>32) still surfaces
  // through the warning hook below.
  EventEmitter.defaultMaxListeners = 32;

  // Node attaches a default 'warning' listener that prints to stderr;
  // that print is exactly what bleeds above the kanban. Drop it before
  // adding ours so the warning surfaces ONLY in LogArea + debug log.
  // (Setting NODE_NO_WARNINGS at runtime is a no-op — Node caches it at
  // process start, so we have to take ownership of the listener instead.)
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    const msg = w.stack ? `${w.name}: ${w.message}\n${w.stack}` : `${w.name}: ${w.message}`;
    enqueueProcessLog({ level: 'warn', source: 'node-warning', message: msg });
    try {
      dlog('warning', w.name, { msg: w.message, stack: w.stack });
    } catch {
      /* debug-logger may not be initialized yet (unlikely on this path) */
    }
  });

  // Patch every console method. Originals are captured for *this scope
  // only* — we deliberately don't re-export them. Any code path that
  // legitimately needs to write to the terminal after this point should
  // use process.stderr.write/process.stdout.write directly (see the
  // fatal-path handlers at the top of this file).
  const LEVEL_MAP: Record<string, 'info' | 'warn' | 'error' | 'debug'> = {
    log: 'info',
    info: 'info',
    warn: 'warn',
    error: 'error',
    debug: 'debug',
  };
  const format = (args: unknown[]): string =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack ?? a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');

  for (const method of Object.keys(LEVEL_MAP) as Array<keyof typeof LEVEL_MAP>) {
    const level = LEVEL_MAP[method];
    (console as unknown as Record<string, (...a: unknown[]) => void>)[method] = (
      ...args: unknown[]
    ): void => {
      const msg = format(args);
      enqueueProcessLog({ level, source: 'console', message: msg });
      try {
        dlog('console', method, { msg });
      } catch {
        /* same */
      }
    };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useStub = args.includes('--stub');
  const useYolo = args.includes('--yolo') || args.includes('--no-docker');
  const concurrencyArg = args
    .filter((a) => a.startsWith('--concurrency='))
    .map((a) => Number(a.slice('--concurrency='.length)))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .map((n) => Math.floor(n))
    .pop();
  // Memory-aware auto-scale is the DEFAULT. --no-auto-scale pins manual
  // concurrency; --concurrency=N alone also pins manual at N (adding the
  // legacy --auto-scale flag keeps auto mode and only seeds the start
  // value). The memory guard runs in both modes.
  const autoScale = args.includes('--no-auto-scale')
    ? false
    : concurrencyArg !== undefined
      ? args.includes('--auto-scale')
      : true;

  // --provider=<name> picks the LLM provider for pi (openrouter | azure).
  const providerArg = args
    .filter((a) => a.startsWith('--provider='))
    .map((a) => a.slice('--provider='.length))
    .pop();
  let providerFromCli: LlmProvider | null = null;
  if (providerArg !== undefined) {
    const parsed = parseProvider(providerArg);
    if (!parsed) {
      console.error(`huu: --provider=${providerArg}: unknown provider. Valid: openrouter, azure`);
      process.exit(1);
    }
    providerFromCli = parsed;
  }

  // --backend=<kind> takes precedence over --provider/--stub aliases. Last wins
  // so the user can override an alias they pre-set somewhere.
  const backendArg = args
    .filter((a) => a.startsWith('--backend='))
    .map((a) => a.slice('--backend='.length))
    .pop();

  let backendKindFromCli: AgentBackendKind | null = null;
  if (backendArg !== undefined) {
    const parsed = parseBackendKind(backendArg);
    if (!parsed) {
      console.error(
        `huu: --backend=${backendArg}: unknown backend. Valid: ${ALL_BACKENDS.join(', ')}`,
      );
      process.exit(1);
    }
    backendKindFromCli = parsed;
  } else if (providerFromCli) {
    backendKindFromCli = providerToBackend(providerFromCli);
  } else if (useStub) {
    backendKindFromCli = 'stub';
  }

  // These flags are CLI-only; the rest of the pipeline (subcommand dispatch,
  // pipeline import) must not see them.
  const filtered = args.filter(
    (a) =>
      a !== '--stub' &&
      a !== '--yolo' &&
      a !== '--no-docker' &&
      a !== '--auto-scale' &&
      a !== '--no-auto-scale' &&
      a !== '--cli' &&
      a !== '--tui' &&
      a !== '--web' &&
      !a.startsWith('--backend=') &&
      !a.startsWith('--provider=') &&
      !a.startsWith('--dir=') &&
      !a.startsWith('--concurrency=') &&
      !a.startsWith('--port='),
  );

  if (filtered.includes('--help') || filtered.includes('-h')) {
    printUsage();
    return;
  }

  // The Docker bypass already happened in decideReexec at the top of this
  // file. The warning surfaces the security trade-off the user just opted
  // into, mirroring the message in reexecInDocker for the inverse case.
  // Suppressed inside the container because --yolo would be a no-op there.
  if (useYolo && process.env.HUU_IN_CONTAINER !== '1') {
    process.stderr.write(
      'huu: --yolo: skipping Docker. The agent has access to your shell credentials (~/.ssh, ~/.aws, etc.).\n',
    );
  }

  // Non-TUI subcommands are handled BEFORE the Ink render path so they
  // don't pay the cost of mounting the React tree, opening the debug
  // logger, etc. They print to stdout/stderr like normal Unix CLIs.
  if (filtered[0] === 'init-docker') {
    const code = runInitDockerCli(filtered.slice(1), process.cwd());
    process.exit(code);
  }

  if (filtered[0] === 'status') {
    const code = runStatusCli({ args: filtered.slice(1), cwd: process.cwd() });
    process.exit(code);
  }

  if (filtered[0] === 'prune') {
    const code = runPruneCli({ args: filtered.slice(1) });
    process.exit(code);
  }

  // Block fast on the only hard prerequisite for the TUI/run path: a git
  // repo. The orchestrator's preflight already enforces this, but it ran
  // AFTER the user configured pipeline + backend + model — getting stopped
  // at the last step after committing all that effort is a bad UX.
  // Doing it here means the user sees the error before any pipeline work.
  // Runs both for `huu` (welcome) and `huu run <pipeline>` (auto-start).
  ensureGitRepoOrExit(process.cwd());

  // `huu auto <pipeline> --config <config>` — headless one-command run.
  // Bypasses Ink entirely; drives the same Orchestrator the TUI uses,
  // with file selection and model/backend supplied via the config JSON.
  if (filtered[0] === 'auto') {
    const pipelinePath = filtered[1];
    if (!pipelinePath) {
      console.error('Usage: huu auto <pipeline.json> --config <config.json>');
      process.exit(1);
    }
    let configPath: string | undefined;
    const eqFlag = filtered.find((a) => a.startsWith('--config='));
    if (eqFlag) {
      configPath = eqFlag.slice('--config='.length);
    } else {
      const spaceIdx = filtered.indexOf('--config');
      if (spaceIdx >= 0) configPath = filtered[spaceIdx + 1];
    }
    if (!configPath) {
      console.error('Usage: huu auto <pipeline.json> --config <config.json>');
      process.exit(1);
    }

    let pipelineForAuto: Pipeline;
    try {
      pipelineForAuto = importPipeline(pipelinePath);
    } catch (err) {
      console.error(
        `Failed to import pipeline: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    let runConfig;
    try {
      runConfig = loadRunConfig(configPath);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const { pipeline: mergedPipeline, warnings } = applyRunConfig(
      pipelineForAuto,
      runConfig,
    );
    for (const w of warnings) process.stderr.write(`[warn] ${w}\n`);

    // Per-file steps must have concrete files by now (from the pipeline or
    // config.files) — failing here beats spawning a misconfigured run.
    // `memory` steps are exempt on purpose: their list materializes at run
    // time from the filesFrom memory file an earlier step writes.
    for (const step of mergedPipeline.steps) {
      if (!('files' in step)) continue;
      if (step.scope === 'per-file' && step.files.length === 0) {
        console.error(
          `Step "${step.name}" has scope "per-file" but no files — add them under config.files["${step.name}"], or switch the step to scope "memory" with filesFrom.`,
        );
        process.exit(1);
      }
    }

    // The `provider` field (when set) is the source of truth and overrides
    // `backend`: openrouter → pi, azure → azure. Falls back to `backend`
    // for configs written before provider selection existed.
    const effectiveBackend: AgentBackendKind = runConfig.provider
      ? providerToBackend(runConfig.provider)
      : runConfig.backend;
    const bundle = selectBackend(effectiveBackend);
    let apiKey = '';
    let endpoint: string | undefined;
    if (bundle.requiresApiKey) {
      const specName = effectiveBackend === 'azure' ? 'azureApiKey' : 'openrouter';
      const spec = findSpec(specName);
      if (spec) apiKey = resolveApiKey(spec);
      if (!apiKey) {
        console.error(
          `huu auto: the ${effectiveBackend === 'azure' ? 'Azure AI Foundry' : 'OpenRouter'} ` +
            `provider requires an API key but ${spec?.envVar ?? specName} is not set. ` +
            'Either export the env var, mount a secret at ' +
            (spec?.secretMountPath ?? '/run/secrets/<key>') +
            ', or persist it via the TUI first.',
        );
        process.exit(1);
      }

      // Azure also requires an endpoint URL.
      if (effectiveBackend === 'azure') {
        const endpointSpec = findSpec('azureEndpoint');
        if (endpointSpec) endpoint = resolveApiKey(endpointSpec) || undefined;
        if (!endpoint) {
          console.error(
            'huu auto: the Azure AI Foundry provider requires an endpoint URL but ' +
              'AZURE_OPENAI_BASE_URL is not set. Export it or persist it via the TUI first.',
          );
          process.exit(1);
        }
      }
    }

    const appConfig: AppConfig = {
      apiKey: apiKey || 'stub',
      modelId: runConfig.modelId,
      backend: effectiveBackend,
      provider: runConfig.provider ?? (effectiveBackend === 'azure' ? 'azure' : 'openrouter'),
      endpoint,
    };

    const code = await runHeadless({
      pipeline: mergedPipeline,
      config: appConfig,
      cwd: runConfig.workingDirectory ? resolvePath(runConfig.workingDirectory) : process.cwd(),
      agentFactory: bundle.agentFactory,
      conflictResolverFactory: bundle.conflictResolverFactory,
      concurrency: runConfig.concurrency,
      autoScale: runConfig.autoScale,
    });
    process.exit(code);
  }

  let initialPipeline: Pipeline | undefined;
  let autoStart = false;

  if (filtered[0] === 'run') {
    const path = filtered[1];
    if (!path) {
      console.error('Usage: huu run <pipeline.json>');
      process.exit(1);
    }
    try {
      initialPipeline = importPipeline(path);
      autoStart = true;
    } catch (err) {
      console.error(`Failed to import pipeline: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  // When the user explicitly picked a backend on the CLI, lock it in.
  // When they didn't, defer to the App: it'll show the BackendSelector
  // screen so the choice is explicit before launch (avoids the foot-gun
  // where someone runs `huu run` and silently burns OpenRouter quota).
  const lockedBackend = backendKindFromCli ?? undefined;

  // Front-end fork: the BROWSER UI is the default; `--cli`/`--tui` (or
  // HUU_CLI=1) keep the Ink TUI. Both drive the same Orchestrator — the
  // only difference is the face the user sees. Decided AFTER the git +
  // subcommand gates so `huu auto/status/init-docker/--help` are unaffected.
  const interfaceMode = decideInterfaceMode(args, process.env);

  // Capture stray console.* + Node `warning` events into the process log
  // bridge. For the TUI (patchConsole:false below) this stops stray writes
  // from corrupting the kanban; for the web UI it keeps the launching
  // terminal clean and feeds those lines into the run's log stream.
  installLogCaptures();

  if (interfaceMode === 'web') {
    dlog('lifecycle', 'web_start', {
      backend: lockedBackend ?? 'unspecified',
      hasInitialPipeline: Boolean(initialPipeline),
    });
    await startWebServer({
      cwd: process.cwd(),
      args,
      env: process.env,
      lockedBackend,
      initialPipeline,
      defaultAutoScale: autoScale,
      defaultConcurrency: concurrencyArg,
    });
    dlog('lifecycle', 'web_server_closed');
    return;
  }

  const initialBundle = selectBackend(lockedBackend ?? 'pi');

  dlog('lifecycle', 'render_start', {
    useStub,
    provider: providerFromCli ?? 'unspecified',
    backend: lockedBackend ?? 'unspecified',
    autoStart,
  });

  const { waitUntilExit } = render(
    <App
      initialPipeline={initialPipeline}
      agentFactory={initialBundle.agentFactory}
      conflictResolverFactory={initialBundle.conflictResolverFactory}
      requiresApiKey={initialBundle.requiresApiKey}
      backend={lockedBackend}
      autoStart={autoStart}
      autoScale={autoScale}
      concurrency={concurrencyArg}
    />,
    { patchConsole: false },
  );
  await waitUntilExit();
  dlog('lifecycle', 'wait_until_exit_resolved');
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? String(err)}\n`);
  process.exit(1);
});
