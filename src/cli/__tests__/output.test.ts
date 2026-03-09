import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  printInfo,
  printSuccess,
  printWarn,
  printError,
  printEvent,
  printStep,
  printHeader,
  printKeyValue,
  printDivider,
  colorizeStatus,
} from '../output.js';

describe('CLI output', () => {
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

  describe('printInfo', () => {
    it('should print info message', () => {
      printInfo('test message');
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('test message');
      expect(output).toContain('[i]');
    });

    it('should include runId when provided', () => {
      printInfo('test message', 'abcdef12-3456-7890');
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('abcdef12');
    });
  });

  describe('printSuccess', () => {
    it('should print success message', () => {
      printSuccess('done!');
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('done!');
      expect(output).toContain('[+]');
    });
  });

  describe('printWarn', () => {
    it('should print warning message', () => {
      printWarn('careful');
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('careful');
      expect(output).toContain('[!]');
    });
  });

  describe('printError', () => {
    it('should print error to stderr', () => {
      printError('something broke');
      const output = errorSpy.mock.calls[0]![0] as string;
      expect(output).toContain('something broke');
      expect(output).toContain('[x]');
    });
  });

  describe('printEvent', () => {
    it('should print event with type tag', () => {
      printEvent('merge', 'merging branch');
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('[merge]');
      expect(output).toContain('merging branch');
    });
  });

  describe('printStep', () => {
    it('should print step with dim marker', () => {
      printStep('step one');
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('step one');
      expect(output).toContain('[-]');
    });
  });

  describe('printHeader', () => {
    it('should print title with dividers', () => {
      printHeader('My Header');
      expect(logSpy).toHaveBeenCalledTimes(3);
      const title = logSpy.mock.calls[1]![0] as string;
      expect(title).toContain('My Header');
    });
  });

  describe('printKeyValue', () => {
    it('should print key-value pair', () => {
      printKeyValue('Status', 'running');
      const output = logSpy.mock.calls[0]![0] as string;
      expect(output).toContain('Status');
      expect(output).toContain('running');
    });
  });

  describe('printDivider', () => {
    it('should print a divider line', () => {
      printDivider();
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('colorizeStatus', () => {
    it('should return a string for each known status', () => {
      const statuses = [
        'idle', 'running', 'in_progress', 'spawning', 'context_ready',
        'merge_pending', 'queued', 'merged', 'completed',
        'failed', 'error', 'dead_letter',
        'conflict', 'escalated', 'aborted',
      ];
      for (const status of statuses) {
        const result = colorizeStatus(status);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('should return unknown status as-is', () => {
      const result = colorizeStatus('something_unknown');
      expect(result).toBe('something_unknown');
    });
  });
});
