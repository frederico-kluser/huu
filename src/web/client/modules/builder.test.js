import { describe, expect, it, vi, beforeEach } from 'vitest';

/* builder.js pulls DOM-heavy wiring at import time only inside functions, but
   it imports state.js which touches window/sessionStorage at module scope in
   places — stub the globals BEFORE importing, the same way a browser provides
   them. The tests exercise the PURE draft transforms (the form ↔ pipeline
   boundary), which is where shape bugs would silently corrupt a saved
   pipeline. */
vi.stubGlobal('window', {
  dispatchEvent: () => {},
  scrollTo: () => {},
  addEventListener: () => {},
});
vi.stubGlobal('document', {
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  querySelectorAll: () => [],
});
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {} });
vi.stubGlobal('location', { pathname: '/', search: '' });
vi.stubGlobal('CustomEvent', class { constructor(name) { this.name = name; } });
vi.stubGlobal('navigator', { userAgent: 'test' });

const { draftToPipeline, pipelineToDraft } = await import('./builder.js');
const { initI18n } = await import('../i18n.js');
const { api } = await import('./state.js');

beforeEach(async () => {
  // t() throws on unknown keys — the catalog must be loaded for transforms
  // that touch names via the unnamed fallback.
  globalThis.fetch = /** @type {any} */ (vi.fn(async () => ({
    ok: true,
    json: async () => ({
      locale: 'en',
      defaultLocale: 'en',
      messages: { 'web.builder.unnamed': 'Untitled pipeline' },
      locales: [{ id: 'en', label: 'English' }],
    }),
  })));
  await initI18n(api);
});

describe('builder — draft ↔ pipeline transforms', () => {
  it('draftToPipeline drops empty steps and trims fields', () => {
    const p = draftToPipeline({
      name: '  Auditoria  ',
      description: '  vê segurança  ',
      steps: [
        { name: ' 1. Ler ', prompt: ' Read the repo. ', scope: 'project', dependsOn: '' },
        { name: ' ', prompt: ' ', scope: 'project', dependsOn: '' },
        { name: '2. Testar', prompt: 'Write tests.', scope: 'per-file', dependsOn: '1. Ler' },
      ],
    });
    expect(p.name).toBe('Auditoria');
    expect(p.description).toBe('vê segurança');
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0]).toEqual({ name: '1. Ler', prompt: 'Read the repo.', files: ['**/*'] });
    // non-default scope and deps travel; default scope is omitted
    expect(p.steps[1].scope).toBe('per-file');
    expect(p.steps[1].dependsOn).toEqual(['1. Ler']);
  });

  it('draftToPipeline never emits an unnamed, stepless pipeline', () => {
    const p = draftToPipeline({ name: '', description: '', steps: [{ name: '', prompt: '' }] });
    expect(typeof p.name).toBe('string');
    expect(String(p.name).length).toBeGreaterThan(0);
  });

  it('pipelineToDraft round-trips name, description, scope and dependsOn', () => {
    const draft = pipelineToDraft({
      name: 'Limpeza',
      description: 'refatora',
      steps: [
        { name: '1. Varredura', prompt: 'Find dead code.', files: ['src/**'], scope: 'flexible', dependsOn: [] },
        { name: '2. Remover', prompt: 'Remove it.', files: ['src/**'], dependsOn: ['1. Varredura'] },
      ],
    });
    expect(draft.name).toBe('Limpeza');
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps[0].scope).toBe('flexible');
    expect(draft.steps[1].dependsOn).toBe('1. Varredura');
    const back = draftToPipeline(draft);
    expect(back.steps[1].dependsOn).toEqual(['1. Varredura']);
  });

  it('pipelineToDraft tolerates a check step (condition lands in the prompt box)', () => {
    const draft = pipelineToDraft({
      name: 'Com portão',
      steps: [
        { name: '1. Trabalho', prompt: 'Do the thing.', files: ['**/*'] },
        { type: 'check', name: '2. Julgar', condition: 'Did it work?', outcomes: [{ label: 'ok', nextStepName: '3. Fim', default: true }] },
      ],
    });
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps[1].prompt).toContain('Did it work?');
  });

  it('pipelineToDraft yields ONE editable step for an empty pipeline', () => {
    const draft = pipelineToDraft({ name: 'x', steps: [] });
    expect(draft.steps).toHaveLength(1);
  });
});
