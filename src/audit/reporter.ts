import type Database from 'better-sqlite3';
import type { AuditReportData, AuditReportKpis } from './types.js';
import { getCostBySession, getCostByAgent, getCostByFeature } from './cost.js';
import {
  getSessionTimeline,
  getTopRiskEvents,
  getTopCostEvents,
  getEventCountsByType,
  getP95Duration,
  detectLoops,
  getFailedToolsSummary,
} from './queries.js';

/**
 * Generate a deterministic post-session audit report (JSON + Markdown).
 * Same session_id + same DB => same report (reproducible).
 */
export function generateReport(db: Database.Database, sessionId: string): AuditReportData {
  const generatedAt = new Date().toISOString();

  // Gather KPIs
  const eventCounts = getEventCountsByType(db, sessionId);
  const costData = getCostBySession(db, sessionId);
  const timeline = getSessionTimeline(db, sessionId);
  const p95Duration = getP95Duration(db, sessionId);

  const totalEvents = Object.values(eventCounts).reduce((a, b) => a + b, 0);
  const toolCalls = (eventCounts['tool_call_end'] ?? 0);
  const llmCalls = (eventCounts['llm_call_end'] ?? 0);
  const totalFailures = timeline.filter((e) => e.success === 0).length;
  const totalEscalations = eventCounts['escalation'] ?? 0;

  const firstTs = timeline[0]?.ts_ms ?? 0;
  const lastTs = timeline[timeline.length - 1]?.ts_ms ?? 0;

  const kpis: AuditReportKpis = {
    total_events: totalEvents,
    total_tool_calls: toolCalls,
    total_llm_calls: llmCalls,
    total_failures: totalFailures,
    total_escalations: totalEscalations,
    total_cost_usd: costData?.total_cost_usd ?? 0,
    duration_ms: lastTs - firstTs,
    p95_duration_ms: p95Duration,
  };

  // Aggregations
  const costByAgent = getCostByAgent(db, sessionId);
  const costByFeature = getCostByFeature(db, sessionId);
  const topRiskEvents = getTopRiskEvents(db, sessionId, 10);
  const topCostEvents = getTopCostEvents(db, sessionId, 10);

  // Recommendations
  const recommendations = generateRecommendations(db, sessionId, kpis);

  return {
    session_id: sessionId,
    generated_at: generatedAt,
    kpis,
    cost_by_agent: costByAgent,
    cost_by_feature: costByFeature,
    top_risk_events: topRiskEvents,
    top_cost_events: topCostEvents,
    timeline_summary: timeline,
    recommendations,
  };
}

/**
 * Render report data as Markdown.
 */
