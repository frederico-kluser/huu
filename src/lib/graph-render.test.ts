/**
 * The text drawing of a hand-drawn method.
 *
 * These assertions are the reason `graph-render.ts` is NOT inside the Ink
 * component: every question here ("does the consolidator say it waits for only
 * the performance review?") is answered by a string, with no terminal, no
 * width and no color in the way.
 *
 * LOCALE IS PINNED TO `en` — the module translates its FRAME, so an assertion
 * about the words would otherwise depend on the developer's `LANG`. The
 * identifiers it does NOT translate (node ids, arm ids, `action:tdd`, the
 * `GraphIssueCode`s) are asserted as-is, which is the whole point of leaving
 * them alone.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { renderGraphSummary, renderGraphTree, renderIssues } from './graph-render.js';
import { GRAPH_SAMPLES, findSample } from './dev-graph/graph-samples.js';
import { validateGraph } from './dev-graph/graph-validate.js';
import type {
  DevGraph,
  GraphEdge,
  GraphNode,
  GraphValidation,
} from './dev-graph/graph-types.js';
import { initI18n } from './i18n/index.js';

beforeAll(() => {
  initI18n({ HUU_LANG: 'en' } as NodeJS.ProcessEnv);
});

const STAMP = '2026-08-03T12:00:00.000Z';

function graphOf(nodes: GraphNode[], edges: GraphEdge[], id = 'fixture'): DevGraph {
  return {
    _format: 'huu-devgraph-v1',
    id,
    name: 'Fixture',
    createdAt: STAMP,
    updatedAt: STAMP,
    meta: {},
    nodes,
    edges,
  };
}

function prompt(id = 'entrada'): GraphNode {
  return { id, kind: 'prompt', label: 'Entry', position: { x: 0, y: 0 }, goal: 'do the thing' };
}

function action(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind: 'action',
    label: id,
    position: { x: 0, y: 0 },
    block: 'implement',
    join: { mode: 'all' },
    ...extra,
  } as GraphNode;
}

function edge(id: string, source: string, target: string, sourceOutcome?: string): GraphEdge {
  return sourceOutcome === undefined
    ? { id, source, target }
    : { id, source, target, sourceOutcome };
}

/** The line that describes `nodeId`, from the whole rendered drawing. */
function lineFor(lines: string[], nodeId: string): string {
  const hit = lines.find((line) => line.includes(`  ·  ${nodeId}  ·  `));
  expect(hit, `no node line for "${nodeId}"`).toBeTruthy();
  return hit as string;
}

/** Every indented arm line of the drawing. */
function armLines(lines: string[]): string[] {
  return lines.filter((line) => line.trimStart().startsWith('├') || line.trimStart().startsWith('└'));
}

const tddSample = (): DevGraph => findSample('tdd-seguranca-performance')!.build(STAMP);

/**
 * A gate whose "rejected" arm goes BACK to the work it judged — the shape no
 * shipped sample carries and the one the renderer has to tell apart from an
 * ordinary continuation.
 */
function reworkGraph(): DevGraph {
  return graphOf(
    [
      prompt(),
      action('implementar'),
      {
        id: 'portao',
        kind: 'gate',
        label: 'Gate',
        position: { x: 0, y: 0 },
        condition: 'the suite exits zero',
        outcomes: [
          { id: 'approved', label: 'Approved' },
          { id: 'rejected', label: 'Rejected' },
        ],
        defaultOutcome: 'approved',
        maxRuns: 3,
        join: { mode: 'all' },
      },
      action('documentar', { block: 'docs' }),
    ],
    [
      edge('e-1', 'entrada', 'implementar'),
      edge('e-2', 'implementar', 'portao'),
      edge('e-3', 'portao', 'documentar', 'approved'),
      { id: 'e-4', source: 'portao', target: 'implementar', sourceOutcome: 'rejected', rework: true },
    ],
    'rework',
  );
}

