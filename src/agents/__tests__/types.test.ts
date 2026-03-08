import { describe, it, expect } from 'vitest';
import {
  validateAgentDefinition,
  effectiveTools,
  resolveModelId,
  AgentDefinitionError,
} from '../types.js';
import type { AgentDefinition } from '../types.js';

function validDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'builder',
    role: 'builder',
    description: 'Builds features',
    model: 'sonnet',
    tools: ['read_file', 'write_file', 'bash'],
    systemPrompt: 'You are a builder agent.',
    ...overrides,
  };
}

describe('validateAgentDefinition', () => {
  it('accepts a valid definition', () => {
    expect(() => validateAgentDefinition(validDef())).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() => validateAgentDefinition(validDef({ name: '' }))).toThrow(
      AgentDefinitionError,
    );
    expect(() => validateAgentDefinition(validDef({ name: '  ' }))).toThrow(
      AgentDefinitionError,
    );
  });

  it('rejects empty role', () => {
    expect(() => validateAgentDefinition(validDef({ role: '' }))).toThrow(
      AgentDefinitionError,
    );
  });

  it('rejects empty systemPrompt', () => {
    expect(() =>
      validateAgentDefinition(validDef({ systemPrompt: '' })),
    ).toThrow(AgentDefinitionError);
  });

  it('rejects invalid model', () => {
    expect(() =>
      validateAgentDefinition(validDef({ model: 'gpt-4' as never })),
    ).toThrow(AgentDefinitionError);
  });

  it('rejects duplicate tools', () => {
    expect(() =>
      validateAgentDefinition(
        validDef({ tools: ['read_file', 'read_file'] }),
      ),
    ).toThrow(AgentDefinitionError);
  });

  it('rejects duplicate disallowedTools', () => {
    expect(() =>
      validateAgentDefinition(
        validDef({ disallowedTools: ['bash', 'bash'] }),
      ),
    ).toThrow(AgentDefinitionError);
  });

  it('rejects maxTurns <= 0', () => {
    expect(() =>
      validateAgentDefinition(validDef({ maxTurns: 0 })),
    ).toThrow(AgentDefinitionError);
    expect(() =>
      validateAgentDefinition(validDef({ maxTurns: -1 })),
    ).toThrow(AgentDefinitionError);
  });

  it('accepts valid maxTurns', () => {
    expect(() =>
      validateAgentDefinition(validDef({ maxTurns: 10 })),
    ).not.toThrow();
  });

  it('error includes field name', () => {
    try {
      validateAgentDefinition(validDef({ name: '' }));
    } catch (err) {
      expect(err).toBeInstanceOf(AgentDefinitionError);
      expect((err as AgentDefinitionError).field).toBe('name');
    }
  });
});

describe('effectiveTools', () => {
  it('returns all tools when no disallowedTools', () => {
    const def = validDef();
    expect(effectiveTools(def)).toEqual(['read_file', 'write_file', 'bash']);
  });

  it('returns all tools when disallowedTools is empty', () => {
    const def = validDef({ disallowedTools: [] });
    expect(effectiveTools(def)).toEqual(['read_file', 'write_file', 'bash']);
  });

  it('removes disallowed tools', () => {
    const def = validDef({ disallowedTools: ['bash'] });
    expect(effectiveTools(def)).toEqual(['read_file', 'write_file']);
  });

  it('disallowed tool not in allowed list has no effect', () => {
    const def = validDef({ disallowedTools: ['nonexistent'] });
    expect(effectiveTools(def)).toEqual(['read_file', 'write_file', 'bash']);
  });

  it('all tools disallowed returns empty', () => {
    const def = validDef({
      disallowedTools: ['read_file', 'write_file', 'bash'],
    });
    expect(effectiveTools(def)).toEqual([]);
  });
});

describe('resolveModelId', () => {
  it('maps opus to claude-opus model', () => {
    expect(resolveModelId('opus')).toContain('opus');
  });

  it('maps sonnet to claude-sonnet model', () => {
    expect(resolveModelId('sonnet')).toContain('sonnet');
  });

  it('maps haiku to claude-haiku model', () => {
    expect(resolveModelId('haiku')).toContain('haiku');
  });

  it('maps inherit to sonnet (default)', () => {
    expect(resolveModelId('inherit')).toBe(resolveModelId('sonnet'));
  });
});
