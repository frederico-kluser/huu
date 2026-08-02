import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitClient } from '../../git/git-client.js';
import type {
  AgentStatus,
  CheckRun,
  OrchestratorState,
  ReviewFinding,
  StageIntegration,
} from '../types.js';
import {
  MAX_EVIDENCE_FILES,
  MAX_INSTRUMENTED_STAGES,
  MAX_REPORT_EXCERPT_CHARS,
  MAX_REVIEW_ROUND_SAMPLES,
  MAX_VIOLATION_PATHS,
  MAX_VIOLATION_TASKS,
  collectEpochEvidence,
  formatInstrumentationLine,
  readLandedDiffStat,
} from './epoch-evidence.js';

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
let client: GitClient;
let base: string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'huu-epoch-evidence-')));
  git(['init', '-q', '-b', 'main'], repo);
  writeFileSync(join(repo, 'README.md'), '# project\n');
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
  base = git(['rev-parse', 'HEAD'], repo).trim();
  client = new GitClient(repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** `n` distinct lines, so churn per file is exactly `n`. */
function lines(n: number): string {
  return `${Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')}\n`;
}

describe('readLandedDiffStat', () => {
  it('is empty when nothing changed between the two refs', async () => {
    expect(await readLandedDiffStat(client, base, 'HEAD')).toBe('');
  });

  it('summarizes a small range with real counts', async () => {
    writeFileSync(join(repo, 'a.txt'), lines(3));
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'add a'], repo);
    writeFileSync(join(repo, 'README.md'), '# project\nedited\n');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'edit readme'], repo);

    const stat = await readLandedDiffStat(client, base, 'HEAD');

    expect(stat).toContain('2 file(s) changed, +4/-0');
    expect(stat).toContain('+3 -0  a.txt');
    expect(stat).toContain('+1 -0  README.md');
  });

  // The blind orchestrator never receives a file — only a table, and only a
  // BOUNDED one. Ordering by churn rather than by path means the rows that
  // survive truncation are the ones carrying the epoch's substance.
  it('keeps the 40 highest-churn files and collapses the rest', async () => {
    for (let i = 1; i <= 45; i += 1) {
      const name = `f${String(i).padStart(2, '0')}.txt`;
      writeFileSync(join(repo, name), lines(i));
    }
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'bulk'], repo);

    const stat = await readLandedDiffStat(client, base, 'HEAD');
    const rows = stat.split('\n');

    // Header counts EVERY file; only the listing is truncated.
    expect(rows[0]).toBe('45 file(s) changed, +1035/-0');
    expect(rows[1]).toBe('  +45 -0  f45.txt');
    expect(rows[40]).toBe('  +6 -0  f06.txt');
    expect(stat).toContain('…and 5 more file(s), +15/-0');
    expect(stat).not.toContain('f05.txt');
    expect(stat).not.toContain('f01.txt');
    // 1 header + 40 rows + 1 collapse line.
    expect(rows).toHaveLength(42);
  });

  it('honors an explicit file cap', async () => {
    for (let i = 1; i <= 5; i += 1) {
      writeFileSync(join(repo, `g${i}.txt`), lines(i));
    }
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'bulk'], repo);

    const stat = await readLandedDiffStat(client, base, 'HEAD', 2);

    expect(stat.split('\n')).toHaveLength(4);
    expect(stat).toContain('  +5 -0  g5.txt');
    expect(stat).toContain('  +4 -0  g4.txt');
    expect(stat).toContain('…and 3 more file(s), +6/-0');
  });

  it('marks binary files instead of inventing line counts', async () => {
    writeFileSync(join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'binary'], repo);

    const stat = await readLandedDiffStat(client, base, 'HEAD');

    expect(stat).toContain('bin       blob.bin');
    expect(stat).toContain('1 file(s) changed, +0/-0');
  });

  it('counts deletions', async () => {
    writeFileSync(join(repo, 'README.md'), '');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'empty readme'], repo);

    expect(await readLandedDiffStat(client, base, 'HEAD')).toContain('+0 -1  README.md');
  });

  // Evidence collection runs after the epoch is already over: it must never be
  // the thing that takes the session down.
  it('returns empty rather than throwing on unusable refs', async () => {
    expect(await readLandedDiffStat(client, base, 'no-such-ref')).toBe('');
    expect(await readLandedDiffStat(client, undefined, 'HEAD')).toBe('');
    expect(await readLandedDiffStat(client, base, '')).toBe('');
    expect(await readLandedDiffStat(client, base, base)).toBe('');
    // A ref with whitespace would silently split into two argv tokens.
    expect(await readLandedDiffStat(client, base, 'HEAD --all')).toBe('');
  });
});

