import { describe, it, expect } from 'vitest';
import {
  buildAssistantSystemPrompt,
  buildInitialHumanMessage,
  FORCE_DONE_NUDGE,
} from './assistant-prompts.js';

const sampleModels = [
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', inputPrice: 0.74, outputPrice: 4.66 },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
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
    expect(p).toMatch(/última opção/i);
  });

  it('declares Portuguese as the response language', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/PORTUGUÊS|português/);
  });

  it('lists every model from the catalog', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/moonshotai\/kimi-k2\.6/);
    expect(p).toMatch(/openai\/gpt-5\.4-mini/);
  });

  it('falls back gracefully when the catalog is empty', () => {
    const p = buildAssistantSystemPrompt({ models: [] });
    expect(p).toMatch(/catálogo vazio/);
  });

  it('does not anchor the model on a fixed turn budget', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    // The prompt must NOT advertise a hard limit — that would push the model
    // toward filling the budget instead of stopping when the checklist closes.
    expect(p).not.toMatch(/orçamento de até \d+ perguntas/);
    expect(p).toMatch(/Não há limite fixo de perguntas/);
  });

  it('exposes the sufficiency checklist (objetivo / decomposição / scope)', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/CHECKLIST DE SUFICIÊNCIA/);
    expect(p).toMatch(/OBJETIVO/);
    expect(p).toMatch(/DECOMPOSIÇÃO/);
    expect(p).toMatch(/SCOPE/);
  });

  it('states the counterfactual rule for asking', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/contrafactual/i);
    expect(p).toMatch(/mesmo pipeline/);
  });

  it('explicitly authorizes the zero-questions path', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/ZERO perguntas/);
  });

  it('forbids questions about files / paths', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/Não pergunte sobre arquivos/);
  });

  it('declares the parallelization principle (per-file is default for independent work)', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/REGRA-MESTRA/);
    expect(p).toMatch(/N independentes → per-file/);
  });

  it('lists test creation as a per-file example', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/testes unitários/);
  });

  it('warns against packing different scopes into one step', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    expect(p).toMatch(/ANTI-PADRÕES/);
    expect(p).toMatch(/Single-artifact/);
  });

  it('lists single-file edits (README, config) as project scope', () => {
    const p = buildAssistantSystemPrompt({ models: sampleModels });
    // Must steer away from the user's reported failure mode where a single
    // README badge edit was marked per-file (no files) instead of project.
    expect(p).toMatch(/UM ÚNICO ARTEFATO/);
  });

  it('omits the recon block when reconContext is missing or empty', () => {
    const noCtx = buildAssistantSystemPrompt({ models: sampleModels });
    const emptyCtx = buildAssistantSystemPrompt({
      models: sampleModels,
      reconContext: '   ',
    });
    expect(noCtx).not.toMatch(/Contexto do projeto/);
    expect(emptyCtx).not.toMatch(/Contexto do projeto/);
  });

  it('renders the recon block when reconContext is provided', () => {
    const p = buildAssistantSystemPrompt({
      models: sampleModels,
      reconContext: '### Stack & ferramentas\n- TypeScript + React (Ink)',
    });
    expect(p).toMatch(/Contexto do projeto/);
    expect(p).toMatch(/TypeScript \+ React \(Ink\)/);
    expect(p).toMatch(/Stack & ferramentas/);
  });
});

describe('buildInitialHumanMessage', () => {
  it('wraps user intent', () => {
    const msg = buildInitialHumanMessage('rodar prettier em src/');
    expect(msg).toMatch(/rodar prettier em src\//);
    expect(msg).toMatch(/Me pergunte/);
  });

  it('invites the assistant to finalize directly when context already suffices', () => {
    const msg = buildInitialHumanMessage('rodar prettier em src/');
    expect(msg).toMatch(/finalize direto/);
  });

  it('uses a fallback when intent is empty', () => {
    const msg = buildInitialHumanMessage('   ');
    expect(msg).toMatch(/ainda não sei/);
  });
});

describe('FORCE_DONE_NUDGE', () => {
  it('instructs the model to finalize without further questions', () => {
    expect(FORCE_DONE_NUDGE).toMatch(/limite de perguntas/);
    expect(FORCE_DONE_NUDGE).toMatch(/done.*true/);
  });
});
