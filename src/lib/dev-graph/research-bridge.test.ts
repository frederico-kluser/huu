import { describe, expect, it } from 'vitest';
import type {
  ActionNode,
  DevGraph,
  GateNode,
  GraphEdge,
  GraphNode,
  PromptNode,
  ResearchNode,
} from './graph-types.js';
import { researchMdPath } from './research-contract.js';
import { researchSpecOf, upstreamInfoSpecs } from './research-bridge.js';
import { validateGraph } from './graph-validate.js';

// ─────────────────────────────── fixtures ───────────────────────────────────

const ROOT = '.huu/dev/s1/graph';

function promptNode(id = 'objetivo', goal = 'Reduzir o tempo de build'): PromptNode {
  return { id, kind: 'prompt', label: 'Objetivo', position: { x: 0, y: 0 }, goal };
}

function actionNode(id: string, extra: Partial<ActionNode> = {}): ActionNode {
  return {
    id,
    kind: 'action',
    label: id,
    position: { x: 0, y: 0 },
    block: 'implement',
    join: { mode: 'all' },
    ...extra,
  };
}

function researchNode(id: string, extra: Partial<ResearchNode> = {}): ResearchNode {
  return {
    id,
    kind: 'research',
    label: id,
    position: { x: 0, y: 0 },
    query: `pergunta de ${id}`,
    useContext: false,
    outputKind: 'info',
    join: { mode: 'all' },
    ...extra,
  };
}

function gateNode(id: string, extra: Partial<GateNode> = {}): GateNode {
  return {
    id,
    kind: 'gate',
    label: id,
    position: { x: 0, y: 0 },
    condition: 'a suíte passa?',
    outcomes: [
      { id: 'ok', label: 'Segue' },
      { id: 'rework', label: 'Refaz' },
    ],
    defaultOutcome: 'ok',
    join: { mode: 'all' },
    ...extra,
  };
}

function edge(id: string, source: string, target: string, sourceOutcome?: string): GraphEdge {
  return sourceOutcome === undefined
    ? { id, source, target }
    : { id, source, target, sourceOutcome };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[]): DevGraph {
  return {
    _format: 'huu-devgraph-v1',
    id: 'g',
    name: 'grafo',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    meta: {},
    nodes,
    edges,
  };
}

// A chain: objetivo → info-a → info-b → consumidor
function chainGraph(): DevGraph {
  return graphOf(
    [
      promptNode(),
      researchNode('info-a'),
      researchNode('info-b', { useContext: true }),
      actionNode('consumidor'),
    ],
    [
      edge('e1', 'objetivo', 'info-a'),
      edge('e2', 'info-a', 'info-b'),
      edge('e3', 'info-b', 'consumidor'),
    ],
  );
}

// ─────────────────────────────── researchSpecOf ─────────────────────────────

