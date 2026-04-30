import { describe, it, expect } from 'vitest';
import {
  WRITE_TOOLS,
  extractFileFromArgs,
  isWriteTool,
} from './write-tools.js';

describe('write-tools', () => {
  describe('WRITE_TOOLS set', () => {
    it('contains both Pi-style and Copilot-style names', () => {
      expect(WRITE_TOOLS.has('edit')).toBe(true);
      expect(WRITE_TOOLS.has('write')).toBe(true);
      expect(WRITE_TOOLS.has('edit_file')).toBe(true);
      expect(WRITE_TOOLS.has('str_replace')).toBe(true);
      expect(WRITE_TOOLS.has('apply_patch')).toBe(true);
    });

    it('does not contain read-only tools', () => {
      expect(WRITE_TOOLS.has('read')).toBe(false);
      expect(WRITE_TOOLS.has('view')).toBe(false);
      expect(WRITE_TOOLS.has('grep')).toBe(false);
      expect(WRITE_TOOLS.has('bash')).toBe(false);
    });
  });

  describe('extractFileFromArgs', () => {
    it('returns null for non-objects', () => {
      expect(extractFileFromArgs(null)).toBeNull();
      expect(extractFileFromArgs(undefined)).toBeNull();
      expect(extractFileFromArgs('foo')).toBeNull();
      expect(extractFileFromArgs(42)).toBeNull();
    });

    it('reads `path` (Anthropic-style)', () => {
      expect(extractFileFromArgs({ path: 'src/foo.ts' })).toBe('src/foo.ts');
    });

    it('reads `file_path` (snake_case)', () => {
      expect(extractFileFromArgs({ file_path: 'src/bar.ts' })).toBe('src/bar.ts');
    });

    it('reads `filePath` (camelCase)', () => {
      expect(extractFileFromArgs({ filePath: 'src/baz.ts' })).toBe('src/baz.ts');
    });

    it('returns null when no path-like field exists', () => {
      expect(extractFileFromArgs({ command: 'ls -la' })).toBeNull();
    });

    it('prefers `path` over alternatives when multiple are present', () => {
      expect(
        extractFileFromArgs({ path: 'a', file_path: 'b', filePath: 'c' }),
      ).toBe('a');
    });
  });

  describe('isWriteTool', () => {
    it('is case-insensitive', () => {
      expect(isWriteTool('Edit')).toBe(true);
      expect(isWriteTool('WRITE')).toBe(true);
      expect(isWriteTool('Edit_File')).toBe(true);
    });

    it('returns false for non-write tools', () => {
      expect(isWriteTool('read')).toBe(false);
      expect(isWriteTool('view')).toBe(false);
    });
  });
});
