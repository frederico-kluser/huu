// THE END-TO-END PROOF: a method a human DREW, run by the real machinery.
//
// Everything here is real except the model: a real git repository in a temp
// dir, the real `Orchestrator`, real worktrees, real branches, real
// deterministic stage merges, the real epoch-landing merge. The only stand-in
// is the `stub` BACKEND, which is what lets this run with no API key and no
// network.
//
// ⚠ WHAT THIS PROVES, AND WHAT IT DOES NOT.
//
// This is a WIRING test, not a work test — the same honesty
// `.agents/skills/running-dev-mode` already writes down about `--stub`. The
// stub agent sleeps, streams a few fake deltas and drops ONE marker file in its
// worktree. It never reads the prompt, so:
//   - it never writes a producing node's `huu-memory-v1` list, which means every
//     memory fan-out downstream resolves to ZERO tasks and that stage completes
//     empty;
//   - it never produces a diff worth reviewing, so a per-task critic that does
//     run finds nothing and forward-defaults;
//   - a judge (`CheckStep`) emits no parseable verdict, so the forward
//     `default: true` outcome is what fires.
// So: the graph compiles, the waves schedule, the branches merge, the epoch
// lands and the tree comes out clean. Whether the WORK is any good is a
// question no stub can answer, and this file does not pretend otherwise.
//
// WHAT IT DOES PROVE, and it is the thing the whole devgraph format exists for:
// the topology that ran is the one the HUMAN DREW. The planner seams are wired
// to spies that fail the test on the first call, so a session that quietly fell
// back to the LLM planner cannot pass — which is exactly the regression that
// would erase MANIFESTO differential #2 ("nenhum planner LLM decide em runtime
// o que o passo 3 deve fazer") the moment somebody adds a convenience fallback.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selectBackend } from '../../orchestrator/backends/registry.js';
import {
  devGraphFanOutNamespace,
  devGraphRoot,
  runDevMode,
  type DevEvent,
  type DevModeResult,
} from '../dev-mode/dev-driver.js';
import { devSessionPaths } from '../dev-mode/dev-protocol.js';
import type { AppConfig, Pipeline } from '../types.js';
import { findSample } from './graph-samples.js';
import { writeGraph } from './graph-store.js';
import { compileGraphPipeline } from './graph-to-pipeline.js';
import type { DevGraph } from './graph-types.js';

/** Deterministic stamps: `build(now)` is pure given `now`. */
const STAMP = '2026-08-03T00:00:00.000Z';

/**
 * The sample the request named literally — three fronts off one objective, the
 * consolidation joining on a `subset`. Four drawn boxes, four compiled steps,
 * no judge and no fan-out: the cheapest drawing that still exercises a parallel
 * wave AND a relaxed join.
 */
const SESSION_ONE = 'sessao-um';
const GRAPH_ONE = 'tdd-seguranca-performance';

/**
 * A DIFFERENT drawing in the SAME repository — that second session is what
 * proves the namespace. `recon-fanout` is chosen on purpose: it is the sample
 * whose middle node fans out over a list an earlier node writes, so its
 * compiled `filesFrom` carries the session segment that keeps yesterday's list
 * from dispatching today's swarm.
 */
const SESSION_TWO = 'sessao-dois';
const GRAPH_TWO = 'recon-fanout';

const GOAL_ONE = 'auditar o parser e cobrir com testes';
const GOAL_TWO = 'mapear os alvos e gerar testes para eles';

