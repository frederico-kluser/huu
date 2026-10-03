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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import type { AgentBackendKind } from '../orchestrator/backends/registry.js';
import { parseBackendKind } from '../orchestrator/backends/registry.js';
import type { AgentOutputChunk } from '../orchestrator/types.js';
import type {
  LlmProvider,
  OrchestratorState,
  Pipeline,
} from '../lib/types.js';
import { backendToProvider, parseProvider, providerToBackend } from '../lib/providers.js';
import {
  listBackendsInfo,
  listProvidersInfo,
  listModelsForBackend,
  keyStatus,
  keyPoolInfo,
  findKeySpec,
  validateKeyValue,
  listPipelinesInfo,
  getPipelineByName,
  listDirs,
  repoName,
} from './api-data.js';
import {
  clearStoredApiKey,
  detectForeignKeySpec,
  findSpec,
  maskKey,
  resolveApiKeyWithSource,
  saveApiKey,
} from '../lib/api-key.js';
import {
  addPoolKey,
  loadKeyPool,
  markBurned,
  removePoolKey,
  saveKeyPool,
} from '../lib/api-key-pool.js';
import { WebRunManager, pickRunKey, type RunSnapshot, type StartRunParams } from './run-manager.js';
import { termLog } from './terminal-log.js';
import {
  DEFAULT_LOCALE,
  availableLocales,
  getLocale,
  messagesFor,
  normalizeLocale,
} from '../lib/i18n/index.js';

export interface WebServerOptions {
  cwd: string;
  /** Pre-selected backend from CLI flags (`--backend`, `--provider`, `--stub`). */
  lockedBackend?: AgentBackendKind;
  /**
   * Provider locked from `--provider=`. Carried separately from
   * `lockedBackend` because both providers map to the SAME `jcode` kind —
   * re-deriving it from the backend silently rewrote `--provider=openrouter`
   * into `deepseek` in the browser's provider segment.
   */
  lockedProvider?: LlmProvider;
  /** Pipeline preloaded via `huu run <file>` — offered as the first choice. */
  initialPipeline?: Pipeline;
  /** Default concurrency strategy (false when `--no-auto-scale`). */
  defaultAutoScale: boolean;
  /** Manual concurrency seed from `--concurrency=N`. */
  defaultConcurrency?: number;
  /** Optional shared secret (HUU_WEB_TOKEN). When set, /api + /events require it. */
  token?: string;
  /**
   * SSE heartbeat interval (ms, default 25 000). Emitted as a REAL
   * `event: ping` frame — not an SSE comment — so the browser's liveness
   * watchdog can observe it. Injectable so tests don't wait 25 s.
   */
  heartbeatMs?: number;
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
  // Opt-in: also mirror the raw firehose to the serve terminal. Default OFF —
  // it is per-token-batch agent prose and would drown the lifecycle log.
  const streamToTerminal = process.env.HUU_WEB_LOG_STREAM === '1';
  const broadcastAgentStream = (runId: string, chunk: AgentOutputChunk): void => {
    if (streamToTerminal && chunk.text?.trim()) {
      termLog('info', `agent ${chunk.agentId}`, chunk.text.trim());
    }
    if (sseClients.size === 0) return;
    const frame = JSON.stringify({ type: 'agent-stream', runId, ...chunk });
    for (const client of sseClients) writeSse(client.res, 'message', frame);
  };

  const manager = new WebRunManager(opts.cwd, scheduleBroadcast, broadcastAgentStream);


