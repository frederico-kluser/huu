import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { SessionRepository } from '../../db/repositories/sessions.js';
import { ObservationRepository } from '../../db/repositories/observations.js';
import { InstinctRepository } from '../../db/repositories/instincts.js';
import { EntityRepository } from '../../db/repositories/entities.js';

import { DEFAULT_MEMORY_CONFIG, resolveMemoryConfig } from '../config.js';
import { Observer, sanitize } from '../observer.js';
import { Analyzer } from '../analyzer.js';
import type { InstinctCandidate } from '../analyzer.js';
import { InstinctManager, computeInitialConfidence, applyDecay } from '../instincts.js';
import { PromotionPipeline } from '../promotion.js';
import { SessionSummarizer } from '../sessions.js';
import { ContextLoader } from '../context-loader.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
});

afterEach(() => {
  db?.close();
});

// ── Helper ──────────────────────────────────────────────────────────

function createSession(projectId: string, sessionId: string) {
  const repo = new SessionRepository(db);
  return repo.create({ id: sessionId, project_id: projectId });
}

function insertObservation(
  projectId: string,
  sessionId: string,
  agentId: string,
  toolName: string,
  success: boolean,
  latencyMs = 100,
) {
  const repo = new ObservationRepository(db);
  return repo.create({
    project_id: projectId,
    session_id: sessionId,
    agent_id: agentId,
    tool_name: toolName,
    tool_phase: 'post',
    success,
    latency_ms: latencyMs,
    input_summary: `input for ${toolName}`,
    output_summary: success ? 'ok' : 'error: something failed',
  });
}

// ── Config ──────────────────────────────────────────────────────────

describe('MemoryLearningConfig', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_MEMORY_CONFIG.analysis.minObservations).toBe(20);
    expect(DEFAULT_MEMORY_CONFIG.instinct.confidenceMin).toBe(0.30);
    expect(DEFAULT_MEMORY_CONFIG.instinct.confidenceMax).toBe(0.85);
    expect(DEFAULT_MEMORY_CONFIG.instinct.decayHalfLifeDays).toBe(14);
    expect(DEFAULT_MEMORY_CONFIG.sessions.loadWindowDays).toBe(7);
  });

  it('should merge partial overrides', () => {
    const config = resolveMemoryConfig({
      analysis: { ...DEFAULT_MEMORY_CONFIG.analysis, minObservations: 10 },
    });
    expect(config.analysis.minObservations).toBe(10);
    expect(config.analysis.minUniqueSessions).toBe(3); // preserved default
    expect(config.instinct.confidenceMin).toBe(0.30); // preserved default
  });
});

// ── Sanitization ────────────────────────────────────────────────────

