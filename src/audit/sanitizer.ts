import { createHash } from 'node:crypto';

// Patterns that indicate sensitive data
const SENSITIVE_KEYS = /^(api[_-]?key|token|password|secret|authorization|auth|credential|private[_-]?key|access[_-]?key|session[_-]?token|bearer|cookie)$/i;
const SENSITIVE_VALUE_PATTERNS = [
  /^(sk|pk|rk|ak)[-_][a-zA-Z0-9]{20,}/,    // API key prefixes
  /^Bearer\s+\S+/i,                          // Bearer tokens
  /^Basic\s+\S+/i,                           // Basic auth
  /^ghp_[a-zA-Z0-9]{36}/,                    // GitHub tokens
  /^xox[bpsa]-[a-zA-Z0-9-]+/,               // Slack tokens
];

const MAX_SUMMARY_LENGTH = 500;

/**
 * Sanitize parameters by redacting sensitive values.
 * Returns a JSON string safe for audit storage.
 */
export function sanitizeParams(params: unknown): string {
  if (params === null || params === undefined) return '{}';
  if (typeof params === 'string') {
    return JSON.stringify(redactString(params));
  }
  const sanitized = deepRedact(params);
  const json = JSON.stringify(sanitized);
  if (json.length > MAX_SUMMARY_LENGTH * 4) {
    return json.slice(0, MAX_SUMMARY_LENGTH * 4) + '...[truncated]';
  }
  return json;
}

/**
 * Compute SHA-256 hash of the raw params for deduplication/loop detection.
 */
export function hashParams(params: unknown): string {
  const raw = typeof params === 'string' ? params : JSON.stringify(params ?? '');
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Create a short textual summary of a result, truncated to MAX_SUMMARY_LENGTH.
 */
export function summarizeResult(result: unknown): string {
  let text: string;
  if (typeof result === 'string') {
    text = result;
  } else if (result === null || result === undefined) {
    return '';
  } else {
    text = JSON.stringify(result);
  }
  text = redactString(text);
  if (text.length > MAX_SUMMARY_LENGTH) {
    return text.slice(0, MAX_SUMMARY_LENGTH) + '...[truncated]';
  }
  return text;
}

/**
 * Compute the entry hash for a hash chain.
 * Hash = SHA-256(prev_hash + serialized_fields)
 */
export function computeEntryHash(
  prevHash: string | null,
  fields: Record<string, unknown>,
): string {
  const payload = (prevHash ?? '') + JSON.stringify(fields);
  return createHash('sha256').update(payload).digest('hex');
}

// ── Internal helpers ────────────────────────────────────────────────

function deepRedact(obj: unknown, depth = 0): unknown {
  if (depth > 10) return '[max-depth]';

  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactString(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => deepRedact(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = deepRedact(value, depth + 1);
      }
    }
    return result;
  }

  return String(obj);
}

function redactString(value: string): string {
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      return '[REDACTED]';
    }
  }
  return value;
}
