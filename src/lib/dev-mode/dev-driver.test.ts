import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDevMode, MAX_CONSECUTIVE_EPOCH_FAILURES, type DevEvent, type DevRunHandle, type DevRunPhase } from './dev-driver.js';
import { devPaths, devSessionPaths } from './dev-protocol.js';
import { writeDevState } from './dev-state.js';
import { BASELINE_GAPS, DELIVERED_VS_PLANNED_GAP } from './knowledge-blackboard.js';
import type { KnowledgeGap, KnowledgeRequest } from './knowledge-schema.js';
import type { AgentFactory } from '../../orchestrator/types.js';
import type { AppConfig, DevFront, DevPlan, OrchestratorState } from '../types.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'huu-test',
      GIT_AUTHOR_EMAIL: 'huu@test.local',
      GIT_COMMITTER_NAME: 'huu-test',
      GIT_COMMITTER_EMAIL: 'huu@test.local',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

let repo: string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'huu-dev-driver-')));
  git(['init', '-q', '-b', 'main'], repo);
  writeFileSync(join(repo, 'README.md'), '# project\n');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture' }));
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const CONFIG: AppConfig = { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' };
const NOOP_FACTORY = (() => {
  throw new Error('agent factory must not be called in these tests');
}) as unknown as AgentFactory;

function frontFixture(id: string, over: Partial<DevFront> = {}): DevFront {
  return {
    id,
    title: `Front ${id}`,
    rationale: 'porque sim',
    dependsOnFronts: [],
    reconPrompt: 'mapeie',
    workPrompt: 'implemente',
    verifyCondition: 'pronto',
    maxTasks: 2,
    ...over,
  };
}

function planFixture(over: Partial<DevPlan> = {}): DevPlan {
  return {
    epochGoal: 'fatia 1',
    doneWhen: 'os testes passam',
    goalComplete: false,
    fronts: [frontFixture('a')],
    ...over,
  };
}

/**
 * A fake run that behaves like a real epoch: it produces commits on an
 * integration branch, exactly as the Orchestrator leaves things behind.
 */
function fakeRun(opts: {
  runId: string;
  status?: string;
  /** Files the epoch "wrote", committed onto the integration branch. */
  files?: Record<string, string>;
  /** Skip creating the branch, to simulate a run that produced nothing. */
  noBranch?: boolean;
  /** Cost reported beside the manifest, as `OrchestratorResult` does. */
  totalCost?: number;
  /** Pushed once into the driver's state mirror when it subscribes. */
  state?: OrchestratorState;
  /** Runs INSIDE start(), before the branch exists — the repo is as the driver left it. */
  beforeStart?: () => void;
}): DevRunHandle {
  const branch = `huu/${opts.runId}/integration`;
  return {
    subscribe: (listener) => {
      if (opts.state) listener(opts.state);
      return () => undefined;
    },
    start: async () => {
      opts.beforeStart?.();
      if (!opts.noBranch) {
        git(['checkout', '-q', '-b', branch], repo);
        for (const [path, content] of Object.entries(opts.files ?? { [`${opts.runId}.txt`]: 'x\n' })) {
          mkdirSync(join(repo, path, '..'), { recursive: true });
          writeFileSync(join(repo, path), content);
        }
        git(['add', '-A', '-f'], repo);
        git(['commit', '-q', '-m', `work ${opts.runId}`], repo);
        git(['checkout', '-q', 'main'], repo);
      }
      return {
        manifest: { runId: opts.runId, status: opts.status ?? 'done', integrationBranch: branch },
        ...(opts.totalCost === undefined ? {} : { totalCost: opts.totalCost }),
      };
    },
    abort: () => undefined,
  };
}

function gapFixture(id = 'como-roda-o-build'): KnowledgeGap {
  return {
    id,
    kind: 'repo',
    question: 'Como roda o build deste projeto?',
    why: 'todo front desta época depende do comando certo',
    goodAnswer: 'o comando exato, com o path do manifesto de onde ele veio',
  };
}

function knowledgeFixture(gaps: KnowledgeGap[] = [gapFixture()]): KnowledgeRequest {
  return { restatedGoal: 'o objetivo, com minhas palavras', gaps, planningNotes: 'notas' };
}

describe('runDevMode — knowledge gate', () => {
  it('skips the bootstrap when the repo already has routed skills', async () => {
    mkdirSync(join(repo, '.agents/skills/project-router'), { recursive: true });
    writeFileSync(join(repo, '.agents/skills/project-router/SKILL.md'), '# router\n');
    writeFileSync(join(repo, '.agents/skills/catalog.md'), '# catalog\n');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'skills'], repo);

    const events: DevEvent[] = [];
    const result = await runDevMode({
      dev: { goal: 'fazer a coisa', approval: 'autonomous', maxEpochs: 1 },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onEvent: (e) => events.push(e),
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'run-1' }),
    });

    expect(result.knowledge.present).toBe(true);
    expect(result.knowledgeBootstrapped).toBe(false);
    expect(events.some((e) => e.type === 'bootstrap-start')).toBe(false);
    expect(result.stoppedBecause).toBe('max-epochs');
  });

  it('honors skipKnowledgeBootstrap on a repo with no skills', async () => {
    const result = await runDevMode({
      dev: { goal: 'fazer a coisa', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'run-1' }),
    });

    expect(result.knowledge.present).toBe(false);
    expect(result.knowledgeBootstrapped).toBe(false);
    expect(result.stoppedBecause).toBe('max-epochs');
  });
});

describe('runDevMode — the blackboard', () => {
  it('commits the goal so agent worktrees can actually see it', async () => {
    await runDevMode({
      dev: { goal: 'migrar o parser', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'run-1' }),
    });

    // An agent worktree is checked out FROM A COMMIT — an uncommitted goal
    // file would simply not exist for the swarm.
    const tracked = git(['ls-files'], repo);
    expect(tracked).toContain(devPaths.goal);
    expect(tracked).toContain(devPaths.state);
    expect(readFileSync(join(repo, devPaths.goal), 'utf8')).toContain('migrar o parser');
  });

  it('records each epoch in state.json', async () => {
    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async (o) => planFixture({ epochGoal: `fatia ${o.epoch}` }),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    const state = JSON.parse(readFileSync(join(repo, devPaths.state), 'utf8'));
    expect(state._format).toBe('huu-devstate-v2');
    expect(state.epochs).toHaveLength(2);
    expect(state.epochs[0].epochGoal).toBe('fatia 1');
    expect(state.epochs[1].landedCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  // The whole reason `commitBlackboard` exists: leaving these files dirty
  // makes epoch 2's landing merge refuse.
  it('leaves the working tree clean between epochs', async () => {
    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 3, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
  });
});

describe('runDevMode — working-tree hygiene', () => {
  it('refuses to start when the user has uncommitted work', async () => {
    writeFileSync(join(repo, 'README.md'), 'edição local não commitada\n');

    let planned = 0;
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => {
        planned++;
        return planFixture();
      },
      orchestratorFactory: () => fakeRun({ runId: 'never' }),
    });

    expect(result.stoppedBecause).toBe('dirty-tree');
    expect(result.detail).toMatch(/README\.md/);
    expect(planned).toBe(0);
    // The user's edit is untouched.
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toContain('edição local');
  });

  // REGRESSION (found by the first end-to-end stub session): `Orchestrator.start()`
  // calls ensureGitignored for `.huu-worktrees/`, the run-log dir, `.env.huu`
  // and the agent bin dir. On a repo that never ran huu that CREATES
  // `.gitignore`, leaving the tree dirty — and `landEpoch` then refuses to
  // merge, so every epoch after the first died with "uncommitted changes".
  it('sweeps huu-written .gitignore changes before landing', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => ({
        subscribe: () => () => undefined,
        start: async () => {
          // Exactly what the real orchestrator does at startup.
          writeFileSync(join(repo, '.gitignore'), '.huu-worktrees/\n.huu/\n.env.huu\n');
          const branch = `huu/run-${epoch}/integration`;
          git(['checkout', '-q', '-b', branch], repo);
          writeFileSync(join(repo, `epoch-${epoch}.ts`), `export const e = ${epoch};\n`);
          git(['add', '-A', '-f'], repo);
          git(['commit', '-q', '-m', `work ${epoch}`], repo);
          git(['checkout', '-q', 'main'], repo);
          return { manifest: { runId: `run-${epoch}`, status: 'done', integrationBranch: branch } };
        },
        abort: () => undefined,
      }),
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    expect(result.epochs).toHaveLength(2);
    expect(result.epochs.every((e) => e.landedCommit)).toBe(true);
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
    expect(git(['ls-files'], repo)).toContain('.gitignore');
  });

  // A leftover epoch directory is huu's, not the user's — it must not be
  // mistaken for uncommitted user work on a second session.
  it('ignores a stale dev blackboard when checking for user changes', async () => {
    mkdirSync(join(repo, devPaths.frontDir(1, 'old')), { recursive: true });
    writeFileSync(join(repo, devPaths.epochReport(1)), '# relatório antigo\n');

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'run-1' }),
    });

    expect(result.stoppedBecause).toBe('max-epochs');
  });
});