// --- collectEpochEvidence ------------------------------------------------

function agent(over: Partial<AgentStatus> & { agentId: number }): AgentStatus {
  return {
    state: 'done',
    phase: 'done',
    currentFile: null,
    logs: [],
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    filesModified: [],
    pushStatus: 'skipped',
    stageIndex: 1,
    stageName: 'implementar',
    ...over,
  };
}

function check(over: Partial<CheckRun> & { stepName: string }): CheckRun {
  return {
    visitIndex: 0,
    stepIndex: 0,
    runs: 1,
    phase: 'done',
    modelId: 'stub',
    condition: 'is it good?',
    startedAt: 0,
    ...over,
  };
}

function stage(over: Partial<StageIntegration> & { stageName: string }): StageIntegration {
  return {
    visitIndex: 1,
    stepIndex: 0,
    runs: 1,
    phase: 'done',
    modelId: 'stub',
    resolverUsed: false,
    branchesMerged: [],
    branchesPending: [],
    conflicts: [],
    ...over,
  };
}

function state(over: Partial<OrchestratorState> = {}): OrchestratorState {
  return {
    status: 'done',
    runId: 'run-1',
    agents: [],
    logs: [],
    totalCost: 0,
    completedTasks: 0,
    totalTasks: 0,
    integrationStatus: {
      phase: 'done',
      branchesMerged: [],
      branchesPending: [],
      conflicts: [],
    },
    stageIntegrations: [],
    checkRuns: [],
    startedAt: 0,
    elapsedMs: 0,
    concurrency: 1,
    currentStage: 1,
    totalStages: 1,
    pendingTaskCount: 0,
    activeAgentCount: 0,
    ...over,
  };
}

const FINDING: ReviewFinding = {
  id: 'F-1',
  severity: 'major',
  category: 'correctness',
  file: 'src/lib/parser.ts',
  summary: 'o caminho de erro engole a exceção',
  evidence: 'catch {}',
  fix: 'propagar o erro',
};

