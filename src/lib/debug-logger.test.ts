import { describe, expect, it } from 'vitest';
import { redactSecrets } from './debug-logger.js';

describe('redactSecrets', () => {
  it('redacts OpenRouter API keys', () => {
    const out = redactSecrets('Authorization: Bearer sk-or-v1-1234567890abcdef1234567890');
    expect(out).not.toContain('1234567890abcdef');
    expect(out).toContain('<redacted>');
  });

  it('redacts plain sk- keys', () => {
    const out = redactSecrets('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234');
    expect(out).toContain('<redacted>');
  });

  it('redacts GitHub PATs', () => {
    const out = redactSecrets('export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234');
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234');
    // Prefix "ghp_" is preserved so the operator can spot the leak source;
    // only the secret tail is replaced with the sentinel.
    expect(out).toMatch(/ghp_/);
    expect(out).toContain('<redacted>');
  });

  it('redacts Anthropic keys (sk-ant-)', () => {
    const out = redactSecrets('key sk-ant-1234567890abcdef1234567890');
    expect(out).not.toContain('1234567890abcdef');
  });

  it('preserves a small prefix so operator can spot WHICH provider leaked', () => {
    const out = redactSecrets('sk-or-v1-1234567890abcdef1234567890');
    // Should keep at least "sk-or" so reading the log tells the operator
    // the leak was OpenRouter and not OpenAI.
    expect(out.startsWith('sk-or-')).toBe(true);
  });

  it('is idempotent — running twice yields the same result', () => {
    const once = redactSecrets('Bearer sk-or-v1-aaaaaaaaaaaaaaaaaaaa');
    const twice = redactSecrets(once);
    expect(twice).toBe(once);
  });

  it('leaves non-secret text untouched', () => {
    const input = 'normal log line: agent-3 finished in 2.4s';
    expect(redactSecrets(input)).toBe(input);
  });

  it('does not over-match short non-secret strings', () => {
    // A short string starting with sk- but not key-shaped should not be touched.
    expect(redactSecrets('sk-foo')).toBe('sk-foo');
  });
});