describe('research-bridge / researchSpecOf', () => {
  it('carries the node identity, query and root verbatim', () => {
    const graph = chainGraph();
    const node = graph.nodes[1] as ResearchNode;
    const spec = researchSpecOf(graph, node, ROOT);
    expect(spec.nodeId).toBe('info-a');
    expect(spec.query).toBe('pergunta de info-a');
    expect(spec.graphRoot).toBe(ROOT);
    expect(spec.label).toBe('info-a');
  });

  it('maps outputKind onto the contract kind', () => {
    const graph = graphOf(
      [
        promptNode(),
        researchNode('r-info'),
        researchNode('r-bool', { outputKind: 'boolean', defaultOutcome: 'no' }),
        researchNode('r-choice', {
          outputKind: 'choice',
          choices: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          defaultOutcome: 'a',
        }),
      ],
      [],
    );
    const [, info, bool, choice] = graph.nodes as [GraphNode, ResearchNode, ResearchNode, ResearchNode];
    expect(researchSpecOf(graph, info, ROOT).kind).toBe('info');
    expect(researchSpecOf(graph, bool, ROOT).kind).toBe('boolean');
    expect(researchSpecOf(graph, choice, ROOT).kind).toBe('choice');
  });

  it('passes the choices through for a choice node', () => {
    const node = researchNode('r', {
      outputKind: 'choice',
      choices: [
        { id: 'vite', label: 'Vite' },
        { id: 'esbuild', label: 'esbuild' },
      ],
      defaultOutcome: 'vite',
    });
    const spec = researchSpecOf(graphOf([promptNode(), node], []), node, ROOT);
    expect(spec.choices).toEqual([
      { id: 'vite', label: 'Vite' },
      { id: 'esbuild', label: 'esbuild' },
    ]);
  });

  it('omits choices for a boolean node — its arms are fixed', () => {
    const node = researchNode('r', {
      outputKind: 'boolean',
      defaultOutcome: 'no',
      choices: [{ id: 'x', label: 'X' }],
    });
    expect(researchSpecOf(graphOf([promptNode(), node], []), node, ROOT).choices).toBeUndefined();
  });

  it('omits choices for an informative node', () => {
    const node = researchNode('r', { choices: [{ id: 'x', label: 'X' }] });
    expect(researchSpecOf(graphOf([promptNode(), node], []), node, ROOT).choices).toBeUndefined();
  });

  it('carries defaultOutcome for a branching node', () => {
    const node = researchNode('r', { outputKind: 'boolean', defaultOutcome: 'no' });
    expect(researchSpecOf(graphOf([promptNode(), node], []), node, ROOT).defaultOutcome).toBe('no');
  });

  it('omits defaultOutcome for an informative node — it routes nothing', () => {
    const node = researchNode('r', { defaultOutcome: 'whatever' });
    expect(
      researchSpecOf(graphOf([promptNode(), node], []), node, ROOT).defaultOutcome,
    ).toBeUndefined();
  });

  it('mirrors useContext', () => {
    const off = researchNode('a');
    const on = researchNode('b', { useContext: true });
    const graph = graphOf([promptNode(), off, on], []);
    expect(researchSpecOf(graph, off, ROOT).useContext).toBe(false);
    expect(researchSpecOf(graph, on, ROOT).useContext).toBe(true);
  });

  it('omits contextFiles when useContext is off, even with research upstream', () => {
    const graph = chainGraph();
    (graph.nodes[2] as ResearchNode).useContext = false;
    const spec = researchSpecOf(graph, graph.nodes[2] as ResearchNode, ROOT);
    expect(spec.contextFiles).toBeUndefined();
  });

  it('lists the research.md of every upstream research node when useContext is on', () => {
    const graph = chainGraph();
    const spec = researchSpecOf(graph, graph.nodes[2] as ResearchNode, ROOT);
    expect(spec.contextFiles).toEqual([researchMdPath(ROOT, 'info-a')]);
  });

  it('omits contextFiles when useContext is on but nothing upstream researched', () => {
    const node = researchNode('solo', { useContext: true });
    const graph = graphOf([promptNode(), node], [edge('e1', 'objetivo', 'solo')]);
    expect(researchSpecOf(graph, node, ROOT).contextFiles).toBeUndefined();
  });

  it('includes a BOOLEAN research ancestor in the context, not only informative ones', () => {
    const graph = graphOf(
      [
        promptNode(),
        researchNode('cve', { outputKind: 'boolean', defaultOutcome: 'no' }),
        researchNode('depois', { useContext: true }),
        actionNode('sim'),
        actionNode('nao'),
      ],
      [
        edge('e1', 'objetivo', 'cve'),
        edge('e2', 'cve', 'depois', 'yes'),
        edge('e3', 'cve', 'nao', 'no'),
        edge('e4', 'depois', 'sim'),
      ],
    );
    const spec = researchSpecOf(graph, graph.nodes[2] as ResearchNode, ROOT);
    expect(spec.contextFiles).toEqual([researchMdPath(ROOT, 'cve')]);
  });

  it('orders contextFiles topologically, not by edge declaration', () => {
    const graph = graphOf(
      [promptNode(), researchNode('primeiro'), researchNode('segundo'), researchNode('ultimo', { useContext: true })],
      [
        edge('e1', 'objetivo', 'primeiro'),
        edge('e2', 'primeiro', 'segundo'),
        // The edge from `primeiro` is declared AFTER the one from `segundo`.
        edge('e3', 'segundo', 'ultimo'),
        edge('e4', 'primeiro', 'ultimo'),
      ],
    );
    const spec = researchSpecOf(graph, graph.nodes[3] as ResearchNode, ROOT);
    expect(spec.contextFiles).toEqual([
      researchMdPath(ROOT, 'primeiro'),
      researchMdPath(ROOT, 'segundo'),
    ]);
  });

  it('excludes a research node the join dropped', () => {
    const graph = graphOf(
      [
        promptNode(),
        researchNode('mantido'),
        researchNode('largado'),
        researchNode('consumidor', { useContext: true, join: { mode: 'subset', of: ['mantido'] } }),
      ],
      [
        edge('e1', 'objetivo', 'mantido'),
        edge('e2', 'objetivo', 'largado'),
        edge('e3', 'mantido', 'consumidor'),
        edge('e4', 'largado', 'consumidor'),
      ],
    );
    const spec = researchSpecOf(graph, graph.nodes[3] as ResearchNode, ROOT);
    expect(spec.contextFiles).toEqual([researchMdPath(ROOT, 'mantido')]);
  });

  it('sanitizes the paths it hands over (the root is interpolated into shell)', () => {
    const node = researchNode('b', { useContext: true });
    const graph = graphOf(
      [promptNode(), researchNode('a'), node],
      [edge('e1', 'objetivo', 'a'), edge('e2', 'a', 'b')],
    );
    const spec = researchSpecOf(graph, node, '.huu/../dev; rm -rf /');
    expect(spec.contextFiles![0]).not.toContain(';');
    expect(spec.contextFiles![0]).not.toContain('..');
  });

  it('is deterministic for the same node', () => {
    const graph = chainGraph();
    const node = graph.nodes[2] as ResearchNode;
    expect(JSON.stringify(researchSpecOf(graph, node, ROOT))).toBe(
      JSON.stringify(researchSpecOf(graph, node, ROOT)),
    );
  });
});

