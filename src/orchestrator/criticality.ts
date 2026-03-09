// Criticality Classification — deterministic rules for `critical: true`
//
// Two-tier approach:
// 1. Hard rules: automatic critical if any condition matches
// 2. Risk score: impact(1-5) + irreversibility(0-3) + uncertainty(0-2) >= 7

import type { AtomicTask } from './beatsheet.js';
import type { CriticalityMeta, CriticalReasonCode } from './verification-types.js';

// ── Hard-rule keyword sets ──────────────────────────────────────────

const AUTH_SECURITY_KEYWORDS = [
  'auth', 'authentication', 'authorization', 'login', 'logout',
  'password', 'credential', 'secret', 'token', 'jwt', 'oauth',
  'permission', 'rbac', 'acl', 'encrypt', 'decrypt', 'cipher',
  'hash', 'salt', 'certificate', 'tls', 'ssl', 'security',
  'privilege', 'escalation', 'injection', 'xss', 'csrf', 'sanitiz',
] as const;

const INFRA_DEPLOY_KEYWORDS = [
  'deploy', 'infrastructure', 'production', 'staging',
  'ci/cd', 'pipeline', 'docker', 'kubernetes', 'k8s',
  'terraform', 'cloudformation', 'env', 'environment',
  'config', 'configuration', 'nginx', 'proxy', 'load balancer',
  'dns', 'ssl', 'certificate', 'firewall', 'network',
  'migration', 'database migration', 'schema migration',
] as const;

const ARCH_DECISION_KEYWORDS = [
  'interface', 'contract', 'api', 'schema', 'protocol',
  'architecture', 'design decision', 'cross-agent', 'shared',
  'core', 'central', 'foundational', 'breaking change',
  'backward compat', 'public api', 'export',
] as const;

const COMPLIANCE_KEYWORDS = [
  'compliance', 'legal', 'gdpr', 'hipaa', 'pci', 'sox',
  'regulation', 'privacy', 'data protection', 'retention',
  'audit', 'consent', 'policy',
] as const;

// ── Hard-rule check ─────────────────────────────────────────────────

function textContainsKeywords(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

interface HardRuleResult {
  matched: boolean;
  reasons: CriticalReasonCode[];
}

export function checkHardRules(
  title: string,
  action: string,
  filesChanged?: string[],
): HardRuleResult {
  const combined = `${title} ${action} ${(filesChanged ?? []).join(' ')}`;
  const reasons: CriticalReasonCode[] = [];

  if (textContainsKeywords(combined, AUTH_SECURITY_KEYWORDS)) {
    reasons.push('TOUCHES_AUTH_SECURITY');
  }

  if (textContainsKeywords(combined, INFRA_DEPLOY_KEYWORDS)) {
    reasons.push('ALTERS_INFRA_DEPLOY');
  }

  if (textContainsKeywords(combined, ARCH_DECISION_KEYWORDS)) {
    reasons.push('ALTERS_ARCH_DECISION');
  }

  if (textContainsKeywords(combined, COMPLIANCE_KEYWORDS)) {
    reasons.push('COMPLIANCE_LEGAL_RISK');
  }

  return { matched: reasons.length > 0, reasons };
}

// ── Risk score computation ──────────────────────────────────────────

export interface RiskFactors {
  /** 1-5: how much does this affect the system? */
  impact: number;
  /** 0-3: how hard is this to reverse? */
  irreversibility: number;
  /** 0-2: how uncertain is the outcome? */
  uncertainty: number;
}

const RISK_THRESHOLD = 7;

export function computeRiskScore(factors: RiskFactors): number {
  return factors.impact + factors.irreversibility + factors.uncertainty;
}

export function isHighRisk(factors: RiskFactors): boolean {
  return computeRiskScore(factors) >= RISK_THRESHOLD;
}

// ── Heuristic risk estimation from task metadata ────────────────────

export function estimateRiskFactors(
  title: string,
  action: string,
  effort: string,
  filesChanged?: string[],
): RiskFactors {
  const combined = `${title} ${action}`.toLowerCase();
  const fileCount = filesChanged?.length ?? 0;

  // Impact: based on effort + keywords
  let impact = effort === 'large' ? 4 : effort === 'medium' ? 3 : 2;
  if (fileCount > 10) impact = Math.min(5, impact + 1);

  // Irreversibility: based on what's being changed
  let irreversibility = 1;
  if (combined.includes('delete') || combined.includes('remove') || combined.includes('drop')) {
    irreversibility = 3;
  } else if (combined.includes('rename') || combined.includes('refactor') || combined.includes('migrate')) {
    irreversibility = 2;
  }

  // Uncertainty: based on complexity signals
  let uncertainty = 0;
  if (combined.includes('complex') || combined.includes('uncertain') || combined.includes('unknown')) {
    uncertainty = 2;
  } else if (combined.includes('new') || combined.includes('experimental') || combined.includes('prototype')) {
    uncertainty = 1;
  }

  return { impact, irreversibility, uncertainty };
}

// ── Main classification function ────────────────────────────────────

export function classifyCriticality(
  task: AtomicTask,
  filesChanged?: string[],
  isMergeTier4?: boolean,
): CriticalityMeta {
  const reasons: CriticalReasonCode[] = [];

  // 1. Explicit critical flag from beat sheet
  if (task.critical) {
    // Task was already marked critical in the beat sheet — keep it
  }

  // 2. Hard rules
  const hardRules = checkHardRules(task.title, task.action, filesChanged);
  reasons.push(...hardRules.reasons);

  // 3. Merge Tier 4 conflict
  if (isMergeTier4) {
    reasons.push('MERGE_TIER4_CONFLICT');
  }

  // 4. Risk score (when no hard rule matched)
  let riskScore: number | undefined;
  if (reasons.length === 0 && !task.critical) {
    const factors = estimateRiskFactors(
      task.title,
      task.action,
      task.estimatedEffort,
      filesChanged,
    );
    riskScore = computeRiskScore(factors);
    if (riskScore >= RISK_THRESHOLD) {
      reasons.push('HIGH_RISK_SCORE');
    }
  }

  const critical = task.critical || reasons.length > 0;

  return {
    critical,
    criticalReasons: reasons,
    ...(riskScore !== undefined ? { riskScore } : {}),
  };
}
