import { describe, expect, it } from 'vitest';
import {
  addNode,
  ancestorsOf,
  canConnect,
  connect,
  DEVGRAPH_FORMAT,
  directPredecessors,
  edgesOf,
  emptyGraph,
  fromFlowChanges,
  graphIdIssue,
  GRAPH_RESERVED_IDS,
  groupIssues,
  moveNode,
  newEdgeId,
  newNodeId,
  nodeById,
  nodesOf,
  outboundEdges,
  outcomesOf,
  removeEdge,
  removeNode,
  setJoin,
  suggestPosition,
  toFlow,
  updateNode,
} from './graph-model.js';
import { applyPaletteChoice, paletteFor } from './palette-model.js';

// The canvas is React Flow and React Flow needs a DOM; everything it DECIDES
// lives in graph-model.js and needs none. These tests are the reason that split
// exists — vitest declares no `environment`, so this file runs with no
// `document` at all and still covers every rule the canvas enforces.

const NOW = '2026-01-01T00:00:00.000Z';

/**
 * A stand-in for `GET /api/graphs/catalog`. The ids match the real catalog
 * because the graph in `describe('o grafo do usuário')` is the user's actual
 * request; the FLAGS are what the palette groups on, and nothing in the client
 * may assume either — pass no catalog and the palette must come back empty.
 */
const CATALOG = {
  blocks: [
    { id: 'recon', label: 'Reconhecimento', description: 'Mapeia o repositório.', produces: true, readOnly: false },
    { id: 'implement', label: 'Implementar', description: 'Executa a mudança.', produces: false, readOnly: false },
    { id: 'tdd', label: 'TDD', description: 'Teste que falha primeiro.', produces: false, readOnly: false },
    { id: 'security-review', label: 'Revisão de segurança', description: 'Audita segurança.', produces: false, readOnly: true },
    { id: 'performance-review', label: 'Revisão de performance', description: 'Audita performance.', produces: false, readOnly: true },
    { id: 'consolidate', label: 'Consolidar', description: 'Junta os resultados.', produces: false, readOnly: false },
    { id: 'security-findings', label: 'Achados de segurança', description: 'Uma tarefa por achado.', produces: true, readOnly: false },
  ],
  kinds: [
    { kind: 'prompt', label: 'Entrada do prompt', description: 'O objetivo.' },
    { kind: 'action', label: 'Ação', description: 'Um bloco de trabalho.' },
    { kind: 'research', label: 'Pesquisar na internet', description: 'Uma pergunta.' },
    { kind: 'gate', label: 'Portão', description: 'Um juiz decide.' },
  ],
};

/** A graph with the root plus `blocks.length` action nodes hanging off it. */
function seeded(blocks) {
  let graph = emptyGraph('g', 'G', NOW);
  const root = graph.nodes[0].id;
  const ids = [];
  for (const block of blocks) {
    const added = addNode(graph, 'action', { block, label: block });
    graph = added.graph;
    ids.push(added.nodeId);
    graph = connect(graph, root, added.nodeId).graph;
  }
  return { graph, root, ids };
}

/** A graph whose `gate-1` branches into `approved` / `rework`. */
function withGate() {
  let graph = emptyGraph('g', 'G', NOW);
  const root = graph.nodes[0].id;
  const work = addNode(graph, 'action', { block: 'implement', label: 'Implementar' });
  graph = connect(work.graph, root, work.nodeId).graph;
  const gate = addNode(graph, 'gate', { label: 'Passou?' });
  graph = connect(gate.graph, work.nodeId, gate.nodeId).graph;
  return { graph, root, workId: work.nodeId, gateId: gate.nodeId };
}

describe('emptyGraph', () => {
  it('opens with the root prompt node and nothing else — no topology is pre-drawn', () => {
    const graph = emptyGraph('meu-metodo', 'Meu método', NOW);
    expect(graph._format).toBe(DEVGRAPH_FORMAT);
    expect(graph.id).toBe('meu-metodo');
    expect(graph.name).toBe('Meu método');
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].kind).toBe('prompt');
    expect(graph.nodes[0].goal.length).toBeGreaterThan(0);
  });

  it('is deterministic given `now`', () => {
    expect(emptyGraph('a', 'A', NOW)).toEqual(emptyGraph('a', 'A', NOW));
    expect(emptyGraph('a', 'A', NOW).createdAt).toBe(NOW);
    expect(emptyGraph('a', 'A', NOW).updatedAt).toBe(NOW);
  });

  it('falls back to the clock when `now` is omitted', () => {
    const graph = emptyGraph('a', 'A');
    expect(graph.createdAt.length).toBeGreaterThan(0);
    expect(graph.createdAt).toBe(graph.updatedAt);
  });
});