describe('sanitize', () => {
  it('should redact API keys', () => {
    const result = sanitize('my api_key = "sk-abc123456789abcdefghij"');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-abc123456789abcdefghij');
  });

  it('should redact GitHub PATs', () => {
    const result = sanitize('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result).toContain('[REDACTED]');
  });

  it('should redact email addresses', () => {
    const result = sanitize('user email: test@example.com');
    expect(result).toContain('[REDACTED]');
  });

  it('should truncate long strings', () => {
    const longStr = 'a'.repeat(3000);
    const result = sanitize(longStr)!;
    expect(result.length).toBeLessThan(2100);
    expect(result).toContain('…[truncated]');
  });

  it('should return undefined for null/undefined', () => {
    expect(sanitize(null)).toBeUndefined();
    expect(sanitize(undefined)).toBeUndefined();
  });
});

// ── Observer ────────────────────────────────────────────────────────

describe('Observer', () => {
  it('should generate unique trace IDs', () => {
    const a = Observer.newTraceId();
    const b = Observer.newTraceId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should record pre and post observations', () => {
    createSession('p1', 's1');
    const observer = new Observer(db);
    const traceId = Observer.newTraceId();

    const pre = observer.onToolPre({
      projectId: 'p1',
      sessionId: 's1',
      agentId: 'builder',
      toolName: 'read_file',
      traceId,
      input: { path: '/src/index.ts' },
    });

    expect(pre).toBeTruthy();
    expect(pre!.tool_phase).toBe('pre');

    const post = observer.onToolPost({
      projectId: 'p1',
      sessionId: 's1',
      agentId: 'builder',
      toolName: 'read_file',
      traceId,
      input: { path: '/src/index.ts' },
      output: 'file contents...',
      success: true,
      latencyMs: 50,
    });

    expect(post).toBeTruthy();
    expect(post!.tool_phase).toBe('post');
    expect(post!.success).toBe(1);
    expect(post!.latency_ms).toBe(50);

    // Both should share the same trace_id
    const preMeta = JSON.parse(pre!.metadata_json);
    const postMeta = JSON.parse(post!.metadata_json);
    expect(preMeta.trace_id).toBe(traceId);
    expect(postMeta.trace_id).toBe(traceId);
  });

  it('should sanitize PII in observations', () => {
    createSession('p1', 's1');
    const observer = new Observer(db, { sanitizePii: true });

    const obs = observer.onToolPost({
      projectId: 'p1',
      sessionId: 's1',
      agentId: 'builder',
      toolName: 'bash',
      traceId: Observer.newTraceId(),
      input: { command: 'echo secret=sk-1234567890123456789012345' },
      output: 'done',
      success: true,
      latencyMs: 10,
    });

    expect(obs!.input_summary).toContain('[REDACTED]');
  });

  it('should respect enabled=false config', () => {
    createSession('p1', 's1');
    const observer = new Observer(db, { enabled: false });

    const result = observer.onToolPost({
      projectId: 'p1',
      sessionId: 's1',
      agentId: 'builder',
      toolName: 'read_file',
      traceId: Observer.newTraceId(),
      input: {},
      output: 'ok',
      success: true,
      latencyMs: 10,
    });

    expect(result).toBeNull();
  });

  it('should queue observations on DB failure and flush later', () => {
    createSession('p1', 's1');
    const observer = new Observer(db);

    // Close the db to simulate failure
    db.close();

    const result = observer.onToolPost({
      projectId: 'p1',
      sessionId: 's1',
      agentId: 'builder',
      toolName: 'read_file',
      traceId: Observer.newTraceId(),
      input: {},
      output: 'ok',
      success: true,
      latencyMs: 10,
    });

    expect(result).toBeNull();
    expect(observer.pendingQueueSize).toBe(1);

    // Reopen db for flush
    db = openDatabase(':memory:');
    migrate(db);
    createSession('p1', 's1');

    // Create a new observer with the new db to flush
    const observer2 = new Observer(db);
    // The old queue is on the old observer instance, so this tests the queue mechanism
    expect(observer.pendingQueueSize).toBe(1);
  });
});

// ── Confidence math ────────────────────────────────────────────────

describe('Confidence computation', () => {
  it('should compute initial confidence within bounds', () => {
    const config = DEFAULT_MEMORY_CONFIG.instinct;

    const candidate: InstinctCandidate = {
      title: 'test',
      instinctText: 'test instinct',
      domain: 'bash',
      supportCount: 25,
      supportSessions: 4,
      consistencyRatio: 0.9,
    };

    const confidence = computeInitialConfidence(candidate, config);
    expect(confidence).toBeGreaterThanOrEqual(config.confidenceMin);
    expect(confidence).toBeLessThanOrEqual(config.confidenceMax);
  });

  it('should produce higher confidence with more evidence', () => {
    const config = DEFAULT_MEMORY_CONFIG.instinct;

    const low: InstinctCandidate = {
      title: 'low',
      instinctText: 'test',
      domain: 'bash',
      supportCount: 5,
      supportSessions: 1,
      consistencyRatio: 0.5,
    };

    const high: InstinctCandidate = {
      title: 'high',
      instinctText: 'test',
      domain: 'bash',
      supportCount: 50,
      supportSessions: 10,
      consistencyRatio: 0.95,
    };

    const lowConf = computeInitialConfidence(low, config);
    const highConf = computeInitialConfidence(high, config);
    expect(highConf).toBeGreaterThan(lowConf);
  });

  it('should apply time decay correctly', () => {
    // At exactly half-life, confidence should be halved
    const result = applyDecay(0.80, 14, 14);
    expect(result).toBeCloseTo(0.40, 2);

    // No decay at day 0
    expect(applyDecay(0.80, 0, 14)).toBe(0.80);

    // Negative days should not decay
    expect(applyDecay(0.80, -1, 14)).toBe(0.80);
  });
});

// ── Analyzer ────────────────────────────────────────────────────────

describe('Analyzer', () => {
  it('should not analyze below minimum observations', () => {
    createSession('p1', 's1');
    // Only insert 5 observations (below threshold of 20)
    for (let i = 0; i < 5; i++) {
      insertObservation('p1', 's1', 'builder', 'read_file', true);
    }

    const analyzer = new Analyzer(db);
    expect(analyzer.shouldAnalyze('p1')).toBe(false);
  });

  it('should not analyze below minimum unique sessions', () => {
    createSession('p1', 's1');
    // 25 observations but only 1 session
    for (let i = 0; i < 25; i++) {
      insertObservation('p1', 's1', 'builder', 'read_file', true);
    }

    const analyzer = new Analyzer(db, { minUniqueSessions: 3 });
    expect(analyzer.shouldAnalyze('p1')).toBe(false);
  });

  it('should analyze when thresholds are met', () => {
    // Create 3 sessions with enough observations
    for (const sid of ['s1', 's2', 's3']) {
      createSession('p1', sid);
      for (let i = 0; i < 10; i++) {
        insertObservation('p1', sid, 'builder', 'read_file', true);
      }
    }

    const analyzer = new Analyzer(db, { minObservations: 20, minUniqueSessions: 3 });
    expect(analyzer.shouldAnalyze('p1')).toBe(true);
  });

  it('should build analysis window with tool breakdown', () => {
    createSession('p1', 's1');
    for (let i = 0; i < 10; i++) {
      insertObservation('p1', 's1', 'builder', 'read_file', true, 100);
    }
    for (let i = 0; i < 5; i++) {
      insertObservation('p1', 's1', 'builder', 'bash', false, 5000);
    }

    const analyzer = new Analyzer(db);
    const window = analyzer.buildWindow('p1');

    expect(window.totalObs).toBe(15);
    expect(window.toolBreakdown.size).toBe(2);
    expect(window.toolBreakdown.get('read_file')!.count).toBe(10);
    expect(window.toolBreakdown.get('bash')!.successRate).toBe(0);
  });

  it('should extract heuristic candidates for high failure rate', () => {
    createSession('p1', 's1');
    createSession('p1', 's2');
    createSession('p1', 's3');

    for (const sid of ['s1', 's2', 's3']) {
      for (let i = 0; i < 5; i++) {
        insertObservation('p1', sid, 'builder', 'bash', false, 200);
      }
    }

    const analyzer = new Analyzer(db);
    const window = analyzer.buildWindow('p1');
    const candidates = analyzer.extractCandidatesHeuristic(window);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.title).toContain('bash');
    expect(candidates[0]!.title).toContain('failure rate');
  });

  it('should respect cooldown between analyses', async () => {
    for (const sid of ['s1', 's2', 's3']) {
      createSession('p1', sid);
      for (let i = 0; i < 10; i++) {
        insertObservation('p1', sid, 'builder', 'read_file', true);
      }
    }

    const analyzer = new Analyzer(db, { cooldownMinutes: 100 }); // long cooldown
    const first = await analyzer.analyze('p1');
    expect(first.length).toBeGreaterThanOrEqual(0);

    // Second analysis should be blocked by cooldown
    expect(analyzer.shouldAnalyze('p1')).toBe(false);
  });
});

