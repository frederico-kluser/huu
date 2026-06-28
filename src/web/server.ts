/**
 * Dependency-free HTTP + Server-Sent-Events server for huu's browser UI.
 *
 * Why built-ins only: the runtime image prunes devDependencies and we add no
 * production web framework — `node:http` + SSE is enough for a real-time,
 * auto-reconnecting control surface, and it ships inside Docker with zero
 * extra weight. Server→browser updates flow over one SSE stream
 * (`/api/events`); browser→server actions are plain `fetch` POSTs.
 *
 * Layering: this is a presentation/entry layer (sibling to `ui/`), so it may
 * import from orchestrator/lib/models — never the other way around.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import type { AgentBackendKind } from '../orchestrator/backends/registry.js';
import { parseBackendKind } from '../orchestrator/backends/registry.js';
import type { AgentOutputChunk } from '../orchestrator/types.js';
import type { OrchestratorState, Pipeline } from '../lib/types.js';
import { backendToProvider, parseProvider, providerToBackend } from '../lib/providers.js';
import {
  listBackendsInfo,
  listProvidersInfo,
  listModelsForBackend,
  keyStatus,
  findKeySpec,
  validateKeyValue,
  listPipelinesInfo,
  getPipelineByName,
  listDirs,
  repoName,
} from './api-data.js';
import { saveApiKey } from '../lib/api-key.js';
import { WebRunManager, type RunSnapshot, type StartRunParams } from './run-manager.js';

export interface WebServerOptions {
  cwd: string;
  /** Pre-selected backend from CLI flags (`--backend`, `--provider`, `--stub`). */
  lockedBackend?: AgentBackendKind;
  /** Pipeline preloaded via `huu run <file>` — offered as the first choice. */
  initialPipeline?: Pipeline;
  /** Default concurrency strategy (false when `--no-auto-scale`). */
  defaultAutoScale: boolean;
  /** Manual concurrency seed from `--concurrency=N`. */
  defaultConcurrency?: number;
  /** Optional shared secret (HUU_WEB_TOKEN). When set, /api + /events require it. */
  token?: string;
}

/** Per-agent log lines kept in each broadcast frame (full set via /api/agent-logs). */
const MAX_AGENT_LOG_LINES = 200;
/** Coalesce orchestrator emits to at most one SSE frame per this interval. */
const BROADCAST_INTERVAL_MS = 120;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** Resolve the static client directory next to this module (dev: src, prod: dist). */
function clientDir(): string {
  return fileURLToPath(new URL('./client/', import.meta.url));
}

interface SseClient {
  res: ServerResponse;
}

/**
 * Construct (but do not bind) the web server. Returns the server + run
 * manager so the caller (serve.ts / tests) controls `.listen()` and can
 * close it deterministically.
 */
