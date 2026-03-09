import type { RiskFlag, RiskRule, RiskRuleContext, FlagCode } from './types.js';

// ── Built-in risk rules ─────────────────────────────────────────────

const PATH_OUTSIDE_WORKSPACE: RiskRule = {
  code: 'PATH_OUTSIDE_WORKSPACE',
  evaluate: (ctx) => {
    const params = ctx.event.params_sanitized;
    if (!params || !ctx.workspacePath) return null;

    // Check if any path-like parameter references outside workspace
    const pathPatterns = [/\/etc\//, /\/root\//, /\/home\/(?!user)/, /~\//,
      /\.\.\/.*\.\.\//]; // multiple traversals
    for (const pattern of pathPatterns) {
      if (pattern.test(params)) {
        return { code: 'PATH_OUTSIDE_WORKSPACE', points: 40, detail: `Detected path outside workspace` };
      }
    }
    return null;
  },
};

const EXCESSIVE_FILE_WRITES: RiskRule = {
  code: 'EXCESSIVE_FILE_WRITES',
  evaluate: (ctx) => {
    if (ctx.event.event_type !== 'tool_call_end') return null;
    const writingTools = ['write_file', 'edit_file', 'bash'];
    if (!ctx.event.tool_name || !writingTools.includes(ctx.event.tool_name)) return null;

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recentWrites = ctx.recentEvents.filter(
      (e) =>
        e.event_type === 'tool_call_end' &&
        e.tool_name != null &&
        writingTools.includes(e.tool_name) &&
        e.ts_ms >= fiveMinAgo,
    );

    if (recentWrites.length >= 30) {
      return { code: 'EXCESSIVE_FILE_WRITES', points: 35, detail: `${recentWrites.length} writes in 5min` };
    }
    return null;
  },
};

const EXCESSIVE_FILE_DELETES: RiskRule = {
  code: 'EXCESSIVE_FILE_DELETES',
  evaluate: (ctx) => {
    if (ctx.event.event_type !== 'tool_call_end') return null;
    if (ctx.event.tool_name !== 'bash') return null;

    const params = ctx.event.params_sanitized ?? '';
    const deletePatterns = [/\brm\b/, /\bunlink\b/, /\brmdir\b/];
    const isDelete = deletePatterns.some((p) => p.test(params));
    if (!isDelete) return null;

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recentDeletes = ctx.recentEvents.filter(
      (e) =>
        e.event_type === 'tool_call_end' &&
        e.tool_name === 'bash' &&
        e.ts_ms >= fiveMinAgo &&
        e.params_sanitized != null &&
        deletePatterns.some((p) => p.test(e.params_sanitized!)),
    );

    if (recentDeletes.length >= 10) {
      return { code: 'EXCESSIVE_FILE_DELETES', points: 45, detail: `${recentDeletes.length} deletes in 5min` };
    }
    return null;
  },
};

const POSSIBLE_LOOP_DOW: RiskRule = {
  code: 'POSSIBLE_LOOP_DOW',
  evaluate: (ctx) => {
    if (ctx.event.event_type !== 'tool_call_end') return null;
    if (!ctx.event.tool_name) return null;

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const paramsSanitized = ctx.event.params_sanitized ?? '';

    // Count same tool+similar params in recent window
    const repeats = ctx.recentEvents.filter(
      (e) =>
        e.event_type === 'tool_call_end' &&
        e.tool_name === ctx.event.tool_name &&
        e.ts_ms >= fiveMinAgo &&
        e.params_sanitized === paramsSanitized,
    );

    if (repeats.length >= 8) {
      return { code: 'POSSIBLE_LOOP_DOW', points: 35, detail: `${repeats.length} identical calls in 5min` };
    }
    return null;
  },
};

const FAILURE_STREAK: RiskRule = {
  code: 'FAILURE_STREAK',
  evaluate: (ctx) => {
    if (ctx.event.event_type !== 'tool_call_end' && ctx.event.event_type !== 'llm_call_end') return null;
    if (ctx.event.success !== false) return null;

    // Count consecutive failures in recent events (most recent first)
    let streak = 1; // current event is a failure
    for (const e of ctx.recentEvents) {
      if (e.event_type !== 'tool_call_end' && e.event_type !== 'llm_call_end') continue;
      if (e.success === 0) {
        streak++;
      } else {
        break;
      }
    }

    if (streak >= 5) {
      return { code: 'FAILURE_STREAK', points: 30, detail: `${streak} consecutive failures` };
    }
    return null;
  },
};

const COST_SPIKE: RiskRule = {
  code: 'COST_SPIKE',
  evaluate: (ctx) => {
    if (ctx.event.estimated_cost_usd == null || ctx.event.estimated_cost_usd <= 0) return null;

    // Compute average cost from recent events
    const recentCosts = ctx.recentEvents
      .filter((e) => e.estimated_cost_usd != null && e.estimated_cost_usd > 0)
      .map((e) => e.estimated_cost_usd!);

    if (recentCosts.length < 3) return null;

    const avg = recentCosts.reduce((a, b) => a + b, 0) / recentCosts.length;
    if (avg <= 0) return null;

    if (ctx.event.estimated_cost_usd > avg * 5) {
      return {
        code: 'COST_SPIKE',
        points: 30,
        detail: `Cost $${ctx.event.estimated_cost_usd.toFixed(4)} vs avg $${avg.toFixed(4)}`,
      };
    }
    return null;
  },
};

const TOOL_OUTSIDE_PROFILE: RiskRule = {
  code: 'TOOL_OUTSIDE_PROFILE',
  evaluate: (ctx) => {
    if (!ctx.event.tool_name || !ctx.agentProfile) return null;
    if (!ctx.agentProfile.tools.includes(ctx.event.tool_name)) {
      return {
        code: 'TOOL_OUTSIDE_PROFILE',
        points: 50,
        detail: `Tool "${ctx.event.tool_name}" not in agent profile`,
      };
    }
    return null;
  },
};

const PROMPT_INJECTION_SUSPECT: RiskRule = {
  code: 'PROMPT_INJECTION_SUSPECT',
  evaluate: (ctx) => {
    const text = (ctx.event.params_sanitized ?? '') + (ctx.event.result_summary ?? '');
    if (!text) return null;

    const injectionPatterns = [
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts)/i,
      /you\s+are\s+now\s+(a|an|the)\s+/i,
      /system\s*:\s*(you|your|the)\s/i,
      /\[INST\]/i,
      /<\|im_start\|>/i,
      /\bdo\s+anything\s+now\b/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(text)) {
        return { code: 'PROMPT_INJECTION_SUSPECT', points: 60, detail: 'Possible prompt injection detected' };
      }
    }
    return null;
  },
};

// ── Rule registry ───────────────────────────────────────────────────

const DEFAULT_RULES: RiskRule[] = [
  PATH_OUTSIDE_WORKSPACE,
  EXCESSIVE_FILE_WRITES,
  EXCESSIVE_FILE_DELETES,
  POSSIBLE_LOOP_DOW,
  FAILURE_STREAK,
  COST_SPIKE,
  TOOL_OUTSIDE_PROFILE,
  PROMPT_INJECTION_SUSPECT,
];

/**
 * Evaluate all risk rules against the given context.
 * Returns accumulated flags (one per triggered rule).
 */
export function evaluateRiskRules(
  ctx: RiskRuleContext,
  rules: RiskRule[] = DEFAULT_RULES,
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const rule of rules) {
    try {
      const flag = rule.evaluate(ctx);
      if (flag) flags.push(flag);
    } catch {
      // A failing rule must not break audit logging
    }
  }
  return flags;
}

/**
 * Determine severity from total risk score.
 */
export function scoreSeverity(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}
