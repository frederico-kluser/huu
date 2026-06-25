/**
 * Bind + run the web server. This is the web-mode counterpart to Ink's
 * `render(<App/>)` in `cli.tsx`: it owns the port, prints the access banner,
 * and returns a promise that stays pending for the life of the process (the
 * CLI's signal handlers drive the actual exit, same as `waitUntilExit()`).
 */

import { networkInterfaces } from 'node:os';
import { createWebServer } from './server.js';
import { resolveWebHost, resolveWebPort } from './interface-mode.js';
import type { AgentBackendKind } from '../orchestrator/backends/registry.js';
import type { Pipeline } from '../lib/types.js';

export interface StartWebServerArgs {
  cwd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  lockedBackend?: AgentBackendKind;
  initialPipeline?: Pipeline;
  defaultAutoScale: boolean;
  defaultConcurrency?: number;
}

/** Non-internal IPv4 addresses, for the "reachable on your network" URLs. */
function lanIPv4s(): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function withToken(url: string, token?: string): string {
  return token ? `${url}/?token=${encodeURIComponent(token)}` : url;
}

function printBanner(
  host: string,
  port: number,
  token: string | undefined,
  inContainer: boolean,
): void {
  const w = (s: string): void => {
    process.stdout.write(s + '\n');
  };
  w('');
  w('  \x1b[35m●\x1b[0m \x1b[1mhuu\x1b[0m — web UI');
  if (inContainer) {
    // The container's own LAN IPs aren't reachable; the host wrapper prints
    // the authoritative localhost URL. Keep this concise.
    w(`    listening inside container on :${port} (published to the host)`);
  } else {
    w(`    \x1b[2mLocal\x1b[0m     ${withToken(`http://localhost:${port}`, token)}`);
    if (host === '0.0.0.0') {
      for (const ip of lanIPv4s()) {
        w(`    \x1b[2mNetwork\x1b[0m   ${withToken(`http://${ip}:${port}`, token)}`);
      }
    }
  }
  if (token) {
    w('    \x1b[2m(token required — the ?token= URL above carries it)\x1b[0m');
  } else if (host === '0.0.0.0' && !inContainer) {
    w(
      '    \x1b[2m(reachable on your LAN — set HUU_WEB_TOKEN to require a secret, or HUU_WEB_HOST=127.0.0.1 for localhost-only)\x1b[0m',
    );
  }
  w('    \x1b[2mPress Ctrl+C to stop.\x1b[0m');
  w('');
}

export async function startWebServer(opts: StartWebServerArgs): Promise<void> {
  const port = resolveWebPort(opts.args, opts.env);
  const host = resolveWebHost(opts.env);
  const token = opts.env.HUU_WEB_TOKEN?.trim() || undefined;
  const inContainer = opts.env.HUU_IN_CONTAINER === '1';

  const { server } = createWebServer({
    cwd: opts.cwd,
    lockedBackend: opts.lockedBackend,
    initialPipeline: opts.initialPipeline,
    defaultAutoScale: opts.defaultAutoScale,
    defaultConcurrency: opts.defaultConcurrency,
    token,
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(
          `huu: port ${port} is already in use. Pick another with ` +
            `--port=<n> or HUU_WEB_PORT=<n>.\n`,
        );
      } else {
        process.stderr.write(`huu: web server failed to start: ${err.message}\n`);
      }
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  printBanner(host, port, token, inContainer);

  // Stay up until the process is signalled (cli.tsx owns SIGINT/SIGTERM and
  // calls process.exit). Resolving on 'close' lets a test shut it down too.
  await new Promise<void>((resolve) => server.once('close', resolve));
}