// ───────────────────────────── upstreamInfoSpecs ────────────────────────────

describe('research-bridge / upstreamInfoSpecs', () => {
  it('returns nothing for a node with no research upstream', () => {
    const graph = graphOf([promptNode(), actionNode('a')], [edge('e1', 'objetivo', 'a')]);
    expect(upstreamInfoSpecs(graph, 'a', ROOT)).toEqual([]);
  });

  it('returns the informative ancestor of a consumer', () => {
    const graph = chainGraph();
    const specs = upstreamInfoSpecs(graph, 'consumidor', ROOT);
    expect(specs.map((s) => s.nodeId)).toEqual(['info-a', 'info-b']);
  });

  it('ignores a BOOLEAN research ancestor — it routes instead of informing', () => {
    const graph = graphOf(
      [
        promptNode(),
        researchNode('cve', { outputKind: 'boolean', defaultOutcome: 'no' }),
        actionNode('sim'),
        actionNode('nao'),
      ],
      [edge('e1', 'objetivo', 'cve'), edge('e2', 'cve', 'sim', 'yes'), edge('e3', 'cve', 'nao', 'no')],
    );
    expect(upstreamInfoSpecs(graph, 'sim', ROOT)).toEqual([]);
  });

  it('ignores a CHOICE research ancestor', () => {
    const graph = graphOf(
      [
        promptNode(),
        researchNode('qual', {
          outputKind: 'choice',
          choices: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          defaultOutcome: 'a',
        }),
        actionNode('ra'),
        actionNode('rb'),
      ],
      [edge('e1', 'objetivo', 'qual'), edge('e2', 'qual', 'ra', 'a'), edge('e3', 'qual', 'rb', 'b')],
    );
    expect(upstreamInfoSpecs(graph, 'ra', ROOT)).toEqual([]);
  });

  it('reaches an informative node several hops upstream', () => {
    const graph = graphOf(
      [promptNode(), researchNode('info'), actionNode('meio'), actionNode('fim')],
      [
        edge('e1', 'objetivo', 'info'),
        edge('e2', 'info', 'meio'),
        edge('e3', 'meio', 'fim'),
      ],
    );
    expect(upstreamInfoSpecs(graph, 'fim', ROOT).map((s) => s.nodeId)).toEqual(['info']);
  });

  it('drops an informative node reachable only through a dropped join edge', () => {
    const graph = graphOf(
      [
        promptNode(),
        researchNode('visto'),
        researchNode('largado'),
        actionNode('consumidor', { join: { mode: 'subset', of: ['visto'] } }),
      ],
      [
        edge('e1', 'objetivo', 'visto'),
        edge('e2', 'objetivo', 'largado'),
        edge('e3', 'visto', 'consumidor'),
        edge('e4', 'largado', 'consumidor'),
      ],
    );
    expect(upstreamInfoSpecs(graph, 'consumidor', ROOT).map((s) => s.nodeId)).toEqual(['visto']);
  });

  it('returns them in topological order', () => {
    const graph = graphOf(
      [promptNode(), researchNode('um'), researchNode('dois'), actionNode('c')],
      [
        edge('e1', 'objetivo', 'um'),
        edge('e2', 'um', 'dois'),
        edge('e3', 'dois', 'c'),
        edge('e4', 'um', 'c'),
      ],
    );
    expect(upstreamInfoSpecs(graph, 'c', ROOT).map((s) => s.nodeId)).toEqual(['um', 'dois']);
  });

  it('feeds a GATE node like any other consumer', () => {
    const graph = graphOf(
      [promptNode(), researchNode('info'), gateNode('portao'), actionNode('ok'), actionNode('re')],
      [
        edge('e1', 'objetivo', 'info'),
        edge('e2', 'info', 'portao'),
        edge('e3', 'portao', 'ok', 'ok'),
        edge('e4', 'portao', 're', 'rework'),
      ],
    );
    expect(upstreamInfoSpecs(graph, 'portao', ROOT).map((s) => s.nodeId)).toEqual(['info']);
  });

  it('never includes the node itself', () => {
    const graph = chainGraph();
    expect(upstreamInfoSpecs(graph, 'info-b', ROOT).map((s) => s.nodeId)).toEqual(['info-a']);
  });

  it('is deterministic', () => {
    const graph = chainGraph();
    expect(JSON.stringify(upstreamInfoSpecs(graph, 'consumidor', ROOT))).toBe(
      JSON.stringify(upstreamInfoSpecs(graph, 'consumidor', ROOT)),
    );
  });

  it('never throws on a graph the validator rejects (a cycle)', () => {
    const graph = graphOf(
      [promptNode(), researchNode('a'), actionNode('b')],
      [edge('e1', 'objetivo', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')],
    );
    expect(validateGraph(graph).ok).toBe(false);
    expect(() => upstreamInfoSpecs(graph, 'b', ROOT)).not.toThrow();
  });

  it('never throws on a malformed nodes array', () => {
    const graph = graphOf([promptNode(), null as unknown as GraphNode], []);
    expect(() => upstreamInfoSpecs(graph, 'objetivo', ROOT)).not.toThrow();
  });
});
