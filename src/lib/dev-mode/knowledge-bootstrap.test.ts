import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArchitectPrompt, PROMPT_CANDIDATES } from './knowledge-bootstrap.js';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const PROMPT_FILE = 'knowledge-skills-architect-prompt.md';

// Regression: the bootstrap prompt shipped ONLY as `docs/…`, which the Docker
// image and the npm tarball both omit (they carry `dist/` and nothing else).
// The agent then received an empty prompt and dev mode died with
// "not found and no override provided" on every containerised run — the
// default path for `huu dev`.
describe('knowledge bootstrap — prompt packaging', () => {
  it('resolves the architect prompt from a source checkout', () => {
    const prompt = loadArchitectPrompt();
    expect(prompt).not.toBe('');
    expect(prompt).toContain('<knowledge_skills_architect>');
  });

  it('looks in dist/assets/ first, so the compiled tree is self-sufficient', () => {
    // dist/lib/dev-mode → dist/assets. Two levels up, not three: `docs/` is a
    // sibling of `src/`, `assets/` is a child of `dist/`.
    expect(PROMPT_CANDIDATES[0]).toMatch(/assets[/\\]knowledge-skills-architect-prompt\.md$/);
    expect(PROMPT_CANDIDATES[0]).not.toContain('docs');
    expect(PROMPT_CANDIDATES.some((p) => p.endsWith(join('docs', PROMPT_FILE)))).toBe(true);
  });

  it('has a build step that populates dist/assets/', () => {
    // Without this the first candidate never exists in the shipped image and
    // the bootstrap silently falls back to the source-checkout layout, which
    // is absent there too.
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain(`dist/assets`);
    expect(pkg.scripts.build).toContain(PROMPT_FILE);
  });

  it('copies the prompt into the Docker builder stage before `npm run build`', () => {
    // The builder stage only COPYs tsconfig.json + src/, so the build step
    // would fail (or silently skip) without an explicit COPY for the prompt.
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const copyAt = dockerfile.indexOf(`COPY docs/${PROMPT_FILE}`);
    const buildAt = dockerfile.indexOf('RUN npm run build');
    expect(copyAt).toBeGreaterThan(-1);
    expect(copyAt).toBeLessThan(buildAt);
  });

  it('exempts the prompt from .dockerignore', () => {
    // `docs` and `*.md` are both excluded; without the negation the builder
    // COPY fails at build time with "not found".
    const ignore = readFileSync(join(root, '.dockerignore'), 'utf8');
    expect(ignore).toContain(`!docs/${PROMPT_FILE}`);
    // The negation must come AFTER the `docs` / `*.md` exclusions it undoes.
    const lines = ignore.split('\n').map((l) => l.trim());
    const negation = lines.indexOf(`!docs/${PROMPT_FILE}`);
    expect(negation).toBeGreaterThan(lines.indexOf('docs'));
    expect(negation).toBeGreaterThan(lines.indexOf('*.md'));
  });
});
