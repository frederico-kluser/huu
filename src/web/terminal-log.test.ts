import { afterEach, describe, expect, it } from 'vitest';
import { formatTermLine, setTermLogWriter, termLog } from './terminal-log.js';

describe('terminal-log (serve-terminal mirror)', () => {
  afterEach(() => {
    setTermLogWriter(null); // restore the default (VITEST-silenced) writer
  });

  it('formats a plain (no-color) line with timestamp, icon, scope and message', () => {
    const when = new Date(2026, 6, 2, 9, 5, 3); // 09:05:03 local
    expect(formatTermLine('ok', 'my-proj', 'run r-1 finished', when, false)).toBe(
      '09:05:03 huu ✓ [my-proj] run r-1 finished',
    );
    expect(formatTermLine('error', 'keys', 'rejected', when, false)).toBe(
      '09:05:03 huu ✗ [keys] rejected',
    );
    expect(formatTermLine('warn', 'keys', 'ignored', when, false)).toContain('! [keys] ignored');
    expect(formatTermLine('info', 'web', 'hello', when, false)).toContain('· [web] hello');
  });

  it('wraps the line in ANSI codes when color is on', () => {
    const when = new Date(2026, 6, 2, 9, 5, 3);
    const line = formatTermLine('error', 'keys', 'rejected', when, true);
    expect(line).toContain('\x1b[31m'); // red body
    expect(line).toContain('\x1b[2m'); // dim timestamp
    expect(line).toContain('✗ [keys] rejected');
  });

  it('termLog routes through the swapped writer and never throws on a broken sink', () => {
    const lines: string[] = [];
    setTermLogWriter((l) => lines.push(l));
    termLog('info', 'web', 'hello');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[web] hello');

    setTermLogWriter(() => {
      throw new Error('boom');
    });
    expect(() => termLog('error', 'web', 'still fine')).not.toThrow();
  });
});
