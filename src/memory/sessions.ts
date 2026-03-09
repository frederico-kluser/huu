// Memory & Learning — Session summary generation
//
// High-signal session distillation persisted to `sessions`, capturing
// completed work, unresolved items, learned instincts, contradictions,
// and next actions. Two-pass: recall (collect) + precision (compress).

import type Database from 'better-sqlite3';
import { SessionRepository } from '../db/repositories/sessions.js';
import type { Session, Observation, Instinct } from '../types/index.js';
import type { SessionsConfig } from './config.js';
import { DEFAULT_MEMORY_CONFIG } from './config.js';
import { sanitize } from './observer.js';

// ── Session summary structure ─────────────────────────────────────

export interface SessionSummaryJson {
  completed: string[];
  failedAttempts: string[];
  instinctUpdates: Array<{
    instinctId: number;
    title: string;
    action: 'created' | 'reinforced' | 'contradicted' | 'promoted' | 'deprecated';
    confidenceAfter: number;
  }>;
  openRisks: string[];
  nextSessionBootstrap: string[];
  keyFiles: string[];
  stats: {
    totalObservations: number;
    totalToolCalls: number;
    totalCostUsd: number;
    uniqueTools: number;
    successRate: number;
    compressionRatio: number;
  };
}

// ── SessionSummarizer class ─────────────────────────────────────────

export class SessionSummarizer {
  private readonly db: Database.Database;
  private readonly sessionRepo: SessionRepository;
  private readonly config: SessionsConfig;

  constructor(db: Database.Database, config?: Partial<SessionsConfig>) {
    this.db = db;
    this.sessionRepo = new SessionRepository(db);
    this.config = { ...DEFAULT_MEMORY_CONFIG.sessions, ...config };
  }

