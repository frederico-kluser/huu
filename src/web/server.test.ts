import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createWebServer } from './server.js';
import { resetCapabilitiesCache } from '../lib/openrouter.js';
import type { WebRunManager } from './run-manager.js';
import type { Pipeline } from '../lib/types.js';

function setupRepo(dir: string): void {
  execSync('git init --initial-branch=main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"', {
    cwd: dir,
    shell: '/bin/bash',
  });
  writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.huu-worktrees/\n.huu/\n', 'utf8');
  execSync('git add -A && git commit -m init', { cwd: dir, encoding: 'utf8' });
}

const PIPELINE: Pipeline = {
  name: 'web-test-pipe',
  steps: [
    {
      type: 'work',
      name: 'Write note',
      prompt: 'Write a short note file.',
      files: [],
      scope: 'project',
    },
  ],
};

async function listenEphemeral(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('web server', () => {
  let repo: string;
  let server: Server;
  let manager: WebRunManager;
  let base: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'huu-web-'));
    setupRepo(repo);
    ({ server, manager } = createWebServer({
      cwd: repo,
      defaultAutoScale: true,
      initialPipeline: PIPELINE,
    }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
  });

  it('serves the SPA shell at / with the right content type', async () => {
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('huu');
    expect(html).toContain('app.js');
  });

  it('serves static client assets', async () => {
    for (const [path, ct] of [
      ['/app.js', 'javascript'],
      ['/styles.css', 'css'],
      ['/favicon.svg', 'svg'],
    ] as const) {
      const res = await fetch(base + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toContain(ct);
    }
  });

  it('answers /api/health', async () => {
    const res = await fetch(base + '/api/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.name).toBe('huu');
  });

  it('bootstrap lists backends, defaults, and the preloaded pipeline', async () => {
    const json = await (await fetch(base + '/api/bootstrap')).json();
    expect(Array.isArray(json.backends)).toBe(true);
    expect(json.backends.some((b: { id: string }) => b.id === 'pi')).toBe(true);
    expect(json.backends.some((b: { id: string }) => b.id === 'stub')).toBe(true);
    expect(json.initialPipeline).toBe('web-test-pipe');
    // Multi-run bootstrap returns a runs[] array (empty before any run starts).
    expect(json.runs).toEqual([]);
  });

  it('lists the full public catalog for a backend and 400s on an unknown one', async () => {
    // OpenRouter's /models is public, so the server downloads the full catalog
    // with NO key. Intercept ONLY the openrouter.ai call so the test stays
    // hermetic; every other (localhost) fetch passes through untouched.
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const u =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (u.includes('openrouter.ai')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { id: 'z/live-model', name: 'Live Model', context_length: 8, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'reasoning'] },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return realFetch(input, init);
    });
    try {
      const ok = await fetch(base + '/api/models?backend=pi');
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.source).toBe('openrouter-live');
      expect(body.models.some((m: { id: string }) => m.id === 'z/live-model')).toBe(true);

      const bad = await fetch(base + '/api/models?backend=nope');
      expect(bad.status).toBe(400);
    } finally {
      spy.mockRestore();
      resetCapabilitiesCache();
    }
  });

  it('reports stub needs no key', async () => {
    const json = await (await fetch(base + '/api/keys?backend=stub')).json();
    expect(json.ok).toBe(true);
    expect(json.missing).toEqual([]);
  });

  it('opens an SSE stream and replays a frame immediately', async () => {
    const res = await fetch(base + '/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('data:');
    await reader.cancel();
  });

  it('streams live agent output as agent-stream SSE frames AND into the run log', async () => {
    // Open the firehose BEFORE the run so we catch frames from the first delta.
    const sse = await fetch(base + '/events');
    const reader = sse.body!.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const readFrames = async (): Promise<Record<string, unknown>[]> => {
      const { value, done } = await reader.read();
      if (done) return [];
      pending += decoder.decode(value, { stream: true });
      const out: Record<string, unknown>[] = [];
      let sep: number;
      while ((sep = pending.indexOf('\n\n')) !== -1) {
        const block = pending.slice(0, sep);
        pending = pending.slice(sep + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            out.push(JSON.parse(line.slice(5).trim()));
          } catch {
            /* keep-alive comment or partial — ignore */
          }
        }
      }
      return out;
    };

    await fetch(base + '/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineName: 'web-test-pipe', backend: 'stub', modelId: 'stub' }),
    });

    // Read frames until the stub's first assistant line surfaces on the firehose.
    const deadline = Date.now() + 25_000;
    let assistant: Record<string, unknown> | undefined;
    const channels = new Set<string>();
    while (!assistant && Date.now() < deadline) {
      const frames = await readFrames();
      for (const f of frames) {
        if (f.type !== 'agent-stream') continue;
        channels.add(String(f.channel));
        if (f.channel === 'assistant') assistant = f;
      }
    }
    await reader.cancel();

    expect(assistant, 'never received an assistant agent-stream frame').toBeDefined();
    expect(String(assistant!.text)).toMatch(/simulating LLM call/);
    expect(typeof assistant!.agentId).toBe('number');
    // The thinking channel is mirrored to the firehose too (console-only).
    expect(channels.has('thinking')).toBe(true);

    // Same assistant line must also have advanced the visible run log (request #1):
    // not just the console firehose (request #2).
    const logs = manager.getSnapshot().state?.logs ?? [];
    expect(logs.some((l) => /simulating LLM call/.test(l.message))).toBe(true);

    manager.abort();
  }, 30_000);

  it('drives a full stub run from POST /api/run to done', async () => {
    const res = await fetch(base + '/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineName: 'web-test-pipe',
        backend: 'stub',
        modelId: 'stub',
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Poll the manager until the run settles (or time out).
    const deadline = Date.now() + 25_000;
    let phase = manager.getSnapshot().phase;
    while ((phase === 'running' || phase === 'idle') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      phase = manager.getSnapshot().phase;
    }
    const snap = manager.getSnapshot();
    expect(phase, snap.errorReason ?? 'no error reason').toBe('done');
    expect(snap.state).not.toBeNull();
    // The snapshot carries the project directory it ran in (defaults to cwd),
    // so the client can label the run selector by project, not just pipeline.
    expect(snap.runDirectory).toBe(repo);
  }, 30_000);

  it('validates POST /api/run/retry and no-ops an unknown run', async () => {
    // Missing/invalid agentId is a 400.
    const bad = await fetch(base + '/api/run/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'nope' }),
    });
    expect(bad.status).toBe(400);

    // Well-formed payload for an unknown run id is accepted as a silent no-op
    // (the run may have already finalized) — never a 500.
    const ok = await fetch(base + '/api/run/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'nope', agentId: 1, timeoutMinutes: 7 }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
  });

  it('accepts POST /api/run/finish for any run id', async () => {
    const res = await fetch(base + '/api/run/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'nope' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('accepts conflictResolverModelId on POST /api/run and starts the run', async () => {
    const res = await fetch(base + '/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineName: 'web-test-pipe',
        backend: 'stub',
        modelId: 'stub',
        conflictResolverModelId: 'deepseek/deepseek-v4-pro',
      }),
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.run.runId).toBeTruthy();
    manager.abort();
  }, 30_000);

  it('accepts concurrent runs (no 409) and tracks each by a distinct runId', async () => {
    const post = (): Promise<Response> =>
      fetch(base + '/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineName: 'web-test-pipe', backend: 'stub', modelId: 'stub' }),
      });
    const [r1, r2] = await Promise.all([post(), post()]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.run.runId).toBeTruthy();
    expect(j2.run.runId).toBeTruthy();
    expect(j1.run.runId).not.toBe(j2.run.runId);
    // The serialized snapshot exposes the run directory for the project selector.
    expect(j1.run.runDirectory).toBe(repo);
    expect(j2.run.runDirectory).toBe(repo);
    // Both runs are tracked by the manager (same repo → repo-lock serializes git).
    const ids = manager.getSnapshots().map((s) => s.runId);
    expect(ids).toContain(j1.run.runId);
    expect(ids).toContain(j2.run.runId);
    manager.abort();
  }, 30_000);

  it('keeps the run alive when the browser (SSE) disconnects — closing the site never aborts', async () => {
    // Start a stub run. Stub agents sleep 2–5s, so the run stays active well
    // past the disconnect below — the assertion can't race the run settling.
    await fetch(base + '/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineName: 'web-test-pipe', backend: 'stub', modelId: 'stub' }),
    });
    expect(manager.isActive()).toBe(true);

    // Open the SSE stream (a "browser"), read its first replayed frame, then
    // drop the connection — exactly what closing the tab does.
    const sse = await fetch(base + '/events');
    const reader = sse.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 150)); // let req 'close' land server-side

    // The run lives in the server process, not the browser: disconnect ≠ abort.
    expect(manager.isActive()).toBe(true);
    // A freshly reopened page re-syncs to the still-running run. Bootstrap
    // reports every tracked run under `runs[]` (multi-run); the stub run we
    // started must still be in there as 'running'.
    const boot = await (await fetch(base + '/api/bootstrap')).json();
    expect(boot.runs.some((r: { phase: string }) => r.phase === 'running')).toBe(true);

    manager.abort();
  });

  it('404s unknown API routes and missing assets', async () => {
    expect((await fetch(base + '/api/nope')).status).toBe(404);
    expect((await fetch(base + '/does-not-exist.js')).status).toBe(404);
  });

  it('configures SSE-safe HTTP timeouts (request-receipt timer off, slowloris guard on)', () => {
    // Node's default 5-minute requestTimeout must never sit under the
    // long-lived /events stream; the client watchdog is the primary defense,
    // this is the belt.
    expect(server.requestTimeout).toBe(0);
    expect(server.headersTimeout).toBe(60_000);
  });
});

