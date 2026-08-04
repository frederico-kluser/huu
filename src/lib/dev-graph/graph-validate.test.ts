import { describe, expect, it } from 'vitest';
import type {
  ActionNode,
  DevGraph,
  GateNode,
  GraphEdge,
  GraphIssue,
  GraphNode,
  PromptNode,
  ResearchNode,
} from './graph-types.js';
import {
  RESEARCH_BOOLEAN_OUTCOMES,
  ancestorsOf,
  branchOutcomesOf,
  directPredecessors,
  effectiveDependencies,
  inboundEdges,
  outboundEdges,
  topoOrder,
  validateGraph,
} from './graph-validate.js';

// --- Builders ---------------------------------------------------------------

function prompt(over: Partial<PromptNode> = {}): PromptNode {
  return {
    id: 'p',
    kind: 'prompt',
    label: 'Entrada',
    position: { x: 0, y: 0 },
    goal: 'Ship the thing',
    ...over,
  };
}

function action(id: string, over: Partial<ActionNode> = {}): ActionNode {
  return {
    id,
    kind: 'action',
    label: id,
    position: { x: 0, y: 0 },
    block: 'implement',
    join: { mode: 'all' },
    ...over,
  };
}

function research(id: string, over: Partial<ResearchNode> = {}): ResearchNode {
  return {
    id,
    kind: 'research',
    label: id,
    position: { x: 0, y: 0 },
    query: 'Is it there?',
    useContext: true,
    outputKind: 'info',
    join: { mode: 'all' },
    ...over,
  };
}

function gate(id: string, over: Partial<GateNode> = {}): GateNode {
  return {
    id,
    kind: 'gate',
    label: id,
    position: { x: 0, y: 0 },
    condition: 'the suite exits zero',
    outcomes: [
      { id: 'green', label: 'Verde' },
      { id: 'red', label: 'Vermelho' },
    ],
    defaultOutcome: 'green',
    join: { mode: 'all' },
    ...over,
  };
}

function edge(id: string, source: string, target: string, sourceOutcome?: string): GraphEdge {
  return sourceOutcome === undefined
    ? { id, source, target }
    : { id, source, target, sourceOutcome };
}

function graph(nodes: GraphNode[], edges: GraphEdge[] = []): DevGraph {
  return {
    _format: 'huu-devgraph-v1',
    id: 'g',
    name: 'G',
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-03T12:00:00.000Z',
    meta: {},
    nodes,
    edges,
  };
}

function codes(issues: GraphIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

/**
 * The reference method: recon fans the work out, three reviews run in parallel,
 * and only the performance one is joined. This is the shape the user asked for
 * and the shape wave 2 compiles.
 */
function referenceGraph(joinMode: 'all' | 'subset' = 'all'): DevGraph {
  return graph(
    [
      prompt(),
      action('recon-1', { block: 'recon' }),
      action('tdd-1', { block: 'tdd' }),
      action('sec-1', { block: 'security-review' }),
      action('perf-1', { block: 'performance-review' }),
      action('join-1', {
        block: 'consolidate',
        join: joinMode === 'all' ? { mode: 'all' } : { mode: 'subset', of: ['perf-1'] },
      }),
    ],
    [
      edge('e-1', 'p', 'recon-1'),
      edge('e-2', 'recon-1', 'tdd-1'),
      edge('e-3', 'recon-1', 'sec-1'),
      edge('e-4', 'recon-1', 'perf-1'),
      edge('e-5', 'tdd-1', 'join-1'),
      edge('e-6', 'sec-1', 'join-1'),
      edge('e-7', 'perf-1', 'join-1'),
    ],
  );
}

// --- Helpers ----------------------------------------------------------------

describe('graph-validate / inboundEdges + outboundEdges', () => {
  it('returns the inbound edges in declaration order', () => {
    expect(inboundEdges(referenceGraph(), 'join-1').map((e) => e.id)).toEqual([
      'e-5',
      'e-6',
      'e-7',
    ]);
  });

  it('returns the outbound edges in declaration order', () => {
    expect(outboundEdges(referenceGraph(), 'recon-1').map((e) => e.id)).toEqual([
      'e-2',
      'e-3',
      'e-4',
    ]);
  });

  it('returns nothing for a node id nobody drew', () => {
    expect(inboundEdges(referenceGraph(), 'ghost')).toEqual([]);
    expect(outboundEdges(referenceGraph(), 'ghost')).toEqual([]);
  });
});

describe('graph-validate / directPredecessors', () => {
  it('lists the unique sources pointing at a node', () => {
    expect(directPredecessors(referenceGraph(), 'join-1')).toEqual(['tdd-1', 'sec-1', 'perf-1']);
  });

  it('deduplicates two edges from the same source', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a1', 'red'),
      ],
    );
    expect(directPredecessors(g, 'a1')).toEqual(['g1']);
  });

  it('ignores a self-edge', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'a1')]);
    expect(directPredecessors(g, 'a1')).toEqual(['p']);
  });

  it('ignores an edge whose source is not a node', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'ghost', 'a1')]);
    expect(directPredecessors(g, 'a1')).toEqual([]);
  });
});

