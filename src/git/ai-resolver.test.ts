import { describe, it, expect } from 'vitest';
import {
  AIResolver,
  validateResolution,
  extractConflictHunks,
  detectLanguage,
} from './ai-resolver.js';

// ---------------------------------------------------------------------------
// extractConflictHunks
// ---------------------------------------------------------------------------

describe('extractConflictHunks', () => {
  it('should extract conflict hunks from conflict markers', () => {
    const content = `line1
line2
<<<<<<< HEAD
ours content
=======
theirs content
>>>>>>> feature
line3
line4`;

    const hunks = extractConflictHunks(content, 2);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.ours).toBe('ours content');
    expect(hunks[0]!.theirs).toBe('theirs content');
  });

  it('should handle multiple conflict hunks', () => {
    const content = `<<<<<<< HEAD
a
=======
b
>>>>>>> feature
middle
<<<<<<< HEAD
c
=======
d
>>>>>>> feature`;

    const hunks = extractConflictHunks(content);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.ours).toBe('a');
    expect(hunks[0]!.theirs).toBe('b');
    expect(hunks[1]!.ours).toBe('c');
    expect(hunks[1]!.theirs).toBe('d');
  });

  it('should handle diff3 style with base section', () => {
    const content = `<<<<<<< HEAD
ours
||||||| merged common ancestors
base
=======
theirs
>>>>>>> feature`;

    const hunks = extractConflictHunks(content);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.ours).toBe('ours');
    expect(hunks[0]!.base).toBe('base');
    expect(hunks[0]!.theirs).toBe('theirs');
  });

  it('should return empty array for files without conflicts', () => {
    const content = 'no conflicts here\njust normal code\n';
    expect(extractConflictHunks(content)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

describe('detectLanguage', () => {
  it('should detect TypeScript', () => {
    expect(detectLanguage('src/app.ts')).toBe('typescript');
    expect(detectLanguage('src/App.tsx')).toBe('typescript');
  });

  it('should detect Python', () => {
    expect(detectLanguage('main.py')).toBe('python');
  });

  it('should default to text for unknown extensions', () => {
    expect(detectLanguage('file.xyz')).toBe('text');
    expect(detectLanguage('Makefile')).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// validateResolution
// ---------------------------------------------------------------------------

describe('validateResolution', () => {
  const allowedPaths = new Set(['src/a.ts', 'src/b.ts']);

  it('should accept valid resolution', () => {
    const result = validateResolution(
      {
        files: [
          { path: 'src/a.ts', resolved: true, content: 'valid content', rationale: 'picked ours', confidence: 0.9 },
        ],
      },
      allowedPaths,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject resolution touching non-conflicted files', () => {
    const result = validateResolution(
      {
        files: [
          { path: 'src/evil.ts', resolved: true, content: 'hacked', rationale: 'sneaky', confidence: 0.99 },
        ],
      },
      allowedPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('non-conflicted file');
  });

  it('should reject empty content for resolved files', () => {
    const result = validateResolution(
      {
        files: [
          { path: 'src/a.ts', resolved: true, content: '', rationale: 'empty', confidence: 0.5 },
        ],
      },
      allowedPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Empty content');
  });

  it('should reject resolution with remaining conflict markers', () => {
    const result = validateResolution(
      {
        files: [
          { path: 'src/a.ts', resolved: true, content: '<<<<<<< HEAD\nstuff', rationale: 'oops', confidence: 0.3 },
        ],
      },
      allowedPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('conflict markers');
  });

  it('should reject empty file list', () => {
    const result = validateResolution({ files: [] }, allowedPaths);
    expect(result.valid).toBe(false);
  });

  it('should reject invalid confidence values', () => {
    const result = validateResolution(
      {
        files: [
          { path: 'src/a.ts', resolved: true, content: 'code', rationale: 'ok', confidence: 1.5 },
        ],
      },
      allowedPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid confidence');
  });
});

// ---------------------------------------------------------------------------
// AIResolver
// ---------------------------------------------------------------------------

describe('AIResolver', () => {
  it('should resolve conflicts when model returns valid JSON', async () => {
    const resolver = new AIResolver({
      modelId: 'test-model',
      callModel: async () =>
        JSON.stringify({
          files: [
            {
              path: 'src/a.ts',
              resolved: true,
              content: 'merged content',
              rationale: 'combined both sides',
              confidence: 0.85,
            },
          ],
        }),
    });

    const result = await resolver.resolve({
      queueItemId: 'q1',
      mergeBaseSha: 'base',
      oursSha: 'ours',
      theirsSha: 'theirs',
      files: [
        {
          path: 'src/a.ts',
          language: 'typescript',
          riskClass: 'medium',
          conflictHunks: [{ base: '', ours: 'a', theirs: 'b', surrounding: '' }],
          history: [],
        },
      ],
      constraints: [],
      failingChecks: [],
    });

    expect(result).not.toBeNull();
    expect(result!.resolved).toBe(true);
    expect(result!.files).toHaveLength(1);
    expect(result!.files[0]!.resolvedContent).toBe('merged content');
    expect(result!.modelId).toBe('test-model');
  });

  it('should return null when model returns invalid JSON', async () => {
    const resolver = new AIResolver({
      modelId: 'test-model',
      callModel: async () => 'not valid json at all',
      maxRetries: 0,
    });

    const result = await resolver.resolve({
      queueItemId: 'q1',
      mergeBaseSha: 'base',
      oursSha: 'ours',
      theirsSha: 'theirs',
      files: [
        {
          path: 'src/a.ts',
          language: 'typescript',
          riskClass: 'medium',
          conflictHunks: [{ base: '', ours: 'a', theirs: 'b', surrounding: '' }],
          history: [],
        },
      ],
      constraints: [],
      failingChecks: [],
    });

    expect(result).toBeNull();
  });

  it('should return null when model touches non-conflicted files', async () => {
    const resolver = new AIResolver({
      modelId: 'test-model',
      callModel: async () =>
        JSON.stringify({
          files: [
            { path: 'src/evil.ts', resolved: true, content: 'bad', rationale: 'hack', confidence: 0.99 },
          ],
        }),
      maxRetries: 0,
    });

    const result = await resolver.resolve({
      queueItemId: 'q1',
      mergeBaseSha: 'base',
      oursSha: 'ours',
      theirsSha: 'theirs',
      files: [
        {
          path: 'src/a.ts',
          language: 'typescript',
          riskClass: 'medium',
          conflictHunks: [{ base: '', ours: 'a', theirs: 'b', surrounding: '' }],
          history: [],
        },
      ],
      constraints: [],
      failingChecks: [],
    });

    expect(result).toBeNull();
  });

  it('should retry once on validation failure', async () => {
    let callCount = 0;
    const resolver = new AIResolver({
      modelId: 'test-model',
      maxRetries: 1,
      callModel: async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            files: [{ path: 'src/evil.ts', resolved: true, content: 'bad', rationale: 'oops', confidence: 0.9 }],
          });
        }
        return JSON.stringify({
          files: [{ path: 'src/a.ts', resolved: true, content: 'fixed', rationale: 'ok', confidence: 0.8 }],
        });
      },
    });

    const result = await resolver.resolve({
      queueItemId: 'q1',
      mergeBaseSha: 'base',
      oursSha: 'ours',
      theirsSha: 'theirs',
      files: [
        {
          path: 'src/a.ts',
          language: 'typescript',
          riskClass: 'medium',
          conflictHunks: [{ base: '', ours: 'a', theirs: 'b', surrounding: '' }],
          history: [],
        },
      ],
      constraints: [],
      failingChecks: [],
    });

    expect(callCount).toBe(2);
    expect(result).not.toBeNull();
    expect(result!.files[0]!.resolvedContent).toBe('fixed');
  });

  it('should handle model errors gracefully', async () => {
    const resolver = new AIResolver({
      modelId: 'test-model',
      maxRetries: 0,
      callModel: async () => {
        throw new Error('API timeout');
      },
    });

    const result = await resolver.resolve({
      queueItemId: 'q1',
      mergeBaseSha: 'base',
      oursSha: 'ours',
      theirsSha: 'theirs',
      files: [
        {
          path: 'src/a.ts',
          language: 'typescript',
          riskClass: 'medium',
          conflictHunks: [{ base: '', ours: 'a', theirs: 'b', surrounding: '' }],
          history: [],
        },
      ],
      constraints: [],
      failingChecks: [],
    });

    expect(result).toBeNull();
  });

  it('should handle markdown-wrapped JSON response', async () => {
    const resolver = new AIResolver({
      modelId: 'test-model',
      callModel: async () =>
        '```json\n' +
        JSON.stringify({
          files: [
            { path: 'src/a.ts', resolved: true, content: 'code', rationale: 'done', confidence: 0.9 },
          ],
        }) +
        '\n```',
    });

    const result = await resolver.resolve({
      queueItemId: 'q1',
      mergeBaseSha: 'base',
      oursSha: 'ours',
      theirsSha: 'theirs',
      files: [
        {
          path: 'src/a.ts',
          language: 'typescript',
          riskClass: 'medium',
          conflictHunks: [{ base: '', ours: 'a', theirs: 'b', surrounding: '' }],
          history: [],
        },
      ],
      constraints: [],
      failingChecks: [],
    });

    expect(result).not.toBeNull();
    expect(result!.resolved).toBe(true);
  });
});
