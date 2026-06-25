import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
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
  /** DAG edges (GitHub-Actions `needs` style) — earlier step names only. */
  dependsOn: z.array(z.string().min(1)).optional(),
  next: z.string().min(1).optional(),
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
  steps: z.array(PipelineStepSchema).min(1),
  cardTimeoutMs: z.number().int().positive().optional(),
  singleFileCardTimeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).max(3).optional(),
  maxNodeExecutions: z.number().int().positive().max(1000).optional(),
  portAllocation: PortAllocationSchema.optional(),
  integrationModelId: z.string().min(1).optional(),
  _default: z.boolean().optional(),
}).superRefine((pipeline, ctx) => {
  validateTopology(pipeline as Pipeline, ctx);
});

const FORMAT_TAG_V2 = 'huu-pipeline-v2';
const FORMAT_TAG_V1 = 'huu-pipeline-v1';
const LEGACY_FORMAT_TAG = 'programatic-agent-pipeline-v1';

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
