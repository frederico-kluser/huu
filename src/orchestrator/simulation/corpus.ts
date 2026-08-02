/**
 * Believable-but-fake content for the {@link SimulationEngine}. None of this
 * touches a real LLM, repo or filesystem — it's a curated corpus the engine
 * samples from to make a synthetic run look like the real thing (kanban cards,
 * streamed lines, tool calls, log entries). Kept English to match the rest of
 * the web client ("English everywhere").
 *
 * Pure data + pure helpers only — no side effects, no imports from upper
 * layers (this lives under `orchestrator/`, so it may use `lib/` types but
 * nothing above).
 */

/** A synthetic pipeline preset — shapes the stage names + judge condition. */
export interface SimPreset {
  /** Display name shown as the run's pipeline name. */
  name: string;
  /** Name of the parallel per-file fan-out stage ($preset filled in). */
  fanStage: string;
  /** Name of the single consolidation stage. */
  consolidateStage: string;
  /** Name of the final judge check step. */
  judgeStep: string;
  /** The judge condition string shown on the judge card / drawer. */
  judgeCondition: string;
  /** Short verb describing what each agent "does" (for log/stream flavor). */
  verb: string;
}

export const PRESETS: SimPreset[] = [
  {
    name: 'huu Security Audit',
    fanStage: 'OWASP Top 10 scan · per file',
    consolidateStage: 'Consolidate security.md + remediation roadmap',
    judgeStep: 'Validate report',
    judgeCondition:
      'All sections complete, summary counts match the FAQ, ordering correct, report-only contract held.',
    verb: 'auditing',
  },
  {
    name: 'huu Test Suite',
    fanStage: 'Unit tests · per file',
    consolidateStage: 'Cleanup + coverage badge',
    judgeStep: 'Suite is green',
    judgeCondition: 'Test suite runs clean, no flaky assertions, coverage non-decreasing.',
    verb: 'testing',
  },
  {
    name: 'huu Quality Audit',
    fanStage: 'Complexity & hotspot scan · per file',
    consolidateStage: 'Consolidate quality.md + composite score',
    judgeStep: 'Validate report',
    judgeCondition: 'All metrics present, hotspot ranking sound, report-only contract held.',
    verb: 'analyzing',
  },
  {
    name: 'huu Docs Audit',
    fanStage: 'Diátaxis classification · per doc',
    consolidateStage: 'Consolidate docs.md + README score',
    judgeStep: 'Validate report',
    judgeCondition: 'Every doc classified, stale references flagged, README scored.',
    verb: 'reviewing',
  },
  {
    name: 'huu Performance Audit',
    fanStage: 'Hotspot scan (N+1, big-O, sync I/O) · per file',
    consolidateStage: 'Consolidate performance.md + USE checklist',
    judgeStep: 'Validate report',
    judgeCondition: 'Findings deduped, Core Web Vitals scorecard filled, report-only contract held.',
    verb: 'profiling',
  },
  {
    name: 'huu Refactor Plan',
    fanStage: 'Smell catalog · per file',
    consolidateStage: 'Rank top-5 + Mikado graph',
    judgeStep: 'Validate plan',
    judgeCondition: 'Characterization baseline noted, ranking by smell×churn, recommendations cited.',
    verb: 'refactoring',
  },
];

/**
 * A deep pool of plausible repo paths across several stacks. The engine slices
 * `fileCount` of these (cycled + suffixed when it runs out) so the per-file
 * fan-out cards read like a real project.
 */
export const FILE_POOL: string[] = [
  'src/server/http.ts',
  'src/server/router.ts',
  'src/auth/session.ts',
  'src/auth/tokens.ts',
  'src/auth/password.ts',
  'src/db/pool.ts',
  'src/db/migrations/0007_add_index.ts',
  'src/api/users.controller.ts',
  'src/api/orders.controller.ts',
  'src/api/webhooks.ts',
  'src/lib/cache.ts',
  'src/lib/rate-limit.ts',
  'src/lib/crypto.ts',
  'src/lib/validate.ts',
  'src/lib/upload.ts',
  'src/components/Checkout.tsx',
  'src/components/Dashboard.tsx',
  'src/components/Table.tsx',
  'src/hooks/use-fetch.ts',
  'src/workers/email.worker.ts',
  'services/billing/invoice.py',
  'services/billing/stripe_client.py',
  'services/search/indexer.py',
  'services/search/query.py',
  'services/ml/features.py',
  'pkg/gateway/proxy.go',
  'pkg/gateway/limiter.go',
  'pkg/store/redis.go',
  'cmd/migrate/main.go',
  'internal/scheduler/queue.rs',
  'internal/scheduler/worker.rs',
  'app/models/account.rb',
  'app/controllers/sessions_controller.rb',
  'lib/parser/tokenizer.ts',
  'lib/parser/ast.ts',
  'config/webpack.prod.js',
  'scripts/deploy.sh',
  'infra/terraform/main.tf',
  'Dockerfile',
  '.github/workflows/ci.yml',
];

