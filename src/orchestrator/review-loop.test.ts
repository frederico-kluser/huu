import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';
import type { AgentStatus, OrchestratorState, Pipeline, ReviewSpec } from '../lib/types.js';

/**
 * The per-task generator → critic loop, end to end, against a REAL git repo.
 *
 * The one claim every case here defends: a broken, slow, absent or
 * never-satisfied critic can DELAY a merge but can never PREVENT one. Failing
 * the card instead would make `runStageIntegration` exclude the branch and
 * throw away everything the agent did — turning "90% right with one open
 * finding" into "nothing".
 */

const SPEC = `# T-001 — write the thing

## Files this task OWNS
- src/owned.ts — the implementation

## Done when
- it exists
`;

function setupRepo(dir: string): void {
  execSync('git init --initial-branch=main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"', {
    cwd: dir,
    shell: '/bin/bash',
  });
  writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.huu-worktrees/\n', 'utf8');
  writeFileSync(join(dir, 'T-001.md'), SPEC, 'utf8');
  execSync('git add -A && git commit -m init', { cwd: dir, encoding: 'utf8' });
}

function fenced(obj: unknown): string {
  return '```json\n' + JSON.stringify(obj) + '\n```';
}

const APPROVED = fenced({ verdict: 'approved', findings: [] });

function blocking(over: Record<string, unknown> = {}): string {
  return fenced({
    verdict: 'changes-requested',
    findings: [
      {
        id: 'R1',
        severity: 'blocker',
        category: 'correctness',
        file: 'a.txt',
        summary: 'wrong value',
        evidence: 'expected v2',
        fix: 'write v2',
        ...over,
      },
    ],
  });
}

interface Script {
  /** What the WORKER writes on turn N (1 = the initial task, 2+ = fix turns). */
  work?: (cwd: string, turn: number) => void;
  /** The CRITIC's reply for round N. 'throw' and 'hang' exercise the failure paths. */
  critic?: (round: number) => string | 'throw' | 'hang';
}

/**
 * One factory serving BOTH roles: the orchestrator spawns the critic through
 * the same factory with the reserved NEGATIVE agent id, which is exactly how a
 * real backend sees it.
 */
