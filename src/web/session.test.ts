import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebConnection } from './server.js';
import type { ClientMessage, ServerMessage } from './ws-protocol.js';
import { WebSession } from './session.js';

/**
 * In-memory `WebConnection` impl that lets tests push client messages
 * synchronously and read everything the session has sent back.
 */
function mockConn(): {
  conn: WebConnection;
  sent: ServerMessage[];
  simulate: (msg: ClientMessage) => void;
} {
  const sent: ServerMessage[] = [];
  let handler: ((msg: ClientMessage) => void) | null = null;
  const conn: WebConnection = {
    id: 'test-conn',
    send: (m) => {
      sent.push(m);
    },
    onMessage: (h) => {
      handler = h;
    },
    close: () => {},
  };
  return {
    conn,
    sent,
    simulate: (msg) => {
      if (!handler) throw new Error('no handler registered');
      handler(msg);
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('WebSession', () => {
  beforeEach(() => {
    // Prevent the real API-key resolver from picking up dev shells.
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY_FILE;
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.COPILOT_GITHUB_TOKEN_FILE;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits hello + screen(welcome) on construction', () => {
    const { conn, sent } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent[0]).toMatchObject({
      type: 'hello',
      protocolVersion: 1,
    });
    expect(sent[1]).toMatchObject({ type: 'screen' });
    expect((sent[1] as { type: 'screen'; screen: { kind: string } }).screen.kind).toBe('welcome');
    void session.dispose();
  });

  it('transitions to pipeline-editor on nav { welcome.new }', () => {
    const { conn, sent, simulate } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    const before = sent.length;
    simulate({ type: 'nav', event: { type: 'welcome.new' } });
    const after = sent.slice(before);
    const screen = after.find((m) => m.type === 'screen');
    expect(screen).toBeDefined();
    expect((screen as { type: 'screen'; screen: { kind: string } }).screen.kind).toBe(
      'pipeline-editor',
    );
    void session.dispose();
  });

  it('responds to pipeline.requestList with a pipelines message', () => {
    const { conn, sent, simulate } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    const before = sent.length;
    simulate({ type: 'pipeline.requestList' });
    const after = sent.slice(before);
    const lists = after.find((m) => m.type === 'pipelines');
    expect(lists).toBeDefined();
    const typed = lists as {
      type: 'pipelines';
      available: unknown[];
      saved: unknown[];
    };
    expect(Array.isArray(typed.available)).toBe(true);
    expect(Array.isArray(typed.saved)).toBe(true);
    void session.dispose();
  });

  it('emits error on pipeline.export (not implemented server-side)', () => {
    const { conn, sent, simulate } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    const before = sent.length;
    simulate({
      type: 'pipeline.export',
      pipeline: { name: 'p', steps: [{ name: 's', prompt: 'x', files: [] }] },
    });
    const after = sent.slice(before);
    const err = after.find((m) => m.type === 'error');
    expect(err).toBeDefined();
    expect((err as { type: 'error'; code?: string }).code).toBe('NOT_IMPLEMENTED');
    void session.dispose();
  });

  it('emits error when run.start is missing modelId/apiKey, no crash', () => {
    const { conn, sent, simulate } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    const before = sent.length;
    simulate({ type: 'run.start', modelId: '', apiKey: '' });
    const after = sent.slice(before);
    const err = after.find((m) => m.type === 'error');
    expect(err).toBeDefined();
    expect((err as { type: 'error'; code?: string }).code).toBe('BAD_REQUEST');
    void session.dispose();
  });

  it('emits error on a malformed pipeline.import without crashing', () => {
    const { conn, sent, simulate } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    const before = sent.length;
    simulate({ type: 'pipeline.import', json: 'this-is-not-json' });
    const after = sent.slice(before);
    const err = after.find((m) => m.type === 'error');
    expect(err).toBeDefined();
    // Subsequent messages still work — connection is alive.
    simulate({ type: 'pipeline.requestList' });
    const pipelines = sent
      .slice(after.length + before)
      .find((m) => m.type === 'pipelines');
    expect(pipelines).toBeDefined();
    void session.dispose();
  });

  it('ping is silent (no message emitted, no error)', () => {
    const { conn, sent, simulate } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    const before = sent.length;
    simulate({ type: 'ping' });
    expect(sent.length).toBe(before);
    void session.dispose();
  });

  it('dispose() is idempotent and does not throw', async () => {
    const { conn } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    await session.dispose();
    await session.dispose();
    await flushMicrotasks();
  });

  it('responds to model.requestCatalog with the protocol shape', () => {
    const { conn, sent, simulate } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    const before = sent.length;
    simulate({ type: 'model.requestCatalog', backend: 'pi' });
    const after = sent.slice(before);
    const models = after.find((m) => m.type === 'models');
    expect(models).toBeDefined();
    const typed = models as {
      type: 'models';
      backend: string;
      catalog: Array<{ id: string; label: string; provider: string }>;
    };
    expect(typed.backend).toBe('pi');
    expect(Array.isArray(typed.catalog)).toBe(true);
    void session.dispose();
  });

  it('backend.select dispatches FSM event and updates state', () => {
    const { conn, sent, simulate } = mockConn();
    const session = new WebSession(conn, { cwd: process.cwd() });
    // Move to a state where backend-selector is reachable.
    simulate({ type: 'nav', event: { type: 'welcome.new' } });
    // Now select a backend.
    const before = sent.length;
    simulate({ type: 'backend.select', backendKind: 'stub' });
    const after = sent.slice(before);
    // stub + no pipeline → FSM goes to model-selector
    const screen = after.find((m) => m.type === 'screen');
    expect(screen).toBeDefined();
    expect(session.getState().backendKind).toBe('stub');
    void session.dispose();
  });
});