describe('graphIdIssue — the id names a FILE, so it is checked before a save', () => {
  it('accepts a slug', () => {
    expect(graphIdIssue('tres-frentes')).toBeNull();
    expect(graphIdIssue('a')).toBeNull();
    expect(graphIdIssue('9-vidas')).toBeNull();
    expect(graphIdIssue('  tres-frentes  ')).toBeNull();
  });

  it('refuses what the store would refuse, under the store’s own prefix', () => {
    for (const bad of ['', '   ', 'Meu Método', '-comeca-com-hifen', 'com_underscore', 'a'.repeat(41), null]) {
      const issue = graphIdIssue(/** @type {any} */ (bad));
      expect(issue).not.toBeNull();
      expect(issue.code).toBe('invalid-id');
    }
  });

  it('refuses the four ids the /api/graphs ROUTES have already taken', () => {
    expect(GRAPH_RESERVED_IDS).toEqual(['catalog', 'compile', 'validate', 'from-sample']);
    for (const reserved of GRAPH_RESERVED_IDS) {
      const issue = graphIdIssue(reserved);
      expect(issue.code).toBe('invalid-id');
      // The refusal has to say WHY, because "catalog" looks perfectly legal.
      expect(issue.message).toMatch(/rota do huu/);
    }
  });
});

describe('groupIssues — every issue needs somewhere to be shown', () => {
  it('files anchored issues under their node or their edge', () => {
    const grouped = groupIssues([
      { code: 'cycle', message: 'a', nodeId: 'action-1' },
      { code: 'unreachable-node', message: 'b', nodeId: 'action-1' },
      { code: 'self-edge', message: 'c', edgeId: 'e-2' },
    ]);
    expect(grouped.byNode['action-1'].map((i) => i.code)).toEqual(['cycle', 'unreachable-node']);
    expect(grouped.byEdge['e-2'].map((i) => i.code)).toEqual(['self-edge']);
    expect(grouped.global).toEqual([]);
  });

  it('gives the UNANCHORED schema issue a home — it is the one the server adds', () => {
    const grouped = groupIssues([
      { code: 'invalid-schema', message: '_format: Invalid literal value' },
    ]);
    expect(grouped.global.map((i) => i.code)).toEqual(['invalid-schema']);
    expect(grouped.byNode).toEqual({});
  });

  it('files an issue with BOTH anchors under its node, exactly once', () => {
    const grouped = groupIssues([
      { code: 'branch-outcome-multiple-edges', message: 'x', nodeId: 'gate-1', edgeId: 'e-4' },
    ]);
    expect(grouped.byNode['gate-1']).toHaveLength(1);
    expect(grouped.byEdge).toEqual({});
  });

  it('keeps a stale anchor visible instead of dropping it, when a graph is given', () => {
    const { graph, ids } = seeded(['tdd']);
    const issues = [
      { code: 'cycle', message: 'a', nodeId: ids[0] },
      { code: 'cycle', message: 'b', nodeId: 'action-99' },
      { code: 'self-edge', message: 'c', edgeId: 'e-99' },
    ];
    const grouped = groupIssues(issues, graph);
    expect(grouped.byNode[ids[0]]).toHaveLength(1);
    expect(grouped.global.map((i) => i.message)).toEqual(['b', 'c']);
  });

  it('always sums back to what it was given, and survives junk', () => {
    const issues = [
      { code: 'cycle', message: 'a', nodeId: 'n1' },
      { code: 'self-edge', message: 'b', edgeId: 'e1' },
      { code: 'invalid-schema', message: 'c' },
    ];
    const grouped = groupIssues(issues);
    const total =
      grouped.global.length +
      Object.values(grouped.byNode).reduce((n, list) => n + list.length, 0) +
      Object.values(grouped.byEdge).reduce((n, list) => n + list.length, 0);
    expect(total).toBe(issues.length);
    expect(groupIssues(null)).toEqual({ global: [], byNode: {}, byEdge: {} });
    expect(groupIssues([null, 1, 'x'])).toEqual({ global: [], byNode: {}, byEdge: {} });
  });
});

describe('ids', () => {
  it('prefixes node ids with the kind, so a step name is findable in a run log', () => {
    const graph = emptyGraph('g', 'G', NOW);
    expect(newNodeId(graph, 'action')).toBe('action-1');
    expect(newNodeId(graph, 'gate')).toBe('gate-1');
    expect(newNodeId(graph, 'prompt')).toBe('prompt-2');
  });

  it('skips ids already taken, in both families', () => {
    const { graph } = seeded(['tdd', 'implement']);
    expect(newNodeId(graph, 'action')).toBe('action-3');
    expect(newEdgeId(graph)).toBe('e-3');
  });

  it('numbers edges from e-1', () => {
    expect(newEdgeId(emptyGraph('g', 'G', NOW))).toBe('e-1');
  });
});

