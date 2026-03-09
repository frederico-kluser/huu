// Memory & Learning — Startup context loading
//
// Selective startup hydration that loads recent high-value memory
// artifacts (sessions + active instincts) into runtime context.
// Ranks by recency, relevance, and unresolved-risk weight.

import type Database from 'better-sqlite3';
import { SessionRepository } from '../db/repositories/sessions.js';
import { InstinctRepository } from '../db/repositories/instincts.js';
import type { Session, Instinct } from '../types/index.js';
import type { SessionsConfig, InstinctConfig } from './config.js';
import { DEFAULT_MEMORY_CONFIG } from './config.js';
import { applyDecay } from './instincts.js';
import type { SessionSummaryJson } from './sessions.js';

// ── Loaded context ──────────────────────────────────────────────────

export interface MemoryContext {
  sessions: RankedSession[];
  instincts: Instinct[];
  bootstrapHints: string[];
  totalTokenEstimate: number;
}

export interface RankedSession {
  session: Session;
  relevanceScore: number;
  summary: SessionSummaryJson | null;
}

// ── ContextLoader class ─────────────────────────────────────────────

export class ContextLoader {
  private readonly db: Database.Database;
  private readonly sessionRepo: SessionRepository;
  private readonly instinctRepo: InstinctRepository;
  private readonly sessionsConfig: SessionsConfig;
  private readonly instinctConfig: InstinctConfig;

  constructor(
    db: Database.Database,
    config?: {
      sessions?: Partial<SessionsConfig>;
      instinct?: Partial<InstinctConfig>;
    },
  ) {
    this.db = db;
    this.sessionRepo = new SessionRepository(db);
    this.instinctRepo = new InstinctRepository(db);
    this.sessionsConfig = { ...DEFAULT_MEMORY_CONFIG.sessions, ...config?.sessions };
    this.instinctConfig = { ...DEFAULT_MEMORY_CONFIG.instinct, ...config?.instinct };
  }

