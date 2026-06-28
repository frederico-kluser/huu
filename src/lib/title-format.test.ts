import { describe, expect, it } from 'vitest';
import { substituteFileInTitle } from './title-format.js';

// The kanban/run cards show a step's NAME as their title, and per-file/memory
// steps are named with the `$file` fan-out token (e.g. "3. Write tests for
// $file"). Before this helper the raw token leaked into both front-ends; the
// contract locked here is: a user never sees a literal `$file` — it resolves to
// the worked file's basename, or the plural "files" on stage-level cards.

describe('substituteFileInTitle', () => {
  it('replaces $file with the file basename (the reported bug)', () => {
    expect(substituteFileInTitle('Write tests for $file', 'src/components/Button.tsx')).toBe(
      'Write tests for Button.tsx',
    );
  });

  it('keeps a title without the token untouched', () => {
    expect(substituteFileInTitle('Consolidate report', 'src/a.ts')).toBe('Consolidate report');
  });

  it('collapses the token to "files" for stage-level cards (no single file)', () => {
    // A merge spans every per-file branch — there is no one real file.
    expect(substituteFileInTitle('merge: 3. Write tests for $file', null)).toBe(
      'merge: 3. Write tests for files',
    );
    expect(substituteFileInTitle('Audit $file', undefined)).toBe('Audit files');
    expect(substituteFileInTitle('Audit $file', '')).toBe('Audit files');
  });

  it('replaces every occurrence of the token', () => {
    expect(substituteFileInTitle('$file → tests for $file', 'pkg/util.ts')).toBe(
      'util.ts → tests for util.ts',
    );
  });

  it('uses the bare name when the path has no directory', () => {
    expect(substituteFileInTitle('Scan $file', 'README.md')).toBe('Scan README.md');
  });

  it('ignores trailing slashes and handles backslash paths', () => {
    expect(substituteFileInTitle('Scan $file', 'src/dir/')).toBe('Scan dir');
    expect(substituteFileInTitle('Scan $file', 'src\\win\\path.ts')).toBe('Scan path.ts');
  });
});