describe('addNode', () => {
  it('appends the node and hands back its id', () => {
    const graph = emptyGraph('g', 'G', NOW);
    const { graph: next, nodeId } = addNode(graph, 'action', {
      block: 'tdd',
      label: 'TDD',
      position: { x: 10, y: 20 },
    });
    expect(nodeId).toBe('action-1');
    expect(next.nodes).toHaveLength(2);
    expect(nodeById(next, nodeId)).toMatchObject({
      kind: 'action',
      block: 'tdd',
      label: 'TDD',
      position: { x: 10, y: 20 },
    });
  });

  it('never touches the graph it was given', () => {
    const graph = emptyGraph('g', 'G', NOW);
    const before = JSON.stringify(graph);
    const { graph: next } = addNode(graph, 'action', { block: 'tdd' });
    expect(JSON.stringify(graph)).toBe(before);
    expect(next).not.toBe(graph);
    expect(next.nodes).not.toBe(graph.nodes);
  });

  it('gives every node but the root a join of `all` — a drawn edge is a dependency', () => {
    const graph = emptyGraph('g', 'G', NOW);
    expect(addNode(graph, 'action', {}).graph.nodes[1].join).toEqual({ mode: 'all' });
    expect(addNode(graph, 'research', {}).graph.nodes[1].join).toEqual({ mode: 'all' });
    expect(addNode(graph, 'gate', {}).graph.nodes[1].join).toEqual({ mode: 'all' });
    expect(graph.nodes[0].join).toBeUndefined();
  });

  it('lets any other field ride along on `opts`', () => {
    const { graph, nodeId } = addNode(emptyGraph('g', 'G', NOW), 'action', {
      block: 'tests',
      scope: 'per-file',
      review: true,
      notes: 'a margem do humano',
    });
    expect(nodeById(graph, nodeId)).toMatchObject({ scope: 'per-file', review: true, notes: 'a margem do humano' });
  });

  it('opens a research node as `info` — one way out until the human says otherwise', () => {
    const { graph, nodeId } = addNode(emptyGraph('g', 'G', NOW), 'research', {});
    const node = nodeById(graph, nodeId);
    expect(node.outputKind).toBe('info');
    expect(node.useContext).toBe(true);
    expect(outcomesOf(node)).toBeNull();
  });

  it('opens a gate with two arms and a FORWARD default', () => {
    const { graph, nodeId } = addNode(emptyGraph('g', 'G', NOW), 'gate', {});
    const node = nodeById(graph, nodeId);
    expect(node.outcomes.map((o) => o.id)).toEqual(['approved', 'rework']);
    expect(node.defaultOutcome).toBe('approved');
  });

  it('refuses a kind that is not one of the four', () => {
    const graph = emptyGraph('g', 'G', NOW);
    const result = addNode(graph, 'wormhole', {});
    expect(result.nodeId).toBeNull();
    expect(result.error.code).toBe('invalid-node-kind');
    expect(result.graph).toBe(graph);
  });

  it('refuses past the node cap, and honours a cap served by the catalog', () => {
    let graph = emptyGraph('g', 'G', NOW);
    for (let i = 0; i < 39; i += 1) graph = addNode(graph, 'action', {}).graph;
    expect(nodesOf(graph)).toHaveLength(40);
    const full = addNode(graph, 'action', {});
    expect(full.error.code).toBe('too-many-nodes');
    expect(full.graph).toBe(graph);

    const tiny = addNode(emptyGraph('g', 'G', NOW), 'action', { catalog: { caps: { maxNodes: 1 } } });
    expect(tiny.error.code).toBe('too-many-nodes');
  });

  it('keeps the catalog out of the node it seeds', () => {
    const { graph, nodeId } = addNode(emptyGraph('g', 'G', NOW), 'action', {
      catalog: { caps: { maxNodes: 40 } },
    });
    expect(nodeById(graph, nodeId).catalog).toBeUndefined();
  });
});

describe('outcomesOf', () => {
  it('answers `null` for everything with ONE way out', () => {
    const { graph, root, ids } = seeded(['tdd']);
    expect(outcomesOf(nodeById(graph, root))).toBeNull();
    expect(outcomesOf(nodeById(graph, ids[0]))).toBeNull();
    expect(outcomesOf(null)).toBeNull();
  });

  it('reads a gate’s declared arms', () => {
    const { graph, gateId } = withGate();
    expect(outcomesOf(nodeById(graph, gateId)).map((o) => o.id)).toEqual(['approved', 'rework']);
  });

  it('pins yes/no for a boolean research node and takes its LABELS from the catalog', () => {
    const { graph, nodeId } = addNode(emptyGraph('g', 'G', NOW), 'research', {
      outputKind: 'boolean',
      defaultOutcome: 'no',
    });
    const node = nodeById(graph, nodeId);
    expect(outcomesOf(node).map((o) => o.id)).toEqual(['yes', 'no']);
    const served = outcomesOf(node, {
      researchBooleanOutcomes: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    });
    expect(served.map((o) => o.label)).toEqual(['Yes', 'No']);
  });

  it('reads the choices of an n-way research node', () => {
    const { graph, nodeId } = addNode(emptyGraph('g', 'G', NOW), 'research', {
      outputKind: 'choice',
      choices: [{ id: 'rest', label: 'REST' }, { id: 'grpc', label: 'gRPC' }],
      defaultOutcome: 'rest',
    });
    expect(outcomesOf(nodeById(graph, nodeId)).map((o) => o.id)).toEqual(['rest', 'grpc']);
  });
});