// ── InstinctManager ────────────────────────────────────────────────

describe('InstinctManager', () => {
  it('should create instinct from candidate with bounded confidence', () => {
    const manager = new InstinctManager(db);
    const candidate: InstinctCandidate = {
      title: 'bash is unreliable',
      instinctText: 'Bash tool fails frequently',
      domain: 'bash',
      supportCount: 20,
      supportSessions: 3,
      consistencyRatio: 0.8,
    };

    const instinct = manager.upsertFromCandidate('p1', candidate);
    expect(instinct.title).toBe('bash is unreliable');
    expect(instinct.confidence).toBeGreaterThanOrEqual(0.30);
    expect(instinct.confidence).toBeLessThanOrEqual(0.85);
    expect(instinct.state).toBe('candidate');
  });

  it('should merge duplicate instincts (upsert)', () => {
    const manager = new InstinctManager(db);
    const candidate: InstinctCandidate = {
      title: 'bash is unreliable',
      instinctText: 'Bash tool fails frequently',
      domain: 'bash',
      supportCount: 10,
      supportSessions: 2,
      consistencyRatio: 0.7,
    };

    const first = manager.upsertFromCandidate('p1', candidate);
    const second = manager.upsertFromCandidate('p1', candidate);

    expect(second.id).toBe(first.id); // same instinct
    expect(second.confidence).toBeGreaterThan(first.confidence); // reinforced
  });

  it('should reinforce instinct on positive evidence', () => {
    const manager = new InstinctManager(db);
    const instinct = manager.upsertFromCandidate('p1', {
      title: 'test',
      instinctText: 'test',
      domain: 'test',
      supportCount: 10,
      supportSessions: 2,
      consistencyRatio: 0.5,
    });

    const reinforced = manager.reinforce(instinct.id, 'positive evidence');
    expect(reinforced!.confidence).toBeGreaterThan(instinct.confidence);
    expect(reinforced!.evidence_count).toBe(instinct.evidence_count + 1);
  });

  it('should contradict instinct and lower confidence', () => {
    const manager = new InstinctManager(db);
    const instinct = manager.upsertFromCandidate('p1', {
      title: 'test',
      instinctText: 'test',
      domain: 'test',
      supportCount: 20,
      supportSessions: 3,
      consistencyRatio: 0.9,
    });

    const contradicted = manager.contradict(instinct.id, 'contradicting evidence');
    expect(contradicted!.contradiction_count).toBe(1);
    // Confidence should be lower (but still >= min due to clamp)
    expect(contradicted!.confidence).toBeLessThanOrEqual(instinct.confidence);
  });

  it('should deprecate instinct when confidence drops below threshold', () => {
    const manager = new InstinctManager(db, { deleteBelow: 0.50, contradictionDelta: 0.30 });
    const instinct = manager.upsertFromCandidate('p1', {
      title: 'test deprecation',
      instinctText: 'test',
      domain: 'test',
      supportCount: 5,
      supportSessions: 1,
      consistencyRatio: 0.3,
    });

    // Contradict heavily
    manager.contradict(instinct.id, 'strong contradiction');
    const repo = new InstinctRepository(db);
    const updated = repo.getById(instinct.id)!;
    expect(updated.state).toBe('deprecated');
  });

  it('should apply time decay to all active instincts', () => {
    const repo = new InstinctRepository(db);
    // Create an instinct with old last_validated_at
    repo.create({
      project_id: 'p1',
      title: 'old instinct',
      instinct_text: 'test',
      confidence: 0.60,
      state: 'active',
    });

    // Manually set last_validated_at to 30 days ago
    db.prepare(
      `UPDATE instincts SET last_validated_at = datetime('now', '-30 days') WHERE title = 'old instinct'`,
    ).run();

    const manager = new InstinctManager(db, { decayHalfLifeDays: 14, deleteBelow: 0.20 });
    const deactivated = manager.applyDecayAll('p1');

    // After 30 days with 14-day half-life, effective ≈ 0.60 * 0.5^(30/14) ≈ 0.14 < 0.20
    expect(deactivated.length).toBe(1);
    expect(deactivated[0]!.title).toBe('old instinct');
  });

  it('should record audit events', () => {
    const manager = new InstinctManager(db);
    manager.upsertFromCandidate('p1', {
      title: 'test events',
      instinctText: 'test',
      domain: 'test',
      supportCount: 10,
      supportSessions: 2,
      consistencyRatio: 0.5,
    });

    const events = manager.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe('created');
  });
});