describe('runDevMode — the epoch chain', () => {
  it('lands every epoch onto the working branch', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 3, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) =>
        fakeRun({ runId: `run-${epoch}`, files: { [`epoch-${epoch}.ts`]: `export const e = ${epoch};\n` } }),
    });

    expect(result.epochs).toHaveLength(3);
    expect(result.epochs.every((e) => e.landedCommit)).toBe(true);
    const tracked = git(['ls-files'], repo);
    for (const epoch of [1, 2, 3]) expect(tracked).toContain(`epoch-${epoch}.ts`);
  });

  it('feeds the previous epoch report to the next planner', async () => {
    const seenReports: (string | undefined)[] = [];

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async (o) => {
        seenReports.push(o.previousReport);
        return planFixture();
      },
      orchestratorFactory: (_p, epoch) =>
        fakeRun({
          runId: `run-${epoch}`,
          files: { [devPaths.epochReport(epoch)]: `## Entregue\nepoch ${epoch}\n` },
        }),
    });

    expect(seenReports[0]).toBeUndefined();
    expect(seenReports[1]).toContain('epoch 1');
  });

  it('passes the accumulated history to the planner', async () => {
    const historyLengths: number[] = [];

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 3, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async (o) => {
        historyLengths.push(o.history.length);
        return planFixture();
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    expect(historyLengths).toEqual([0, 1, 2]);
  });

  it('refuses goalComplete on epoch 1 (requires corroboration)', async () => {
    let runs = 0;
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 3, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture({ goalComplete: true, fronts: [] }),
      orchestratorFactory: () => {
        runs++;
        return fakeRun({ runId: 'never' });
      },
    });

    // goalComplete on epoch 1 is refused; the empty fronts trigger empty-plan
    expect(result.stoppedBecause).toBe('empty-plan');
    expect(result.goalComplete).toBe(false);
    expect(runs).toBe(0);
    expect(result.epochs).toHaveLength(0);
  });

  it('stops on goalComplete on epoch 2+ (corroborated)', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 3, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async (o) =>
        o.epoch === 1
          ? planFixture()
          : planFixture({ goalComplete: true, fronts: [] }),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    expect(result.stoppedBecause).toBe('goal-complete');
    expect(result.goalComplete).toBe(true);
    expect(result.epochs).toHaveLength(1);
  });

  it('stops when a plan has no fronts and does not claim completion', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture({ fronts: [] }),
      orchestratorFactory: () => fakeRun({ runId: 'never' }),
    });

    expect(result.stoppedBecause).toBe('empty-plan');
  });

  it('stops the chain when a landing conflicts', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => {
        if (epoch === 1) return fakeRun({ runId: 'run-1', files: { 'README.md': 'from the epoch\n' } });
        return fakeRun({ runId: 'run-2' });
      },
    });

    // Epoch 1 rewrote README.md, which is fine; nothing conflicts yet.
    expect(result.epochs[0]!.landedCommit).toBeTruthy();
    expect(result.stoppedBecause).toBe('max-epochs');
  });

  it('reports a run that produced no integration branch', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'run-1', noBranch: true }),
    });

    expect(result.stoppedBecause).toBe('landing-failed');
    expect(result.epochs[0]!.landingError).toMatch(/does not exist/);
  });

  it('surfaces a failed run after landing whatever merged', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 3, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'run-1', status: 'error' }),
    });

    expect(result.stoppedBecause).toBe('run-failed');
    // Partial work still lands — the next planner needs it on disk.
    expect(result.epochs[0]!.landedCommit).toBeTruthy();
  });

  it('turns a planner throw into a clean stop', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => {
        throw new Error('model refused');
      },
      orchestratorFactory: () => fakeRun({ runId: 'never' }),
    });

    expect(result.stoppedBecause).toBe('planner-failed');
    expect(result.detail).toMatch(/model refused/);
  });
});