describe('connect — what the canvas may draw', () => {
  it('draws an edge and hands back its id', () => {
    const graph = emptyGraph('g', 'G', NOW);
    const added = addNode(graph, 'action', { block: 'tdd' });
    const { graph: next, edgeId } = connect(added.graph, graph.nodes[0].id, added.nodeId);
    expect(edgeId).toBe('e-1');
    expect(next.edges).toEqual([{ id: 'e-1', source: 'prompt-1', target: 'action-1' }]);
  });

  it('never touches the graph it was given', () => {
    const added = addNode(emptyGraph('g', 'G', NOW), 'action', {});
    const before = JSON.stringify(added.graph);
    connect(added.graph, 'prompt-1', added.nodeId);
    expect(JSON.stringify(added.graph)).toBe(before);
  });

  it('THE PARALLELISM: many edges may leave the same non-branching node', () => {
    const { graph, root, ids } = seeded(['tdd', 'security-review', 'performance-review']);
    expect(outboundEdges(graph, root)).toHaveLength(3);
    for (const id of ids) expect(directPredecessors(graph, id)).toEqual([root]);
  });

  it('refuses an inbound edge to the root — the prompt is where everything starts', () => {
    const { graph, root, ids } = seeded(['tdd']);
    const denied = connect(graph, ids[0], root);
    expect(denied.error.code).toBe('prompt-has-inbound');
    expect(denied.graph).toBe(graph);
  });

  it('refuses a self edge', () => {
    const { graph, ids } = seeded(['tdd']);
    expect(connect(graph, ids[0], ids[0]).error.code).toBe('self-edge');
  });

  it('refuses an endpoint that is not a node', () => {
    const { graph, root } = seeded(['tdd']);
    expect(connect(graph, root, 'ghost').error.code).toBe('edge-unknown-node');
    expect(connect(graph, 'ghost', root).error.code).toBe('edge-unknown-node');
  });

  it('refuses the same connection twice', () => {
    const { graph, root, ids } = seeded(['tdd']);
    expect(connect(graph, root, ids[0]).error.code).toBe('duplicate-edge');
  });

  it('refuses a cycle, and says how to draw the loop the human probably meant', () => {
    const { graph, root, ids } = seeded(['tdd', 'implement']);
    const chained = connect(graph, ids[0], ids[1]).graph;
    const denied = connect(chained, ids[1], ids[0]);
    expect(denied.error.code).toBe('cycle');
    expect(denied.error.message).toMatch(/RETRABALHO/);
    expect(connect(chained, ids[1], root).error.code).toBe('prompt-has-inbound');
  });

  it('refuses past the edge cap served by the catalog', () => {
    const { graph, root, ids } = seeded(['tdd', 'implement']);
    const denied = connect(graph, root, ids[1], { catalog: { caps: { maxEdges: 2 } } });
    expect(denied.error.code).toBe('too-many-edges');
  });
});

describe('connect — branching nodes route ONE step per arm', () => {
  it('demands an arm when the source branches', () => {
    const { graph, gateId } = withGate();
    const added = addNode(graph, 'action', { block: 'docs' });
    const denied = connect(added.graph, gateId, added.nodeId);
    expect(denied.error.code).toBe('edge-outcome-required');
  });

  it('forbids an arm when the source has one way out', () => {
    const { graph, root, ids } = seeded(['tdd', 'implement']);
    const denied = connect(graph, ids[0], ids[1], { sourceOutcome: 'approved' });
    expect(denied.error.code).toBe('edge-outcome-forbidden');
    expect(connect(graph, root, ids[1], { sourceOutcome: 'yes' }).error.code).toBe(
      'edge-outcome-forbidden',
    );
  });

  it('refuses an arm the node does not declare', () => {
    const { graph, gateId } = withGate();
    const added = addNode(graph, 'action', {});
    const denied = connect(added.graph, gateId, added.nodeId, { sourceOutcome: 'maybe' });
    expect(denied.error.code).toBe('edge-outcome-unknown');
  });

  it('lets DIFFERENT arms of the same gate go to different places', () => {
    const { graph, gateId } = withGate();
    const a = addNode(graph, 'action', { block: 'docs' });
    const first = connect(a.graph, gateId, a.nodeId, { sourceOutcome: 'approved' });
    const b = addNode(first.graph, 'action', { block: 'implement' });
    const second = connect(b.graph, gateId, b.nodeId, { sourceOutcome: 'rework' });
    expect(second.error).toBeUndefined();
    expect(outboundEdges(second.graph, gateId)).toHaveLength(2);
  });

  it('refuses the SECOND edge off one arm and teaches the way around it', () => {
    const { graph, gateId } = withGate();
    const a = addNode(graph, 'action', { block: 'docs', label: 'Documentar' });
    const first = connect(a.graph, gateId, a.nodeId, { sourceOutcome: 'approved' }).graph;
    const b = addNode(first, 'action', { block: 'tests' });
    const denied = connect(b.graph, gateId, b.nodeId, { sourceOutcome: 'approved' });
    expect(denied.error.code).toBe('branch-outcome-multiple-edges');
    expect(denied.error.message).toContain('ligue este braço a UM bloco e ramifique a partir dele');
    expect(denied.error.message).toContain('Documentar');
  });

  it('reports an identical re-draw as a duplicate, not as a busy arm', () => {
    const { graph, gateId } = withGate();
    const a = addNode(graph, 'action', {});
    const first = connect(a.graph, gateId, a.nodeId, { sourceOutcome: 'approved' }).graph;
    expect(connect(first, gateId, a.nodeId, { sourceOutcome: 'approved' }).error.code).toBe(
      'duplicate-edge',
    );
  });
});