describe('web server — SSE heartbeat', () => {
  let repo: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'huu-web-hb-'));
    setupRepo(repo);
    // Injectable interval so the test observes a ping in milliseconds, not 25 s.
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true, heartbeatMs: 40 }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
  });

  it('emits the keep-alive as a REAL `event: ping` frame, not an invisible comment', async () => {
    // An SSE comment (`: ping`) never reaches the browser's EventSource API,
    // which is why the client could not tell a quiet stream from a dead one.
    // The heartbeat must be a named event the client watchdog can observe.
    const res = await fetch(base + '/events');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 2_000;
    while (!text.includes('event: ping') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(text).toContain('event: ping');
    expect(text).not.toContain('\n: ping'); // the old comment form is gone
  });
});

describe('web server token gate', () => {
  let repo: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'huu-web-tok-'));
    setupRepo(repo);
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true, token: 'sekret' }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
  });

  it('serves the shell without a token but gates /api', async () => {
    expect((await fetch(base + '/')).status).toBe(200);
    expect((await fetch(base + '/api/bootstrap')).status).toBe(401);
    expect((await fetch(base + '/api/bootstrap?token=sekret')).status).toBe(200);
    const viaHeader = await fetch(base + '/api/bootstrap', {
      headers: { 'x-huu-token': 'sekret' },
    });
    expect(viaHeader.status).toBe(200);
  });
});