export function renderMarkdown(report: AuditReportData): string {
  const lines: string[] = [];

  lines.push(`# Audit Report: ${report.session_id}`);
  lines.push('');
  lines.push(`Generated: ${report.generated_at}`);
  lines.push('');

  // KPIs
  lines.push('## KPIs');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Events | ${report.kpis.total_events} |`);
  lines.push(`| Tool Calls | ${report.kpis.total_tool_calls} |`);
  lines.push(`| LLM Calls | ${report.kpis.total_llm_calls} |`);
  lines.push(`| Failures | ${report.kpis.total_failures} |`);
  lines.push(`| Escalations | ${report.kpis.total_escalations} |`);
  lines.push(`| Total Cost (USD) | $${report.kpis.total_cost_usd.toFixed(4)} |`);
  lines.push(`| Duration | ${formatDuration(report.kpis.duration_ms)} |`);
  lines.push(`| P95 Duration | ${report.kpis.p95_duration_ms}ms |`);
  lines.push('');

  // Cost by Agent
  if (report.cost_by_agent.length > 0) {
    lines.push('## Cost by Agent');
    lines.push('');
    lines.push('| Agent | Model | Cost (USD) | Input Tokens | Output Tokens | Events |');
    lines.push('|-------|-------|-----------|-------------|--------------|--------|');
    for (const row of report.cost_by_agent) {
      lines.push(`| ${row.agent_id} | ${row.model_name ?? '-'} | $${row.total_cost_usd.toFixed(4)} | ${row.total_input_tokens} | ${row.total_output_tokens} | ${row.event_count} |`);
    }
    lines.push('');
  }

  // Cost by Feature
  if (report.cost_by_feature.length > 0) {
    lines.push('## Cost by Feature');
    lines.push('');
    lines.push('| Feature | Cost (USD) | Events |');
    lines.push('|---------|-----------|--------|');
    for (const row of report.cost_by_feature) {
      lines.push(`| ${row.feature_id} | $${row.total_cost_usd.toFixed(4)} | ${row.event_count} |`);
    }
    lines.push('');
  }

  // Top Risk Events
  if (report.top_risk_events.length > 0) {
    lines.push('## Top Risk Events');
    lines.push('');
    lines.push('| ID | Agent | Type | Tool | Risk Score | Flags |');
    lines.push('|----|-------|------|------|-----------|-------|');
    for (const evt of report.top_risk_events) {
      const flags = evt.risk_flags_json ? JSON.parse(evt.risk_flags_json).map((f: { code: string }) => f.code).join(', ') : '-';
      lines.push(`| ${evt.id} | ${evt.agent_id} | ${evt.event_type} | ${evt.tool_name ?? '-'} | ${evt.risk_score} | ${flags} |`);
    }
    lines.push('');
  }

  // Top Cost Events
  if (report.top_cost_events.length > 0) {
    lines.push('## Top Cost Events');
    lines.push('');
    lines.push('| ID | Agent | Model | Cost (USD) | In Tokens | Out Tokens |');
    lines.push('|----|-------|-------|-----------|----------|-----------|');
    for (const evt of report.top_cost_events) {
      lines.push(`| ${evt.id} | ${evt.agent_id} | ${evt.model_name ?? '-'} | $${(evt.estimated_cost_usd ?? 0).toFixed(4)} | ${evt.input_tokens ?? 0} | ${evt.output_tokens ?? 0} |`);
    }
    lines.push('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Persist report to the audit_reports table.
 */
export function saveReport(db: Database.Database, report: AuditReportData, markdown: string): void {
  db.prepare(`
    INSERT INTO audit_reports (session_id, generated_at, report_json, report_markdown)
    VALUES (@session_id, @generated_at, @report_json, @report_markdown)
  `).run({
    session_id: report.session_id,
    generated_at: report.generated_at,
    report_json: JSON.stringify(report),
    report_markdown: markdown,
  });
}

/**
 * Full pipeline: generate, render, and persist.
 */
export function generateAndSaveReport(db: Database.Database, sessionId: string): { report: AuditReportData; markdown: string } {
  const report = generateReport(db, sessionId);
  const markdown = renderMarkdown(report);
  saveReport(db, report, markdown);
  return { report, markdown };
}

// ── Internal helpers ────────────────────────────────────────────────

function generateRecommendations(db: Database.Database, sessionId: string, kpis: AuditReportKpis): string[] {
  const recommendations: string[] = [];

  // High failure rate
  if (kpis.total_tool_calls > 0) {
    const failRate = kpis.total_failures / kpis.total_tool_calls;
    if (failRate > 0.2) {
      recommendations.push(`High failure rate (${(failRate * 100).toFixed(1)}%). Investigate failing tools and error patterns.`);
    }
  }

  // Loop detection
  const loops = detectLoops(db, sessionId);
  if (loops.length > 0) {
    recommendations.push(`Detected ${loops.length} potential loop(s). Review agent behavior for repeated identical tool calls.`);
  }

  // Failed tools
  const failedTools = getFailedToolsSummary(db, sessionId);
  for (const ft of failedTools.slice(0, 3)) {
    if (ft.fail_count >= 3) {
      recommendations.push(`Tool "${ft.tool_name}" failed ${ft.fail_count} times for agent "${ft.agent_id}". Consider error handling improvements.`);
    }
  }

  // High cost
  if (kpis.total_cost_usd > 1.0) {
    recommendations.push(`Session cost ($${kpis.total_cost_usd.toFixed(2)}) is above $1.00. Consider model tiering optimization.`);
  }

  // Escalations
  if (kpis.total_escalations > 0) {
    recommendations.push(`${kpis.total_escalations} escalation(s) occurred. Review escalation reasons for preventable issues.`);
  }

  return recommendations;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}
