// Standardized error system with actionable suggestions
import pc from 'picocolors';

// ── Error codes ──────────────────────────────────────────────────────

export const ERROR_CODES = {
  CONFIG_NOT_FOUND: 'HUU_CONFIG_NOT_FOUND',
  CONFIG_INVALID: 'HUU_CONFIG_INVALID',
  CONFIG_WRITE_FAILED: 'HUU_CONFIG_WRITE_FAILED',
  DB_OPEN_FAILED: 'HUU_DB_OPEN_FAILED',
  DB_WAL_UNAVAILABLE: 'HUU_DB_WAL_UNAVAILABLE',
  DB_MIGRATION_FAILED: 'HUU_DB_MIGRATION_FAILED',
  INIT_DIR_NOT_WRITABLE: 'HUU_INIT_DIR_NOT_WRITABLE',
  INIT_ALREADY_EXISTS: 'HUU_INIT_ALREADY_EXISTS',
  INVALID_OPTION: 'HUU_INVALID_OPTION',
  NOT_INITIALIZED: 'HUU_NOT_INITIALIZED',
  BEATSHEET_INVALID: 'HUU_BEATSHEET_INVALID',
  CONFLICTING_FLAGS: 'HUU_CONFLICTING_FLAGS',
  UNKNOWN: 'HUU_UNKNOWN',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ── Exit codes ───────────────────────────────────────────────────────

export const EXIT_CODES = {
  SUCCESS: 0,
  RUNTIME_FAILURE: 1,
  USAGE_ERROR: 2,
  USER_CANCELLED: 130,
} as const;

// ── CliError class ───────────────────────────────────────────────────

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly details: string | undefined;
  readonly suggestion: string | undefined;
  readonly exitCode: number;

  constructor(options: {
    code: ErrorCode;
    message: string;
    details?: string | undefined;
    suggestion?: string | undefined;
    exitCode?: number | undefined;
    cause?: Error | undefined;
  }) {
    super(options.message);
    this.name = 'CliError';
    this.code = options.code;
    this.details = options.details;
    this.suggestion = options.suggestion;
    this.exitCode = options.exitCode ?? EXIT_CODES.RUNTIME_FAILURE;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

// ── Error formatting ─────────────────────────────────────────────────

export type VerbosityLevel = 'quiet' | 'notice' | 'info' | 'debug' | 'trace';

export function formatCliError(
  error: CliError,
  verbosity: VerbosityLevel = 'notice',
): string {
  const lines: string[] = [];

  // Always show the error line
  lines.push(
    `${pc.red('Error')} ${pc.dim(`[${error.code}]`)}: ${error.message}`,
  );

  // Show suggestion unless quiet
  if (verbosity !== 'quiet' && error.suggestion) {
    lines.push(`${pc.yellow('Suggestion')}: ${error.suggestion}`);
  }

  // Show details in verbose modes
  if (
    (verbosity === 'info' || verbosity === 'debug' || verbosity === 'trace') &&
    error.details
  ) {
    lines.push(`${pc.dim('Details')}: ${error.details}`);
  }

  // Show stack in debug/trace
  if ((verbosity === 'debug' || verbosity === 'trace') && error.stack) {
    lines.push(pc.dim(error.stack));
  }

  // Show cause in trace
  if (verbosity === 'trace' && error.cause instanceof Error) {
    lines.push(pc.dim(`Caused by: ${error.cause.message}`));
    if (error.cause.stack) {
      lines.push(pc.dim(error.cause.stack));
    }
  }

  return lines.join('\n');
}

/**
 * Format any error (CliError or unknown) for CLI output.
 */
export function formatError(
  err: unknown,
  verbosity: VerbosityLevel = 'notice',
): string {
  if (err instanceof CliError) {
    return formatCliError(err, verbosity);
  }

  const message = err instanceof Error ? err.message : String(err);
  const cliErr = new CliError({
    code: ERROR_CODES.UNKNOWN,
    message,
    cause: err instanceof Error ? err : undefined,
  });
  return formatCliError(cliErr, verbosity);
}

/**
 * Get the exit code for an error.
 */
export function getExitCode(err: unknown): number {
  if (err instanceof CliError) {
    return err.exitCode;
  }
  return EXIT_CODES.RUNTIME_FAILURE;
}

// ── Error catalog (factory functions) ────────────────────────────────

export const errors = {
  configNotFound(configPath: string): CliError {
    return new CliError({
      code: ERROR_CODES.CONFIG_NOT_FOUND,
      message: `Configuration file not found at ${configPath}`,
      suggestion: 'Run `huu init` to create the default runtime files.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
    });
  },

  configInvalid(field: string, reason: string): CliError {
    return new CliError({
      code: ERROR_CODES.CONFIG_INVALID,
      message: `Invalid configuration: ${field} — ${reason}`,
      suggestion:
        'Run `huu config` to fix the configuration interactively, or edit .huu/config.json manually.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
    });
  },

  configWriteFailed(cause: Error): CliError {
    return new CliError({
      code: ERROR_CODES.CONFIG_WRITE_FAILED,
      message: 'Failed to write configuration file.',
      details: cause.message,
      suggestion:
        'Check file permissions on .huu/config.json and ensure disk space is available.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
      cause,
    });
  },

  dbOpenFailed(dbPath: string, cause: Error): CliError {
    return new CliError({
      code: ERROR_CODES.DB_OPEN_FAILED,
      message: `Failed to open database at ${dbPath}`,
      details: cause.message,
      suggestion:
        'Ensure the .huu/ directory exists and is writable. Run `huu init` if needed.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
      cause,
    });
  },

  dbWalUnavailable(journalMode: string): CliError {
    return new CliError({
      code: ERROR_CODES.DB_WAL_UNAVAILABLE,
      message: `WAL mode is required but journal_mode is "${journalMode}"`,
      suggestion:
        'Ensure the filesystem supports WAL mode (not a network filesystem). Delete .huu/huu.db and run `huu init` again.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
    });
  },

  dbMigrationFailed(cause: Error): CliError {
    return new CliError({
      code: ERROR_CODES.DB_MIGRATION_FAILED,
      message: 'Database migration failed.',
      details: cause.message,
      suggestion:
        'If migrations were tampered with, restore original migration files. For a fresh start, delete .huu/huu.db and run `huu init`.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
      cause,
    });
  },

  initDirNotWritable(dir: string): CliError {
    return new CliError({
      code: ERROR_CODES.INIT_DIR_NOT_WRITABLE,
      message: `Directory is not writable: ${dir}`,
      suggestion:
        'Check file permissions or run the command from a directory where you have write access.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
    });
  },

  notInitialized(): CliError {
    return new CliError({
      code: ERROR_CODES.NOT_INITIALIZED,
      message: 'HUU is not initialized in this directory.',
      suggestion: 'Run `huu init` to initialize HUU in this project.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
    });
  },

  invalidOption(option: string, reason: string): CliError {
    return new CliError({
      code: ERROR_CODES.INVALID_OPTION,
      message: `Invalid option "${option}": ${reason}`,
      suggestion: 'Run the command with --help for usage information.',
      exitCode: EXIT_CODES.USAGE_ERROR,
    });
  },

  conflictingFlags(flag1: string, flag2: string): CliError {
    return new CliError({
      code: ERROR_CODES.CONFLICTING_FLAGS,
      message: `Flags ${flag1} and ${flag2} cannot be used together.`,
      suggestion: `Use either ${flag1} or ${flag2}, not both.`,
      exitCode: EXIT_CODES.USAGE_ERROR,
    });
  },

  beatsheetInvalid(validationErrors: string[]): CliError {
    return new CliError({
      code: ERROR_CODES.BEATSHEET_INVALID,
      message: `Beat sheet validation failed with ${validationErrors.length} error(s).`,
      details: validationErrors.join('\n'),
      suggestion:
        'Check the beat sheet structure and fix the reported validation errors.',
      exitCode: EXIT_CODES.RUNTIME_FAILURE,
    });
  },
} as const;
