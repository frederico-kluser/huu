import { describe, expect, it } from 'vitest';
import { classifyProviderError, type ProviderErrorKind } from './provider-error.js';

/**
 * Table-driven on REAL provider strings. The pi backend rethrows a plain
 * Error with only a message, so these strings are the entire signal — when a
 * provider rewords one, this table is what turns the drift into a red test
 * instead of a silently mis-rotated key.
 */
describe('classifyProviderError', () => {
  const CASES: Array<[string, ProviderErrorKind, string]> = [
    // ── rate limit (transient → cooldown) ──────────────────────────────
    ['429 Too Many Requests', 'rate_limit', 'openai-sdk formatted status + reason'],
    [
      'Provider returned error: 429 rate-limited upstream',
      'rate_limit',
      'openrouter provider passthrough',
    ],
    [
      'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day',
      'rate_limit',
      'openrouter free-tier limit',
    ],
    ['Error: Too Many Requests', 'rate_limit', 'bare reason phrase'],
    ['RateLimitError: rate limit reached for gpt-4o', 'rate_limit', 'sdk error class name'],

    // ── quota / billing (the ACCOUNT is out of money, the key is fine) ──
    ['402 Insufficient credits', 'quota', 'openrouter 402'],
    [
      'Insufficient credits. Add more using https://openrouter.ai/settings/credits',
      'quota',
      'openrouter 402 body',
    ],
    ['You exceeded your current quota, please check your plan and billing details', 'quota', 'openai quota'],

    // ── auth (the KEY is bad → burn, double-gated by the caller) ────────
    ['401 Unauthorized', 'auth', 'bare 401'],
    ['401 No auth credentials found', 'auth', 'openrouter 401 as the sdk formats it'],
    ['403 Forbidden', 'auth', 'bare 403'],
    ['Incorrect API key provided: sk-or-***. Invalid API key.', 'auth', 'invalid api key'],
    ['AuthenticationError: Unauthorized', 'auth', 'sdk error class name'],

    // ── other (no signal → behave exactly like today) ───────────────────
    ['fetch failed', 'other', 'undici network failure'],
    ['ETIMEDOUT', 'other', 'socket timeout'],
    ['500 Internal Server Error', 'other', 'provider blip, not the key'],
    ['No endpoints found for z-ai/glm-5.2', 'other', 'bad model id'],
    ['The operation was aborted', 'other', 'huu abort'],
    [
      'No auth credentials found',
      'other',
      'KNOWN LIMITATION: the 401 body alone carries no status code and no ' +
        '"unauthor" substring — it degrades to no-rotation (safe), never to a burn',
    ],
  ];

  for (const [message, expected, why] of CASES) {
    it(`${expected} ← ${JSON.stringify(message.slice(0, 60))} (${why})`, () => {
      expect(classifyProviderError(new Error(message))).toBe(expected);
      // Same verdict whether the value arrives as an Error or a bare string.
      expect(classifyProviderError(message)).toBe(expected);
    });
  }

  describe('precedence', () => {
    it('rate limit wins over everything else in the same message', () => {
      expect(classifyProviderError(new Error('429 rate limit: monthly quota exhausted'))).toBe(
        'rate_limit',
      );
    });

    it('quota wins over auth — burning a key over a BILLING problem is the expensive mistake', () => {
      // Some providers answer 403 for an out-of-credits account. The account
      // recovers with a top-up; a burned key does not (short of a reset).
      expect(classifyProviderError(new Error('403 Forbidden: insufficient credits'))).toBe('quota');
    });

    it('a plain 401 with no billing wording is still auth', () => {
      expect(classifyProviderError(new Error('401 unauthorized'))).toBe('auth');
    });
  });

  describe('non-Error inputs', () => {
    it('reads status/message fields off a plain object', () => {
      expect(classifyProviderError({ status: 429, message: 'slow down' })).toBe('rate_limit');
      expect(classifyProviderError({ statusCode: 401, error: 'nope' })).toBe('auth');
      expect(classifyProviderError({ message: 'boom' })).toBe('other');
    });

    it('degrades to "other" for null/undefined/empty', () => {
      expect(classifyProviderError(null)).toBe('other');
      expect(classifyProviderError(undefined)).toBe('other');
      expect(classifyProviderError('')).toBe('other');
      expect(classifyProviderError({})).toBe('other');
      expect(classifyProviderError([])).toBe('other');
    });

    it('does not match a status-like number embedded in an identifier', () => {
      // req_401abc / trace ids must not read as a 401.
      expect(classifyProviderError(new Error('request id req_401abc failed'))).toBe('other');
    });
  });
});