function makeReviewFactory(script: Script): {
  factory: AgentFactory;
  workerTurns: Map<number, number>;
  criticRounds: Map<number, number>;
} {
  const workerTurns = new Map<number, number>();
  const criticRounds = new Map<number, number>();

  const factory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => {
    if (task.agentId < 0) {
      const round = (criticRounds.get(task.agentId) ?? 0) + 1;
      criticRounds.set(task.agentId, round);
      const behavior = script.critic ? script.critic(round) : APPROVED;
      if (behavior === 'throw') throw new Error('critic backend down');
      let release: (() => void) | null = null;
      return {
        agentId: task.agentId,
        task,
        async prompt(): Promise<void> {
          if (behavior === 'hang') {
            await new Promise<void>((r) => (release = r));
            return;
          }
          await new Promise((r) => setTimeout(r, 20));
          onEvent({ type: 'log', message: behavior });
          onEvent({ type: 'done' });
        },
        async abort(): Promise<void> {
          release?.();
        },
        async dispose(): Promise<void> {
          release?.();
        },
      };
    }

    return {
      agentId: task.agentId,
      task,
      async prompt(): Promise<void> {
        const turn = (workerTurns.get(task.agentId) ?? 0) + 1;
        workerTurns.set(task.agentId, turn);
        onEvent({ type: 'state_change', state: 'streaming' });
        await new Promise((r) => setTimeout(r, 10));
        script.work?.(cwd, turn);
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {},
    };
  };

  return { factory, workerTurns, criticRounds };
}

function pipelineWith(review: ReviewSpec): Pipeline {
  return {
    name: 'review-loop',
    steps: [
      {
        type: 'work',
        name: 'implement',
        prompt: 'implement $file',
        files: ['T-001.md'],
        review,
      },
    ],
  };
}

const writeA =
  (content: string) =>
  (cwd: string): void => {
    writeFileSync(join(cwd, 'a.txt'), content, 'utf8');
  };

describe('per-task review loop', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'review-loop-'));
    setupRepo(scratch);
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${scratch}"`, { encoding: 'utf8' });
    } catch {
      /* best effort */
    }
  });

  async function run(
    review: ReviewSpec,
    script: Script,
    hooks?: {
      onState?: (orch: Orchestrator, agents: AgentStatus[], state: OrchestratorState) => void;
      interactiveRetry?: boolean;
    },
  ) {
    const { factory, workerTurns, criticRounds } = makeReviewFactory(script);
    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
      pipelineWith(review),
      scratch,
      factory,
      { initialConcurrency: 1, autoScale: false, interactiveRetry: hooks?.interactiveRetry === true },
    );
    if (hooks?.onState) orch.subscribe((state) => hooks.onState!(orch, state.agents, state));
    const result = await orch.start();
    return { result, workerTurns, criticRounds, agent: result.agents[0]! };
  }

  it(
    'blocker → fix → approve: two rounds, back to the SAME agent, branch merged',
    async () => {
      const { result, workerTurns, criticRounds, agent } = await run(
        { prompt: 'review', maxRounds: 2 },
        {
          work: (cwd, turn) => writeA(turn === 1 ? 'v1' : 'v2')(cwd),
          critic: (round) => (round === 1 ? blocking() : APPROVED),
        },
      );

      expect(agent.reviewRounds).toBe(2);
      expect(agent.reviewWaived).toBeFalsy();
      // The fix went BACK to the same agent as a second turn — not to a new one.
      expect(workerTurns.get(1)).toBe(2);
      expect(criticRounds.get(-1)).toBe(2);
      expect(agent.reviewFindings).toHaveLength(1);
      // And the work merged.
      expect(agent.state).toBe('done');
      expect(agent.commitSha).toBeDefined();
      expect(agent.merged).toBe(true);
      expect(result.integration.branchesMerged).toHaveLength(1);
      expect(result.manifest.status).toBe('done');
    },
    30_000,
  );

  it(
    'a critic that NEVER approves hits the cap, waives, and the work merges anyway',
    async () => {
      const { result, workerTurns, agent } = await run(
        { prompt: 'review', maxRounds: 2 },
        { work: writeA('v1'), critic: () => blocking() },
      );

      expect(agent.reviewRounds).toBe(2);
      expect(agent.reviewWaived).toBe(true);
      expect(workerTurns.get(1)).toBe(2); // exactly one fix turn, then the cap
      // THE POINT: waived findings do not cost the branch.
      expect(agent.state).toBe('done');
      expect(agent.commitSha).toBeDefined();
      expect(result.integration.branchesMerged).toHaveLength(1);
      expect(agent.reviewFindings!.length).toBeGreaterThanOrEqual(2);
    },
    30_000,
  );

  it(
    "onBlocked:'hold' without an interactive channel falls back to the waive path EXACTLY",
    async () => {
      // Same shape as the never-approves test above: no interactiveRetry means
      // headless, and a headless run must never park waiting for a human.
      const { result, workerTurns, agent } = await run(
        { prompt: 'review', maxRounds: 2, onBlocked: 'hold' },
        { work: writeA('v1'), critic: () => blocking() },
      );

      expect(agent.reviewRounds).toBe(2);
      expect(agent.reviewWaived).toBe(true);
      expect(agent.reviewHeld).toBeFalsy();
      expect(workerTurns.get(1)).toBe(2); // exactly one fix turn, then the cap
      expect(agent.state).toBe('done');
      expect(agent.commitSha).toBeDefined();
      expect(result.integration.branchesMerged).toHaveLength(1);
      expect(result.manifest.status).toBe('done');
    },
    30_000,
  );

  it(
    "onBlocked:'hold' parks the card in awaiting_retry carrying the findings; a retry resumes and merges",
    async () => {
      let sawHold = false;
      let heldCard: AgentStatus | undefined;
      let retried = false;
      let finished = false;
      const { result, workerTurns, criticRounds, agent } = await run(
        { prompt: 'review', maxRounds: 1, onBlocked: 'hold' },
        {
          work: (cwd, turn) => writeA(turn === 1 ? 'v1' : 'v2')(cwd),
          // Round 1 (the held run) blocks; round 2 (the retry's review) approves.
          critic: (round) => (round === 1 ? blocking() : APPROVED),
        },
        {
          interactiveRetry: true,
          onState: (orch, agents, state) => {
            if (state.status !== 'awaiting_retry') return;
            sawHold = true;
            const failed = agents.find((a) => a.state === 'error');
            if (failed && !retried) {
              heldCard = { ...failed };
              retried = true;
              void orch.retryTask(failed.agentId);
              return;
            }
            if (!failed && !finished) {
              finished = true;
              orch.finish();
            }
          },
        },
      );

      // The run parked instead of waiving; the card carried the open findings.
      expect(sawHold).toBe(true);
      expect(heldCard?.reviewHeld).toBe(true);
      expect(heldCard?.reviewFindings).toHaveLength(1);
      expect(heldCard?.reviewFindings?.[0]?.severity).toBe('blocker');
      expect(heldCard?.error).toContain('onBlocked');
      // The human retried: the TASK re-ran from scratch and was reviewed again.
      expect(workerTurns.get(1)).toBe(2);
      expect(criticRounds.get(-1)).toBe(2);
      expect(agent.state).toBe('done');
      expect(agent.manualRetries).toBe(1);
      expect(agent.reviewWaived).toBeFalsy();
      expect(agent.reviewHeld).toBeFalsy(); // cleared by the retry reset
      expect(agent.merged).toBe(true);
      expect(result.integration.branchesMerged).toHaveLength(1);
      expect(result.manifest.status).toBe('done');
      expect(result.manifest.agentEntries.filter((e) => e.agentId === 1)).toHaveLength(1);
    },
    30_000,
  );

  it(
    'abandoning the hold applies the waive semantics: findings recorded, preserved branch merges',
    async () => {
      let sawHold = false;
      let finished = false;
      const { result, agent } = await run(
        { prompt: 'review', maxRounds: 1, onBlocked: 'hold' },
        { work: writeA('v1'), critic: () => blocking() },
        {
          interactiveRetry: true,
          onState: (orch, _agents, state) => {
            if (state.status !== 'awaiting_retry') return;
            sawHold = true;
            if (!finished) {
              finished = true;
              // Defer past the park: start() emits 'awaiting_retry' BEFORE
              // assigning finishResolve, so a finish() fired synchronously
              // inside this first emit would be lost (a human click always
              // lands after the park — this mirrors that).
              setTimeout(() => orch.finish(), 0);
            }
          },
        },
      );

      expect(sawHold).toBe(true);
      // Abandon == the cap-time waive: the card ends done, the findings are
      // recorded as waived, and the preserved (-held) branch still lands.
      expect(agent.state).toBe('done');
      expect(agent.reviewWaived).toBe(true);
      expect(agent.reviewHeld).toBeFalsy(); // resolved, no longer parked
      expect(agent.error).toBeUndefined();
      expect(agent.reviewFindings).toHaveLength(1);
      expect(agent.merged).toBe(true);
      expect(result.integration.branchesMerged).toHaveLength(1);
      expect(result.manifest.status).toBe('done');
    },
    30_000,
  );

  it(
    'a critic that THROWS never blocks the merge',
    async () => {
      const { result, agent } = await run(
        { prompt: 'review', maxRounds: 2 },
        { work: writeA('v1'), critic: () => 'throw' },
      );
      expect(agent.reviewRounds).toBe(1);
      expect(agent.reviewWaived).toBeFalsy();
      expect(agent.state).toBe('done');
      expect(result.integration.branchesMerged).toHaveLength(1);
    },
    30_000,
  );

  it(
    'a critic that TIMES OUT never blocks the merge',
    async () => {
      const { result, agent } = await run(
        { prompt: 'review', maxRounds: 2, timeoutMs: 60 },
        { work: writeA('v1'), critic: () => 'hang' },
      );
      expect(agent.reviewRounds).toBe(1);
      expect(agent.state).toBe('done');
      expect(result.integration.branchesMerged).toHaveLength(1);
    },
    30_000,
  );

  it(
    'skips the review entirely when the agent wrote nothing — no critic is spawned',
    async () => {
      const { criticRounds, agent } = await run({ prompt: 'review', maxRounds: 2 }, { work: () => {} });
      expect(criticRounds.size).toBe(0);
      expect(agent.reviewRounds).toBeUndefined();
      expect(agent.phase).toBe('no_changes');
    },
    30_000,
  );

  it(
    'destroyAgent on a review-locked agent is a NO-OP — the critic keeps its worktree',
    async () => {
      let attempted = false;
      const { result, agent } = await run(
        { prompt: 'review', maxRounds: 1 },
        { work: writeA('v1') },
        {
          onState: (orch, agents) => {
            const reviewing = agents.find((a) => a.phase === 'reviewing');
            if (reviewing && !attempted) {
              attempted = true;
              void orch.destroyAgent(reviewing.agentId, 'test');
            }
          },
        },
      );
      expect(attempted).toBe(true);
      // Not killed: no requeue, the work survived, the branch merged.
      expect(agent.requeues).toBeUndefined();
      expect(agent.state).toBe('done');
      expect(agent.commitSha).toBeDefined();
      expect(result.integration.branchesMerged).toHaveLength(1);
    },
    30_000,
  );

  it(
    'reviewStats counts blocking findings that triggered a fix, split proved vs unproved',
    async () => {
      const twoBlockers = fenced({
        verdict: 'changes-requested',
        findings: [
          {
            id: 'P1',
            severity: 'blocker',
            category: 'correctness',
            file: 'a.txt',
            summary: 'test fails',
            evidence: 'see below',
            fix: 'fix it',
            proof: { command: 'npm test', exitCode: 1, excerpt: '1 failing' },
          },
          {
            id: 'U1',
            severity: 'major',
            category: 'pattern',
            file: 'a.txt',
            summary: 'not how we do it here',
            evidence: 'convention',
            fix: 'restructure',
          },
        ],
      });
      const { agent } = await run(
        { prompt: 'review', maxRounds: 2 },
        {
          work: (cwd, turn) => writeA(turn === 1 ? 'v1' : 'v2')(cwd),
          critic: (round) => (round === 1 ? twoBlockers : APPROVED),
        },
      );
      expect(agent.reviewStats).toEqual({ provedBlocking: 1, unprovedBlocking: 1 });
    },
    30_000,
  );

  it(
    'records a committed file the task spec did not claim (write-set instrumentation)',
    async () => {
      const { agent } = await run(
        { prompt: 'review', maxRounds: 1 },
        {
          work: (cwd) => {
            mkdirSync(join(cwd, 'src'), { recursive: true });
            writeFileSync(join(cwd, 'src', 'owned.ts'), 'export const a = 1;\n', 'utf8');
            writeFileSync(join(cwd, 'rogue.ts'), 'export const b = 2;\n', 'utf8');
          },
        },
      );
      expect(agent.writeSetViolations).toEqual(['rogue.ts']);
    },
    30_000,
  );

  it(
    'writes a per-task findings shard when findingsDir is declared',
    async () => {
      const { agent } = await run(
        { prompt: 'review', maxRounds: 2, findingsDir: '.huu/review' },
        {
          work: (cwd, turn) => writeA(turn === 1 ? 'v1' : 'v2')(cwd),
          critic: (round) => (round === 1 ? blocking() : APPROVED),
        },
      );
      // The shard lands inside the agent's own worktree, so the next round's
      // commit carries it onto the branch — one file per task, never shared.
      expect(agent.filesModified).toEqual(
        expect.arrayContaining(['.huu/review/agent-1.json']),
      );
      expect(agent.reviewFindings).toHaveLength(1);
    },
    30_000,
  );

  it(
    'a step WITHOUT review runs exactly as before — no critic, no review fields',
    async () => {
      const { factory, criticRounds } = makeReviewFactory({ work: writeA('v1') });
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        {
          name: 'no-review',
          steps: [{ type: 'work', name: 'implement', prompt: 'p $file', files: ['T-001.md'] }],
        },
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false },
      );
      const result = await orch.start();
      const agent = result.agents[0]!;
      expect(criticRounds.size).toBe(0);
      expect(agent.reviewRounds).toBeUndefined();
      expect(agent.reviewFindings).toBeUndefined();
      expect(agent.reviewStats).toBeUndefined();
      expect(agent.state).toBe('done');
      expect(result.integration.branchesMerged).toHaveLength(1);
    },
    30_000,
  );
});
