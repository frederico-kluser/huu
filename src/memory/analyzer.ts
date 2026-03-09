// Memory & Learning — Pattern detection and analysis
//
// Periodic analyzer that turns raw observations into candidate behavioral patterns.
// Gates by minObservations AND minUniqueSessions to avoid single-session overfit.
// Calls Haiku for candidate instinct extraction in strict JSON schema.

import type Database from 'better-sqlite3';
import type { Observation } from '../types/index.js';
import type { AnalysisConfig } from './config.js';
import { DEFAULT_MEMORY_CONFIG } from './config.js';

// ── Analysis window ──────────────────────────────────────────────────

export interface AnalysisWindow {
  projectId: string;
  totalObs: number;
  uniqueSessions: number;
  observations: Observation[];
  toolBreakdown: Map<string, ToolStats>;
  lastAnalyzedAt: string | null;
}

export interface ToolStats {
  toolName: string;
  count: number;
  successRate: number;
  avgLatencyMs: number;
  sessionIds: Set<string>;
}

export interface InstinctCandidate {
  title: string;
  instinctText: string;
  domain: string;
  supportCount: number;
  supportSessions: number;
  consistencyRatio: number;
}

// ── Analyzer class ───────────────────────────────────────────────────

export class Analyzer {
  private readonly db: Database.Database;
  private readonly config: AnalysisConfig;
  private lastAnalysisTime: number = 0;

  constructor(db: Database.Database, config?: Partial<AnalysisConfig>) {
    this.config = { ...DEFAULT_MEMORY_CONFIG.analysis, ...config };
    this.db = db;
  }

  /** Check if analysis should run (cooldown + evidence gates). */
  shouldAnalyze(projectId: string): boolean {
    const now = Date.now();
    if (now - this.lastAnalysisTime < this.config.cooldownMinutes * 60_000) {
      return false;
    }

    const window = this.buildWindow(projectId);
    if (window.totalObs < this.config.minObservations) return false;
    if (window.uniqueSessions < this.config.minUniqueSessions) return false;

    return true;
  }

  /** Build an analysis window from recent observations. */
  buildWindow(projectId: string): AnalysisWindow {
    const rows = this.db
      .prepare(
        `SELECT * FROM observations
         WHERE project_id = ? AND tool_phase = 'post'
         ORDER BY occurred_at DESC`,
      )
      .all(projectId) as Observation[];

    const sessionIds = new Set<string>();
    const toolMap = new Map<string, ToolStats>();

    for (const obs of rows) {
      sessionIds.add(obs.session_id);

      let stats = toolMap.get(obs.tool_name);
      if (!stats) {
        stats = {
          toolName: obs.tool_name,
          count: 0,
          successRate: 0,
          avgLatencyMs: 0,
          sessionIds: new Set(),
        };
        toolMap.set(obs.tool_name, stats);
      }

      stats.count++;
      stats.sessionIds.add(obs.session_id);
      if (obs.latency_ms != null) {
        stats.avgLatencyMs =
          (stats.avgLatencyMs * (stats.count - 1) + obs.latency_ms) / stats.count;
      }
    }

    // Compute success rates
    for (const stats of toolMap.values()) {
      const toolObs = rows.filter((o) => o.tool_name === stats.toolName);
      const successes = toolObs.filter((o) => o.success === 1).length;
      stats.successRate = toolObs.length > 0 ? successes / toolObs.length : 0;
    }

    // Get last analysis timestamp
    const lastRow = this.db
      .prepare(
        `SELECT MAX(last_validated_at) as last_at FROM instincts WHERE project_id = ?`,
      )
      .get(projectId) as { last_at: string | null } | undefined;

    return {
      projectId,
      totalObs: rows.length,
      uniqueSessions: sessionIds.size,
      observations: rows,
      toolBreakdown: toolMap,
      lastAnalyzedAt: lastRow?.last_at ?? null,
    };
  }

  /**
   * Build a compacted evidence bundle suitable for LLM analysis.
   * This is sent to Haiku for candidate instinct extraction.
   */
  buildEvidenceBundle(window: AnalysisWindow): Record<string, unknown> {
    const toolSummaries: Record<string, unknown>[] = [];
    for (const [, stats] of window.toolBreakdown) {
      toolSummaries.push({
        tool: stats.toolName,
        totalCalls: stats.count,
        successRate: Math.round(stats.successRate * 100) / 100,
        avgLatencyMs: Math.round(stats.avgLatencyMs),
        uniqueSessions: stats.sessionIds.size,
      });
    }

    // Extract common error patterns
    const errors = window.observations
      .filter((o) => o.success === 0 && o.output_summary)
      .slice(0, 20)
      .map((o) => ({
        tool: o.tool_name,
        agent: o.agent_id,
        error: o.output_summary?.slice(0, 200),
      }));

    // Extract common success patterns
    const successes = window.observations
      .filter((o) => o.success === 1)
      .slice(0, 20)
      .map((o) => ({
        tool: o.tool_name,
        agent: o.agent_id,
        input: o.input_summary?.slice(0, 150),
      }));

    return {
      projectId: window.projectId,
      totalObservations: window.totalObs,
      uniqueSessions: window.uniqueSessions,
      toolSummaries,
      recentErrors: errors,
      recentSuccesses: successes,
    };
  }

