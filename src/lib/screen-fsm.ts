// This FSM is consumed by both the Ink TUI (src/app.tsx) and the upcoming
// web server (src/web/session.ts). Keep it pure and side-effect-free — all
// I/O (selectBackend, resolveApiKey, findMissingKeysForBackend, saveApiKey,
// exit(), terminal clears, …) happens in the caller and is passed back to
// the reducer via event payloads.

import type { ApiKeySpec } from './api-key.js';
import type { AgentBackendKind, OrchestratorResult, Pipeline } from './types.js';

export type Screen =
  | { kind: 'welcome' }
  | { kind: 'faq' }
  | { kind: 'pipeline-assistant' }
  | { kind: 'pipeline-editor' }
  | { kind: 'pipeline-import' }
  | { kind: 'pipeline-import-custom' }
  | { kind: 'pipeline-import-paste' }
  | { kind: 'pipeline-export' }
  | { kind: 'saved-pipelines' }
  | { kind: 'options'; focusSpecName?: string }
  | { kind: 'backend-selector' }
  | { kind: 'model-selector'; backendKind: AgentBackendKind }
  | { kind: 'api-key'; missing: ApiKeySpec[] }
  | { kind: 'timeout-prompt'; modelId: string; apiKey: string }
  | { kind: 'run'; modelId: string; apiKey: string }
  | { kind: 'summary'; result: OrchestratorResult };

export interface FsmState {
  screen: Screen;
  pipeline: Pipeline | null;
  modelId: string;
  backendKind: AgentBackendKind;
  apiKey: string;
  requiresApiKey: boolean;
  pipelineSourceName: string | null;
}

export type FsmEvent =
  // welcome
  | { type: 'welcome.assistant' }
  | { type: 'welcome.new' }
  | { type: 'welcome.import' }
  | { type: 'welcome.saved' }
  | { type: 'welcome.selectPipeline'; pipeline: Pipeline }
  | { type: 'welcome.faq' }
  | { type: 'welcome.options' }
  | { type: 'welcome.quit' }
  // options (provider/API-key editor)
  | { type: 'options.close' }
  // faq
  | { type: 'faq.back' }
  // pipeline-assistant
  | { type: 'assistant.complete'; pipeline: Pipeline }
  | { type: 'assistant.cancel' }
  // pipeline-editor
  | { type: 'editor.complete'; pipeline: Pipeline; initialBackendSet: boolean }
  | { type: 'editor.import' }
  | { type: 'editor.export'; pipeline: Pipeline }
  | { type: 'editor.cancel' }
  // backend-selector
  | {
      type: 'backend.select';
      backendKind: AgentBackendKind;
      requiresApiKey: boolean;
      skipModelSelector: boolean;
      firstStepModelId?: string;
    }
  | { type: 'backend.cancel' }
  // pipeline-import
  | { type: 'import.selectFromList'; pipeline: Pipeline }
  | { type: 'import.paste' }
  | { type: 'import.customPath' }
  | { type: 'import.cancel' }
  // pipeline-import-paste
  | { type: 'importPaste.complete'; pipeline: Pipeline }
  | { type: 'importPaste.cancel' }
  // pipeline-import-custom
  | { type: 'importCustom.complete'; pipeline: Pipeline | null }
  | { type: 'importCustom.cancel' }
  // pipeline-export
  | { type: 'export.complete' }
  | { type: 'export.cancel' }
  // saved-pipelines
  | { type: 'saved.select'; pipeline: Pipeline }
  | { type: 'saved.cancel' }
  // model-selector
  | {
      type: 'modelSelector.select';
      modelId: string;
      requiresApiKey: boolean;
      backendKind: AgentBackendKind;
      missingKeys: ApiKeySpec[];
      resolvedApiKey: string;
    }
  | { type: 'modelSelector.cancel'; initialBackendSet: boolean }
  // api-key
  | { type: 'apiKey.submit'; resolvedApiKey: string }
  | { type: 'apiKey.cancel' }
  // timeout-prompt
  | { type: 'timeout.submit'; minutes: number }
  | { type: 'timeout.cancel' }
  // skip-model-selector fast path: dispatched from editor.onComplete or
  // BackendSelector.onSelect when every pipeline step already pins its
  // own modelId (so the global model selector would never be consulted).
  // Mirrors the legacy `navigateToRunSkippingModel` helper: routes to
  // api-key when keys are missing, otherwise straight to `run`.
  | {
      type: 'runDirect';
      modelId: string;
      missingKeys: ApiKeySpec[];
      resolvedApiKey: string;
      /** When set, replaces state.pipeline (editor fast path). */
      pipeline?: Pipeline;
      /** When set, updates state.backendKind (backend-selector fast path). */
      backendKind?: AgentBackendKind;
      /** When set, overrides state.requiresApiKey (backend-selector fast path). */
      requiresApiKey?: boolean;
    }
  // run
  | { type: 'run.complete'; result: OrchestratorResult }
  | { type: 'run.abort' }
  // run → auth failure: jump to the Options screen pre-focused on the
  // rejected provider so the user can fix the key in place.
  | { type: 'run.authError'; backendKind: AgentBackendKind; specName?: string }
  // summary
  | { type: 'summary.back' }
  | { type: 'summary.quit' };