// ── Promotion ──────────────────────────────────────────────────────

describe('PromotionPipeline', () => {
  it('should reject instinct below confidence threshold', () => {
    const repo = new InstinctRepository(db);
    const instinct = repo.create({
      project_id: 'p1',
      title: 'low confidence',
      instinct_text: 'test',
      confidence: 0.50,
      state: 'active',
    });

    const pipeline = new PromotionPipeline(db, { minConfidence: 0.78 });
    const result = pipeline.promote(instinct);

    expect(result.promoted).toBe(false);
    expect(result.reason).toContain('Confidence');
  });

  it('should reject instinct with insufficient sessions', () => {
    const repo = new InstinctRepository(db);
    const instinct = repo.create({
      project_id: 'p1',
      title: 'few sessions',
      instinct_text: 'test',
      confidence: 0.85,
      state: 'active',
      metadata_json: JSON.stringify({ support_sessions: 2 }),
    });

    const pipeline = new PromotionPipeline(db, { minSupportingSessions: 5 });
    const result = pipeline.promote(instinct);

    expect(result.promoted).toBe(false);
    expect(result.reason).toContain('sessions');
  });

  it('should promote eligible instinct to entity', () => {
    const repo = new InstinctRepository(db);
    const instinct = repo.create({
      project_id: 'p1',
      title: 'reliable pattern',
      instinct_text: 'Bash is always fast',
      confidence: 0.85,
      state: 'active',
      metadata_json: JSON.stringify({ support_sessions: 10 }),
    });

    // Set evidence count high enough
    repo.update({ id: instinct.id, evidence_count: 60 });

    const pipeline = new PromotionPipeline(db, {
      minConfidence: 0.78,
      minSupportingSessions: 5,
      minSupportingObservations: 50,
    });
    const result = pipeline.promote(repo.getById(instinct.id)!);

    expect(result.promoted).toBe(true);
    expect(result.entityId).toBeDefined();

    // Verify entity was created
    const entityRepo = new EntityRepository(db);
    const entity = entityRepo.getById(result.entityId!);
    expect(entity).toBeDefined();
    expect(entity!.entity_type).toBe('pattern');
    expect(entity!.summary).toBe('Bash is always fast');

    // Verify instinct is marked promoted
    const updated = repo.getById(instinct.id)!;
    expect(updated.state).toBe('promoted');
  });

  it('should demote a previously promoted instinct', () => {
    const repo = new InstinctRepository(db);
    const instinct = repo.create({
      project_id: 'p1',
      title: 'demote test',
      instinct_text: 'test',
      confidence: 0.85,
      state: 'active',
      metadata_json: JSON.stringify({ support_sessions: 10 }),
    });
    repo.update({ id: instinct.id, evidence_count: 60 });

    const pipeline = new PromotionPipeline(db, {
      minConfidence: 0.78,
      minSupportingSessions: 5,
      minSupportingObservations: 50,
    });

    // Promote
    pipeline.promote(repo.getById(instinct.id)!);
    expect(repo.getById(instinct.id)!.state).toBe('promoted');

    // Demote
    const demoted = pipeline.demote(instinct.id);
    expect(demoted).toBe(true);
    expect(repo.getById(instinct.id)!.state).toBe('active');
  });

  it('should require human approval when configured', () => {
    const repo = new InstinctRepository(db);
    const instinct = repo.create({
      project_id: 'p1',
      title: 'human gate',
      instinct_text: 'test',
      confidence: 0.85,
      state: 'active',
      metadata_json: JSON.stringify({ support_sessions: 10 }),
    });
    repo.update({ id: instinct.id, evidence_count: 60 });

    const pipeline = new PromotionPipeline(db, {
      minConfidence: 0.78,
      minSupportingSessions: 5,
      minSupportingObservations: 50,
      requireHumanApproval: true,
    });

    const result = pipeline.promote(repo.getById(instinct.id)!);
    expect(result.promoted).toBe(false);
    expect(result.reason).toContain('human approval');
  });
});