describe('collectEpochEvidence', () => {
  it('carries every check verdict and says which came from a judge', () => {
    const evidence = collectEpochEvidence({
      epoch: 2,
      diffStat: 'stat',
      landing: { landed: true, commit: 'abc' },
      state: state({
        checkRuns: [
          check({ stepName: 'verificar api', outcomeLabel: 'approved', fromJudge: true, reason: 'ok' }),
          check({ stepName: 'portão', outcomeLabel: 'rework', fromJudge: false }),
          // A check that died before routing has no label at all.
          check({ stepName: 'selar', phase: 'error', error: 'boom' }),
        ],
      }),
    });

    expect(evidence.verdicts).toEqual([
      { stepName: 'verificar api', label: 'approved', fromJudge: true, reason: 'ok' },
      { stepName: 'portão', label: 'rework', fromJudge: false },
      { stepName: 'selar', label: '(none)', fromJudge: false },
    ]);
  });

  // The single most important row: work that merged while a critic was still
  // objecting. Nothing else in the run says so.
  it('lists the tasks whose blocking findings were waived at the cap', () => {
    const evidence = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      state: state({
        agents: [
          agent({ agentId: 1, reviewWaived: true, reviewFindings: [FINDING], stageName: 'api' }),
          agent({ agentId: 2, reviewFindings: [FINDING] }),
          agent({ agentId: 3, reviewWaived: false }),
        ],
      }),
    });

    expect(evidence.waived).toEqual([
      { agentId: 1, stageName: 'api', findings: [FINDING] },
    ]);
  });

  // The four buckets must SUM to the card count — an unmerged card also reads
  // `state: 'done'`, and a failed one can carry `mergeFailed` too.
  it('counts task outcomes into mutually exclusive buckets', () => {
    const agents = [
      agent({ agentId: 1 }),
      agent({ agentId: 2, merged: true }),
      agent({ agentId: 3, phase: 'no_changes' }),
      agent({ agentId: 4, state: 'error', phase: 'error' }),
      agent({ agentId: 5, state: 'error', phase: 'error', mergeFailed: true }),
      agent({ agentId: 6, mergeFailed: true }),
    ];

    const evidence = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      state: state({ agents }),
    });

    expect(evidence.taskOutcomes).toEqual({ done: 2, noChanges: 1, failed: 2, unmerged: 1 });
    const total = Object.values(evidence.taskOutcomes).reduce((a, b) => a + b, 0);
    expect(total).toBe(agents.length);
  });

  it('dedupes, sorts and caps the changed files', () => {
    const many = Array.from({ length: MAX_EVIDENCE_FILES + 20 }, (_, i) => `src/f${i}.ts`);
    const evidence = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      state: state({
        agents: [
          agent({ agentId: 1, filesModified: ['src/b.ts', 'src/a.ts', '  '] }),
          agent({ agentId: 2, filesModified: ['src/a.ts'] }),
        ],
      }),
    });
    expect(evidence.filesChanged).toEqual(['src/a.ts', 'src/b.ts']);

    const capped = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      state: state({ agents: [agent({ agentId: 1, filesModified: many })] }),
    });
    expect(capped.filesChanged).toHaveLength(MAX_EVIDENCE_FILES);
  });

  it('passes the landing result through, failure included', () => {
    const ok = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true, commit: 'deadbeef' },
      state: null,
    });
    expect(ok.landing).toEqual({ landed: true, commit: 'deadbeef' });

    const bad = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: false, error: 'conflitou em src/a.ts', conflicts: ['src/a.ts'] },
      state: null,
    });
    expect(bad.landing).toEqual({ landed: false, error: 'conflitou em src/a.ts' });
  });

  it('bounds the report excerpt', () => {
    const report = `${'x'.repeat(MAX_REPORT_EXCERPT_CHARS * 2)}\n`;
    const evidence = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      state: null,
      report,
    });

    expect(evidence.reportExcerpt!.length).toBeLessThanOrEqual(MAX_REPORT_EXCERPT_CHARS + 20);
    expect(evidence.reportExcerpt).toContain('(truncated)');
  });

  it('omits the excerpt when there is no report', () => {
    const evidence = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      state: null,
      report: '   ',
    });
    expect(evidence.reportExcerpt).toBeUndefined();
  });

  // "We ran and learned nothing" is itself something the next planner needs.
  it('records an empty epoch rather than nothing when there is no run state', () => {
    const evidence = collectEpochEvidence({
      epoch: 4,
      diffStat: 'stat',
      landing: { landed: false, error: 'o planner falhou' },
      state: null,
    });

    expect(evidence).toEqual({
      epoch: 4,
      diffStat: 'stat',
      filesChanged: [],
      verdicts: [],
      waived: [],
      taskOutcomes: { done: 0, noChanges: 0, failed: 0, unmerged: 0 },
      landing: { landed: false, error: 'o planner falhou' },
      instrumentation: {
        writeSetViolations: [],
        review: { proved: 0, unproved: 0, rounds: [], waivedCount: 0 },
        mergeConflicts: [],
      },
    });
  });
});

