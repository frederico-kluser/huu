import { describe, it, expect } from 'vitest';
import { memoryContract, memoryCapForPath } from './memory-contract.js';
import { DEFAULT_MEMORY_MAX_FILES } from './types.js';
import type { Pipeline } from './types.js';

describe('memoryContract', () => {
  it('quotes the exact path, the format tag and the cap', () => {
    const text = memoryContract('.huu/scan.json', 12);
    expect(text).toContain('MEMORY CONTRACT');
    expect(text).toContain('`.huu/scan.json`');
    expect(text).toContain('"_format": "huu-memory-v1"');
    expect(text).toContain('at most 12 files');
    expect(text).toContain('$hint');
    expect(text).toContain('empty "files" array is valid');
  });

  it('defaults the cap to DEFAULT_MEMORY_MAX_FILES', () => {
    expect(memoryContract('.huu/x.json')).toContain(`at most ${DEFAULT_MEMORY_MAX_FILES} files`);
  });
});

describe('memoryCapForPath', () => {
  const pipeline: Pipeline = {
    name: 'p',
    steps: [
      { type: 'work', name: 'scan', prompt: 'p', files: [], scope: 'project', produces: '.huu/a.json' },
      { type: 'work', name: 'fix', prompt: 'p $file', files: [], scope: 'memory', filesFrom: '.huu/a.json', maxFiles: 7 },
      { type: 'check', name: 'gate', condition: 'c', outcomes: [{ label: 'ok', nextStepName: 'fix', default: true }] },
    ],
  };

  it("returns the consuming step's maxFiles for a matched path", () => {
    expect(memoryCapForPath(pipeline, '.huu/a.json')).toBe(7);
  });

  it('falls back to the default when no consumer matches', () => {
    expect(memoryCapForPath(pipeline, '.huu/other.json')).toBe(DEFAULT_MEMORY_MAX_FILES);
  });
});