  // Machine-global budget telemetry: one `{type:'budget'}` frame per second to
  // every client while runs are tracked. Low-frequency by design — it rides its
  // own frame type (never inflates the throttled `run` snapshot) and carries
  // the dial, used/total RAM, PSI and the pressure level so the user can SEE
  // that the gear took effect and when the guard engages.
  const budgetTimer = setInterval(() => {
    if (sseClients.size === 0) return;
    const budget = manager.budgetTelemetry();
    if (!budget) return;
    const frame = JSON.stringify({ type: 'budget', budget });
    for (const client of sseClients) writeSse(client.res, 'message', frame);
  }, 1_000);
  budgetTimer.unref?.();

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
      termLog('error', 'web', `${req.method ?? 'GET'} ${req.url ?? '/'} failed: ${message}`);
      if (!res.headersSent) sendJson(res, 500, { error: message });
      else res.end();
    });
  });
  // SSE longevity: keep Node's request-receipt timer (default 5 min) away
  // from the long-lived `/events` stream — cheap insurance, the client
  // watchdog is the primary defense. headersTimeout keeps slowloris
  // protection for everything else.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

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
    // Translation catalog for the browser. Deliberately NOT token-gated: the
    // client must be able to paint its own login/error chrome in the user's
    // language before it has a token. Catalogs carry no secrets.
    if (method === 'GET' && path === '/api/i18n') {
      const requested = normalizeLocale(url.searchParams.get('locale'));
      const locale = requested ?? getLocale();
      return sendJson(res, 200, {
        locale,
        defaultLocale: DEFAULT_LOCALE,
        locales: availableLocales(),
        messages: messagesFor(locale),
      });
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
      // Folder navigation for the run-directory picker. A bare call opens at
      // the workspace root (HUU_WORKSPACE, default $HOME) so the picker lands
      // where the user's projects live, not deep in one repo.
      const target = url.searchParams.get('path') ?? workspaceRoot();
      return sendJson(res, 200, listDirs(target));
    }
    if (method === 'GET' && path === '/api/models') {
      // Accept either a provider or a raw backend kind.
      const provider = parseProvider(url.searchParams.get('provider') ?? '');
      const backend = provider
        ? providerToBackend(provider)
        : parseBackendKind(url.searchParams.get('backend') ?? 'jcode');
      if (!backend) return sendJson(res, 400, { error: 'unknown backend' });
      const hk = req.headers['x-huu-key'];
      const backendKey = (Array.isArray(hk) ? hk[0] : hk ?? '').toString();
      const { models, source } = await listModelsForBackend(
        opts.cwd,
        backend,
        backendKey,
        provider ?? undefined,
      );
      return sendJson(res, 200, { models, source });
    }
    if (method === 'GET' && path === '/api/keys') {
      const provider = parseProvider(url.searchParams.get('provider') ?? '');
      const backend = provider
        ? providerToBackend(provider)
        : parseBackendKind(url.searchParams.get('backend') ?? 'jcode');
      if (!backend) return sendJson(res, 400, { error: 'unknown backend' });
      // The PROVIDER decides which credential is missing. Passing only the
      // backend made this endpoint answer for jcode's first provider, so the
      // browser's OpenRouter launch form was told `deepseek` was missing.
      return sendJson(res, 200, keyStatus(backend, provider ?? undefined));
    }
    if (method === 'GET' && path === '/api/keys/status') {
      // Per-spec key status for the ⚙ Options panel: which tier would supply
      // the key for a NEW run started WITHOUT a browser session key, masked.
      // Never returns the value itself.
      const name = url.searchParams.get('name') ?? 'deepseek';
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      const webKey = manager.getWebKey(name);
      const resolved = resolveApiKeyWithSource(spec);
      const effective = webKey || resolved.value;
      const source = webKey ? 'options' : resolved.source;
      return sendJson(res, 200, {
        name,
        label: spec.label,
        envVar: spec.envVar,
        source,
        masked: effective ? maskKey(effective) : null,
        envPresent: Boolean((process.env[spec.envVar] ?? '').trim()),
        storedOverridesEnv: resolved.storedOverridesEnv,
      });
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
      // Mirror the outcome to the serve terminal — "did my key take?" must be
      // answerable without opening DevTools.
      const masked = maskKey(value);
      if (result.status === 'valid') {
        termLog('ok', 'keys', `${spec.label} ${masked} validated by the provider`);
      } else if (result.status === 'invalid') {
        termLog(
          'error',
          'keys',
          `${spec.label} ${masked} REJECTED by the provider (HTTP ${result.httpStatus}) — not usable`,
        );
      } else if (result.status === 'wrong-key') {
        termLog(
          'error',
          'keys',
          `${masked} is a ${result.label} key, not a ${spec.label} key — refused before saving ` +
            `(it would have been stored as "${spec.name}" and sent to the wrong vendor)`,
        );
      } else {
        termLog('warn', 'keys', `${spec.label} ${masked} could not be verified (${result.reason})`);
      }
      return sendJson(res, 200, result);
    }
    if (method === 'POST' && path === '/api/keys') {
      // Persist a key: written to the global config store (host-mounted via
      // HUU_CONFIG_DIR under Docker, so it survives the container) AND
      // registered as the live in-session override — inside Docker the
      // resolver's secret mount is a startup snapshot, so without the
      // override a just-saved key would not take effect until restart. The
      // web ⚙ Options calls this AFTER a successful /api/keys/validate.
      const body = await readJsonBody(req);
      const name = String(body.name ?? '');
      const value = String(body.value ?? '');
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      if (!value.trim()) return sendJson(res, 400, { error: 'empty value' });
      // Defense in depth: the ⚙ Options flow calls /api/keys/validate first,
      // but this endpoint PERSISTS, so it refuses another provider's key on
      // its own rather than trusting the caller to have asked.
      const foreign = detectForeignKeySpec(spec, value);
      if (foreign) {
        termLog(
          'error',
          'keys',
          `${maskKey(value)} is a ${foreign.label} key, not a ${spec.label} key — not saved`,
        );
        return sendJson(res, 400, {
          error: `that looks like a ${foreign.label} key, not a ${spec.label} key`,
          validation: { status: 'wrong-key', belongsTo: foreign.name, label: foreign.label },
        });
      }
      saveApiKey(spec, value);
      manager.setWebKey(name, value);
      termLog(
        'ok',
        'keys',
        `${spec.label} ${maskKey(value)} saved — every new run uses it (persisted for future huu sessions too)`,
      );
      return sendJson(res, 200, { ok: true, masked: maskKey(value) });
    }
    if (method === 'DELETE' && path === '/api/keys') {
      // Clear a saved key: removes the config-store entry + the live web
      // override. Runs then fall back to the ambient tiers. Inside Docker the
      // startup secret-mount snapshot cannot be unmounted — the response says
      // so instead of pretending the clear fully applied.
      const name = url.searchParams.get('name') ?? '';
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      const cleared = clearStoredApiKey(spec);
      manager.clearWebKey(name);
      const still = resolveApiKeyWithSource(spec);
      const note =
        still.source === 'secret-mount'
          ? `this session still holds the key forwarded when huu started — restart huu to fully clear it`
          : still.source === 'env' || still.source === 'env-file'
            ? `runs now fall back to ${spec.envVar}`
            : 'no key remains — new runs will need one';
      termLog('warn', 'keys', `${spec.label} saved key cleared — ${note}`);
      return sendJson(res, 200, { ok: true, cleared, fallback: still.source, note });
    }
    // --- Key POOL (⚙ Settings → several keys, with rotation) --------------
    //
    // Everything here is INDEX-addressed and MASK-returned: the browser never
    // receives a key value, only `maskKey(value)` plus the key's rotation
    // state. Writes are always validate-then-persist, the same rule the
    // single-key panel follows.
    if (method === 'GET' && path === '/api/keys/pool') {
      const spec = findKeySpec(url.searchParams.get('name') ?? 'deepseek');
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${url.searchParams.get('name')}` });
      return sendJson(res, 200, keyPoolInfo(spec, manager.getWebKey(spec.name)));
    }
    if (method === 'POST' && path === '/api/keys/pool') {
      // VALIDATE BEFORE PERSIST. A key the provider actively rejects (401/403)
      // is never written: a burned key sitting in the pool costs a wasted
      // rotation on every failure it later takes part in. `unverifiable`
      // (offline, or a spec with no cheap probe) is accepted with the reason
      // echoed back — the same policy /api/keys/validate uses, because hard-
      // blocking an offline user is worse than a key that might not work.
      const body = await readJsonBody(req);
      const name = String(body.name ?? '');
      const value = String(body.value ?? '');
      const endpoint = body.endpoint ? String(body.endpoint) : undefined;
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      if (!value.trim()) return sendJson(res, 400, { error: 'empty value' });
      const validation = await validateKeyValue(spec, value, { endpoint });
      const masked = maskKey(value);
      if (validation.status === 'wrong-key') {
        termLog(
          'error',
          'keys',
          `${masked} is a ${validation.label} key, not a ${spec.label} key — not added to the pool`,
        );
        return sendJson(res, 400, {
          error: `that looks like a ${validation.label} key, not a ${spec.label} key`,
          validation,
        });
      }
      if (validation.status === 'invalid') {
        termLog(
          'error',
          'keys',
          `${spec.label} ${masked} REJECTED by the provider (HTTP ${validation.httpStatus}) — not added to the pool`,
        );
        return sendJson(res, 400, {
          error: `the provider rejected this key (HTTP ${validation.httpStatus})`,
          httpStatus: validation.httpStatus,
          validation,
        });
      }
      const pool = addPoolKey(spec, value);
      termLog(
        'ok',
        'keys',
        `${spec.label} ${masked} added to the pool (${pool.keys.length} key(s))` +
          (validation.status === 'unverifiable' ? ` — unverified: ${validation.reason}` : ''),
      );
      return sendJson(res, 200, {
        ok: true,
        validation,
        ...keyPoolInfo(spec, manager.getWebKey(spec.name), pool),
      });
    }
    if (method === 'DELETE' && path === '/api/keys/pool') {
      const name = url.searchParams.get('name') ?? '';
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      // `searchParams.get` yields null when the param is absent, and
      // `Number(null)` is 0 — so an index-less DELETE would silently drop key
      // #0. Require the parameter to be PRESENT before coercing it.
      const rawIndex = url.searchParams.get('index');
      const index = rawIndex === null ? NaN : Number(rawIndex);
      if (!Number.isInteger(index) || index < 0) {
        return sendJson(res, 400, { error: 'a non-negative integer index is required' });
      }
      const pool = removePoolKey(spec, index);
      termLog('warn', 'keys', `${spec.label} key #${index} removed — ${pool.keys.length} left in the pool`);
      return sendJson(res, 200, {
        ok: true,
        ...keyPoolInfo(spec, manager.getWebKey(spec.name), pool),
      });
    }
    if (method === 'POST' && path === '/api/keys/pool/reset') {
      // Clear the LEARNED sidelining (burns + cooldowns) — the escape hatch for
      // a key burned by a provider blip or one whose quota was topped up. With
      // no `index`, the whole pool is cleared.
      const body = await readJsonBody(req);
      const name = String(body.name ?? '');
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      const only = typeof body.index === 'number' ? Math.floor(body.index) : undefined;
      const state = loadKeyPool(spec);
      const pool = saveKeyPool(spec, {
        ...state,
        burned: only === undefined ? [] : state.burned.filter((b) => b.index !== only),
        cooldowns: only === undefined ? [] : state.cooldowns.filter((c) => c.index !== only),
      });
      termLog(
        'info',
        'keys',
        `${spec.label} rotation state reset${only === undefined ? '' : ` for key #${only}`}`,
      );
      return sendJson(res, 200, {
        ok: true,
        ...keyPoolInfo(spec, manager.getWebKey(spec.name), pool),
      });
    }
    if (method === 'POST' && path === '/api/keys/pool/validate') {
      // Re-probe a STORED key and record what the provider said: a key that now
      // answers 200 comes back into rotation, one that answers 401/403 is
      // burned. Probing without recording would leave the user reading a stale
      // badge, which is the thing this endpoint exists to fix.
      const body = await readJsonBody(req);
      const name = String(body.name ?? '');
      const spec = findKeySpec(name);
      if (!spec) return sendJson(res, 400, { error: `unknown key: ${name}` });
      const index = typeof body.index === 'number' ? Math.floor(body.index) : NaN;
      const state = loadKeyPool(spec);
      const value = Number.isInteger(index) ? state.keys[index] : undefined;
      if (value === undefined) {
        return sendJson(res, 400, { error: `no key at index ${String(body.index)}` });
      }
      const validation = await validateKeyValue(spec, value, {
        endpoint: body.endpoint ? String(body.endpoint) : undefined,
      });
      if (validation.status === 'invalid') {
        markBurned(state, index, String(validation.httpStatus));
      } else if (validation.status === 'valid') {
        state.burned = state.burned.filter((b) => b.index !== index);
        state.cooldowns = state.cooldowns.filter((c) => c.index !== index);
      }
      const pool = saveKeyPool(spec, state);
      termLog(
        validation.status === 'valid' ? 'ok' : validation.status === 'invalid' ? 'error' : 'warn',
        'keys',
        `${spec.label} key #${index} (${maskKey(value)}) re-probed: ${validation.status}`,
      );
      return sendJson(res, 200, {
        ok: true,
        index,
        validation,
        ...keyPoolInfo(spec, manager.getWebKey(spec.name), pool),
      });
    }
    if (method === 'GET' && path === '/api/agent-logs') {
      const id = Number(url.searchParams.get('id'));
      const runId = url.searchParams.get('runId') ?? undefined;
      const snap = manager.getSnapshot(runId);
      const agent = snap.state?.agents.find((a) => a.agentId === id);
      return sendJson(res, 200, { logs: agent?.logs ?? [] });
    }
    if (method === 'POST' && path === '/api/settings') {
      // Machine-global settings. `ramPercent` applies to the shared scheduler
      // IMMEDIATELY (all current + future runs) and persists server-side; a
      // null/absent value clears the web override (back to env/default). The
      // response echoes the EFFECTIVE value so the client can display what
      // actually took — the old dial had no feedback loop at all.
      const body = await readJsonBody(req);
      const raw = body.ramPercent;
      const pct =
        typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
      const effective = manager.setRamPercent(pct);
      termLog(
        'info',
        'settings',
        pct === undefined
          ? `RAM budget override cleared — effective ${effective}%`
          : `RAM budget set to ${effective}% (applied to all runs now)`,
      );
      return sendJson(res, 200, { ok: true, ramPercent: effective });
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
    if (method === 'POST' && path === '/api/run/retry') {
      // Retry one failed task card while the run is held open in
      // `awaiting_retry`. Optional `timeoutMinutes` re-runs a timed-out card
      // with a longer per-task limit. Fire-and-forget; progress streams over SSE.
      const body = await readJsonBody(req);
      const runId = String(body.runId ?? '');
      const agentId = Number(body.agentId);
      if (!runId || !Number.isFinite(agentId)) {
        return sendJson(res, 400, { error: 'runId and numeric agentId required' });
      }
      const timeoutMinutes =
        typeof body.timeoutMinutes === 'number' && body.timeoutMinutes > 0
          ? body.timeoutMinutes
          : undefined;
      manager.retryTask(runId, agentId, timeoutMinutes);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/api/run/finish') {
      // Leave the `awaiting_retry` hold so the run finalizes and tears down.
      const body = await readJsonBody(req);
      manager.finish(String(body.runId ?? ''));
      return sendJson(res, 200, { ok: true });
    }
    // One session at a time: every epoch ends in a merge into the user's
    // working branch, so two concurrent sessions would race that merge.
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
      : parseBackendKind(String(body.backend ?? 'jcode'));
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
      // Optional override for the merge/integration conflict-resolver agent.
      // Empty → the resolver inherits the run model (Pipeline.integrationModelId).
      conflictResolverModelId: body.conflictResolverModelId
        ? String(body.conflictResolverModelId)
        : undefined,
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
      // NOTE: the RAM dial no longer piggybacks on run POSTs — it is a server
      // setting (`POST /api/settings`) applied to the shared scheduler LIVE.
      // Authoritative priority = the project's index in the client's queue list,
      // so the first project is served first regardless of POST arrival order.
      priority: typeof body.priority === 'number' ? body.priority : undefined,
    };
    try {
      const snap = manager.start(params);
      sendJson(res, 200, { ok: true, run: serializeSnapshot(snap) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 429 when too many concurrent runs; 400 for bad config. (No 409 — the
      // multi-run manager accepts concurrent runs.) Refusals also go to the
      // terminal: a run that never starts must not be silent anywhere.
      termLog('error', 'run', `refused: ${message}`);
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


    // Keep-alive ping as a REAL named event, not an SSE comment: comments are
    // invisible to the browser's EventSource API, so a comment-only heartbeat
    // gave the client no way to tell a quiet stream from a dead (zombie) one.
    // `event: ping` still keeps proxies from dropping the idle connection AND
    // feeds the client's staleness watchdog; old clients ignore unknown named
    // events, so this is backward compatible.
    const ping = setInterval(() => {
      writeSse(res, 'ping', '{}');
    }, opts.heartbeatMs ?? 25_000);

    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(client);
    });
  }

  // Folder-picker root: HUU_WORKSPACE (set by the wrapper to the host $HOME /
  // configured path, mounted into the container at the same absolute path).
  // Falls back to the server cwd when unset (dev/tests run without the
  // wrapper) — the pre-workspace default.
  function workspaceRoot(): string {
    const w = process.env.HUU_WORKSPACE?.trim();
    return w && existsSync(w) ? w : opts.cwd;
  }


  function bootstrapPayload(): Record<string, unknown> {
    return {
      name: 'huu',
      repo: repoName(opts.cwd),
      cwd: opts.cwd,
      lockedBackend: opts.lockedBackend ?? null,
      // The user-facing provider locked from the CLI (--provider/--backend),
      // derived from the locked backend. null = user chooses in the UI.
      lockedProvider: opts.lockedProvider
        ? opts.lockedProvider
        : opts.lockedBackend
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
      // Folder-picker root: HUU_WORKSPACE (default $HOME on the host, mounted
      // into the container by the wrapper). The client opens the picker here
      // and offers a "Home" shortcut back to it.
      workspace: workspaceRoot(),
      runs: manager.getSnapshots().map(serializeSnapshot),
      // Server-persisted machine-global settings (source of truth for the ⚙
      // modal — localStorage is only a cache) + the budget the scheduler is
      // actually enforcing right now.
      settings: { ramPercent: manager.effectiveRamPercent() },
      budget: manager.budgetTelemetry(),
    };
  }

  // Abort any in-flight run when the server is torn down.
  server.on('close', () => {
    if (timer) clearTimeout(timer);
    clearInterval(budgetTimer);
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

/**
 * `readJsonBody`, but a body that cannot be read is answered as the CALLER's
 * mistake instead of the server's.
 *
 * `readJsonBody` throws on a malformed (or oversized) body, and an uncaught
 * throw inside `handleRequest` lands in the top-level `.catch` — which reports
 * 500. A 500 says "huu broke"; `{ not json` says the client sent garbage, and
 * the two must not be indistinguishable to anything reading the status: a
 * browser cannot retry-vs-fix on a 500, and neither can a log.
 *
 * `/api/graphs` already did this inline; this is the same rule, hoisted so the
 * routes that share it also share ONE implementation. Returns `null` AFTER
 * writing the 400 — the caller's contract is `if (!body) return;`, which is
 * unreachable for any body that parses, so no valid request changes shape.
 */
async function readJsonBodyOr400(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
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
