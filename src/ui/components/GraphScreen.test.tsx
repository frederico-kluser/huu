/**
 * What this file DOES and DOES NOT prove — read this before trusting it.
 *
 * huu has no Ink renderer in its devDependencies and not one `.test.tsx` under
 * `src/ui/components/`, so nothing here asserts a rendered frame: key handling,
 * the scroll window and the colors are NOT covered, and a regression in them
 * would reach a user. Adding a renderer means adding a devDependency, which is
 * a decision for the repo, not a side effect of this screen.
 *
 * What IS covered is the seam the screen actually stands on — the chain it runs
 * on every keypress (`writeGraph` → `listGraphs` → `readGraph` →
 * `validateGraph` → `compileGraphPipeline` → `Pipeline`) and the one rule in
 * this module whose failure mode is DATA LOSS (`availableGraphId` never
 * overwrites a graph somebody drew). The diagram itself is pinned separately and
 * exhaustively in `src/lib/graph-render.test.ts`; the navigation is pinned in
 * `src/lib/screen-fsm.test.ts`.
 *
 * Real filesystem, throwaway dirs — the house recipe (`writing-tests`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { availableGraphId, shortStamp } from './GraphScreen.js';
import {
  graphPath,
  graphsDir,
  listGraphs,
  readGraph,
  writeGraph,
} from '../../lib/dev-graph/graph-store.js';
import { GRAPH_SAMPLES, findSample } from '../../lib/dev-graph/graph-samples.js';
import { validateGraph } from '../../lib/dev-graph/graph-validate.js';
import { compileGraphPipeline } from '../../lib/dev-graph/graph-to-pipeline.js';
import { DEV_MODE_DIR } from '../../lib/types/dev-mode.js';
import type { DevGraph } from '../../lib/dev-graph/graph-types.js';
import { mkdirSync } from 'node:fs';

const STAMP = '2026-08-03T12:00:00.000Z';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'huu-graphscreen-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Exactly what the screen does when ENTER is pressed on an example. */
function saveSample(sampleId: string): DevGraph {
  const sample = findSample(sampleId)!;
  const built = sample.build(STAMP);
  const id = availableGraphId(repo, built.id)!;
  const result = writeGraph(repo, { ...built, id });
  expect(result.ok).toBe(true);
  return (result as { ok: true; graph: DevGraph }).graph;
}

/** Exactly what the screen does when R is pressed on a valid graph. */
function compile(graph: DevGraph) {
  const sessionId = 'graph-testsess';
  return compileGraphPipeline({
    graph,
    graphRoot: `${DEV_MODE_DIR}/${sessionId}/graph`,
    sessionId,
  });
}

