import { describe, it, expect } from 'vitest';
import {
  RECON_CATALOG,
  RECON_AGENTS,
  buildReconSystemPrompt,
  type ReconCatalogId,
} from './project-recon-prompts.js';

describe('RECON_CATALOG', () => {
  it('includes the four foundational missions', () => {
    const ids = RECON_CATALOG.map((a) => a.id);
    for (const required of ['stack', 'structure', 'libraries', 'conventions'] as ReconCatalogId[]) {
      expect(ids).toContain(required);
    }
  });

  it('every entry has a non-empty label, description, and mission', () => {
    for (const a of RECON_CATALOG) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(10);
      expect(a.mission.length).toBeGreaterThan(20);
    }
  });

  it('catalog ids are unique', () => {
    const ids = RECON_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes a meaningful range of processes (not just the legacy 4)', () => {
    expect(RECON_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(RECON_CATALOG.length).toBeLessThanOrEqual(20);
  });

  it('RECON_AGENTS is a backwards-compatible alias for RECON_CATALOG', () => {
    expect(RECON_AGENTS).toBe(RECON_CATALOG);
  });
});

describe('buildReconSystemPrompt', () => {
  const stack = RECON_CATALOG.find((a) => a.id === 'stack')!;

  it('embeds the agent id and mission verbatim', () => {
    const p = buildReconSystemPrompt({ id: stack.id, mission: stack.mission });
    expect(p).toMatch(/"stack"/);
    expect(p).toContain(stack.mission);
  });

  it('falls back to `tag` when `id` is omitted (custom items)', () => {
    const p = buildReconSystemPrompt({ tag: 'custom:0', mission: 'do stuff with X' });
    expect(p).toMatch(/"custom:0"/);
    expect(p).toContain('do stuff with X');
  });

  it('declares Portuguese as the response language', () => {
    const p = buildReconSystemPrompt({ id: stack.id, mission: stack.mission });
    expect(p).toMatch(/português/i);
  });

  it('mentions the bullets[] JSON output format', () => {
    const p = buildReconSystemPrompt({ id: stack.id, mission: stack.mission });
    expect(p).toMatch(/"bullets"/);
    expect(p).toMatch(/Mínimo 2, máximo 6/);
  });

  it('frames the agent in fast / focused mode', () => {
    const p = buildReconSystemPrompt({ id: stack.id, mission: stack.mission });
    expect(p).toMatch(/RÁPIDO|VARREDURA FOCADA/);
    expect(p).toMatch(/direto ao ponto|conciso/i);
  });

  it('forbids exploring beyond the digest (no node_modules / no fs)', () => {
    const p = buildReconSystemPrompt({ id: stack.id, mission: stack.mission });
    expect(p).toMatch(/node_modules/);
    expect(p).toMatch(/digest é tudo/i);
  });

  it('includes the project name when provided', () => {
    const p = buildReconSystemPrompt(
      { id: stack.id, mission: stack.mission },
      'huu',
    );
    expect(p).toMatch(/"huu"/);
  });

  it('omits the project name when missing', () => {
    const p = buildReconSystemPrompt({ id: stack.id, mission: stack.mission });
    expect(p).not.toMatch(/"undefined"/);
  });

  it('forbids preâmbulo / comentários fora do JSON', () => {
    const p = buildReconSystemPrompt({ id: stack.id, mission: stack.mission });
    expect(p).toMatch(/preâmbulo/);
  });
});
