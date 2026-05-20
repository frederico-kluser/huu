import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventRecorder } from './event-recorder.js';

describe('createEventRecorder', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'huu-recorder-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the .huu directory if missing and returns a path', () => {
    const r = createEventRecorder({ rootDir: tmpDir, runId: 'r1', agentId: 1 });
    expect(r.path).toBe(join(tmpDir, '.huu', 'r1-copilot-events.jsonl'));
    expect(existsSync(join(tmpDir, '.huu'))).toBe(true);
    r.close();
  });

  it('writes one JSON object per line, newline-delimited', () => {
    const r = createEventRecorder({ rootDir: tmpDir, runId: 'r2', agentId: 7 });
    r.write({ type: 'assistant.message', data: { content: 'hello' } });
    r.write({ type: 'session.idle', data: {} });
    r.close();

    const lines = readFileSync(r.path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const ev1 = JSON.parse(lines[0]!);
    expect(ev1.type).toBe('assistant.message');
    expect(ev1.data.content).toBe('hello');
    expect(ev1._huu.agentId).toBe(7);
    expect(typeof ev1._huu.ts).toBe('string');
    const ev2 = JSON.parse(lines[1]!);
    expect(ev2.type).toBe('session.idle');
  });

  it('write is a no-op after close (idempotent dispose)', () => {
    const r = createEventRecorder({ rootDir: tmpDir, runId: 'r3', agentId: 1 });
    r.write({ type: 'a' });
    r.close();
    r.close(); // idempotent
    r.write({ type: 'b' }); // dropped silently
    const content = readFileSync(r.path, 'utf8').trim().split('\n');
    expect(content).toHaveLength(1);
  });

  it('handles non-object events by wrapping in _raw', () => {
    const r = createEventRecorder({ rootDir: tmpDir, runId: 'r4', agentId: 1 });
    r.write('a string');
    r.write(42);
    r.write(null);
    r.close();

    const lines = readFileSync(r.path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    const e1 = JSON.parse(lines[0]!);
    expect(e1._raw).toBe('a string');
    expect(e1._huu).toBeDefined();
    const e2 = JSON.parse(lines[1]!);
    expect(e2._raw).toBe(42);
  });

  it('truncates lines exceeding PIPE_BUF (~4KB)', () => {
    const r = createEventRecorder({ rootDir: tmpDir, runId: 'r5', agentId: 1 });
    const huge = 'x'.repeat(10_000);
    r.write({ type: 'assistant.message', data: { content: huge } });
    r.close();

    const line = readFileSync(r.path, 'utf8').trim();
    expect(line.length).toBeLessThanOrEqual(4 * 1024);
    const parsed = JSON.parse(line);
    expect(parsed._truncated).toBe(true);
    expect(parsed.type).toBe('assistant.message'); // envelope preserved
    expect(parsed._originalSize).toBeGreaterThan(10_000);
  });

  it('survives circular reference in event payload', () => {
    const r = createEventRecorder({ rootDir: tmpDir, runId: 'r6', agentId: 1 });
    const cyclic: Record<string, unknown> = { type: 'cyclic.event' };
    cyclic.self = cyclic;
    r.write(cyclic);
    r.close();

    const line = readFileSync(r.path, 'utf8').trim();
    const parsed = JSON.parse(line);
    // safeStringify catches the throw and writes a marker.
    expect(parsed._serialize_error).toContain('circular');
  });

  it('appends across multiple recorder instances (run-scoped file)', () => {
    // Two agents in the same run write to the SAME file (the runId
    // is the basename). O_APPEND ensures atomic interleaving.
    const a1 = createEventRecorder({ rootDir: tmpDir, runId: 'r7', agentId: 1 });
    const a2 = createEventRecorder({ rootDir: tmpDir, runId: 'r7', agentId: 2 });
    a1.write({ type: 'event_a' });
    a2.write({ type: 'event_b' });
    a1.close();
    a2.close();

    const lines = readFileSync(a1.path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const ids = new Set(lines.map((l) => JSON.parse(l)._huu.agentId));
    expect(ids).toEqual(new Set([1, 2]));
  });
});