describe('connect — the arm that goes back', () => {
  it('accepts a rework arm pointing at an ancestor and stores it as `rework: true`', () => {
    const { graph, gateId, workId } = withGate();
    const linked = connect(graph, gateId, workId, { sourceOutcome: 'rework', rework: true });
    expect(linked.error).toBeUndefined();
    const edge = edgesOf(linked.graph).find((e) => e.id === linked.edgeId);
    expect(edge).toEqual({ id: 'e-3', source: gateId, target: workId, sourceOutcome: 'rework', rework: true });
  });

  it('keeps a rework arm OUT of the dependency layer', () => {
    const { graph, gateId, workId } = withGate();
    const looped = connect(graph, gateId, workId, { sourceOutcome: 'rework', rework: true }).graph;
    expect(directPredecessors(looped, workId)).toEqual(['prompt-1']);
    expect([...ancestorsOf(looped, workId)]).toEqual(['prompt-1']);
    expect(ancestorsOf(looped, gateId).has(workId)).toBe(true);
  });

  it('refuses a rework arm leaving a node with one way out', () => {
    const { graph, ids } = seeded(['tdd', 'implement']);
    const chained = connect(graph, ids[0], ids[1]).graph;
    const denied = connect(chained, ids[1], ids[0], { rework: true });
    expect(denied.error.code).toBe('rework-edge-not-from-branch');
    expect(denied.error.message).toMatch(/verificação/);
  });

  it('refuses a rework arm that does not say WHICH verdict goes back', () => {
    const { graph, gateId, workId } = withGate();
    expect(connect(graph, gateId, workId, { rework: true }).error.code).toBe(
      'rework-edge-needs-outcome',
    );
  });

  it('refuses a rework arm that points FORWARD', () => {
    const { graph, gateId } = withGate();
    const added = addNode(graph, 'action', { block: 'docs' });
    const denied = connect(added.graph, gateId, added.nodeId, {
      sourceOutcome: 'rework',
      rework: true,
    });
    expect(denied.error.code).toBe('rework-edge-not-backward');
  });

  it('refuses to make the DEFAULT outcome the loop — the default fires when the judge fails', () => {
    const { graph, gateId, workId } = withGate();
    const denied = connect(graph, gateId, workId, { sourceOutcome: 'approved', rework: true });
    expect(denied.error.code).toBe('default-outcome-is-rework');
    expect(denied.error.message).toMatch(/PARA A FRENTE/);
  });

  it('still refuses an arm the gate never declared, even wearing the loop’s clothes', () => {
    const { graph, gateId, workId } = withGate();
    const denied = connect(graph, gateId, workId, { sourceOutcome: 'ghost', rework: true });
    expect(denied.error.code).toBe('edge-outcome-unknown');
  });
});

describe('canConnect', () => {
  it('says plain `{ok:true}` for a legal link and never mutates anything', () => {
    const { graph, root } = seeded(['tdd']);
    const added = addNode(graph, 'action', { block: 'docs' });
    expect(canConnect(added.graph, root, added.nodeId)).toEqual({ ok: true });
  });

  it('carries the SAME code the server validator reports', () => {
    const { graph, root, ids } = seeded(['tdd']);
    expect(canConnect(graph, ids[0], root).code).toBe('prompt-has-inbound');
    expect(canConnect(graph, root, ids[0]).code).toBe('duplicate-edge');
    expect(canConnect(graph, root, root).code).toBe('self-edge');
  });
});

