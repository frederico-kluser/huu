// Prove that every audit pipeline's judge condition CAN say "rework".
// Until this file existed, NO test proved any condition would actually
// reject a bad report — the forward-default design meant failed judges
// always defaulted to "approved" in stub/smoke runs.
//
// Part 1 — Static assertions on every audit pipeline's judge condition:
//   Must contain $baseCommit..HEAD, must be fail-closed, must NOT contain
//   isolated `git status` (a heuristic that would match on ANY dirty tree,
//   not just the pipeline's own changes).
//
// Part 2 — Mechanical contract evaluation via `evaluateReportContract()`:
//   The function reproduces the same checks the judge condition asks the
//   LLM to run. Three fixture repos prove the function CAN reject a bad
//   report (report-sujo, report-incompleto) and CAN accept a clean one
//   (report-limpo).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_PIPELINES, type DefaultPipelineModule } from './registry.js';
import { evaluateReportContract } from './report-contract.js';
import type { CheckStep } from '../types.js';

// ── Helpers ────────────────────────────────────────────────────────────

const AUDIT_NAMES = [
  'huu Docs Audit',
  'huu Quality Audit',
  'huu Performance Audit',
  'huu Refactor Plan',
  'huu Security Audit',
];

function auditModules(): readonly DefaultPipelineModule[] {
  return DEFAULT_PIPELINES.filter((m) =>
    AUDIT_NAMES.includes(m.DEFAULT_PIPELINE_NAME),
  );
}

function auditJudgeConditions(): readonly { name: string; condition: string }[] {
  return auditModules().map((mod) => {
    const p = mod.getDefaultPipeline();
    const check = p.steps.find((s): s is CheckStep => s.type === 'check')!;
    return { name: mod.DEFAULT_PIPELINE_NAME, condition: check.condition };
  });
}

/**
 * Create a temp git repo, copy fixture files, make two commits, return
 * { dir, baseCommit } where baseCommit is the hash of the FIRST commit
 * (the "before pipeline" snapshot against which the diff is checked).
 */
function fixtureRepo(
  fixtureDir: string,
  initialFiles: Record<string, string>,
): { dir: string; baseCommit: string } {
  const dir = mkdtempSync(join(tmpdir(), 'huu-judge-conditions-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test' };

  // Write initial files and make the base commit ("before pipeline")
  for (const [relPath, content] of Object.entries(initialFiles)) {
    const full = resolve(dir, relPath);
    // dirname is cross-platform: resolve then slice
    const parent = resolve(full, '..');
    execSync(`mkdir -p "${parent}" && echo "${content.replace(/"/g, '\\"')}" > "${full}"`, { cwd: dir, env });
  }
  execSync('git init && git add -A && git commit -m "initial"', { cwd: dir, env });
  const baseCommit = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8', env }).trim();

  // Copy fixture files and make the second commit ("after pipeline")
  cpSync(fixtureDir, dir, { recursive: true });
  execSync('git add -A && git commit -m "fixture"', { cwd: dir, env });

  return { dir, baseCommit };
}

// ── Part 1 — Static condition checks ──────────────────────────────────

describe('judge-conditions', () => {
  it('every audit judge condition contains $baseCommit..HEAD', () => {
    for (const { name, condition } of auditJudgeConditions()) {
      expect(condition, name).toContain('$baseCommit..HEAD');
    }
  });

  it('every audit judge condition is fail-closed (rejects on failure)', () => {
    for (const { name, condition } of auditJudgeConditions()) {
      // Must mention "rework" as a verdict AND handle the diff command
      // failing: "If the command fails ... answer rework" pattern.
      expect(condition, name).toMatch(/rework/);
      // The fail-closed pattern: if the diff command fails or produces
      // nothing, the judge must reject.
      expect(condition, name).toMatch(/If the command fails|no output/);
    }
  });

  it('no audit judge condition contains isolated "git status"', () => {
    // `git status` is a fragile heuristic — the working tree may always
    // be dirty. The judge must use `git diff --name-only $baseCommit..HEAD`
    // instead, which isolates the pipeline's own changes.
    for (const { name, condition } of auditJudgeConditions()) {
      expect(condition, name).not.toMatch(/\bgit status\b/);
    }
  });
});

// ── Part 2 — Mechanical contract evaluation ───────────────────────────

const FIXTURES_DIR = resolve(import.meta.dirname!, '__fixtures__');

const REQUIRED_SECTIONS = [
  '1. Scope',
  '2. Findings',
  '3. Summary',
  '4. Recommendations',
];

const REPORT_PATH = '.huu/audits/test.md';
const FAQ_PATH = '.huu/audits/test-faq.json';

describe('report-contract', () => {
  it('rejeita report-sujo — file changed outside .huu/', () => {
    const { dir, baseCommit } = fixtureRepo(
      resolve(FIXTURES_DIR, 'report-sujo'),
      { 'src/main.ts': '// original', '.huu/audits/.gitkeep': '' },
    );
    try {
      const result = evaluateReportContract(
        dir, baseCommit, REPORT_PATH, FAQ_PATH, REQUIRED_SECTIONS,
      );
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes('outside .huu/'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aceita report-limpo — all changes under .huu/ and sections complete', () => {
    const { dir, baseCommit } = fixtureRepo(
      resolve(FIXTURES_DIR, 'report-limpo'),
      { 'src/main.ts': '// untouched base file', '.huu/audits/.gitkeep': '' },
    );
    try {
      const result = evaluateReportContract(
        dir, baseCommit, REPORT_PATH, FAQ_PATH, REQUIRED_SECTIONS,
      );
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejeita report-incompleto — missing section "2. Findings"', () => {
    const { dir, baseCommit } = fixtureRepo(
      resolve(FIXTURES_DIR, 'report-incompleto'),
      { 'src/main.ts': '// original', '.huu/audits/.gitkeep': '' },
    );
    try {
      const result = evaluateReportContract(
        dir, baseCommit, REPORT_PATH, FAQ_PATH, REQUIRED_SECTIONS,
      );
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes('missing'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