describe('graph-validate / topoOrder', () => {
  it('orders a DAG deterministically, declaration order breaking ties', () => {
    const result = topoOrder(referenceGraph());
    expect(result.cycle).toBe(false);
    expect(result.order).toEqual(['p', 'recon-1', 'tdd-1', 'sec-1', 'perf-1', 'join-1']);
  });

  it('gives the same answer twice', () => {
    expect(topoOrder(referenceGraph()).order).toEqual(topoOrder(referenceGraph()).order);
  });

  it('flags a cycle and returns the partial order', () => {
    const g = graph(
      [prompt(), action('a1'), action('b1')],
      [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'b1'), edge('e-3', 'b1', 'a1')],
    );
    const result = topoOrder(g);
    expect(result.cycle).toBe(true);
    expect(result.order).toEqual(['p']);
  });

  it('treats a self-edge as a cycle', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'a1')]);
    expect(topoOrder(g).cycle).toBe(true);
  });

  it('ignores edges that dangle off the graph', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'ghost', 'a1')]);
    expect(topoOrder(g)).toEqual({ order: ['p', 'a1'], cycle: false });
  });

  it('handles an empty graph', () => {
    expect(topoOrder(graph([]))).toEqual({ order: [], cycle: false });
  });
});

describe('graph-validate / ancestorsOf', () => {
  it('collects ancestors transitively', () => {
    expect([...ancestorsOf(referenceGraph(), 'join-1')].sort()).toEqual([
      'p',
      'perf-1',
      'recon-1',
      'sec-1',
      'tdd-1',
    ]);
  });

  it('returns an empty set for the root', () => {
    expect(ancestorsOf(referenceGraph(), 'p').size).toBe(0);
  });

  it('reports a node as its own ancestor inside a cycle', () => {
    const g = graph(
      [prompt(), action('a1'), action('b1')],
      [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'b1'), edge('e-3', 'b1', 'a1')],
    );
    expect(ancestorsOf(g, 'a1').has('a1')).toBe(true);
  });

  it('ignores dangling sources', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'ghost', 'a1')]);
    expect(ancestorsOf(g, 'a1').size).toBe(0);
  });
});

describe('graph-validate / effectiveDependencies', () => {
  it('makes the root wait for nothing', () => {
    expect(effectiveDependencies(referenceGraph(), 'p')).toEqual([]);
  });

  it('makes the root wait for nothing even when something was drawn into it', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'a1', 'p')]);
    expect(effectiveDependencies(g, 'p')).toEqual([]);
  });

  it('waits for every predecessor under mode all', () => {
    expect(effectiveDependencies(referenceGraph('all'), 'join-1')).toEqual([
      'tdd-1',
      'sec-1',
      'perf-1',
    ]);
  });

  it('waits only for the listed predecessor under mode subset', () => {
    // The user scenario: fan out tdd + security + performance, continue from
    // performance alone.
    expect(effectiveDependencies(referenceGraph('subset'), 'join-1')).toEqual(['perf-1']);
  });

  it('keeps edge-declaration order, not the order of `of`', () => {
    const g = referenceGraph();
    const join = g.nodes.find((n) => n.id === 'join-1') as ActionNode;
    join.join = { mode: 'subset', of: ['perf-1', 'tdd-1'] };
    expect(effectiveDependencies(g, 'join-1')).toEqual(['tdd-1', 'perf-1']);
  });

  it('drops a subset entry that is not a predecessor instead of adding a dependency', () => {
    const g = referenceGraph();
    const join = g.nodes.find((n) => n.id === 'join-1') as ActionNode;
    join.join = { mode: 'subset', of: ['recon-1'] };
    expect(effectiveDependencies(g, 'join-1')).toEqual([]);
  });

  it('drops a subset entry naming a node that does not exist', () => {
    const g = referenceGraph();
    const join = g.nodes.find((n) => n.id === 'join-1') as ActionNode;
    join.join = { mode: 'subset', of: ['ghost', 'perf-1'] };
    expect(effectiveDependencies(g, 'join-1')).toEqual(['perf-1']);
  });

  it('deduplicates a predecessor reached by two edges', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a1', 'red'),
      ],
    );
    expect(effectiveDependencies(g, 'a1')).toEqual(['g1']);
  });

  it('still reports the sources pointing at an id that is not a node', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'a1', 'ghost')]);
    expect(effectiveDependencies(g, 'ghost')).toEqual(['a1']);
  });

  it('returns an empty list for an isolated node', () => {
    expect(effectiveDependencies(graph([prompt(), action('a1')]), 'a1')).toEqual([]);
  });
});