describe('web server — machine-global settings (/api/settings)', () => {
  let repo: string;
  let cfgHome: string;
  let server: Server;
  let base: string;
  let savedXdg: string | undefined;

  beforeEach(async () => {
    // Hermetic settings location: webSettingsPath() honors XDG_CONFIG_HOME, so
    // the test never touches the user's real ~/.config/huu.
    savedXdg = process.env.XDG_CONFIG_HOME;
    cfgHome = mkdtempSync(join(tmpdir(), 'huu-web-cfg-'));
    process.env.XDG_CONFIG_HOME = cfgHome;
    repo = mkdtempSync(join(tmpdir(), 'huu-web-'));
    setupRepo(repo);
    ({ server } = createWebServer({
      cwd: repo,
      defaultAutoScale: true,
      initialPipeline: PIPELINE,
    }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
    rmSync(cfgHome, { recursive: true, force: true });
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  });

  it('POST /api/settings applies + persists the dial and echoes the effective value', async () => {
    const res = await fetch(base + '/api/settings', {
      method: 'POST',
      body: JSON.stringify({ ramPercent: 50 }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; ramPercent: number };
    expect(json.ok).toBe(true);
    expect(json.ramPercent).toBe(50);

    // Persisted server-side…
    const onDisk = JSON.parse(
      readFileSync(join(cfgHome, 'huu', 'web-settings.json'), 'utf8'),
    ) as { ramPercent: number };
    expect(onDisk.ramPercent).toBe(50);

    // …and read back by bootstrap (the ⚙ modal's source of truth).
    const boot = (await (await fetch(base + '/api/bootstrap')).json()) as {
      settings: { ramPercent: number };
    };
    expect(boot.settings.ramPercent).toBe(50);
  });

  it('clamps out-of-range dials and clears the override on null', async () => {
    const over = (await (
      await fetch(base + '/api/settings', {
        method: 'POST',
        body: JSON.stringify({ ramPercent: 999 }),
      })
    ).json()) as { ramPercent: number };
    expect(over.ramPercent).toBe(95);

    const cleared = (await (
      await fetch(base + '/api/settings', {
        method: 'POST',
        body: JSON.stringify({ ramPercent: null }),
      })
    ).json()) as { ramPercent: number };
    expect(cleared.ramPercent).toBe(70); // env unset in tests → default
  });

  it('POST /api/run no longer honors a body ramPercent (settings own the dial)', async () => {
    // Regression for the silent-85% hole: a run POST carrying ramPercent must
    // not change the effective setting.
    await fetch(base + '/api/settings', {
      method: 'POST',
      body: JSON.stringify({ ramPercent: 40 }),
    });
    await fetch(base + '/api/run', {
      method: 'POST',
      body: JSON.stringify({
        backend: 'stub',
        pipelineName: 'web-test-pipe',
        modelId: 'stub',
        ramPercent: 90,
        runDirectory: repo,
      }),
    }).then((r) => r.json());
    const boot = (await (await fetch(base + '/api/bootstrap')).json()) as {
      settings: { ramPercent: number };
    };
    expect(boot.settings.ramPercent).toBe(40);
  });
});

describe('web server — OpenRouter key management (⚙ Options)', () => {
  let repo: string;
  let cfgHome: string;
  let server: Server;
  let base: string;
  // Hermetic: the key store honors XDG_CONFIG_HOME (and HUU_CONFIG_DIR would
  // override it), and the status endpoint reads the ambient env var — sandbox
  // all of them so the suite never touches the user's real key.
  const TRACKED = [
    'XDG_CONFIG_HOME',
    'HUU_CONFIG_DIR',
    'OPENROUTER_API_KEY',
    'OPENROUTER_API_KEY_FILE',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of TRACKED) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    cfgHome = mkdtempSync(join(tmpdir(), 'huu-web-cfg-'));
    process.env.XDG_CONFIG_HOME = cfgHome;
    repo = mkdtempSync(join(tmpdir(), 'huu-web-'));
    setupRepo(repo);
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true, initialPipeline: PIPELINE }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
    rmSync(cfgHome, { recursive: true, force: true });
    for (const k of TRACKED) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('status → save → status → clear round-trip (masked, never the raw value)', async () => {
    // Nothing anywhere yet.
    let st = (await (await fetch(base + '/api/keys/status?name=openrouter')).json()) as Record<
      string,
      unknown
    >;
    expect(st).toMatchObject({ name: 'openrouter', source: 'none', masked: null });

    // Ambient env var → the fallback tier.
    process.env.OPENROUTER_API_KEY = 'sk-or-envkey-12345678';
    st = (await (await fetch(base + '/api/keys/status?name=openrouter')).json()) as Record<
      string,
      unknown
    >;
    expect(st.source).toBe('env');
    expect(st.masked).toBe('sk-or-…5678');
    expect(st.envPresent).toBe(true);

    // Save via POST /api/keys: persisted to the config store AND registered as
    // the live in-session override — the status flips to 'options'.
    const save = await fetch(base + '/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'openrouter', value: 'sk-or-saved-abcdefgh' }),
    });
    expect(save.status).toBe(200);
    expect((await save.json()) as Record<string, unknown>).toMatchObject({
      ok: true,
      masked: 'sk-or-…efgh',
    });
    const onDisk = JSON.parse(readFileSync(join(cfgHome, 'huu', 'config.json'), 'utf8')) as {
      openrouter: string;
    };
    expect(onDisk.openrouter).toBe('sk-or-saved-abcdefgh');
    st = (await (await fetch(base + '/api/keys/status?name=openrouter')).json()) as Record<
      string,
      unknown
    >;
    expect(st.source).toBe('options');
    expect(st.masked).toBe('sk-or-…efgh');
    expect(JSON.stringify(st)).not.toContain('sk-or-saved-abcdefgh'); // masked only

    // Clear: store entry removed + override dropped → env is the fallback again.
    const del = (await (
      await fetch(base + '/api/keys?name=openrouter', { method: 'DELETE' })
    ).json()) as Record<string, unknown>;
    expect(del).toMatchObject({ ok: true, cleared: true, fallback: 'env' });
    st = (await (await fetch(base + '/api/keys/status?name=openrouter')).json()) as Record<
      string,
      unknown
    >;
    expect(st.source).toBe('env');
    expect(st.masked).toBe('sk-or-…5678');
  });

  it('rejects unknown spec names on status/save/clear', async () => {
    expect((await fetch(base + '/api/keys/status?name=nope')).status).toBe(400);
    expect((await fetch(base + '/api/keys?name=nope', { method: 'DELETE' })).status).toBe(400);
    const post = await fetch(base + '/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'nope', value: 'x' }),
    });
    expect(post.status).toBe(400);
  });
});

describe('web server — key POOL endpoints (⚙ Settings, multi-key rotation)', () => {
  let repo: string;
  let cfgHome: string;
  let server: Server;
  let base: string;
  // Same sandbox as the single-key suite: the pool lives in the very same
  // config store, so a leak here would rewrite the user's real key file.
  const TRACKED = [
    'XDG_CONFIG_HOME',
    'HUU_CONFIG_DIR',
    'OPENROUTER_API_KEY',
    'OPENROUTER_API_KEY_FILE',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};
  /** HTTP status the mocked OpenRouter probe answers with (200 = valid key). */
  let probeStatus = 200;
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    for (const k of TRACKED) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    cfgHome = mkdtempSync(join(tmpdir(), 'huu-web-pool-'));
    process.env.XDG_CONFIG_HOME = cfgHome;
    repo = mkdtempSync(join(tmpdir(), 'huu-web-'));
    setupRepo(repo);

    // Hermetic validate-then-persist: intercept ONLY openrouter.ai so the
    // pool endpoints exercise their real validation branch with no network.
    probeStatus = 200;
    const realFetch = globalThis.fetch;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const u =
        typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (u.includes('openrouter.ai')) {
        return Promise.resolve(new Response('{}', { status: probeStatus }));
      }
      return realFetch(input, init);
    }) as ReturnType<typeof vi.spyOn>;

    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true, initialPipeline: PIPELINE }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fetchSpy?.mockRestore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(cfgHome, { recursive: true, force: true });
    for (const k of TRACKED) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  const getPool = async (name = 'openrouter'): Promise<any> =>
    (await fetch(`${base}/api/keys/pool?name=${name}`)).json();

  const addKey = async (value: string): Promise<{ status: number; json: any }> => {
    const res = await fetch(base + '/api/keys/pool', {
      method: 'POST',
      body: JSON.stringify({ name: 'openrouter', value }),
    });
    return { status: res.status, json: await res.json() };
  };

  it('lists an empty pool and mirrors a legacy single key as a pool of one', async () => {
    let pool = await getPool();
    expect(pool).toMatchObject({ name: 'openrouter', current: 0, keys: [] });
    expect(typeof pool.label).toBe('string');
    expect(typeof pool.source).toBe('string');

    // The legacy flat field is the whole backwards-compat contract: an older
    // config (or an older huu writing one) must read back as a usable pool.
    await fetch(base + '/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'openrouter', value: 'sk-or-legacy-11112222' }),
    });
    pool = await getPool();
    expect(pool.keys).toHaveLength(1);
    expect(pool.keys[0]).toMatchObject({ index: 0, masked: 'sk-or-…2222', state: 'active' });
  });

  it('POST validates BEFORE persisting and NEVER returns a key value', async () => {
    const first = await addKey('sk-or-poolkey-aaaabbbb');
    expect(first.status).toBe(200);
    expect(first.json.ok).toBe(true);
    expect(first.json.validation).toEqual({ status: 'valid' });
    expect(first.json.keys).toHaveLength(1);
    expect(first.json.keys[0].masked).toBe('sk-or-…bbbb');
    // The raw value must not appear ANYWHERE in the payload.
    expect(JSON.stringify(first.json)).not.toContain('sk-or-poolkey-aaaabbbb');

    const second = await addKey('sk-or-poolkey-ccccdddd');
    expect(second.json.keys.map((k: { masked: string }) => k.masked)).toEqual([
      'sk-or-…bbbb',
      'sk-or-…dddd',
    ]);

    // The compatibility mirror: keys[0] is written back to the flat field so an
    // older huu sharing the same HUU_CONFIG_DIR still finds a usable key.
    const onDisk = JSON.parse(readFileSync(join(cfgHome, 'huu', 'config.json'), 'utf8')) as {
      openrouter: string;
      _pools: { openrouter: { keys: string[] } };
    };
    expect(onDisk.openrouter).toBe('sk-or-poolkey-aaaabbbb');
    expect(onDisk._pools.openrouter.keys).toHaveLength(2);
  });

  it('a key the provider rejects is a 400 CARRYING the httpStatus, and is never stored', async () => {
    probeStatus = 401;
    const res = await fetch(base + '/api/keys/pool', {
      method: 'POST',
      body: JSON.stringify({ name: 'openrouter', value: 'sk-or-rejected-99998888' }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { httpStatus: number; validation: { status: string } };
    // The status is what lets the client say "401 — check the key" instead of
    // a generic failure; it is the reason this is not a bare 400.
    expect(json.httpStatus).toBe(401);
    expect(json.validation.status).toBe('invalid');

    expect((await getPool()).keys).toEqual([]);
  });

  it('DELETE removes by index and reindexes what is left', async () => {
    await addKey('sk-or-first-11112222');
    await addKey('sk-or-second-33334444');
    const del = await fetch(base + '/api/keys/pool?name=openrouter&index=0', { method: 'DELETE' });
    expect(del.status).toBe(200);
    const json = (await del.json()) as { keys: { index: number; masked: string }[] };
    expect(json.keys).toHaveLength(1);
    expect(json.keys[0]).toMatchObject({ index: 0, masked: 'sk-or-…4444' });

    // A missing / non-numeric index is a 400, not a silent no-op.
    expect((await fetch(base + '/api/keys/pool?name=openrouter', { method: 'DELETE' })).status).toBe(400);
  });

  it('validate re-probes a STORED key, burning it on 401 — and reset clears that', async () => {
    await addKey('sk-or-probe-55556666');

    probeStatus = 403;
    const bad = (await (
      await fetch(base + '/api/keys/pool/validate', {
        method: 'POST',
        body: JSON.stringify({ name: 'openrouter', index: 0 }),
      })
    ).json()) as { validation: { status: string }; keys: { state: string; reason?: string }[] };
    expect(bad.validation.status).toBe('invalid');
    expect(bad.keys[0]!.state).toBe('burned');
    expect(bad.keys[0]!.reason).toBe('403');

    // reset clears the learned sidelining so the key rotates again.
    const reset = (await (
      await fetch(base + '/api/keys/pool/reset', {
        method: 'POST',
        body: JSON.stringify({ name: 'openrouter' }),
      })
    ).json()) as { keys: { state: string }[] };
    expect(reset.keys[0]!.state).toBe('active');

    // A successful re-probe also un-burns, so the user need not reset by hand.
    probeStatus = 401;
    await fetch(base + '/api/keys/pool/validate', {
      method: 'POST',
      body: JSON.stringify({ name: 'openrouter', index: 0 }),
    });
    expect((await getPool()).keys[0].state).toBe('burned');
    probeStatus = 200;
    const good = (await (
      await fetch(base + '/api/keys/pool/validate', {
        method: 'POST',
        body: JSON.stringify({ name: 'openrouter', index: 0 }),
      })
    ).json()) as { validation: { status: string }; keys: { state: string }[] };
    expect(good.validation.status).toBe('valid');
    expect(good.keys[0]!.state).toBe('active');
  });

  it('rejects unknown spec names and out-of-range indexes on every pool route', async () => {
    expect((await fetch(base + '/api/keys/pool?name=nope')).status).toBe(400);
    expect((await fetch(base + '/api/keys/pool?name=nope&index=0', { method: 'DELETE' })).status).toBe(400);
    for (const path of ['/api/keys/pool', '/api/keys/pool/reset', '/api/keys/pool/validate']) {
      const res = await fetch(base + path, {
        method: 'POST',
        body: JSON.stringify({ name: 'nope', value: 'x', index: 0 }),
      });
      expect(res.status, path).toBe(400);
    }
    // A well-known spec with nothing at that index is still a 400 (not a 500).
    const oob = await fetch(base + '/api/keys/pool/validate', {
      method: 'POST',
      body: JSON.stringify({ name: 'openrouter', index: 7 }),
    });
    expect(oob.status).toBe(400);
  });
});

describe('web server — dev-mode routing contract on /api/bootstrap', () => {
  let repo: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'huu-web-boot-'));
    setupRepo(repo);
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
  });

  it('serves the presets and the role list the client must not hardcode', async () => {
    const boot = (await (await fetch(base + '/api/bootstrap')).json()) as {
      devModelPresets: Record<string, Record<string, string>>;
      devModelRoles: string[];
    };
    // The four named presets, served from the same constant the compilers read.
    expect(Object.keys(boot.devModelPresets).sort()).toEqual([
      'hetero',
      'monoculture',
      'thrifty',
      'uniform',
    ]);
    // `hetero` is the default and its critic is deliberately cross-family.
    expect(boot.devModelPresets.hetero!.critic).toBe('moonshotai/kimi-k2.6');
    expect(boot.devModelPresets.hetero!.worker).toBe('deepseek/deepseek-v4-pro');
    // `uniform` routes nothing — it IS today's behavior.
    expect(boot.devModelPresets.uniform).toEqual({});
    expect(boot.devModelRoles).toEqual([
      'planner',
      'recon',
      'worker',
      'critic',
      'reporter',
      'judge',
      'integration',
    ]);
  });

  it('409s the resume and orphan gates when no session is waiting', async () => {
    for (const [path, body] of [
      ['/api/dev/resume', { accept: true }],
      ['/api/dev/orphans', { action: 'land' }],
    ] as const) {
      const res = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
      expect(res.status, path).toBe(409);
      expect((await res.json()).error, path).toBeTruthy();
    }
  });
});

