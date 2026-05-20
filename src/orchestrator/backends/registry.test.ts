import { describe, it, expect } from 'vitest';
import {
  ALL_BACKENDS,
  parseBackendKind,
  selectBackend,
} from './registry.js';

describe('backend registry', () => {
  describe('ALL_BACKENDS', () => {
    it('lists exactly pi, copilot, stub', () => {
      expect([...ALL_BACKENDS].sort()).toEqual(['copilot', 'pi', 'stub']);
    });
  });

  describe('parseBackendKind', () => {
    it('accepts canonical names', () => {
      expect(parseBackendKind('pi')).toBe('pi');
      expect(parseBackendKind('copilot')).toBe('copilot');
      expect(parseBackendKind('stub')).toBe('stub');
    });

    it('accepts legacy aliases', () => {
      expect(parseBackendKind('real')).toBe('pi');
      expect(parseBackendKind('openrouter')).toBe('pi');
      expect(parseBackendKind('gh-copilot')).toBe('copilot');
      expect(parseBackendKind('github-copilot')).toBe('copilot');
      expect(parseBackendKind('fake')).toBe('stub');
      expect(parseBackendKind('mock')).toBe('stub');
    });

    it('is case-insensitive and trims whitespace', () => {
      expect(parseBackendKind('  PI  ')).toBe('pi');
      expect(parseBackendKind('Copilot')).toBe('copilot');
    });

    it('returns null for unknown values', () => {
      expect(parseBackendKind('claude-code')).toBeNull();
      expect(parseBackendKind('')).toBeNull();
      expect(parseBackendKind('xyz')).toBeNull();
    });
  });

  describe('selectBackend', () => {
    it('pi: requires API key, exposes resolver, points at openrouter spec', () => {
      const b = selectBackend('pi');
      expect(b.requiresApiKey).toBe(true);
      expect(b.apiKeySpecName).toBe('openrouter');
      expect(b.conflictResolverFactory).toBe(b.agentFactory);
    });

    it('copilot: requires API key, exposes resolver, points at copilot spec', () => {
      const b = selectBackend('copilot');
      expect(b.requiresApiKey).toBe(true);
      expect(b.apiKeySpecName).toBe('copilot');
      expect(b.conflictResolverFactory).toBe(b.agentFactory);
    });

    it('stub: no API key, no conflict resolver', () => {
      const b = selectBackend('stub');
      expect(b.requiresApiKey).toBe(false);
      expect(b.apiKeySpecName).toBeUndefined();
      expect(b.conflictResolverFactory).toBeUndefined();
    });

    it('every backend exposes a label and description', () => {
      for (const kind of ALL_BACKENDS) {
        const b = selectBackend(kind);
        expect(b.label).toBeTruthy();
        expect(b.description).toBeTruthy();
      }
    });

    it('pi and copilot are user-selectable (visible in TUI selector)', () => {
      expect(selectBackend('pi').userSelectable).toBe(true);
      expect(selectBackend('copilot').userSelectable).toBe(true);
    });

    it('stub is NOT user-selectable (CLI-flag only — regression guard)', () => {
      // Stub is a developer/test tool surfaced via `huu --stub` /
      // `--backend=stub`. It MUST NOT appear in the BackendSelector
      // TUI screen — a stub run looks like a real run from the UI's
      // perspective but doesn't actually do anything, which is
      // confusing for end users.
      expect(selectBackend('stub').userSelectable).toBe(false);
    });
  });
});