describe('graph-validate / branchOutcomesOf', () => {
  it('returns null for a prompt node', () => {
    expect(branchOutcomesOf(prompt())).toBeNull();
  });

  it('returns null for an action node', () => {
    expect(branchOutcomesOf(action('a1'))).toBeNull();
  });

  it('returns null for an info research node', () => {
    expect(branchOutcomesOf(research('r1', { outputKind: 'info' }))).toBeNull();
  });

  it('returns yes/no for a boolean research node', () => {
    expect(branchOutcomesOf(research('r1', { outputKind: 'boolean' }))?.map((o) => o.id)).toEqual([
      'yes',
      'no',
    ]);
  });

  it('returns the declared choices for a choice research node', () => {
    const node = research('r1', {
      outputKind: 'choice',
      choices: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    expect(branchOutcomesOf(node)).toEqual([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
  });

  it('returns an empty array (not null) for a choice node with no choices', () => {
    expect(branchOutcomesOf(research('r1', { outputKind: 'choice' }))).toEqual([]);
  });

  it('returns the declared outcomes for a gate', () => {
    expect(branchOutcomesOf(gate('g1'))?.map((o) => o.id)).toEqual(['green', 'red']);
  });

  it('hands back copies, so a caller cannot edit the node through them', () => {
    const node = gate('g1');
    const outcomes = branchOutcomesOf(node) ?? [];
    const first = outcomes[0];
    if (first) first.label = 'mutated';
    expect(node.outcomes[0]?.label).toBe('Verde');
  });

  it('pins the boolean arm ids the compiler routes on', () => {
    expect(RESEARCH_BOOLEAN_OUTCOMES.map((o) => o.id)).toEqual(['yes', 'no']);
  });
});

// --- validateGraph: the happy path ------------------------------------------

describe('graph-validate / validateGraph accepts a sound method', () => {
  it('passes the reference graph with no errors and no warnings', () => {
    const result = validateGraph(referenceGraph());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('passes a graph whose only node is the prompt', () => {
    const result = validateGraph(graph([prompt()]));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('passes a boolean research branch wired to both arms', () => {
    const g = graph(
      [
        prompt(),
        research('r1', { outputKind: 'boolean', defaultOutcome: 'no' }),
        action('a1'),
        action('a2'),
      ],
      [
        edge('e-1', 'p', 'r1'),
        edge('e-2', 'r1', 'a1', 'yes'),
        edge('e-3', 'r1', 'a2', 'no'),
      ],
    );
    expect(validateGraph(g).errors).toEqual([]);
  });

  it('passes a gate whose two arms rejoin the same node', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a1', 'red'),
      ],
    );
    expect(validateGraph(g).errors).toEqual([]);
  });

  it('passes a valid recon fan-out', () => {
    const g = graph(
      [
        prompt(),
        action('recon-1', { block: 'recon' }),
        action('tests-1', { block: 'tests', fanOutFrom: 'recon-1', scope: 'memory' }),
      ],
      [edge('e-1', 'p', 'recon-1'), edge('e-2', 'recon-1', 'tests-1')],
    );
    expect(validateGraph(g).errors).toEqual([]);
  });

  it('accepts a fan-out that leaves the scope implicit', () => {
    const g = graph(
      [
        prompt(),
        action('recon-1', { block: 'recon' }),
        action('tests-1', { block: 'tests', fanOutFrom: 'recon-1' }),
      ],
      [edge('e-1', 'p', 'recon-1'), edge('e-2', 'recon-1', 'tests-1')],
    );
    expect(validateGraph(g).errors).toEqual([]);
  });
});

// --- validateGraph: one test per ERROR code ---------------------------------

describe('graph-validate / entry-point errors', () => {
  it('no-prompt-node when nothing starts the method', () => {
    const result = validateGraph(graph([action('a1')]));
    expect(codes(result.errors)).toContain('no-prompt-node');
    expect(result.ok).toBe(false);
  });

  it('multiple-prompt-nodes, anchored on the extra node', () => {
    const result = validateGraph(graph([prompt(), prompt({ id: 'p2' })]));
    const issue = result.errors.find((e) => e.code === 'multiple-prompt-nodes');
    expect(issue?.nodeId).toBe('p2');
  });

  it('prompt-has-inbound when something is drawn back into the root', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'a1', 'p')]);
    expect(codes(validateGraph(g).errors)).toContain('prompt-has-inbound');
  });
});

describe('graph-validate / node identity errors', () => {
  it('duplicate-node-id', () => {
    const g = graph([prompt(), action('a1'), action('a1')]);
    expect(codes(validateGraph(g).errors)).toContain('duplicate-node-id');
  });

  it('invalid-node-id', () => {
    for (const id of ['Not A Slug', '-lead', 'UP', 'under_score', 'a'.repeat(41)]) {
      const g = graph([prompt(), action(id)], [edge('e-1', 'p', id)]);
      expect(codes(validateGraph(g).errors), id).toContain('invalid-node-id');
    }
  });

  it('label-too-long past 80 characters', () => {
    const g = graph([prompt(), action('a1', { label: 'x'.repeat(81) })], [edge('e-1', 'p', 'a1')]);
    expect(codes(validateGraph(g).errors)).toContain('label-too-long');
  });

  it('accepts a label of exactly 80 characters', () => {
    const g = graph([prompt(), action('a1', { label: 'x'.repeat(80) })], [edge('e-1', 'p', 'a1')]);
    expect(codes(validateGraph(g).errors)).not.toContain('label-too-long');
  });

  it('text-too-long on an over-long goal', () => {
    expect(codes(validateGraph(graph([prompt({ goal: 'x'.repeat(4001) })])).errors)).toContain(
      'text-too-long',
    );
  });

  it('text-too-long on an over-long action prompt', () => {
    const g = graph([prompt(), action('a1', { prompt: 'x'.repeat(4001) })], [edge('e-1', 'p', 'a1')]);
    expect(codes(validateGraph(g).errors)).toContain('text-too-long');
  });

  it('text-too-long on an over-long research query', () => {
    const g = graph(
      [prompt(), research('r1', { query: 'x'.repeat(2001) })],
      [edge('e-1', 'p', 'r1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('text-too-long');
  });

  it('text-too-long on an over-long gate condition', () => {
    const g = graph(
      [prompt(), gate('g1', { condition: 'x'.repeat(2001) }), action('a1'), action('a2')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a2', 'red'),
      ],
    );
    expect(codes(validateGraph(g).errors)).toContain('text-too-long');
  });

  it('text-too-long on over-long notes', () => {
    const g = graph([prompt(), action('a1', { notes: 'x'.repeat(2001) })], [edge('e-1', 'p', 'a1')]);
    expect(codes(validateGraph(g).errors)).toContain('text-too-long');
  });
});

describe('graph-validate / edge errors', () => {
  it('edge-unknown-node, anchored on the edge', () => {
    const g = graph([prompt()], [edge('e-1', 'p', 'ghost')]);
    const issue = validateGraph(g).errors.find((e) => e.code === 'edge-unknown-node');
    expect(issue?.edgeId).toBe('e-1');
  });

  it('self-edge', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'a1')]);
    expect(codes(validateGraph(g).errors)).toContain('self-edge');
  });

  it('duplicate-edge on the same source, target and outcome', () => {
    const g = graph(
      [prompt(), action('a1')],
      [edge('e-1', 'p', 'a1'), edge('e-2', 'p', 'a1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('duplicate-edge');
  });

  it('duplicate-edge-id when two edges answer to the same anchor', () => {
    const g = graph(
      [prompt(), action('a1'), action('a2')],
      [edge('e1', 'p', 'a1'), edge('e1', 'p', 'a2')],
    );
    const issue = validateGraph(g).errors.find((e) => e.code === 'duplicate-edge-id');
    expect(issue?.edgeId).toBe('e1');
  });

  it('invalid-edge-id, held to the same slug rule as a node id', () => {
    for (const id of ['NOT A SLUG', '-lead', 'UP', 'under_score', 'a'.repeat(41)]) {
      const g = graph([prompt(), action('a1')], [edge(id, 'p', 'a1')]);
      expect(codes(validateGraph(g).errors), id).toContain('invalid-edge-id');
    }
  });

  it('accepts the edge ids the editor generates', () => {
    const g = graph([prompt(), action('a1')], [edge('e-1', 'p', 'a1')]);
    const all = codes(validateGraph(g).errors);
    expect(all).not.toContain('invalid-edge-id');
    expect(all).not.toContain('duplicate-edge-id');
  });

  it('does not call two structurally different connections a duplicate', () => {
    // The separator trap: "a b" -> "c" and "a" -> "b c" join on any key built by
    // gluing ids with a character an id may contain.
    const g = graph(
      [prompt(), action('a b'), action('c'), action('b c')],
      [edge('e-1', 'a b', 'c'), edge('e-2', 'a', 'b c')],
    );
    expect(codes(validateGraph(g).errors)).not.toContain('duplicate-edge');
  });

  it('does not call two arms of the same gate a duplicate edge', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a1', 'red'),
      ],
    );
    expect(codes(validateGraph(g).errors)).not.toContain('duplicate-edge');
  });

  it('edge-outcome-required when leaving a branching node unlabelled', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1')],
      [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('edge-outcome-required');
  });

  it('edge-outcome-forbidden when leaving an action', () => {
    const g = graph(
      [prompt(), action('a1'), action('a2')],
      [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'a2', 'yes')],
    );
    expect(codes(validateGraph(g).errors)).toContain('edge-outcome-forbidden');
  });

  it('edge-outcome-forbidden when leaving an info research node', () => {
    const g = graph(
      [prompt(), research('r1'), action('a1')],
      [edge('e-1', 'p', 'r1'), edge('e-2', 'r1', 'a1', 'yes')],
    );
    expect(codes(validateGraph(g).errors)).toContain('edge-outcome-forbidden');
  });

  it('edge-outcome-unknown when the arm was never declared', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1'), action('a2'), action('a3')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a2', 'red'),
        edge('e-4', 'g1', 'a3', 'amber'),
      ],
    );
    expect(codes(validateGraph(g).errors)).toContain('edge-outcome-unknown');
  });
});

