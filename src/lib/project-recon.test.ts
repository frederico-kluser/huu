import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RECON_AGENTS,
  RECON_MODEL,
  ReconBulletsSchema,
  buildReconContextMarkdown,
  runProjectRecon,
  type ReconAgentResult,
  type ReconUpdate,
} from './project-recon.js';

describe('RECON_MODEL', () => {
  it('points at minimax m2.7 (cheap + parallel-friendly)', () => {
    expect(RECON_MODEL).toBe('minimax/minimax-m2.7');
  });
});

describe('ReconBulletsSchema', () => {
  it('accepts a small array of short bullets', () => {
    const r = ReconBulletsSchema.safeParse({ bullets: ['a', 'b'] });
    expect(r.success).toBe(true);
  });

  it('rejects empty arrays', () => {
    const r = ReconBulletsSchema.safeParse({ bullets: [] });
    expect(r.success).toBe(false);
  });

  it('rejects too many bullets', () => {
    const r = ReconBulletsSchema.safeParse({ bullets: Array(20).fill('x') });
    expect(r.success).toBe(false);
  });
});

describe('buildReconContextMarkdown', () => {
  const sample: ReconAgentResult[] = [
    {
      agent: RECON_AGENTS[0]!,
      status: 'done',
      bullets: ['fato 1', 'fato 2'],
    },
    {
      agent: RECON_AGENTS[1]!,
      status: 'error',
      bullets: [],
      error: 'oops',
    },
    {
      agent: RECON_AGENTS[2]!,
      status: 'done',
      bullets: ['lib X usa Y'],
    },
  ];

  it('renders sections for agents that produced bullets', () => {
    const md = buildReconContextMarkdown(sample);
    expect(md).toMatch(/### /);
    expect(md).toMatch(/- fato 1/);
    expect(md).toMatch(/- lib X usa Y/);
  });

  it('skips errored agents (no empty sections)', () => {
    const md = buildReconContextMarkdown(sample);
    expect(md).not.toMatch(new RegExp(`### ${RECON_AGENTS[1]!.label}`));
  });

  it('returns empty string when nothing succeeded', () => {
    const md = buildReconContextMarkdown([
      { agent: RECON_AGENTS[0]!, status: 'error', bullets: [] },
    ]);
    expect(md).toBe('');
  });
});

describe('runProjectRecon — stub mode', () => {
  let root: string;
  let originalStubFlag: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'huu-recon-'));
    originalStubFlag = process.env.HUU_LANGCHAIN_STUB;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (originalStubFlag === undefined) delete process.env.HUU_LANGCHAIN_STUB;
    else process.env.HUU_LANGCHAIN_STUB = originalStubFlag;
  });

  it('returns one canned result per RECON_AGENT when apiKey === "stub"', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }));
    const updates: ReconUpdate[] = [];
    const results = await runProjectRecon({
      apiKey: 'stub',
      repoRoot: root,
      onUpdate: (u) => updates.push(u),
    });
    expect(results).toHaveLength(RECON_AGENTS.length);
    for (const r of results) {
      expect(r.status).toBe('done');
      expect(r.bullets.length).toBeGreaterThan(0);
    }
  });

  it('emits at least one running and one done update per agent', async () => {
    const updates: ReconUpdate[] = [];
    await runProjectRecon({
      apiKey: 'stub',
      repoRoot: root,
      onUpdate: (u) => updates.push(u),
    });
    for (const agent of RECON_AGENTS) {
      const mine = updates.filter((u) => u.agentId === agent.id);
      expect(mine.some((u) => u.status === 'running')).toBe(true);
      expect(mine.some((u) => u.status === 'done')).toBe(true);
    }
  });

  it('respects HUU_LANGCHAIN_STUB even when apiKey is real-ish', async () => {
    process.env.HUU_LANGCHAIN_STUB = '1';
    const results = await runProjectRecon({
      apiKey: 'sk-or-real-looking',
      repoRoot: root,
      onUpdate: () => {},
    });
    for (const r of results) expect(r.status).toBe('done');
  });
});

describe('runProjectRecon — real mode guards', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'huu-recon-'));
    delete process.env.HUU_LANGCHAIN_STUB;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('errors out (and notifies every agent) when apiKey is empty', async () => {
    const updates: ReconUpdate[] = [];
    await expect(
      runProjectRecon({
        apiKey: '',
        repoRoot: root,
        onUpdate: (u) => updates.push(u),
      }),
    ).rejects.toThrow(/API key/i);
    const errored = updates.filter((u) => u.status === 'error');
    expect(errored.length).toBe(RECON_AGENTS.length);
  });
});
