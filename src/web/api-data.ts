/**
 * Pure data assembly for the web UI's REST surface. Every function here is
 * a thin, side-effect-light projection over the same libraries the TUI uses
 * (backend registry, model catalog, api-key registry, pipeline I/O) so the
 * browser sees exactly the choices the Ink screens offer. Kept separate from
 * the HTTP plumbing in `server.ts` so it can be unit-tested without a socket.
 */

import { basename, dirname, join, parse } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import {
  ALL_BACKENDS,
  selectBackend,
  type AgentBackendKind,
} from '../orchestrator/backends/registry.js';
import {
  findSpec,
  resolveApiKey,
  findMissingKeysForBackend,
  findMissingKeysForProvider,
  type ApiKeySpec,
} from '../lib/api-key.js';
import {
  checkOpenRouterReachable,
  listAllModels,
} from '../lib/openrouter.js';
import { checkAzureReachable } from '../lib/azure.js';
import { PROVIDERS, type ProviderInfo } from '../lib/providers.js';
import { loadRecommendedModels } from '../models/catalog.js';
import { supportsThinking } from '../lib/model-factory.js';
import {
  listAllPipelines,
  listPipelinesInMemory,
  type PipelineEntry,
} from '../lib/pipeline-io.js';
import { ensureAllDefaultPipelines } from '../lib/pipeline-bootstrap.js';
import {
  isCheckStep,
  type LlmProvider,
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
  /**
   * Registry name of this backend's primary credential (e.g. 'openrouter').
   * The browser uses it to look up the per-session key it keeps in memory
   * and to send that key with each run — see the browser-only key flow.
   */
  apiKeySpecName?: string;
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
  /**
   * Whether the model advertises tool calling (live OpenRouter catalog only).
   * huu's agents require it; surfaced so the picker can warn when it's absent
   * rather than silently hiding the model. Undefined for the static catalog.
   */
  tools?: boolean;
  /** Context window in tokens, when known (live OpenRouter catalog only). */
  contextLength?: number;
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
  /** One-line summary shown on the launch cards. */
  description?: string;
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
  if (kind === 'pi') {
    return findMissingKeysForBackend('pi').length === 0;
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
      apiKeySpecName: b.apiKeySpecName,
      userSelectable: b.userSelectable,
    };
  });
}

/**
 * Result of validating a pasted key BEFORE it is used. The browser-only
 * key flow blocks on this: a key that comes back `invalid` (the provider
 * actively rejected it with 401/403 — the exact failure that motivated
 * this) is never accepted; `unverifiable` (offline/VPN, or a backend with
 * no cheap probe) is accepted with a warning so users aren't hard-blocked.
 */
export type KeyValidation =
  | { status: 'valid' }
  | { status: 'invalid'; httpStatus: number }
  | { status: 'unverifiable'; reason: string };

/**
 * Validate a key value against its provider without persisting anything.
 * Backend-aware: OpenRouter (pi) and Azure have real reachability probes;
 * other specs (Copilot token, the Azure endpoint URL) have no cheap
 * check and come back `unverifiable`.
 */