describe('runDevMode — the consecutive-failure circuit breaker', () => {
  // An epoch FAILS when its execution run errors — even when the partial work
  // landed, which is exactly the Claude Code incident shape: the run keeps
  // "succeeding" just enough to be retried forever.
  it('stops with consecutive-failures after 3 error runs in a row, before the ceiling', async () => {
    const events: DevEvent[] = [];
    let workRuns = 0;

    const result = await runDevMode({
      dev: {
        goal: 'g',
        approval: 'autonomous',
        maxEpochs: MAX_CONSECUTIVE_EPOCH_FAILURES + 2,
        skipKnowledgeBootstrap: true,
      },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onEvent: (e) => events.push(e),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => {
        workRuns++;
        return fakeRun({ runId: `run-${epoch}`, status: 'error' });
      },
    });

    expect(result.stoppedBecause).toBe('consecutive-failures');
    // The breaker fired at the top of the 4th epoch — it never planned, never ran.
    expect(result.epochs).toHaveLength(MAX_CONSECUTIVE_EPOCH_FAILURES);
    expect(workRuns).toBe(MAX_CONSECUTIVE_EPOCH_FAILURES);
    expect(result.detail).toContain(`${MAX_CONSECUTIVE_EPOCH_FAILURES} consecutive`);
    const warnings = events.filter(
      (e): e is Extract<DevEvent, { type: 'log' }> => e.type === 'log' && e.level === 'warn',
    );
    expect(
      warnings.some(
        (w) =>
          w.message.includes('circuit breaker') &&
          w.message.includes(`${MAX_CONSECUTIVE_EPOCH_FAILURES} consecutive`),
      ),
    ).toBe(true);
  });

  // The other failure arm: the run "succeeded" but produced nothing to land.
  it('counts an epoch that ends without a landedCommit as a failure too', async () => {
    const result = await runDevMode({
      dev: {
        goal: 'g',
        approval: 'autonomous',
        maxEpochs: MAX_CONSECUTIVE_EPOCH_FAILURES + 2,
        skipKnowledgeBootstrap: true,
      },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}`, noBranch: true }),
    });

    expect(result.stoppedBecause).toBe('consecutive-failures');
    expect(result.epochs).toHaveLength(MAX_CONSECUTIVE_EPOCH_FAILURES);
    expect(result.epochs.every((e) => e.landedCommit === undefined)).toBe(true);
  });

  // The reset: fail, land clean, fail, fail — the count goes 1 → 0 → 1 → 2 and
  // never reaches 3, so the session runs to the ceiling and reports the LAST
  // failure, exactly as it did before the breaker existed.
  it('does NOT trip when a landed epoch resets the count between failures', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 4, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) =>
        fakeRun({ runId: `run-${epoch}`, status: epoch === 2 ? 'done' : 'error' }),
    });

    expect(result.epochs).toHaveLength(4);
    expect(result.epochs[1]!.landedCommit).toBeTruthy();
    expect(result.stoppedBecause).toBe('run-failed');
  });

  // An abort is never a failure: it neither increments nor consults the count.
  it('stays an abort even while failing epochs surround it', async () => {
    const controller = new AbortController();

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 5, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      signal: controller.signal,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => {
        if (epoch < 3) return fakeRun({ runId: `run-${epoch}`, status: 'error' });
        const inner = fakeRun({ runId: `run-${epoch}` });
        return { ...inner, start: async () => { controller.abort(); return inner.start(); } };
      },
    });

    // 2 consecutive failures, then the user stops: the reason is the abort,
    // not the breaker, and it would be even past the threshold.
    expect(result.stoppedBecause).toBe('aborted');
    expect(result.epochs[2]!.status).toBe('aborted');
  });
});

describe('runDevMode — approval', () => {
  it('runs the epoch when the human approves it', async () => {
    const seen: number[] = [];
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'each-epoch', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      onApprove: (_plan, epoch) => {
        seen.push(epoch);
        return true;
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    expect(seen).toEqual([1, 2]);
    expect(result.epochs).toHaveLength(2);
  });

  it('stops the session when the human rejects a plan', async () => {
    let runs = 0;
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'each-epoch', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      onApprove: () => false,
      orchestratorFactory: () => {
        runs++;
        return fakeRun({ runId: 'never' });
      },
    });

    expect(result.stoppedBecause).toBe('plan-rejected');
    expect(runs).toBe(0);
  });

  // A missing callback in each-epoch mode must FAIL CLOSED — running
  // unapproved work would be exactly the opposite of what the mode is for.
  it('fails closed when each-epoch is set with no approver wired', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'each-epoch', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'never' }),
    });

    expect(result.stoppedBecause).toBe('plan-rejected');
  });

  it('never asks for approval in autonomous mode', async () => {
    let asked = 0;
    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      onApprove: () => {
        asked++;
        return true;
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    expect(asked).toBe(0);
  });
});

describe('runDevMode — abort', () => {
  // REGRESSION (dossier finding A1): an aborted Orchestrator run still resolves
  // with manifest.status === 'done', so the driver used to LAND the half-done
  // epoch and start the next one while the UI said "aborted".
  it('stops the chain instead of starting the next epoch', async () => {
    const controller = new AbortController();
    let started = 0;

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 3, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      signal: controller.signal,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => {
        started++;
        const inner = fakeRun({ runId: `run-${epoch}` });
        return {
          ...inner,
          start: async () => {
            controller.abort();               // the user hits Stop mid-run
            return inner.start();             // …and the run still resolves 'done'
          },
        };
      },
    });

    expect(started).toBe(1);
    expect(result.stoppedBecause).toBe('aborted');
    expect(result.epochs).toHaveLength(1);
    expect(result.epochs[0]!.status).toBe('aborted');
  });

  it('does NOT land an aborted epoch, and names the branch that holds the work', async () => {
    const controller = new AbortController();

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      signal: controller.signal,
      planner: async () => planFixture(),
      orchestratorFactory: () => {
        const inner = fakeRun({ runId: 'run-1', files: { 'partial.ts': 'half done\n' } });
        return { ...inner, start: async () => { controller.abort(); return inner.start(); } };
      },
    });

    expect(result.epochs[0]!.landedCommit).toBeUndefined();
    // Partial, unjudged work must not reach the user's branch...
    expect(git(['ls-files'], repo)).not.toContain('partial.ts');
    // ...but it is not lost, and the message says exactly where it is.
    expect(result.epochs[0]!.landingError).toMatch(/huu\/run-1\/integration/);
  });

  it('cuts the live run through the handle', async () => {
    const controller = new AbortController();
    let abortCalls = 0;

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      signal: controller.signal,
      planner: async () => planFixture(),
      orchestratorFactory: () => {
        const inner = fakeRun({ runId: 'run-1' });
        return {
          ...inner,
          abort: () => { abortCalls++; },
          start: async () => { controller.abort(); return inner.start(); },
        };
      },
    });

    expect(abortCalls).toBe(1);
  });

  it('aborts before planning when the signal is already set', async () => {
    let planned = 0;
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      signal: AbortSignal.abort(),
      planner: async () => { planned++; return planFixture(); },
      orchestratorFactory: () => fakeRun({ runId: 'never' }),
    });

    expect(result.stoppedBecause).toBe('aborted');
    expect(planned).toBe(0);
    expect(result.epochs).toEqual([]);
  });

  it('is a no-op when no signal is wired (headless stays byte-identical)', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });
    expect(result.stoppedBecause).toBe('max-epochs');
    expect(result.epochs).toHaveLength(2);
  });
});

describe('runDevMode — epoch ceiling', () => {
  // The web surface sends no ceiling: run until the goal is done or aborted.
  it('treats an undefined maxEpochs as unbounded and stops on goalComplete', async () => {
    let epochsRun = 0;
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async (o) =>
        o.epoch > 5 ? planFixture({ goalComplete: true, fronts: [] }) : planFixture(),
      orchestratorFactory: (_p, epoch) => {
        epochsRun++;
        return fakeRun({ runId: `run-${epoch}` });
      },
    });

    // Ran well past the old default of 3 without any ceiling being configured.
    expect(epochsRun).toBe(5);
    expect(result.stoppedBecause).toBe('goal-complete');
  });

  it('still honors an explicit ceiling', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });
    expect(result.epochs).toHaveLength(2);
    expect(result.stoppedBecause).toBe('max-epochs');
  });
});

describe('runDevMode — events', () => {
  it('emits a coherent event sequence for one epoch', async () => {
    const events: DevEvent[] = [];
    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onEvent: (e) => events.push(e),
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'run-1' }),
    });

    const types = events.filter((e) => e.type !== 'log').map((e) => e.type);
    expect(types).toEqual(['knowledge', 'planning', 'planned', 'epoch-start', 'epoch-done', 'stopped']);
  });

  it('mirrors orchestrator state with its epoch number', async () => {
    const seen: number[] = [];
    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onState: (_s, epoch) => seen.push(epoch),
      planner: async () => planFixture(),
      orchestratorFactory: () => ({
        subscribe: (listener) => {
          listener({} as OrchestratorState);
          return () => undefined;
        },
        start: async () => {
          git(['checkout', '-q', '-b', 'huu/run-1/integration'], repo);
          writeFileSync(join(repo, 'x.txt'), 'x\n');
          git(['add', '-A'], repo);
          git(['commit', '-q', '-m', 'w'], repo);
          git(['checkout', '-q', 'main'], repo);
          return { manifest: { runId: 'run-1', status: 'done', integrationBranch: 'huu/run-1/integration' } };
        },
        abort: () => undefined,
      }),
    });

    expect(seen).toEqual([1]);
  });

  it('survives a throwing event observer', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onEvent: () => {
        throw new Error('observer blew up');
      },
      planner: async () => planFixture(),
      orchestratorFactory: () => fakeRun({ runId: 'run-1' }),
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    expect(existsSync(join(repo, devPaths.state))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase A — the knowledge run. An epoch is TWO runs, because the plan can only
// exist after the knowledge arrived.
// ---------------------------------------------------------------------------

const SESSION = 'sess1';
const paths = devSessionPaths(SESSION);

describe('runDevMode — the knowledge phase', () => {
  it('runs the knowledge pipeline first and hands its digest to the planner', async () => {
    const briefPacks: (string | undefined)[] = [];

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async (o) => {
        briefPacks.push(o.briefPack);
        return planFixture();
      },
      orchestratorFactory: (_p, epoch, phase) =>
        phase === 'knowledge'
          ? fakeRun({
              runId: `know-${epoch}`,
              files: {
                [paths.knowledgeDigest(epoch)]: `# Conhecimento — época ${epoch}\nnpm run build\n`,
              },
            })
          : fakeRun({ runId: `work-${epoch}` }),
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    expect(result.sessionId).toBe(SESSION);
    // The digest reached the blind orchestrator — the ONLY thing it ever reads
    // about this repository.
    expect(briefPacks[0]).toContain('npm run build');
  });

  it('runs exactly two runs per epoch, knowledge before work', async () => {
    const calls: { epoch: number; phase: DevRunPhase }[] = [];

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => {
        calls.push({ epoch, phase });
        return fakeRun({ runId: `${phase}-${epoch}` });
      },
    });

    expect(calls).toEqual([
      { epoch: 1, phase: 'knowledge' },
      { epoch: 1, phase: 'work' },
      { epoch: 2, phase: 'knowledge' },
      { epoch: 2, phase: 'work' },
    ]);
  });

  // The correctness requirement, not a style choice: `resolveMemoryFiles` reads
  // `filesFrom` out of the INTEGRATION worktree, which branches from HEAD. An
  // uncommitted spec does not exist there, and a list whose entries ALL vanish
  // makes the resolver THROW, which kills the run.
  it('commits the gap specs and the memory index BEFORE the knowledge run starts', async () => {
    let headAtStart = '';
    let indexAtStart = '';

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) =>
        phase === 'knowledge'
          ? fakeRun({
              runId: `know-${epoch}`,
              beforeStart: () => {
                headAtStart = git(['ls-tree', '-r', '--name-only', 'HEAD'], repo);
                indexAtStart = git(['show', `HEAD:${paths.knowledgeIndex(1)}`], repo);
              },
            })
          : fakeRun({ runId: `work-${epoch}` }),
    });

    expect(headAtStart).toContain(paths.knowledgeIndex(1));
    // Every entry the index names is in the same commit — which is what makes
    // the "listed N file(s) but none are usable" throw structurally unreachable.
    const index = JSON.parse(indexAtStart) as { _format: string; files: { path: string }[] };
    expect(index._format).toBe('huu-memory-v1');
    expect(index.files.length).toBeGreaterThan(0);
    for (const entry of index.files) expect(headAtStart).toContain(entry.path);

    // huu's four grounding gaps, plus the one the orchestrator asked for.
    const specs = headAtStart.split('\n').filter((p) => p.startsWith(`${paths.gapsDir(1)}/`));
    expect(specs).toHaveLength(BASELINE_GAPS.length + 1);
    expect(specs.some((p) => p.includes(BASELINE_GAPS[0]!.id))).toBe(true);
    expect(specs.some((p) => p.includes('como-roda-o-build'))).toBe(true);
  });

  it('asks delivered-vs-planned from epoch 2 on, not the baseline again', async () => {
    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => fakeRun({ runId: `${phase}-${epoch}` }),
    });

    const specs = readdirSync(join(repo, paths.gapsDir(2)));
    expect(specs.some((f) => f.includes(DELIVERED_VS_PLANNED_GAP.id))).toBe(true);
    expect(specs.some((f) => f.includes(BASELINE_GAPS[0]!.id))).toBe(false);
  });

  // ZERO gaps is a decision, not a defect: "I already know enough". It is also
  // what keeps a --stub session at ONE run per epoch.
  it('skips the whole knowledge phase when the orchestrator declares no gaps', async () => {
    const phases: DevRunPhase[] = [];

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => {
        phases.push(phase);
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    expect(phases).toEqual(['work']);
    expect(existsSync(join(repo, paths.knowledgeIndex(1)))).toBe(false);
    expect(result.stoppedBecause).toBe('max-epochs');
  });

  it('persists the compiled epoch graph as a portable artefact', async () => {
    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `work-${epoch}` }),
    });

    // Committed, not just written: an uncommitted file under `.huu/` leaves the
    // tree dirty and the landing merge refuses.
    expect(git(['ls-files'], repo)).toContain(paths.pipeline(1));
    const pipeline = JSON.parse(readFileSync(join(repo, paths.pipeline(1)), 'utf8'));
    expect(pipeline.steps.length).toBeGreaterThan(0);
  });
});

