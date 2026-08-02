import type { AgentBackendKind } from './types.js';

/**
 * Thrown when a backend rejects the configured credentials (HTTP 401/403)
 * during the pre-run reachability probe or backend instantiation.
 *
 * Carries enough context for the TUI to jump the user straight to the
 * Options screen, pre-focused on the offending provider, so an invalid key
 * is fixable in place instead of forcing a manual env/file edit.
 */
export class AuthError extends Error {
  /** Discriminator so callers can detect this across module/realm boundaries. */
  readonly code = 'AUTH' as const;
  readonly backendKind: AgentBackendKind;
  /** `ApiKeySpec.name` of the credential that was rejected (e.g. 'openrouter'). */
  readonly specName?: string;

  constructor(opts: {
    message: string;
    backendKind: AgentBackendKind;
    specName?: string;
  }) {
    super(opts.message);
    this.name = 'AuthError';
    this.backendKind = opts.backendKind;
    this.specName = opts.specName;
  }
}

/** Realm-safe detection: instanceof OR the duck-typed `code` discriminator. */
export function isAuthError(err: unknown): err is AuthError {
  return (
    err instanceof AuthError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 'AUTH')
  );
}
