import { describe, it, expect } from 'vitest';
import { buildRefinerSystemPrompt, buildSynthesisRequest } from './refinement-prompts.js';

describe('buildRefinerSystemPrompt', () => {
  it('marks whole-project mode when scope is "project"', () => {
    const sys = buildRefinerSystemPrompt({
      stageName: 'X',
      initialPrompt: 'p',
      files: [],
      scope: 'project',
    });
    expect(sys).toMatch(/WHOLE-PROJECT/);
    expect(sys).toMatch(/NÃO use o token \$file/);
  });

  it('marks per-file template mode when scope is "per-file"', () => {
    const sys = buildRefinerSystemPrompt({
      stageName: 'X',
      initialPrompt: 'p',
      files: ['a.ts', 'b.ts'],
      scope: 'per-file',
    });
    expect(sys).toMatch(/PER-FILE/);
    expect(sys).toMatch(/TEMPLATE genérico/);
    expect(sys).toMatch(/\$file/);
    expect(sys).toMatch(/a\.ts, b\.ts/);
  });

  it('falls back to files-driven mode when scope is undefined (legacy flexible)', () => {
    const projectish = buildRefinerSystemPrompt({
      stageName: 'X',
      initialPrompt: 'p',
      files: [],
    });
    expect(projectish).toMatch(/WHOLE-PROJECT/);

    const perFileish = buildRefinerSystemPrompt({
      stageName: 'X',
      initialPrompt: 'p',
      files: ['a.ts'],
    });
    expect(perFileish).toMatch(/PER-FILE/);
  });
});

describe('buildSynthesisRequest', () => {
  it('forbids $file in the synthesized prompt for project scope', () => {
    const req = buildSynthesisRequest({
      stageName: 'X',
      initialPrompt: '',
      files: [],
      scope: 'project',
    });
    expect(req).toMatch(/projeto inteiro/);
    expect(req).toMatch(/NÃO use o token \$file/);
  });

  it('requires $file template for per-file scope and forbids per-file enumeration', () => {
    const req = buildSynthesisRequest({
      stageName: 'X',
      initialPrompt: '',
      files: ['a.ts', 'b.ts'],
      scope: 'per-file',
    });
    expect(req).toMatch(/UMA VEZ POR ARQUIVO/);
    expect(req).toMatch(/TEMPLATE/);
    expect(req).toMatch(/\$file/);
    // Negative: the synthesis must explicitly forbid per-file enumeration.
    expect(req).toMatch(/NÃO escreva instruções no formato/);
  });
});