/** True when every step in the pipeline already has a per-step modelId. */
export function allStepsHaveModel(p: Pipeline | null): boolean {
  if (!p || p.steps.length === 0) return false;
  return p.steps.every((s) => !!s.modelId);
}

export interface InitialStateOpts {
  initialPipeline?: Pipeline;
  autoStart?: boolean;
  initialBackend?: AgentBackendKind;
  openrouterResolvedKey: string;
  requiresApiKey: boolean;
}

export function initialState(opts: InitialStateOpts): FsmState {
  return {
    screen:
      opts.autoStart && opts.initialPipeline
        ? { kind: 'pipeline-editor' }
        : { kind: 'welcome' },
    pipeline: opts.initialPipeline ?? null,
    modelId: '',
    backendKind: opts.initialBackend ?? 'pi',
    apiKey: opts.openrouterResolvedKey,
    requiresApiKey: opts.requiresApiKey,
    pipelineSourceName: null,
  };
}

/**
 * Pure reducer. NOTE on timeout handling: the `timeout.submit` event stores
 * the chosen ms on `state.pipeline.cardTimeoutMs` / `singleFileCardTimeoutMs`
 * (mirroring the existing app.tsx behavior at lines 526–532). That keeps the
 * pipeline self-describing when it reaches the orchestrator, instead of
 * smuggling a separate `timeoutMs` field through `FsmState`.
 */