  /**
   * Analyze a window and extract candidate instincts.
   * In production, this calls Haiku. Here we provide the deterministic
   * heuristic fallback that works without an LLM call.
   */
  extractCandidatesHeuristic(window: AnalysisWindow): InstinctCandidate[] {
    const candidates: InstinctCandidate[] = [];

    for (const [, stats] of window.toolBreakdown) {
      if (stats.count < 5) continue;

      // High failure rate pattern
      if (stats.successRate < 0.5 && stats.count >= 10) {
        candidates.push({
          title: `${stats.toolName} has high failure rate`,
          instinctText: `Tool "${stats.toolName}" fails ${Math.round((1 - stats.successRate) * 100)}% of the time. Consider pre-validating inputs or using alternative approaches.`,
          domain: stats.toolName,
          supportCount: stats.count,
          supportSessions: stats.sessionIds.size,
          consistencyRatio: 1 - stats.successRate,
        });
      }

      // Slow tool pattern
      if (stats.avgLatencyMs > 5000 && stats.count >= 5) {
        candidates.push({
          title: `${stats.toolName} is consistently slow`,
          instinctText: `Tool "${stats.toolName}" averages ${Math.round(stats.avgLatencyMs)}ms. Consider batching calls or using lighter alternatives.`,
          domain: stats.toolName,
          supportCount: stats.count,
          supportSessions: stats.sessionIds.size,
          consistencyRatio: 0.8,
        });
      }

      // High success rate pattern (worth reinforcing)
      if (stats.successRate > 0.95 && stats.count >= 15 && stats.sessionIds.size >= 3) {
        candidates.push({
          title: `${stats.toolName} is highly reliable`,
          instinctText: `Tool "${stats.toolName}" succeeds ${Math.round(stats.successRate * 100)}% of the time across ${stats.sessionIds.size} sessions. This is a reliable approach.`,
          domain: stats.toolName,
          supportCount: stats.count,
          supportSessions: stats.sessionIds.size,
          consistencyRatio: stats.successRate,
        });
      }
    }

    return candidates.slice(0, this.config.maxCandidatesPerRun);
  }

  /**
   * Build the prompt for Haiku analysis.
   * Returns system prompt + user message for the LLM call.
   */
  buildAnalysisPrompt(bundle: Record<string, unknown>): {
    system: string;
    user: string;
  } {
    const system = `You are a behavioral pattern analyzer for a software development tool orchestrator.
Analyze the provided observation data and extract behavioral instincts (learned patterns).

Rules:
- Output ONLY valid JSON array of instinct candidates
- Each candidate must have: title, instinctText, domain, supportCount, supportSessions, consistencyRatio
- consistencyRatio must be between 0 and 1
- Only output patterns with strong evidence (multiple sessions, clear trend)
- Maximum ${this.config.maxCandidatesPerRun} candidates
- Focus on actionable patterns: tool reliability, common failure modes, efficient approaches`;

    const user = `Analyze these observation statistics and extract behavioral patterns:

${JSON.stringify(bundle, null, 2)}

Return a JSON array of instinct candidates.`;

    return { system, user };
  }

  /**
   * Run full analysis cycle. Returns extracted candidates.
   * Uses heuristic extraction by default; pass analyzeWithLLM
   * callback to use Haiku.
   */
  async analyze(
    projectId: string,
    analyzeWithLLM?: (system: string, user: string) => Promise<InstinctCandidate[]>,
  ): Promise<InstinctCandidate[]> {
    if (!this.shouldAnalyze(projectId)) return [];

    const window = this.buildWindow(projectId);
    this.lastAnalysisTime = Date.now();

    if (analyzeWithLLM) {
      const bundle = this.buildEvidenceBundle(window);
      const prompt = this.buildAnalysisPrompt(bundle);
      try {
        const llmCandidates = await analyzeWithLLM(prompt.system, prompt.user);
        return llmCandidates.slice(0, this.config.maxCandidatesPerRun);
      } catch {
        // Fallback to heuristic on LLM failure
      }
    }

    return this.extractCandidatesHeuristic(window);
  }
}
