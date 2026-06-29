import { describe, expect, it } from 'vitest';
import { substituteFileInTitle } from './client/title-util.js';

// Browser-client mirror of src/lib/title-format.ts. The web kanban + run
// history build card titles from a step's NAME, and per-file/memory steps are
// named with the `$file` fan-out token. This locks the same contract as the
// lib spec: the user never sees a literal `$file` — it resolves to the worked
// file's basename, or the plural "files" on stage-level (merge) cards.

describe('substituteFileInTitle (web mirror)', () => {
  it('replaces $file with the file basename', () => {
    expect(substituteFileInTitle('Write tests for $file', 'src/components/Button.tsx')).toBe(
      'Write tests for Button.tsx',
    );
  });

  it('keeps a title without the token untouched', () => {
    expect(substituteFileInTitle('Consolidate report', 'src/a.ts')).toBe('Consolidate report');
  });

  it('collapses the token to "files" when no single file is worked', () => {
    expect(substituteFileInTitle('Merge · Write tests for $file', '')).toBe(
      'Merge · Write tests for files',
    );
    expect(substituteFileInTitle('Audit $file', null)).toBe('Audit files');
    expect(substituteFileInTitle('Audit $file', undefined)).toBe('Audit files');
  });

  it('replaces every occurrence and handles backslash / trailing-slash paths', () => {
    expect(substituteFileInTitle('$file → tests for $file', 'pkg/util.ts')).toBe(
      'util.ts → tests for util.ts',
    );
    expect(substituteFileInTitle('Scan $file', 'src\\win\\path.ts')).toBe('Scan path.ts');
    expect(substituteFileInTitle('Scan $file', 'src/dir/')).toBe('Scan dir');
  });

  it('tolerates an empty/falsy title', () => {
    expect(substituteFileInTitle('', 'a.ts')).toBe('');
    expect(substituteFileInTitle(undefined, 'a.ts')).toBe(undefined);
  });
});
