// Web-mode entry point. Boots the HTTP+WebSocket server bundled with
// huu, attaches a `WebSession` per accepted WS connection, optionally
// auto-opens the user's browser, and blocks until SIGINT/SIGTERM.
//
// Kept in a separate module so `cli.tsx` doesn't import the (heavy)
// `ws` + static-server stack on the TUI path.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { startWebServer } from './web/server.js';
import { WebSession } from './web/session.js';
import { openBrowser } from './web/browser-open.js';
import { initDebugLogger, log as dlog } from './lib/debug-logger.js';
import type { AgentBackendKind } from './orchestrator/backends/registry.js';
import type { Pipeline } from './lib/types.js';

export interface RunWebOptions {
  cwd: string;
  initialPipeline?: Pipeline;
  autoStart?: boolean;
  backendKind?: AgentBackendKind;
  autoScale?: boolean;
  openBrowser?: boolean;
  portOverride?: number;
}

/**
 * Resolve the directory holding the prebuilt front-end (`index.html`
 * + assets). We prefer paths relative to this compiled file so the
 * resolution is independent of the user's cwd.
 *
 * Layouts considered:
 *   - dev (tsx)     → src/cli-web.ts          → src/web/dist-static
 *   - prod (dist/)  → dist/cli-web.js         → dist/web/dist-static
 *   - source-prod   → dist/cli-web.js         → ../src/web/dist-static
 *     (fallback used when the webui hasn't been re-copied into dist/)
 */
function resolveStaticDir(here: string): string {
  const candidates = [
    join(here, 'web', 'dist-static'),
    join(here, '..', 'src', 'web', 'dist-static'),
    join(here, '..', 'web', 'dist-static'),
  ];
  const found = candidates.find((p) => existsSync(join(p, 'index.html')));
  return found ?? candidates[0]!;
}

export async function runWebMode(opts: RunWebOptions): Promise<void> {
  // Web mode owns its debug logger; cli.tsx skips initDebugLogger for
  // the --web path so we don't double-initialize.
  initDebugLogger(opts.cwd);
  dlog('web', 'boot', {
    cwd: opts.cwd,
    autoStart: opts.autoStart === true,
    hasInitialPipeline: !!opts.initialPipeline,
    backendKind: opts.backendKind ?? 'unspecified',
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const staticDir = resolveStaticDir(here);
  dlog('web', 'static_dir_resolved', { staticDir });

  const handle = await startWebServer({
    staticDir,
    host: '127.0.0.1',
    port: opts.portOverride,
    // We open the browser ourselves below (after printing the URL to
    // stderr) so the user always sees the URL even when the launcher
    // succeeds. Passing openBrowser:false here avoids double-open.
    openBrowser: false,
    onConnection: (conn) => {
      // Side-effect constructor: the session attaches its own
      // message handler and starts driving the connection. We don't
      // retain a reference — disposal happens on socket close.
      new WebSession(conn, {
        cwd: opts.cwd,
        initialBackend: opts.backendKind,
        autoScale: opts.autoScale,
        initialPipeline: opts.initialPipeline,
        autoStart: opts.autoStart,
      });
    },
  });

  // stderr (NOT stdout) so users piping huu's stdout to another tool
  // don't end up with a token-bearing URL in their data stream.
  process.stderr.write(`huu web UI ready: ${handle.url}\n`);

  if (opts.openBrowser !== false) {
    await openBrowser(handle.url);
  }

  const shutdown = async (signal: string): Promise<void> => {
    dlog('web', 'shutdown', { signal });
    try {
      await handle.close();
    } catch (err) {
      dlog('web', 'shutdown_error', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // Block forever. Closing the browser tab doesn't kill the server —
  // the user has to Ctrl-C (or send SIGTERM) to stop it.
  await new Promise<never>(() => {});
}