describe('runDevMode — the knowledge bootstrap', () => {
  // Until now the bootstrap built its Orchestrator INLINE: no run id, no SSE
  // frames, no abort handle, and the user's concurrency choices ignored.
  it('routes the bootstrap through runKnowledgeBootstrap (pi agent)', async () => {
    const calls: { epoch: number; phase: DevRunPhase }[] = [];
    const mirrored: number[] = [];
    const events: DevEvent[] = [];

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1 },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      onEvent: (e) => events.push(e),
      onState: (_s, epoch) => mirrored.push(epoch),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => {
        calls.push({ epoch, phase });
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    // The bootstrap NO LONGER routes through the orchestrator factory — it
    // uses `runKnowledgeBootstrap` (a direct pi session). Without the pi SDK
    // available in tests, the bootstrap errors out, but dev mode still
    // carries on with skipped knowledge.
    //
    // The important contract: the orchestrator factory was NOT called for
    // phase 'bootstrap' (epoch 0).
    const bootstrapCall = calls.find((c) => c.phase === 'bootstrap');
    expect(bootstrapCall).toBeUndefined();

    // The bootstrap-start event now carries the model, not a pipeline name.
    expect(events).toContainEqual({ type: 'bootstrap-start', model: CONFIG.modelId });
  });
});

describe('runDevMode — epoch evidence', () => {
  const runState = {
    agents: [
      { agentId: 1, stageName: 'frente a', state: 'done', phase: 'done', filesModified: ['src/a.ts'] },
      { agentId: 2, stageName: 'frente a', state: 'error', phase: 'error', filesModified: [] },
    ],
    checkRuns: [{ stepName: '1c. a — verificar', outcomeLabel: 'approved', fromJudge: true }],
    totalCost: 0.5,
  } as unknown as OrchestratorState;

  it('collects structured evidence from the last run state and the landing', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) =>
        phase === 'knowledge'
          ? fakeRun({
              runId: `know-${epoch}`,
              totalCost: 0.25,
              files: { [paths.knowledgeDigest(epoch)]: '# Conhecimento\n' },
            })
          : fakeRun({
              runId: `work-${epoch}`,
              totalCost: 0.5,
              state: runState,
              files: { 'src/a.ts': 'export const a = 1;\n' },
            }),
    });

    const record = result.epochs[0]!;
    // BOTH runs of the epoch — the knowledge run is not free.
    expect(record.costUsd).toBe(0.75);

    const evidence = record.evidence!;
    expect(evidence.epoch).toBe(1);
    expect(evidence.landing.landed).toBe(true);
    expect(evidence.landing.commit).toBe(record.landedCommit);
    expect(evidence.taskOutcomes).toEqual({ done: 1, noChanges: 0, failed: 1, unmerged: 0 });
    expect(evidence.verdicts).toEqual([
      { stepName: '1c. a — verificar', label: 'approved', fromJudge: true },
    ]);
    expect(evidence.filesChanged).toEqual(['src/a.ts']);
    // The diff stat is the range the LANDING produced, not a promise.
    expect(evidence.diffStat).toContain('src/a.ts');
  });

  // The instrumentation loop is only closed if the numbers leave the card:
  // they have to reach the epoch record (which is what the next planning pass
  // and the audit trail read) and the operator log (which is what a human
  // reads without opening the JSON).
  it('carries the instrumentation into the epoch record and logs one summary line', async () => {
    const instrumentedState = {
      agents: [
        {
          agentId: 1,
          stageName: '1b. a — implementar',
          state: 'done',
          phase: 'done',
          filesModified: ['src/a.ts'],
          writeSetViolations: ['src/fora-do-escopo.ts'],
          reviewRounds: 2,
          reviewStats: { provedBlocking: 1, unprovedBlocking: 0 },
        },
        {
          agentId: 2,
          stageName: '1b. a — implementar',
          state: 'done',
          phase: 'done',
          filesModified: [],
          reviewRounds: 3,
          reviewWaived: true,
          reviewStats: { provedBlocking: 0, unprovedBlocking: 2 },
        },
      ],
      checkRuns: [],
      stageIntegrations: [
        {
          stageName: '1b. a — implementar',
          branchesMerged: ['huu/work-1/agent-1', 'huu/work-1/agent-2'],
          branchesPending: [],
          conflicts: [{ file: 'src/a.ts', branches: ['huu/work-1/agent-2'], resolved: true }],
        },
      ],
      totalCost: 0,
    } as unknown as OrchestratorState;

    const events: DevEvent[] = [];
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      onEvent: (e) => events.push(e),
      orchestratorFactory: (_p, epoch) =>
        fakeRun({
          runId: `work-${epoch}`,
          state: instrumentedState,
          files: { 'src/a.ts': 'export const a = 1;\n' },
        }),
    });

    expect(result.epochs[0]!.evidence!.instrumentation).toEqual({
      writeSetViolations: [
        { agentId: 1, stageName: '1b. a — implementar', paths: ['src/fora-do-escopo.ts'] },
      ],
      review: { proved: 1, unproved: 2, rounds: [3, 2], waivedCount: 1 },
      mergeConflicts: [{ stageName: '1b. a — implementar', eligible: 2, conflicted: 1 }],
    });

    const summaries = events.filter(
      (e): e is Extract<DevEvent, { type: 'log' }> =>
        e.type === 'log' && e.message.includes('instrumentation:'),
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.message).toContain('epoch 1 instrumentation:');
    expect(summaries[0]!.message).toContain('write-set 1 file(s) across 1 task(s)');
    expect(summaries[0]!.message).toContain('blocking 1 proved / 2 unproved');
    expect(summaries[0]!.message).toContain('review rounds median 2.5 across 2 card(s)');
    expect(summaries[0]!.message).toContain('1 waived at the cap');
    expect(summaries[0]!.message).toContain('merge conflicts 1/2 branch(es) across 1 stage merge(s)');
  });

  it('feeds the previous epoch evidence to both stages of the next epoch', async () => {
    const askedWith: (number | undefined)[] = [];
    const plannedWith: (number | undefined)[] = [];

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async (o) => {
        askedWith.push(o.previousEvidence?.epoch);
        return knowledgeFixture([]);
      },
      planner: async (o) => {
        plannedWith.push(o.previousEvidence?.epoch);
        return planFixture();
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `work-${epoch}`, state: runState }),
    });

    expect(askedWith).toEqual([undefined, 1]);
    expect(plannedWith).toEqual([undefined, 1]);
  });
});