export async function validateKeyValue(
  spec: ApiKeySpec,
  value: string,
  opts?: { endpoint?: string },
): Promise<KeyValidation> {
  const v = value.trim();
  if (!v) return { status: 'unverifiable', reason: 'empty value' };

  if (spec.name === 'openrouter') {
    const r = await checkOpenRouterReachable(v);
    if (r.kind === 'ok') return { status: 'valid' };
    if (r.kind === 'unauthorized') return { status: 'invalid', httpStatus: r.status };
    return { status: 'unverifiable', reason: r.reason };
  }

  if (spec.name === 'azureApiKey') {
    const endpoint = opts?.endpoint?.trim();
    if (!endpoint) return { status: 'unverifiable', reason: 'endpoint required to validate' };
    const r = await checkAzureReachable(v, endpoint);
    if (r.kind === 'ok') return { status: 'valid' };
    if (r.kind === 'unauthorized') return { status: 'invalid', httpStatus: r.status };
    return { status: 'unverifiable', reason: r.reason };
  }

  // Copilot token / Azure endpoint URL / future specs: no cheap probe.
  return { status: 'unverifiable', reason: 'no validator for this key' };
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

/**
 * Models offered for a backend in the web UI.
 *
 * For OpenRouter (`pi`) this is the FULL LIVE catalog — every model, annotated
 * with `tools`/`thinking` so the picker can badge capability instead of hiding
 * models. OpenRouter's `GET /models` is PUBLIC, so the catalog is downloaded
 * even with NO key: the user sees all ~339 models the moment they open the
 * Model picker, not just the handful of static presets. (It used to require a
 * validated key AND hard-filter to tool+reasoning models, which left a key-less
 * user staring at the recommended shortlist.) Only on a real failure
 * (network/timeout/empty result) does it fall back to the static recommended
 * catalog, so the picker is never empty. Azure and stub always use the static
 * catalog.
 *
 * `openrouterKey` arrives via the browser-only flow (the `x-huu-key` header the
 * client sends once the user has validated it); OPTIONAL for listing — used in
 * memory only when present, never logged or persisted here.
 */
export async function listModelsForBackend(
  cwd: string,
  backend: AgentBackendKind,
  openrouterKey: string,
): Promise<{ models: ModelInfo[]; source: 'openrouter-live' | 'recommended' }> {
  if (backend === 'pi') {
    try {
      const live = await listAllModels(openrouterKey.trim());
      if (live.length > 0) {
        return {
          source: 'openrouter-live',
          models: live.map((m) => ({
            id: m.id,
            label: m.name,
            inputPrice: m.inputPricePerM,
            outputPrice: m.outputPricePerM,
            contextLength: m.contextLength,
            thinking: Boolean(m.supportsReasoning),
            tools: Boolean(m.supportsTools),
          })),
        };
      }
    } catch {
      // network/timeout/HTTP error → fall back to the static catalog below
    }
  }
  return { models: listModelsInfo(cwd, backend), source: 'recommended' };
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
  const missing = findMissingKeysForBackend(backend as 'pi' | 'azure').map(
    specToInfo,
  );
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
    description: pipeline.description,
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

// ── Providers ────────────────────────────────────────────────────────────

export interface ProviderUiInfo {
  id: LlmProvider;
  /** Concrete dispatch backend for model/key lookups (`pi` or `azure`). */
  backend: AgentBackendKind;
  label: string;
  description: string;
  /** Credential specs this provider needs, with live presence. */
  keySpecs: KeySpecInfo[];
  /** True when every required credential resolves — the run can launch. */
  hasKey: boolean;
}

/**
 * The user-facing provider choices for the pi backend (OpenRouter / Azure AI
 * Foundry), each annotated with the credential specs it needs and whether
 * they're already resolvable. Drives the web provider selector.
 */
export function listProvidersInfo(): ProviderUiInfo[] {
  return PROVIDERS.map((p: ProviderInfo) => {
    const specs: ApiKeySpec[] = [];
    const keySpec = findSpec(p.apiKeySpecName);
    if (keySpec) specs.push(keySpec);
    if (p.endpointSpecName) {
      const ep = findSpec(p.endpointSpecName);
      if (ep) specs.push(ep);
    }
    return {
      id: p.id,
      backend: p.backend,
      label: p.label,
      description: p.description,
      keySpecs: specs.map(specToInfo),
      hasKey: findMissingKeysForProvider(p.id).length === 0,
    };
  });
}

// ── Filesystem folder navigation (run-directory picker) ──────────────────

export interface DirEntryInfo {
  name: string;
  path: string;
}

export interface DirListing {
  path: string;
  /** Parent directory, or null at the filesystem root. */
  parent: string | null;
  /** True when the directory is a git repo (a valid run target). */
  isGitRepo: boolean;
  entries: DirEntryInfo[];
}

/**
 * List the sub-directories of `target` for the web folder picker. Dotfolders
 * are hidden to keep the list readable. Unreadable directories yield an empty
 * entry list rather than throwing, so the browser can still navigate away.
 * Falls back to the process cwd when the path doesn't exist.
 */
export function listDirs(target: string): DirListing {
  const path = target && existsSync(target) ? target : process.cwd();
  let entries: DirEntryInfo[] = [];
  try {
    entries = readdirSync(path, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: join(path, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    entries = [];
  }
  const root = parse(path).root;
  return {
    path,
    parent: path === root ? null : dirname(path),
    isGitRepo: existsSync(join(path, '.git')),
    entries,
  };
}
