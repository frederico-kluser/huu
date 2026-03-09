import { describe, it, expect } from 'vitest';
import {
  CliError,
  ERROR_CODES,
  EXIT_CODES,
  formatCliError,
  formatError,
  getExitCode,
  errors,
} from '../errors.js';

describe('CliError', () => {
  it('should create an error with all fields', () => {
    const err = new CliError({
      code: ERROR_CODES.CONFIG_NOT_FOUND,
      message: 'Config not found',
      details: 'looked in .huu/',
      suggestion: 'Run huu init',
      exitCode: 1,
    });

    expect(err.code).toBe('HUU_CONFIG_NOT_FOUND');
    expect(err.message).toBe('Config not found');
    expect(err.details).toBe('looked in .huu/');
    expect(err.suggestion).toBe('Run huu init');
    expect(err.exitCode).toBe(1);
    expect(err.name).toBe('CliError');
  });

  it('should default exitCode to RUNTIME_FAILURE', () => {
    const err = new CliError({
      code: ERROR_CODES.UNKNOWN,
      message: 'something',
    });
    expect(err.exitCode).toBe(EXIT_CODES.RUNTIME_FAILURE);
  });

  it('should accept a cause', () => {
    const cause = new Error('root cause');
    const err = new CliError({
      code: ERROR_CODES.DB_OPEN_FAILED,
      message: 'db failed',
      cause,
    });
    expect(err.cause).toBe(cause);
  });
});

describe('formatCliError', () => {
  const err = new CliError({
    code: ERROR_CODES.CONFIG_NOT_FOUND,
    message: 'Config not found',
    details: 'path: .huu/config.json',
    suggestion: 'Run `huu init`',
  });

  it('should format with code and message in notice mode', () => {
    const output = formatCliError(err, 'notice');
    expect(output).toContain('HUU_CONFIG_NOT_FOUND');
    expect(output).toContain('Config not found');
    expect(output).toContain('Run `huu init`');
    // Should NOT include details in notice mode
    expect(output).not.toContain('path: .huu/config.json');
  });

  it('should suppress suggestion in quiet mode', () => {
    const output = formatCliError(err, 'quiet');
    expect(output).toContain('Config not found');
    expect(output).not.toContain('Run `huu init`');
  });

  it('should include details in info mode', () => {
    const output = formatCliError(err, 'info');
    expect(output).toContain('path: .huu/config.json');
  });

  it('should include stack in debug mode', () => {
    const output = formatCliError(err, 'debug');
    expect(output).toContain('CliError');
  });
});

describe('formatError', () => {
  it('should format a CliError', () => {
    const err = errors.notInitialized();
    const output = formatError(err);
    expect(output).toContain('HUU_NOT_INITIALIZED');
  });

  it('should format an unknown error', () => {
    const output = formatError(new Error('boom'));
    expect(output).toContain('boom');
    expect(output).toContain('HUU_UNKNOWN');
  });

  it('should format a string error', () => {
    const output = formatError('string error');
    expect(output).toContain('string error');
  });
});

describe('getExitCode', () => {
  it('should return exit code from CliError', () => {
    const err = errors.invalidOption('--bad', 'not valid');
    expect(getExitCode(err)).toBe(EXIT_CODES.USAGE_ERROR);
  });

  it('should return RUNTIME_FAILURE for unknown errors', () => {
    expect(getExitCode(new Error('boom'))).toBe(EXIT_CODES.RUNTIME_FAILURE);
  });
});

describe('error catalog', () => {
  it('configNotFound includes suggestion', () => {
    const err = errors.configNotFound('.huu/config.json');
    expect(err.code).toBe(ERROR_CODES.CONFIG_NOT_FOUND);
    expect(err.suggestion).toContain('huu init');
  });

  it('configInvalid includes field info', () => {
    const err = errors.configInvalid('logging.level', 'invalid value');
    expect(err.message).toContain('logging.level');
  });

  it('dbOpenFailed wraps cause', () => {
    const cause = new Error('ENOENT');
    const err = errors.dbOpenFailed('.huu/huu.db', cause);
    expect(err.cause).toBe(cause);
    expect(err.details).toContain('ENOENT');
  });

  it('dbWalUnavailable includes journal mode', () => {
    const err = errors.dbWalUnavailable('delete');
    expect(err.message).toContain('delete');
  });

  it('conflictingFlags includes both flag names', () => {
    const err = errors.conflictingFlags('--quiet', '--verbose');
    expect(err.message).toContain('--quiet');
    expect(err.message).toContain('--verbose');
    expect(err.exitCode).toBe(EXIT_CODES.USAGE_ERROR);
  });

  it('beatsheetInvalid includes error count', () => {
    const err = errors.beatsheetInvalid(['err1', 'err2']);
    expect(err.message).toContain('2 error(s)');
    expect(err.details).toContain('err1');
  });
});