describe('graph-render / renderGraphSummary', () => {
  it('opens with the graph name', () => {
    expect(renderGraphSummary(tddSample())[0]).toBe('TDD, segurança e performance em paralelo');
  });

  it('falls back to (unnamed) when the name is blank', () => {
    const g = { ...graphOf([prompt()], []), name: '   ' };
    expect(renderGraphSummary(g)[0]).toBe('(unnamed)');
  });

  it('counts the nodes and the edges the file actually carries', () => {
    expect(renderGraphSummary(tddSample())[1]).toBe(
      'tdd-seguranca-performance · nodes: 5 · edges: 6',
    );
  });

  it('says a clean graph compiles', () => {
    expect(renderGraphSummary(findSample('pesquisa-booleana')!.build(STAMP))[2]).toContain(
      '✓ compiles',
    );
  });

  it('counts warnings without turning them into errors', () => {
    // The TDD sample carries exactly one warning (the relaxed join) and no error.
    expect(renderGraphSummary(tddSample())[2]).toBe('✓ compiles  ·  errors: 0 · warnings: 1');
  });

  it('says a broken graph does NOT compile, and how many problems block it', () => {
    // No prompt node at all: `no-prompt-node` plus `unreachable-node`.
    const summary = renderGraphSummary(graphOf([action('solo')], []));
    expect(summary[2]).toContain('✗ does not compile');
    expect(summary[2]).toMatch(/errors: [1-9]/);
  });

  it('survives a graph whose nodes and edges are not arrays', () => {
    const junk = { ...graphOf([], []), nodes: null, edges: 7 } as unknown as DevGraph;
    expect(renderGraphSummary(junk)[1]).toBe('fixture · nodes: 0 · edges: 0');
  });

  it('always returns exactly three lines', () => {
    for (const sample of GRAPH_SAMPLES) {
      expect(renderGraphSummary(sample.build(STAMP))).toHaveLength(3);
    }
  });
});

describe('graph-render / renderGraphTree — the join', () => {
  it('marks an ordinary node as waiting for all its predecessors', () => {
    const lines = renderGraphTree(tddSample());
    expect(lineFor(lines, 'tdd')).toContain('⇠ all');
  });

  it('says the consolidator waits for ONLY the performance review', () => {
    // The headline of the whole sample: three fronts drawn, one depended on.
    const line = lineFor(renderGraphTree(tddSample()), 'consolidar');
    expect(line).toContain('⇠ only performance');
  });

  it('never calls that same consolidator an "all" join', () => {
    expect(lineFor(renderGraphTree(tddSample()), 'consolidar')).not.toContain('⇠ all');
  });

  it('keeps the two dropped fronts on the drawing', () => {
    // Relaxing the join removes a DEPENDENCY, not the arrows — the human still
    // has to see where the work came from.
    const lines = renderGraphTree(tddSample());
    expect(lineFor(lines, 'seguranca')).toContain('action:security-review');
    expect(lineFor(lines, 'performance')).toContain('action:performance-review');
  });

  it('drops subset entries that are not real predecessors', () => {
    const g = graphOf(
      [prompt(), action('x'), action('y'), action('z', { join: { mode: 'subset', of: ['y', 'nope'] } })],
      [
        edge('e-1', 'entrada', 'x'),
        edge('e-2', 'entrada', 'y'),
        edge('e-3', 'x', 'z'),
        edge('e-4', 'y', 'z'),
      ],
    );
    expect(lineFor(renderGraphTree(g), 'z')).toContain('⇠ only y');
  });

  it('renders a subset that waits for nothing as (none)', () => {
    const g = graphOf(
      [prompt(), action('x'), action('z', { join: { mode: 'subset', of: ['nope'] } })],
      [edge('e-1', 'entrada', 'x'), edge('e-2', 'x', 'z')],
    );
    expect(lineFor(renderGraphTree(g), 'z')).toContain('⇠ only (none)');
  });

  it('gives the prompt root no join marker — it waits for nothing', () => {
    expect(lineFor(renderGraphTree(tddSample()), 'entrada')).not.toContain('⇠');
  });

  it('gives a node with no inbound edge no join marker either', () => {
    const g = graphOf([prompt(), action('orphan')], []);
    expect(lineFor(renderGraphTree(g), 'orphan')).not.toContain('⇠');
  });
});