// --- instrumentation ------------------------------------------------------
//
// The two numbers the deep research came back EMPTY on — write-set compliance
// under a prompt-declared scope, and the conflict rate of N parallel agents in
// one repo — plus the proved-vs-unproved split that lets the severity-blocking
// choice be revisited with this project's own data.

const PROVED: ReviewFinding = {
  ...FINDING,
  id: 'F-2',
  severity: 'blocker',
  proof: { command: 'npm test', exitCode: 1, excerpt: '1 failing' },
};

describe('collectEpochEvidence — instrumentation', () => {
  it('collects violations, the proved/unproved split and the round distribution', () => {
    const evidence = collectEpochEvidence({
      epoch: 3,
      diffStat: '',
      landing: { landed: true },
      state: state({
        agents: [
          agent({
            agentId: 1,
            stageName: '1b. api — implementar',
            writeSetViolations: ['src/rogue.ts', 'package.json'],
            reviewRounds: 2,
            reviewFindings: [PROVED],
            reviewStats: { provedBlocking: 1, unprovedBlocking: 0 },
          }),
          agent({
            agentId: 2,
            stageName: '2b. cli — implementar',
            reviewRounds: 3,
            reviewWaived: true,
            reviewFindings: [FINDING],
            reviewStats: { provedBlocking: 0, unprovedBlocking: 2 },
          }),
          // The critic never ran here: no violation, no stats, no round.
          agent({ agentId: 3 }),
        ],
        stageIntegrations: [
          stage({
            stageName: '1b. api — implementar',
            branchesMerged: ['huu/r/agent-1', 'huu/r/agent-2'],
            // Two conflict entries, ONE branch — the entries are per file.
            conflicts: [
              { file: 'src/a.ts', branches: ['huu/r/agent-2'], resolved: true },
              { file: 'src/b.ts', branches: ['huu/r/agent-2'], resolved: true },
            ],
            resolverUsed: true,
          }),
          stage({
            stageName: '2b. cli — implementar',
            visitIndex: 2,
            branchesMerged: ['huu/r/agent-3'],
          }),
        ],
      }),
    });

    expect(evidence.instrumentation).toEqual({
      writeSetViolations: [
        {
          agentId: 1,
          stageName: '1b. api — implementar',
          paths: ['src/rogue.ts', 'package.json'],
        },
      ],
      // Raw distribution, not a mean — descending so truncation keeps the tail.
      review: { proved: 1, unproved: 2, rounds: [3, 2], waivedCount: 1 },
      mergeConflicts: [
        { stageName: '1b. api — implementar', eligible: 2, conflicted: 1 },
        { stageName: '2b. cli — implementar', eligible: 1, conflicted: 0 },
      ],
    });
  });

  // The resolver moves a branch from pending to merged as it fixes it, so
  // neither list alone is the denominator.
  it('counts eligible branches across both sides of the merge, and skips empty stages', () => {
    const evidence = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      state: state({
        stageIntegrations: [
          stage({
            stageName: 'implementar',
            branchesMerged: ['b1'],
            branchesPending: ['b2'],
            conflicts: [{ file: 'src/a.ts', branches: ['b2'], resolved: false }],
          }),
          // Nothing was eligible — never a merge, so never a 0/0 row diluting
          // the rate.
          stage({ stageName: 'nada para mergear', phase: 'skipped' }),
        ],
      }),
    });

    expect(evidence.instrumentation.mergeConflicts).toEqual([
      { stageName: 'implementar', eligible: 2, conflicted: 1 },
    ]);
  });

  // Same discipline as `diffStat`: the blind orchestrator never receives an
  // unbounded list, however pathological the run was.
  it('caps every list', () => {
    const agents = Array.from({ length: MAX_VIOLATION_TASKS + 10 }, (_, i) =>
      agent({
        agentId: i + 1,
        writeSetViolations: Array.from({ length: MAX_VIOLATION_PATHS + 5 }, (_, j) => `src/f${j}.ts`),
        reviewRounds: (i % 4) + 1,
      }),
    );
    const stages = Array.from({ length: MAX_INSTRUMENTED_STAGES + 5 }, (_, i) =>
      stage({ stageName: `s${i}`, visitIndex: i, branchesMerged: [`b${i}`] }),
    );

    const i = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      state: state({ agents, stageIntegrations: stages }),
    }).instrumentation;

    expect(i.writeSetViolations).toHaveLength(MAX_VIOLATION_TASKS);
    expect(i.writeSetViolations[0]!.paths).toHaveLength(MAX_VIOLATION_PATHS);
    expect(i.mergeConflicts).toHaveLength(MAX_INSTRUMENTED_STAGES);
    expect(i.review.rounds.length).toBeLessThanOrEqual(MAX_REVIEW_ROUND_SAMPLES);
    // Descending, so what survives truncation is the heaviest-reviewed tail.
    expect(i.review.rounds[0]).toBe(4);
  });

  it('reports zeros — a measured zero, not undefined — when nothing was instrumented', () => {
    const measured = collectEpochEvidence({
      epoch: 1,
      diffStat: '',
      landing: { landed: true },
      // Cards from a step with no `review` and no spec-declared write set:
      // every instrumentation field is absent on the status objects.
      state: state({ agents: [agent({ agentId: 1 }), agent({ agentId: 2, state: 'error', phase: 'error' })] }),
    }).instrumentation;

    expect(measured).toEqual({
      writeSetViolations: [],
      review: { proved: 0, unproved: 0, rounds: [], waivedCount: 0 },
      mergeConflicts: [],
    });
  });
});

