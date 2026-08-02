import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { minimatch } from 'minimatch';
import type { Pipeline, PipelineStep } from './types.js';
import { DEFAULT_CHECK_MAX_RUNS } from './types.js';
import { getHuuHome } from './huu-home.js';
import {
  savePipelineToMemory,
  loadPipelineFromMemory,
  deletePipelineFromMemory,
  listPipelinesInMemory,
  pipelineExistsInMemory,
} from './pipeline-memory.js';

export {
  savePipelineToMemory,
  loadPipelineFromMemory,
  deletePipelineFromMemory,
  listPipelinesInMemory,
  pipelineExistsInMemory,
};

const StepScopeSchema = z.enum(['project', 'per-file', 'flexible', 'memory']);

const ReviewSeveritySchema = z.enum(['blocker', 'major', 'minor', 'nit']);

/**
 * Per-task generator → critic loop (see `ReviewSpec` in types.ts). Only
 * declared on WORK steps: a check step already IS a judge, and it runs after
 * the merge in the integration worktree, so a `review` there would have no
 * worktree to audit and no agent to send findings back to. `CheckStepSchema`
 * deliberately gains nothing — an unknown key there is dropped on parse, so
 * the field can never reach the orchestrator through a check step.
 *
 * The bounds are safety rails, not preferences: rounds cost a whole extra
 * agent turn each (a reviewed card can take `cardTimeout × (1 + maxRounds)`
 * of wall clock), an empty `blockOn` would be a loop that can never converge
 * on anything, and a large `maxFindings` invites a critic to manufacture
 * volume past its own output ceiling.
 */
const ReviewSpecSchema = z.object({
  prompt: z.string().min(1),
  maxRounds: z.number().int().min(1).max(4).optional(),
  blockOn: z.array(ReviewSeveritySchema).min(1).optional(),
  modelId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxFindings: z.number().int().min(1).max(50).optional(),
  verifyCommands: z.array(z.string().min(1)).optional(),
  findingsDir: z.string().min(1).optional(),
  onBlocked: z.enum(['waive', 'hold']).optional(),
});

const AcceptSchema = z.object({
  command: z.string().min(1),
  expectExit: z.number().int().optional(),
  cwd: z.enum(['worktree', 'integration']).optional(),
}).optional();

const WorkStepSchema = z.object({
  type: z.literal('work').optional(),
  name: z.string().min(1),
  prompt: z.string(),
  files: z.array(z.string()).default([]),
  modelId: z.string().min(1).optional(),
  scope: StepScopeSchema.optional(),
  /** memory scope: repo-relative path of the huu-memory-v1 file an earlier step writes. */
  filesFrom: z.string().min(1).optional(),
  /** memory scope: fan-out width cap (default DEFAULT_MEMORY_MAX_FILES). */
  maxFiles: z.number().int().positive().max(100).optional(),
  /** Path of the huu-memory-v1 file this step promises to write (contract auto-appended at run time). */
  produces: z.string().min(1).optional(),
  /** Globs declaring the filesystem surface this step's agents are allowed to write. */
  writes: z.array(z.string().min(1)).optional(),
  /** REPORT-ONLY step: the backend withholds the edit/write tools entirely. */
  readOnly: z.boolean().optional(),
  /** DAG edges (GitHub-Actions `needs` style) — earlier step names only. */
  dependsOn: z.array(z.string().min(1)).optional(),
  next: z.string().min(1).optional(),
  /** Per-task critic loop, run in the worker's worktree BEFORE the merge. */
  review: ReviewSpecSchema.optional(),
  /** Acceptance gate — shell command run BEFORE the agent spawns. */
  accept: AcceptSchema,
});

const CheckOutcomeSchema = z.object({
  label: z.string().min(1),
  nextStepName: z.string().min(1),
  default: z.boolean().optional(),
});

const CheckStepSchema = z.object({
  type: z.literal('check'),
  name: z.string().min(1),
  condition: z.string().min(1),
  instructionDraft: z.string().optional(),
  outcomes: z.array(CheckOutcomeSchema).min(1),
  maxRuns: z.number().int().positive().optional(),
  modelId: z.string().min(1).optional(),
  /** DAG edges (GitHub-Actions `needs` style) — earlier step names only. */
  dependsOn: z.array(z.string().min(1)).optional(),
});

/**
 * Discriminated step schema. Note: `WorkStep.type` is OPTIONAL so legacy
 * v1 pipelines (no `type` field at all) still parse. We can't use Zod's
 * `discriminatedUnion` here because it requires the discriminant on every
 * branch. The `union` below tries CheckStep first (strict literal) and
 * falls through to WorkStep otherwise.
 */