describe('graph-validate / branch routing errors', () => {
  it('branch-outcome-missing-edge when an arm goes nowhere', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1')],
      [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1', 'green')],
    );
    expect(codes(validateGraph(g).errors)).toContain('branch-outcome-missing-edge');
  });

  it('says WHY every arm needs a target, and what to do about it', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1')],
      [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1', 'green')],
    );
    const issue = validateGraph(g).errors.find((e) => e.code === 'branch-outcome-missing-edge');
    // The rule is not an opinion: `CheckOutcome.nextStepName` is a required
    // string in `huu-pipeline-v2`, so an arm pointing nowhere cannot compile.
    expect(issue?.message).toContain('nextStepName');
    expect(issue?.message).toContain('consolidate');
  });

  it('branch-outcome-multiple-edges when an arm forks', () => {
    const g = graph(
      [prompt(), gate('g1'), action('a1'), action('a2'), action('a3')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a2', 'green'),
        edge('e-4', 'g1', 'a3', 'red'),
      ],
    );
    const issue = validateGraph(g).errors.find((e) => e.code === 'branch-outcome-multiple-edges');
    expect(issue?.nodeId).toBe('g1');
    expect(issue?.edgeId).toBe('e-3');
  });

  it('default-outcome-missing on a branching research node', () => {
    const g = graph(
      [
        prompt(),
        research('r1', { outputKind: 'boolean' }),
        action('a1'),
        action('a2'),
      ],
      [
        edge('e-1', 'p', 'r1'),
        edge('e-2', 'r1', 'a1', 'yes'),
        edge('e-3', 'r1', 'a2', 'no'),
      ],
    );
    expect(codes(validateGraph(g).errors)).toContain('default-outcome-missing');
  });

  it('default-outcome-missing on a gate whose default is blank', () => {
    const g = graph(
      [prompt(), gate('g1', { defaultOutcome: '' }), action('a1'), action('a2')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a2', 'red'),
      ],
    );
    expect(codes(validateGraph(g).errors)).toContain('default-outcome-missing');
  });

  it('default-outcome-unknown when the safe route is not an arm', () => {
    const g = graph(
      [prompt(), gate('g1', { defaultOutcome: 'amber' }), action('a1'), action('a2')],
      [
        edge('e-1', 'p', 'g1'),
        edge('e-2', 'g1', 'a1', 'green'),
        edge('e-3', 'g1', 'a2', 'red'),
      ],
    );
    expect(codes(validateGraph(g).errors)).toContain('default-outcome-unknown');
  });

  it('choice-needs-two', () => {
    const g = graph(
      [
        prompt(),
        research('r1', {
          outputKind: 'choice',
          choices: [{ id: 'only', label: 'Only' }],
          defaultOutcome: 'only',
        }),
        action('a1'),
      ],
      [edge('e-1', 'p', 'r1'), edge('e-2', 'r1', 'a1', 'only')],
    );
    expect(codes(validateGraph(g).errors)).toContain('choice-needs-two');
  });

  it('duplicate-choice-id', () => {
    const g = graph(
      [
        prompt(),
        research('r1', {
          outputKind: 'choice',
          choices: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'A again' },
          ],
          defaultOutcome: 'a',
        }),
        action('a1'),
      ],
      [edge('e-1', 'p', 'r1'), edge('e-2', 'r1', 'a1', 'a')],
    );
    expect(codes(validateGraph(g).errors)).toContain('duplicate-choice-id');
  });

  it('gate-needs-two', () => {
    const g = graph(
      [prompt(), gate('g1', { outcomes: [{ id: 'green', label: 'Verde' }] }), action('a1')],
      [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1', 'green')],
    );
    expect(codes(validateGraph(g).errors)).toContain('gate-needs-two');
  });

  it('duplicate-outcome-id', () => {
    const g = graph(
      [
        prompt(),
        gate('g1', {
          outcomes: [
            { id: 'green', label: 'Verde' },
            { id: 'green', label: 'Verde de novo' },
          ],
        }),
        action('a1'),
      ],
      [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1', 'green')],
    );
    expect(codes(validateGraph(g).errors)).toContain('duplicate-outcome-id');
  });
});