describe('graph-render / renderGraphTree — the arms', () => {
  it('lists both arms of a yes/no research node with their destinations', () => {
    const arms = armLines(renderGraphTree(findSample('pesquisa-booleana')!.build(STAMP)));
    expect(arms).toHaveLength(2);
    expect(arms[0]).toContain('yes → implementar');
    expect(arms[1]).toContain('no → tdd');
  });

  it('marks the arm that is the forward default', () => {
    const arms = armLines(renderGraphTree(findSample('pesquisa-booleana')!.build(STAMP)));
    expect(arms[1]).toContain('default');
    expect(arms[0]).not.toContain('default');
  });

  it('gives an n-way choice one line per arm, the last one closing the group', () => {
    const arms = armLines(renderGraphTree(findSample('pesquisa-multipla-escolha')!.build(STAMP)));
    expect(arms).toHaveLength(3);
    expect(arms[0]!.trimStart().startsWith('├')).toBe(true);
    expect(arms[2]!.trimStart().startsWith('└')).toBe(true);
  });

  it('gives an info research node no arms at all — it routes nothing', () => {
    expect(armLines(renderGraphTree(findSample('pesquisa-informativa')!.build(STAMP)))).toEqual([]);
  });

  it('lists a gate outcome with the node it activates', () => {
    const arms = armLines(renderGraphTree(findSample('portao-de-qualidade')!.build(STAMP)));
    expect(arms[0]).toContain('approved → documentar');
    expect(arms[1]).toContain('rejected → corrigir-checagens');
  });

  it('shows an arm with no edge as (none) instead of hiding the hole', () => {
    const g = graphOf(
      [
        prompt(),
        {
          id: 'portao',
          kind: 'gate',
          label: 'Gate',
          position: { x: 0, y: 0 },
          condition: 'c',
          outcomes: [
            { id: 'approved', label: 'A' },
            { id: 'rejected', label: 'R' },
          ],
          defaultOutcome: 'approved',
          join: { mode: 'all' },
        },
        action('documentar'),
      ],
      [edge('e-1', 'entrada', 'portao'), edge('e-2', 'portao', 'documentar', 'approved')],
    );
    const arms = armLines(renderGraphTree(g));
    expect(arms[1]).toContain('rejected → (none)');
  });

  it('lists every destination when one arm was drawn twice', () => {
    const g = graphOf(
      [
        prompt(),
        {
          id: 'portao',
          kind: 'gate',
          label: 'Gate',
          position: { x: 0, y: 0 },
          condition: 'c',
          outcomes: [
            { id: 'approved', label: 'A' },
            { id: 'rejected', label: 'R' },
          ],
          defaultOutcome: 'approved',
          join: { mode: 'all' },
        },
        action('a'),
        action('b'),
      ],
      [
        edge('e-1', 'entrada', 'portao'),
        edge('e-2', 'portao', 'a', 'approved'),
        edge('e-3', 'portao', 'b', 'approved'),
      ],
    );
    const arms = armLines(renderGraphTree(g));
    expect(arms[0]).toContain('→ a');
    expect(arms[0]).toContain('→ b');
  });

  it('gives an action node no arm lines — it has one way out', () => {
    const g = graphOf([prompt(), action('a'), action('b')], [
      edge('e-1', 'entrada', 'a'),
      edge('e-2', 'a', 'b'),
    ]);
    expect(armLines(renderGraphTree(g))).toEqual([]);
  });
});

describe('graph-render / renderGraphTree — rework arms', () => {
  it('marks the arm that goes back with ↺ instead of →', () => {
    const arms = armLines(renderGraphTree(reworkGraph()));
    const back = arms.find((line) => line.includes('rejected'))!;
    expect(back).toContain('↺ implementar');
    expect(back).not.toContain('→ implementar');
  });

  it('leaves the forward arm of the same gate on →', () => {
    const arms = armLines(renderGraphTree(reworkGraph()));
    expect(arms.find((line) => line.includes('approved'))).toContain('→ documentar');
  });

  it('does not let the rework arm reorder the drawing', () => {
    // A rework edge is NOT a dependency, so the work it points back at still
    // comes before the gate that judges it.
    const lines = renderGraphTree(reworkGraph());
    expect(lines.indexOf(lineFor(lines, 'implementar'))).toBeLessThan(
      lines.indexOf(lineFor(lines, 'portao')),
    );
  });

  it('renders a rework graph the validator accepts', () => {
    expect(validateGraph(reworkGraph()).errors).toEqual([]);
  });
});