/** Tool names the streamed "tool_running" phase pretends to invoke. */
export const TOOLS: string[] = [
  'Read',
  'Grep',
  'Glob',
  'Bash(rg -n)',
  'Bash(npm test)',
  'Edit',
  'Write',
  'Bash(git diff)',
  'Bash(semgrep)',
];

/** Assistant-channel lines (the visible reply text). `$f`/`$verb` substituted. */
export const ASSISTANT_LINES: string[] = [
  'Reading $f to map its surface area…',
  'Found 3 exported entrypoints; checking each for unchecked input.',
  'This branch handles user input without validation — flagging it.',
  'Cross-referencing against the shared FAQ so I do not re-flag known issues.',
  'Drafting an assertion that survives mutation (behavior, not implementation).',
  'Pattern looks safe: parameterized query, no string concatenation.',
  'Appending a finding with severity and a cheatsheet link.',
  'Writing my notes back to the shared blackboard for later steps.',
  'Done $verb $f — handing off to consolidation.',
];

/** Thinking-channel lines (console-only reasoning trace). */
export const THINKING_LINES: string[] = [
  'Considering how to handle $f without re-deriving what earlier agents found…',
  'The contract says report-only, so I must not touch production source.',
  'If this is already in the FAQ I should skip it to keep entries deduped.',
  'Severity here is warn, not critical — the input is length-bounded upstream.',
  'I will phrase the assertion around observable behavior to survive refactors.',
];

/** Log-channel templates (the on-page run log + per-card logs). */
export const LOG_LINES: string[] = [
  'agent #$id starting on $f',
  'read $f ($lines lines)',
  'grep: $n matches for the risky pattern',
  'invoking $tool',
  '$tool returned in ${ms}ms',
  'appended 1 finding to the shared FAQ',
  'wrote notes for $f',
  'no production source modified (report-only)',
];

/** Memory-guard kill lines (requeue scenario). */
export const GUARD_LINES: string[] = [
  'MEMORY GUARD: RAM at $ram% — killing newest agent #$id (least work done)',
  'requeued task for $f to the front of the queue (↻$n)',
];

/** Retryable error messages (error+retry scenario). */
export const RETRY_ERRORS: string[] = [
  'attempt $a failed: card timeout after 120s — retrying',
  'attempt $a failed: provider returned 529 (overloaded) — retrying',
  'attempt $a failed: transient stream reset — retrying',
];

/** Terminal error messages (permanent-error scenario). */
export const FATAL_ERRORS: string[] = [
  'card timed out twice; giving up on this file',
  'agent exited non-zero after retry budget exhausted',
];

/** Merge log lines (stage integration card). */
export const MERGE_LINES: string[] = [
  'merging $n agent branches into integration (ascending, --no-ff)',
  'fast-forward clean: $n/$n branches merged',
  'resolved 1 trivial conflict in $f via 3-way',
  'stage merge committed at $sha',
];

/** Judge reasons keyed by outcome. */
export const JUDGE_REASONS: Record<'approved' | 'rework', string[]> = {
  approved: [
    'All sections present; FAQ counts reconcile with the report. Approving.',
    'Report-only contract held and ordering is correct. Approving.',
  ],
  rework: [
    'Section "Summary by severity" is missing two categories — sending back for rework.',
    'FAQ has 14 findings but the report lists 12; counts must reconcile — rework.',
  ],
};

/**
 * Expand the per-file pool to exactly `n` distinct-looking paths. Cycles the
 * pool and appends a numeric suffix once it wraps so cards never collide.
 */
export function pickFiles(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const base = FILE_POOL[i % FILE_POOL.length]!;
    if (i < FILE_POOL.length) {
      out.push(base);
    } else {
      const dot = base.lastIndexOf('.');
      const round = Math.floor(i / FILE_POOL.length) + 1;
      out.push(dot > 0 ? `${base.slice(0, dot)}.${round}${base.slice(dot)}` : `${base}.${round}`);
    }
  }
  return out;
}

/** Fill `$token` placeholders from a flat map. Unknown tokens are left as-is. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\$\{?(\w+)\}?/g, (m, key: string) =>
    key in vars ? String(vars[key]) : m,
  );
}
