// The compiled `Pipeline.mergeGate` is a SHELL STRING. No type checks it, no
// schema validates it, and the orchestrator runs it with `sh -c` in the
// integration worktree after every agent-branch merge — where a non-zero exit
// rewinds that merge commit. A quoting slip there does not fail loudly: it
// fails EVERY merge, or none of them.
//
// So these tests run the real command, in a real git repository, against the
// real merge shape (`git merge --no-ff`) the orchestrator produces. That is
// the only place the `HEAD^..HEAD` range and the grep escaping are actually
// proven.

import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileEpochPipeline } from './plan-to-pipeline.js';
import type { DevFront, DevMethodology, DevPlan } from '../types.js';

const repos: string[] = [];

afterEach(() => {
  while (repos.length > 0) rmSync(repos.pop()!, { recursive: true, force: true });
});

function sh(cmd: string, cwd: string): string {
  return execFileSync('sh', ['-c', cmd], { cwd, encoding: 'utf8' });
}

/** A repo whose HEAD is a --no-ff merge of a branch carrying `subjects`. */
function repoWithMergedCommits(subjects: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'huu-mergegate-'));
  repos.push(dir);
  sh('git init --initial-branch=main -q', dir);
  sh('git config user.email t@t.com && git config user.name t', dir);
  writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
  sh('git add -A && git commit -qm "chore: init"', dir);
  sh('git checkout -qb work', dir);
  subjects.forEach((subject, i) => {
    writeFileSync(join(dir, `f${i}.txt`), `${i}\n`, 'utf8');
    // -F - keeps the subject verbatim: some of these contain characters a
    // shell-quoted -m would mangle, and mangling them would test the wrong thing.
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-F', '-'], { cwd: dir, input: subject });
  });
  sh('git checkout -q main', dir);
  sh('git merge --no-ff -q -m "merge work" work', dir);
  return dir;
}

/** The compiled gate for a methodology, or `undefined` when it emits none. */
function gateFor(methodology: DevMethodology, over: Record<string, unknown> = {}): string | undefined {
  const front: DevFront = {
    id: 'a',
    title: 'Front a',
    rationale: 'porque a',
    dependsOnFronts: [],
    reconPrompt: 'mapeie a',
    workPrompt: 'implemente a',
    verifyCondition: 'a está pronto',
    maxTasks: 2,
  };
  const plan: DevPlan = {
    epochGoal: 'entregar',
    doneWhen: 'pronto',
    goalComplete: false,
    fronts: [front],
  };
  return compileEpochPipeline({ plan, epoch: 1, goal: 'construir', methodology, ...over }).pipeline
    .mergeGate;
}