describe('graph-render / renderGraphTree — shape', () => {
  it('renders a one-node graph as a single line', () => {
    expect(renderGraphTree(graphOf([prompt()], []))).toEqual([' 1. Entry  ·  entrada  ·  prompt']);
  });

  it('says so when nothing has been drawn yet', () => {
    expect(renderGraphTree(graphOf([], []))).toEqual(['(nothing drawn yet)']);
  });

  it('numbers the nodes from 1, right-aligned', () => {
    const lines = renderGraphTree(tddSample());
    expect(lines[0]!.startsWith(' 1. ')).toBe(true);
    expect(lineFor(lines, 'consolidar').startsWith(' 5. ')).toBe(true);
  });

  it('puts a dependency before everything that waits for it', () => {
    const lines = renderGraphTree(findSample('recon-fanout')!.build(STAMP));
    expect(lines.indexOf(lineFor(lines, 'mapear-alvos'))).toBeLessThan(
      lines.indexOf(lineFor(lines, 'gerar-testes'))
    );
  });

  it('still renders the nodes a dependency cycle stranded, and flags them', () => {
    const g = graphOf(
      [prompt(), action('a'), action('b')],
      [edge('e-1', 'entrada', 'a'), edge('e-2', 'a', 'b'), edge('e-3', 'b', 'a')],
    );
    const lines = renderGraphTree(g);
    expect(lines).toHaveLength(3);
    expect(lineFor(lines, 'a')).toContain('in a cycle');
    expect(lineFor(lines, 'b')).toContain('in a cycle');
    expect(lineFor(lines, 'entrada')).not.toContain('in a cycle');
  });

  it('names the fan-out source and the width it was capped at', () => {
    const line = lineFor(renderGraphTree(findSample('recon-fanout')!.build(STAMP)), 'gerar-testes');
    expect(line).toContain('fan-out from mapear-alvos');
    expect(line).toContain('max 8');
  });

  it('adds no fan-out segment to an ordinary action node', () => {
    expect(lineFor(renderGraphTree(tddSample()), 'tdd')).not.toContain('fan-out');
  });

  it('names the block a node runs, not just its kind', () => {
    expect(lineFor(renderGraphTree(tddSample()), 'seguranca')).toContain('action:security-review');
  });

  it('names the output kind of a research node', () => {
    const lines = renderGraphTree(findSample('pesquisa-multipla-escolha')!.build(STAMP));
    expect(lineFor(lines, 'natureza')).toContain('research:choice');
  });

  it('falls back to (unnamed) for a node with a blank label', () => {
    const g = graphOf([{ ...prompt(), label: '  ' } as GraphNode], []);
    expect(renderGraphTree(g)[0]).toContain('(unnamed)');
  });

  it('renders one node line per node for every shipped sample', () => {
    for (const sample of GRAPH_SAMPLES) {
      const graph = sample.build(STAMP);
      const lines = renderGraphTree(graph);
      const nodeLines = lines.filter((line) => /^\s*\d+\. /.test(line));
      expect(nodeLines, sample.id).toHaveLength(graph.nodes.length);
    }
  });

  it('never renders a raw catalog key (every frame word is translated)', () => {
    for (const sample of GRAPH_SAMPLES) {
      for (const line of renderGraphTree(sample.build(STAMP))) {
        expect(line, sample.id).not.toContain('tui.graph.');
      }
    }
  });
});

describe('graph-render / renderIssues', () => {
  it('affirms a clean graph instead of returning nothing', () => {
    const clean = validateGraph(findSample('pesquisa-booleana')!.build(STAMP));
    expect(renderIssues(clean)).toEqual(['✓ no problem found']);
  });

  it('leads every line with the stable issue code', () => {
    const broken = validateGraph(graphOf([action('solo')], []));
    expect(renderIssues(broken).every((line) => /\[[a-z-]+\]/.test(line))).toBe(true);
  });

  it('puts errors before warnings', () => {
    const g = graphOf(
      [prompt(), action('a'), action('z', { join: { mode: 'subset', of: ['a'] } }), action('orphan')],
      [edge('e-1', 'entrada', 'a'), edge('e-2', 'a', 'z')],
    );
    const validation = validateGraph(g);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.warnings.length).toBeGreaterThan(0);
    const lines = renderIssues(validation);
    expect(lines[0]!.startsWith('✗')).toBe(true);
    expect(lines[lines.length - 1]!.startsWith('⚠')).toBe(true);
  });

  it('anchors a node problem with @nodeId', () => {
    const lines = renderIssues(validateGraph(tddSample()));
    expect(lines[0]).toContain('@consolidar');
  });

  it('reports the TDD sample warning under its documented code', () => {
    expect(renderIssues(validateGraph(tddSample()))[0]).toContain('[join-subset-drops-barrier]');
  });

  it('anchors an edge problem with #edgeId', () => {
    // A named arm leaving a node that has only one way out: `edge-outcome-forbidden`.
    const g = graphOf([prompt(), action('a')], [edge('e-1', 'entrada', 'a', 'yes')]);
    const lines = renderIssues(validateGraph(g));
    expect(lines.some((line) => line.includes('#e-1'))).toBe(true);
  });

  it('prints BOTH anchors when a problem names an arm of a node', () => {
    // `edge-outcome-forbidden` carries nodeId AND edgeId — either one alone
    // would be ambiguous on a canvas.
    const g = graphOf([prompt(), action('a')], [edge('e-1', 'entrada', 'a', 'yes')]);
    const hit = renderIssues(validateGraph(g)).find((line) =>
      line.includes('[edge-outcome-forbidden]'),
    );
    expect(hit).toContain('@entrada #e-1');
  });

  it('keeps the validator message, which carries the specifics a code cannot', () => {
    const lines = renderIssues(validateGraph(tddSample()));
    expect(lines[0]).toContain('consolidar');
    expect(lines[0]!.length).toBeGreaterThan(40);
  });

  it('survives a validation object whose lists are missing', () => {
    const junk = { ok: true } as unknown as GraphValidation;
    expect(renderIssues(junk)).toEqual(['✓ no problem found']);
  });

  it('renders one line per issue, errors and warnings together', () => {
    const validation = validateGraph(graphOf([action('solo')], []));
    expect(renderIssues(validation)).toHaveLength(
      validation.errors.length + validation.warnings.length,
    );
  });
});