describe('GraphScreen / the example → list → run chain', () => {
  it('lists nothing at all in a repo that never saved a graph', () => {
    // The empty state the screen renders, and the reason it points at S.
    expect(listGraphs(repo)).toEqual([]);
  });

  it('saves an example into the graph store, where the picker finds it', () => {
    saveSample('tdd-seguranca-performance');
    const rows = listGraphs(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('tdd-seguranca-performance');
  });

  it('lists a shipped example as runnable', () => {
    saveSample('portao-de-qualidade');
    expect(listGraphs(repo)[0]!.valid).toBe(true);
  });

  it('carries the counts the list row shows', () => {
    const saved = saveSample('tdd-seguranca-performance');
    const row = listGraphs(repo)[0]!;
    expect(row.nodeCount).toBe(saved.nodes.length);
    expect(row.edgeCount).toBe(saved.edges.length);
  });

  it('reads back by id the graph the highlighted row addresses', () => {
    saveSample('recon-fanout');
    const result = readGraph(repo, 'recon-fanout');
    expect(result.ok).toBe(true);
    expect((result as { ok: true; graph: DevGraph }).graph.name).toBe(
      findSample('recon-fanout')!.name,
    );
  });

  it('compiles every shipped example into a runnable pipeline', () => {
    for (const sample of GRAPH_SAMPLES) {
      const compiled = compile(sample.build(STAMP));
      expect(compiled.pipeline.steps.length, sample.id).toBeGreaterThan(0);
      expect(compiled.pipeline.name.length, sample.id).toBeGreaterThan(0);
    }
  });

  it('leaves the compiled pipeline WITHOUT a per-step model, so the model selector still runs', () => {
    // The launch chain skips the model selector when every step pins a model;
    // a graph compiled with no run model must NOT trip that fast path.
    const compiled = compile(findSample('pesquisa-booleana')!.build(STAMP));
    expect(compiled.pipeline.steps.every((step) => !step.modelId)).toBe(true);
  });

  it('reports the compiler notes instead of swallowing them', () => {
    // The TDD example relaxes a join, which the compiler carries as a warning.
    const compiled = compile(findSample('tdd-seguranca-performance')!.build(STAMP));
    expect(compiled.warnings.some((w) => w.includes('join-subset-drops-barrier'))).toBe(true);
  });

  it('THROWS on an invalid graph — the exact reason the R key guards first', () => {
    const broken: DevGraph = {
      _format: 'huu-devgraph-v1',
      id: 'broken',
      name: 'Broken',
      createdAt: STAMP,
      updatedAt: STAMP,
      meta: {},
      // No prompt node: `no-prompt-node`, and the action is unreachable.
      nodes: [
        {
          id: 'solo',
          kind: 'action',
          label: 'Solo',
          position: { x: 0, y: 0 },
          block: 'implement',
          join: { mode: 'all' },
        },
      ],
      edges: [],
    };
    expect(validateGraph(broken).ok).toBe(false);
    expect(() => compile(broken)).toThrow(/does not compile/);
  });

  it('still SAVES and still LISTS a graph that does not compile', () => {
    // `valid: false` means "needs fixing", never "do not open" — the picker has
    // to show it or the human cannot reach the thing they must repair.
    mkdirSync(graphsDir(repo), { recursive: true });
    writeFileSync(
      graphPath(repo, 'meio-feito'),
      JSON.stringify({
        _format: 'huu-devgraph-v1',
        id: 'meio-feito',
        name: 'Meio feito',
        createdAt: STAMP,
        updatedAt: STAMP,
        meta: {},
        nodes: [
          {
            id: 'solo',
            kind: 'action',
            label: 'Solo',
            position: { x: 0, y: 0 },
            block: 'implement',
            join: { mode: 'all' },
          },
        ],
        edges: [],
      }),
      'utf8',
    );
    const rows = listGraphs(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.valid).toBe(false);
  });

  it('counts the blocking problems the refused R key reports', () => {
    // The R handler on an invalid row does exactly this: read, validate, count —
    // and never reaches the compiler, which would throw.
    mkdirSync(graphsDir(repo), { recursive: true });
    writeFileSync(
      graphPath(repo, 'meio-feito'),
      JSON.stringify({
        _format: 'huu-devgraph-v1',
        id: 'meio-feito',
        name: 'Meio feito',
        createdAt: STAMP,
        updatedAt: STAMP,
        meta: {},
        nodes: [
          {
            id: 'solo',
            kind: 'action',
            label: 'Solo',
            position: { x: 0, y: 0 },
            block: 'implement',
            join: { mode: 'all' },
          },
        ],
        edges: [],
      }),
      'utf8',
    );
    const result = readGraph(repo, 'meio-feito');
    expect(result.ok).toBe(true);
    const count = validateGraph((result as { ok: true; graph: DevGraph }).graph).errors.length;
    expect(count).toBeGreaterThan(0);
  });

  it('says why it cannot open a graph that is not there', () => {
    const result = readGraph(repo, 'nope');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/^not-found:/);
  });
});

describe('GraphScreen / availableGraphId — saving an example never destroys work', () => {
  it('uses the requested id when nothing is there', () => {
    expect(availableGraphId(repo, 'portao-de-qualidade')).toBe('portao-de-qualidade');
  });

  it('steps aside to -2 when the id is taken', () => {
    saveSample('portao-de-qualidade');
    expect(availableGraphId(repo, 'portao-de-qualidade')).toBe('portao-de-qualidade-2');
  });

  it('walks past every taken suffix', () => {
    const built = findSample('portao-de-qualidade')!.build(STAMP);
    for (const id of ['portao-de-qualidade', 'portao-de-qualidade-2', 'portao-de-qualidade-3']) {
      expect(writeGraph(repo, { ...built, id }).ok).toBe(true);
    }
    expect(availableGraphId(repo, 'portao-de-qualidade')).toBe('portao-de-qualidade-4');
  });

  it('leaves the graph that was already there untouched', () => {
    const original = saveSample('portao-de-qualidade');
    const next = availableGraphId(repo, 'portao-de-qualidade')!;
    const built = findSample('tdd-seguranca-performance')!.build(STAMP);
    writeGraph(repo, { ...built, id: next });
    const reread = readGraph(repo, original.id);
    expect(reread.ok).toBe(true);
    expect((reread as { ok: true; graph: DevGraph }).graph.name).toBe(original.name);
  });

  it('keeps the free id short enough to stay a slug', () => {
    const long = 'a'.repeat(40);
    const built = findSample('portao-de-qualidade')!.build(STAMP);
    expect(writeGraph(repo, { ...built, id: long }).ok).toBe(true);
    const next = availableGraphId(repo, long)!;
    expect(next.length).toBeLessThanOrEqual(40);
    expect(next).toBe(`${'a'.repeat(38)}-2`);
  });
});

describe('GraphScreen / shortStamp', () => {
  it('trims an ISO instant to the minute, keeping it sortable', () => {
    expect(shortStamp('2026-08-03T12:34:56.789Z')).toBe('2026-08-03 12:34');
  });

  it('passes a value it cannot shorten through unchanged', () => {
    expect(shortStamp('2026')).toBe('2026');
  });
});