describe('runDevMode — abort across the two-run epoch', () => {
  it('does not land the knowledge run, and names the branch holding its work', async () => {
    const controller = new AbortController();
    const phases: DevRunPhase[] = [];

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      signal: controller.signal,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => {
        phases.push(phase);
        if (phase !== 'knowledge') return fakeRun({ runId: `work-${epoch}` });
        const inner = fakeRun({
          runId: 'know-1',
          files: { [paths.knowledgeDigest(1)]: '# Conhecimento\n' },
        });
        return {
          ...inner,
          start: async () => {
            const result = await inner.start();
            controller.abort(); // the user hits Stop between the two runs
            return result;
          },
        };
      },
    });

    // The work run never started…
    expect(phases).toEqual(['knowledge']);
    expect(result.stoppedBecause).toBe('aborted');
    // …nothing was landed…
    expect(git(['ls-files'], repo)).not.toContain(paths.knowledgeDigest(1));
    // …and the message says exactly where the work is and how to take it.
    expect(result.detail).toContain('huu/know-1/integration');
    expect(result.detail).toContain('git merge huu/know-1/integration');
  });
});

describe('runDevMode — resume', () => {
  async function firstSession(goal = 'g'): Promise<Awaited<ReturnType<typeof runDevMode>>> {
    return runDevMode({
      dev: { goal, approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `s1-work-${epoch}` }),
    });
  }

  it('continues the numbering and seeds the history when the offer is accepted', async () => {
    const first = await firstSession();
    expect(first.resumed).toBe(false);
    expect(first.epochs).toHaveLength(1);

    const offers: { epochs: number; nextEpoch: number }[] = [];
    const plannedEpochs: number[] = [];
    const historyLengths: number[] = [];

    const second = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onResumeOffer: (state, nextEpoch) => {
        offers.push({ epochs: state.epochs.length, nextEpoch });
        return true;
      },
      planner: async (o) => {
        plannedEpochs.push(o.epoch);
        historyLengths.push(o.history.length);
        return planFixture();
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `s2-work-${epoch}` }),
    });

    expect(offers).toEqual([{ epochs: 1, nextEpoch: 2 }]);
    expect(second.resumed).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    // `maxEpochs: 1` still means ONE MORE epoch, numbered 2.
    expect(plannedEpochs).toEqual([2]);
    expect(historyLengths).toEqual([1]);
    expect(second.epochs.map((e) => e.epoch)).toEqual([1, 2]);
  });

  // A different goal is a different session, full stop.
  it('never offers a resume for another goal', async () => {
    const first = await firstSession('migrar o parser');

    let offered = 0;
    const plannedEpochs: number[] = [];
    const second = await runDevMode({
      dev: { goal: 'outra coisa completamente', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onResumeOffer: () => {
        offered++;
        return true;
      },
      planner: async (o) => {
        plannedEpochs.push(o.epoch);
        return planFixture();
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `s2-work-${epoch}` }),
    });

    expect(offered).toBe(0);
    expect(second.resumed).toBe(false);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(plannedEpochs).toEqual([1]);
    expect(second.epochs.map((e) => e.epoch)).toEqual([1]);
  });

  // No callback ⇒ a fresh session, which is what keeps every existing caller
  // byte-identical.
  it('does not resume when nothing is wired to answer', async () => {
    const first = await firstSession();
    const second = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `s2-work-${epoch}` }),
    });

    expect(second.resumed).toBe(false);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.epochs.map((e) => e.epoch)).toEqual([1]);
  });

  it('resumes without asking under resume: auto', async () => {
    await firstSession();
    const second = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      resume: 'auto',
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `s2-work-${epoch}` }),
    });

    expect(second.resumed).toBe(true);
    expect(second.epochs.map((e) => e.epoch)).toEqual([1, 2]);
  });
});

describe('runDevMode — orphan integration branches', () => {
  function leaveOrphan(runId: string, file: string): void {
    git(['checkout', '-q', '-b', `huu/${runId}/integration`], repo);
    writeFileSync(join(repo, file), 'trabalho que ninguém mergeou\n');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', `orphan ${runId}`], repo);
    git(['checkout', '-q', 'main'], repo);
  }

  // A forgotten branch must never block a new session.
  it('reports an orphan and keeps going when the caller ignores it', async () => {
    leaveOrphan('dead1', 'orphan.ts');
    const seen: string[] = [];
    const warnings: string[] = [];

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onOrphanBranches: (orphans) => {
        seen.push(...orphans.map((o) => `${o.branch}:${o.ahead}`));
        return 'ignore';
      },
      onEvent: (e) => {
        if (e.type === 'log' && e.level === 'warn') warnings.push(e.message);
      },
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `work-${epoch}` }),
    });

    expect(seen).toEqual(['huu/dead1/integration:1']);
    expect(result.stoppedBecause).toBe('max-epochs');
    expect(result.epochs).toHaveLength(1);
    // Ignored means untouched — and named, with the command that takes it.
    expect(existsSync(join(repo, 'orphan.ts'))).toBe(false);
    expect(warnings.some((w) => w.includes('git merge huu/dead1/integration'))).toBe(true);
  });

  it('lands them when the caller asks for it', async () => {
    leaveOrphan('dead1', 'orphan.ts');

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      onOrphanBranches: () => 'land',
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `work-${epoch}` }),
    });

    expect(existsSync(join(repo, 'orphan.ts'))).toBe(true);
    expect(result.stoppedBecause).toBe('max-epochs');
  });

  it('warns and continues with no callback wired', async () => {
    leaveOrphan('dead1', 'orphan.ts');

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `work-${epoch}` }),
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    expect(existsSync(join(repo, 'orphan.ts'))).toBe(false);
  });
});