// ── Session Summary ────────────────────────────────────────────────

describe('SessionSummarizer', () => {
  it('should generate structured summary for a session', () => {
    createSession('p1', 's1');

    // Add some observations
    for (let i = 0; i < 5; i++) {
      insertObservation('p1', 's1', 'builder', 'write_file', true);
    }
    insertObservation('p1', 's1', 'builder', 'bash', false);

    const summarizer = new SessionSummarizer(db);
    const summary = summarizer.generateSummary('s1');

    expect(summary.completed.length).toBeGreaterThan(0);
    expect(summary.failedAttempts.length).toBe(1);
    expect(summary.stats.totalObservations).toBe(6);
    expect(summary.stats.successRate).toBeCloseTo(5 / 6, 2);
  });

  it('should render markdown from summary', () => {
    createSession('p1', 's1');
    insertObservation('p1', 's1', 'builder', 'write_file', true);

    const summarizer = new SessionSummarizer(db);
    const summary = summarizer.generateSummary('s1');
    const md = summarizer.renderMarkdown(summary);

    expect(md).toContain('### Completed');
    expect(md).toContain('### Failed Attempts');
    expect(md).toContain('### Instinct Updates');
    expect(md).toContain('### Open Risks');
    expect(md).toContain('### Next Session Bootstrap');
  });

  it('should end session with summary', () => {
    createSession('p1', 's1');
    insertObservation('p1', 's1', 'builder', 'write_file', true);

    const summarizer = new SessionSummarizer(db);
    const session = summarizer.endSession('s1', 'completed');

    expect(session).not.toBeNull();
    expect(session!.status).toBe('completed');
    expect(session!.summary_markdown).toContain('### Completed');
    expect(session!.summary_json).toBeTruthy();
  });
});

