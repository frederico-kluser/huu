import { describe, it, expect } from 'vitest';
import { pickThinkingLevel } from './factory.js';

describe('pickThinkingLevel', () => {
  it('bumps a thinking model to the model max when maxThinking is requested', () => {
    expect(pickThinkingLevel('medium', true, 'xhigh')).toBe('xhigh');
    expect(pickThinkingLevel('medium', true, 'high')).toBe('high');
  });

  it('keeps the base level when maxThinking is not requested', () => {
    expect(pickThinkingLevel('medium', false, 'xhigh')).toBe('medium');
    expect(pickThinkingLevel('off', false, 'xhigh')).toBe('off');
  });

  it('leaves a non-thinking model off even when maxThinking is requested', () => {
    expect(pickThinkingLevel('off', true, 'xhigh')).toBe('off');
    expect(pickThinkingLevel('off', true, 'off')).toBe('off');
  });

  it('never downgrades below the base level', () => {
    // Model only supports up to 'low' but the base was 'medium' → stay 'medium'.
    expect(pickThinkingLevel('medium', true, 'low')).toBe('medium');
    // pi-ai not recognizing reasoning ('off') must not knock the resolver off.
    expect(pickThinkingLevel('medium', true, 'off')).toBe('medium');
  });

  it('is a no-op when the model max equals the base', () => {
    expect(pickThinkingLevel('medium', true, 'medium')).toBe('medium');
  });
});