export function reduce(state: FsmState, event: FsmEvent): FsmState {
  switch (event.type) {
    // ── welcome ───────────────────────────────────────────────────────────
    case 'welcome.assistant':
      return { ...state, screen: { kind: 'pipeline-assistant' } };
    case 'welcome.new':
      return { ...state, screen: { kind: 'pipeline-editor' } };
    case 'welcome.import':
      return { ...state, screen: { kind: 'pipeline-import' } };
    case 'welcome.saved':
      return { ...state, screen: { kind: 'saved-pipelines' } };
    case 'welcome.selectPipeline':
      return {
        ...state,
        pipeline: event.pipeline,
        screen: { kind: 'pipeline-editor' },
      };
    case 'welcome.quit':
      // Side effect (exit()) handled by caller; state is unchanged.
      return state;
    case 'welcome.faq':
      return { ...state, screen: { kind: 'faq' } };
    case 'welcome.options':
      return { ...state, screen: { kind: 'options' } };

    // ── options ───────────────────────────────────────────────────────────
    case 'options.close':
      return { ...state, screen: { kind: 'welcome' } };

    // ── faq ───────────────────────────────────────────────────────────────
    case 'faq.back':
      return { ...state, screen: { kind: 'welcome' } };

    // ── pipeline-assistant ────────────────────────────────────────────────
    case 'assistant.complete':
      return {
        ...state,
        pipeline: event.pipeline,
        screen: { kind: 'pipeline-editor' },
      };
    case 'assistant.cancel':
      return { ...state, screen: { kind: 'welcome' } };

    // ── pipeline-editor ───────────────────────────────────────────────────
    case 'editor.complete': {
      const p = event.pipeline;
      const all = allStepsHaveModel(p);
      const base: FsmState = { ...state, pipeline: p };
      if (all && event.initialBackendSet) {
        // Caller may intercept to insert an api-key gate; the FSM treats
        // this as the direct destination so the screen branch is decidable
        // from (allStepsHaveModel, initialBackendSet) alone.
        const mid = p.steps[0]!.modelId!;
        return {
          ...base,
          modelId: mid,
          screen: { kind: 'run', modelId: mid, apiKey: state.apiKey },
        };
      }
      if (!event.initialBackendSet) {
        return { ...base, screen: { kind: 'backend-selector' } };
      }
      return {
        ...base,
        screen: { kind: 'model-selector', backendKind: state.backendKind },
      };
    }
    case 'editor.import':
      return { ...state, screen: { kind: 'pipeline-import' } };
    case 'editor.export':
      return {
        ...state,
        pipeline: event.pipeline,
        screen: { kind: 'pipeline-export' },
      };
    case 'editor.cancel':
      return { ...state, screen: { kind: 'welcome' } };

    // ── backend-selector ──────────────────────────────────────────────────
    case 'backend.select': {
      const base: FsmState = {
        ...state,
        backendKind: event.backendKind,
        requiresApiKey: event.requiresApiKey,
      };
      if (event.skipModelSelector) {
        const mid = event.firstStepModelId!;
        return {
          ...base,
          modelId: mid,
          screen: { kind: 'run', modelId: mid, apiKey: state.apiKey },
        };
      }
      return {
        ...base,
        screen: { kind: 'model-selector', backendKind: event.backendKind },
      };
    }
    case 'backend.cancel':
      return { ...state, screen: { kind: 'pipeline-editor' } };

    // ── pipeline-import ───────────────────────────────────────────────────
    case 'import.selectFromList':
      return {
        ...state,
        pipeline: event.pipeline,
        screen: { kind: 'pipeline-editor' },
      };
    case 'import.paste':
      return { ...state, screen: { kind: 'pipeline-import-paste' } };
    case 'import.customPath':
      return { ...state, screen: { kind: 'pipeline-import-custom' } };
    case 'import.cancel':
      return {
        ...state,
        screen: state.pipeline ? { kind: 'pipeline-editor' } : { kind: 'welcome' },
      };

    // ── pipeline-import-paste ────────────────────────────────────────────
    case 'importPaste.complete':
      return {
        ...state,
        pipeline: event.pipeline,
        screen: { kind: 'pipeline-editor' },
      };
    case 'importPaste.cancel':
      return { ...state, screen: { kind: 'pipeline-import' } };

    // ── pipeline-import-custom ───────────────────────────────────────────
    case 'importCustom.complete':
      if (event.pipeline) {
        return {
          ...state,
          pipeline: event.pipeline,
          screen: { kind: 'pipeline-editor' },
        };
      }
      // Matches existing app.tsx: when no pipeline is loaded, the screen
      // doesn't advance (PipelineIOScreen will keep rendering / re-prompt).
      return state;
    case 'importCustom.cancel':
      return { ...state, screen: { kind: 'pipeline-import' } };

    // ── pipeline-export ──────────────────────────────────────────────────
    case 'export.complete':
    case 'export.cancel':
      return { ...state, screen: { kind: 'pipeline-editor' } };

    // ── saved-pipelines ──────────────────────────────────────────────────
    case 'saved.select':
      return {
        ...state,
        pipeline: event.pipeline,
        pipelineSourceName: event.pipeline.name,
        screen: { kind: 'pipeline-editor' },
      };
    case 'saved.cancel':
      return { ...state, screen: { kind: 'welcome' } };

    // ── model-selector ───────────────────────────────────────────────────
    case 'modelSelector.select': {
      const base: FsmState = {
        ...state,
        modelId: event.modelId,
        backendKind: event.backendKind,
      };
      if (!event.requiresApiKey || event.backendKind === 'stub') {
        return {
          ...base,
          screen: {
            kind: 'timeout-prompt',
            modelId: event.modelId,
            apiKey: state.apiKey,
          },
        };
      }
      if (event.missingKeys.length > 0) {
        return {
          ...base,
          screen: { kind: 'api-key', missing: event.missingKeys },
        };
      }
      return {
        ...base,
        apiKey: event.resolvedApiKey,
        screen: {
          kind: 'timeout-prompt',
          modelId: event.modelId,
          apiKey: event.resolvedApiKey,
        },
      };
    }
    case 'modelSelector.cancel':
      return {
        ...state,
        screen: event.initialBackendSet
          ? { kind: 'pipeline-editor' }
          : { kind: 'backend-selector' },
      };

    // ── api-key ──────────────────────────────────────────────────────────
    case 'apiKey.submit':
      return {
        ...state,
        apiKey: event.resolvedApiKey,
        screen: {
          kind: 'timeout-prompt',
          modelId: state.modelId,
          apiKey: event.resolvedApiKey,
        },
      };
    case 'apiKey.cancel':
      return {
        ...state,
        screen: { kind: 'model-selector', backendKind: state.backendKind },
      };

    // ── timeout-prompt ───────────────────────────────────────────────────
    case 'timeout.submit': {
      const ms = event.minutes * 60_000;
      const newPipeline: Pipeline | null = state.pipeline
        ? { ...state.pipeline, cardTimeoutMs: ms, singleFileCardTimeoutMs: ms }
        : state.pipeline;
      // Pull modelId/apiKey off the timeout-prompt screen when present
      // (mirrors app.tsx line 531: `screen.modelId` / `screen.apiKey`),
      // otherwise fall back to the top-level state copies.
      const cur = state.screen;
      const mid = cur.kind === 'timeout-prompt' ? cur.modelId : state.modelId;
      const ak = cur.kind === 'timeout-prompt' ? cur.apiKey : state.apiKey;
      return {
        ...state,
        pipeline: newPipeline,
        screen: { kind: 'run', modelId: mid, apiKey: ak },
      };
    }
    case 'timeout.cancel':
      return {
        ...state,
        screen: { kind: 'model-selector', backendKind: state.backendKind },
      };

    // ── runDirect (skip-model fast path) ─────────────────────────────────
    case 'runDirect': {
      const backendKind = event.backendKind ?? state.backendKind;
      const requiresApiKey = event.requiresApiKey ?? state.requiresApiKey;
      const base: FsmState = {
        ...state,
        ...(event.pipeline !== undefined ? { pipeline: event.pipeline } : {}),
        backendKind,
        requiresApiKey,
        modelId: event.modelId,
      };
      if (!requiresApiKey || backendKind === 'stub') {
        return {
          ...base,
          screen: { kind: 'run', modelId: event.modelId, apiKey: state.apiKey },
        };
      }
      if (event.missingKeys.length > 0) {
        return {
          ...base,
          screen: { kind: 'api-key', missing: event.missingKeys },
        };
      }
      return {
        ...base,
        apiKey: event.resolvedApiKey,
        screen: { kind: 'run', modelId: event.modelId, apiKey: event.resolvedApiKey },
      };
    }

    // ── run ──────────────────────────────────────────────────────────────
    case 'run.complete':
      return { ...state, screen: { kind: 'summary', result: event.result } };
    case 'run.abort':
      return { ...state, screen: { kind: 'pipeline-editor' } };
    case 'run.authError':
      return {
        ...state,
        backendKind: event.backendKind,
        screen: { kind: 'options', focusSpecName: event.specName },
      };

    // ── summary ──────────────────────────────────────────────────────────
    case 'summary.back':
      return { ...state, screen: { kind: 'pipeline-editor' } };
    case 'summary.quit':
      // Side effect (exit()) handled by caller; state is unchanged.
      return state;
  }
}
