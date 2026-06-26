import { describe, it, expect } from 'vitest';
import {
  allStepsHaveModel,
  initialState,
  reduce,
  type FsmState,
  type Screen,
} from './screen-fsm.js';
import type { ApiKeySpec } from './api-key.js';
import type { OrchestratorResult, Pipeline } from './types.js';

const pipelineWithoutModels: Pipeline = {
  name: 'no-models',
  steps: [
    { name: 's1', prompt: 'p1', files: [] },
    { name: 's2', prompt: 'p2', files: ['a.ts'] },
  ],
};

const pipelineAllModels: Pipeline = {
  name: 'all-models',
  steps: [
    { name: 's1', prompt: 'p1', files: [], modelId: 'gpt-x' },
    { name: 's2', prompt: 'p2', files: ['a.ts'], modelId: 'gpt-y' },
  ],
};

function baseState(overrides: Partial<FsmState> = {}): FsmState {
  return {
    screen: { kind: 'welcome' } as Screen,
    pipeline: null,
    pipelines: null,
    modelId: '',
    backendKind: 'pi',
    apiKey: '',
    requiresApiKey: true,
    pipelineSourceName: null,
    ...overrides,
  };
}

describe('screen-fsm', () => {
  describe('allStepsHaveModel', () => {
    it('returns false for null', () => {
      expect(allStepsHaveModel(null)).toBe(false);
    });
    it('returns false for empty steps', () => {
      expect(allStepsHaveModel({ name: 'x', steps: [] })).toBe(false);
    });
    it('returns false when any step lacks modelId', () => {
      expect(allStepsHaveModel(pipelineWithoutModels)).toBe(false);
    });
    it('returns true when every step has modelId', () => {
      expect(allStepsHaveModel(pipelineAllModels)).toBe(true);
    });
  });

  describe('options screen', () => {
    it('welcome.options opens the options screen', () => {
      const next = reduce(baseState(), { type: 'welcome.options' });
      expect(next.screen).toEqual({ kind: 'options' });
    });

    it('options.close returns to welcome', () => {
      const next = reduce(
        baseState({ screen: { kind: 'options', focusSpecName: 'openrouter' } }),
        { type: 'options.close' },
      );
      expect(next.screen).toEqual({ kind: 'welcome' });
    });

    it('run.authError opens options focused on the rejected provider', () => {
      const next = reduce(
        baseState({ screen: { kind: 'run', modelId: 'm', apiKey: 'k' }, backendKind: 'pi' }),
        { type: 'run.authError', backendKind: 'azure', specName: 'azureApiKey' },
      );
      expect(next.screen).toEqual({ kind: 'options', focusSpecName: 'azureApiKey' });
      // Backend is carried over so a follow-up run uses the right backend.
      expect(next.backendKind).toBe('azure');
    });
  });

  describe('initialState', () => {
    it('starts on welcome when autoStart is false', () => {
      const s = initialState({
        openrouterResolvedKey: 'KEY',
        requiresApiKey: true,
      });
      expect(s.screen).toEqual({ kind: 'welcome' });
      expect(s.pipeline).toBeNull();
      expect(s.apiKey).toBe('KEY');
      expect(s.backendKind).toBe('pi');
      expect(s.requiresApiKey).toBe(true);
    });

    it('starts on pipeline-editor when autoStart && initialPipeline', () => {
      const s = initialState({
        autoStart: true,
        initialPipeline: pipelineWithoutModels,
        openrouterResolvedKey: '',
        requiresApiKey: false,
      });
      expect(s.screen).toEqual({ kind: 'pipeline-editor' });
      expect(s.pipeline).toBe(pipelineWithoutModels);
    });

    it('falls back to welcome when autoStart is true but no pipeline', () => {
      const s = initialState({
        autoStart: true,
        openrouterResolvedKey: '',
        requiresApiKey: false,
      });
      expect(s.screen).toEqual({ kind: 'welcome' });
    });

    it('uses provided initialBackend', () => {
      const s = initialState({
        initialBackend: 'azure',
        openrouterResolvedKey: '',
        requiresApiKey: true,
      });
      expect(s.backendKind).toBe('azure');
    });
  });

  describe('welcome transitions', () => {
    it('welcome.assistant → pipeline-assistant', () => {
      const next = reduce(baseState(), { type: 'welcome.assistant' });
      expect(next.screen).toEqual({ kind: 'pipeline-assistant' });
    });
    it('welcome.new → pipeline-editor', () => {
      const next = reduce(baseState(), { type: 'welcome.new' });
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('welcome.import → pipeline-import', () => {
      const next = reduce(baseState(), { type: 'welcome.import' });
      expect(next.screen).toEqual({ kind: 'pipeline-import' });
    });
    it('welcome.saved → saved-pipelines', () => {
      const next = reduce(baseState(), { type: 'welcome.saved' });
      expect(next.screen).toEqual({ kind: 'saved-pipelines' });
    });
    it('welcome.selectPipeline sets pipeline and goes to editor', () => {
      const next = reduce(baseState(), {
        type: 'welcome.selectPipeline',
        pipeline: pipelineWithoutModels,
      });
      expect(next.pipeline).toBe(pipelineWithoutModels);
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('welcome.quit is a no-op on state (caller exits)', () => {
      const s = baseState();
      expect(reduce(s, { type: 'welcome.quit' })).toEqual(s);
    });
    it('welcome.faq → faq', () => {
      const next = reduce(baseState(), { type: 'welcome.faq' });
      expect(next.screen).toEqual({ kind: 'faq' });
    });
    it('faq.back → welcome', () => {
      const s = baseState({ screen: { kind: 'faq' } });
      const next = reduce(s, { type: 'faq.back' });
      expect(next.screen).toEqual({ kind: 'welcome' });
    });
    it('welcome.directory → directory-picker', () => {
      const next = reduce(baseState(), { type: 'welcome.directory' });
      expect(next.screen).toEqual({ kind: 'directory-picker' });
    });
    it('directory.select → welcome (dir applied by caller as side effect)', () => {
      const s = baseState({ screen: { kind: 'directory-picker' } });
      expect(reduce(s, { type: 'directory.select' }).screen).toEqual({ kind: 'welcome' });
    });
    it('directory.cancel → welcome', () => {
      const s = baseState({ screen: { kind: 'directory-picker' } });
      expect(reduce(s, { type: 'directory.cancel' }).screen).toEqual({ kind: 'welcome' });
    });
  });

  describe('multi-run batch (saved.selectMany)', () => {
    it('selects 2+ pipelines and routes to the shared backend selector', () => {
      const next = reduce(baseState(), {
        type: 'saved.selectMany',
        pipelines: [pipelineWithoutModels, pipelineAllModels],
      });
      expect(next.pipelines).toEqual([pipelineWithoutModels, pipelineAllModels]);
      expect(next.pipeline).toBe(pipelineWithoutModels); // representative
      expect(next.screen).toEqual({ kind: 'backend-selector' });
    });

    it('saved.select (single) clears a previously-set batch', () => {
      const s = baseState({ pipelines: [pipelineWithoutModels, pipelineAllModels] });
      const next = reduce(s, { type: 'saved.select', pipeline: pipelineAllModels });
      expect(next.pipelines).toBeNull();
      expect(next.pipeline).toBe(pipelineAllModels);
    });

    it('a single-pipeline pick clears a stale batch (no multi leak)', () => {
      const s = baseState({ pipelines: [pipelineWithoutModels, pipelineAllModels] });
      const next = reduce(s, { type: 'welcome.selectPipeline', pipeline: pipelineWithoutModels });
      expect(next.pipelines).toBeNull();
    });

    it('timeout.submit applies the timeout to every pipeline in the batch', () => {
      const s = baseState({
        pipelines: [pipelineWithoutModels, pipelineAllModels],
        screen: { kind: 'timeout-prompt', modelId: 'm', apiKey: 'k' },
      });
      const next = reduce(s, { type: 'timeout.submit', minutes: 5 });
      expect(next.pipelines).toHaveLength(2);
      for (const p of next.pipelines ?? []) {
        expect(p.cardTimeoutMs).toBe(5 * 60_000);
        expect(p.singleFileCardTimeoutMs).toBe(5 * 60_000);
      }
      expect(next.screen).toEqual({ kind: 'run', modelId: 'm', apiKey: 'k' });
    });
  });

  describe('assistant transitions', () => {
    it('assistant.complete sets pipeline and goes to editor', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-assistant' } }), {
        type: 'assistant.complete',
        pipeline: pipelineWithoutModels,
      });
      expect(next.pipeline).toBe(pipelineWithoutModels);
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('assistant.cancel → welcome', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-assistant' } }), {
        type: 'assistant.cancel',
      });
      expect(next.screen).toEqual({ kind: 'welcome' });
    });
  });

  describe('editor.complete branches', () => {
    it('allStepsHaveModel=true + initialBackendSet=false → backend-selector', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-editor' } }), {
        type: 'editor.complete',
        pipeline: pipelineAllModels,
        initialBackendSet: false,
      });
      expect(next.screen).toEqual({ kind: 'backend-selector' });
      expect(next.pipeline).toBe(pipelineAllModels);
    });
    it('allStepsHaveModel=true + initialBackendSet=true → run (with first-step model)', () => {
      const next = reduce(
        baseState({ screen: { kind: 'pipeline-editor' }, apiKey: 'K' }),
        {
          type: 'editor.complete',
          pipeline: pipelineAllModels,
          initialBackendSet: true,
        },
      );
      expect(next.screen).toEqual({ kind: 'run', modelId: 'gpt-x', apiKey: 'K' });
      expect(next.modelId).toBe('gpt-x');
    });
    it('allStepsHaveModel=false + initialBackendSet=false → backend-selector', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-editor' } }), {
        type: 'editor.complete',
        pipeline: pipelineWithoutModels,
        initialBackendSet: false,
      });
      expect(next.screen).toEqual({ kind: 'backend-selector' });
    });
    it('allStepsHaveModel=false + initialBackendSet=true → model-selector', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-editor' } }), {
        type: 'editor.complete',
        pipeline: pipelineWithoutModels,
        initialBackendSet: true,
      });
      expect(next.screen).toEqual({ kind: 'model-selector', backendKind: 'pi' });
    });
  });

  describe('editor side transitions', () => {
    it('editor.import → pipeline-import', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-editor' } }), {
        type: 'editor.import',
      });
      expect(next.screen).toEqual({ kind: 'pipeline-import' });
    });
    it('editor.export sets pipeline and goes to export', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-editor' } }), {
        type: 'editor.export',
        pipeline: pipelineWithoutModels,
      });
      expect(next.pipeline).toBe(pipelineWithoutModels);
      expect(next.screen).toEqual({ kind: 'pipeline-export' });
    });
    it('editor.cancel → welcome', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-editor' } }), {
        type: 'editor.cancel',
      });
      expect(next.screen).toEqual({ kind: 'welcome' });
    });
  });

  describe('backend transitions', () => {
    it('backend.select skipModelSelector=true → run', () => {
      const next = reduce(
        baseState({ screen: { kind: 'backend-selector' }, apiKey: 'AK' }),
        {
          type: 'backend.select',
          backendKind: 'azure',
          requiresApiKey: false,
          skipModelSelector: true,
          firstStepModelId: 'gpt-z',
        },
      );
      expect(next.backendKind).toBe('azure');
      expect(next.requiresApiKey).toBe(false);
      expect(next.modelId).toBe('gpt-z');
      expect(next.screen).toEqual({ kind: 'run', modelId: 'gpt-z', apiKey: 'AK' });
    });
    it('backend.select skipModelSelector=false → model-selector', () => {
      const next = reduce(baseState({ screen: { kind: 'backend-selector' } }), {
        type: 'backend.select',
        backendKind: 'pi',
        requiresApiKey: true,
        skipModelSelector: false,
      });
      expect(next.screen).toEqual({ kind: 'model-selector', backendKind: 'pi' });
      expect(next.backendKind).toBe('pi');
      expect(next.requiresApiKey).toBe(true);
    });
    it('backend.cancel → pipeline-editor', () => {
      const next = reduce(baseState({ screen: { kind: 'backend-selector' } }), {
        type: 'backend.cancel',
      });
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
  });

  describe('import transitions', () => {
    it('import.selectFromList → editor with pipeline set', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-import' } }), {
        type: 'import.selectFromList',
        pipeline: pipelineWithoutModels,
      });
      expect(next.pipeline).toBe(pipelineWithoutModels);
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('import.paste → pipeline-import-paste', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-import' } }), {
        type: 'import.paste',
      });
      expect(next.screen).toEqual({ kind: 'pipeline-import-paste' });
    });
    it('import.customPath → pipeline-import-custom', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-import' } }), {
        type: 'import.customPath',
      });
      expect(next.screen).toEqual({ kind: 'pipeline-import-custom' });
    });
    it('import.cancel with pipeline → pipeline-editor', () => {
      const next = reduce(
        baseState({
          screen: { kind: 'pipeline-import' },
          pipeline: pipelineWithoutModels,
        }),
        { type: 'import.cancel' },
      );
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('import.cancel without pipeline → welcome', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-import' } }), {
        type: 'import.cancel',
      });
      expect(next.screen).toEqual({ kind: 'welcome' });
    });
  });

  describe('importPaste / importCustom transitions', () => {
    it('importPaste.complete → editor with pipeline set', () => {
      const next = reduce(
        baseState({ screen: { kind: 'pipeline-import-paste' } }),
        { type: 'importPaste.complete', pipeline: pipelineWithoutModels },
      );
      expect(next.pipeline).toBe(pipelineWithoutModels);
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('importPaste.cancel → pipeline-import', () => {
      const next = reduce(
        baseState({ screen: { kind: 'pipeline-import-paste' } }),
        { type: 'importPaste.cancel' },
      );
      expect(next.screen).toEqual({ kind: 'pipeline-import' });
    });
    it('importCustom.complete with pipeline → editor', () => {
      const next = reduce(
        baseState({ screen: { kind: 'pipeline-import-custom' } }),
        { type: 'importCustom.complete', pipeline: pipelineWithoutModels },
      );
      expect(next.pipeline).toBe(pipelineWithoutModels);
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('importCustom.complete with null → no state change', () => {
      const s = baseState({ screen: { kind: 'pipeline-import-custom' } });
      const next = reduce(s, { type: 'importCustom.complete', pipeline: null });
      expect(next).toEqual(s);
    });
    it('importCustom.cancel → pipeline-import', () => {
      const next = reduce(
        baseState({ screen: { kind: 'pipeline-import-custom' } }),
        { type: 'importCustom.cancel' },
      );
      expect(next.screen).toEqual({ kind: 'pipeline-import' });
    });
  });

  describe('export transitions', () => {
    it('export.complete → pipeline-editor', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-export' } }), {
        type: 'export.complete',
      });
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('export.cancel → pipeline-editor', () => {
      const next = reduce(baseState({ screen: { kind: 'pipeline-export' } }), {
        type: 'export.cancel',
      });
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
  });

  describe('saved transitions', () => {
    it('saved.select sets pipeline + sourceName and goes to editor', () => {
      const next = reduce(baseState({ screen: { kind: 'saved-pipelines' } }), {
        type: 'saved.select',
        pipeline: pipelineWithoutModels,
      });
      expect(next.pipeline).toBe(pipelineWithoutModels);
      expect(next.pipelineSourceName).toBe(pipelineWithoutModels.name);
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('saved.cancel → welcome', () => {
      const next = reduce(baseState({ screen: { kind: 'saved-pipelines' } }), {
        type: 'saved.cancel',
      });
      expect(next.screen).toEqual({ kind: 'welcome' });
    });
  });

  describe('modelSelector transitions', () => {
    const fakeMissing: ApiKeySpec[] = [
      {
        name: 'openrouter',
        envVar: 'OPENROUTER_API_KEY',
        label: 'OpenRouter',
        required: true,
      } as unknown as ApiKeySpec,
    ];

    it('select with requiresApiKey=false → timeout-prompt (uses state.apiKey)', () => {
      const next = reduce(
        baseState({ screen: { kind: 'model-selector', backendKind: 'pi' }, apiKey: 'OLD' }),
        {
          type: 'modelSelector.select',
          modelId: 'm1',
          requiresApiKey: false,
          backendKind: 'pi',
          missingKeys: [],
          resolvedApiKey: '',
        },
      );
      expect(next.modelId).toBe('m1');
      expect(next.screen).toEqual({
        kind: 'timeout-prompt',
        modelId: 'm1',
        apiKey: 'OLD',
      });
    });

    it('select with backend=stub → timeout-prompt regardless of requiresApiKey', () => {
      const next = reduce(
        baseState({ screen: { kind: 'model-selector', backendKind: 'pi' }, apiKey: 'OLD' }),
        {
          type: 'modelSelector.select',
          modelId: 'm1',
          requiresApiKey: true,
          backendKind: 'stub',
          missingKeys: fakeMissing,
          resolvedApiKey: '',
        },
      );
      expect(next.screen.kind).toBe('timeout-prompt');
      expect(next.backendKind).toBe('stub');
    });

    it('select with missingKeys → api-key', () => {
      const next = reduce(baseState({ screen: { kind: 'model-selector', backendKind: 'pi' } }), {
        type: 'modelSelector.select',
        modelId: 'm1',
        requiresApiKey: true,
        backendKind: 'pi',
        missingKeys: fakeMissing,
        resolvedApiKey: '',
      });
      expect(next.screen).toEqual({ kind: 'api-key', missing: fakeMissing });
    });

    it('select with no missing → timeout-prompt with resolved key', () => {
      const next = reduce(baseState({ screen: { kind: 'model-selector', backendKind: 'pi' } }), {
        type: 'modelSelector.select',
        modelId: 'm1',
        requiresApiKey: true,
        backendKind: 'pi',
        missingKeys: [],
        resolvedApiKey: 'NEW',
      });
      expect(next.apiKey).toBe('NEW');
      expect(next.screen).toEqual({
        kind: 'timeout-prompt',
        modelId: 'm1',
        apiKey: 'NEW',
      });
    });

    it('cancel with initialBackendSet=true → pipeline-editor', () => {
      const next = reduce(baseState({ screen: { kind: 'model-selector', backendKind: 'pi' } }), {
        type: 'modelSelector.cancel',
        initialBackendSet: true,
      });
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });

    it('cancel with initialBackendSet=false → backend-selector', () => {
      const next = reduce(baseState({ screen: { kind: 'model-selector', backendKind: 'pi' } }), {
        type: 'modelSelector.cancel',
        initialBackendSet: false,
      });
      expect(next.screen).toEqual({ kind: 'backend-selector' });
    });
  });

  describe('apiKey transitions', () => {
    it('apiKey.submit → timeout-prompt with resolved key', () => {
      const next = reduce(
        baseState({
          screen: { kind: 'api-key', missing: [] },
          modelId: 'm1',
        }),
        { type: 'apiKey.submit', resolvedApiKey: 'RESOLVED' },
      );
      expect(next.apiKey).toBe('RESOLVED');
      expect(next.screen).toEqual({
        kind: 'timeout-prompt',
        modelId: 'm1',
        apiKey: 'RESOLVED',
      });
    });
    it('apiKey.cancel → model-selector', () => {
      const next = reduce(
        baseState({ screen: { kind: 'api-key', missing: [] } }),
        { type: 'apiKey.cancel' },
      );
      expect(next.screen).toEqual({ kind: 'model-selector', backendKind: 'pi' });
    });
  });

  describe('timeout transitions', () => {
    it('timeout.submit mutates pipeline timeouts and goes to run', () => {
      const next = reduce(
        baseState({
          screen: { kind: 'timeout-prompt', modelId: 'm1', apiKey: 'AK' },
          pipeline: pipelineWithoutModels,
        }),
        { type: 'timeout.submit', minutes: 7 },
      );
      expect(next.pipeline?.cardTimeoutMs).toBe(7 * 60_000);
      expect(next.pipeline?.singleFileCardTimeoutMs).toBe(7 * 60_000);
      // Original pipeline must remain untouched (purity).
      expect(pipelineWithoutModels.cardTimeoutMs).toBeUndefined();
      expect(next.screen).toEqual({ kind: 'run', modelId: 'm1', apiKey: 'AK' });
    });
    it('timeout.submit with no pipeline still navigates to run', () => {
      const next = reduce(
        baseState({
          screen: { kind: 'timeout-prompt', modelId: 'm1', apiKey: 'AK' },
        }),
        { type: 'timeout.submit', minutes: 3 },
      );
      expect(next.pipeline).toBeNull();
      expect(next.screen).toEqual({ kind: 'run', modelId: 'm1', apiKey: 'AK' });
    });
    it('timeout.cancel → model-selector', () => {
      const next = reduce(
        baseState({
          screen: { kind: 'timeout-prompt', modelId: 'm1', apiKey: 'AK' },
        }),
        { type: 'timeout.cancel' },
      );
      expect(next.screen).toEqual({ kind: 'model-selector', backendKind: 'pi' });
    });
  });

  describe('run / summary transitions', () => {
    const fakeResult = {
      runId: 'r1',
      duration: 1234,
      agents: [],
      logs: [],
      totalCost: 0,
      filesModified: [],
      conflicts: [],
    } as unknown as OrchestratorResult;

    it('run.complete → summary with result', () => {
      const next = reduce(
        baseState({ screen: { kind: 'run', modelId: 'm1', apiKey: 'AK' } }),
        { type: 'run.complete', result: fakeResult },
      );
      expect(next.screen).toEqual({ kind: 'summary', result: fakeResult });
    });
    it('run.abort → pipeline-editor', () => {
      const next = reduce(
        baseState({ screen: { kind: 'run', modelId: 'm1', apiKey: 'AK' } }),
        { type: 'run.abort' },
      );
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('summary.back → pipeline-editor', () => {
      const next = reduce(
        baseState({ screen: { kind: 'summary', result: fakeResult } }),
        { type: 'summary.back' },
      );
      expect(next.screen).toEqual({ kind: 'pipeline-editor' });
    });
    it('summary.quit is a no-op on state (caller exits)', () => {
      const s = baseState({ screen: { kind: 'summary', result: fakeResult } });
      expect(reduce(s, { type: 'summary.quit' })).toEqual(s);
    });
  });

  describe('runDirect (skip-model fast path)', () => {
    const missing: ApiKeySpec[] = [
      {
        name: 'openrouter',
        envVar: 'OPENROUTER_API_KEY',
        envFileVar: 'OPENROUTER_API_KEY_FILE',
        secretMountPath: '/run/secrets/openrouter',
        hostSecretScope: 'openrouter',
        required: true,
        label: 'OpenRouter',
      },
    ];
    it('!requiresApiKey → run with state.apiKey, sets pipeline+modelId', () => {
      const s = baseState({ screen: { kind: 'pipeline-editor' }, apiKey: 'OLD' });
      const next = reduce(s, {
        type: 'runDirect',
        modelId: 'gpt-x',
        missingKeys: [],
        resolvedApiKey: 'NEW',
        pipeline: pipelineAllModels,
        requiresApiKey: false,
      });
      expect(next.screen).toEqual({ kind: 'run', modelId: 'gpt-x', apiKey: 'OLD' });
      expect(next.pipeline).toBe(pipelineAllModels);
      expect(next.modelId).toBe('gpt-x');
      expect(next.requiresApiKey).toBe(false);
    });
    it('backendKind=stub → run regardless of requiresApiKey', () => {
      const s = baseState({ screen: { kind: 'backend-selector' }, apiKey: 'K' });
      const next = reduce(s, {
        type: 'runDirect',
        modelId: 'gpt-x',
        missingKeys: missing,
        resolvedApiKey: '',
        backendKind: 'stub',
        requiresApiKey: true,
      });
      expect(next.screen).toEqual({ kind: 'run', modelId: 'gpt-x', apiKey: 'K' });
      expect(next.backendKind).toBe('stub');
    });
    it('missingKeys non-empty → api-key screen', () => {
      const s = baseState({ screen: { kind: 'pipeline-editor' } });
      const next = reduce(s, {
        type: 'runDirect',
        modelId: 'gpt-x',
        missingKeys: missing,
        resolvedApiKey: '',
        requiresApiKey: true,
        backendKind: 'pi',
      });
      expect(next.screen).toEqual({ kind: 'api-key', missing });
      expect(next.modelId).toBe('gpt-x');
    });
    it('requiresApiKey + no missing → run with resolvedApiKey', () => {
      const s = baseState({ screen: { kind: 'pipeline-editor' }, apiKey: 'OLD' });
      const next = reduce(s, {
        type: 'runDirect',
        modelId: 'gpt-x',
        missingKeys: [],
        resolvedApiKey: 'RESOLVED',
        requiresApiKey: true,
        backendKind: 'pi',
      });
      expect(next.screen).toEqual({ kind: 'run', modelId: 'gpt-x', apiKey: 'RESOLVED' });
      expect(next.apiKey).toBe('RESOLVED');
    });
  });

  describe('purity', () => {
    it('does not mutate the input state', () => {
      const s = baseState({ pipeline: pipelineWithoutModels });
      const snapshot = JSON.parse(JSON.stringify(s));
      reduce(s, { type: 'welcome.new' });
      reduce(s, { type: 'editor.complete', pipeline: pipelineAllModels, initialBackendSet: true });
      reduce(s, { type: 'timeout.submit', minutes: 4 });
      expect(s).toEqual(snapshot);
    });
  });
});