describe('runDevMode — model routing preflight', () => {
  const PI_CONFIG: AppConfig = { apiKey: 'stub', modelId: 'stub-model', backend: 'pi' };

  // Left to itself this throws INSIDE the first agent, after its worktree and
  // branch already exist.
  it('refuses to start when an agent role names an id the pi registry lacks', async () => {
    let planned = 0;

    const result = await runDevMode({
      dev: {
        goal: 'g',
        approval: 'autonomous',
        maxEpochs: 1,
        skipKnowledgeBootstrap: true,
        models: { worker: 'z-ai/glm-5.2' },
      },
      config: PI_CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => {
        planned++;
        return planFixture();
      },
      orchestratorFactory: () => fakeRun({ runId: 'never' }),
    });

    expect(result.stoppedBecause).toBe('model-preflight-failed');
    expect(result.detail).toContain('worker');
    expect(result.detail).toContain('z-ai/glm-5.2');
    expect(planned).toBe(0);
    // Refused before anything was written into the user's repo.
    expect(existsSync(join(repo, devPaths.state))).toBe(false);
  });

  // The carve-out that makes the default preset usable at all: the blind
  // orchestrator is a structured-output call, not a pi agent.
  it('never checks the planner role', async () => {
    const result = await runDevMode({
      dev: {
        goal: 'g',
        approval: 'autonomous',
        maxEpochs: 1,
        skipKnowledgeBootstrap: true,
        models: { planner: 'z-ai/glm-5.2', worker: 'deepseek/deepseek-v4-pro' },
      },
      config: PI_CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `work-${epoch}` }),
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    expect(result.epochs).toHaveLength(1);
  });

  it('stamps the routed roles onto the compiled epoch, and omits the rest', async () => {
    let compiled: { steps: { name: string; modelId?: string }[] } | undefined;

    await runDevMode({
      dev: {
        goal: 'g',
        approval: 'autonomous',
        maxEpochs: 1,
        skipKnowledgeBootstrap: true,
        models: { worker: 'deepseek/deepseek-v4-pro' },
      },
      config: PI_CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      orchestratorFactory: (pipeline, epoch) => {
        compiled = pipeline as unknown as typeof compiled;
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    const stamped = compiled!.steps.filter((s) => s.modelId !== undefined);
    expect(stamped.length).toBeGreaterThan(0);
    expect(stamped.every((s) => s.modelId === 'deepseek/deepseek-v4-pro')).toBe(true);
    // A role the policy does not name keeps omitting the field, so the run
    // model stays the single authority.
    expect(compiled!.steps.some((s) => s.modelId === undefined)).toBe(true);
  });

  it('verifyCommands populado', async () => {
    interface ReviewStep {
      name: string;
      modelId?: string;
      review?: { verifyCommands?: string[] };
    }
    let compiled: { steps: ReviewStep[] } | undefined;

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => {
        if (phase === 'knowledge') {
          return fakeRun({
            runId: `know-${epoch}`,
            files: {
              [paths.briefJson(epoch, 'build-test-commands')]: JSON.stringify({
                _format: 'huu-devbrief-v1',
                gapId: 'build-test-commands',
                kind: 'repo',
                confidence: 'high',
                answer: 'npm run typecheck && npm test',
                facts: ['npm run typecheck', 'npm test'],
                sources: ['package.json'],
                unknowns: [],
              }),
              [paths.knowledgeDigest(epoch)]: '# Conhecimento\nnpm run typecheck\nnpm test\n',
            },
          });
        }
        compiled = _p as unknown as typeof compiled;
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    // Find the work step (the one with the review field)
    const workStep = compiled!.steps.find(
      (s) => s.name.endsWith('— implementar') && s.review !== undefined,
    );
    expect(workStep).toBeDefined();
    expect(workStep!.review!.verifyCommands).toEqual(['npm run typecheck', 'npm test']);
  });
});

// ---------------------------------------------------------------------------
// M6-03 — epoch honesty
// ---------------------------------------------------------------------------

describe('M6-03 — alreadyUpToDate (epoca no-op NAO conta como landed)', () => {
  it('alreadyUpToDate: does not set landedCommit when the integration branch is already contained in HEAD', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => {
        if (epoch === 1) return fakeRun({ runId: 'run-1', files: { 'work.ts': 'done\n' } });
        // Epoch 2: create an integration branch with no new commits.
        // After start() returns, the driver calls persist() which may add a
        // commit to main, making this branch an ancestor → alreadyUpToDate.
        return {
          subscribe: () => () => undefined,
          start: async () => {
            const branch = 'huu/run-2/integration';
            git(['checkout', '-q', '-b', branch], repo);
            git(['checkout', '-q', 'main'], repo);
            return { manifest: { runId: 'run-2', status: 'done', integrationBranch: branch } };
          },
          abort: () => undefined,
        };
      },
    });

    // alreadyUpToDate is treated as a no-op, not a success
    expect(result.stoppedBecause).toBe('landing-failed');
    expect(result.epochs[1]!.landedCommit).toBeUndefined();
    expect(result.epochs[1]!.landingError).toMatch(/already contained in HEAD/);
  });
});

describe('M6-03 — goalComplete epoca 1 recusa', () => {
  it('goalComplete epoca 1 recusa — refuses goalComplete on the first epoch', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture({ goalComplete: true, fronts: [] }),
      orchestratorFactory: () => fakeRun({ runId: 'never' }),
    });

    expect(result.stoppedBecause).toBe('empty-plan');
    expect(result.goalComplete).toBe(false);
  });

  it('allows goalComplete on epoch 2 (corroborated)', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async (o) =>
        o.epoch === 1
          ? planFixture()
          : planFixture({ goalComplete: true, fronts: [] }),
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    expect(result.stoppedBecause).toBe('goal-complete');
    expect(result.goalComplete).toBe(true);
  });
});

