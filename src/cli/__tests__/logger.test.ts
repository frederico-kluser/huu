import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, resolveVerbosity } from '../logger.js';

describe('Logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('notice level (default)', () => {
    it('should output info messages', () => {
      const log = new Logger('notice');
      log.info('test message');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]![0]).toContain('test message');
    });

    it('should output success messages', () => {
      const log = new Logger('notice');
      log.success('done');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]![0]).toContain('done');
    });

    it('should NOT output verbose messages', () => {
      const log = new Logger('notice');
      log.verbose('detail');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should NOT output debug messages', () => {
      const log = new Logger('notice');
      log.debug('debug detail');
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('quiet level', () => {
    it('should suppress info messages', () => {
      const log = new Logger('quiet');
      log.info('should not appear');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should still show errors', () => {
      const log = new Logger('quiet');
      log.error('critical');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]![0]).toContain('critical');
    });

    it('should still show warnings', () => {
      const log = new Logger('quiet');
      log.warn('careful');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('info level (-v)', () => {
    it('should output verbose messages', () => {
      const log = new Logger('info');
      log.verbose('extra detail');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]![0]).toContain('extra detail');
    });

    it('should NOT output debug messages', () => {
      const log = new Logger('info');
      log.debug('too deep');
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('debug level (-vv)', () => {
    it('should output debug messages', () => {
      const log = new Logger('debug');
      log.debug('deep debug');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]![0]).toContain('deep debug');
    });
  });

  describe('trace level (-vvv)', () => {
    it('should output trace messages', () => {
      const log = new Logger('trace');
      log.trace('full trace');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]![0]).toContain('full trace');
    });
  });

  describe('structured output', () => {
    it('should print header with dividers', () => {
      const log = new Logger('notice');
      log.header('Test Header');
      expect(logSpy).toHaveBeenCalledTimes(3);
      expect(logSpy.mock.calls[1]![0]).toContain('Test Header');
    });

    it('should print key-value pairs', () => {
      const log = new Logger('notice');
      log.keyValue('Key', 'Value');
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('Key');
      expect(output).toContain('Value');
    });

    it('should suppress structured output in quiet mode', () => {
      const log = new Logger('quiet');
      log.header('Header');
      log.keyValue('Key', 'Value');
      log.divider();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('runId formatting', () => {
    it('should include short runId in output', () => {
      const log = new Logger('notice');
      log.info('msg', 'abcdef12-3456-7890');
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('abcdef12');
    });
  });

  describe('getLevel / setLevel', () => {
    it('should get and set level', () => {
      const log = new Logger('notice');
      expect(log.getLevel()).toBe('notice');
      log.setLevel('debug');
      expect(log.getLevel()).toBe('debug');
    });
  });
});

describe('resolveVerbosity', () => {
  it('should return notice by default', () => {
    expect(resolveVerbosity({})).toBe('notice');
  });

  it('should return quiet for --quiet', () => {
    expect(resolveVerbosity({ quiet: true })).toBe('quiet');
  });

  it('should return info for -v', () => {
    expect(resolveVerbosity({ verbose: 1 })).toBe('info');
  });

  it('should return debug for -vv', () => {
    expect(resolveVerbosity({ verbose: 2 })).toBe('debug');
  });

  it('should return trace for -vvv', () => {
    expect(resolveVerbosity({ verbose: 3 })).toBe('trace');
  });

  it('should throw for conflicting flags', () => {
    expect(() => resolveVerbosity({ quiet: true, verbose: 1 })).toThrow(
      'cannot be used together',
    );
  });
});
