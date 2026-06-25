/**
 * Pure data assembly for the web UI's REST surface. Every function here is
 * a thin, side-effect-light projection over the same libraries the TUI uses
 * (backend registry, model catalog, api-key registry, pipeline I/O) so the
 * browser sees exactly the choices the Ink screens offer. Kept separate from
 * the HTTP plumbing in `server.ts` so it can be unit-tested without a socket.
 */

import { basename } from 'node:path';
import {
  ALL_BACKENDS,
  selectBackend,
  type AgentBackendKind,
} from '../orchestrator/backends/registry.js';
import {
  findSpec,
  resolveApiKey,
  findMissingKeysForBackend,
  type ApiKeySpec,
} from '../lib/api-key.js';
import { loadRecommendedModels } from '../models/catalog.js';
import { supportsThinking } from '../lib/model-factory.js';
import {
  listAllPipelines,
  listPipelinesInMemory,
  type PipelineEntry,
} from '../lib/pipeline-io.js';
import { ensureAllDefaultPipelines } from '../lib/pipeline-bootstrap.js';
import { join } from 'node:path';
import {
  isCheckStep,
  type Pipeline,
  type PipelineStep,
} from '../lib/types.js';

export interface BackendInfo {
  id: AgentBackendKind;
  label: string;
  description: string;
  requiresApiKey: boolean;
  /** True when a usable key is already resolvable (env, mount, or saved). */
  hasKey: boolean;
  /** False for stub — surfaced as a no-cost "demo" backend in the UI. */
  userSelectable: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  inputPrice?: number;
  outputPrice?: number;
  description?: string;
  bestFor?: string[];
  tier?: string;
  thinking: boolean;
}

export interface KeySpecInfo {
  name: string;
  label: string;
  hint?: string;
  validatePrefix?: string;
  present: boolean;
}

export interface KeyStatus {
  /** True when nothing is missing for this backend — the run can launch. */
  ok: boolean;
  missing: KeySpecInfo[];
}

export interface StepInfo {
  name: string;
  type: 'work' | 'check';
  scope?: string;
  /** Short, human description of what the node does (prompt/condition head). */
  summary: string;
}

export interface PipelineInfo {
  name: string;
  source: 'local' | 'global' | 'memory';
  fileName?: string;
  stepCount: number;
  workSteps: number;
  checkSteps: number;
  isDefault: boolean;
  steps: StepInfo[];
}

function backendHasKey(kind: AgentBackendKind): boolean {
  const bundle = selectBackend(kind);
  if (!bundle.requiresApiKey) return true;
  if (kind === 'azure') {
    // Azure needs BOTH the key and the endpoint to actually run.
    return findMissingKeysForBackend('azure').length === 0;
  }
  if (kind === 'pi' || kind === 'copilot') {
    return findMissingKeysForBackend(kind).length === 0;
  }
  return true;
}

/** Every backend the browser may offer, annotated with live key presence. */
export function listBackendsInfo(): BackendInfo[] {
  return ALL_BACKENDS.map((id) => {
    const b = selectBackend(id);
    return {
      id,
      label: b.label,
      description: b.description,
      requiresApiKey: b.requiresApiKey,
      hasKey: backendHasKey(id),
      userSelectable: b.userSelectable,
    };
  });
}

/** Selectable models for a backend, with thinking-capability annotation. */
export function listModelsInfo(
  cwd: string,
  backend: AgentBackendKind,
): ModelInfo[] {
  const models = loadRecommendedModels(cwd, backend);
  return models.map((m) => ({
    id: m.id,
    label: m.label,
    inputPrice: m.inputPrice,
    outputPrice: m.outputPrice,
    description: m.description,
    bestFor: m.bestFor ? [...m.bestFor] : undefined,
    tier: m.tier,
    thinking: supportsThinking(m.id),
  }));
}

function specToInfo(spec: ApiKeySpec): KeySpecInfo {
  return {
    name: spec.name,
    label: spec.label,
    hint: spec.hint,
    validatePrefix: spec.validatePrefix,
    present: Boolean(resolveApiKey(spec)),
  };
}

/** Which credentials (if any) the given backend still needs before a run. */
export function keyStatus(backend: AgentBackendKind): KeyStatus {
  const bundle = selectBackend(backend);
  if (!bundle.requiresApiKey || backend === 'stub') {
    return { ok: true, missing: [] };
  }
  const missing = findMissingKeysForBackend(
    backend as 'pi' | 'copilot' | 'azure',
  ).map(specToInfo);
  return { ok: missing.length === 0, missing };
}

/** Look up a single key spec by registry name (for persistence endpoints). */
export function findKeySpec(name: string): ApiKeySpec | undefined {
  return findSpec(name);
}

function stepSummary(step: PipelineStep): string {
  if (isCheckStep(step)) {
    return step.condition.slice(0, 160);
  }
  return step.prompt.split('\n')[0]?.slice(0, 160) ?? '';
}

function toStepInfo(step: PipelineStep): StepInfo {
  if (isCheckStep(step)) {
    return { name: step.name, type: 'check', summary: stepSummary(step) };
  }
  return {
    name: step.name,
    type: 'work',
    scope: step.scope,
    summary: stepSummary(step),
  };
}

function toPipelineInfo(
  pipeline: Pipeline,
  source: PipelineInfo['source'],
  fileName?: string,
): PipelineInfo {
  const work = pipeline.steps.filter((s) => !isCheckStep(s)).length;
  const check = pipeline.steps.length - work;
  return {
    name: pipeline.name,
    source,
    fileName,
    stepCount: pipeline.steps.length,
    workSteps: work,
    checkSteps: check,
    isDefault: Boolean(pipeline._default),
    steps: pipeline.steps.map(toStepInfo),
  };
}

/**
 * List every pipeline the browser can launch: bundled defaults (materialized
 * on demand, idempotently), local `pipelines/`, the global store, and saved
 * memory entries. Defaults sort first, with the `_default` one at the top.
 */
export function listPipelinesInfo(cwd: string): PipelineInfo[] {
  // Materialize the bundled catalog so a fresh repo shows the defaults too.
  // Best-effort: a read-only repo just yields whatever already exists.
  try {
    ensureAllDefaultPipelines(cwd);
  } catch {
    /* read-only fs — fall through to whatever is listable */
  }

  const seen = new Set<string>();
  const out: PipelineInfo[] = [];

  const fileEntries: PipelineEntry[] = listAllPipelines(join(cwd, 'pipelines'));
  for (const entry of fileEntries) {
    if (seen.has(entry.pipeline.name)) continue;
    seen.add(entry.pipeline.name);
    out.push(toPipelineInfo(entry.pipeline, entry.source, entry.fileName));
  }

  for (const mem of listPipelinesInMemory()) {
    if (seen.has(mem.pipeline.name)) continue;
    seen.add(mem.pipeline.name);
    out.push(toPipelineInfo(mem.pipeline, 'memory'));
  }

  return out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Resolve a pipeline by name across all sources. Null when not found. */
export function getPipelineByName(cwd: string, name: string): Pipeline | null {
  const fileEntries = listAllPipelines(join(cwd, 'pipelines'));
  const match = fileEntries.find((e) => e.pipeline.name === name);
  if (match) return match.pipeline;
  const mem = listPipelinesInMemory().find((m) => m.pipeline.name === name);
  return mem ? mem.pipeline : null;
}

/** Friendly repo label for the header (basename of the working dir). */
export function repoName(cwd: string): string {
  return basename(cwd) || cwd;
}