const PipelineStepSchema = z.union([CheckStepSchema, WorkStepSchema]);

const PortAllocationSchema = z.object({
  basePort: z.number().int().positive().optional(),
  windowSize: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

export const PipelineSchema = z.object({
  name: z.string().min(1),
  /** One-line human-facing summary shown at launch. Optional (back-compat). */
  description: z.string().max(280).optional(),
  steps: z.array(PipelineStepSchema).min(1),
  cardTimeoutMs: z.number().int().positive().optional(),
  singleFileCardTimeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).max(3).optional(),
  maxNodeExecutions: z.number().int().positive().max(1000).optional(),
  portAllocation: PortAllocationSchema.optional(),
  integrationModelId: z.string().min(1).optional(),
  mergeGate: z.string().min(1).optional(),
  _default: z.boolean().optional(),
}).superRefine((pipeline, ctx) => {
  validateTopology(pipeline as Pipeline, ctx);
});

const FORMAT_TAG_V2 = 'huu-pipeline-v2';
const FORMAT_TAG_V1 = 'huu-pipeline-v1';
const LEGACY_FORMAT_TAG = 'programatic-agent-pipeline-v1';

// True when two glob patterns COULD match the same path.
// Each glob's static prefix (before the first wildcard) is extracted;
// if a representative path built from either prefix matches both globs,
// they intersect. When neither has a static prefix, conservatively
// assume overlap.
export function globsIntersect(a: string, b: string): boolean {
  if (a === b) return true;
  const prefixLen = (g: string): number => {
    let i = 0;
    for (; i < g.length; i++) {
      const ch = g[i]!;
      if (ch === '*' || ch === '?' || ch === '[' || ch === '{') break;
    }
    return i;
  };
  const pa = a.slice(0, prefixLen(a)).replace(/\/$/, '');
  const pb = b.slice(0, prefixLen(b)).replace(/\/$/, '');
  // Build a representative file path from each prefix by appending a
  // synthetic child. A prefix that already names a file (has an extension)
  // is used as-is.
  const childPath = (p: string): string => {
    if (!p) return '';
    if (/\.[a-z]{1,6}$/i.test(p)) return p;
    return p + '/_huu_x.ts';
  };
  const testPaths: string[] = [];
  const cpa = childPath(pa);
  const cpb = childPath(pb);
  if (cpa) testPaths.push(cpa);
  if (cpb) testPaths.push(cpb);
  if (testPaths.length === 0) return true;
  for (const tp of testPaths) {
    if (minimatch(tp, a) && minimatch(tp, b)) return true;
  }
  return false;
}

const PipelineFileSchema = z.union([
  z.object({
    _format: z.union([
      z.literal(FORMAT_TAG_V2),
      z.literal(FORMAT_TAG_V1),
      z.literal(LEGACY_FORMAT_TAG),
    ]),
    exportedAt: z.string().optional(),
    pipeline: PipelineSchema,
  }),
  PipelineSchema,
]);

/**
 * Topology check: names unique, every `next`/`outcomes[].nextStepName`
 * resolves to an existing step, and every CheckStep has exactly one
 * `default: true` outcome. Runs as a Zod superRefine so callers can rely
 * on schema parse errors carrying the topology violations too.
 */
export function validateTopology(
  pipeline: { name: string; steps: PipelineStep[] },
  ctx?: z.RefinementCtx,
): string[] {
  const errors: string[] = [];
  const addError = (msg: string, path: (string | number)[]): void => {
    errors.push(msg);
    ctx?.addIssue({ code: z.ZodIssueCode.custom, message: msg, path });
  };

  const names = new Map<string, number>();
  pipeline.steps.forEach((step, i) => {
    const existing = names.get(step.name);
    if (existing !== undefined) {
      addError(`duplicate step name "${step.name}" (also at index ${existing})`, ['steps', i, 'name']);
    } else {
      names.set(step.name, i);
    }
  });

  const exists = (name: string): boolean => names.has(name);

  // Two steps promising to write the SAME memory file would race in the
  // integration worktree — the later merge silently wins. Reject upfront.
  const producesByPath = new Map<string, number>();
  pipeline.steps.forEach((step, i) => {
    if (step.type === 'check' || step.produces === undefined) return;
    const prev = producesByPath.get(step.produces);
    if (prev !== undefined) {
      addError(
        `steps "${pipeline.steps[prev]!.name}" and "${step.name}" both declare produces "${step.produces}" — each memory file needs exactly one producer`,
        ['steps', i, 'produces'],
      );
    } else {
      producesByPath.set(step.produces, i);
    }
  });

  // Write-set disjunction: two steps in the SAME wave (concurrent) with
  // intersecting writes FAIL validation. Only applies when the pipeline
  // uses DAG edges (dependsOn) — linear pipelines run sequentially so
  // concurrent writes are structurally impossible.
  const hasWrites = pipeline.steps.some(
    (s) => s.type !== 'check' && s.writes && s.writes.length > 0,
  );
  const hasDag = pipeline.steps.some((s) => s.dependsOn !== undefined);
  if (hasWrites && hasDag) {
    const stepNames = pipeline.steps.map((s) => s.name);
    // Transitive dependency closure: step i transitively depends on step j
    // if j is in i's dependsOn (direct) or j is a transitive dep of any of
    // i's direct deps. Since deps only reference EARLIER steps, we can
    // compute bottom up in a single pass.
    const transDeps = new Map<number, Set<number>>();
    for (let i = 0; i < pipeline.steps.length; i++) {
      const deps = new Set<number>();
      const direct = pipeline.steps[i]!.dependsOn ?? [];
      for (const depName of direct) {
        const depIdx = stepNames.indexOf(depName);
        if (depIdx >= 0) {
          deps.add(depIdx);
          const subDeps = transDeps.get(depIdx);
          if (subDeps) for (const d of subDeps) deps.add(d);
        }
      }
      transDeps.set(i, deps);
    }
    // Check every pair of work steps with writes — concurrent (neither
    // depends on the other) + intersecting globs → error.
    for (let i = 0; i < pipeline.steps.length; i++) {
      const si = pipeline.steps[i]!;
      if (si.type === 'check' || !si.writes || si.writes.length === 0) continue;
      for (let j = i + 1; j < pipeline.steps.length; j++) {
        const sj = pipeline.steps[j]!;
        if (sj.type === 'check' || !sj.writes || sj.writes.length === 0) continue;
        // Concurrent iff neither transitively depends on the other.
        const iBeforeJ = transDeps.get(j)!.has(i);
        const jBeforeI = transDeps.get(i)!.has(j);
        if (iBeforeJ || jBeforeI) continue;
        for (const ga of si.writes) {
          for (const gb of sj.writes) {
            if (globsIntersect(ga, gb)) {
              addError(
                `steps "${si.name}" and "${sj.name}" have overlapping write-sets: "${ga}" intersects "${gb}" — concurrent steps must declare disjoint writes`,
                ['steps', j, 'writes'],
              );
            }
          }
        }
      }
    }
  }

  pipeline.steps.forEach((step, i) => {
    if (step.type === 'check') {
      const defaults = step.outcomes.filter((o) => o.default);
      if (defaults.length !== 1) {
        addError(
          `check step "${step.name}" must declare exactly one outcome with default=true (found ${defaults.length})`,
          ['steps', i, 'outcomes'],
        );
      }
      const labels = new Set<string>();
      step.outcomes.forEach((outcome, j) => {
        if (labels.has(outcome.label)) {
          addError(
            `check step "${step.name}" has duplicate outcome label "${outcome.label}"`,
            ['steps', i, 'outcomes', j, 'label'],
          );
        }
        labels.add(outcome.label);
        if (!exists(outcome.nextStepName)) {
          addError(
            `check step "${step.name}" outcome "${outcome.label}" → unknown step "${outcome.nextStepName}"`,
            ['steps', i, 'outcomes', j, 'nextStepName'],
          );
        }
      });
    } else {
      if (step.next !== undefined && !exists(step.next)) {
        addError(`work step "${step.name}".next → unknown step "${step.next}"`, ['steps', i, 'next']);
      }
      // `memory` scope contract: the file list comes from a huu-memory-v1
      // JSON an EARLIER step writes, so the step needs `filesFrom` and
      // cannot be the pipeline's first step (nothing ran yet to write it).
      if (step.scope === 'memory') {
        if (!step.filesFrom) {
          addError(
            `work step "${step.name}" has scope "memory" but no filesFrom (path of the memory file an earlier step writes)`,
            ['steps', i, 'filesFrom'],
          );
        }
        if (i === 0) {
          addError(
            `work step "${step.name}" has scope "memory" but is the first step — no earlier step can have written its memory file`,
            ['steps', i, 'scope'],
          );
        }
      } else if (step.filesFrom !== undefined) {
        addError(
          `work step "${step.name}" sets filesFrom but its scope is not "memory"`,
          ['steps', i, 'filesFrom'],
        );
      }
    }

    // DAG edges: every dependsOn entry must name an EARLIER step. The array
    // stays the canonical merge/read order, which also makes dependency
    // cycles structurally impossible — loops belong to next/outcomes
    // (activation edges), never to dependsOn.
    if (step.dependsOn !== undefined) {
      step.dependsOn.forEach((dep, j) => {
        const depIdx = names.get(dep);
        if (depIdx === undefined) {
          addError(
            `step "${step.name}" dependsOn unknown step "${dep}"`,
            ['steps', i, 'dependsOn', j],
          );
        } else if (depIdx >= i) {
          addError(
            `step "${step.name}" dependsOn "${dep}", which is not an EARLIER step — dependencies must point backwards in the array (loops use next/outcomes)`,
            ['steps', i, 'dependsOn', j],
          );
        }
      });
    }
  });

  return errors;
}

/**
 * Replaces every `$runs` token in the condition text with the current
 * iteration counter (1-based). Pure string substitution — the LLM
 * judge is responsible for any actual arithmetic. Exported for use by
 * the check evaluator AND the setup-time feasibility analyzer.
 */
export function substituteRuns(condition: string, runs: number): string {
  return condition.replaceAll('$runs', String(runs));
}

function withDefaults(pipeline: Pipeline): Pipeline {
  return {
    ...pipeline,
    steps: pipeline.steps.map((step) => {
      if (step.type === 'check') {
        return {
          ...step,
          maxRuns: step.maxRuns ?? DEFAULT_CHECK_MAX_RUNS,
        };
      }
      // Don't inject type='work' explicitly — it's optional, and v1
      // pipelines round-trip cleanly without it.
      return step;
    }),
  } as Pipeline;
}

export function exportPipeline(pipeline: Pipeline, filePath: string): void {
  const validated = PipelineSchema.parse(pipeline) as Pipeline;
  const payload = {
    _format: FORMAT_TAG_V2,
    exportedAt: new Date().toISOString(),
    pipeline: validated,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

export function importPipeline(filePath: string): Pipeline {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const parsed = PipelineFileSchema.parse(raw);
  if ('pipeline' in parsed) return withDefaults(parsed.pipeline as Pipeline);
  return withDefaults(parsed as Pipeline);
}

/**
 * Parse a pipeline from a raw JSON string (e.g. pasted by the user).
 * Accepts both the wrapped format (`{ _format, pipeline }`) and bare pipeline objects.
 */
export function parsePipelineFromJson(json: string): Pipeline {
  const raw = JSON.parse(json);
  const parsed = PipelineFileSchema.parse(raw);
  if ('pipeline' in parsed) return withDefaults(parsed.pipeline as Pipeline);
  return withDefaults(parsed as Pipeline);
}

export interface PipelineEntry {
  fileName: string;
  filePath: string;
  pipeline: Pipeline;
  source: 'local' | 'global';
}

export function listPipelines(dir: string, source: 'local' | 'global' = 'local'): PipelineEntry[] {
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (!stat.isDirectory()) return [];

  const entries = readdirSync(dir);
  const results: PipelineEntry[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.pipeline.json')) continue;
    const filePath = `${dir}/${entry}`;
    const fileStat = statSync(filePath);
    if (!fileStat.isFile()) continue;
    try {
      const pipeline = importPipeline(filePath);
      results.push({ fileName: entry, filePath, pipeline, source });
    } catch {}
  }

  return results.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

const APP_DIR = '.huu';
const GLOBAL_PIPELINES_DIR = 'pipelines';

export function getGlobalPipelinesDir(): string {
  return join(getHuuHome(), APP_DIR, GLOBAL_PIPELINES_DIR);
}

export function listGlobalPipelines(): PipelineEntry[] {
  return listPipelines(getGlobalPipelinesDir(), 'global');
}

export function listAllPipelines(localDir: string): PipelineEntry[] {
  const local = listPipelines(localDir, 'local');
  const global = listGlobalPipelines();
  const seen = new Set<string>();
  const results: PipelineEntry[] = [];
  for (const entry of [...local, ...global]) {
    if (seen.has(entry.pipeline.name)) continue;
    seen.add(entry.pipeline.name);
    results.push(entry);
  }
  // Pin the `_default` pipeline (the "pipeline zero") to the top so the
  // Welcome screen can offer it as [0]. Stable: everything else keeps its
  // alphabetical order from listPipelines.
  results.sort(
    (a, b) => Number(b.pipeline._default === true) - Number(a.pipeline._default === true),
  );
  return results;
}

export function syncGlobalPipelines(sourceDir: string): void {
  const targetDir = getGlobalPipelinesDir();
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  const entries = listPipelines(sourceDir, 'local');
  for (const entry of entries) {
    const targetPath = join(targetDir, basename(entry.filePath));
    copyFileSync(entry.filePath, targetPath);
  }
}
