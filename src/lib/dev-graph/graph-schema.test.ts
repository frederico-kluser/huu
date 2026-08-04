import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ActionNode, DevGraph, GateNode, ResearchNode } from './graph-types.js';
import {
  DEVGRAPH_DEFAULT_GOAL,
  DEVGRAPH_FORMAT_TAG,
  DevGraphSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  emptyDevGraph,
  newEdgeId,
  newNodeId,
  parseDevGraph,
  serializeDevGraph,
} from './graph-schema.js';

const NOW = '2026-08-03T12:00:00.000Z';

/**
 * Compile-time drift guard, both directions: the schema's OUTPUT and the
 * hand-written `DevGraph` must be the same type. A field added to one and
 * forgotten in the other fails `tsc`, which is the only moment anyone would
 * notice before a graph silently loses it on save.
 */
type SchemaOutput = z.infer<typeof DevGraphSchema>;
const _outputIsDevGraph: DevGraph = {} as SchemaOutput;
const _devGraphIsOutput: SchemaOutput = {} as DevGraph;
void _outputIsDevGraph;
void _devGraphIsOutput;

function baseGraph(): Record<string, unknown> {
  return {
    _format: DEVGRAPH_FORMAT_TAG,
    id: 'my-graph',
    name: 'My graph',
    createdAt: NOW,
    updatedAt: NOW,
    meta: {},
    nodes: [
      {
        id: 'prompt-1',
        kind: 'prompt',
        label: 'Entrada',
        position: { x: 0, y: 0 },
        goal: 'Ship the thing',
      },
    ],
    edges: [],
  };
}

describe('graph-schema / format tag', () => {
  it('pins the format tag', () => {
    expect(DEVGRAPH_FORMAT_TAG).toBe('huu-devgraph-v1');
  });

  it('rejects a payload carrying another format', () => {
    const result = parseDevGraph({ ...baseGraph(), _format: 'huu-pipeline-v2' });
    expect(result.ok).toBe(false);
  });
});

