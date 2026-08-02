import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createWebServer } from './server.js';
import { runDevMode } from '../lib/dev-mode/dev-driver.js';
import { DEV_METHODOLOGIES } from '../lib/dev-mode/methodology-registry.js';

// Spy on the manager→driver seam: the REAL driver still runs underneath (the
// stub backend carries every session in this file), the wrapper only records
// what the manager handed over — the direct proof that a posted `methodology`
// reaches runDevMode, and that an absent one stays absent.
vi.mock('../lib/dev-mode/dev-driver.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/dev-mode/dev-driver.js')>();
  return { ...mod, runDevMode: vi.fn(mod.runDevMode) };
});

function setupRepo(dir: string): void {
  execSync('git init --initial-branch=main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"', { cwd: dir, shell: '/bin/bash' });
  writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.huu-worktrees/\n.huu/\n', 'utf8');
  execSync('git add -A && git commit -m init', { cwd: dir, encoding: 'utf8' });
}

async function listenEphemeral(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

describe('web server — development mode', () => {
  let repo: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'huu-web-dev-'));
    setupRepo(repo);
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await post(base, '/api/dev/abort', {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
  });

  it('serves the SPA shell at /dev (client routes on pathname)', async () => {
    for (const path of ['/dev', '/dev/']) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('app.js');
    }
  });

  // Discoverability: /dev is reachable ONLY by URL unless the shell links to
  // it. It first shipped without a single link and was effectively invisible.
  // The mode switch IS the entry point now — pin its shape.
  it('renders the mode switch so development mode is discoverable', async () => {
    const html = await (await fetch(base + '/')).text();
    expect(html).toContain('id="modeSwitch"');
    expect(html).toContain('id="modePipelines"');
    expect(html).toContain('id="modeDev"');
    expect(html).toContain('href="/dev"');
    // Both halves must be real links (bookmarkable, middle-clickable); the
    // client intercepts plain clicks to swap views without a reload.
    expect(html).toMatch(/<a[^>]+id="modeDev"[^>]+href="\/dev"/);
    expect(html).toMatch(/data-mode="launch"/);
    expect(html).toMatch(/data-mode="dev"/);
  });

  // Both routes serve the SAME shell, so the switch is present either way —
  // that is what lets /dev switch BACK to pipelines without a page load.
  it('serves the same switch on /dev', async () => {
    const html = await (await fetch(base + '/dev')).text();
    expect(html).toContain('id="modeSwitch"');
    expect(html).toContain('id="viewLaunch"');
    expect(html).toContain('id="viewDev"');
  });

  // The dev form's controls are the user's whole contract with the mode. Pin
  // them so a refactor that drops one fails here instead of silently.
  it('serves the dev form with its controls', async () => {
    const html = await (await fetch(base + '/dev')).text();
    for (const id of [
      'devGoal',          // the goal textarea
      'devMic',           // dictation
      'devFolderList',    // project selector (the pipeline picker, single-select)
      'devFolderHome',
      'devFolderUp',
      'devProviderSeg',
      'devModel',
      'devApprovalSeg',
      'devFrontsSeg',     // Auto | Manual, mirroring the pipeline concurrency seg
      'devFronts',
      'devMethodPanel',   // the methodology toggles, rendered from /api/bootstrap
      'devMethodList',
      'devStartBtn',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    // Both segmented controls must use the design system's classes, or they
    // render unstyled and the selection is invisible (this happened once).
    expect(html).toMatch(/<div class="segmented" id="devApprovalSeg">/);
    expect(html).toMatch(/<div class="segmented segmented--sm" id="devFrontsSeg">/);
  });

  // The user asked for no epoch cap: the session runs until the goal is
  // reported complete or they stop it.
  it('offers no epoch-limit control', async () => {
    const html = await (await fetch(base + '/dev')).text();
    expect(html).not.toContain('id="devEpochs"');
    expect(html).toContain('There is no epoch limit');
  });

  it('reports no session before one is started', async () => {
    const res = await fetch(base + '/api/dev');
    expect(res.status).toBe(200);
    expect((await res.json()).session).toBeNull();
  });

  it('rejects a session with no goal', async () => {
    const { status, json } = await post(base, '/api/dev', { modelId: 'stub-model', backend: 'stub' });
    expect(status).toBe(400);
    expect(json.error).toMatch(/goal is required/);
  });

  it('rejects a session with no model', async () => {
    const { status, json } = await post(base, '/api/dev', { goal: 'fazer algo', backend: 'stub' });
    expect(status).toBe(400);
    expect(json.error).toMatch(/modelId is required/);
  });

  it('starts a session and exposes it over /api/dev', async () => {
    const { status, json } = await post(base, '/api/dev', {
      goal: 'adicionar validação',
      modelId: 'stub-model',
      backend: 'stub',
      maxEpochs: 1,
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
    });
    expect(status).toBe(200);
    expect(json.sessionId).toBeTruthy();

    const session = (await (await fetch(base + '/api/dev')).json()).session;
    expect(session.goal).toBe('adicionar validação');
    expect(session.approval).toBe('each-epoch');
    expect(session.maxEpochs).toBe(1);
    expect(session.runDirectory).toContain(repo.replace(/^\/private/, ''));
  });

  it('runs unbounded when the client sends no epoch ceiling', async () => {
    await post(base, '/api/dev', {
      goal: 'sem teto',
      modelId: 'stub-model',
      backend: 'stub',
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
    });
    const session = (await (await fetch(base + '/api/dev')).json()).session;
    expect(session.maxEpochs).toBeNull();
  });

  // One session at a time: every epoch ends in a merge into the working
  // branch, so two concurrent sessions on one repo would race that merge.
  it('refuses a second concurrent session with 409', async () => {
    await post(base, '/api/dev', {
      goal: 'primeiro',
      modelId: 'stub-model',
      backend: 'stub',
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
    });
    const second = await post(base, '/api/dev', {
      goal: 'segundo',
      modelId: 'stub-model',
      backend: 'stub',
      skipKnowledgeBootstrap: true,
    });
    expect(second.status).toBe(409);
    expect(second.json.error).toMatch(/already running/);
  });

  it('answers 409 when approving with no plan pending', async () => {
    const { status, json } = await post(base, '/api/dev/approve', { approved: true });
    expect(status).toBe(409);
    expect(json.error).toMatch(/awaiting approval/);
  });

  it('parks at the approval gate and runs nothing until approved', async () => {
    await post(base, '/api/dev', {
      goal: 'objetivo com portão',
      modelId: 'stub-model',
      backend: 'stub',
      maxEpochs: 1,
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
    });

    // The stub planner resolves immediately, so the gate opens fast.
    let session: any;
    for (let i = 0; i < 60; i++) {
      session = (await (await fetch(base + '/api/dev')).json()).session;
      if (session?.awaitingApproval) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(session.awaitingApproval).toBe(true);
    expect(session.phase).toBe('awaiting-approval');
    expect(session.plan.fronts.length).toBeGreaterThan(0);
    // Nothing ran: no epoch record, no run ids.
    expect(session.epochs).toEqual([]);
    expect(session.runIds).toEqual([]);

    // Rejecting ends the session without running the swarm.
    const rejected = await post(base, '/api/dev/approve', { approved: false });
    expect(rejected.status).toBe(200);

    for (let i = 0; i < 60; i++) {
      session = (await (await fetch(base + '/api/dev')).json()).session;
      if (!session.active) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(session.active).toBe(false);
    expect(session.stoppedBecause).toBe('plan-rejected');
    expect(session.epochs).toEqual([]);
  });

  it('aborts an in-flight session', async () => {
    await post(base, '/api/dev', {
      goal: 'para abortar',
      modelId: 'stub-model',
      backend: 'stub',
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
    });

    for (let i = 0; i < 60; i++) {
      const s = (await (await fetch(base + '/api/dev')).json()).session;
      if (s?.awaitingApproval) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const { status, json } = await post(base, '/api/dev/abort', {});
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('reports abort as a no-op when nothing is running', async () => {
    const { status, json } = await post(base, '/api/dev/abort', {});
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
  });

  // ── Per-role model routing ──────────────────────────────────────────────

  // The COMPATIBILITY PROOF. A body carrying none of the new fields must reach
  // the driver with no policy at all, so every emitted step omits `modelId` and
  // the pipeline compiled is the one compiled before this feature existed.
  it('a body with no models routes nothing — every role reads back as modelId', async () => {
    await post(base, '/api/dev', {
      goal: 'sem roteamento',
      modelId: 'stub-model',
      backend: 'stub',
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
    });
    const session = (await (await fetch(base + '/api/dev')).json()).session;
    expect(Object.keys(session.models).sort()).toEqual(
      ['critic', 'integration', 'judge', 'planner', 'recon', 'reporter', 'worker'].sort(),
    );
    for (const [role, id] of Object.entries(session.models)) {
      expect(id, role).toBe('stub-model');
    }
    expect(session.resumed).toBe(false);
    expect(session.awaitingResume).toBe(false);
    expect(session.awaitingOrphans).toBe(false);
  });

  it('an explicit per-role policy resolves, with modelId as the fallback', async () => {
    await post(base, '/api/dev', {
      goal: 'com roteamento',
      modelId: 'stub-model',
      backend: 'stub',
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
      models: { planner: 'z-ai/glm-5.2', critic: '  moonshotai/kimi-k2.6  ', bogus: 'x', judge: 7 },
    });
    const session = (await (await fetch(base + '/api/dev')).json()).session;
    expect(session.models.planner).toBe('z-ai/glm-5.2');
    expect(session.models.critic).toBe('moonshotai/kimi-k2.6'); // trimmed
    // Unknown roles are dropped, non-strings are dropped, and everything the
    // policy did not name falls back — never throws, never refuses the run.
    expect(session.models.judge).toBe('stub-model');
    expect(session.models.worker).toBe('stub-model');
    expect(session.models).not.toHaveProperty('bogus');
  });

  it('a preset seeds the policy and explicit roles layer over it', async () => {
    await post(base, '/api/dev', {
      goal: 'com preset',
      modelId: 'fallback-model',
      backend: 'pi',
      provider: 'openrouter',
      apiKey: 'sk-or-test-key-0000',
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
      modelsPreset: 'hetero',
      models: { reporter: 'deepseek/deepseek-v4-flash' },
    });
    const session = (await (await fetch(base + '/api/dev')).json()).session;
    expect(session.models.worker).toBe('deepseek/deepseek-v4-pro'); // from the preset
    expect(session.models.critic).toBe('moonshotai/kimi-k2.6'); // cross-family, from the preset
    expect(session.models.reporter).toBe('deepseek/deepseek-v4-flash'); // explicit wins
  });

  // The strongest available proof that the policy REACHES `runDevMode`: the pi
  // model-registry preflight lives inside the driver and nowhere else, so only
  // a policy that actually got there can trip it.
  it('the policy reaches runDevMode — an unknown worker id fails the driver preflight', async () => {
    await post(base, '/api/dev', {
      goal: 'preflight de modelo',
      modelId: 'deepseek/deepseek-v4-pro',
      backend: 'pi',
      provider: 'openrouter',
      apiKey: 'sk-or-test-key-0000',
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
      models: { worker: 'nobody/invented-this-model' },
    });
    let session: any;
    for (let i = 0; i < 80; i++) {
      session = (await (await fetch(base + '/api/dev')).json()).session;
      if (!session.active) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(session.active).toBe(false);
    expect(session.stoppedBecause).toBe('model-preflight-failed');
    expect(session.detail).toMatch(/nobody\/invented-this-model/);
    // …and the `planner` carve-out holds: an id the pi registry has never heard
    // of is FINE there, because the planner never runs as a pi agent.
    expect(session.detail).not.toMatch(/planner:/);
  });

  // ── runIds carry the run's phase ────────────────────────────────────────

  // An epoch is two runs now, so the epoch number alone no longer identifies a
  // run. Under `--stub` the planner declares no knowledge gaps, so an approved
  // epoch produces exactly ONE `work` run — which is precisely the entry whose
  // phase we can pin without an LLM.
  it('registers each run with its phase in runIds', async () => {
    await post(base, '/api/dev', {
      goal: 'registrar fases',
      modelId: 'stub-model',
      backend: 'stub',
      maxEpochs: 1,
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
    });

    let session: any;
    for (let i = 0; i < 80; i++) {
      session = (await (await fetch(base + '/api/dev')).json()).session;
      if (session?.awaitingApproval) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(session.awaitingApproval).toBe(true);
    expect(session.runIds).toEqual([]);

    await post(base, '/api/dev/approve', { approved: true });
    for (let i = 0; i < 200; i++) {
      session = (await (await fetch(base + '/api/dev')).json()).session;
      if (session.runIds.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(session.runIds.length).toBeGreaterThan(0);
    expect(session.runIds[0]).toMatchObject({ epoch: 1, phase: 'work' });
    expect(typeof session.runIds[0].runId).toBe('string');
    // Every entry carries one of the three known phases — never undefined.
    for (const entry of session.runIds) {
      expect(['bootstrap', 'knowledge', 'work']).toContain(entry.phase);
    }
  }, 60_000);

  // ── Methodology checkboxes ────────────────────────────────────────────

  // The /dev "Metodologia" toggles: the catalog rides /api/bootstrap (the
  // client never hardcodes the list), and POST /api/dev coerces the field
  // defensively — only `true` under a KNOWN key survives, and a body that
  // enables nothing carries no `methodology` at all, which is what keeps such
  // a request compiling the exact pipeline it compiles today.
  describe('methodology plumbing', () => {
    beforeEach(() => {
      vi.mocked(runDevMode).mockClear();
    });

    const startWith = (extra: Record<string, unknown>): Promise<{ status: number; json: any }> =>
      post(base, '/api/dev', {
        goal: 'sessão com metodologia',
        modelId: 'stub-model',
        backend: 'stub',
        approval: 'each-epoch',
        skipKnowledgeBootstrap: true,
        ...extra,
      });

    /** The `dev` literal the manager handed runDevMode (the spy saw it). */
    const postedDev = () => {
      const spy = vi.mocked(runDevMode);
      expect(spy).toHaveBeenCalledTimes(1);
      return spy.mock.calls[0]![0].dev;
    };

    it('bootstrap serves the methodology catalog the /dev form renders', async () => {
      const boot = (await (await fetch(base + '/api/bootstrap')).json()) as {
        devMethodologyOptions: { key: string; label: string; description: string }[];
      };
      // The catalog IS the registry, projected — the browser must never see a
      // list that drifted from the CLI flags or the compiler.
      expect(boot.devMethodologyOptions.map((o) => o.key)).toEqual(
        DEV_METHODOLOGIES.map((d) => d.key),
      );
      // Only the browser-facing columns cross the wire.
      for (const opt of boot.devMethodologyOptions) {
        expect(Object.keys(opt).sort()).toEqual(['description', 'key', 'label']);
      }
      for (const opt of boot.devMethodologyOptions) {
        expect(opt.label).toBeTruthy();
        expect(opt.description).toBeTruthy();
      }
    });

    it('a posted methodology reaches runDevMode with exactly those keys', async () => {
      const { status } = await startWith({ methodology: { tdd: true, standards: true } });
      expect(status).toBe(200);
      expect(postedDev().methodology).toEqual({ tdd: true, standards: true });
    });

    // The COMPATIBILITY PROOF for this feature: no methodology in the body ⇒
    // the field is OMITTED from the dev literal, not merely undefined-valued.
    it('no methodology in the body ⇒ the field is omitted from the dev literal', async () => {
      const { status } = await startWith({});
      expect(status).toBe(200);
      expect('methodology' in postedDev()).toBe(false);
    });

    it('junk is coerced away — truthy strings and unknown keys survive nothing', async () => {
      const { status } = await startWith({ methodology: { tdd: 'yes', evil: true } });
      expect(status).toBe(200);
      expect('methodology' in postedDev()).toBe(false);
    });

    it('an all-false methodology is omitted too', async () => {
      const { status } = await startWith({ methodology: { tdd: false, lintGate: false } });
      expect(status).toBe(200);
      expect('methodology' in postedDev()).toBe(false);
    });

    it('a non-object methodology is omitted too', async () => {
      const { status } = await startWith({ methodology: 'tdd' });
      expect(status).toBe(200);
      expect('methodology' in postedDev()).toBe(false);
    });
  });
});

// ── The resume gate ───────────────────────────────────────────────────────

/** A previous session's state file, as `readDevState` expects to find it. */
function seedPreviousSession(repo: string, goal: string, sessionId: string): void {
  mkdirSync(join(repo, '.huu', 'dev'), { recursive: true });
  writeFileSync(
    join(repo, '.huu', 'dev', 'state.json'),
    JSON.stringify(
      {
        _format: 'huu-devstate-v2',
        goal,
        doneWhen: '',
        epochs: [],
        goalComplete: false,
        updatedAt: new Date().toISOString(),
        sessionId,
      },
      null,
      2,
    ),
    'utf8',
  );
}

describe('web server — development mode resume gate', () => {
  const GOAL = 'objetivo retomável';
  let repo: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'huu-web-dev-resume-'));
    setupRepo(repo);
    seedPreviousSession(repo, GOAL, 'sessao-anterior');
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await post(base, '/api/dev/abort', {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
  });

  const startSession = (extra: Record<string, unknown> = {}): Promise<{ status: number; json: any }> =>
    post(base, '/api/dev', {
      goal: GOAL,
      modelId: 'stub-model',
      backend: 'stub',
      maxEpochs: 1,
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
      ...extra,
    });

  const waitFor = async (predicate: (s: any) => boolean, tries = 80): Promise<any> => {
    let session: any;
    for (let i = 0; i < tries; i++) {
      session = (await (await fetch(base + '/api/dev')).json()).session;
      if (session && predicate(session)) return session;
      await new Promise((r) => setTimeout(r, 50));
    }
    return session;
  };

  it('parks at the resume gate and describes the session on offer', async () => {
    await startSession();
    const session = await waitFor((s) => s.awaitingResume === true);
    expect(session.awaitingResume).toBe(true);
    expect(session.resumeOffer).toEqual({
      sessionId: 'sessao-anterior',
      goal: GOAL,
      epochsDone: 0,
      nextEpoch: 1,
    });
    // The gate is a QUESTION during probing — it does not claim a new phase.
    expect(session.phase).toBe('probing');

    // Accepting adopts the previous namespace so the browser watches the right
    // directory, and releases the driver.
    const answered = await post(base, '/api/dev/resume', { accept: true });
    expect(answered.status).toBe(200);
    const after = await waitFor((s) => s.awaitingResume === false);
    expect(after.resumed).toBe(true);
    expect(after.sessionId).toBe('sessao-anterior');

    // A second answer is a 409 — a stale click can never pass for an answer.
    const stale = await post(base, '/api/dev/resume', { accept: true });
    expect(stale.status).toBe(409);
  });

  it('declining the gate starts a fresh session', async () => {
    await startSession();
    await waitFor((s) => s.awaitingResume === true);
    expect((await post(base, '/api/dev/resume', { accept: false })).status).toBe(200);
    const after = await waitFor((s) => s.awaitingResume === false);
    expect(after.resumed).toBe(false);
    expect(after.sessionId).not.toBe('sessao-anterior');
  });

  it('resume:"never" skips the gate entirely (today\'s behavior)', async () => {
    await startSession({ resume: 'never' });
    // The session runs straight through to the approval gate without ever
    // asking — the proof that an opted-out caller is unaffected.
    const session = await waitFor((s) => s.awaitingApproval === true);
    expect(session.awaitingApproval).toBe(true);
    expect(session.awaitingResume).toBe(false);
    expect(session.resumeOffer).toBeUndefined();
  });

  it('fails CLOSED: aborting while parked declines the resume', async () => {
    await startSession();
    await waitFor((s) => s.awaitingResume === true);
    expect((await post(base, '/api/dev/abort', {})).json.ok).toBe(true);
    const after = await waitFor((s) => s.active === false);
    expect(after.active).toBe(false);
    expect(after.awaitingResume).toBe(false);
    // Never adopted the previous namespace — an abort must not resume.
    expect(after.resumed).toBe(false);
    expect(after.sessionId).not.toBe('sessao-anterior');
  });
});

// ── The orphan-branch gate ────────────────────────────────────────────────

describe('web server — development mode orphan-branch gate', () => {
  let repo: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'huu-web-dev-orphan-'));
    setupRepo(repo);
    // A real integration branch HEAD does not contain — exactly what a crash
    // mid-session leaves behind. `git status` stays clean; the work is simply
    // not there, which is why it has to be REPORTED rather than logged.
    execSync('git checkout -b huu/lostrun/integration', { cwd: repo, encoding: 'utf8' });
    writeFileSync(join(repo, 'orphan.txt'), 'lost work\n', 'utf8');
    execSync('git add -A && git commit -m orphan', { cwd: repo, encoding: 'utf8', shell: '/bin/bash' });
    execSync('git checkout main', { cwd: repo, encoding: 'utf8' });
    ({ server } = createWebServer({ cwd: repo, defaultAutoScale: true }));
    base = await listenEphemeral(server);
  });

  afterEach(async () => {
    await post(base, '/api/dev/abort', {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(repo, { recursive: true, force: true });
  });

  const startSession = (): Promise<{ status: number; json: any }> =>
    post(base, '/api/dev', {
      goal: 'sessão com órfãos',
      modelId: 'stub-model',
      backend: 'stub',
      maxEpochs: 1,
      approval: 'each-epoch',
      skipKnowledgeBootstrap: true,
    });

  const waitFor = async (predicate: (s: any) => boolean, tries = 80): Promise<any> => {
    let session: any;
    for (let i = 0; i < tries; i++) {
      session = (await (await fetch(base + '/api/dev')).json()).session;
      if (session && predicate(session)) return session;
      await new Promise((r) => setTimeout(r, 50));
    }
    return session;
  };

  it('parks on the orphan branches it found and continues once answered', async () => {
    await startSession();
    const session = await waitFor((s) => s.awaitingOrphans === true);
    expect(session.awaitingOrphans).toBe(true);
    expect(session.orphans).toHaveLength(1);
    expect(session.orphans[0]).toMatchObject({
      branch: 'huu/lostrun/integration',
      runId: 'lostrun',
      ahead: 1,
    });

    const answered = await post(base, '/api/dev/orphans', { action: 'ignore' });
    expect(answered.status).toBe(200);
    expect(answered.json).toMatchObject({ ok: true, action: 'ignore' });

    // A forgotten branch must never BLOCK: the session proceeds to planning.
    const after = await waitFor((s) => s.awaitingApproval === true);
    expect(after.awaitingApproval).toBe(true);
    expect(after.awaitingOrphans).toBe(false);

    // Stale answer → 409.
    expect((await post(base, '/api/dev/orphans', { action: 'land' })).status).toBe(409);
  });

  it('fails CLOSED: aborting while parked answers "ignore" — nothing is merged', async () => {
    await startSession();
    await waitFor((s) => s.awaitingOrphans === true);
    expect((await post(base, '/api/dev/abort', {})).json.ok).toBe(true);
    const after = await waitFor((s) => s.active === false);
    expect(after.active).toBe(false);
    expect(after.awaitingOrphans).toBe(false);
    // The branch is still unmerged — an abort never lands work behind the user.
    const contained = execSync('git branch --contains huu/lostrun/integration', {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(contained).not.toMatch(/^\*?\s*main$/m);
  });
});
