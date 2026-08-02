import { describe, it, expect } from 'vitest';
import { getDefaultPipeline } from './huu-test-suite.js';
import { isWorkStep, isCheckStep } from '../types.js';
import type { CheckStep, WorkStep } from '../types.js';

// Living spec for the CODE-FROZEN contract of the flagship Test Suite
// pipeline: it writes tests + its own artifacts and NEVER modifies production
// source. These assertions exist so a future prompt edit can't silently
// reintroduce the "if a real bug is exposed, fix $file" escape hatch that the
// v3 rewrite removed.

const pipeline = getDefaultPipeline();
const workSteps = pipeline.steps.filter(isWorkStep) as WorkStep[];
const checkSteps = pipeline.steps.filter(isCheckStep) as CheckStep[];

// The four steps that MUTATE the worktree (recon writes only the memory file;
// the check never commits). Each must reassert the freeze before its task.
const MUTATING_STEP_NAMES = [
  '1. Analyze stack and write huu-tests.md',
  '3. Write tests for $file',
  '4. Cleanup + coverage badge',
  '6. Finalize',
];

describe('huu Test Suite — code-frozen contract', () => {
  it('every mutating step opens with the frozen-tree allowlist banner', () => {
    for (const name of MUTATING_STEP_NAMES) {
      const step = workSteps.find((s) => s.name === name);
      expect(step, name).toBeDefined();
      expect(step!.prompt, name).toContain('CODE IS FROZEN');
      expect(step!.prompt, name).toContain('PRODUCTION SOURCE IS READ-ONLY');
    }
  });

  it('no step prompt carries a source-edit escape hatch', () => {
    // The exact permissive phrasings removed in v3 — and any generic
    // "fix/patch $file" instruction — must never reappear in any prompt.
    const banned = [
      'only if a REAL bug',
      'fix `$file`',
      'fix $file (',
      'Real bug in `$file` -> fix',
      'minimal change, no refactor',
    ];
    const allPrompts = [
      ...workSteps.map((s) => s.prompt),
      ...checkSteps.map((s) => s.condition),
    ];
    for (const text of allPrompts) {
      for (const phrase of banned) {
        expect(text, phrase).not.toContain(phrase);
      }
      // Durable paraphrase guard: an "edit/patch/fix … $file" instruction is
      // only ever allowed when negated (e.g. "do NOT edit `$file`"). Any
      // POSITIVE such instruction is an escape hatch.
      const positiveEdit = /(?<!NOT )(?<!not )(?<!never )(?:edit|patch|fix)\b[^.\n]{0,24}\$file/i;
      expect(positiveEdit.test(text), `positive edit-$file in: ${text.slice(0, 60)}`).toBe(false);
    }
  });

  it('the per-file step allows writing only the test file + FAQ, never $file', () => {
    const step3 = workSteps.find((s) => s.name === '3. Write tests for $file')!;
    // It must explicitly forbid editing the source file under test...
    expect(step3.prompt).toContain('you do NOT edit `$file`');
    // ...and route a discovered bug into characterization + a finding, not a fix.
    expect(step3.prompt).toContain('CHARACTERIZE');
    expect(step3.prompt).toContain('suspected-bug');
    // The HARD allow-list must NOT grant "$file" as a writable target.
    expect(step3.prompt).toContain('NOT `$file`');
  });

  it('cleanup restores modified source AND removes agent-added source against the run base', () => {
    const cleanup = workSteps.find((s) => s.name === '4. Cleanup + coverage badge')!;
    expect(cleanup.prompt).toContain('RESTORE THE FROZEN TREE');
    // Modified/deleted source is restored from base...
    expect(cleanup.prompt).toContain('git checkout $baseCommit -- <path>');
    // ...and a smuggled NEW source file is removed (checkout can't remove it).
    expect(cleanup.prompt).toContain('git rm -f <path>');
    expect(cleanup.prompt).toContain('--name-status');
    // Deletion of a failing TEST block must be the last resort, not the default.
    expect(cleanup.prompt).toContain('Deletion is the LAST resort');
  });

  it('only the setup step may write the runner manifest; the fan-out step may not', () => {
    const step1 = workSteps.find((s) => s.name === '1. Analyze stack and write huu-tests.md')!;
    const step3 = workSteps.find((s) => s.name === '3. Write tests for $file')!;
    // Step 1 carries the setup exception (manifest = test/dev deps + test script).
    expect(step1.prompt).toContain('SETUP EXCEPTION');
    // The per-file fan-out must NOT be told it may touch the manifest.
    expect(step3.prompt).not.toContain('SETUP EXCEPTION');
    expect(step3.prompt).toContain('not the manifest');
  });

  it('the judge enforces the freeze (base diff) and bans cheap-green tests', () => {
    expect(checkSteps).toHaveLength(1);
    const judge = checkSteps[0]!.condition;
    // Hard code-frozen guard: diff the whole run against its base commit.
    expect(judge).toContain('$baseCommit..HEAD');
    expect(judge).toContain('CODE FROZEN');
    // Anti-cheat: assertion-free / weak-only / self-mock tests are rejected.
    expect(judge).toContain('NO CHEAP-GREEN');
    // Hard clauses are non-negotiable regardless of the loop counter.
    expect(judge).toContain('regardless of $runs');
  });

  it('known-bug tracking never relies on skip/disable/ignore (they assert nothing)', () => {
    // The per-file + cleanup steps must steer Go/Rust/JUnit toward
    // characterization, not a silent skip that parks the test.
    const step3 = workSteps.find((s) => s.name === '3. Write tests for $file')!;
    expect(step3.prompt).toContain('xfail');
    expect(step3.prompt.toLowerCase()).toContain('characterization');
    expect(step3.prompt).toMatch(/NEVER use[\s\S]*t\.Skip/);
  });
});