describe('web server — translation catalog (/api/i18n)', () => {
  let repo: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'huu-web-i18n-'));
    setupRepo(repo);
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
  });

  it('serves the whole catalog for the requested locale', async () => {
    const res = await fetch(base + '/api/i18n?locale=pt-BR');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      locale: string;
      defaultLocale: string;
      locales: Array<{ id: string; label: string }>;
      messages: Record<string, string>;
    };
    expect(body.locale).toBe('pt-BR');
    expect(body.defaultLocale).toBe('en');
    expect(body.locales.map((l) => l.id)).toEqual(['en', 'pt-BR']);
    expect(body.messages['web.settings.title']).toBe('Configurações');
    expect(Object.keys(body.messages).length).toBeGreaterThan(400);
  });

  it('serves English for en and translates the same key differently', async () => {
    const en = (await (await fetch(base + '/api/i18n?locale=en')).json()) as {
      messages: Record<string, string>;
    };
    const pt = (await (await fetch(base + '/api/i18n?locale=pt-BR')).json()) as {
      messages: Record<string, string>;
    };
    expect(en.messages['web.settings.title']).toBe('Settings');
    expect(Object.keys(en.messages).sort()).toEqual(Object.keys(pt.messages).sort());
  });

  it('falls back to the process locale for an unknown one', async () => {
    const body = (await (await fetch(base + '/api/i18n?locale=klingon')).json()) as {
      locale: string;
    };
    expect(['en', 'pt-BR']).toContain(body.locale);
  });

  it('is reachable WITHOUT a token — the client paints its chrome before auth', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const gated = createWebServer({ cwd: repo, defaultAutoScale: true, token: 'sekret' });
    server = gated.server;
    base = await listenEphemeral(server);
    expect((await fetch(base + '/api/i18n')).status).toBe(200);
    expect((await fetch(base + '/api/bootstrap')).status).toBe(401);
  });
});

