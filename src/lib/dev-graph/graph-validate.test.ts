import { describe, expect, it } from 'vitest';
import type {
  ActionNode,
  DevGraph,
  GateNode,
  GraphEdge,
  GraphErrorCode,
  GraphIssue,
  GraphNode,
  GraphWarningCode,
  PromptNode,
  ResearchNode,
} from './graph-types.js';
import {
  RESEARCH_BOOLEAN_OUTCOMES,
  ancestorsOf,
  branchOutcomesOf,
  descendantsOf,
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

// --- THE ARM THAT GOES BACK -------------------------------------------------
//
// The rule this suite pins is the one the format existed WITHOUT until now:
// "quality gate: if it failed, go back and fix it". Every assertion here is
// about the two layers — a rework arm ROUTES (activation) and never ORDERS
// (dependency) — because that separation is the whole reason the loop is
// expressible without a cycle.

describe('graph-validate / the arm that goes back (rework)', () => {
  /** portão → aprovado ↦ selar · reprovado ↦ back to the work it came from. */
  function reworkGraph(over: Partial<GraphEdge> = {}): DevGraph {
    return graph(
      [
        prompt(),
        action('implementar'),
        gate('portao', {
          outcomes: [
            { id: 'aprovado', label: 'Aprovado' },
            { id: 'reprovado', label: 'Reprovado' },
          ],
          defaultOutcome: 'aprovado',
        }),
        action('selar', { block: 'docs' }),
      ],
      [
        edge('e-1', 'p', 'implementar'),
        edge('e-2', 'implementar', 'portao'),
        edge('e-3', 'portao', 'selar', 'aprovado'),
        { id: 'e-4', source: 'portao', target: 'implementar', sourceOutcome: 'reprovado', rework: true, ...over },
      ],
    );
  }

  it('ACCEPTS a gate arm routed back at an ancestor', () => {
    const result = validateGraph(reworkGraph());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('still calls the SAME arm a cycle when it is not declared as rework', () => {
    // The proof that nothing is inferred: one field is the whole difference
    // between a loop the human underwrote and a drawing mistake.
    const g = reworkGraph();
    delete (g.edges[3] as { rework?: true }).rework;
    expect(codes(validateGraph(g).errors)).toContain('cycle');
  });

  it('does NOT make the target wait for the gate', () => {
    const g = reworkGraph();
    expect(effectiveDependencies(g, 'implementar')).toEqual(['p']);
    expect(directPredecessors(g, 'implementar')).toEqual(['p']);
  });

  it('keeps the gate out of the target ancestors, so the ORDER is unchanged', () => {
    const g = reworkGraph();
    expect([...ancestorsOf(g, 'implementar')]).toEqual(['p']);
    expect(ancestorsOf(g, 'portao').has('implementar')).toBe(true);
  });

  it('leaves the topological order acyclic and in work order', () => {
    const { order, cycle } = topoOrder(reworkGraph());
    expect(cycle).toBe(false);
    expect(order).toEqual(['p', 'implementar', 'portao', 'selar']);
  });

  it('is a real ROUTE: reachability counts it, and the loop ends somewhere', () => {
    // Reachability reads the ACTIVATION layer (all edges) while the ORDER reads
    // the dependency layer. In a valid graph a rework arm can never be a
    // target's only way in — its target is an ancestor of the gate, so it was
    // already reachable — which is exactly why the loop adds a route without
    // adding an entry point, and why nothing here is reported twice.
    const result = validateGraph(reworkGraph());
    expect(codes(result.errors)).not.toContain('unreachable-node');
    expect(codes(result.warnings)).not.toContain('no-terminal-node');
    expect(result.warnings).toEqual([]);
  });

  it('leaves an ordinary graph byte-identical in every derived helper', () => {
    const g = referenceGraph();
    expect(topoOrder(g).order).toEqual(['p', 'recon-1', 'tdd-1', 'sec-1', 'perf-1', 'join-1']);
    expect(effectiveDependencies(g, 'join-1')).toEqual(['tdd-1', 'sec-1', 'perf-1']);
    expect(validateGraph(g).ok).toBe(true);
  });

  it('rework-edge-not-from-branch when the source has one way out', () => {
    const g = graph(
      [prompt(), action('a1'), action('b1')],
      [
        edge('e-1', 'p', 'a1'),
        edge('e-2', 'a1', 'b1'),
        { id: 'e-3', source: 'b1', target: 'a1', rework: true },
      ],
    );
    const all = codes(validateGraph(g).errors);
    expect(all).toContain('rework-edge-not-from-branch');
    // ONE DEFECT, ONE CODE: the generic outcome family stays silent.
    expect(all).not.toContain('edge-outcome-forbidden');
    expect(all).not.toContain('cycle');
  });

  it('rework-edge-needs-outcome when the arm names no verdict', () => {
    const g = reworkGraph();
    delete (g.edges[3] as { sourceOutcome?: string }).sourceOutcome;
    const all = codes(validateGraph(g).errors);
    expect(all).toContain('rework-edge-needs-outcome');
    expect(all).not.toContain('edge-outcome-required');
  });

  it('rework-edge-not-backward when the target does not run before the source', () => {
    const g = reworkGraph();
    // `selar` runs AFTER the gate: routing "reprovado" there is an ordinary
    // forward edge wearing the loop's clothes.
    g.edges[3] = {
      id: 'e-4',
      source: 'portao',
      target: 'selar',
      sourceOutcome: 'reprovado',
      rework: true,
    };
    expect(codes(validateGraph(g).errors)).toContain('rework-edge-not-backward');
  });

  it('rework-edge-not-backward for a sibling branch that never feeds the gate', () => {
    const g = graph(
      [
        prompt(),
        action('a1'),
        action('paralelo'),
        gate('portao', {
          outcomes: [
            { id: 'ok', label: 'OK' },
            { id: 'volta', label: 'Volta' },
          ],
          defaultOutcome: 'ok',
        }),
        action('fim', { block: 'docs' }),
      ],
      [
        edge('e-1', 'p', 'a1'),
        edge('e-2', 'p', 'paralelo'),
        edge('e-3', 'a1', 'portao'),
        edge('e-4', 'portao', 'fim', 'ok'),
        { id: 'e-5', source: 'portao', target: 'paralelo', sourceOutcome: 'volta', rework: true },
      ],
    );
    expect(codes(validateGraph(g).errors)).toContain('rework-edge-not-backward');
  });

  it('default-outcome-is-rework — the default must be the safe route FORWARD', () => {
    const g = reworkGraph();
    (g.nodes[2] as GateNode).defaultOutcome = 'reprovado';
    const all = codes(validateGraph(g).errors);
    expect(all).toContain('default-outcome-is-rework');
    expect(all).not.toContain('default-outcome-unknown');
  });

  it('says WHY in the message, so the human can act on it', () => {
    const g = reworkGraph();
    (g.nodes[2] as GateNode).defaultOutcome = 'reprovado';
    const issue = validateGraph(g).errors.find((e) => e.code === 'default-outcome-is-rework');
    expect(issue?.message).toContain('judge FAILS');
    expect(issue?.nodeId).toBe('portao');
  });

  it('lets a branching RESEARCH node send work back too', () => {
    const g = graph(
      [
        prompt(),
        action('a1'),
        research('r1', { outputKind: 'boolean', defaultOutcome: 'yes' }),
        action('fim', { block: 'docs' }),
      ],
      [
        edge('e-1', 'p', 'a1'),
        edge('e-2', 'a1', 'r1'),
        edge('e-3', 'r1', 'fim', 'yes'),
        { id: 'e-4', source: 'r1', target: 'a1', sourceOutcome: 'no', rework: true },
      ],
    );
    expect(validateGraph(g).errors).toEqual([]);
  });

  it('a DEPENDENCY cycle is still a cycle, rework arms or not', () => {
    const g = reworkGraph();
    g.edges.push(edge('e-5', 'selar', 'implementar'));
    expect(codes(validateGraph(g).errors)).toContain('cycle');
  });
});

// --- The entry gate must cover what the OUTPUT gate assumes ------------------
//
// The compiler's exit gate says a failure there is "a COMPILER BUG, not a bad
// drawing — the drawing was already accepted by the entry gate". These are the
// four drawings that used to make that sentence false: validateGraph said ok,
// and the compiler threw "this is a huu bug" over a value the DRAWING carried.

describe('graph-validate / the entry gate covers what the compiler assumes', () => {
  it('invalid-outcome-id for a research choice that is not a slug', () => {
    const g = graph(
      [
        prompt(),
        research('r1', {
          outputKind: 'choice',
          choices: [
            { id: '!!!', label: 'A' },
            { id: '???', label: 'B' },
          ],
          defaultOutcome: '!!!',
        }),
        action('a1'),
        action('b1'),
      ],
      [
        edge('e-1', 'p', 'r1'),
        edge('e-2', 'r1', 'a1', '!!!'),
        edge('e-3', 'r1', 'b1', '???'),
      ],
    );
    const result = validateGraph(g);
    expect(codes(result.errors).filter((c) => c === 'invalid-outcome-id')).toHaveLength(2);
    expect(result.ok).toBe(false);
  });

  it('invalid-outcome-id for a gate outcome that is not a slug', () => {
    const g = graph(
      [
        prompt(),
        gate('g1', {
          outcomes: [
            { id: '@@@', label: 'A' },
            { id: '###', label: 'B' },
          ],
          defaultOutcome: '@@@',
        }),
        action('a1'),
        action('b1'),
      ],
      [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1', '@@@'), edge('e-3', 'g1', 'b1', '###')],
    );
    expect(codes(validateGraph(g).errors).filter((c) => c === 'invalid-outcome-id')).toHaveLength(2);
  });

  it('accepts the slugs a real graph uses', () => {
    expect(codes(validateGraph(referenceGraph()).errors)).not.toContain('invalid-outcome-id');
  });

  it('does not mistake a MISSING id for the string "undefined"', () => {
    // `PATTERN.test(undefined)` coerces to "undefined", which matches — the
    // check has to look at the type first.
    const g = graph([
      prompt(),
      { ...gate('g1'), outcomes: [{ label: 'A' }, { label: 'B' }] } as unknown as GateNode,
    ]);
    expect(codes(validateGraph(g).errors).filter((c) => c === 'invalid-outcome-id')).toHaveLength(2);
  });

  it('invalid-number for a gate maxRuns of NaN', () => {
    const g = graph(
      [prompt(), gate('g1', { maxRuns: Number.NaN }), action('a1'), action('b1')],
      [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1', 'green'), edge('e-3', 'g1', 'b1', 'red')],
    );
    expect(codes(validateGraph(g).errors)).toContain('invalid-number');
  });

  it('invalid-number for a fan-out maxFiles of NaN', () => {
    const g = graph(
      [
        prompt(),
        action('recon-1', { block: 'recon' }),
        action('a1', { fanOutFrom: 'recon-1', scope: 'memory', maxFiles: Number.NaN }),
      ],
      [edge('e-1', 'p', 'recon-1'), edge('e-2', 'recon-1', 'a1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('invalid-number');
  });

  it('invalid-number for an Infinity position', () => {
    const g = graph(
      [prompt(), action('a1', { position: { x: Number.POSITIVE_INFINITY, y: 0 } })],
      [edge('e-1', 'p', 'a1')],
    );
    expect(codes(validateGraph(g).errors)).toContain('invalid-number');
  });

  it('leaves ordinary finite numbers alone', () => {
    const g = graph(
      [prompt(), gate('g1', { maxRuns: 5 }), action('a1'), action('b1')],
      [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1', 'green'), edge('e-3', 'g1', 'b1', 'red')],
    );
    expect(codes(validateGraph(g).errors)).not.toContain('invalid-number');
  });
});

// --- descendantsOf ----------------------------------------------------------

describe('graph-validate / descendantsOf', () => {
  it('walks the dependency layer forwards', () => {
    expect([...descendantsOf(referenceGraph(), 'recon-1')].sort()).toEqual([
      'join-1',
      'perf-1',
      'sec-1',
      'tdd-1',
    ]);
  });

  it('excludes the node itself', () => {
    expect(descendantsOf(referenceGraph(), 'recon-1').has('recon-1')).toBe(false);
  });

  it('does NOT follow a rework arm — it is a route, not an order', () => {
    const g = graph(
      [
        prompt(),
        action('a1'),
        gate('g1', {
          outcomes: [
            { id: 'ok', label: 'OK' },
            { id: 'volta', label: 'Volta' },
          ],
          defaultOutcome: 'ok',
        }),
        action('fim', { block: 'docs' }),
      ],
      [
        edge('e-1', 'p', 'a1'),
        edge('e-2', 'a1', 'g1'),
        edge('e-3', 'g1', 'fim', 'ok'),
        { id: 'e-4', source: 'g1', target: 'a1', sourceOutcome: 'volta', rework: true },
      ],
    );
    expect([...descendantsOf(g, 'g1')]).toEqual(['fim']);
  });

  it('is empty for a leaf', () => {
    expect([...descendantsOf(referenceGraph(), 'join-1')]).toEqual([]);
  });
});

// --- EVERY CODE OF THE UNION IS EMITTED BY A DRAWING -------------------------
//
// The tables below are typed `Record<GraphErrorCode, …>` / `Record<
// GraphWarningCode, …>`, so ADDING a code to the union without adding a
// reproduction here is a COMPILE error, not a coverage report nobody runs. A
// code the UI must translate and a human must act on has to be demonstrably
// reachable from a drawing; one that is not is either dead or a rule that never
// fires, and both are worse than a missing feature.

describe('graph-validate / every issue code is reachable from a drawing', () => {
  const ERROR_REPROS: Record<GraphErrorCode, () => DevGraph> = {
    'no-prompt-node': () => graph([action('a1')]),
    'multiple-prompt-nodes': () => graph([prompt(), prompt({ id: 'p2' })]),
    'prompt-has-inbound': () => graph([prompt(), action('a1')], [edge('e-1', 'a1', 'p')]),
    'duplicate-node-id': () => graph([prompt(), action('a1'), action('a1')], [edge('e-1', 'p', 'a1')]),
    'invalid-node-id': () => graph([prompt(), action('A 1')], [edge('e-1', 'p', 'A 1')]),
    'malformed-node-entry': () =>
      ({ ...graph([prompt()]), nodes: [prompt(), null] }) as unknown as DevGraph,
    'malformed-edge-entry': () => ({ ...graph([prompt()]), edges: [null] }) as unknown as DevGraph,
    'edge-unknown-node': () => graph([prompt()], [edge('e-1', 'p', 'ghost')]),
    'invalid-edge-id': () => graph([prompt(), action('a1')], [edge('E 1', 'p', 'a1')]),
    'duplicate-edge-id': () =>
      graph([prompt(), action('a1'), action('b1')], [edge('e-1', 'p', 'a1'), edge('e-1', 'p', 'b1')]),
    'self-edge': () => graph([prompt(), action('a1')], [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'a1')]),
    'duplicate-edge': () =>
      graph([prompt(), action('a1')], [edge('e-1', 'p', 'a1'), edge('e-2', 'p', 'a1')]),
    cycle: () =>
      graph(
        [prompt(), action('a1'), action('b1')],
        [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'b1'), edge('e-3', 'b1', 'a1')],
      ),
    'rework-edge-not-from-branch': () =>
      graph(
        [prompt(), action('a1'), action('b1')],
        [
          edge('e-1', 'p', 'a1'),
          edge('e-2', 'a1', 'b1'),
          { id: 'e-3', source: 'b1', target: 'a1', rework: true },
        ],
      ),
    'rework-edge-needs-outcome': () =>
      graph(
        [prompt(), action('a1'), gate('g1'), action('fim', { block: 'docs' })],
        [
          edge('e-1', 'p', 'a1'),
          edge('e-2', 'a1', 'g1'),
          edge('e-3', 'g1', 'fim', 'green'),
          { id: 'e-4', source: 'g1', target: 'a1', rework: true },
        ],
      ),
    'rework-edge-not-backward': () =>
      graph(
        [prompt(), action('a1'), gate('g1'), action('fim', { block: 'docs' })],
        [
          edge('e-1', 'p', 'a1'),
          edge('e-2', 'a1', 'g1'),
          edge('e-3', 'g1', 'fim', 'green'),
          { id: 'e-4', source: 'g1', target: 'fim', sourceOutcome: 'red', rework: true },
        ],
      ),
    'default-outcome-is-rework': () =>
      graph(
        [
          prompt(),
          action('a1'),
          gate('g1', { defaultOutcome: 'red' }),
          action('fim', { block: 'docs' }),
        ],
        [
          edge('e-1', 'p', 'a1'),
          edge('e-2', 'a1', 'g1'),
          edge('e-3', 'g1', 'fim', 'green'),
          { id: 'e-4', source: 'g1', target: 'a1', sourceOutcome: 'red', rework: true },
        ],
      ),
    'unreachable-node': () => graph([prompt(), action('a1')]),
    'branch-outcome-missing-edge': () => graph([prompt(), gate('g1')], [edge('e-1', 'p', 'g1')]),
    'branch-outcome-multiple-edges': () =>
      graph(
        [prompt(), gate('g1'), action('a1'), action('b1')],
        [
          edge('e-1', 'p', 'g1'),
          edge('e-2', 'g1', 'a1', 'green'),
          edge('e-3', 'g1', 'b1', 'green'),
          edge('e-4', 'g1', 'b1', 'red'),
        ],
      ),
    'edge-outcome-required': () =>
      graph([prompt(), gate('g1'), action('a1')], [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1')]),
    'edge-outcome-forbidden': () =>
      graph([prompt(), action('a1'), action('b1')], [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'b1', 'green')]),
    'edge-outcome-unknown': () =>
      graph([prompt(), gate('g1'), action('a1')], [edge('e-1', 'p', 'g1'), edge('e-2', 'g1', 'a1', 'roxo')]),
    'default-outcome-missing': () =>
      graph([prompt(), gate('g1', { defaultOutcome: '' })], [edge('e-1', 'p', 'g1')]),
    'default-outcome-unknown': () =>
      graph([prompt(), gate('g1', { defaultOutcome: 'ghost' })], [edge('e-1', 'p', 'g1')]),
    'choice-needs-two': () =>
      graph(
        [prompt(), research('r1', { outputKind: 'choice', choices: [{ id: 'a', label: 'A' }], defaultOutcome: 'a' })],
        [edge('e-1', 'p', 'r1')],
      ),
    'duplicate-choice-id': () =>
      graph(
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
        ],
        [edge('e-1', 'p', 'r1')],
      ),
    'gate-needs-two': () =>
      graph(
        [prompt(), gate('g1', { outcomes: [{ id: 'green', label: 'Verde' }] })],
        [edge('e-1', 'p', 'g1')],
      ),
    'duplicate-outcome-id': () =>
      graph(
        [
          prompt(),
          gate('g1', {
            outcomes: [
              { id: 'green', label: 'Verde' },
              { id: 'green', label: 'Verde de novo' },
            ],
          }),
        ],
        [edge('e-1', 'p', 'g1')],
      ),
    'invalid-outcome-id': () =>
      graph(
        [
          prompt(),
          gate('g1', {
            outcomes: [
              { id: '@@@', label: 'A' },
              { id: 'red', label: 'B' },
            ],
            defaultOutcome: 'red',
          }),
        ],
        [edge('e-1', 'p', 'g1')],
      ),
    'invalid-number': () =>
      graph([prompt(), gate('g1', { maxRuns: Number.NaN })], [edge('e-1', 'p', 'g1')]),
    'join-subset-empty': () =>
      graph([prompt(), action('a1', { join: { mode: 'subset', of: [] } })], [edge('e-1', 'p', 'a1')]),
    'join-subset-not-inbound': () =>
      graph(
        [prompt(), action('a1'), action('b1', { join: { mode: 'subset', of: ['a1'] } })],
        [edge('e-1', 'p', 'a1'), edge('e-2', 'p', 'b1')],
      ),
    'join-subset-unknown-node': () =>
      graph(
        [prompt(), action('a1', { join: { mode: 'subset', of: ['ghost'] } })],
        [edge('e-1', 'p', 'a1')],
      ),
    'unknown-block': () =>
      graph([prompt(), action('a1', { block: 'not-a-block' })], [edge('e-1', 'p', 'a1')]),
    'fanout-source-unknown': () =>
      graph([prompt(), action('a1', { fanOutFrom: 'ghost' })], [edge('e-1', 'p', 'a1')]),
    'fanout-source-not-ancestor': () =>
      graph(
        [prompt(), action('recon-1', { block: 'recon' }), action('a1', { fanOutFrom: 'recon-1' })],
        [edge('e-1', 'p', 'recon-1'), edge('e-2', 'p', 'a1')],
      ),
    'fanout-source-not-producer': () =>
      graph(
        [prompt(), action('impl-1'), action('a1', { fanOutFrom: 'impl-1' })],
        [edge('e-1', 'p', 'impl-1'), edge('e-2', 'impl-1', 'a1')],
      ),
    'scope-memory-needs-fanout': () =>
      graph([prompt(), action('a1', { scope: 'memory' })], [edge('e-1', 'p', 'a1')]),
    'fanout-needs-memory-scope': () =>
      graph(
        [
          prompt(),
          action('recon-1', { block: 'recon' }),
          action('a1', { fanOutFrom: 'recon-1', scope: 'per-file' }),
        ],
        [edge('e-1', 'p', 'recon-1'), edge('e-2', 'recon-1', 'a1')],
      ),
    'too-many-nodes': () => {
      const nodes: GraphNode[] = [prompt()];
      const edges: GraphEdge[] = [];
      for (let index = 0; index < 41; index += 1) {
        nodes.push(action(`a-${index}`));
        edges.push(edge(`e-${index}`, 'p', `a-${index}`));
      }
      return graph(nodes, edges);
    },
    'too-many-edges': () => {
      const edges: GraphEdge[] = [];
      for (let index = 0; index < 81; index += 1) edges.push(edge(`e-${index}`, 'p', 'a1'));
      return graph([prompt(), action('a1')], edges);
    },
    'too-many-files': () =>
      graph(
        [
          prompt(),
          action('a1', {
            scope: 'per-file',
            files: Array.from({ length: 401 }, (_u, i) => `src/f-${i}.ts`),
          }),
        ],
        [edge('e-1', 'p', 'a1')],
      ),
    'too-many-branches': () =>
      graph(
        [
          prompt(),
          gate('g1', {
            outcomes: Array.from({ length: 13 }, (_u, i) => ({ id: `o-${i}`, label: `O${i}` })),
            defaultOutcome: 'o-0',
          }),
        ],
        [edge('e-1', 'p', 'g1')],
      ),
    'label-too-long': () =>
      graph([prompt(), action('a1', { label: 'x'.repeat(81) })], [edge('e-1', 'p', 'a1')]),
    'text-too-long': () => graph([prompt({ goal: 'x'.repeat(4001) })]),
  };

  const WARNING_REPROS: Record<GraphWarningCode, () => DevGraph> = {
    'join-subset-single-inbound': () =>
      graph([prompt(), action('a1', { join: { mode: 'subset', of: ['p'] } })], [edge('e-1', 'p', 'a1')]),
    'join-subset-drops-barrier': () => referenceGraph('subset'),
    'no-terminal-node': () =>
      graph(
        [prompt(), action('a1'), action('b1')],
        [edge('e-1', 'p', 'a1'), edge('e-2', 'a1', 'b1'), edge('e-3', 'b1', 'a1')],
      ),
    'deep-graph': () => {
      const nodes: GraphNode[] = [prompt()];
      const edges: GraphEdge[] = [];
      let previous = 'p';
      for (let index = 0; index < 13; index += 1) {
        const id = `a-${index}`;
        nodes.push(action(id));
        edges.push(edge(`e-${index}`, previous, id));
        previous = id;
      }
      return graph(nodes, edges);
    },
  };

  for (const [code, build] of Object.entries(ERROR_REPROS)) {
    it(`emits ${code}`, () => {
      expect(codes(validateGraph(build()).errors)).toContain(code);
    });
  }

  for (const [code, build] of Object.entries(WARNING_REPROS)) {
    it(`warns ${code}`, () => {
      expect(codes(validateGraph(build()).warnings)).toContain(code);
    });
  }

  it('covers the whole union — no code left without a drawing', () => {
    // Belt and braces for the type-level exhaustiveness above: it also proves
    // the tables were not padded with a key the union does not declare.
    const covered = [...Object.keys(ERROR_REPROS), ...Object.keys(WARNING_REPROS)];
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered.length).toBeGreaterThan(40);
  });
});
