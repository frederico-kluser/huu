import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  suggestFilesForStep,
  stubSuggest,
  selectRelevantFiles,
  filterValidPaths,
  extractKeywords,
  MAX_FILES_IN_PROMPT,
  type SuggestFilesInput,
} from './llm-suggest-files.js';
import type { Pipeline, PromptStep } from './types.js';

const STEP: PromptStep = {
  name: 'Refactor auth middleware',
  prompt: 'Rename the auth helper functions in the middleware to use camelCase.',
  files: [],
};

const PIPELINE: Pipeline = {
  name: 'auth-rewrite',
  steps: [STEP],
};

const AVAILABLE = [
  'src/auth/middleware.ts',
  'src/auth/helpers.ts',
  'src/auth/types.ts',
  'src/orchestrator/runner.ts',
  'src/lib/file-scanner.ts',
  'README.md',
];

function makeInput(overrides: Partial<SuggestFilesInput> = {}): SuggestFilesInput {
  return {
    pipeline: PIPELINE,
    currentStepIndex: 0,
    currentStep: STEP,
    availableFiles: AVAILABLE,
    apiKey: 'stub',
    ...overrides,
  };
}

describe('suggestFilesForStep — stub mode', () => {
  let originalStubFlag: string | undefined;

  beforeEach(() => {
    originalStubFlag = process.env.HUU_LANGCHAIN_STUB;
  });

  afterEach(() => {
    if (originalStubFlag === undefined) delete process.env.HUU_LANGCHAIN_STUB;
    else process.env.HUU_LANGCHAIN_STUB = originalStubFlag;
  });

  it('returns deterministic suggestions when apiKey is "stub"', async () => {
    const r = await suggestFilesForStep(makeInput({ apiKey: 'stub' }));
    expect(r.files.length).toBeGreaterThan(0);
    for (const f of r.files) expect(AVAILABLE).toContain(f);
    expect(r.ignoredCount).toBe(0);
  });

  it('treats empty apiKey identically to stub', async () => {
    const r = await suggestFilesForStep(makeInput({ apiKey: '' }));
    expect(r.files.length).toBeGreaterThan(0);
    for (const f of r.files) expect(AVAILABLE).toContain(f);
  });

  it('routes through the stub when HUU_LANGCHAIN_STUB=1 even with a real key', async () => {
    process.env.HUU_LANGCHAIN_STUB = '1';
    const r = await suggestFilesForStep(makeInput({ apiKey: 'sk-or-real-looking-key' }));
    expect(r.files.length).toBeGreaterThan(0);
    for (const f of r.files) expect(AVAILABLE).toContain(f);
  });

  it('throws "aborted" when the AbortSignal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      suggestFilesForStep(makeInput({ signal: ctrl.signal })),
    ).rejects.toThrow(/abort/i);
  });

  it('handles availableFiles=[] without crashing', async () => {
    const r = await suggestFilesForStep(makeInput({ availableFiles: [] }));
    expect(r.files).toEqual([]);
    expect(r.ignoredCount).toBe(0);
  });
});

describe('stubSuggest — keyword matching', () => {
  it('prefers files whose path contains a prompt keyword', () => {
    const r = stubSuggest(makeInput());
    // "auth" / "middleware" / "rename" in the prompt → auth-related paths first
    expect(r.files.some((f) => f.includes('auth'))).toBe(true);
  });

  it('falls back to first 2 paths when no keyword matches', () => {
    const stepNoMatch: PromptStep = {
      name: 'X',
      prompt: 'Adicione um cabeçalho jsdoc no topo.',
      files: [],
    };
    const r = stubSuggest({
      ...makeInput(),
      currentStep: stepNoMatch,
      pipeline: { name: 'p', steps: [stepNoMatch] },
    });
    expect(r.files.length).toBeLessThanOrEqual(2);
  });
});

describe('selectRelevantFiles — truncation', () => {
  it('returns input untouched when under the cap', () => {
    const r = selectRelevantFiles(AVAILABLE, 'auth helpers', []);
    expect(r).toEqual(AVAILABLE);
  });

  it('truncates to MAX_FILES_IN_PROMPT and prioritizes alwaysInclude', () => {
    const huge: string[] = [];
    for (let i = 0; i < 1500; i++) huge.push(`src/generated/file-${i}.ts`);
    const must = ['src/generated/file-1499.ts']; // would be at the bottom of an unsorted run
    const r = selectRelevantFiles(huge, 'unrelated keywords here', must);
    expect(r.length).toBe(MAX_FILES_IN_PROMPT);
    expect(r).toContain('src/generated/file-1499.ts');
  });

  it('boosts paths matching prompt keywords', () => {
    const big: string[] = [];
    for (let i = 0; i < 900; i++) big.push(`src/foo/noise-${i}.ts`);
    big.push('src/auth/critical-middleware.ts');
    const r = selectRelevantFiles(big, 'auth middleware rewrite', []);
    // Critical match should be in the kept set even though it's the last index.
    expect(r).toContain('src/auth/critical-middleware.ts');
  });
});

describe('filterValidPaths — validation', () => {
  it('returns subset of available and counts ignored', () => {
    const r = filterValidPaths(
      ['src/auth/middleware.ts', 'src/does/not/exist.ts', 'README.md'],
      AVAILABLE,
    );
    expect(r.valid).toEqual(['src/auth/middleware.ts', 'README.md']);
    expect(r.ignoredCount).toBe(1);
  });

  it('handles empty input', () => {
    expect(filterValidPaths([], AVAILABLE)).toEqual({ valid: [], ignoredCount: 0 });
  });
});

describe('extractKeywords', () => {
  it('strips stop-words and short tokens', () => {
    const r = extractKeywords('the auth middleware needs renaming for the helpers');
    expect(r).toContain('auth');
    expect(r).toContain('middleware');
    expect(r).toContain('renaming');
    expect(r).toContain('helpers');
    expect(r).not.toContain('the');
    expect(r).not.toContain('for');
  });

  it('lowercases and dedupes', () => {
    const r = extractKeywords('Auth AUTH auth auth-helper');
    expect(r.filter((t) => t === 'auth').length).toBe(1);
  });
});
