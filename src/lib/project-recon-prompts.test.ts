import { describe, it, expect } from 'vitest';
import {
  RECON_AGENTS,
  buildReconSystemPrompt,
  type ReconAgentId,
} from './project-recon-prompts.js';

describe('RECON_AGENTS', () => {
  it('defines exactly the four expected missions', () => {
    const ids = RECON_AGENTS.map((a) => a.id).sort();
    expect(ids).toEqual<ReconAgentId[]>([
      'conventions',
      'libraries',
      'stack',
      'structure',
    ]);
  });

  it('every agent has a non-empty label and mission', () => {
    for (const a of RECON_AGENTS) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.mission.length).toBeGreaterThan(20);
    }
  });

  it('agent ids are unique', () => {
    const ids = RECON_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildReconSystemPrompt', () => {
  const stack = RECON_AGENTS.find((a) => a.id === 'stack')!;

  it('embeds the agent id and mission verbatim', () => {
    const p = buildReconSystemPrompt(stack);
    expect(p).toMatch(/"stack"/);
    expect(p).toContain(stack.mission);
  });

  it('declares Portuguese as the response language', () => {
    const p = buildReconSystemPrompt(stack);
    expect(p).toMatch(/português/i);
  });

  it('mentions the bullets[] JSON output format', () => {
    const p = buildReconSystemPrompt(stack);
    expect(p).toMatch(/"bullets"/);
    expect(p).toMatch(/Mínimo 2, máximo 6/);
  });

  it('frames the agent in fast / focused mode', () => {
    const p = buildReconSystemPrompt(stack);
    expect(p).toMatch(/RÁPIDO|VARREDURA FOCADA/);
    expect(p).toMatch(/direto ao ponto|conciso/i);
  });

  it('forbids exploring beyond the digest (no node_modules / no fs)', () => {
    const p = buildReconSystemPrompt(stack);
    expect(p).toMatch(/node_modules/);
    expect(p).toMatch(/digest é tudo/i);
  });

  it('includes the project name when provided', () => {
    const p = buildReconSystemPrompt(stack, 'huu');
    expect(p).toMatch(/"huu"/);
  });

  it('omits the project name when missing', () => {
    const p = buildReconSystemPrompt(stack);
    expect(p).not.toMatch(/"undefined"/);
  });

  it('forbids preâmbulo / comentários fora do JSON', () => {
    const p = buildReconSystemPrompt(stack);
    expect(p).toMatch(/preâmbulo/);
  });
});
