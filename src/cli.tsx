#!/usr/bin/env node
// Top-level docker re-exec gate. Must be evaluated BEFORE the Ink/React
// imports below so that on the host (re-exec path) we don't pay the
// cost of mounting React or pulling in the LLM SDKs we never use.
//
// The check is intentionally placed before any other side-effect:
// running `huu` in a host shell should be indistinguishable from
// running it inside the container — the only thing the user notices
// is a slightly slower first invocation while the image pulls.
import { decideReexec, reexecInDocker } from './lib/docker-reexec.js';
import { API_KEY_REGISTRY, configFilePath } from './lib/api-key.js';
const reexec = decideReexec(process.argv.slice(2), process.env);
if (reexec.shouldReexec) {
  // Top-level await is fine here: tsconfig targets ES2022 / ESNext
  // module, both of which support it. The await blocks the rest of the
  // module from evaluating, so none of the React/Ink imports below
  // ever load when we're going to re-exec.
  const code = await reexecInDocker(process.argv.slice(2));
  process.exit(code);
}

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { importPipeline } from './lib/pipeline-io.js';
import { runInitDockerCli } from './lib/init-docker.js';
import { runStatusCli } from './lib/status.js';
import { runPruneCli } from './lib/prune.js';
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
import type { Pipeline } from './lib/types.js';
import { installSafeTerminal } from './ui/safe-terminal.js';
import { initDebugLogger, log as dlog } from './lib/debug-logger.js';

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

function printUsage(): void {
  const envLines = API_KEY_REGISTRY.map(
    (s) => `  ${s.envVar.padEnd(34)} ${s.label} key. Asked in the TUI when missing.`,
  ).join('\n');
  console.log(`huu — Humans Underwrite Undertakings · guided pipeline execution TUI with kanban

Usage:
  huu                       Open the TUI at the welcome screen
  huu run <pipeline.json>   Load pipeline and jump to the model picker
  huu init-docker [...]     Scaffold compose.huu.yaml into the current repo
  huu status [...]          Inspect the latest run via .huu/debug-*.log
  huu prune [...]           List/kill orphan huu containers + stale cidfiles
  huu --backend=<kind>      Pick agent backend: pi (default), copilot, stub
  huu --copilot             Alias for --backend=copilot
  huu --stub                Alias for --backend=stub (no real LLM)
  huu --yolo                Skip Docker, run native on the host (agent sees your shell creds)
  huu --auto-scale          Enable auto-scaling mode (resource-bound concurrency)
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
  // eslint-disable-next-line no-console
  console.error('uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  restoreTerminal();
  // eslint-disable-next-line no-console
  console.error('unhandledRejection:', reason);
  process.exit(1);
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useStub = args.includes('--stub');
  const useCopilot = args.includes('--copilot');
  const useYolo = args.includes('--yolo');
  const autoScale = args.includes('--auto-scale');

  // --backend=<kind> takes precedence over --stub/--copilot aliases. Last wins
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
  } else if (useCopilot) {
    backendKindFromCli = 'copilot';
  } else if (useStub) {
    backendKindFromCli = 'stub';
  }

  // These flags are CLI-only; the rest of the pipeline (subcommand dispatch,
  // pipeline import) must not see them.
  const filtered = args.filter(
    (a) =>
      a !== '--stub' &&
      a !== '--copilot' &&
      a !== '--yolo' &&
      a !== '--auto-scale' &&
      !a.startsWith('--backend='),
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
  const initialBundle = selectBackend(lockedBackend ?? 'pi');

  dlog('lifecycle', 'render_start', {
    useStub,
    useCopilot,
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
    />,
  );
  await waitUntilExit();
  dlog('lifecycle', 'wait_until_exit_resolved');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
