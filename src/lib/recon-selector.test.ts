import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SELECTOR_MODEL,
  SelectorOutputSchema,
  buildSelectorHumanMessage,
  buildSelectorSystemPrompt,
  runReconSelector,
} from './recon-selector.js';
import { RECON_CATALOG } from './project-recon-prompts.js';
import { resolveSelections } from './recon-resolve.js';

describe('SELECTOR_MODEL', () => {
  it('points at the same minimax tier as the recon agents', () => {
    expect(SELECTOR_MODEL).toBe('minimax/minimax-m2.7');
  });
});

describe('SelectorOutputSchema', () => {
  it('accepts an array mixing catalog ids and custom objects', () => {
    const r = SelectorOutputSchema.safeParse({
      selections: [
        'stack',
        'structure',
        { title: 'X', prompt: 'do X reading file tree carefully' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty selections', () => {
    const r = SelectorOutputSchema.safeParse({ selections: [] });
    expect(r.success).toBe(false);
  });

  it('rejects more than 10 selections', () => {
    const r = SelectorOutputSchema.safeParse({
      selections: Array(11).fill('stack'),
    });
    expect(r.success).toBe(false);
  });

  it('rejects custom items with too-short prompt', () => {
    const r = SelectorOutputSchema.safeParse({
      selections: [{ title: 'X', prompt: 'short' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('buildSelectorSystemPrompt', () => {
  it('includes every catalog id in the listing', () => {
    const p = buildSelectorSystemPrompt();
    for (const entry of RECON_CATALOG) {
      expect(p).toContain(entry.id);
    }
  });

  it('describes the mixed-array output shape (string OR object)', () => {
    const p = buildSelectorSystemPrompt();
    expect(p).toMatch(/STRING.*ID do catálogo/i);
    expect(p).toMatch(/OBJETO.*title.*prompt/i);
  });

  it('caps at 10 items in the rules', () => {
    const p = buildSelectorSystemPrompt();
    expect(p).toMatch(/máximo 10/i);
  });
});

describe('buildSelectorHumanMessage', () => {
  it('always includes the user intent', () => {
    const m = buildSelectorHumanMessage('add unit tests for every module');
    expect(m).toContain('add unit tests for every module');
  });

  it('includes the project hint when present', () => {
    const m = buildSelectorHumanMessage('intent', 'huu — TS/React Ink CLI');
    expect(m).toContain('huu — TS/React Ink CLI');
  });

  it('omits the hint section when no hint is given', () => {
    const m = buildSelectorHumanMessage('intent');
    expect(m).not.toMatch(/Hint do projeto/);
  });
});

describe('runReconSelector — stub mode', () => {
  let originalStubFlag: string | undefined;

  beforeEach(() => {
    originalStubFlag = process.env.HUU_LANGCHAIN_STUB;
  });

  afterEach(() => {
    if (originalStubFlag === undefined) delete process.env.HUU_LANGCHAIN_STUB;
    else process.env.HUU_LANGCHAIN_STUB = originalStubFlag;
  });

  it('returns a deterministic mix of catalog ids and a custom item', async () => {
    const sel = await runReconSelector({ apiKey: 'stub', intent: 'whatever' });
    expect(sel.length).toBeGreaterThan(0);
    expect(sel.some((s) => typeof s === 'string')).toBe(true);
    expect(sel.some((s) => typeof s === 'object')).toBe(true);
  });

  it('output round-trips through the resolver into runnable items', async () => {
    const raw = await runReconSelector({ apiKey: 'stub', intent: 'x' });
    const resolved = resolveSelections(raw);
    expect(resolved.items.length).toBeGreaterThan(0);
    expect(resolved.items.some((i) => i.source === 'catalog')).toBe(true);
    expect(resolved.items.some((i) => i.source === 'custom')).toBe(true);
  });

  it('respects HUU_LANGCHAIN_STUB even with real-looking apiKey', async () => {
    process.env.HUU_LANGCHAIN_STUB = '1';
    const sel = await runReconSelector({
      apiKey: 'sk-or-real-looking',
      intent: 'x',
    });
    expect(sel.length).toBeGreaterThan(0);
  });
});

describe('runReconSelector — real mode guards', () => {
  beforeEach(() => {
    delete process.env.HUU_LANGCHAIN_STUB;
  });

  it('throws when apiKey is empty', async () => {
    await expect(
      runReconSelector({ apiKey: '', intent: 'x' }),
    ).rejects.toThrow(/API key/i);
  });
});