  /**
   * Generate a summary for a session. Two-pass approach:
   * Pass A (recall): collect all critical events
   * Pass B (precision): compress and remove low-signal noise
   */
  generateSummary(sessionId: string): SessionSummaryJson {
    // Pass A: Recall — gather all data
    const observations = this.db
      .prepare(
        `SELECT * FROM observations
         WHERE session_id = ? AND tool_phase = 'post'
         ORDER BY occurred_at ASC`,
      )
      .all(sessionId) as Observation[];

    const instincts = this.db
      .prepare(
        `SELECT * FROM instincts
         WHERE updated_at >= (SELECT started_at FROM sessions WHERE id = ?)
         ORDER BY updated_at DESC`,
      )
      .all(sessionId) as Instinct[];

    // Collect completed work (successful operations)
    const completed: string[] = [];
    const failedAttempts: string[] = [];
    const keyFiles = new Set<string>();

    for (const obs of observations) {
      const inputSummary = sanitize(obs.input_summary) ?? '';

      // Extract file paths from inputs
      const fileMatch = inputSummary.match(/["']([^"']+\.[a-z]{1,10})["']/gi);
      if (fileMatch) {
        for (const match of fileMatch) {
          keyFiles.add(match.replace(/['"]/g, ''));
        }
      }

      if (obs.success === 1) {
        if (obs.tool_name === 'write_file' || obs.tool_name === 'bash') {
          completed.push(`${obs.tool_name}: ${inputSummary.slice(0, 100)}`);
        }
      } else {
        failedAttempts.push(
          `${obs.tool_name}: ${(obs.output_summary ?? 'unknown error').slice(0, 100)}`,
        );
      }
    }

    // Build instinct updates
    const instinctUpdates = instincts.map((inst) => {
      let action: SessionSummaryJson['instinctUpdates'][0]['action'] = 'created';
      if (inst.state === 'promoted') action = 'promoted';
      else if (inst.state === 'deprecated') action = 'deprecated';
      else if (inst.evidence_count > 1) action = 'reinforced';
      if (inst.contradiction_count > 0) action = 'contradicted';
      return {
        instinctId: inst.id,
        title: inst.title,
        action,
        confidenceAfter: inst.confidence,
      };
    });

    // Derive open risks from failures
    const openRisks: string[] = [];
    if (failedAttempts.length > 3) {
      openRisks.push(`High failure count (${failedAttempts.length}) — investigate tool reliability.`);
    }
    const deprecatedInstincts = instincts.filter((i) => i.state === 'deprecated');
    if (deprecatedInstincts.length > 0) {
      openRisks.push(
        `${deprecatedInstincts.length} instinct(s) deprecated — previous patterns may no longer hold.`,
      );
    }

    // Next session bootstrap hints
    const nextSessionBootstrap: string[] = [];
    if (failedAttempts.length > 0) {
      nextSessionBootstrap.push(`Review ${failedAttempts.length} failed attempt(s) before retrying.`);
    }
    const activeInstincts = instincts.filter((i) => i.state === 'active');
    if (activeInstincts.length > 0) {
      nextSessionBootstrap.push(
        `Active instincts: ${activeInstincts.map((i) => i.title).join(', ')}`,
      );
    }

    // Pass B: Precision — compress
    const uniqueCompleted = [...new Set(completed)].slice(0, 20);
    const uniqueFailed = [...new Set(failedAttempts)].slice(0, 10);
    const totalEvents = observations.length + instincts.length;
    const summaryEvents = uniqueCompleted.length + uniqueFailed.length + instinctUpdates.length;

    // Stats
    const uniqueTools = new Set(observations.map((o) => o.tool_name)).size;
    const successCount = observations.filter((o) => o.success === 1).length;
    const totalCost = observations.reduce((sum, o) => sum + (o.cost_usd ?? 0), 0);

    return {
      completed: uniqueCompleted,
      failedAttempts: uniqueFailed,
      instinctUpdates,
      openRisks,
      nextSessionBootstrap,
      keyFiles: [...keyFiles].slice(0, 20),
      stats: {
        totalObservations: observations.length,
        totalToolCalls: observations.length,
        totalCostUsd: Math.round(totalCost * 10000) / 10000,
        uniqueTools,
        successRate: observations.length > 0 ? successCount / observations.length : 0,
        compressionRatio: totalEvents > 0 ? summaryEvents / totalEvents : 0,
      },
    };
  }

  /**
   * Generate markdown summary from structured JSON.
   */
  renderMarkdown(summary: SessionSummaryJson): string {
    const lines: string[] = [];

    lines.push('### Completed');
    if (summary.completed.length === 0) {
      lines.push('- (none)');
    } else {
      for (const item of summary.completed) {
        lines.push(`- ${item}`);
      }
    }

    lines.push('');
    lines.push('### Failed Attempts');
    if (summary.failedAttempts.length === 0) {
      lines.push('- (none)');
    } else {
      for (const item of summary.failedAttempts) {
        lines.push(`- ${item}`);
      }
    }

    lines.push('');
    lines.push('### Instinct Updates');
    if (summary.instinctUpdates.length === 0) {
      lines.push('- (none)');
    } else {
      for (const update of summary.instinctUpdates) {
        lines.push(
          `- [${update.action}] ${update.title} (confidence: ${update.confidenceAfter.toFixed(2)})`,
        );
      }
    }

    lines.push('');
    lines.push('### Open Risks');
    if (summary.openRisks.length === 0) {
      lines.push('- (none)');
    } else {
      for (const risk of summary.openRisks) {
        lines.push(`- ${risk}`);
      }
    }

    lines.push('');
    lines.push('### Next Session Bootstrap');
    if (summary.nextSessionBootstrap.length === 0) {
      lines.push('- (none)');
    } else {
      for (const item of summary.nextSessionBootstrap) {
        lines.push(`- ${item}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * End a session with generated summary.
   */
  endSession(
    sessionId: string,
    status: 'completed' | 'failed' | 'aborted',
  ): Session | null {
    const summary = this.generateSummary(sessionId);
    const markdown = this.renderMarkdown(summary);

    const success = this.sessionRepo.end({
      id: sessionId,
      status,
      summary_markdown: markdown,
      summary_json: JSON.stringify(summary),
    });

    if (!success) return null;
    return this.sessionRepo.getById(sessionId) ?? null;
  }
}