describe('M6-03 — doneWhen diff no gate', () => {
  it('doneWhen diff no gate — injects doneWhen drift into the gate warnings', async () => {
    const gateWarnings: string[][] = [];

    await runDevMode({
      dev: { goal: 'g', approval: 'each-epoch', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async (o) => {
        if (o.epoch === 1) return planFixture({ doneWhen: 'os testes passam e a API não muda' });
        return planFixture({ doneWhen: 'apenas os testes passam' });
      },
      onApprove: (_plan, _epoch, warnings) => {
        gateWarnings.push([...warnings]);
        return true;
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    // Epoch 1: no previous doneWhen → no doneWhen warning
    expect(gateWarnings[0]!.some((w) => w.startsWith('doneWhen changed'))).toBe(false);
    // Epoch 2: doneWhen changed from "os testes passam e a API não muda" to "apenas os testes passam"
    expect(gateWarnings[1]!.some((w) => w.startsWith('doneWhen changed'))).toBe(true);
  });

  it('injects restatedGoal into the gate warnings', async () => {
    const gateWarnings: string[][] = [];

    await runDevMode({
      dev: { goal: 'migrar o parser', approval: 'each-epoch', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      onApprove: (_plan, _epoch, warnings) => {
        gateWarnings.push([...warnings]);
        return true;
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    // restatedGoal should appear in the gate warnings
    expect(gateWarnings[0]!.some((w) => w.startsWith('restatedGoal:'))).toBe(true);
    expect(gateWarnings[0]!.find((w) => w.startsWith('restatedGoal:'))).toContain(
      'o objetivo, com minhas palavras',
    );
  });

  it('shows neither doneWhen diff nor restatedGoal in autonomous mode (log only)', async () => {
    const events: string[] = [];

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async (o) => {
        if (o.epoch === 1) return planFixture({ doneWhen: 'a' });
        return planFixture({ doneWhen: 'b' });
      },
      onEvent: (e) => {
        if (e.type === 'log' && (e.message.includes('doneWhen changed') || e.message.includes('restatedGoal'))) {
          events.push(e.message);
        }
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `run-${epoch}` }),
    });

    // In autonomous mode, doneWhen diff and restatedGoal still appear in the log
    expect(events.some((m) => m.includes('doneWhen changed'))).toBe(true);
    expect(events.some((m) => m.includes('restatedGoal'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Onda 0 — declared-partition check AFTER the landing, and the persisted,
// classified verify commands.
// ---------------------------------------------------------------------------

/** A task spec in the exact shape the front recons are told to write. */
function specFixture(title: string, owned: string[]): string {
  return `# ${title}

## Objective
Fazer a coisa.

## Files this task OWNS
${owned.map((p) => `- ${p} — razão`).join('\n')}

## Steps
1. Faz.

## Done when
- Feito.

## Context
Nada.
`;
}

function briefJsonFixture(facts: string[]): string {
  return JSON.stringify({
    _format: 'huu-devbrief-v1',
    gapId: 'build-test-commands',
    kind: 'repo',
    confidence: 'high',
    answer: facts.join('; '),
    facts,
    sources: ['package.json'],
    unknowns: [],
  });
}

describe('runDevMode — the declared-partition check (post-landing)', () => {
  // REGRESSION (Onda 0.1 + 0.2): the scan ran BEFORE the epoch, over a
  // directory the front recons only fill DURING the run — and its gate regex
  // (`\\s` as a literal backslash-plus-s, and "owns" required before "files")
  // could never match the canonical `## Files this task OWNS` heading. Two
  // bugs, one outcome: the check saw nothing. It now runs over the LANDED
  // specs and is advisory: evidence + a warning, never a blocked epoch.
  it('records overlapping ownership as epoch evidence and keeps going', async () => {
    const warnings: string[] = [];
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      onEvent: (e) => {
        if (e.type === 'log' && e.level === 'warn') warnings.push(e.message);
      },
      orchestratorFactory: (_p, epoch) =>
        fakeRun({
          runId: `work-${epoch}`,
          files: {
            [`${paths.frontDir(epoch, 'a')}/T-001.md`]: specFixture('T-001 — A', ['src/shared.ts', 'src/a.ts']),
            [`${paths.frontDir(epoch, 'a')}/T-002.md`]: specFixture('T-002 — B', ['src/shared.ts', 'src/b.ts']),
          },
        }),
    });

    // Advisory, not blocking: the epoch landed and the session completed.
    expect(result.stoppedBecause).toBe('max-epochs');
    expect(result.epochs[0]!.landedCommit).toBeTruthy();

    const violations = result.epochs[0]!.evidence!.declaredPartitionViolations!;
    expect(violations).toHaveLength(1);
    expect(violations[0]!.path).toBe('src/shared.ts');
    expect(violations[0]!.specs).toHaveLength(2);
    expect(violations[0]!.specs.some((s) => s.endsWith('T-001.md'))).toBe(true);
    expect(violations[0]!.specs.some((s) => s.endsWith('T-002.md'))).toBe(true);
    expect(
      warnings.some((w) => w.includes('Write-set partition violation') && w.includes('src/shared.ts')),
    ).toBe(true);
  });

  it('records nothing when the landed specs are disjoint', async () => {
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) =>
        fakeRun({
          runId: `work-${epoch}`,
          files: {
            [`${paths.frontDir(epoch, 'a')}/T-001.md`]: specFixture('T-001 — A', ['src/a.ts']),
            [`${paths.frontDir(epoch, 'a')}/T-002.md`]: specFixture('T-002 — B', ['src/b.ts']),
          },
        }),
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    expect(result.epochs[0]!.evidence!.declaredPartitionViolations).toBeUndefined();
  });
});

describe('runDevMode — persisted, classified verify commands', () => {
  interface ReviewStep {
    name: string;
    review?: { verifyCommands?: string[] };
  }

  function verifyCommandsOf(pipeline: unknown): string[] | undefined {
    const steps = (pipeline as { steps: ReviewStep[] }).steps;
    const workStep = steps.find((s) => s.name.endsWith('— implementar') && s.review !== undefined);
    return workStep?.review?.verifyCommands;
  }

  // REGRESSION (Onda 0.3a): the `build-test-commands` baseline gap is only
  // asked in epoch 1, so from epoch 2 on the critic silently lost its
  // executable anchor. The extraction is now persisted on DevState and reused.
  it('extracts in epoch 1, persists, and reuses the commands in epoch 2', async () => {
    const compiled: (string[] | undefined)[] = [];

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 2, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      // Epoch 2 declares no gaps: no new brief is ever written.
      knowledgePlanner: async (o) => (o.epoch === 1 ? knowledgeFixture() : knowledgeFixture([])),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => {
        if (phase === 'knowledge') {
          return fakeRun({
            runId: `know-${epoch}`,
            files: {
              [paths.briefJson(epoch, 'build-test-commands')]: briefJsonFixture([
                'build: npm run build',
                'test: npm test',
                'lint: npm run typecheck',
              ]),
              [paths.knowledgeDigest(epoch)]: '# Conhecimento\n',
            },
          });
        }
        compiled.push(verifyCommandsOf(_p));
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    // Both epochs compiled with the SAME commands, labels stripped, brief order.
    expect(compiled).toEqual([
      ['npm run build', 'npm test', 'npm run typecheck'],
      ['npm run build', 'npm test', 'npm run typecheck'],
    ]);

    const state = JSON.parse(readFileSync(join(repo, devPaths.state), 'utf8'));
    expect(state.verifyCommands).toEqual({
      all: ['npm run build', 'npm test', 'npm run typecheck'],
      build: ['npm run build'],
      test: ['npm test'],
      lint: ['npm run typecheck'],
    });
  });

  it('carries the persisted commands into a resumed session, with no brief anywhere', async () => {
    writeDevState(repo, {
      _format: 'huu-devstate-v2',
      goal: 'g',
      doneWhen: 'feito',
      epochs: [
        {
          epoch: 1,
          runId: 'r1',
          epochGoal: 'fatia 1',
          frontIds: ['a'],
          status: 'done',
          startedAt: '2026-07-01T00:00:00.000Z',
          finishedAt: '2026-07-01T01:00:00.000Z',
        },
      ],
      goalComplete: false,
      updatedAt: '2026-07-01T01:00:00.000Z',
      sessionId: SESSION,
      verifyCommands: { all: ['npm test'], build: [], test: ['npm test'], lint: [] },
    });

    const compiled: (string[] | undefined)[] = [];
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      resume: 'auto',
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => {
        compiled.push(verifyCommandsOf(_p));
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    expect(result.resumed).toBe(true);
    expect(result.stoppedBecause).toBe('max-epochs');
    expect(compiled).toEqual([['npm test']]);
  });

  it('falls back to re-extracting from an earlier brief when the state has none', async () => {
    // A state written BEFORE verifyCommands existed: valid v2, no field. The
    // epoch-1 brief is still on disk, so the resumed session recovers it.
    writeDevState(repo, {
      _format: 'huu-devstate-v2',
      goal: 'g',
      doneWhen: 'feito',
      epochs: [
        {
          epoch: 1,
          runId: 'r1',
          epochGoal: 'fatia 1',
          frontIds: ['a'],
          status: 'done',
          startedAt: '2026-07-01T00:00:00.000Z',
          finishedAt: '2026-07-01T01:00:00.000Z',
        },
      ],
      goalComplete: false,
      updatedAt: '2026-07-01T01:00:00.000Z',
      sessionId: SESSION,
    });
    mkdirSync(join(repo, paths.briefsDir(1)), { recursive: true });
    writeFileSync(
      join(repo, paths.briefJson(1, 'build-test-commands')),
      briefJsonFixture(['npm run typecheck', 'npm test']),
    );

    const compiled: (string[] | undefined)[] = [];
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      resume: 'auto',
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch) => {
        compiled.push(verifyCommandsOf(_p));
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    expect(compiled).toEqual([['npm run typecheck', 'npm test']]);
    // …and the recovery is persisted for the rest of the session.
    const state = JSON.parse(readFileSync(join(repo, devPaths.state), 'utf8'));
    expect(state.verifyCommands.all).toEqual(['npm run typecheck', 'npm test']);
  });
});

describe('runDevMode — planningNotes handed back to the planner', () => {
  // REGRESSION (Onda 0.4): the knowledge schema promises planningNotes come
  // back at planning time; the driver never passed them along.
  it('passes the knowledge request planningNotes into the plan call', async () => {
    const seen: (string | undefined)[] = [];

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture([]),
      planner: async (o) => {
        seen.push(o.planningNotes);
        return planFixture();
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `work-${epoch}` }),
    });

    expect(seen).toEqual(['notas']);
  });

  it('passes undefined when the knowledge request carried none', async () => {
    const seen: (string | undefined)[] = [];

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => ({ restatedGoal: 'sem notas', gaps: [] }),
      planner: async (o) => {
        seen.push(o.planningNotes);
        return planFixture();
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `work-${epoch}` }),
    });

    expect(seen).toEqual([undefined]);
  });
});

describe('runDevMode — methodology seam (config → compiler)', () => {
  interface ReviewStepLite {
    name: string;
    review?: { verifyCommands?: string[]; onBlocked?: string };
  }
  interface CompiledLite {
    mergeGate?: string;
    steps: ReviewStepLite[];
  }

  const LABELED_BRIEF = ['build: npm run build', 'test: npm test', 'lint: npm run typecheck'];

  function knowledgeRun(epoch: number, facts: string[]) {
    return fakeRun({
      runId: `know-${epoch}`,
      files: {
        [paths.briefJson(epoch, 'build-test-commands')]: briefJsonFixture(facts),
        [paths.knowledgeDigest(epoch)]: '# Conhecimento\n',
      },
    });
  }

  it('flows methodology + the classified command subsets into the compiled epoch', async () => {
    let compiled: CompiledLite | undefined;
    let plannerSaw: unknown;

    const result = await runDevMode({
      dev: {
        goal: 'g',
        approval: 'autonomous',
        maxEpochs: 1,
        skipKnowledgeBootstrap: true,
        methodology: { lintGate: true, planReview: true },
      },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async (o) => {
        plannerSaw = o.methodology;
        return planFixture();
      },
      orchestratorFactory: (_p, epoch, phase) => {
        if (phase === 'knowledge') return knowledgeRun(epoch, LABELED_BRIEF);
        compiled = _p as unknown as CompiledLite;
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    // The planner sees the checkboxes too (they constrain the plan's content).
    expect(plannerSaw).toEqual({ lintGate: true, planReview: true });
    // The merge gate gets the LINT subset only — never build/test.
    expect(compiled!.mergeGate).toBe('npm run typecheck');
    // The plan-validation pair is compiled in.
    const names = compiled!.steps.map((s) => s.name);
    expect(names).toContain('Revisar as escolhas');
    expect(names).toContain('Plano validado?');
    // The critic keeps the FLAT list as its anchor, exactly as before, and
    // any methodology on stamps the human escape.
    const work = compiled!.steps.find((s) => s.name.endsWith('— implementar'))!;
    expect(work.review!.verifyCommands).toEqual(['npm run build', 'npm test', 'npm run typecheck']);
    expect(work.review!.onBlocked).toBe('hold');
  });

  it('omits the merge gate and warns when lintGate is on but no lint command was extracted', async () => {
    let compiled: CompiledLite | undefined;
    const warnings: string[] = [];

    const result = await runDevMode({
      dev: {
        goal: 'g',
        approval: 'autonomous',
        maxEpochs: 1,
        skipKnowledgeBootstrap: true,
        methodology: { lintGate: true },
      },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      onEvent: (e) => {
        if (e.type === 'log' && e.level === 'warn') warnings.push(e.message);
      },
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => {
        if (phase === 'knowledge') return knowledgeRun(epoch, ['build: npm run build', 'test: npm test']);
        compiled = _p as unknown as CompiledLite;
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    expect(result.stoppedBecause).toBe('max-epochs');
    expect(compiled!.mergeGate).toBeUndefined();
    expect(warnings.some((m) => /lintGate is on but no lint\/typecheck commands/.test(m))).toBe(true);
  });

  // The driver must stay out of the way of an unflagged session: same brief
  // on disk, none of the new structure in the compiled epoch.
  it('compiles the legacy shape when no methodology is set', async () => {
    let compiled: CompiledLite | undefined;

    await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: SESSION,
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => knowledgeFixture(),
      planner: async () => planFixture(),
      orchestratorFactory: (_p, epoch, phase) => {
        if (phase === 'knowledge') return knowledgeRun(epoch, LABELED_BRIEF);
        compiled = _p as unknown as CompiledLite;
        return fakeRun({ runId: `work-${epoch}` });
      },
    });

    expect(compiled!.mergeGate).toBeUndefined();
    const names = compiled!.steps.map((s) => s.name);
    expect(names).not.toContain('Revisar as escolhas');
    expect(names).not.toContain('Plano validado?');
    const work = compiled!.steps.find((s) => s.name.endsWith('— implementar'))!;
    expect(work.review!.onBlocked).toBeUndefined();
    expect(work.review!.verifyCommands).toEqual(['npm run build', 'npm test', 'npm run typecheck']);
  });
});

// ---------------------------------------------------------------------------
// Onda 4 — the session-level bounds and the resume that reuses a persisted plan.
// ---------------------------------------------------------------------------

describe('runDevMode — session bounds', () => {
  it('stops on the cost ceiling BETWEEN epochs, with everything landed', async () => {
    let epochsRun = 0;
    const result = await runDevMode({
      dev: {
        goal: 'g',
        approval: 'autonomous',
        maxEpochs: 5,
        skipKnowledgeBootstrap: true,
        maxCostUsd: 1,
      },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      planner: async () => planFixture(),
      orchestratorFactory: () => {
        epochsRun++;
        return fakeRun({ runId: `run-${epochsRun}`, totalCost: 2 });
      },
    });

    expect(result.stoppedBecause).toBe('cost-ceiling');
    // The ceiling is checked BEFORE the next epoch's planner call, never by
    // killing a live swarm — that would lose the work AND still pay for it.
    expect(epochsRun).toBe(1);
    expect(result.epochs).toHaveLength(1);
    expect(result.epochs[0]!.landedCommit).toBeDefined();
  });

  it('finishes the epoch in flight when a graceful stop is requested', async () => {
    const graceful = new AbortController();
    let epochsRun = 0;
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 5, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      agentFactory: NOOP_FACTORY,
      gracefulSignal: graceful.signal,
      planner: async () => planFixture(),
      orchestratorFactory: () => {
        epochsRun++;
        // Requested DURING epoch 1 — the difference from a hard abort is that
        // epoch 1 still lands.
        graceful.abort();
        return fakeRun({ runId: `run-${epochsRun}` });
      },
    });

    expect(result.stoppedBecause).toBe('graceful-stop');
    expect(epochsRun).toBe(1);
    expect(result.epochs).toHaveLength(1);
    // The whole point: unlike an abort, the work MERGED.
    expect(result.epochs[0]!.landedCommit).toBeDefined();
    expect(result.epochs[0]!.status).toBe('done');
  });
});

describe('runDevMode — resuming an epoch whose EXECUTION never finished', () => {
  const RESUME_SESSION = 'resume-sess';
  const rpaths = devSessionPaths(RESUME_SESSION);

  /** A previous session that died with epoch 1 mid-execution. */
  function seedCrashedSession(): void {
    const pipelinePath = rpaths.pipeline(1);
    const pipeline = {
      name: 'huu Dev — época 1',
      description: 'Época 1: a fatia',
      steps: [
        {
          type: 'work' as const,
          name: '0. Recon do objetivo',
          scope: 'project' as const,
          files: [],
          dependsOn: [],
          prompt: 'PERSISTED PLAN — do not re-plan me',
        },
      ],
    };
    mkdirSync(join(repo, pipelinePath, '..'), { recursive: true });
    writeFileSync(join(repo, pipelinePath), `${JSON.stringify(pipeline, null, 2)}\n`);
    writeFileSync(
      join(repo, devPaths.state),
      JSON.stringify({
        _format: 'huu-devstate-v2',
        goal: 'g',
        doneWhen: 'feito',
        epochs: [],
        goalComplete: false,
        updatedAt: new Date(0).toISOString(),
        sessionId: RESUME_SESSION,
        pendingEpoch: { epoch: 1, pipelinePath, epochGoal: 'a fatia', frontIds: ['stub'] },
      }),
    );
    git(['add', '-A', '-f'], repo);
    git(['commit', '-q', '-m', 'crashed session'], repo);
  }

  it('re-runs the persisted plan instead of re-buying knowledge and planning', async () => {
    seedCrashedSession();
    let plannerCalls = 0;
    let knowledgeCalls = 0;
    const ranPrompts: string[] = [];

    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: RESUME_SESSION,
      resume: 'auto',
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => {
        knowledgeCalls++;
        return knowledgeFixture();
      },
      planner: async () => {
        plannerCalls++;
        return planFixture();
      },
      orchestratorFactory: (p, epoch) => {
        for (const step of p.steps) if ('prompt' in step) ranPrompts.push(step.prompt);
        return fakeRun({ runId: `resumed-${epoch}` });
      },
    });

    expect(result.resumed).toBe(true);
    // The expensive half of the epoch is NOT re-bought.
    expect(knowledgeCalls).toBe(0);
    expect(plannerCalls).toBe(0);
    // And what ran is the graph that was already on disk.
    expect(ranPrompts.join('\n')).toContain('PERSISTED PLAN — do not re-plan me');
    expect(result.epochs).toHaveLength(1);
    expect(result.epochs[0]!.epochGoal).toBe('a fatia');
    expect(result.epochs[0]!.frontIds).toEqual(['stub']);
    expect(result.epochs[0]!.landedCommit).toBeDefined();
  });

  it('plans the epoch again when the persisted plan is unreadable', async () => {
    // Degrade, never refuse: the file is plain JSON in the user's repo and a
    // resume is exactly when it may have been hand-edited or merged badly.
    seedCrashedSession();
    writeFileSync(join(repo, rpaths.pipeline(1)), '{ not a pipeline');
    git(['add', '-A', '-f'], repo);
    git(['commit', '-q', '-m', 'corrupt the plan'], repo);

    let plannerCalls = 0;
    const result = await runDevMode({
      dev: { goal: 'g', approval: 'autonomous', maxEpochs: 1, skipKnowledgeBootstrap: true },
      config: CONFIG,
      cwd: repo,
      sessionId: RESUME_SESSION,
      resume: 'auto',
      agentFactory: NOOP_FACTORY,
      knowledgePlanner: async () => ({ restatedGoal: 'r', gaps: [] }),
      planner: async () => {
        plannerCalls++;
        return planFixture();
      },
      orchestratorFactory: (_p, epoch) => fakeRun({ runId: `replanned-${epoch}` }),
    });

    expect(plannerCalls).toBe(1);
    expect(result.epochs).toHaveLength(1);
    expect(result.epochs[0]!.landedCommit).toBeDefined();
  });
});
