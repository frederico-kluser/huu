import { describe, it, expect } from 'vitest';
import {
  buildAssistantSystemPrompt,
  buildInitialHumanMessage,
  FORCE_DONE_NUDGE,
} from './assistant-prompts.js';
import type { ModelEntry } from '../contracts/models.js';

const sampleModels: ModelEntry[] = [
  {
    id: 'moonshotai/kimi-k2.6',
    label: 'Kimi K2.6',
    inputPrice: 0.74,
    outputPrice: 4.66,
    description: 'Deep reasoning, agentic, heavy coding.',
    bestFor: ['coding', 'reasoning', 'agentic'],
    tier: 'workhorse',
  },
  {
    id: 'minimax/minimax-m2.7',
    label: 'MiniMax M2.7',
    inputPrice: 0.134,
    outputPrice: 1.31,
    description: 'Fast and cheap — simple, per-file steps.',
    bestFor: ['cheap', 'fast'],
    tier: 'fast',
  },
];

describe('buildAssistantSystemPrompt', () => {
  it('mentions all three valid scopes', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/"project"/);
    expect(p).toMatch(/"per-file"/);
    expect(p).toMatch(/"flexible"/);
  });

  it('enforces the free-text rule explicitly', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/isFreeText/);
    expect(p).toMatch(/last option/i);
  });

  it('declares English as the response language', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/ENGLISH/);
  });

  it('lists every model from the catalog', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/moonshotai\/kimi-k2\.6/);
    expect(p).toMatch(/minimax\/minimax-m2\.7/);
  });

  it('falls back gracefully when the catalog is empty', () => {
    const p = buildAssistantSystemPrompt({ models: [] });
    expect(p).toMatch(/empty catalog/);
  });

  it('does not anchor the model on a fixed turn budget', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    // The prompt must NOT advertise a hard limit — that would push the model
    // toward filling the budget instead of stopping when the checklist closes.
    expect(p).not.toMatch(/budget of up to \d+ questions/);
    expect(p).toMatch(/no fixed question limit/i);
  });

  it('exposes the sufficiency checklist (goal / decomposition / scope)', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/SUFFICIENCY CHECKLIST/);
    expect(p).toMatch(/GOAL/);
    expect(p).toMatch(/DECOMPOSITION/);
    expect(p).toMatch(/SCOPE/);
  });

  it('states the counterfactual rule for asking', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/counter-factual/i);
    expect(p).toMatch(/same pipeline/i);
  });

  it('explicitly authorizes the zero-questions path', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/ZERO questions/);
  });

  it('forbids questions about files / paths', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/Do not ask about files/);
  });

  it('declares the parallelization principle (per-file is default for independent work)', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/MASTER RULE/);
    expect(p).toMatch(/N independent → per-file/);
  });

  it('lists test creation as a per-file example', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/unit tests/);
  });

  it('warns against packing different scopes into one step', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/ANTI-PATTERNS/);
    expect(p).toMatch(/Single-artifact/);
  });

  it('lists single-file edits (README, config) as project scope', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    // Must steer away from the user's reported failure mode where a single
    // README badge edit was marked per-file (no files) instead of project.
    expect(p).toMatch(/SINGLE artifact/);
  });

  it('renders model description and bestFor tags inline with the catalog', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/bestFor: coding, reasoning, agentic/);
    expect(p).toMatch(/Deep reasoning, agentic, heavy coding\./);
    expect(p).toMatch(/tier: workhorse/);
  });

  it('emits a "recommended model per scenario" matrix grouped by bestFor tag', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/Recommended model per scenario/);
    expect(p).toMatch(/Heavy coding.*moonshotai\/kimi-k2\.6/);
    expect(p).toMatch(/Fast & cheap.*minimax\/minimax-m2\.7/);
  });

  it('omits the matrix when no model declares bestFor tags', () => {
    const bareModels = [{ id: 'foo/bar', label: 'Foo Bar' }];
    const p = buildAssistantSystemPrompt({ models: bareModels });
    expect(p).not.toMatch(/Recommended model per scenario/);
  });

  it('omits the recon block when reconContext is missing or empty', () => {
    const noCtx = buildAssistantSystemPrompt({ models: sampleModels });
    const emptyCtx = buildAssistantSystemPrompt({
      models: sampleModels,
      reconContext: '   ',
    });
    expect(noCtx).not.toMatch(/Project context/);
    expect(emptyCtx).not.toMatch(/Project context/);
  });

  it('renders the recon block when reconContext is provided', () => {
    const p = buildAssistantSystemPrompt({
      models: sampleModels,
      reconContext: '### Stack & tooling\n- TypeScript + React (Ink)',
    });
    expect(p).toMatch(/Project context/);
    expect(p).toMatch(/TypeScript \+ React \(Ink\)/);
    expect(p).toMatch(/Stack & tooling/);
  });
});

describe('buildInitialHumanMessage', () => {
  it('wraps user intent', () => {
    const msg = buildInitialHumanMessage('run prettier on src/');
    expect(msg).toMatch(/run prettier on src\//);
    expect(msg).toMatch(/Ask me/);
  });

  it('invites the assistant to finalize directly when context already suffices', () => {
    const msg = buildInitialHumanMessage('run prettier on src/');
    expect(msg).toMatch(/finalize directly/);
  });

  it('uses a fallback when intent is empty', () => {
    const msg = buildInitialHumanMessage('   ');
    expect(msg).toMatch(/not yet sure/);
  });
});

describe('FORCE_DONE_NUDGE', () => {
  it('instructs the model to finalize without further questions', () => {
    expect(FORCE_DONE_NUDGE).toMatch(/question limit/);
    expect(FORCE_DONE_NUDGE).toMatch(/done.*true/);
  });
});