  /**
   * Load startup context for a project.
   * Fetches recent sessions within the configured window,
   * ranks them, and loads active instincts.
   */
  load(projectId: string, currentObjective?: string): MemoryContext {
    // 1. Fetch recent sessions
    const windowDays = this.sessionsConfig.loadWindowDays;
    const maxSummaries = this.sessionsConfig.maxSummariesToLoad;

    const recentSessions = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE project_id = ?
           AND ended_at >= datetime('now', '-' || ? || ' days')
           AND status IN ('completed', 'failed')
         ORDER BY ended_at DESC
         LIMIT ?`,
      )
      .all(projectId, windowDays, maxSummaries) as Session[];

    // 2. Rank sessions
    const ranked = recentSessions.map((session) => {
      let summary: SessionSummaryJson | null = null;
      try {
        summary = JSON.parse(session.summary_json) as SessionSummaryJson;
      } catch { /* no valid summary */ }

      const score = this.computeRelevanceScore(session, summary, currentObjective);
      return { session, relevanceScore: score, summary };
    });

    // Sort by relevance (highest first)
    ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // 3. Load active instincts (filter out low-confidence after decay)
    const allActive = this.instinctRepo.listActive(projectId);
    const now = Date.now();
    const filteredInstincts = allActive.filter((inst) => {
      const lastValidated = inst.last_validated_at
        ? new Date(inst.last_validated_at).getTime()
        : new Date(inst.created_at).getTime();
      const ageDays = (now - lastValidated) / (1000 * 60 * 60 * 24);
      const effective = applyDecay(inst.confidence, ageDays, this.instinctConfig.decayHalfLifeDays);
      return effective >= this.instinctConfig.deleteBelow;
    });

    // 4. Collect bootstrap hints from most recent session
    const bootstrapHints: string[] = [];
    if (ranked.length > 0 && ranked[0]!.summary) {
      bootstrapHints.push(...ranked[0]!.summary.nextSessionBootstrap);
      if (ranked[0]!.summary.openRisks.length > 0) {
        bootstrapHints.push('Previous risks: ' + ranked[0]!.summary.openRisks.join('; '));
      }
    }
    if (filteredInstincts.length > 0) {
      bootstrapHints.push(
        `Active instincts (${filteredInstincts.length}): ${filteredInstincts.map((i) => i.title).slice(0, 5).join(', ')}`,
      );
    }

    // 5. Estimate token usage
    const tokenEstimate = this.estimateTokens(ranked, filteredInstincts, bootstrapHints);

    return {
      sessions: ranked,
      instincts: filteredInstincts,
      bootstrapHints,
      totalTokenEstimate: tokenEstimate,
    };
  }

  /**
   * Render loaded context as text for injection into agent prompts.
   */
  renderContext(context: MemoryContext): string {
    const sections: string[] = [];

    // Bootstrap hints
    if (context.bootstrapHints.length > 0) {
      sections.push('## Session Bootstrap');
      for (const hint of context.bootstrapHints) {
        sections.push(`- ${hint}`);
      }
    }

    // Active instincts
    if (context.instincts.length > 0) {
      sections.push('');
      sections.push('## Active Instincts');
      for (const inst of context.instincts) {
        sections.push(
          `- **${inst.title}** (confidence: ${inst.confidence.toFixed(2)}): ${inst.instinct_text}`,
        );
      }
    }

    // Recent session summaries (abbreviated)
    if (context.sessions.length > 0) {
      sections.push('');
      sections.push('## Recent Sessions');
      for (const ranked of context.sessions.slice(0, 5)) {
        const status = ranked.session.status;
        const ended = ranked.session.ended_at ?? 'ongoing';
        sections.push(`\n### Session ${ranked.session.id} (${status}, ${ended})`);
        if (ranked.summary) {
          if (ranked.summary.completed.length > 0) {
            sections.push('Completed: ' + ranked.summary.completed.slice(0, 5).join('; '));
          }
          if (ranked.summary.openRisks.length > 0) {
            sections.push('Risks: ' + ranked.summary.openRisks.join('; '));
          }
        }
      }
    }

    return sections.join('\n');
  }

  // ── Private helpers ────────────────────────────────────────────────

  private computeRelevanceScore(
    session: Session,
    summary: SessionSummaryJson | null,
    currentObjective?: string,
  ): number {
    let score = 0;

    // Recency: exponential decay over days
    if (session.ended_at) {
      const ageDays =
        (Date.now() - new Date(session.ended_at).getTime()) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 1 - ageDays / this.sessionsConfig.loadWindowDays);
    }

    // Unresolved risks boost
    if (summary?.openRisks && summary.openRisks.length > 0) {
      score += 0.3 * Math.min(1, summary.openRisks.length / 3);
    }

    // Objective overlap (simple keyword matching)
    if (currentObjective && summary) {
      const objectiveWords = currentObjective.toLowerCase().split(/\s+/);
      const summaryText = JSON.stringify(summary).toLowerCase();
      const matchCount = objectiveWords.filter((w) => w.length > 3 && summaryText.includes(w)).length;
      score += 0.2 * Math.min(1, matchCount / Math.max(objectiveWords.length, 1));
    }

    // Failed sessions get a boost (learn from mistakes)
    if (session.status === 'failed') {
      score += 0.15;
    }

    return Math.min(score, 2.0); // cap
  }

  private estimateTokens(
    sessions: RankedSession[],
    instincts: Instinct[],
    hints: string[],
  ): number {
    // Rough estimate: 4 chars ≈ 1 token
    let chars = 0;
    for (const s of sessions) {
      chars += (s.session.summary_markdown?.length ?? 0);
    }
    for (const i of instincts) {
      chars += i.title.length + i.instinct_text.length + 50;
    }
    for (const h of hints) {
      chars += h.length;
    }
    return Math.ceil(chars / 4);
  }
}