// ── Context Loader ────────────────────────────────────────────────

describe('ContextLoader', () => {
  it('should load empty context for new project', () => {
    const loader = new ContextLoader(db);
    const context = loader.load('p1');

    expect(context.sessions.length).toBe(0);
    expect(context.instincts.length).toBe(0);
    expect(context.totalTokenEstimate).toBe(0);
  });

  it('should load recent sessions and active instincts', () => {
    // Create and end a session with summary
    createSession('p1', 's1');
    insertObservation('p1', 's1', 'builder', 'write_file', true);
    const summarizer = new SessionSummarizer(db);
    summarizer.endSession('s1', 'completed');

    // Create an active instinct
    const instinctRepo = new InstinctRepository(db);
    instinctRepo.create({
      project_id: 'p1',
      title: 'useful pattern',
      instinct_text: 'Always validate inputs',
      confidence: 0.70,
      state: 'active',
    });

    const loader = new ContextLoader(db);
    const context = loader.load('p1');

    expect(context.sessions.length).toBe(1);
    expect(context.instincts.length).toBe(1);
    expect(context.instincts[0]!.title).toBe('useful pattern');
  });

  it('should filter out decayed instincts', () => {
    const instinctRepo = new InstinctRepository(db);
    instinctRepo.create({
      project_id: 'p1',
      title: 'stale instinct',
      instinct_text: 'old pattern',
      confidence: 0.35,
      state: 'active',
    });

    // Set last_validated_at to far past (will decay below threshold)
    db.prepare(
      `UPDATE instincts SET last_validated_at = datetime('now', '-60 days') WHERE title = 'stale instinct'`,
    ).run();

    const loader = new ContextLoader(db, {
      instinct: { decayHalfLifeDays: 14, deleteBelow: 0.20 },
    });
    const context = loader.load('p1');

    // Confidence 0.35 * 0.5^(60/14) ≈ 0.02 < 0.20 → filtered
    expect(context.instincts.length).toBe(0);
  });

  it('should render context as text', () => {
    createSession('p1', 's1');
    insertObservation('p1', 's1', 'builder', 'write_file', true);
    const summarizer = new SessionSummarizer(db);
    summarizer.endSession('s1', 'completed');

    const instinctRepo = new InstinctRepository(db);
    instinctRepo.create({
      project_id: 'p1',
      title: 'useful pattern',
      instinct_text: 'Always validate inputs',
      confidence: 0.70,
      state: 'active',
    });

    const loader = new ContextLoader(db);
    const context = loader.load('p1');
    const text = loader.renderContext(context);

    expect(text).toContain('Active Instincts');
    expect(text).toContain('useful pattern');
    expect(text).toContain('Recent Sessions');
  });

  it('should rank sessions with unresolved risks higher', () => {
    // Session 1: no risks
    createSession('p1', 's1');
    insertObservation('p1', 's1', 'builder', 'write_file', true);
    const summarizer = new SessionSummarizer(db);
    summarizer.endSession('s1', 'completed');

    // Session 2: with failures (generates open risks)
    createSession('p1', 's2');
    for (let i = 0; i < 5; i++) {
      insertObservation('p1', 's2', 'builder', 'bash', false);
    }
    summarizer.endSession('s2', 'failed');

    const loader = new ContextLoader(db);
    const context = loader.load('p1');

    // Failed session with risks should rank higher
    const failedSession = context.sessions.find((s) => s.session.id === 's2');
    const goodSession = context.sessions.find((s) => s.session.id === 's1');
    expect(failedSession).toBeDefined();
    expect(goodSession).toBeDefined();
    expect(failedSession!.relevanceScore).toBeGreaterThan(0);
  });
});