describe('web server — folder-picker workspace (HUU_WORKSPACE)', () => {
  let repo: string;
  let workspace: string;
  let server: Server;
  let base: string;
  let savedWs: string | undefined;

  beforeEach(async () => {
    savedWs = process.env.HUU_WORKSPACE;
    workspace = mkdtempSync(join(tmpdir(), 'huu-ws-'));
    // A sub-folder so the listing has an entry to assert on.
    execSync(`mkdir -p ${join(workspace, 'projectA')}`, { encoding: 'utf8' });
    process.env.HUU_WORKSPACE = workspace;
    repo = mkdtempSync(join(tmpdir(), 'huu-web-'));
    setupRepo(repo);
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true, initialPipeline: PIPELINE }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    if (savedWs === undefined) delete process.env.HUU_WORKSPACE;
    else process.env.HUU_WORKSPACE = savedWs;
  });

  it('bootstrap exposes the workspace root', async () => {
    const boot = (await (await fetch(base + '/api/bootstrap')).json()) as { workspace: string };
    expect(boot.workspace).toBe(workspace);
  });

  it('a bare /api/folders opens at the workspace root, not the cwd', async () => {
    const d = (await (await fetch(base + '/api/folders')).json()) as {
      path: string;
      entries: Array<{ name: string }>;
    };
    expect(d.path).toBe(workspace);
    expect(d.entries.map((e) => e.name)).toContain('projectA');
  });

  it('an explicit ?path still navigates anywhere reachable', async () => {
    const d = (await (
      await fetch(base + '/api/folders?path=' + encodeURIComponent(repo))
    ).json()) as { path: string };
    expect(d.path).toBe(repo);
  });
});
