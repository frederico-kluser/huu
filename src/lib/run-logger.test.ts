import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunLogger, RUN_LOG_DIR } from './run-logger.js';
import type {
  AgentStatus,
  IntegrationStatus,
  LogEntry,
  RunManifest,
} from './types.js';

function makeManifest(runId: string, startedAt: number): RunManifest {
  return {
    runId,
    baseBranch: 'main',
    baseCommit: 'abc1234',
    integrationBranch: `integration-${runId}`,
    integrationWorktreePath: '/tmp/integration',
    startedAt,
    finishedAt: startedAt + 5_000,
    status: 'done',
    agentEntries: [],
    totalStages: 1,
  };
}

function makeAgent(id: number, overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    agentId: id,
    state: 'done',
    phase: 'done',
    currentFile: null,
    logs: [],
    tokensIn: 100,
    tokensOut: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    filesModified: ['src/foo.ts'],
    branchName: `agent-${id}-abc`,
    commitSha: 'deadbeef',
    pushStatus: 'skipped',
    stageIndex: 0,
    stageName: 'stage1',
    ...overrides,
  };
}

const integration: IntegrationStatus = {
  phase: 'done',
  branchesMerged: ['agent-1-abc'],
  branchesPending: [],
  conflicts: [],
  finalCommitSha: 'cafef00d',
};

describe('RunLogger', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pa-runlog-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes a log file under .huu/ with the expected name pattern', () => {
    const startedAt = new Date('2026-04-27T10:30:45').getTime();
    const logger = new RunLogger({
      repoRoot: tmp,
      runId: 'abcd1234',
      pipelineName: 'demo-rapida',
      startedAt,
    });
    logger.append({ timestamp: startedAt + 100, agentId: -1, level: 'info', message: 'hello' });

    const path = logger.flush(makeManifest('abcd1234', startedAt), integration, [makeAgent(1)]);
    expect(path).not.toBeNull();

    const dir = join(tmp, RUN_LOG_DIR);
    const files = readdirSync(dir).sort();
    // The chronological `.log` plus a sibling per-agent directory of the same
    // base name. Both are produced by every successful flush.
    expect(files).toEqual([
      '2026-04-27_10-30-45-execution-abcd1234',
      '2026-04-27_10-30-45-execution-abcd1234.log',
    ]);
  });

  it('captures log entries and agent events in chronological order', () => {
    const startedAt = Date.now();
    const logger = new RunLogger({
      repoRoot: tmp,
      runId: 'run123',
      pipelineName: 'p',
      startedAt,
    });
    const entries: LogEntry[] = [
      { timestamp: startedAt + 10, agentId: -1, level: 'info', message: 'first orchestrator log' },
      { timestamp: startedAt + 30, agentId: 1, level: 'info', message: 'agent says hi' },
    ];
    for (const e of entries) logger.append(e);
    logger.appendEvent(1, { type: 'state_change', state: 'streaming' });
    logger.appendEvent(1, { type: 'file_write', file: 'src/x.ts' });

    const path = logger.flush(makeManifest('run123', startedAt), integration, [makeAgent(1)]);
    expect(path).not.toBeNull();
    const content = readFileSync(path!, 'utf8');
    expect(content).toContain('# Run ID:            run123');
    expect(content).toContain('first orchestrator log');
    expect(content).toContain('agent says hi');
    expect(content).toContain('wrote src/x.ts');
    expect(content).toContain('=== Per-Agent Summary ===');
    expect(content).toContain('agent-1');
    expect(content).toContain('=== Integration ===');
    expect(content).toContain('cafef00d');
  });

  it('does not duplicate log/error events when both append and appendEvent are called', () => {
    const logger = new RunLogger({
      repoRoot: tmp,
      runId: 'r',
      pipelineName: 'p',
      startedAt: Date.now(),
    });
    logger.append({ timestamp: Date.now(), agentId: 1, level: 'info', message: 'shared message' });
    // 'log' events are filtered out of appendEvent on purpose — the orchestrator
    // already routes them through log(). Calling appendEvent for a 'log' must be a no-op.
    logger.appendEvent(1, { type: 'log', level: 'info', message: 'shared message' });

    const path = logger.flush(makeManifest('r', Date.now()), integration, [makeAgent(1)]);
    const content = readFileSync(path!, 'utf8');
    const occurrences = content.split('shared message').length - 1;
    expect(occurrences).toBe(1);
  });

  it('writes per-agent files alongside the chronological log', () => {
    const startedAt = new Date('2026-04-27T10:30:45').getTime();
    const logger = new RunLogger({
      repoRoot: tmp,
      runId: 'splitrun',
      pipelineName: 'demo',
      startedAt,
    });
    // Mix of orchestrator (-1), integrator (9999), and two real agents.
    logger.append({ timestamp: startedAt + 5, agentId: -1, level: 'info', message: 'orchestrator boot' });
    logger.append({ timestamp: startedAt + 10, agentId: 1, level: 'info', message: 'agent 1 working' });
    logger.append({ timestamp: startedAt + 12, agentId: 2, level: 'warn', message: 'agent 2 retrying' });
    logger.append({ timestamp: startedAt + 14, agentId: 9999, level: 'info', message: 'integrator merging' });
    logger.appendEvent(1, { type: 'state_change', state: 'streaming' });
    logger.appendEvent(1, { type: 'file_write', file: 'src/x.ts' });
    logger.appendEvent(2, { type: 'file_write', file: 'src/y.ts' });

    const path = logger.flush(
      makeManifest('splitrun', startedAt),
      integration,
      [makeAgent(1), makeAgent(2, { stageName: 'stage2' })],
    );
    expect(path).not.toBeNull();

    const splitDir = join(
      tmp,
      RUN_LOG_DIR,
      '2026-04-27_10-30-45-execution-splitrun',
    );
    expect(statSync(splitDir).isDirectory()).toBe(true);

    const files = readdirSync(splitDir).sort();
    expect(files).toEqual(['agent-1.log', 'agent-2.log', 'integrator.log', 'orchestrator.log']);

    const a1 = readFileSync(join(splitDir, 'agent-1.log'), 'utf8');
    expect(a1).toContain('Per-Agent Log (agent-1)');
    expect(a1).toContain('agent 1 working');
    expect(a1).toContain('wrote src/x.ts');
    // Cross-actor isolation — agent 1's file must not leak agent 2 messages.
    expect(a1).not.toContain('agent 2 retrying');
    expect(a1).not.toContain('orchestrator boot');
    expect(a1).not.toContain('integrator merging');

    const orq = readFileSync(join(splitDir, 'orchestrator.log'), 'utf8');
    expect(orq).toContain('Per-Agent Log (orchestrator)');
    expect(orq).toContain('orchestrator boot');
    expect(orq).not.toContain('agent 1 working');

    const intg = readFileSync(join(splitDir, 'integrator.log'), 'utf8');
    expect(intg).toContain('Per-Agent Log (integrator)');
    expect(intg).toContain('integrator merging');
  });

  it('returns null when the target directory cannot be written', () => {
    const logger = new RunLogger({
      repoRoot: '/nonexistent/path/that/cannot/be/created/\0',
      runId: 'r',
      pipelineName: 'p',
      startedAt: Date.now(),
    });
    const path = logger.flush(makeManifest('r', Date.now()), integration, []);
    expect(path).toBeNull();
  });
});
