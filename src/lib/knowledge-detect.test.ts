import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectKnowledge, isRouterFrontmatter } from './knowledge-detect.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'huu-knowledge-detect-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function writeSkill(root: string, name: string, frontmatter = ''): void {
  const dir = join(repo, root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), frontmatter ? `---\n${frontmatter}\n---\n\n# ${name}\n` : `# ${name}\n`);
}

describe('isRouterFrontmatter', () => {
  it('accepts the frontmatter shape the huu skills use', () => {
    expect(isRouterFrontmatter('---\nname: x\nmetadata:\n  type: router')).toBe(true);
    expect(isRouterFrontmatter("---\nmetadata:\n  type: 'router'")).toBe(true);
  });

  it('rejects the other skill types', () => {
    expect(isRouterFrontmatter('---\nmetadata:\n  type: knowledge')).toBe(false);
    expect(isRouterFrontmatter('---\nmetadata:\n  type: task')).toBe(false);
    // "router" inside a description must not count — only a type: line does.
    expect(isRouterFrontmatter('---\ndescription: routes tasks to the router')).toBe(false);
  });
});

describe('detectKnowledge', () => {
  it('reports absent on a bare repo', () => {
    const status = detectKnowledge(repo);
    expect(status.present).toBe(false);
    expect(status.bootstrapMode).toBe('create');
    expect(status.skillCount).toBe(0);
    expect(status.reason).toMatch(/no skill tree found/);
  });

  it('detects a catalog-routed .agents/skills tree', () => {
    writeSkill('.agents/skills', 'writing-tests', 'metadata:\n  type: knowledge');
    writeSkill('.agents/skills', 'authoring-pipelines', 'metadata:\n  type: task');
    writeFileSync(join(repo, '.agents/skills', 'catalog.md'), '# catalog\n');

    const status = detectKnowledge(repo);
    expect(status.present).toBe(true);
    expect(status.surface).toBe('agents');
    expect(status.catalogPath).toBe('.agents/skills/catalog.md');
    expect(status.skillCount).toBe(2);
    expect(status.skills).toEqual(['authoring-pipelines', 'writing-tests']);
    expect(status.bootstrapMode).toBe('extend');
  });

  it('detects a router skill by frontmatter when there is no catalog', () => {
    writeSkill('.agents/skills', 'some-router', 'metadata:\n  type: router');
    writeSkill('.agents/skills', 'writing-tests', 'metadata:\n  type: knowledge');

    const status = detectKnowledge(repo);
    expect(status.present).toBe(true);
    expect(status.routerSkill).toBe('some-router');
    expect(status.catalogPath).toBeUndefined();
  });

  it('detects a router skill by its conventional directory name', () => {
    writeSkill('.agents/skills', 'project-router');

    const status = detectKnowledge(repo);
    expect(status.present).toBe(true);
    expect(status.routerSkill).toBe('project-router');
  });

  // The load-bearing case: skills the planner has no entry point into are
  // NOT "already configured" — the bootstrap still has work to do.
  it('treats skills with no routing surface as not present, but as extend', () => {
    writeSkill('.agents/skills', 'writing-tests', 'metadata:\n  type: knowledge');

    const status = detectKnowledge(repo);
    expect(status.present).toBe(false);
    expect(status.bootstrapMode).toBe('extend');
    expect(status.skillCount).toBe(1);
    expect(status.reason).toMatch(/no catalog\.md and no router skill/);
  });

  it('falls back to .claude/skills when .agents/skills is absent', () => {
    writeSkill('.claude/skills', 'project-router');
    writeSkill('.claude/skills', 'writing-tests');

    const status = detectKnowledge(repo);
    expect(status.present).toBe(true);
    expect(status.surface).toBe('claude');
    expect(status.skillCount).toBe(2);
  });

  it('prefers .agents/skills over .claude/skills', () => {
    writeSkill('.agents/skills', 'project-router');
    writeSkill('.claude/skills', 'a');
    writeSkill('.claude/skills', 'b');
    writeSkill('.claude/skills', 'c');

    expect(detectKnowledge(repo).surface).toBe('agents');
    expect(detectKnowledge(repo).skillCount).toBe(1);
  });

  it('ignores directories without a SKILL.md', () => {
    mkdirSync(join(repo, '.agents/skills', 'not-a-skill'), { recursive: true });
    writeSkill('.agents/skills', 'project-router');

    expect(detectKnowledge(repo).skills).toEqual(['project-router']);
  });

  it('does not throw on an unreadable path', () => {
    expect(() => detectKnowledge(join(repo, 'does', 'not', 'exist'))).not.toThrow();
    expect(detectKnowledge(join(repo, 'nope')).present).toBe(false);
  });
});
