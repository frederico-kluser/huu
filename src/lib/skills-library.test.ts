import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
// The guard lives in scripts/ since the memory centralization (2026-09-27):
// the meta-skill-consolidate skill that used to host it was deleted. Since the
// library migration (2026-10-03) its subject is not a library any more — the
// whole thing (project-router + 19 SKILL.md + catalog.md + agent-skills.md)
// lives in the CoALA base (.agents/huu-coala-memory-agent-skill/memory/
// coala.sqlite, records `skill/<name>`) and the guard enforces that this
// retired shape STAYS retired. The M2-05 checks that validated library bodies
// (TTL freshness, removed-backend vocabulary) died with their surface.
const script = join(root, 'scripts', 'validate-skills.sh');
const skillsDir = join(root, '.agents', 'skills');

function runValidator(): string {
  return execFileSync('bash', [script], { encoding: 'utf-8', timeout: 30_000 });
}

/** Run validator and return its combined output. Throws if exit 0. */
function runValidatorExpectFail(): string {
  try {
    execFileSync('bash', [script], { encoding: 'utf-8', timeout: 30_000 });
    throw new Error('expected validator to fail, but it exited 0');
  } catch (e: any) {
    return `${e.stdout || ''}${e.stderr || ''}`;
  }
}

/** Create paths (files with optional content) and return a cleanup fn. */
function withRetiredShape(files: Array<{ path: string; content?: string }>): () => void {
  const created: string[] = [];
  const createdDirs: string[] = [];
  for (const f of files) {
    const dir = join(f.path, '..');
    // Track only the directories WE create — pruning must never reach
    // skillsDir itself (a LEARNINGS.md directly under it has skillsDir as
    // parent; removing that took the memory registration with it once).
    if (!existsSync(dir)) createdDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(f.path, f.content ?? '');
    created.push(f.path);
  }
  return () => {
    for (const p of created.reverse()) rmSync(p, { force: true });
    for (const dir of createdDirs.reverse()) {
      if (dir !== skillsDir) rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe('skills-library', () => {
  it('validate-skills.sh exits 0 for the memory-only state', () => {
    const out = runValidator();
    expect(out).toContain('OK');
  });

  // Regression: the retired shape grows back silently unless the gate names
  // it ("Ausência não falha sozinha" — METODO §0.1). Each test resurrects one
  // piece of the 2026-10-03 migration and demands the FAIL.
  it('validate-skills.sh catches a skill growing back under .agents/skills', () => {
    const cleanup = withRetiredShape([
      { path: join(skillsDir, 'rogue-skill-test', 'SKILL.md'), content: '# rogue\n' },
    ]);
    let out = '';
    try {
      out = runValidatorExpectFail();
    } finally {
      cleanup();
    }
    expect(out).toMatch(/FAIL\[library\].*skill library was migrated to the CoALA base/);
  });

  it('validate-skills.sh catches a resurrected catalog.md', () => {
    const cleanup = withRetiredShape([
      { path: join(skillsDir, 'catalog.md'), content: '# catalog — should not exist\n' },
    ]);
    let out = '';
    try {
      out = runValidatorExpectFail();
    } finally {
      cleanup();
    }
    expect(out).toMatch(/FAIL\[library\].*catalog\.md.*skill library was migrated to the CoALA base/);
  });

  it('validate-skills.sh catches a resurrected agent-skills.md', () => {
    const cleanup = withRetiredShape([
      { path: join(root, 'agent-skills.md'), content: '# overview — should not exist\n' },
    ]);
    let out = '';
    try {
      out = runValidatorExpectFail();
    } finally {
      cleanup();
    }
    expect(out).toMatch(/FAIL\[overview\].*skill-system overview was migrated to the CoALA base/);
  });

  // Memory centralization (2026-09-27): the distributed per-skill journal was
  // migrated to the CoALA base and deleted. A reappearance forks the memory
  // back into N files, so it stays a FAIL.
  it('validate-skills.sh rejects a stray LEARNINGS.md (memory centralized in CoALA)', () => {
    const cleanup = withRetiredShape([
      { path: join(skillsDir, 'LEARNINGS.md'), content: '# Learnings\n' },
    ]);
    let out = '';
    try {
      out = runValidatorExpectFail();
    } finally {
      cleanup();
    }
    expect(out).toMatch(/FAIL\[learnings\].*stray LEARNINGS\.md/);
  });

  // The missing-memory-skill branch moves the whole fixture (it cannot mutate
  // the real memory skill), so it is exercised by the adversarial selfcheck:
  // scripts/selfcheck/mutations/validate-skills-no-memory.sh.
});
