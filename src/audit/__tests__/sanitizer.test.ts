import { describe, it, expect } from 'vitest';
import { sanitizeParams, hashParams, summarizeResult, computeEntryHash } from '../sanitizer.js';

describe('sanitizer', () => {
  describe('sanitizeParams', () => {
    it('redacts sensitive keys', () => {
      const result = sanitizeParams({
        name: 'test',
        api_key: 'sk-abc123',
        password: 'secret',
        token: 'tok_xyz',
      });
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('test');
      expect(parsed.api_key).toBe('[REDACTED]');
      expect(parsed.password).toBe('[REDACTED]');
      expect(parsed.token).toBe('[REDACTED]');
    });

    it('redacts sensitive value patterns', () => {
      const result = sanitizeParams('sk-abcdefghijklmnopqrstuvwxyz');
      expect(JSON.parse(result)).toBe('[REDACTED]');
    });

    it('redacts Bearer tokens in values', () => {
      const result = sanitizeParams({ header: 'Bearer my-secret-token' });
      const parsed = JSON.parse(result);
      expect(parsed.header).toBe('[REDACTED]');
    });

    it('redacts GitHub tokens', () => {
      const result = sanitizeParams('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(JSON.parse(result)).toBe('[REDACTED]');
    });

    it('handles null/undefined', () => {
      expect(sanitizeParams(null)).toBe('{}');
      expect(sanitizeParams(undefined)).toBe('{}');
    });

    it('handles nested objects', () => {
      const result = sanitizeParams({
        config: {
          secret: 'hidden',
          name: 'visible',
        },
      });
      const parsed = JSON.parse(result);
      expect(parsed.config.secret).toBe('[REDACTED]');
      expect(parsed.config.name).toBe('visible');
    });

    it('truncates very long payloads', () => {
      const longValue = 'x'.repeat(10000);
      const result = sanitizeParams({ data: longValue });
      expect(result.length).toBeLessThan(10000);
      expect(result).toContain('[truncated]');
    });

    it('handles deeply nested objects', () => {
      let obj: Record<string, unknown> = { value: 'test' };
      for (let i = 0; i < 15; i++) {
        obj = { nested: obj };
      }
      const result = sanitizeParams(obj);
      expect(result).toContain('[max-depth]');
    });
  });

  describe('hashParams', () => {
    it('produces consistent hashes', () => {
      const hash1 = hashParams({ tool: 'bash', cmd: 'ls' });
      const hash2 = hashParams({ tool: 'bash', cmd: 'ls' });
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = hashParams({ cmd: 'ls' });
      const hash2 = hashParams({ cmd: 'pwd' });
      expect(hash1).not.toBe(hash2);
    });

    it('handles null', () => {
      const hash = hashParams(null);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64); // SHA-256 hex
    });
  });

  describe('summarizeResult', () => {
    it('truncates long results', () => {
      const long = 'a'.repeat(1000);
      const summary = summarizeResult(long);
      expect(summary.length).toBeLessThanOrEqual(515); // 500 + '[truncated]'
      expect(summary).toContain('[truncated]');
    });

    it('passes through short results', () => {
      expect(summarizeResult('ok')).toBe('ok');
    });

    it('handles null/undefined', () => {
      expect(summarizeResult(null)).toBe('');
      expect(summarizeResult(undefined)).toBe('');
    });

    it('redacts sensitive values in results', () => {
      const result = summarizeResult('Bearer my-secret-token-here');
      expect(result).toBe('[REDACTED]');
    });
  });

  describe('computeEntryHash', () => {
    it('produces consistent hashes', () => {
      const fields = { ts_ms: 123, event: 'test' };
      const h1 = computeEntryHash(null, fields);
      const h2 = computeEntryHash(null, fields);
      expect(h1).toBe(h2);
    });

    it('chains correctly with prev_hash', () => {
      const h1 = computeEntryHash(null, { ts_ms: 1 });
      const h2 = computeEntryHash(h1, { ts_ms: 2 });
      const h2alt = computeEntryHash(null, { ts_ms: 2 });
      expect(h2).not.toBe(h2alt); // prev_hash affects result
    });
  });
});