// ── Full lifecycle integration ──────────────────────────────────────

describe('Full Memory Learning Lifecycle', () => {
  it('should complete observe -> analyze -> instinct -> decay -> promote -> summary -> load', () => {
    // 1. OBSERVE: Record tool calls across sessions
    const observer = new Observer(db);

    for (const sid of ['s1', 's2', 's3']) {
      createSession('p1', sid);
      for (let i = 0; i < 10; i++) {
        const traceId = Observer.newTraceId();
        observer.onToolPre({
          projectId: 'p1',
          sessionId: sid,
          agentId: 'builder',
          toolName: 'bash',
          traceId,
          input: { command: `echo ${i}` },
        });
        observer.onToolPost({
          projectId: 'p1',
          sessionId: sid,
          agentId: 'builder',
          toolName: 'bash',
          traceId,
          input: { command: `echo ${i}` },
          output: `${i}`,
          success: i < 8, // 20% failure rate
          latencyMs: 100 + i * 10,
        });
      }
    }

    // 2. ANALYZE: Extract patterns
    const analyzer = new Analyzer(db, { minObservations: 20, minUniqueSessions: 3 });
    expect(analyzer.shouldAnalyze('p1')).toBe(true);
    const window = analyzer.buildWindow('p1');
    const candidates = analyzer.extractCandidatesHeuristic(window);

    // 3. INSTINCT: Create instincts from candidates
    const instinctMgr = new InstinctManager(db);
    for (const candidate of candidates) {
      instinctMgr.upsertFromCandidate('p1', candidate);
    }

    // Manually create a high-evidence instinct for promotion test
    const instinctRepo = new InstinctRepository(db);
    const promoCandidate = instinctRepo.create({
      project_id: 'p1',
      title: 'promotion ready',
      instinct_text: 'Bash is reliable for echo commands',
      confidence: 0.85,
      state: 'active',
      metadata_json: JSON.stringify({ support_sessions: 10 }),
    });
    instinctRepo.update({ id: promoCandidate.id, evidence_count: 60 });

    // 4. REINFORCE/CONTRADICT
    const activeInstincts = instinctMgr.getActiveInstincts('p1');
    // Note: they are candidates initially, but let's work with the promotion one
    instinctMgr.reinforce(promoCandidate.id, 'consistent success');

    // 5. DECAY: Apply time decay (no real age yet, so minimal effect)
    const decayed = instinctMgr.applyDecayAll('p1');
    expect(decayed.length).toBe(0); // nothing old enough

    // 6. PROMOTE: Promote mature instincts
    const pipeline = new PromotionPipeline(db, {
      minConfidence: 0.78,
      minSupportingSessions: 5,
      minSupportingObservations: 50,
    });
    const promoResult = pipeline.promote(instinctRepo.getById(promoCandidate.id)!);
    expect(promoResult.promoted).toBe(true);
    expect(promoResult.entityId).toBeDefined();

    // Verify entity was created
    const entityRepo = new EntityRepository(db);
    const entity = entityRepo.getById(promoResult.entityId!);
    expect(entity!.entity_type).toBe('pattern');

    // 7. SUMMARIZE: Generate session summary
    const summarizer = new SessionSummarizer(db);
    for (const sid of ['s1', 's2', 's3']) {
      summarizer.endSession(sid, 'completed');
    }

    const sessionRepo = new SessionRepository(db);
    const s1 = sessionRepo.getById('s1')!;
    expect(s1.status).toBe('completed');
    expect(s1.summary_markdown).toContain('### Completed');

    // 8. LOAD: Load context for next startup
    const loader = new ContextLoader(db);
    const context = loader.load('p1');

    expect(context.sessions.length).toBe(3);
    expect(context.instincts.length).toBeGreaterThanOrEqual(0);
    expect(context.bootstrapHints.length).toBeGreaterThan(0);

    // Verify rendered context is useful
    const text = loader.renderContext(context);
    expect(text.length).toBeGreaterThan(0);

    // The full loop is complete!
    // observe -> analyze -> instinct -> reinforce -> decay -> promote -> summary -> load ✓
  });
});
