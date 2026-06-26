import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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
    // Both runs are tracked by the manager (same repo → repo-lock serializes git).
    const ids = manager.getSnapshots().map((s) => s.runId);
    expect(ids).toContain(j1.run.runId);
    expect(ids).toContain(j2.run.runId);
    manager.abort();
  }, 30_000);

  it('404s unknown API routes and missing assets', async () => {
    expect((await fetch(base + '/api/nope')).status).toBe(404);
    expect((await fetch(base + '/does-not-exist.js')).status).toBe(404);
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
