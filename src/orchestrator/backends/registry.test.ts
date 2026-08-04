import { describe, it, expect } from 'vitest';
import {
  ALL_BACKENDS,
  parseBackendKind,
  selectBackend,
} from './registry.js';
import {
  PROVIDERS,
  providerToBackend,
  backendToProvider,
  parseProvider,
} from '../../lib/providers.js';
import { findSpec } from '../../lib/api-key-registry.js';

describe('backend registry', () => {
  describe('ALL_BACKENDS', () => {
    it('lists exactly jcode and stub (pi, azure, copilot removed)', () => {
      expect([...ALL_BACKENDS].sort()).toEqual(['jcode', 'stub']);
    });

    it('no longer contains pi, azure, or copilot', () => {
      expect([...ALL_BACKENDS]).not.toContain('pi');
      expect([...ALL_BACKENDS]).not.toContain('azure');
      expect([...ALL_BACKENDS]).not.toContain('copilot');
    });
  });

  describe('parseBackendKind', () => {
    it('accepts canonical names', () => {
      expect(parseBackendKind('jcode')).toBe('jcode');
      expect(parseBackendKind('stub')).toBe('stub');
    });

    it('accepts legacy aliases', () => {
      expect(parseBackendKind('deepseek')).toBe('jcode');
      expect(parseBackendKind('fake')).toBe('stub');
      expect(parseBackendKind('mock')).toBe('stub');
    });

    it('is case-insensitive and trims whitespace', () => {
      expect(parseBackendKind('  JCODE  ')).toBe('jcode');
      expect(parseBackendKind('Stub')).toBe('stub');
    });

    it('returns null for unknown values (including removed backends)', () => {
      expect(parseBackendKind('pi')).toBeNull();
      expect(parseBackendKind('real')).toBeNull();
      expect(parseBackendKind('openrouter')).toBeNull();
      expect(parseBackendKind('azure')).toBeNull();
      expect(parseBackendKind('azure-foundry')).toBeNull();
      expect(parseBackendKind('copilot')).toBeNull();
      expect(parseBackendKind('claude-code')).toBeNull();
      expect(parseBackendKind('')).toBeNull();
      expect(parseBackendKind('xyz')).toBeNull();
    });
  });

  describe('selectBackend', () => {
    it('jcode: requires API key, exposes resolver, points at deepseek spec', () => {
      const b = selectBackend('jcode');
      expect(b.requiresApiKey).toBe(true);
      expect(b.apiKeySpecName).toBe('deepseek');
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

    it('jcode: requires API key, exposes resolver, points at deepseek spec', () => {
      const b = selectBackend('jcode');
      expect(b.requiresApiKey).toBe(true);
      expect(b.apiKeySpecName).toBe('deepseek');
      expect(b.conflictResolverFactory).toBe(b.agentFactory);
    });

    it('every declared apiKeySpecName resolves to a REAL API_KEY_REGISTRY spec', () => {
      // Regression pin: jcode declared `apiKeySpecName: 'deepseek'` while the
      // registry had no such entry, so findSpec returned undefined and
      // docker-reexec (which iterates API_KEY_REGISTRY to build secret mounts
      // and the -e passthrough) never carried DEEPSEEK_API_KEY into the
      // container. A dangling name must fail here, not at run time.
      for (const kind of ALL_BACKENDS) {
        const b = selectBackend(kind);
        if (b.apiKeySpecName === undefined) {
          expect(b.requiresApiKey, `${kind} has no key spec`).toBe(false);
          continue;
        }
        expect(findSpec(b.apiKeySpecName), `${kind} → ${b.apiKeySpecName}`).toBeDefined();
      }
    });

    it('only jcode is user-selectable (stub via CLI)', () => {
      expect(selectBackend('jcode').userSelectable).toBe(true);
      expect(selectBackend('stub').userSelectable).toBe(false);
    });
  });

  describe('provider mapping', () => {
    it('exposes exactly the DeepSeek provider', () => {
      expect(PROVIDERS.map((p) => p.id).sort()).toEqual(['deepseek']);
    });

    it('maps the provider to its dispatch backend', () => {
      expect(providerToBackend('deepseek')).toBe('jcode');
    });

    it('maps each backend back to a provider (stub → deepseek)', () => {
      expect(backendToProvider('jcode')).toBe('deepseek');
      expect(backendToProvider('stub')).toBe('deepseek');
    });

    it('parses provider strings and aliases', () => {
      expect(parseProvider('deepseek')).toBe('deepseek');
      expect(parseProvider('ds')).toBe('deepseek');
      expect(parseProvider('nope')).toBeNull();
    });
  });
});
