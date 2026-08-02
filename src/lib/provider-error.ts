/**
 * Classify an LLM-provider failure into the four kinds the key pool acts on.
 *
 * WHY STRING MATCHING. The pi backend rejects `prompt()` with a PLAIN `Error`
 * carrying only a message — no `status`, no `code`, no response object
 * (`src/orchestrator/backends/pi/factory.ts`: `onEvent({type:'error', message:
 * err.message}); throw err`). By the time the orchestrator's catch runs, the
 * HTTP status is gone. Matching the message is the only signal left.
 *
 * This is a HEURISTIC and is documented as one:
 *   - a false NEGATIVE degrades to today's behavior (no rotation) — safe;
 *   - a false POSITIVE on `auth` would BURN a good key — which is why the
 *     burn path is double-gated at the call site: only report `'auth'` after
 *     an independent probe (`checkOpenRouterReachable`) also says
 *     unauthorized. `rate_limit` needs no gate: a cooldown self-heals.
 *
 * The table test (`provider-error.test.ts`) pins real provider strings, so a
 * future wording change surfaces as a red test instead of silent misrouting.
 */

/** What a provider failure means for the key that produced it. */
export type ProviderErrorKind = 'rate_limit' | 'auth' | 'quota' | 'other';

/** 429 / "rate limit" / "too many requests" — transient, cooldown. */
const RATE_LIMIT_RE = /\b429\b|rate.?limit|too many requests/i;
/** 401 / 403 / "unauthorized" / "invalid api key" — the key itself is bad. */
const AUTH_RE = /\b401\b|\b403\b|unauthor|invalid api key/i;
/** 402 / "insufficient credits" / "quota" — the ACCOUNT is out of money. */
const QUOTA_RE = /\b402\b|insufficient credits|quota/i;

/**
 * Map an unknown thrown value to a {@link ProviderErrorKind}.
 *
 * Precedence: `rate_limit` → `quota` → `auth`. Quota is checked BEFORE auth
 * on purpose: a message that carries both a 4xx code and "insufficient
 * credits" is a BILLING problem, not a bad key, and burning the key there is
 * the expensive mistake (the account recovers; a burned key does not, short of
 * a manual reset). Non-overlapping messages classify identically under either
 * ordering — only the ambiguous ones move, and they move to the safe side.
 */
export function classifyProviderError(err: unknown): ProviderErrorKind {
  const message = errorMessage(err);
  if (!message) return 'other';
  if (RATE_LIMIT_RE.test(message)) return 'rate_limit';
  if (QUOTA_RE.test(message)) return 'quota';
  if (AUTH_RE.test(message)) return 'auth';
  return 'other';
}

/**
 * Best-effort message extraction. Providers surface failures as `Error`,
 * as a bare string, and occasionally as a plain object with a `message` /
 * `error` field (a JSON body that was rethrown as-is); all three are read.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.message} ${err.name}`.trim();
  if (typeof err === 'string') return err;
  if (typeof err === 'number') return String(err);
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    const parts: string[] = [];
    for (const field of ['message', 'error', 'statusText'] as const) {
      const v = rec[field];
      if (typeof v === 'string') parts.push(v);
    }
    for (const field of ['status', 'statusCode', 'code'] as const) {
      const v = rec[field];
      if (typeof v === 'number' || typeof v === 'string') parts.push(String(v));
    }
    return parts.join(' ').trim();
  }
  return '';
}