describe('removeNode / removeEdge', () => {
  it('takes the node and every edge that touched it', () => {
    const { graph, root, ids } = seeded(['tdd', 'implement']);
    const chained = connect(graph, ids[0], ids[1]).graph;
    const next = removeNode(chained, ids[0]);
    expect(nodesOf(next).map((n) => n.id)).toEqual([root, ids[1]]);
    expect(edgesOf(next).map((e) => e.id)).toEqual(['e-2']);
  });

  it('returns the SAME reference when there is nothing to remove', () => {
    const { graph } = seeded(['tdd']);
    expect(removeNode(graph, 'ghost')).toBe(graph);
    expect(removeEdge(graph, 'ghost')).toBe(graph);
  });

  it('never touches the graph it was given', () => {
    const { graph, ids } = seeded(['tdd']);
    const before = JSON.stringify(graph);
    removeNode(graph, ids[0]);
    removeEdge(graph, 'e-1');
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('drops one edge and leaves the nodes alone', () => {
    const { graph } = seeded(['tdd']);
    const next = removeEdge(graph, 'e-1');
    expect(next.edges).toEqual([]);
    expect(nodesOf(next)).toHaveLength(2);
  });

  it('prunes a join subset that named the removed node', () => {
    const { graph, ids } = seeded(['tdd', 'security-review', 'performance-review']);
    const sink = addNode(graph, 'action', { block: 'consolidate' });
    let next = sink.graph;
    for (const id of ids) next = connect(next, id, sink.nodeId).graph;
    next = setJoin(next, sink.nodeId, { mode: 'subset', of: [ids[1], ids[2]] });
    const pruned = removeNode(next, ids[2]);
    expect(nodeById(pruned, sink.nodeId).join).toEqual({ mode: 'subset', of: [ids[1]] });
  });

  it('falls back to `all` when the subset empties — never to an empty subset', () => {
    const { graph, ids } = seeded(['tdd', 'implement']);
    const sink = addNode(graph, 'action', { block: 'consolidate' });
    let next = sink.graph;
    for (const id of ids) next = connect(next, id, sink.nodeId).graph;
    next = setJoin(next, sink.nodeId, { mode: 'subset', of: [ids[0]] });
    const pruned = removeEdge(next, edgesOf(next).find((e) => e.source === ids[0] && e.target === sink.nodeId).id);
    expect(nodeById(pruned, sink.nodeId).join).toEqual({ mode: 'all' });
  });

  it('clears a fan-out whose producer just left the graph', () => {
    const { graph, ids } = seeded(['recon']);
    const consumer = addNode(graph, 'action', { block: 'implement' });
    let next = connect(consumer.graph, ids[0], consumer.nodeId).graph;
    next = updateNode(next, consumer.nodeId, { fanOutFrom: ids[0], scope: 'memory' });
    expect(nodeById(next, consumer.nodeId).fanOutFrom).toBe(ids[0]);
    const pruned = removeNode(next, ids[0]);
    expect(nodeById(pruned, consumer.nodeId).fanOutFrom).toBeUndefined();
    expect(nodeById(pruned, consumer.nodeId).scope).toBeUndefined();
  });
});

describe('moveNode', () => {
  it('writes the new position', () => {
    const { graph, ids } = seeded(['tdd']);
    const next = moveNode(graph, ids[0], { x: 42, y: -7 });
    expect(nodeById(next, ids[0]).position).toEqual({ x: 42, y: -7 });
    expect(nodeById(graph, ids[0]).position).not.toEqual({ x: 42, y: -7 });
  });

  it('returns the SAME reference when the node is already there', () => {
    const { graph, ids } = seeded(['tdd']);
    const moved = moveNode(graph, ids[0], { x: 5, y: 5 });
    expect(moveNode(moved, ids[0], { x: 5, y: 5 })).toBe(moved);
  });

  it('refuses a non-finite coordinate rather than writing a NaN nobody can open', () => {
    const { graph, ids } = seeded(['tdd']);
    expect(moveNode(graph, ids[0], { x: NaN, y: 0 })).toBe(graph);
    expect(moveNode(graph, ids[0], { x: 0, y: Infinity })).toBe(graph);
    expect(moveNode(graph, ids[0], null)).toBe(graph);
  });

  it('returns the SAME reference for an unknown node', () => {
    const { graph } = seeded(['tdd']);
    expect(moveNode(graph, 'ghost', { x: 1, y: 1 })).toBe(graph);
  });
});

describe('updateNode', () => {
  it('shallow-merges the patch', () => {
    const { graph, ids } = seeded(['tests']);
    const next = updateNode(graph, ids[0], { label: 'Cobrir o parser', scope: 'per-file' });
    expect(nodeById(next, ids[0])).toMatchObject({ label: 'Cobrir o parser', scope: 'per-file', block: 'tests' });
  });

  it('deletes a field set to `undefined` — that is how the inspector clears one', () => {
    const { graph, ids } = seeded(['tests']);
    const set = updateNode(graph, ids[0], { scope: 'per-file' });
    const cleared = updateNode(set, ids[0], { scope: undefined });
    expect('scope' in nodeById(cleared, ids[0])).toBe(false);
  });

  it('never patches identity', () => {
    const { graph, ids } = seeded(['tests']);
    const next = updateNode(graph, ids[0], { id: 'hijacked', kind: 'gate' });
    expect(nodeById(next, ids[0]).kind).toBe('action');
    expect(nodeById(next, 'hijacked')).toBeNull();
  });

  it('keeps the root joinless', () => {
    const { graph, root } = seeded(['tests']);
    const next = updateNode(graph, root, { join: { mode: 'all' }, goal: 'Novo objetivo' });
    expect(nodeById(next, root).join).toBeUndefined();
    expect(nodeById(next, root).goal).toBe('Novo objetivo');
  });

  it('copies the patch, so a later mutation of the caller’s object cannot leak in', () => {
    const { graph, ids } = seeded(['tests']);
    const files = ['a.ts'];
    const next = updateNode(graph, ids[0], { files });
    files.push('b.ts');
    expect(nodeById(next, ids[0]).files).toEqual(['a.ts']);
  });

  it('returns the SAME reference for an unknown node or an unreadable patch', () => {
    const { graph, ids } = seeded(['tests']);
    expect(updateNode(graph, 'ghost', { label: 'x' })).toBe(graph);
    expect(updateNode(graph, ids[0], null)).toBe(graph);
  });
});

describe('setJoin', () => {
  it('sets a subset and dedupes it', () => {
    const { graph, ids } = seeded(['tdd', 'implement']);
    const sink = addNode(graph, 'action', { block: 'consolidate' });
    let next = sink.graph;
    for (const id of ids) next = connect(next, id, sink.nodeId).graph;
    next = setJoin(next, sink.nodeId, { mode: 'subset', of: [ids[0], ids[0], ''] });
    expect(nodeById(next, sink.nodeId).join).toEqual({ mode: 'subset', of: [ids[0]] });
  });

  it('goes back to `all`', () => {
    const { graph, ids } = seeded(['tdd']);
    const subset = setJoin(graph, ids[0], { mode: 'subset', of: ['prompt-1'] });
    expect(setJoin(subset, ids[0], { mode: 'all' }).nodes[1].join).toEqual({ mode: 'all' });
  });

  it('never gives the root a join — it waits for nobody', () => {
    const { graph, root } = seeded(['tdd']);
    expect(setJoin(graph, root, { mode: 'all' })).toBe(graph);
  });

  it('returns the SAME reference for an unreadable policy', () => {
    const { graph, ids } = seeded(['tdd']);
    expect(setJoin(graph, ids[0], { mode: 'whatever' })).toBe(graph);
    expect(setJoin(graph, ids[0], null)).toBe(graph);
    expect(setJoin(graph, 'ghost', { mode: 'all' })).toBe(graph);
  });

  it('never touches the graph it was given', () => {
    const { graph, ids } = seeded(['tdd']);
    const before = JSON.stringify(graph);
    setJoin(graph, ids[0], { mode: 'subset', of: ['prompt-1'] });
    expect(JSON.stringify(graph)).toBe(before);
  });
});

describe('toFlow', () => {
  it('types every flow node by KIND, so the canvas registers one component per kind', () => {
    const { graph, gateId } = withGate();
    const flow = toFlow(graph);
    expect(flow.nodes.map((n) => n.type)).toEqual(['prompt', 'action', 'gate']);
    expect(flow.nodes.find((n) => n.id === gateId).data.outcomes.map((o) => o.id)).toEqual([
      'approved',
      'rework',
    ]);
  });

  it('carries positions as plain numbers', () => {
    const { graph, ids } = seeded(['tdd']);
    const flow = toFlow(moveNode(graph, ids[0], { x: 12, y: 34 }));
    expect(flow.nodes[1].position).toEqual({ x: 12, y: 34 });
  });

  it('hangs a branch edge off its ARM handle and labels it with the arm', () => {
    const { graph, gateId } = withGate();
    const added = addNode(graph, 'action', { block: 'docs' });
    const linked = connect(added.graph, gateId, added.nodeId, { sourceOutcome: 'approved' }).graph;
    const edge = toFlow(linked).edges.find((e) => e.source === gateId);
    expect(edge.sourceHandle).toBe('approved');
    expect(edge.label).toBe('Aprovado');
    expect(edge.data).toEqual({ sourceOutcome: 'approved', rework: false });
  });

  it('marks a rework arm so the canvas can draw it going back', () => {
    const { graph, gateId, workId } = withGate();
    const looped = connect(graph, gateId, workId, { sourceOutcome: 'rework', rework: true }).graph;
    const edge = toFlow(looped).edges.find((e) => e.data.rework);
    expect(edge.className).toBe('rework');
    expect(edge.target).toBe(workId);
  });

  it('leaves a plain edge with no handle and no label', () => {
    const { graph } = seeded(['tdd']);
    const [edge] = toFlow(graph).edges;
    expect(edge.sourceHandle).toBeNull();
    expect(edge.label).toBeUndefined();
    expect(edge.data.rework).toBe(false);
  });
});

describe('fromFlowChanges', () => {
  it('applies a drag', () => {
    const { graph, ids } = seeded(['tdd']);
    const next = fromFlowChanges(graph, [
      { type: 'position', id: ids[0], position: { x: 9, y: 9 }, dragging: false },
    ]);
    expect(nodeById(next, ids[0]).position).toEqual({ x: 9, y: 9 });
  });

  it('removes a node by id, with its edges', () => {
    const { graph, ids } = seeded(['tdd']);
    const next = fromFlowChanges(graph, [{ type: 'remove', id: ids[0] }]);
    expect(nodesOf(next)).toHaveLength(1);
    expect(next.edges).toEqual([]);
  });

  it('removes an edge by id when the id is an edge', () => {
    const { graph } = seeded(['tdd']);
    const next = fromFlowChanges(graph, [{ type: 'remove', id: 'e-1' }]);
    expect(next.edges).toEqual([]);
    expect(nodesOf(next)).toHaveLength(2);
  });

  it('ignores selection and measurement — canvas chrome never reaches the saved method', () => {
    const { graph, ids } = seeded(['tdd']);
    const changes = [
      { type: 'select', id: ids[0], selected: true },
      { type: 'dimensions', id: ids[0], dimensions: { width: 10, height: 10 } },
      { type: 'position', id: ids[0] },
      { type: 'remove', id: 'ghost' },
      null,
    ];
    expect(fromFlowChanges(graph, changes)).toBe(graph);
    expect(fromFlowChanges(graph, null)).toBe(graph);
  });

  it('folds a whole batch in order', () => {
    const { graph, ids } = seeded(['tdd', 'implement']);
    const next = fromFlowChanges(graph, [
      { type: 'position', id: ids[0], position: { x: 1, y: 2 } },
      { type: 'remove', id: ids[1] },
    ]);
    expect(nodeById(next, ids[0]).position).toEqual({ x: 1, y: 2 });
    expect(nodeById(next, ids[1])).toBeNull();
  });
});

describe('suggestPosition', () => {
  it('puts each sibling in its own lane, so a fan-out READS as parallel', () => {
    let graph = emptyGraph('g', 'G', NOW);
    const root = graph.nodes[0].id;
    const seen = [];
    for (let i = 0; i < 3; i += 1) {
      const spot = suggestPosition(graph, root);
      seen.push(spot);
      const added = addNode(graph, 'action', { position: spot });
      graph = connect(added.graph, root, added.nodeId).graph;
    }
    expect(seen.map((p) => p.x)).toEqual([280, 280, 280]);
    expect(seen.map((p) => p.y)).toEqual([0, 140, 280]);
  });

  it('nudges off a spot another node already occupies', () => {
    const { graph, root } = seeded([]);
    const blocked = addNode(graph, 'action', { position: { x: 280, y: 0 } }).graph;
    expect(suggestPosition(blocked, root)).toEqual({ x: 280, y: 140 });
  });
});

// ---------------------------------------------------------------------------
// THE GRAPH THE USER ASKED FOR, built with nothing but this module and the
// palette: "adicionando mais de uma do mesmo ponto de partida".
// ---------------------------------------------------------------------------

describe('o grafo do usuário — três frentes em paralelo, continuando de uma delas', () => {
  it('drops tdd, security-review and performance-review on the SAME bolinha and joins on one', () => {
    let graph = emptyGraph('tres-frentes', 'Três frentes', NOW);
    const root = graph.nodes[0].id;

    /** Pick an item out of the palette the way the UI does — by what it renders. */
    const pick = (id) => {
      const items = paletteFor(graph, root, null, CATALOG);
      const item = items.find((entry) => entry.id === id);
      expect(item).toBeDefined();
      expect(item.disabled).toBeUndefined();
      return item;
    };

    const ids = {};
    for (const block of ['tdd', 'security-review', 'performance-review']) {
      const result = applyPaletteChoice(graph, root, null, pick(block));
      expect(result.error).toBeUndefined();
      graph = result.graph;
      ids[block] = result.nodeId;
    }

    // The consolidator hangs off the first front and the other two are drawn
    // into it — one node, three inputs.
    const consolidated = applyPaletteChoice(graph, ids.tdd, null, pick('consolidate'));
    expect(consolidated.error).toBeUndefined();
    graph = consolidated.graph;
    const sink = consolidated.nodeId;
    for (const block of ['security-review', 'performance-review']) {
      const linked = connect(graph, ids[block], sink);
      expect(linked.error).toBeUndefined();
      graph = linked.graph;
    }

    // "continue from the performance one": drop the DEPENDENCY on the other
    // two. (It does not drop the wave's merge barrier — huu still merges every
    // branch of the stage before the next one starts.)
    graph = setJoin(graph, sink, { mode: 'subset', of: [ids['performance-review']] });

    // --- the shape ---
    expect(nodesOf(graph).map((n) => n.id)).toEqual([
      'prompt-1',
      'action-1',
      'action-2',
      'action-3',
      'action-4',
    ]);
    expect(nodesOf(graph).map((n) => n.block)).toEqual([
      undefined,
      'tdd',
      'security-review',
      'performance-review',
      'consolidate',
    ]);
    expect(nodesOf(graph).map((n) => n.label)).toEqual([
      'Entrada do prompt',
      'TDD',
      'Revisão de segurança',
      'Revisão de performance',
      'Consolidar',
    ]);

    // Three fronts leave the SAME point, and none of them names an arm — the
    // prompt node has exactly one way out.
    expect(outboundEdges(graph, root).map((e) => e.target)).toEqual([
      ids.tdd,
      ids['security-review'],
      ids['performance-review'],
    ]);
    for (const edge of edgesOf(graph)) expect(edge.sourceOutcome).toBeUndefined();
    expect(edgesOf(graph)).toHaveLength(6);

    // All three flow into the consolidator; only one of them is a dependency.
    expect(directPredecessors(graph, sink)).toEqual([
      ids.tdd,
      ids['security-review'],
      ids['performance-review'],
    ]);
    expect(nodeById(graph, sink).join).toEqual({
      mode: 'subset',
      of: [ids['performance-review']],
    });

    // The three fronts are siblings, not a chain: each one's only ancestor is
    // the root, and each sits in its own lane.
    for (const block of ['tdd', 'security-review', 'performance-review']) {
      expect([...ancestorsOf(graph, ids[block])]).toEqual([root]);
    }
    expect(nodesOf(graph).slice(1, 4).map((n) => n.position)).toEqual([
      { x: 280, y: 0 },
      { x: 280, y: 140 },
      { x: 280, y: 280 },
    ]);

    // And it projects onto the canvas as five chips and six wires.
    const flow = toFlow(graph, CATALOG);
    expect(flow.nodes).toHaveLength(5);
    expect(flow.edges).toHaveLength(6);
    expect(flow.edges.every((e) => e.sourceHandle === null)).toBe(true);
  });
});