describe('formatInstrumentationLine', () => {
  it('summarizes the epoch in one operator line', () => {
    const line = formatInstrumentationLine(2, {
      writeSetViolations: [
        { agentId: 1, stageName: 'api', paths: ['a.ts', 'b.ts'] },
        { agentId: 4, stageName: 'cli', paths: ['c.ts'] },
      ],
      review: { proved: 1, unproved: 3, rounds: [4, 2, 2, 1], waivedCount: 1 },
      mergeConflicts: [
        { stageName: 'api', eligible: 4, conflicted: 1 },
        { stageName: 'cli', eligible: 3, conflicted: 0 },
      ],
    });

    expect(line).toContain('epoch 2 instrumentation:');
    expect(line).toContain('write-set 3 file(s) across 2 task(s)');
    expect(line).toContain('blocking 1 proved / 3 unproved');
    // Median of [1,2,2,4] is 2 — the distribution, not the mean (2.25).
    expect(line).toContain('review rounds median 2 across 4 card(s)');
    expect(line).toContain('1 waived at the cap');
    expect(line).toContain('merge conflicts 1/7 branch(es) across 2 stage merge(s)');
  });

  it('says so when no card was reviewed instead of printing a median of nothing', () => {
    const line = formatInstrumentationLine(1, {
      writeSetViolations: [],
      review: { proved: 0, unproved: 0, rounds: [], waivedCount: 0 },
      mergeConflicts: [],
    });

    expect(line).toBe(
      'epoch 1 instrumentation: write-set 0 file(s) across 0 task(s) · blocking 0 proved / 0 unproved · ' +
        'review rounds none (no card was reviewed) · 0 waived at the cap · ' +
        'merge conflicts 0/0 branch(es) across 0 stage merge(s)',
    );
  });

  it('keeps the median of an even distribution readable', () => {
    const line = formatInstrumentationLine(1, {
      writeSetViolations: [],
      review: { proved: 0, unproved: 0, rounds: [3, 2], waivedCount: 0 },
      mergeConflicts: [],
    });
    expect(line).toContain('review rounds median 2.5 across 2 card(s)');
  });
});
