import { describe, it, expect } from 'vitest';
import { StreamLineBuffer } from './stream-line-buffer.js';

describe('StreamLineBuffer', () => {
  it('returns nothing until a newline arrives', () => {
    const b = new StreamLineBuffer();
    expect(b.push('hello')).toEqual([]);
    expect(b.push(' world')).toEqual([]);
    expect(b.push('\n')).toEqual(['hello world']);
  });

  it('coalesces deltas that do not align with line boundaries', () => {
    const b = new StreamLineBuffer();
    // A single delta carrying part of one line and the start of the next.
    expect(b.push('analy')).toEqual([]);
    expect(b.push('zing\nnext')).toEqual(['analyzing']);
    expect(b.push(' line\n')).toEqual(['next line']);
  });

  it('splits a multi-line delta into all complete lines, buffering the remainder', () => {
    const b = new StreamLineBuffer();
    expect(b.push('a\nb\nc')).toEqual(['a', 'b']);
    expect(b.flush()).toBe('c');
  });

  it('emits blank lines as empty strings (caller decides to skip them)', () => {
    const b = new StreamLineBuffer();
    expect(b.push('\n\n')).toEqual(['', '']);
  });

  it('strips a trailing CR so CRLF output leaves no stray carriage return', () => {
    const b = new StreamLineBuffer();
    expect(b.push('windows\r\nline\r\n')).toEqual(['windows', 'line']);
  });

  it('flush() returns the buffered partial line then empties', () => {
    const b = new StreamLineBuffer();
    b.push('trailing without newline');
    expect(b.flush()).toBe('trailing without newline');
    expect(b.flush()).toBeNull();
  });

  it('flush() returns null when nothing is buffered', () => {
    const b = new StreamLineBuffer();
    expect(b.flush()).toBeNull();
    b.push('done\n');
    expect(b.flush()).toBeNull();
  });

  it('force-flushes an un-terminated line past maxLineBytes so it cannot buffer unboundedly', () => {
    const b = new StreamLineBuffer(8);
    const out = b.push('0123456789'); // 10 chars, no newline, over the 8-byte cap
    expect(out).toEqual(['0123456789']);
    expect(b.flush()).toBeNull();
  });
});