const CONFIG: AppConfig = { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' };

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

function sample(id: string): DevGraph {
  const found = findSample(id);
  if (!found) throw new Error(`no such graph sample: ${id}`);
  return found.build(STAMP);
}

/** One captured session: its result plus everything it emitted. */
interface Captured {
  result: DevModeResult;
  events: DevEvent[];
  /** Planner calls. Any value but zero is the failure this file exists to catch. */
  plannerCalls: { plan: number; knowledge: number };
  /** The `Pipeline` the driver actually handed to the Orchestrator. */
  ran: Pipeline | undefined;
  /** Working tree state the moment the session returned. */
  porcelain: string;
}

let repo: string;
let one: Captured;
let two: Captured;

/**
 * Run ONE real session against the stub backend.
 *
 * `autoScale: false` + a fixed concurrency pins the pool: the AutoScaler reads
 * the machine, and a test whose wave width depends on the CI box's free RAM is
 * a test that measures the box.
 */
async function runSession(opts: { sessionId: string; goal: string; graphId: string }): Promise<Captured> {
  const bundle = selectBackend('stub');
  const events: DevEvent[] = [];
  const plannerCalls = { plan: 0, knowledge: 0 };
  let ran: Pipeline | undefined;

  const result = await runDevMode({
    dev: {
      goal: opts.goal,
      approval: 'autonomous',
      skipKnowledgeBootstrap: true,
      graphId: opts.graphId,
    },
    config: CONFIG,
    cwd: repo,
    sessionId: opts.sessionId,
    // A second session in the same repo must be a NEW session, never a resume
    // of the first — the namespace is the thing under test.
    resume: 'never',
    agentFactory: bundle.agentFactory,
    conflictResolverFactory: bundle.conflictResolverFactory,
    concurrency: 3,
    autoScale: false,
    // THE SPIES. A drawn method means the topology is the human's; any planner
    // call is the regression. They throw as well as count, so a driver that
    // called one would ALSO stop with `planner-failed` and fail the stop-reason
    // assertion — two independent ways for the same bug to be caught.
    planner: async () => {
      plannerCalls.plan++;
      throw new Error('REGRESSION: the LLM planner ran for a session that carries a drawn method');
    },
    knowledgePlanner: async () => {
      plannerCalls.knowledge++;
      throw new Error('REGRESSION: the knowledge planner ran for a session that carries a drawn method');
    },
    onEvent: (event) => {
      events.push(event);
      if (event.type === 'epoch-start') ran = event.pipeline;
    },
  });

  return { result, events, plannerCalls, ran, porcelain: git(['status', '--porcelain'], repo).trim() };
}

beforeAll(async () => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'huu-graph-e2e-')));
  git(['init', '-q', '-b', 'main'], repo);
  writeFileSync(join(repo, 'README.md'), '# projeto de fixture\n');
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'fixture', version: '0.0.0' }, null, 2)}\n`);
  writeFileSync(join(repo, 'src.ts'), 'export const parse = (s: string): string => s.trim();\n');
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', 'init'], repo);

  // The human saves TWO drawings. Nothing loads them behind anyone's back —
  // each session names the one it runs.
  for (const id of [GRAPH_ONE, GRAPH_TWO]) {
    const written = writeGraph(repo, sample(id), STAMP);
    if (!written.ok) throw new Error(`could not save the sample "${id}": ${written.reason}`);
  }

  one = await runSession({ sessionId: SESSION_ONE, goal: GOAL_ONE, graphId: GRAPH_ONE });
  two = await runSession({ sessionId: SESSION_TWO, goal: GOAL_TWO, graphId: GRAPH_TWO });
  // Two full stub sessions: several agents each, every one sleeping seconds by
  // design, plus real worktree/merge git. The ceiling is generous on purpose.
}, 600_000);

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('devgraph end to end (stub backend, real git) — session 1', () => {
  it('stops for a CLEAN reason, with the drawing named in the detail', () => {
    expect(one.result.stoppedBecause).toBe('max-epochs');
    expect(one.result.detail).toContain(GRAPH_ONE);
    expect(one.result.detail).toContain('COMPLETE method');
  });

  it('NEVER called the LLM planner — the topology is the human’s', () => {
    expect(one.plannerCalls).toEqual({ plan: 0, knowledge: 0 });
    // …and no knowledge phase happened either: no gap specs, no digest.
    const paths = devSessionPaths(SESSION_ONE);
    expect(existsSync(join(repo, paths.knowledgeIndex(1)))).toBe(false);
    expect(existsSync(join(repo, paths.gapsDir(1)))).toBe(false);
  });

  it('ran exactly ONE epoch — a drawing is the complete method', () => {
    expect(one.result.epochs).toHaveLength(1);
    expect(one.events.filter((e) => e.type === 'epoch-start')).toHaveLength(1);
  });

  it('landed the epoch on the working branch', () => {
    const epoch = one.result.epochs[0]!;
    expect(epoch.status).toBe('done');
    expect(epoch.landedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(epoch.landingError).toBeUndefined();
    // The landed commit is an ancestor of HEAD — i.e. the work is really here.
    expect(git(['merge-base', '--is-ancestor', epoch.landedCommit!, 'HEAD'], repo)).toBe('');
  });

  it('left the working tree CLEAN', () => {
    expect(one.porcelain).toBe('');
  });

  it('ran the pipeline compileGraphPipeline emits for the same drawing', () => {
    const expected = compileGraphPipeline({
      graph: sample(GRAPH_ONE),
      goal: GOAL_ONE,
      graphRoot: devGraphRoot(SESSION_ONE, 1),
      sessionId: devGraphFanOutNamespace(SESSION_ONE, 1),
    }).pipeline;
    expect(one.ran).toEqual(expected);
  });

  it('ran one step per DRAWN box, in the order the drawing implies', () => {
    expect(one.ran!.steps.map((s) => s.name)).toEqual([
      '1. TDD [tdd]',
      '2. Revisão de segurança [seguranca]',
      '3. Revisão de performance [performance]',
      '4. Consolidar (segue só pela performance) [consolidar]',
    ]);
  });

  it('kept the human’s parallelism: three roots, and a subset join on the tail', () => {
    const byName = new Map(one.ran!.steps.map((s) => [s.name, s]));
    for (const root of ['1. TDD [tdd]', '2. Revisão de segurança [seguranca]', '3. Revisão de performance [performance]']) {
      expect(byName.get(root)!.dependsOn).toEqual([]);
    }
    // Three arrows drawn, one dependency — the sample's whole point.
    expect(byName.get('4. Consolidar (segue só pela performance) [consolidar]')!.dependsOn).toEqual([
      '3. Revisão de performance [performance]',
    ]);
  });

  it('persisted the compiled drawing as a committed, portable artefact', () => {
    const paths = devSessionPaths(SESSION_ONE);
    expect(git(['ls-files'], repo)).toContain(paths.pipeline(1));
    const persisted = JSON.parse(readFileSync(join(repo, paths.pipeline(1)), 'utf8')) as Pipeline;
    expect(persisted).toEqual(one.ran);
  });

  it('announced the drawing on the planned event, for the surfaces to render', () => {
    const planned = one.events.find((e) => e.type === 'planned');
    expect(planned?.type === 'planned' && planned.graph?.id).toBe(GRAPH_ONE);
    expect(planned?.type === 'planned' && planned.graph?.nodeOrder).toEqual([
      'tdd',
      'seguranca',
      'performance',
      'consolidar',
    ]);
    expect(planned?.type === 'planned' && planned.graph?.graphRoot).toBe(devGraphRoot(SESSION_ONE, 1));
  });

  it('really ran agents — the stub markers are in the landed tree', () => {
    // The one thing the stub genuinely does: one marker file per task, in its
    // own worktree, merged by the real stage merge. Their presence here is the
    // proof that worktrees, branches and BOTH merges (stage + landing) ran.
    const tracked = git(['ls-files'], repo).split('\n');
    const markers = tracked.filter((path) => path.startsWith('STUB_'));
    expect(markers.length).toBeGreaterThanOrEqual(4);
  });
});

describe('devgraph end to end (stub backend, real git) — session 2 in the SAME repo', () => {
  it('stops for a CLEAN reason and lands, exactly like the first', () => {
    expect(two.result.stoppedBecause).toBe('max-epochs');
    expect(two.result.epochs).toHaveLength(1);
    expect(two.result.epochs[0]!.landedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(two.porcelain).toBe('');
  });

  it('NEVER called the LLM planner either', () => {
    expect(two.plannerCalls).toEqual({ plan: 0, knowledge: 0 });
  });

  it('ran the OTHER drawing — a different method, not a repeat of the first', () => {
    expect(two.ran!.steps.map((s) => s.name)).toEqual([
      '1. Mapear os alvos [mapear-alvos]',
      '2. Gerar testes (um agente por alvo) [gerar-testes]',
      '3. Consolidar o que o leque produziu [consolidar]',
    ]);
    expect(two.result.epochs[0]!.frontIds).toEqual(['mapear-alvos', 'gerar-testes', 'consolidar']);
  });

  it('kept its blackboard in its OWN session namespace', () => {
    const first = devSessionPaths(SESSION_ONE);
    const second = devSessionPaths(SESSION_TWO);
    expect(devGraphRoot(SESSION_ONE, 1)).not.toBe(devGraphRoot(SESSION_TWO, 1));
    const tracked = git(['ls-files'], repo);
    expect(tracked).toContain(first.pipeline(1));
    expect(tracked).toContain(second.pipeline(1));
  });

  // THE COLLISION THIS NAMESPACE EXISTS TO MAKE IMPOSSIBLE: `resolveMemoryFiles`
  // reads `filesFrom` out of the integration worktree and checks nothing but
  // `existsSync`. Node ids are semantic, so an un-namespaced list is a path two
  // EXECUTIONS of the same drawing would share — and yesterday's 30 targets
  // would dispatch today's swarm.
  //
  // "Execution", not "session", and the distinction is the whole point. Two
  // different sessions is the EASY half (this file's two sessions prove it, and
  // it is the half a `resume: 'never'` test can reach at all). The dangerous
  // half is two EPOCHS of ONE session: a drawing always ends
  // `goalComplete: false`, so every re-run of the same objective is offered a
  // resume, and an accepted resume runs the same drawing again under the same
  // session id. Both halves are covered here; the running proof that a resumed
  // epoch really compiles the second namespace is the two-epoch test in
  // `dev-mode/dev-driver.test.ts`, which drives the whole driver rather than
  // the compiler alone.
  it('namespaces the fan-out list by session AND by epoch, not merely by node', () => {
    const fanOut = two.ran!.steps.find((s) => s.name.includes('[gerar-testes]'))!;
    const filesFrom = (fanOut as { filesFrom?: string }).filesFrom;
    expect(filesFrom).toBe(`.huu/findings/${SESSION_TWO}-e1/mapear-alvos.json`);

    // The same drawing under the first session resolves somewhere else entirely.
    const asSessionOne = compileGraphPipeline({
      graph: sample(GRAPH_TWO),
      goal: GOAL_TWO,
      graphRoot: devGraphRoot(SESSION_ONE, 1),
      sessionId: devGraphFanOutNamespace(SESSION_ONE, 1),
    }).pipeline;
    const other = asSessionOne.steps.find((s) => s.name.includes('[gerar-testes]'))!;
    expect((other as { filesFrom?: string }).filesFrom).toBe(
      `.huu/findings/${SESSION_ONE}-e1/mapear-alvos.json`,
    );

    // …and the same drawing in the SAME session, one epoch later — the case a
    // session namespace alone does nothing about.
    const asEpochTwo = compileGraphPipeline({
      graph: sample(GRAPH_TWO),
      goal: GOAL_TWO,
      graphRoot: devGraphRoot(SESSION_TWO, 2),
      sessionId: devGraphFanOutNamespace(SESSION_TWO, 2),
    }).pipeline;
    const later = asEpochTwo.steps.find((s) => s.name.includes('[gerar-testes]'))!;
    expect((later as { filesFrom?: string }).filesFrom).toBe(
      `.huu/findings/${SESSION_TWO}-e2/mapear-alvos.json`,
    );
    expect((later as { filesFrom?: string }).filesFrom).not.toBe(filesFrom);
  });

  // Stated as an assertion so nobody reads this file as proof of more than it
  // is: the stub writes no `huu-memory-v1` list, so the fan-out resolved ZERO
  // tasks and that stage completed empty. That is the honest outcome, and it is
  // also why this file is a wiring test.
  it('fanned out over ZERO tasks, because the stub wrote no target list', () => {
    expect(
      existsSync(join(repo, '.huu', 'findings', `${SESSION_TWO}-e1`, 'mapear-alvos.json')),
    ).toBe(false);
    const markers = git(['ls-files'], repo)
      .split('\n')
      .filter((path) => path.startsWith('STUB_') && path.includes('Gerar_testes'));
    expect(markers).toEqual([]);
  });

  it('left both sessions’ work in HEAD, with nothing uncommitted anywhere', () => {
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
    for (const epoch of [...one.result.epochs, ...two.result.epochs]) {
      expect(git(['merge-base', '--is-ancestor', epoch.landedCommit!, 'HEAD'], repo)).toBe('');
    }
  });
});