describe('graph-schema / parseDevGraph', () => {
  it('accepts a minimal graph', () => {
    const result = parseDevGraph(baseGraph());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.graph.nodes).toHaveLength(1);
  });

  it('accepts what emptyDevGraph builds', () => {
    expect(parseDevGraph(emptyDevGraph('g1', 'G1', NOW)).ok).toBe(true);
  });

  it('never throws on hostile input', () => {
    for (const input of [null, undefined, 42, 'graph', [], { nodes: null }]) {
      expect(() => parseDevGraph(input)).not.toThrow();
      expect(parseDevGraph(input).ok).toBe(false);
    }
  });

  it('reports the failing path in every error string', () => {
    const result = parseDevGraph({ ...baseGraph(), id: 'Not A Slug' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('id:');
    }
  });

  it('requires a slug for the graph id (a DECLARED id is strict here)', () => {
    for (const id of ['Not-A-Slug', '-leading', 'with_underscore', '', 'a'.repeat(41)]) {
      expect(parseDevGraph({ ...baseGraph(), id }).ok, id).toBe(false);
    }
  });

  it('accepts a slug graph id at the boundaries', () => {
    for (const id of ['a', '0', 'a'.repeat(40), 'a-b-c-1']) {
      expect(parseDevGraph({ ...baseGraph(), id }).ok, id).toBe(true);
    }
  });

  it('requires a non-empty name', () => {
    expect(parseDevGraph({ ...baseGraph(), name: '' }).ok).toBe(false);
  });

  it('defaults meta to an empty object when the file omits it', () => {
    const payload = baseGraph();
    delete payload.meta;
    const result = parseDevGraph(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.graph.meta).toEqual({});
  });

  it('keeps the methodology record the human underwrote', () => {
    const result = parseDevGraph({ ...baseGraph(), meta: { methodology: { tdd: true } } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.graph.meta.methodology).toEqual({ tdd: true });
  });

  it('rejects a methodology flag that is not `true`', () => {
    expect(parseDevGraph({ ...baseGraph(), meta: { methodology: { tdd: false } } }).ok).toBe(false);
  });

  it('strips unknown keys instead of failing the whole graph', () => {
    const result = parseDevGraph({ ...baseGraph(), rogue: 'value' });
    expect(result.ok).toBe(true);
    if (result.ok) expect('rogue' in result.graph).toBe(false);
  });

  it('rejects an unknown node kind', () => {
    const payload = baseGraph();
    payload.nodes = [{ id: 'x', kind: 'wat', label: 'x', position: { x: 0, y: 0 } }];
    expect(parseDevGraph(payload).ok).toBe(false);
  });

  it('rejects a non-finite position', () => {
    const payload = baseGraph();
    payload.nodes = [
      { id: 'p', kind: 'prompt', label: 'p', position: { x: 'left', y: 0 }, goal: 'g' },
    ];
    expect(parseDevGraph(payload).ok).toBe(false);
  });

  it('rejects an empty goal (the root always says something)', () => {
    const payload = baseGraph();
    payload.nodes = [
      { id: 'p', kind: 'prompt', label: 'p', position: { x: 0, y: 0 }, goal: '' },
    ];
    expect(parseDevGraph(payload).ok).toBe(false);
  });
});

describe('graph-schema / join defaults', () => {
  const nodeWithoutJoin = {
    id: 'a1',
    kind: 'action',
    label: 'Do it',
    position: { x: 1, y: 2 },
    block: 'implement',
  };

  it('defaults an action join to `all`', () => {
    const parsed = GraphNodeSchema.parse(nodeWithoutJoin);
    expect(parsed.kind === 'action' && parsed.join).toEqual({ mode: 'all' });
  });

  it('defaults a research join to `all`', () => {
    const parsed = GraphNodeSchema.parse({
      id: 'r1',
      kind: 'research',
      label: 'Ask',
      position: { x: 0, y: 0 },
      query: 'Does it build?',
      useContext: true,
      outputKind: 'info',
    });
    expect(parsed.kind === 'research' && parsed.join).toEqual({ mode: 'all' });
  });

  it('defaults a gate join to `all`', () => {
    const parsed = GraphNodeSchema.parse({
      id: 'g1',
      kind: 'gate',
      label: 'Check',
      position: { x: 0, y: 0 },
      condition: 'tests pass',
      outcomes: [{ id: 'yes', label: 'Sim' }],
      defaultOutcome: 'yes',
    });
    expect(parsed.kind === 'gate' && parsed.join).toEqual({ mode: 'all' });
  });

  it('gives each defaulted node its OWN join object', () => {
    const first = GraphNodeSchema.parse(nodeWithoutJoin);
    const second = GraphNodeSchema.parse({ ...nodeWithoutJoin, id: 'a2' });
    expect(first.kind === 'action' && second.kind === 'action' && first.join === second.join).toBe(
      false,
    );
  });

  it('keeps an explicit subset join', () => {
    const parsed = GraphNodeSchema.parse({
      ...nodeWithoutJoin,
      join: { mode: 'subset', of: ['perf'] },
    });
    expect(parsed.kind === 'action' && parsed.join).toEqual({ mode: 'subset', of: ['perf'] });
  });

  it('rejects an unknown join mode', () => {
    expect(() => GraphNodeSchema.parse({ ...nodeWithoutJoin, join: { mode: 'any' } })).toThrow();
  });

  it('gives the prompt node no join at all', () => {
    const parsed = GraphNodeSchema.parse({
      id: 'p',
      kind: 'prompt',
      label: 'p',
      position: { x: 0, y: 0 },
      goal: 'go',
    });
    expect('join' in parsed).toBe(false);
  });
});

describe('graph-schema / shape vs product rules', () => {
  // The schema is a SHAPE guard; product LIMITS belong to validateGraph so an
  // over-sized graph still OPENS in the editor with a readable issue.
  it('parses a graph with more nodes than the product cap', () => {
    const payload = baseGraph();
    payload.nodes = [
      ...(payload.nodes as unknown[]),
      ...Array.from({ length: 60 }, (_, index) => ({
        id: `a-${index}`,
        kind: 'action',
        label: 'A',
        position: { x: 0, y: 0 },
        block: 'implement',
      })),
    ];
    expect(parseDevGraph(payload).ok).toBe(true);
  });

  it('parses a label longer than the product cap', () => {
    const payload = baseGraph();
    payload.nodes = [
      { id: 'p', kind: 'prompt', label: 'x'.repeat(200), position: { x: 0, y: 0 }, goal: 'g' },
    ];
    expect(parseDevGraph(payload).ok).toBe(true);
  });

  it('parses an edge pointing at a node that does not exist', () => {
    const payload = baseGraph();
    payload.edges = [{ id: 'e-1', source: 'prompt-1', target: 'ghost' }];
    expect(parseDevGraph(payload).ok).toBe(true);
  });

  it('parses a gate declaring a single outcome', () => {
    const payload = baseGraph();
    payload.nodes = [
      ...(payload.nodes as unknown[]),
      {
        id: 'g1',
        kind: 'gate',
        label: 'Check',
        position: { x: 0, y: 0 },
        condition: 'c',
        outcomes: [{ id: 'ok', label: 'OK' }],
        defaultOutcome: 'ok',
      },
    ];
    expect(parseDevGraph(payload).ok).toBe(true);
  });

  it('still rejects a choice id that is not a slug (a DECLARED id is strict)', () => {
    const payload = baseGraph();
    payload.nodes = [
      ...(payload.nodes as unknown[]),
      {
        id: 'r1',
        kind: 'research',
        label: 'Ask',
        position: { x: 0, y: 0 },
        query: 'q',
        useContext: false,
        outputKind: 'choice',
        choices: [{ id: 'Not A Slug', label: 'x' }],
      },
    ];
    expect(parseDevGraph(payload).ok).toBe(false);
  });
});

describe('graph-schema / GraphEdgeSchema', () => {
  it('accepts an edge without an outcome', () => {
    expect(GraphEdgeSchema.parse({ id: 'e-1', source: 'a', target: 'b' })).toEqual({
      id: 'e-1',
      source: 'a',
      target: 'b',
    });
  });

  it('keeps sourceOutcome when present', () => {
    expect(
      GraphEdgeSchema.parse({ id: 'e-1', source: 'a', target: 'b', sourceOutcome: 'yes' })
        .sourceOutcome,
    ).toBe('yes');
  });

  it('rejects an edge without a target', () => {
    expect(() => GraphEdgeSchema.parse({ id: 'e-1', source: 'a' })).toThrow();
  });

  it('keeps rework:true — the arm that goes back', () => {
    expect(
      GraphEdgeSchema.parse({ id: 'e-1', source: 'a', target: 'b', sourceOutcome: 'red', rework: true }),
    ).toEqual({ id: 'e-1', source: 'a', target: 'b', sourceOutcome: 'red', rework: true });
  });

  it('leaves an ordinary edge with exactly the three keys it always had', () => {
    // The additive contract: a graph drawn before rework existed parses into
    // the same object, with no `rework: false` invented for it.
    const parsed = GraphEdgeSchema.parse({ id: 'e-1', source: 'a', target: 'b' });
    expect(Object.keys(parsed)).toEqual(['id', 'source', 'target']);
    expect('rework' in parsed).toBe(false);
  });

  it('REFUSES rework:false — the off state is the absence of the field', () => {
    expect(() =>
      GraphEdgeSchema.parse({ id: 'e-1', source: 'a', target: 'b', rework: false }),
    ).toThrow();
  });
});

describe('graph-schema / serializeDevGraph', () => {
  function richGraph(): DevGraph {
    const graph = emptyDevGraph('g1', 'G1', NOW);
    const action: ActionNode = {
      id: 'action-1',
      kind: 'action',
      label: 'Implement',
      position: { x: 10, y: 20 },
      block: 'implement',
      join: { mode: 'subset', of: ['prompt-1'] },
      review: true,
    };
    const research: ResearchNode = {
      id: 'research-1',
      kind: 'research',
      label: 'Ask',
      position: { x: 30, y: 40 },
      query: 'Is it covered?',
      useContext: true,
      outputKind: 'choice',
      choices: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      defaultOutcome: 'a',
      join: { mode: 'all' },
    };
    const gate: GateNode = {
      id: 'gate-1',
      kind: 'gate',
      label: 'Green?',
      position: { x: 50, y: 60 },
      condition: 'the suite exits zero',
      outcomes: [
        { id: 'green', label: 'Verde' },
        { id: 'red', label: 'Vermelho' },
      ],
      defaultOutcome: 'green',
      join: { mode: 'all' },
    };
    graph.meta = { methodology: { writeSet: true, tdd: true }, maxNodeExecutions: 30 };
    graph.nodes = [...graph.nodes, action, research, gate];
    graph.edges = [
      { id: 'e-1', source: 'prompt-1', target: 'action-1' },
      { id: 'e-2', source: 'action-1', target: 'research-1' },
      { id: 'e-3', source: 'research-1', target: 'gate-1', sourceOutcome: 'a' },
      { id: 'e-4', source: 'research-1', target: 'gate-1', sourceOutcome: 'b' },
    ];
    return graph;
  }

  it('indents with two spaces and no trailing newline', () => {
    const json = serializeDevGraph(emptyDevGraph('g1', 'G1', NOW));
    expect(json.startsWith('{\n  "_format"')).toBe(true);
    expect(json.endsWith('}')).toBe(true);
  });

  it('emits the envelope keys in declared order', () => {
    const json = serializeDevGraph(richGraph());
    const topLevel = Object.keys(JSON.parse(json) as Record<string, unknown>);
    expect(topLevel).toEqual([
      '_format',
      'id',
      'name',
      'createdAt',
      'updatedAt',
      'meta',
      'nodes',
      'edges',
    ]);
  });

  it('omits absent optional fields instead of writing null', () => {
    const json = serializeDevGraph(emptyDevGraph('g1', 'G1', NOW));
    expect(json).not.toContain('null');
    expect(json).not.toContain('"description"');
    expect(json).not.toContain('"notes"');
  });

  it('sorts the methodology record so a save is not a diff', () => {
    const json = serializeDevGraph(richGraph());
    const parsed = JSON.parse(json) as { meta: { methodology: Record<string, true> } };
    expect(Object.keys(parsed.meta.methodology)).toEqual(['tdd', 'writeSet']);
  });

  it('is stable when the in-memory key order changes', () => {
    const graph = richGraph();
    const shuffled: DevGraph = {
      edges: graph.edges,
      nodes: graph.nodes,
      meta: { maxNodeExecutions: 30, methodology: { tdd: true, writeSet: true } },
      updatedAt: graph.updatedAt,
      createdAt: graph.createdAt,
      name: graph.name,
      id: graph.id,
      _format: graph._format,
    };
    expect(serializeDevGraph(shuffled)).toBe(serializeDevGraph(graph));
  });

  it('round-trips through parseDevGraph unchanged', () => {
    const graph = richGraph();
    const result = parseDevGraph(JSON.parse(serializeDevGraph(graph)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(serializeDevGraph(result.graph)).toBe(serializeDevGraph(graph));
  });

  it('copies the arrays it writes instead of aliasing the graph', () => {
    const graph = richGraph();
    const json = serializeDevGraph(graph);
    (graph.nodes[1] as ActionNode).join = { mode: 'all' };
    expect(json).toContain('"subset"');
  });

  it('writes rework AFTER sourceOutcome, and only on the arm that carries it', () => {
    const graph = richGraph();
    graph.edges = [
      { id: 'e-1', source: 'prompt-1', target: 'action-1' },
      { id: 'e-2', source: 'gate-1', target: 'action-1', sourceOutcome: 'red', rework: true },
    ];
    const parsed = JSON.parse(serializeDevGraph(graph)) as {
      edges: Record<string, unknown>[];
    };
    expect(Object.keys(parsed.edges[0]!)).toEqual(['id', 'source', 'target']);
    expect(Object.keys(parsed.edges[1]!)).toEqual(['id', 'source', 'target', 'sourceOutcome', 'rework']);
  });

  it('round-trips a rework arm unchanged', () => {
    const graph = richGraph();
    graph.edges = [
      ...graph.edges,
      { id: 'e-5', source: 'gate-1', target: 'action-1', sourceOutcome: 'red', rework: true },
    ];
    const result = parseDevGraph(JSON.parse(serializeDevGraph(graph)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(serializeDevGraph(result.graph)).toBe(serializeDevGraph(graph));
  });
});

describe('graph-schema / emptyDevGraph', () => {
  it('starts from the objective and nothing else', () => {
    const graph = emptyDevGraph('g1', 'Meu grafo', NOW);
    expect(graph._format).toBe(DEVGRAPH_FORMAT_TAG);
    expect(graph.id).toBe('g1');
    expect(graph.name).toBe('Meu grafo');
    expect(graph.meta).toEqual({});
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.kind).toBe('prompt');
    expect(graph.nodes[0]?.id).toBe('prompt-1');
  });

  it('seeds a non-empty placeholder goal so a fresh graph round-trips', () => {
    const graph = emptyDevGraph('g1', 'G1', NOW);
    const promptNode = graph.nodes[0];
    expect(promptNode?.kind === 'prompt' && promptNode.goal).toBe(DEVGRAPH_DEFAULT_GOAL);
    expect(DEVGRAPH_DEFAULT_GOAL.length).toBeGreaterThan(0);
  });

  it('uses the timestamp it is given for both stamps', () => {
    const graph = emptyDevGraph('g1', 'G1', NOW);
    expect(graph.createdAt).toBe(NOW);
    expect(graph.updatedAt).toBe(NOW);
  });

  it('falls back to the clock only when no timestamp is given', () => {
    const graph = emptyDevGraph('g1', 'G1');
    expect(graph.createdAt).toBe(graph.updatedAt);
    expect(Number.isNaN(Date.parse(graph.createdAt))).toBe(false);
  });

  it('refuses an id its own schema would reject instead of building an unsavable graph', () => {
    for (const id of ['BAD ID', 'Not-A-Slug', '-leading', 'with_underscore', '', 'a'.repeat(41)]) {
      expect(() => emptyDevGraph(id, 'G1', NOW), id).toThrow(/slug/);
    }
  });

  it('never renames the human method behind their back', () => {
    // The rejected alternative to throwing was silent slugification. Pinning the
    // choice: what comes back is the id that went in, or nothing at all.
    expect(emptyDevGraph('meu-metodo', 'G1', NOW).id).toBe('meu-metodo');
  });

  it('builds a graph that parses at the id boundaries', () => {
    for (const id of ['a', '0', 'a'.repeat(40), 'a-b-c-1']) {
      expect(parseDevGraph(emptyDevGraph(id, 'G1', NOW)).ok, id).toBe(true);
    }
  });
});

describe('graph-schema / id generators', () => {
  it('numbers new node ids per kind, starting at 1', () => {
    const graph = emptyDevGraph('g1', 'G1', NOW);
    expect(newNodeId(graph, 'action')).toBe('action-1');
    expect(newNodeId(graph, 'gate')).toBe('gate-1');
  });

  it('skips ids already taken', () => {
    const graph = emptyDevGraph('g1', 'G1', NOW);
    expect(newNodeId(graph, 'prompt')).toBe('prompt-2');
  });

  it('finds the first hole rather than appending blindly', () => {
    const graph = emptyDevGraph('g1', 'G1', NOW);
    graph.nodes = [
      ...graph.nodes,
      {
        id: 'action-2',
        kind: 'action',
        label: 'A',
        position: { x: 0, y: 0 },
        block: 'implement',
        join: { mode: 'all' },
      },
    ];
    expect(newNodeId(graph, 'action')).toBe('action-1');
  });

  it('produces ids that are valid slugs', () => {
    const graph = emptyDevGraph('g1', 'G1', NOW);
    for (const kind of ['prompt', 'action', 'research', 'gate'] as const) {
      expect(/^[a-z0-9][a-z0-9-]{0,39}$/.test(newNodeId(graph, kind))).toBe(true);
    }
  });

  it('numbers new edge ids from e-1', () => {
    const graph = emptyDevGraph('g1', 'G1', NOW);
    expect(newEdgeId(graph)).toBe('e-1');
    graph.edges = [{ id: 'e-1', source: 'prompt-1', target: 'x' }];
    expect(newEdgeId(graph)).toBe('e-2');
  });
});