export function createWebServer(opts: WebServerOptions): {
  server: Server;
  manager: WebRunManager;
} {
  const root = clientDir();
  const sseClients = new Set<SseClient>();

  // Throttled PER-RUN broadcast — coalesce a busy run's emits to ≤1 frame per
  // run per interval. Concurrent runs each get their own frame keyed by runId;
  // one flush drains every run that changed since the last tick.
  let pending = new Map<string, RunSnapshot>();
  let lastBroadcast = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let simSeq = 0;

  const buildFrame = (snap: RunSnapshot): string =>
    JSON.stringify({ type: 'run', run: serializeSnapshot(snap) });

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    lastBroadcast = Date.now();
    const drained = pending;
    pending = new Map();
    for (const snap of drained.values()) {
      const frame = buildFrame(snap);
      for (const client of sseClients) writeSse(client.res, 'message', frame);
    }
  };

  const scheduleBroadcast = (snap: RunSnapshot): void => {
    pending.set(snap.runId, snap);
    const since = Date.now() - lastBroadcast;
    if (since >= BROADCAST_INTERVAL_MS) flush();
    else if (!timer) timer = setTimeout(flush, BROADCAST_INTERVAL_MS - since);
  };

  // Raw agent-output firehose: relay each coalesced line straight to every
  // connected browser as its own SSE frame, TAGGED with the originating runId
  // so the client routes it to the right board. NOT throttled (append-only, one
  // frame per line, not per token); the browser also mirrors it to the console.
  const broadcastAgentStream = (runId: string, chunk: AgentOutputChunk): void => {
    if (sseClients.size === 0) return;
    const frame = JSON.stringify({ type: 'agent-stream', runId, ...chunk });
    for (const client of sseClients) writeSse(client.res, 'message', frame);
  };

  const manager = new WebRunManager(opts.cwd, scheduleBroadcast, broadcastAgentStream);

  const requireToken = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!opts.token) return true;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const provided =
      url.searchParams.get('token') ??
      (req.headers['x-huu-token'] as string | undefined) ??
      '';
    if (provided === opts.token) return true;
    sendJson(res, 401, { error: 'invalid or missing token' });
    return false;
  };

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 500, { error: message });
      else res.end();
    });
  });

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // --- Static + health (no token required) ---
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      return serveStatic(res, root, 'index.html');
    }
    if (method === 'GET' && (path === '/simulation' || path === '/simulation/')) {
      // SPA shell for the synthetic /simulation demo. The client routes on
      // location.pathname and shows the simulation setup instead of launch.
      return serveStatic(res, root, 'index.html');
    }
    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { ok: true, name: 'huu', repo: repoName(opts.cwd) });
    }
    if (method === 'GET' && !path.startsWith('/api/') && path !== '/events') {
      // Any other GET → static asset (app.js, styles.css, favicon.svg, …).
      return serveStatic(res, root, path.replace(/^\/+/, ''));
    }

    // --- Everything below is data/actions: token-gated when configured ---
    if (!requireToken(req, res)) return;

    if (method === 'GET' && path === '/api/bootstrap') {
      return sendJson(res, 200, bootstrapPayload());
    }
    if (method === 'GET' && path === '/api/pipelines') {
      return sendJson(res, 200, { pipelines: listPipelinesInfo(opts.cwd) });
    }
    if (method === 'GET' && path === '/api/pipeline') {
      const name = url.searchParams.get('name') ?? '';
      const pipeline =
        opts.initialPipeline && opts.initialPipeline.name === name
          ? opts.initialPipeline
          : getPipelineByName(opts.cwd, name);
      if (!pipeline) return sendJson(res, 404, { error: 'pipeline not found' });
      return sendJson(res, 200, { pipeline });
    }
    if (method === 'GET' && path === '/api/providers') {
      return sendJson(res, 200, { providers: listProvidersInfo() });
    }
    if (method === 'GET' && path === '/api/folders') {
      // Folder navigation for the run-directory picker. Defaults to cwd.
      const target = url.searchParams.get('path') ?? opts.cwd;
      return sendJson(res, 200, listDirs(target));
    }
    if (method === 'GET' && path === '/api/models') {
      // Accept either a provider (openrouter|azure) or a raw backend kind.
      const provider = parseProvider(url.searchParams.get('provider') ?? '');
      const backend = provider
        ? providerToBackend(provider)
        : parseBackendKind(url.searchParams.get('backend') ?? 'pi');
      if (!backend) return sendJson(res, 400, { error: 'unknown backend' });
      // OpenRouter's /models is public, so we return the FULL LIVE catalog
      // (every model, capability-annotated) WITH OR WITHOUT a key. When the
      // user has validated an OpenRouter key the client forwards it here
      // (x-huu-key) for the per-account view; it's optional, used in memory
      // only, never logged or persisted.
      const hk = req.headers['x-huu-key'];
      const openrouterKey = (Array.isArray(hk) ? hk[0] : hk ?? '').toString();
      const { models, source } = await listModelsForBackend(
        opts.cwd,
        backend,
        openrouterKey,
      );
      return sendJson(res, 200, { models, source });
    }
    if (method === 'GET' && path === '/api/keys') {
      const provider = parseProvider(url.searchParams.get('provider') ?? '');
      const backend = provider
        ? providerToBackend(provider)
        : parseBackendKind(url.searchParams.get('backend') ?? 'pi');
      if (!backend) return sendJson(res, 400, { error: 'unknown backend' });
      return sendJson(res, 200, keyStatus(backend));
    }
    if (method === 'POST' && path === '/api/keys/validate') {
      // Browser-only key flow: validate a pasted key against its provider
      // WITHOUT persisting it. The browser keeps the value in session
      // memory and sends it back with each run; nothing is written to disk.
      const body = await readJsonBody(req);
      const name = String(body.name ?? '');
      const value = String(body.value ?? '');
      const endpoint = body.endpoint ? String(body.endpoint) : undefined;
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      if (!value.trim()) return sendJson(res, 400, { error: 'empty value' });
      const result = await validateKeyValue(spec, value, { endpoint });
      return sendJson(res, 200, result);
    }
    if (method === 'POST' && path === '/api/keys') {
      // Optional disk persistence (CLI/headless reuse). The browser UI does
      // NOT call this — it keeps keys in session memory only. Left in place
      // so a user who WANTS a saved key can still POST here.
      const body = await readJsonBody(req);
      const name = String(body.name ?? '');
      const value = String(body.value ?? '');
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      if (!value.trim()) return sendJson(res, 400, { error: 'empty value' });
      saveApiKey(spec, value);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'GET' && path === '/api/agent-logs') {
      const id = Number(url.searchParams.get('id'));
      const runId = url.searchParams.get('runId') ?? undefined;
      const snap = manager.getSnapshot(runId);
      const agent = snap.state?.agents.find((a) => a.agentId === id);
      return sendJson(res, 200, { logs: agent?.logs ?? [] });
    }
    if (method === 'POST' && path === '/api/run') {
      return startRun(req, res);
    }
    if (method === 'POST' && path === '/api/run/abort') {
      const body = await readJsonBody(req);
      // A `runId` aborts that one run; absent aborts ALL (+ scheduler teardown).
      manager.abort(body.runId ? String(body.runId) : undefined);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/api/run/pause') {
      // Pause/resume a /simulation run (no-op for real runs).
      const body = await readJsonBody(req);
      const paused = body.paused === true || body.paused === 'true';
      manager.setPaused(String(body.runId ?? ''), paused);
      return sendJson(res, 200, { ok: true, paused });
    }
    if (method === 'POST' && path === '/api/run/concurrency') {
      const body = await readJsonBody(req);
      const runId = String(body.runId ?? '');
      if (typeof body.mode === 'string') {
        manager.setMode(runId, body.mode as 'auto' | 'manual' | 'greedy');
      } else if (typeof body.value === 'number') {
        manager.setConcurrency(runId, body.value);
      } else if (typeof body.delta === 'number') {
        manager.adjust(runId, body.delta);
      }
      return sendJson(res, 200, {
        concurrency: manager.getSnapshot(runId).state?.concurrency ?? null,
      });
    }
    if (method === 'GET' && path === '/events') {
      return openSse(req, res);
    }

    sendJson(res, 404, { error: 'not found' });
  }

  async function startRun(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody(req);
    // `/simulation` runs: synthetic, no backend/key/pipeline resolution.
    if (body.simulate === true || body.simulate === 'true') {
      try {
        const modelIds = Array.isArray(body.modelIds)
          ? (body.modelIds as unknown[]).map((m) => String(m)).filter((m) => m.trim())
          : body.modelId
            ? [String(body.modelId)]
            : [];
        const snap = manager.startSimulation({
          runId: `sim-${Date.now().toString(36)}-${simSeq++}`,
          modelIds,
          fileCount: clampInt(body.fileCount, 12, 1, 200),
          concurrency: clampInt(body.concurrency, 6, 1, 64),
          pipelineName: body.pipelineName ? String(body.pipelineName) : undefined,
          presetName: body.presetName ? String(body.presetName) : undefined,
        });
        return sendJson(res, 200, { ok: true, run: serializeSnapshot(snap) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return sendJson(res, /too many/i.test(message) ? 429 : 400, { error: message });
      }
    }
    // Provider (openrouter|azure) is the user-facing choice; it maps to the
    // dispatch backend. Falls back to a raw `backend` for older clients.
    const provider = parseProvider(String(body.provider ?? ''));
    const backend = provider
      ? providerToBackend(provider)
      : parseBackendKind(String(body.backend ?? 'pi'));
    if (!backend) return sendJson(res, 400, { error: 'unknown backend' });
    const params: StartRunParams = {
      pipelineName: body.pipelineName ? String(body.pipelineName) : undefined,
      pipeline:
        opts.initialPipeline &&
        body.pipelineName === opts.initialPipeline.name
          ? opts.initialPipeline
          : undefined,
      backend,
      provider: provider ?? backendToProvider(backend),
      modelId: String(body.modelId ?? ''),
      // Browser-only key: the client sends the in-memory key it validated
      // earlier. Used for this run only; never persisted. Absent → the
      // run manager falls back to the env/mount/disk resolver (CLI path).
      apiKey: body.apiKey ? String(body.apiKey) : undefined,
      concurrency:
        typeof body.concurrency === 'number' ? body.concurrency : undefined,
      mode: ['auto', 'manual', 'greedy'].includes(String(body.mode))
        ? (body.mode as StartRunParams['mode'])
        : undefined,
      endpoint: body.endpoint ? String(body.endpoint) : undefined,
      runDirectory: body.runDirectory ? String(body.runDirectory) : undefined,
      timeoutMinutes:
        typeof body.timeoutMinutes === 'number'
          ? body.timeoutMinutes
          : undefined,
    };
    try {
      const snap = manager.start(params);
      sendJson(res, 200, { ok: true, run: serializeSnapshot(snap) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 429 when too many concurrent runs; 400 for bad config. (No 409 — the
      // multi-run manager accepts concurrent runs.)
      sendJson(res, /too many/i.test(message) ? 429 : 400, { error: message });
    }
  }

  function openSse(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 2000\n\n`);
    const client: SseClient = { res };
    sseClients.add(client);

    // Replay every tracked run's latest snapshot so a refresh / new tab
    // re-syncs all boards (the client keys by runId).
    const snaps = manager.getSnapshots();
    if (snaps.length === 0) writeSse(res, 'message', buildFrame(manager.getSnapshot()));
    else for (const snap of snaps) writeSse(res, 'message', buildFrame(snap));

    // Keep-alive comment ping so proxies don't drop the idle connection.
    const ping = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 25_000);

    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(client);
    });
  }

  function bootstrapPayload(): Record<string, unknown> {
    return {
      name: 'huu',
      repo: repoName(opts.cwd),
      cwd: opts.cwd,
      lockedBackend: opts.lockedBackend ?? null,
      // The user-facing provider locked from the CLI (--provider/--backend),
      // derived from the locked backend. null = user chooses in the UI.
      lockedProvider: opts.lockedBackend
        ? backendToProvider(opts.lockedBackend)
        : null,
      defaults: {
        autoScale: opts.defaultAutoScale,
        concurrency: opts.defaultConcurrency ?? null,
      },
      backends: listBackendsInfo(),
      providers: listProvidersInfo(),
      pipelines: listPipelinesInfo(opts.cwd),
      initialPipeline: opts.initialPipeline?.name ?? null,
      runs: manager.getSnapshots().map(serializeSnapshot),
    };
  }

  // Abort any in-flight run when the server is torn down.
  server.on('close', () => {
    if (timer) clearTimeout(timer);
    manager.abort();
    for (const client of sseClients) client.res.end();
    sseClients.clear();
  });

  return { server, manager };
}

// --- helpers ---------------------------------------------------------------

function serializeSnapshot(snap: RunSnapshot): Record<string, unknown> {
  return {
    phase: snap.phase,
    runId: snap.runId,
    pipelineName: snap.pipelineName,
    runDirectory: snap.runDirectory,
    backend: snap.backend,
    modelId: snap.modelId,
    startedAt: snap.startedAt,
    finishedAt: snap.finishedAt ?? null,
    errorReason: snap.errorReason ?? null,
    state: snap.state ? trimState(snap.state) : null,
  };
}

/** Bound per-agent log size in the broadcast frame; full set via /api/agent-logs. */
function trimState(state: OrchestratorState): OrchestratorState {
  return {
    ...state,
    agents: state.agents.map((a) =>
      a.logs.length > MAX_AGENT_LOG_LINES
        ? { ...a, logs: a.logs.slice(-MAX_AGENT_LOG_LINES) }
        : a,
    ),
  };
}

/** Coerce an unknown body field to an integer within [lo, hi], else `dflt`. */
function clampInt(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function writeSse(res: ServerResponse, event: string, data: string): void {
  // `event:` line omitted for the default 'message' type the client listens on.
  if (event && event !== 'message') res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // 1 MiB guard — pipeline payloads are tiny; anything bigger is abuse.
    if (size > 1_048_576) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new Error('invalid JSON body');
  }
}

async function serveStatic(
  res: ServerResponse,
  root: string,
  relPath: string,
): Promise<void> {
  // Defend against path traversal: normalize and confine to root.
  const safeRel = normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const full = join(root, safeRel);
  if (!full.startsWith(root)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error('not a file');
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': contentTypeFor(full),
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: `not found: ${relPath}` });
  }
}