/** Runs the gate the way the orchestrator does. */
function runGate(gate: string, cwd: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: execFileSync('sh', ['-c', gate], { cwd, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    return { ok: false, output: String(e.stderr ?? '') + String(e.stdout ?? '') };
  }
}

describe('changelogGate — the Conventional Commits merge gate, executed for real', () => {
  const gate = () => gateFor({ changelogGate: true })!;

  it('passes when every merged subject is a Conventional Commit', () => {
    const repo = repoWithMergedCommits([
      'feat: add the thing',
      'fix(parser): stop dropping the last token',
      'refactor!: rename the exported symbol',
      'docs(readme): note the new flag',
    ]);
    expect(runGate(gate(), repo).ok).toBe(true);
  });

  it('fails and NAMES the offending subject', () => {
    const repo = repoWithMergedCommits(['feat: fine', 'wip stuff', 'fix: also fine']);
    const { ok, output } = runGate(gate(), repo);
    expect(ok).toBe(false);
    expect(output).toContain('wip stuff');
    expect(output).toContain('not a Conventional Commit');
    // The compliant subjects are NOT reported — only the offender.
    expect(output).not.toContain('feat: fine');
  });

  it('rejects a type that is not in the vocabulary, and a missing description', () => {
    for (const bad of ['feet: typo in the type', 'feat:', 'feat add the thing']) {
      const { ok } = runGate(gate(), repoWithMergedCommits([bad]));
      expect(ok, bad).toBe(false);
    }
  });

  // The merge commit is huu's, not the agent's — holding an agent to a subject
  // it never wrote would fail every single merge.
  it('ignores the merge commit huu itself authored', () => {
    const repo = repoWithMergedCommits(['feat: fine']);
    expect(sh('git log -1 --format=%s', repo).trim()).toBe('merge work');
    expect(runGate(gate(), repo).ok).toBe(true);
  });

  // A gate must never fail for LACK of input — that turns an empty branch into
  // a rewound merge for no stated reason.
  it('passes on a repository with a single root commit and no HEAD^', () => {
    const dir = mkdtempSync(join(tmpdir(), 'huu-mergegate-root-'));
    repos.push(dir);
    sh('git init --initial-branch=main -q', dir);
    sh('git config user.email t@t.com && git config user.name t', dir);
    writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
    sh('git add -A && git commit -qm "not conventional at all"', dir);
    expect(runGate(gate(), dir).ok).toBe(true);
  });

  // THE regression this exclusion exists for. When an agent leaves changes
  // uncommitted, huu commits them itself as `[<pipeline>] <step> (agent N)`.
  // Judging that subject holds the agent to huu's own formatting, and since
  // that path is common it rejected essentially every branch — an end-to-end
  // stub run failed exactly this way.
  it('skips the commit huu writes for an agent that left work uncommitted', () => {
    const repo = repoWithMergedCommits([
      '[huu Dev — época 1] 1c. Stub front — implementar (agent 1)',
      'feat: the agent\'s own commit',
    ]);
    expect(runGate(gate(), repo).ok).toBe(true);
  });

  it('still judges the agent\'s own subjects alongside huu\'s', () => {
    const repo = repoWithMergedCommits(['[huu Dev — época 1] 0. Recon (agent 1)', 'wip']);
    const { ok, output } = runGate(gate(), repo);
    expect(ok).toBe(false);
    expect(output).toContain('wip');
    expect(output).not.toContain('huu Dev');
  });

  it('survives a subject carrying shell metacharacters', () => {
    const repo = repoWithMergedCommits(['feat: handle $(rm -rf /) and `backticks` and \'quotes\'']);
    expect(runGate(gate(), repo).ok).toBe(true);
  });
});

describe('diffBudget — the size gate, executed for real', () => {
  const gate = () => gateFor({ diffBudget: true })!;

  /** A repo whose merged branch adds `files`, each with `lines` lines. */
  function repoWithDiff(files: Record<string, number>): string {
    const dir = mkdtempSync(join(tmpdir(), 'huu-diffbudget-'));
    repos.push(dir);
    sh('git init --initial-branch=main -q', dir);
    sh('git config user.email t@t.com && git config user.name t', dir);
    writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
    sh('git add -A && git commit -qm "chore: init"', dir);
    sh('git checkout -qb work', dir);
    for (const [name, lines] of Object.entries(files)) {
      const full = join(dir, name);
      execFileSync('mkdir', ['-p', join(full, '..')]);
      writeFileSync(full, `${'x\n'.repeat(lines)}`, 'utf8');
    }
    sh('git add -A && git commit -qm "feat: work"', dir);
    sh('git checkout -q main', dir);
    sh('git merge --no-ff -q -m "merge work" work', dir);
    return dir;
  }

  it('passes a small diff', () => {
    expect(runGate(gate(), repoWithDiff({ 'a.ts': 10, 'b.ts': 20 })).ok).toBe(true);
  });

  it('fails past the line budget and reports both counts', () => {
    const { ok, output } = runGate(gate(), repoWithDiff({ 'big.ts': 401 }));
    expect(ok).toBe(false);
    expect(output).toContain('401 changed line(s) across 1 file(s)');
    expect(output).toContain('split it');
  });

  it('fails past the file budget even when the diff is tiny', () => {
    const files = Object.fromEntries(
      Array.from({ length: 13 }, (_, i) => [`f${i}.ts`, 1] as const),
    );
    const { ok, output } = runGate(gate(), repoWithDiff(files));
    expect(ok).toBe(false);
    expect(output).toContain('13 file(s)');
  });

  it('passes exactly AT the budget — the cap is a ceiling, not a strict bound', () => {
    expect(runGate(gate(), repoWithDiff({ 'big.ts': 400 })).ok).toBe(true);
  });

  // The scratch tree is written by every agent BY INSTRUCTION (findings
  // shards, task specs). Counting it would put every task over budget for
  // work huu itself demanded.
  it("ignores huu's own scratch tree", () => {
    const noisy = Object.fromEntries([
      ['src/a.ts', 5],
      ...Array.from({ length: 20 }, (_, i) => [`.huu/dev/epoch-1/f${i}.json`, 50] as const),
    ]);
    expect(runGate(gate(), repoWithDiff(noisy)).ok).toBe(true);
  });

  // awk reads the two LEADING numeric columns, so a path cannot shift them.
  it('counts correctly when a path contains a space', () => {
    const { ok, output } = runGate(gate(), repoWithDiff({ 'a file.ts': 401 }));
    expect(ok).toBe(false);
    expect(output).toContain('401 changed line(s) across 1 file(s)');
  });

  it('passes on a repository with a single root commit and no HEAD^', () => {
    const dir = mkdtempSync(join(tmpdir(), 'huu-diffbudget-root-'));
    repos.push(dir);
    sh('git init --initial-branch=main -q', dir);
    sh('git config user.email t@t.com && git config user.name t', dir);
    writeFileSync(join(dir, 'README.md'), `${'x\n'.repeat(9999)}`, 'utf8');
    sh('git add -A && git commit -qm "chore: init"', dir);
    expect(runGate(gate(), dir).ok).toBe(true);
  });
});

describe('mergeGate composition', () => {
  it('chains lintGate and changelogGate with && in registry order', () => {
    const gate = gateFor(
      { lintGate: true, changelogGate: true },
      { lintCommands: ['npm run lint', 'npm run typecheck'] },
    )!;
    expect(gate.startsWith('npm run lint && npm run typecheck && ')).toBe(true);
    expect(gate).toContain('Conventional Commit');
  });

  // The regression the accumulator exists for: before it, each option assigned
  // `pipeline.mergeGate`, so the second one compiled ERASED the first with no
  // error anywhere.
  it('loses neither gate when both are on', () => {
    const both = gateFor(
      { lintGate: true, changelogGate: true },
      { lintCommands: ['npm run typecheck'] },
    )!;
    const lintOnly = gateFor({ lintGate: true }, { lintCommands: ['npm run typecheck'] })!;
    const changelogOnly = gateFor({ changelogGate: true })!;
    expect(both).toContain(lintOnly);
    expect(both).toContain(changelogOnly);
  });

  it('emits no gate at all when no gate-shaped methodology is on', () => {
    expect(gateFor({ standards: true, writeSet: true })).toBeUndefined();
    expect(gateFor({})).toBeUndefined();
  });

  // A composed gate still has to survive `sh -c` as ONE command.
  it('is a single runnable shell command when composed', () => {
    const gate = gateFor({ lintGate: true, changelogGate: true }, { lintCommands: ['true'] })!;
    const repo = repoWithMergedCommits(['feat: fine']);
    expect(runGate(gate, repo).ok).toBe(true);

    const failing = gateFor({ lintGate: true, changelogGate: true }, { lintCommands: ['false'] })!;
    expect(runGate(failing, repo).ok).toBe(false);
  });
});
