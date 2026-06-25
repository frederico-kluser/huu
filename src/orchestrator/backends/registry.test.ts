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

describe('backend registry', () => {
  describe('ALL_BACKENDS', () => {
    it('lists exactly pi, azure, stub (copilot removed)', () => {
      expect([...ALL_BACKENDS].sort()).toEqual(['azure', 'pi', 'stub']);
    });

    it('no longer contains copilot', () => {
      expect([...ALL_BACKENDS]).not.toContain('copilot');
    });
  });

  describe('parseBackendKind', () => {
    it('accepts canonical names', () => {
      expect(parseBackendKind('pi')).toBe('pi');
      expect(parseBackendKind('azure')).toBe('azure');
      expect(parseBackendKind('stub')).toBe('stub');
    });

    it('accepts legacy aliases', () => {
      expect(parseBackendKind('real')).toBe('pi');
      expect(parseBackendKind('openrouter')).toBe('pi');
      expect(parseBackendKind('azure-foundry')).toBe('azure');
      expect(parseBackendKind('fake')).toBe('stub');
      expect(parseBackendKind('mock')).toBe('stub');
    });

    it('is case-insensitive and trims whitespace', () => {
      expect(parseBackendKind('  PI  ')).toBe('pi');
      expect(parseBackendKind('Azure')).toBe('azure');
    });

    it('returns null for unknown values (including the removed copilot)', () => {
      expect(parseBackendKind('copilot')).toBeNull();
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

    it('azure: requires API key, exposes resolver, points at azureApiKey spec', () => {
      const b = selectBackend('azure');
      expect(b.requiresApiKey).toBe(true);
      expect(b.apiKeySpecName).toBe('azureApiKey');
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

    it('only pi is user-selectable (azure reached via provider toggle, stub via CLI)', () => {
      expect(selectBackend('pi').userSelectable).toBe(true);
      expect(selectBackend('azure').userSelectable).toBe(false);
      expect(selectBackend('stub').userSelectable).toBe(false);
    });
  });

  describe('provider mapping', () => {
    it('exposes exactly the OpenRouter and Azure providers', () => {
      expect(PROVIDERS.map((p) => p.id).sort()).toEqual(['azure', 'openrouter']);
    });

    it('maps each provider to its dispatch backend', () => {
      expect(providerToBackend('openrouter')).toBe('pi');
      expect(providerToBackend('azure')).toBe('azure');
    });

    it('maps each backend back to a provider (stub → openrouter)', () => {
      expect(backendToProvider('pi')).toBe('openrouter');
      expect(backendToProvider('azure')).toBe('azure');
      expect(backendToProvider('stub')).toBe('openrouter');
    });

    it('parses provider strings and aliases', () => {
      expect(parseProvider('openrouter')).toBe('openrouter');
      expect(parseProvider('azure')).toBe('azure');
      expect(parseProvider('foundry')).toBe('azure');
      expect(parseProvider('nope')).toBeNull();
    });
  });
});