describe('graph-validate / join errors', () => {
  function joined(join: ActionNode['join']): DevGraph {
    const g = referenceGraph();
    const node = g.nodes.find((n) => n.id === 'join-1') as ActionNode;
    node.join = join;
    return g;
  }

  it('join-subset-empty', () => {
    expect(codes(validateGraph(joined({ mode: 'subset', of: [] })).errors)).toContain(
      'join-subset-empty',
    );
  });

  it('join-subset-unknown-node', () => {
    expect(codes(validateGraph(joined({ mode: 'subset', of: ['ghost'] })).errors)).toContain(
      'join-subset-unknown-node',
    );
  });

  it('join-subset-not-inbound', () => {
    expect(codes(validateGraph(joined({ mode: 'subset', of: ['recon-1'] })).errors)).toContain(
      'join-subset-not-inbound',
    );
  });

  it('accepts a subset naming a real predecessor', () => {
    expect(codes(validateGraph(joined({ mode: 'subset', of: ['perf-1'] })).errors)).toEqual([]);
  });
});

describe('graph-validate / action, block and fan-out errors', () => {
  it('unknown-block', () => {
    const g = graph([prompt(), action('a1', { block: 'not-a-block' })], [edge('e-1', 'p', 'a1')]);
    expect(codes(validateGraph(g).errors)).toContain('unknown-block');
  });

  it('accepts every block the catalog ships, including custom', () => {
    for (const block of ['recon', 'implement', 'tdd', 'custom']) {
      const g = graph([prompt(), action('a1', { block })], [edge('e-1', 'p', 'a1')]);
      expect(codes(validateGraph(g).errors), block).not.toContain('unknown-block');
    }
  });

  it('fanout-source-unknown', () => {
    const g = graph([prompt(), action('a1', { fanOutFrom: 'ghost' })], [edge('e-1', 'p', 'a1')]);
    expect(codes(validateGraph(g).errors)).toContain('fanout-source-unknown');
  });

  it('fanout-source-not-ancestor when the producer runs in a parallel branch', () => {
    const g = graph(
      [
        prompt(),
        action('recon-1', { block: 'recon' }),
        action('a1', { fanOutFrom: 'recon-1' }),
      ],
      [edge('e-1', 'p', 'recon-1'), edge('e-2', 'p', 'a1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('fanout-source-not-ancestor');
  });

  it('fanout-source-not-ancestor when a node fans out from itself', () => {
    const g = graph(
      [prompt(), action('recon-1', { block: 'recon', fanOutFrom: 'recon-1' })],
      [edge('e-1', 'p', 'recon-1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('fanout-source-not-ancestor');
  });

  it('fanout-source-not-producer when the ancestor block writes no list', () => {
    const g = graph(
      [
        prompt(),
        action('impl-1', { block: 'implement' }),
        action('a1', { fanOutFrom: 'impl-1' }),
      ],
      [edge('e-1', 'p', 'impl-1'), edge('e-2', 'impl-1', 'a1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('fanout-source-not-producer');
  });

  it('fanout-source-not-producer when the ancestor is not an action at all', () => {
    const g = graph(
      [prompt(), action('a1', { fanOutFrom: 'p' })],
      [edge('e-1', 'p', 'a1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('fanout-source-not-producer');
  });

  it('scope-memory-needs-fanout', () => {
    const g = graph([prompt(), action('a1', { scope: 'memory' })], [edge('e-1', 'p', 'a1')]);
    expect(codes(validateGraph(g).errors)).toContain('scope-memory-needs-fanout');
  });

  it('fanout-needs-memory-scope when a declared scope contradicts the fan-out', () => {
    const g = graph(
      [
        prompt(),
        action('recon-1', { block: 'recon' }),
        action('a1', { fanOutFrom: 'recon-1', scope: 'per-file' }),
      ],
      [edge('e-1', 'p', 'recon-1'), edge('e-2', 'recon-1', 'a1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('fanout-needs-memory-scope');
  });
});

describe('graph-validate / shape errors', () => {
  it('cycle, anchored on every tangled node', () => {
    const g = graph(
      [prompt(), action('a1'), action('b1')],
      [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'b1'), edge('e-3', 'b1', 'a1')],
    );
    const cycles = validateGraph(g).errors.filter((e) => e.code === 'cycle');
    expect(cycles.map((e) => e.nodeId)).toEqual(['a1', 'b1']);
  });

  it('unreachable-node for an island', () => {
    const g = graph([prompt(), action('a1')]);
    const issue = validateGraph(g).errors.find((e) => e.code === 'unreachable-node');
    expect(issue?.nodeId).toBe('a1');
  });

  it('reports an orphan as unreachable and never emits an `orphan-node` code', () => {
    const g = graph([prompt(), action('a1'), action('b1')], [edge('e-1', 'a1', 'b1')]);
    const all = codes(validateGraph(g).errors);
    expect(all).toContain('unreachable-node');
    expect(all).not.toContain('orphan-node');
  });

  it('stays quiet about reachability when there is no root to measure from', () => {
    const all = codes(validateGraph(graph([action('a1')])).errors);
    expect(all).toContain('no-prompt-node');
    expect(all).not.toContain('unreachable-node');
  });

  it('too-many-nodes past 40', () => {
    const nodes: GraphNode[] = [prompt()];
    const edges: GraphEdge[] = [];
    for (let index = 0; index < 41; index += 1) {
      nodes.push(action(`a-${index}`));
      edges.push(edge(`e-${index}`, 'p', `a-${index}`));
    }
    expect(codes(validateGraph(graph(nodes, edges)).errors)).toContain('too-many-nodes');
  });

  it('accepts exactly 40 nodes', () => {
    const nodes: GraphNode[] = [prompt()];
    const edges: GraphEdge[] = [];
    for (let index = 0; index < 39; index += 1) {
      nodes.push(action(`a-${index}`));
      edges.push(edge(`e-${index}`, 'p', `a-${index}`));
    }
    expect(codes(validateGraph(graph(nodes, edges)).errors)).not.toContain('too-many-nodes');
  });

  it('too-many-edges past 80', () => {
    const nodes: GraphNode[] = [prompt(), action('a1')];
    const edges: GraphEdge[] = [];
    for (let index = 0; index < 81; index += 1) edges.push(edge(`e-${index}`, 'p', 'a1'));
    expect(codes(validateGraph(graph(nodes, edges)).errors)).toContain('too-many-edges');
  });

  it('reports a disconnected cycle once, as `cycle` and never as unreachable', () => {
    const g = graph(
      [prompt(), action('a'), action('b')],
      [edge('e-1', 'a', 'b'), edge('e-2', 'b', 'a')],
    );
    const result = validateGraph(g);
    expect(result.errors.filter((e) => e.code === 'cycle').map((e) => e.nodeId)).toEqual(['a', 'b']);
    expect(codes(result.errors)).not.toContain('unreachable-node');
  });

  it('still reports an island with no cycle as unreachable', () => {
    const g = graph([prompt(), action('a1'), action('b1')], [edge('e-1', 'a1', 'b1')]);
    const result = validateGraph(g);
    expect(codes(result.errors)).toContain('unreachable-node');
    expect(codes(result.errors)).not.toContain('cycle');
  });
});

// --- validateGraph: the caps graph-types.ts DECLARES are the caps enforced ---

describe('graph-validate / the declared per-node caps', () => {
  function filePicker(count: number): DevGraph {
    const files = Array.from({ length: count }, (_unused, index) => `src/file-${index}.ts`);
    return graph([prompt(), action('a1', { scope: 'per-file', files })], [edge('e-1', 'p', 'a1')]);
  }

  function chooser(count: number): DevGraph {
    const choices = Array.from({ length: count }, (_unused, index) => ({
      id: `c-${index}`,
      label: `C${index}`,
    }));
    return graph(
      [
        prompt(),
        research('r1', { outputKind: 'choice', choices, defaultOutcome: 'c-0' }),
        action('a1'),
      ],
      [edge('e-1', 'p', 'r1')],
    );
  }

  function gateWith(count: number): DevGraph {
    const outcomes = Array.from({ length: count }, (_unused, index) => ({
      id: `o-${index}`,
      label: `O${index}`,
    }));
    return graph(
      [prompt(), gate('g1', { outcomes, defaultOutcome: 'o-0' }), action('a1')],
      [edge('e-1', 'p', 'g1')],
    );
  }

  it('too-many-files past 400, anchored on the node', () => {
    const issue = validateGraph(filePicker(401)).errors.find((e) => e.code === 'too-many-files');
    expect(issue?.nodeId).toBe('a1');
  });

  it('accepts exactly 400 hand-picked files', () => {
    expect(codes(validateGraph(filePicker(400)).errors)).not.toContain('too-many-files');
  });

  it('too-many-files on the 1000-file fan-out nobody underwrote', () => {
    expect(codes(validateGraph(filePicker(1000)).errors)).toContain('too-many-files');
  });

  it('too-many-branches past 12 research choices', () => {
    const issue = validateGraph(chooser(13)).errors.find((e) => e.code === 'too-many-branches');
    expect(issue?.nodeId).toBe('r1');
  });

  it('accepts exactly 12 research choices', () => {
    expect(codes(validateGraph(chooser(12)).errors)).not.toContain('too-many-branches');
  });

  it('too-many-branches past 12 gate outcomes', () => {
    const issue = validateGraph(gateWith(13)).errors.find((e) => e.code === 'too-many-branches');
    expect(issue?.nodeId).toBe('g1');
  });

  it('accepts exactly 12 gate outcomes', () => {
    expect(codes(validateGraph(gateWith(12)).errors)).not.toContain('too-many-branches');
  });
});

// --- validateGraph: one test per WARNING code -------------------------------

describe('graph-validate / warnings', () => {
  it('join-subset-single-inbound when the subset changes nothing', () => {
    const g = graph(
      [prompt(), action('a1', { join: { mode: 'subset', of: ['p'] } })],
      [edge('e-1', 'p', 'a1')],
    );
    const result = validateGraph(g);
    expect(codes(result.warnings)).toContain('join-subset-single-inbound');
    expect(result.ok).toBe(true);
  });

  it('join-subset-drops-barrier when a real dependency is dropped', () => {
    const result = validateGraph(referenceGraph('subset'));
    expect(codes(result.warnings)).toEqual(['join-subset-drops-barrier']);
    expect(result.ok).toBe(true);
  });

  it('says honestly that the wave merge barrier stays', () => {
    const issue = validateGraph(referenceGraph('subset')).warnings[0];
    expect(issue?.message).toContain('merge barrier');
  });

  it('stays quiet when the subset keeps every predecessor', () => {
    const g = referenceGraph();
    const node = g.nodes.find((n) => n.id === 'join-1') as ActionNode;
    node.join = { mode: 'subset', of: ['tdd-1', 'sec-1', 'perf-1'] };
    expect(validateGraph(g).warnings).toEqual([]);
  });

  it('no-terminal-node when every path loops back', () => {
    const g = graph(
      [prompt(), action('a1'), action('b1')],
      [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'b1'), edge('e-3', 'b1', 'a1')],
    );
    expect(codes(validateGraph(g).warnings)).toContain('no-terminal-node');
  });

  it('deep-graph past 12 nodes on the longest path', () => {
    const nodes: GraphNode[] = [prompt()];
    const edges: GraphEdge[] = [];
    let previous = 'p';
    for (let index = 0; index < 13; index += 1) {
      const id = `a-${index}`;
      nodes.push(action(id));
      edges.push(edge(`e-${index}`, previous, id));
      previous = id;
    }
    const result = validateGraph(graph(nodes, edges));
    expect(codes(result.warnings)).toContain('deep-graph');
    expect(result.ok).toBe(true);
  });

  it('stays quiet at exactly 12 nodes deep', () => {
    const nodes: GraphNode[] = [prompt()];
    const edges: GraphEdge[] = [];
    let previous = 'p';
    for (let index = 0; index < 11; index += 1) {
      const id = `a-${index}`;
      nodes.push(action(id));
      edges.push(edge(`e-${index}`, previous, id));
      previous = id;
    }
    expect(codes(validateGraph(graph(nodes, edges)).warnings)).not.toContain('deep-graph');
  });
});

// --- validateGraph: the never-throws promise --------------------------------

describe('graph-validate / validateGraph never throws', () => {
  it('survives a graph whose arrays are missing', () => {
    const broken = { _format: 'huu-devgraph-v1' } as unknown as DevGraph;
    expect(() => validateGraph(broken)).not.toThrow();
    expect(validateGraph(broken).ok).toBe(false);
  });

  it('survives nodes that are not arrays', () => {
    const broken = { ...graph([prompt()]), nodes: null } as unknown as DevGraph;
    expect(() => validateGraph(broken)).not.toThrow();
  });

  it('survives a null inside nodes and hands the problem back as data', () => {
    const broken = { ...graph([prompt()]), nodes: [null] } as unknown as DevGraph;
    expect(() => validateGraph(broken)).not.toThrow();
    const result = validateGraph(broken);
    expect(codes(result.errors)).toContain('malformed-node-entry');
    expect(result.ok).toBe(false);
  });

  it('survives an undefined inside nodes', () => {
    const broken = { ...graph([prompt()]), nodes: [undefined] } as unknown as DevGraph;
    expect(() => validateGraph(broken)).not.toThrow();
    expect(codes(validateGraph(broken).errors)).toContain('malformed-node-entry');
  });

  it('survives a null inside edges', () => {
    const broken = { ...graph([prompt()]), edges: [null] } as unknown as DevGraph;
    expect(() => validateGraph(broken)).not.toThrow();
    expect(codes(validateGraph(broken).errors)).toContain('malformed-edge-entry');
  });

  it('survives a number inside edges', () => {
    const broken = { ...graph([prompt()]), edges: [42] } as unknown as DevGraph;
    expect(() => validateGraph(broken)).not.toThrow();
    expect(codes(validateGraph(broken).errors)).toContain('malformed-edge-entry');
  });

  it('keeps the good entries around the junk instead of dropping the drawing', () => {
    const good = referenceGraph();
    const broken = { ...good, nodes: [...good.nodes, null] } as unknown as DevGraph;
    const result = validateGraph(broken);
    expect(codes(result.errors)).toEqual(['malformed-node-entry']);
    expect(result.warnings).toEqual([]);
  });

  it('reports one issue for a list full of junk, not one per entry', () => {
    const broken = {
      ...graph([prompt()]),
      nodes: [null, null, null, 7, 'x'],
    } as unknown as DevGraph;
    expect(codes(validateGraph(broken).errors).filter((c) => c === 'malformed-node-entry')).toEqual([
      'malformed-node-entry',
    ]);
  });

  it('survives a null outcome inside a gate', () => {
    const broken = graph([prompt(), { ...gate('g1'), outcomes: [null] } as unknown as GateNode]);
    expect(() => validateGraph(broken)).not.toThrow();
    const issue = validateGraph(broken).errors.find((e) => e.code === 'malformed-node-entry');
    expect(issue?.nodeId).toBe('g1');
  });

  it('survives a gate outcome that is a bare string', () => {
    const broken = graph([prompt(), { ...gate('g1'), outcomes: ['texto'] } as unknown as GateNode]);
    expect(() => validateGraph(broken)).not.toThrow();
    const all = codes(validateGraph(broken).errors);
    expect(all).toContain('malformed-node-entry');
    expect(all).toContain('gate-needs-two');
  });

  it('survives a null choice inside a research node', () => {
    const broken = graph([
      prompt(),
      { ...research('r1', { outputKind: 'choice' }), choices: [null] } as unknown as ResearchNode,
    ]);
    expect(() => validateGraph(broken)).not.toThrow();
    expect(codes(validateGraph(broken).errors)).toContain('malformed-node-entry');
  });

  it('survives a null inside a join subset', () => {
    const broken = graph([
      prompt(),
      { ...action('a1'), join: { mode: 'subset', of: [null] } } as unknown as ActionNode,
    ]);
    expect(() => validateGraph(broken)).not.toThrow();
    const issue = validateGraph(broken).errors.find((e) => e.code === 'malformed-node-entry');
    expect(issue?.nodeId).toBe('a1');
  });

  it('survives a null inside a files list', () => {
    const broken = graph([prompt(), { ...action('a1'), files: [null] } as unknown as ActionNode]);
    expect(() => validateGraph(broken)).not.toThrow();
    const issue = validateGraph(broken).errors.find((e) => e.code === 'malformed-node-entry');
    expect(issue?.nodeId).toBe('a1');
  });

  it('survives a gate whose outcomes are missing', () => {
    const broken = graph([prompt(), { ...gate('g1'), outcomes: undefined } as unknown as GateNode]);
    expect(() => validateGraph(broken)).not.toThrow();
    expect(codes(validateGraph(broken).errors)).toContain('gate-needs-two');
  });

  it('survives a node whose label is missing', () => {
    const broken = graph([{ ...prompt(), label: undefined } as unknown as PromptNode]);
    expect(() => validateGraph(broken)).not.toThrow();
  });

  it('survives an empty graph', () => {
    const result = validateGraph(graph([]));
    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(['no-prompt-node']);
    expect(result.warnings).toEqual([]);
  });

  it('reports ok exactly when there are no errors', () => {
    expect(validateGraph(referenceGraph()).ok).toBe(true);
    expect(validateGraph(graph([action('a1')])).ok).toBe(false);
  });

  it('never anchors an issue on a field it did not set', () => {
    const issues = validateGraph(graph([prompt(), action('a1')])).errors;
    // Guard against a vacuous pass: an empty list would satisfy the loop below
    // whatever the validator does, so the assertion has to see real issues.
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(Object.keys(issue).every((key) => issue[key as keyof GraphIssue] !== undefined)).toBe(
        true,
      );
    }
  });
});
