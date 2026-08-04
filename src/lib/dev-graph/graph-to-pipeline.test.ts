import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PipelineSchema, validateTopology } from '../pipeline-io.js';
import { ROUTER_PREFIX } from '../dev-mode/dev-protocol.js';
import { DEFAULT_MAX_NODE_EXECUTIONS, type CheckStep, type Pipeline, type WorkStep } from '../types.js';
import type {
  ActionNode,
  DevGraph,
  GateNode,
  GraphEdge,
  GraphNode,
  PromptNode,
  ResearchNode,
} from './graph-types.js';
import { validateGraph } from './graph-validate.js';
import { ACTION_BLOCKS, blockIds, findBlock } from './node-catalog.js';
import { researchDir, researchJsonPath } from './research-contract.js';
import {
  DEVGRAPH_CHECK_MAX_RUNS,
  DEVGRAPH_DEFAULT_FAN_OUT,
  DEVGRAPH_FINDINGS_DIR,
  DEVGRAPH_MAX_FAN_OUT,
  compileGraphPipeline,
  narrowGraphMethodology,
} from './graph-to-pipeline.js';

// ───────────────────────────────── fixtures ─────────────────────────────────

const ROOT = '.huu/dev/sess-1/graph';
const GOAL = 'Reduzir o tempo de build do projeto pela metade';

/**
 * The producing blocks, discovered by FIELD. Never a hard-coded id: the catalog
 * grows by appending, and a test that named `recon` would go stale the day a
 * second producer shipped.
 */
const PRODUCERS = ACTION_BLOCKS.filter((block) => block.produces === true);
const PRODUCER = PRODUCERS[0]!.id;

function promptNode(id = 'objetivo', goal = GOAL): PromptNode {
  return { id, kind: 'prompt', label: 'Entrada do prompt', position: { x: 0, y: 0 }, goal };
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
    query: `o que sabemos sobre ${id}?`,
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
    condition: 'a suíte de testes do projeto sai com zero?',
    outcomes: [
      { id: 'aprovado', label: 'Aprovado' },
      { id: 'refazer', label: 'Refazer' },
    ],
    defaultOutcome: 'aprovado',
    join: { mode: 'all' },
    ...extra,
  };
}

function edge(id: string, source: string, target: string, sourceOutcome?: string): GraphEdge {
  return sourceOutcome === undefined
    ? { id, source, target }
    : { id, source, target, sourceOutcome };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[], meta: DevGraph['meta'] = {}): DevGraph {
  return {
    _format: 'huu-devgraph-v1',
    id: 'meu-metodo',
    name: 'Meu método',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    meta,
    nodes,
    edges,
  };
}

function compile(graph: DevGraph, overrides: Record<string, unknown> = {}): ReturnType<typeof compileGraphPipeline> {
  return compileGraphPipeline({ graph, graphRoot: ROOT, ...overrides });
}

function work(pipeline: Pipeline, name: string): WorkStep {
  const step = pipeline.steps.find((s) => s.name === name);
  if (!step || step.type === 'check') throw new Error(`no work step named "${name}"`);
  return step;
}

function check(pipeline: Pipeline, name: string): CheckStep {
  const step = pipeline.steps.find((s) => s.name === name);
  if (!step || step.type !== 'check') throw new Error(`no check step named "${name}"`);
  return step;
}

/** Every fixture must survive the REAL gate a run performs at load time. */
function expectValidPipeline(pipeline: Pipeline): void {
  const parsed = PipelineSchema.safeParse(pipeline);
  expect(parsed.success ? [] : parsed.error.issues.map((i) => i.message)).toEqual([]);
  expect(validateTopology(pipeline)).toEqual([]);
}

// The graph from the design brief: three lenses in parallel off the objective,
// and a consumer that only waits for the performance one.
function threeLensGraph(): DevGraph {
  return graphOf(
    [
      promptNode(),
      actionNode('tdd', { block: 'tdd', label: 'TDD do fix' }),
      actionNode('seguranca', { block: 'security-review', label: 'Segurança', files: ['src/a.ts'] }),
      actionNode('performance', { block: 'performance-review', label: 'Performance' }),
      actionNode('consolidar', {
        block: 'consolidate',
        label: 'Consolidar',
        join: { mode: 'subset', of: ['performance'] },
      }),
    ],
    [
      edge('e1', 'objetivo', 'tdd'),
      edge('e2', 'objetivo', 'seguranca'),
      edge('e3', 'objetivo', 'performance'),
      edge('e4', 'tdd', 'consolidar'),
      edge('e5', 'seguranca', 'consolidar'),
      edge('e6', 'performance', 'consolidar'),
    ],
  );
}

function booleanGraph(): DevGraph {
  return graphOf(
    [
      promptNode(),
      researchNode('cve', {
        label: 'Existe CVE conhecida?',
        outputKind: 'boolean',
        defaultOutcome: 'no',
      }),
      actionNode('trocar', { label: 'Trocar a lib' }),
      actionNode('seguir', { label: 'Seguir com a lib' }),
    ],
    [
      edge('e1', 'objetivo', 'cve'),
      edge('e2', 'cve', 'trocar', 'yes'),
      edge('e3', 'cve', 'seguir', 'no'),
    ],
  );
}

function choiceGraph(): DevGraph {
  return graphOf(
    [
      promptNode(),
      researchNode('bundler', {
        label: 'Qual bundler?',
        outputKind: 'choice',
        choices: [
          { id: 'vite', label: 'Vite' },
          { id: 'esbuild', label: 'esbuild' },
          { id: 'rollup', label: 'Rollup' },
        ],
        defaultOutcome: 'esbuild',
      }),
      actionNode('via-vite'),
      actionNode('via-esbuild'),
      actionNode('via-rollup'),
    ],
    [
      edge('e1', 'objetivo', 'bundler'),
      edge('e2', 'bundler', 'via-vite', 'vite'),
      edge('e3', 'bundler', 'via-esbuild', 'esbuild'),
      edge('e4', 'bundler', 'via-rollup', 'rollup'),
    ],
  );
}

/** producer → fan-out consumer → gate. The end-to-end memory-scope shape. */
function fanOutGraph(producerBlock = PRODUCER): DevGraph {
  return graphOf(
    [
      promptNode(),
      actionNode('achados', { block: producerBlock, label: 'Levantar achados' }),
      actionNode('corrigir', {
        block: 'implement',
        label: 'Corrigir cada achado',
        fanOutFrom: 'achados',
        scope: 'memory',
      }),
      gateNode('portao'),
      actionNode('selar', { block: 'docs', label: 'Selar' }),
      actionNode('refazer', { block: 'implement', label: 'Refazer' }),
    ],
    [
      edge('e1', 'objetivo', 'achados'),
      edge('e2', 'achados', 'corrigir'),
      edge('e3', 'corrigir', 'portao'),
      edge('e4', 'portao', 'selar', 'aprovado'),
      edge('e5', 'portao', 'refazer', 'refazer'),
    ],
  );
}

// ───────────────────────────── the entry gate ───────────────────────────────

describe('graph-to-pipeline / the entry gate', () => {
  it('throws on a graph with no prompt node', () => {
    const graph = graphOf([actionNode('a')], []);
    expect(() => compile(graph)).toThrow(/no-prompt-node/);
  });

  it('throws on a cycle, naming the code', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a'), actionNode('b')],
      [edge('e1', 'objetivo', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')],
    );
    expect(() => compile(graph)).toThrow(/cycle/);
  });

  it('throws on an unreachable node', () => {
    const graph = graphOf([promptNode(), actionNode('a'), actionNode('orfao')], [edge('e1', 'objetivo', 'a')]);
    expect(() => compile(graph)).toThrow(/unreachable-node/);
  });

  it('throws on an unknown block', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: 'nao-existe' })],
      [edge('e1', 'objetivo', 'a')],
    );
    expect(() => compile(graph)).toThrow(/unknown-block/);
  });

  it('throws on a branch arm with no outgoing edge', () => {
    const graph = graphOf(
      [promptNode(), gateNode('portao'), actionNode('ok')],
      [edge('e1', 'objetivo', 'portao'), edge('e2', 'portao', 'ok', 'aprovado')],
    );
    expect(() => compile(graph)).toThrow(/branch-outcome-missing-edge/);
  });

  it('reports how many issues blocked it', () => {
    const graph = graphOf([actionNode('a')], []);
    expect(() => compile(graph)).toThrow(/blocking issue/);
  });

  it('surfaces the graph WARNINGS instead of throwing on them', () => {
    const { warnings } = compile(threeLensGraph());
    expect(warnings.some((w) => w.includes('join-subset-drops-barrier'))).toBe(true);
  });

  it('states in the warning that a relaxed join does NOT skip the merge barrier', () => {
    const { warnings } = compile(threeLensGraph());
    const barrier = warnings.find((w) => w.includes('join-subset-drops-barrier'))!;
    expect(barrier).toMatch(/merge barrier/);
  });
});

// ────────────────────────── the three-lens graph ────────────────────────────

describe('graph-to-pipeline / the drawn method (three lenses + a subset join)', () => {
  it('emits one step per node and no step for the objective', () => {
    const { pipeline, nodeOrder, stepsByNode } = compile(threeLensGraph());
    expect(nodeOrder).toEqual(['tdd', 'seguranca', 'performance', 'consolidar']);
    expect(pipeline.steps).toHaveLength(4);
    expect(stepsByNode.objetivo).toBeUndefined();
  });

  it('makes every node hanging off the objective a ROOT', () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph());
    for (const id of ['tdd', 'seguranca', 'performance']) {
      expect(work(pipeline, stepsByNode[id]![0]!).dependsOn).toEqual([]);
    }
  });

  it('gives the subset-join consumer ONLY the performance step as a dependency', () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph());
    expect(work(pipeline, stepsByNode.consolidar![0]!).dependsOn).toEqual([
      stepsByNode.performance![0]!,
    ]);
  });

  it('would have depended on all three under the default join', () => {
    const graph = threeLensGraph();
    (graph.nodes[4] as ActionNode).join = { mode: 'all' };
    const { pipeline, stepsByNode } = compile(graph);
    expect(work(pipeline, stepsByNode.consolidar![0]!).dependsOn).toEqual([
      stepsByNode.tdd![0]!,
      stepsByNode.seguranca![0]!,
      stepsByNode.performance![0]!,
    ]);
  });

  it('orders dependsOn by EDGE declaration, not by node order', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a'), actionNode('b'), actionNode('c')],
      [
        edge('e1', 'objetivo', 'a'),
        edge('e2', 'objetivo', 'b'),
        edge('e3', 'b', 'c'),
        edge('e4', 'a', 'c'),
      ],
    );
    const { pipeline, stepsByNode } = compile(graph);
    expect(work(pipeline, stepsByNode.c![0]!).dependsOn).toEqual([
      stepsByNode.b![0]!,
      stepsByNode.a![0]!,
    ]);
  });

  it('passes the real schema + topology gate', () => {
    expectValidPipeline(compile(threeLensGraph()).pipeline);
  });

  it('names every dependsOn entry EARLIER in the array', () => {
    const { pipeline } = compile(threeLensGraph());
    const index = new Map(pipeline.steps.map((step, i) => [step.name, i]));
    pipeline.steps.forEach((step, i) => {
      for (const dep of step.dependsOn ?? []) expect(index.get(dep)!).toBeLessThan(i);
    });
  });
});

// ──────────────────────────── the naming scheme ─────────────────────────────

describe('graph-to-pipeline / step names', () => {
  it('prefixes the topological position and carries the node id', () => {
    const { stepsByNode } = compile(threeLensGraph());
    expect(stepsByNode.tdd).toEqual(['1. TDD do fix [tdd]']);
    expect(stepsByNode.consolidar).toEqual(['4. Consolidar [consolidar]']);
  });

  it('letters the two steps of a routing research node', () => {
    const { stepsByNode } = compile(booleanGraph());
    expect(stepsByNode.cve).toEqual([
      '1a. Existe CVE conhecida? [cve]',
      '1b. Existe CVE conhecida? — decisão [cve]',
    ]);
  });

  it('keeps names unique when two nodes share a label', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { label: 'Igual' }), actionNode('b', { label: 'Igual' })],
      [edge('e1', 'objetivo', 'a'), edge('e2', 'objetivo', 'b')],
    );
    const { pipeline } = compile(graph);
    expect(new Set(pipeline.steps.map((s) => s.name)).size).toBe(pipeline.steps.length);
  });

  it('truncates a long label with an ellipsis', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { label: 'x'.repeat(80) })],
      [edge('e1', 'objetivo', 'a')],
    );
    const { stepsByNode } = compile(graph);
    expect(stepsByNode.a![0]).toBe(`1. ${'x'.repeat(39)}… [a]`);
  });

  it('falls back to the node id when the label is blank', () => {
    const graph = graphOf(
      [promptNode(), actionNode('sem-rotulo', { label: '   ' })],
      [edge('e1', 'objetivo', 'sem-rotulo')],
    );
    expect(compile(graph).stepsByNode['sem-rotulo']![0]).toBe('1. sem-rotulo [sem-rotulo]');
  });

  it('collapses newlines in a label so a step name stays one line', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { label: 'duas\nlinhas' })],
      [edge('e1', 'objetivo', 'a')],
    );
    expect(compile(graph).stepsByNode.a![0]).toBe('1. duas linhas [a]');
  });

  it('maps every emitted node in stepsByNode, in nodeOrder', () => {
    const { nodeOrder, stepsByNode } = compile(fanOutGraph());
    expect(Object.keys(stepsByNode)).toEqual(nodeOrder);
  });
});

// ──────────────────────────────── action nodes ──────────────────────────────

describe('graph-to-pipeline / action nodes', () => {
  it('substitutes $goal in the block template', () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph());
    const prompt = work(pipeline, stepsByNode.tdd![0]!).prompt;
    expect(prompt).toContain(GOAL);
    expect(prompt).not.toContain('$goal');
  });

  it('lets an explicit `goal` option beat the prompt node', () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph(), { goal: 'outro objetivo' });
    expect(work(pipeline, stepsByNode.tdd![0]!).prompt).toContain('outro objetivo');
  });

  it('NEVER substitutes $file or $hint — those are the orchestrator’s', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: 'tests', files: ['src/a.ts'] })],
      [edge('e1', 'objetivo', 'a')],
    );
    const { pipeline, stepsByNode } = compile(graph);
    const prompt = work(pipeline, stepsByNode.a![0]!).prompt;
    expect(prompt).toContain('$file');
    expect(prompt).toContain('$hint');
  });

  it('uses the node prompt when it has one', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { prompt: 'faça exatamente isto' })],
      [edge('e1', 'objetivo', 'a')],
    );
    const { pipeline, stepsByNode } = compile(graph);
    expect(work(pipeline, stepsByNode.a![0]!).prompt).toContain('faça exatamente isto');
  });

  it('prepends the objective when the prompt never injects it', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { prompt: 'faça exatamente isto' })],
      [edge('e1', 'objetivo', 'a')],
    );
    const { pipeline, stepsByNode } = compile(graph);
    const prompt = work(pipeline, stepsByNode.a![0]!).prompt;
    expect(prompt).toContain('=== THE OBJECTIVE');
    expect(prompt.indexOf(GOAL)).toBeLessThan(prompt.indexOf('faça exatamente isto'));
  });

  it('does NOT prepend the objective twice when the prompt uses $goal', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { prompt: 'objetivo: $goal' })],
      [edge('e1', 'objetivo', 'a')],
    );
    const { pipeline, stepsByNode } = compile(graph);
    expect(work(pipeline, stepsByNode.a![0]!).prompt).not.toContain('=== THE OBJECTIVE');
  });

  it('appends the block judgeClause as the declared acceptance', () => {
    const graph = graphOf([promptNode(), actionNode('a')], [edge('e1', 'objetivo', 'a')]);
    const { pipeline, stepsByNode } = compile(graph);
    expect(work(pipeline, stepsByNode.a![0]!).prompt).toContain(findBlock('implement')!.judgeClause!);
  });

  it('emits no judge STEP for a judgeClause — an action node is not a gate', () => {
    const { pipeline } = compile(threeLensGraph());
    expect(pipeline.steps.filter((s) => s.type === 'check')).toHaveLength(0);
  });

  it('takes the scope from the node when it declares one', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { scope: 'per-file', files: ['x.ts'] })],
      [edge('e1', 'objetivo', 'a')],
    );
    expect(compile(graph).pipeline.steps[0]).toMatchObject({ scope: 'per-file', files: ['x.ts'] });
  });

  it("falls back to the block's defaultScope", () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: 'tests', files: ['x.ts'] })],
      [edge('e1', 'objetivo', 'a')],
    );
    expect(compile(graph).pipeline.steps[0]).toMatchObject({ scope: findBlock('tests')!.defaultScope });
  });

  it('drops hand-picked files under project scope, with a warning', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { scope: 'project', files: ['x.ts'] })],
      [edge('e1', 'objetivo', 'a')],
    );
    const { pipeline, warnings } = compile(graph);
    expect((pipeline.steps[0] as WorkStep).files).toEqual([]);
    expect(warnings.some((w) => w.includes('hand-picked file'))).toBe(true);
  });

  it('warns when a per-file node picked nothing (zero tasks)', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { scope: 'per-file' })],
      [edge('e1', 'objetivo', 'a')],
    );
    expect(compile(graph).warnings.some((w) => w.includes('ZERO tasks'))).toBe(true);
  });

  it('carries readOnly from the block', () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph());
    expect(work(pipeline, stepsByNode.seguranca![0]!).readOnly).toBe(true);
    expect(work(pipeline, stepsByNode.tdd![0]!).readOnly).toBeUndefined();
  });

  it('turns the per-task critic on from the block default', () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph());
    expect(work(pipeline, stepsByNode.tdd![0]!).review).toBeDefined();
    expect(work(pipeline, stepsByNode.performance![0]!).review).toBeUndefined();
  });

  it('lets the node override review off', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: 'tdd', review: false })],
      [edge('e1', 'objetivo', 'a')],
    );
    expect((compile(graph).pipeline.steps[0] as WorkStep).review).toBeUndefined();
  });

  it('lets the node override review on', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: 'docs', review: true })],
      [edge('e1', 'objetivo', 'a')],
    );
    expect((compile(graph).pipeline.steps[0] as WorkStep).review).toBeDefined();
  });

  it('gives the critic its own findings directory under the graph root', () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph());
    expect(work(pipeline, stepsByNode.tdd![0]!).review!.findingsDir).toBe(`${ROOT}/tdd/review`);
  });

  it("quotes the block's acceptance clause to the critic", () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph());
    expect(work(pipeline, stepsByNode.tdd![0]!).review!.prompt).toContain(
      findBlock('tdd')!.judgeClause!,
    );
  });

  it('leaves the critic model UNSET so it falls back to a different model than the worker', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: 'tdd', modelId: 'vendor/worker' })],
      [edge('e1', 'objetivo', 'a')],
    );
    const step = compile(graph).pipeline.steps[0] as WorkStep;
    expect(step.modelId).toBe('vendor/worker');
    expect(step.review!.modelId).toBeUndefined();
  });

  it('warns and degrades when a block defaults to memory scope with no fan-out', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: 'implement' })],
      [edge('e1', 'objetivo', 'a')],
    );
    // Simulate a future catalog entry whose defaultScope is `memory`.
    const original = findBlock('implement')!.defaultScope;
    (findBlock('implement') as { defaultScope: string }).defaultScope = 'memory';
    try {
      const { pipeline, warnings } = compile(graph);
      expect((pipeline.steps[0] as WorkStep).scope).toBe('project');
      expect(warnings.some((w) => w.includes('no fanOutFrom'))).toBe(true);
    } finally {
      (findBlock('implement') as { defaultScope: string }).defaultScope = original;
    }
  });

  it('warns when a custom block carries no prompt at all', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: 'custom' })],
      [edge('e1', 'objetivo', 'a')],
    );
    const { pipeline, warnings } = compile(graph);
    expect(warnings.some((w) => w.includes('no prompt template'))).toBe(true);
    expect((pipeline.steps[0] as WorkStep).prompt).toContain(GOAL);
  });
});

// ─────────────────────────── the memory fan-out ─────────────────────────────

describe('graph-to-pipeline / fan-out (memory scope)', () => {
  it('compiles producer → consumer with the SAME path on both sides', () => {
    const { pipeline, stepsByNode } = compile(fanOutGraph());
    const producer = work(pipeline, stepsByNode.achados![0]!);
    const consumer = work(pipeline, stepsByNode.corrigir![0]!);
    expect(producer.produces).toBe(`${DEVGRAPH_FINDINGS_DIR}/achados.json`);
    expect(consumer.filesFrom).toBe(producer.produces);
    expect(consumer.scope).toBe('memory');
  });

  it('writes the list under .huu/findings/ — the directory the producing prompts un-ignore', () => {
    const { pipeline, stepsByNode } = compile(fanOutGraph());
    expect(work(pipeline, stepsByNode.achados![0]!).produces!.startsWith('.huu/findings/')).toBe(true);
  });

  it('namespaces the list by NODE, so one block may be dropped twice', () => {
    const graph = graphOf(
      [
        promptNode(),
        actionNode('um', { block: PRODUCER }),
        actionNode('dois', { block: PRODUCER }),
        actionNode('consome', { fanOutFrom: 'um', scope: 'memory' }),
      ],
      [
        edge('e1', 'objetivo', 'um'),
        edge('e2', 'objetivo', 'dois'),
        edge('e3', 'um', 'consome'),
        edge('e4', 'dois', 'consome'),
      ],
    );
    const { pipeline, stepsByNode } = compile(graph);
    expect(work(pipeline, stepsByNode.um![0]!).produces).not.toBe(
      work(pipeline, stepsByNode.dois![0]!).produces,
    );
    expectValidPipeline(pipeline);
  });

  it('declares produces for EVERY producing block, by field', () => {
    for (const block of PRODUCERS) {
      const { pipeline } = compile(fanOutGraph(block.id));
      expect((pipeline.steps[0] as WorkStep).produces, block.id).toBe(
        `${DEVGRAPH_FINDINGS_DIR}/achados.json`,
      );
      expectValidPipeline(pipeline);
    }
  });

  it('declares produces even when nothing fans out from the node', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { block: PRODUCER })],
      [edge('e1', 'objetivo', 'a')],
    );
    expect((compile(graph).pipeline.steps[0] as WorkStep).produces).toBe(
      `${DEVGRAPH_FINDINGS_DIR}/a.json`,
    );
  });

  it('never puts the memory step at index 0', () => {
    const { pipeline } = compile(fanOutGraph());
    const first = pipeline.steps[0] as WorkStep;
    expect(first.scope).not.toBe('memory');
    expectValidPipeline(pipeline);
  });

  it('defaults the fan-out width to the orchestrator default', () => {
    const { pipeline, stepsByNode } = compile(fanOutGraph());
    expect(work(pipeline, stepsByNode.corrigir![0]!).maxFiles).toBe(DEVGRAPH_DEFAULT_FAN_OUT);
  });

  it('honors an explicit maxFiles', () => {
    const graph = fanOutGraph();
    (graph.nodes[2] as ActionNode).maxFiles = 7;
    const { pipeline, stepsByNode } = compile(graph);
    expect(work(pipeline, stepsByNode.corrigir![0]!).maxFiles).toBe(7);
  });

  it('clamps a fan-out width the pipeline schema would reject', () => {
    const graph = fanOutGraph();
    (graph.nodes[2] as ActionNode).maxFiles = 400;
    const { pipeline, stepsByNode, warnings } = compile(graph);
    expect(work(pipeline, stepsByNode.corrigir![0]!).maxFiles).toBe(DEVGRAPH_MAX_FAN_OUT);
    expect(warnings.some((w) => w.includes('clamped'))).toBe(true);
    expectValidPipeline(pipeline);
  });

  it('writes NO huu-memory-v1 boilerplate into the producer prompt', () => {
    const { pipeline, stepsByNode } = compile(fanOutGraph());
    expect(work(pipeline, stepsByNode.achados![0]!).prompt).not.toContain('huu-memory-v1');
  });

  it('keeps the whole producer → fan-out → gate graph valid end to end', () => {
    const { pipeline } = compile(fanOutGraph());
    expectValidPipeline(pipeline);
    expect(pipeline.steps.map((s) => s.type)).toEqual(['work', 'work', 'check', 'work', 'work']);
  });
});

// ──────────────────────────── research: informative ─────────────────────────

describe('graph-to-pipeline / research (info)', () => {
  function infoGraph(): DevGraph {
    return graphOf(
      [
        promptNode(),
        researchNode('estado-da-arte', { label: 'Estado da arte' }),
        actionNode('aplicar', { label: 'Aplicar' }),
      ],
      [edge('e1', 'objetivo', 'estado-da-arte'), edge('e2', 'estado-da-arte', 'aplicar')],
    );
  }

  it('emits exactly ONE step — an informative node routes nothing', () => {
    const { stepsByNode, pipeline } = compile(infoGraph());
    expect(stepsByNode['estado-da-arte']).toHaveLength(1);
    expect(pipeline.steps.filter((s) => s.type === 'check')).toHaveLength(0);
  });

  it('runs it at project scope with no files', () => {
    const { pipeline, stepsByNode } = compile(infoGraph());
    expect(work(pipeline, stepsByNode['estado-da-arte']![0]!)).toMatchObject({
      scope: 'project',
      files: [],
    });
  });

  it('uses the research prompt from the contract module', () => {
    const { pipeline, stepsByNode } = compile(infoGraph());
    const prompt = work(pipeline, stepsByNode['estado-da-arte']![0]!).prompt;
    expect(prompt).toContain('=== PAPEL ===');
    expect(prompt).toContain(researchJsonPath(ROOT, 'estado-da-arte'));
  });

  it('does NOT inject the raw objective into a research prompt', () => {
    const { pipeline, stepsByNode } = compile(infoGraph());
    expect(work(pipeline, stepsByNode['estado-da-arte']![0]!).prompt).not.toContain(GOAL);
  });

  it('hands the consumer the research context block', () => {
    const { pipeline, stepsByNode } = compile(infoGraph());
    const prompt = work(pipeline, stepsByNode.aplicar![0]!).prompt;
    expect(prompt).toContain('=== PESQUISA JÁ FEITA NESTE GRAFO');
    expect(prompt).toContain(`${researchDir(ROOT, 'estado-da-arte')}/research.md`);
  });

  it('gives NO context block to a node with no research upstream', () => {
    const { pipeline, stepsByNode } = compile(threeLensGraph());
    expect(work(pipeline, stepsByNode.tdd![0]!).prompt).not.toContain('=== PESQUISA JÁ FEITA');
  });

  it('propagates the context through the EFFECTIVE dependencies only', () => {
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
    const { pipeline, stepsByNode } = compile(graph);
    const prompt = work(pipeline, stepsByNode.consumidor![0]!).prompt;
    expect(prompt).toContain(researchDir(ROOT, 'visto'));
    expect(prompt).not.toContain(researchDir(ROOT, 'largado'));
  });

  it('propagates transitively, several hops down', () => {
    const graph = graphOf(
      [promptNode(), researchNode('info'), actionNode('meio'), actionNode('fim')],
      [edge('e1', 'objetivo', 'info'), edge('e2', 'info', 'meio'), edge('e3', 'meio', 'fim')],
    );
    const { pipeline, stepsByNode } = compile(graph);
    expect(work(pipeline, stepsByNode.fim![0]!).prompt).toContain(researchDir(ROOT, 'info'));
  });

  it('feeds a GATE condition too — a drawn edge must not be a no-op', () => {
    const graph = graphOf(
      [promptNode(), researchNode('info'), gateNode('portao'), actionNode('ok'), actionNode('re')],
      [
        edge('e1', 'objetivo', 'info'),
        edge('e2', 'info', 'portao'),
        edge('e3', 'portao', 'ok', 'aprovado'),
        edge('e4', 'portao', 're', 'refazer'),
      ],
    );
    const { pipeline, stepsByNode } = compile(graph);
    expect(check(pipeline, stepsByNode.portao![0]!).condition).toContain(
      '=== PESQUISA JÁ FEITA NESTE GRAFO',
    );
  });

  it('does NOT duplicate the block into a research node (it has its own channel)', () => {
    const graph = graphOf(
      [promptNode(), researchNode('a'), researchNode('b', { useContext: true })],
      [edge('e1', 'objetivo', 'a'), edge('e2', 'a', 'b')],
    );
    const { pipeline, stepsByNode } = compile(graph);
    const prompt = work(pipeline, stepsByNode.b![0]!).prompt;
    expect(prompt).not.toContain('=== PESQUISA JÁ FEITA NESTE GRAFO');
    expect(prompt).toContain('=== CONTEXTO DAS ETAPAS ANTERIORES');
  });
});

// ─────────────────────────── research: boolean ──────────────────────────────

describe('graph-to-pipeline / research (boolean)', () => {
  it('emits a work step plus a check', () => {
    const { pipeline, stepsByNode } = compile(booleanGraph());
    expect(stepsByNode.cve).toHaveLength(2);
    expect(pipeline.steps.map((s) => s.type)).toEqual(['work', 'check', 'work', 'work']);
  });

  it('makes the check depend on its own work step', () => {
    const { pipeline, stepsByNode } = compile(booleanGraph());
    expect(check(pipeline, stepsByNode.cve![1]!).dependsOn).toEqual([stepsByNode.cve![0]!]);
  });

  it('routes yes/no to the nodes those arms point at', () => {
    const { pipeline, stepsByNode } = compile(booleanGraph());
    const outcomes = check(pipeline, stepsByNode.cve![1]!).outcomes;
    expect(outcomes.map((o) => o.label)).toEqual(['yes', 'no']);
    expect(outcomes.find((o) => o.label === 'yes')!.nextStepName).toBe(stepsByNode.trocar![0]);
    expect(outcomes.find((o) => o.label === 'no')!.nextStepName).toBe(stepsByNode.seguir![0]);
  });

  it('marks the node’s declared default outcome — and only it', () => {
    const { pipeline, stepsByNode } = compile(booleanGraph());
    const outcomes = check(pipeline, stepsByNode.cve![1]!).outcomes;
    expect(outcomes.filter((o) => o.default === true).map((o) => o.label)).toEqual(['no']);
  });

  it('follows the author when the SAFE route is `yes`', () => {
    const graph = booleanGraph();
    (graph.nodes[1] as ResearchNode).defaultOutcome = 'yes';
    const { pipeline, stepsByNode } = compile(graph);
    const outcomes = check(pipeline, stepsByNode.cve![1]!).outcomes;
    expect(outcomes.filter((o) => o.default === true).map((o) => o.label)).toEqual(['yes']);
  });

  it('uses the mechanical judge condition from the contract module', () => {
    const { pipeline, stepsByNode } = compile(booleanGraph());
    const condition = check(pipeline, stepsByNode.cve![1]!).condition;
    expect(condition).toContain(researchJsonPath(ROOT, 'cve'));
    expect(condition).toContain('Não pesquise nada na internet');
  });

  it('caps the check visits', () => {
    const { pipeline, stepsByNode } = compile(booleanGraph());
    expect(check(pipeline, stepsByNode.cve![1]!).maxRuns).toBe(DEVGRAPH_CHECK_MAX_RUNS);
  });

  it('makes a dependent wait for the CHECK, not for the work step', () => {
    const graph = booleanGraph();
    graph.nodes.push(actionNode('depois'));
    graph.edges.push(edge('e4', 'trocar', 'depois'));
    const { pipeline, stepsByNode } = compile(graph);
    graph.edges.push(edge('e5', 'cve', 'depois', 'yes'));
    const withDep = compile(
      graphOf(
        [
          promptNode(),
          researchNode('cve', { outputKind: 'boolean', defaultOutcome: 'no' }),
          actionNode('a'),
          actionNode('b'),
          actionNode('junta', { join: { mode: 'all' } }),
        ],
        [
          edge('e1', 'objetivo', 'cve'),
          edge('e2', 'cve', 'a', 'yes'),
          edge('e3', 'cve', 'b', 'no'),
          edge('e4', 'a', 'junta'),
        ],
      ),
    );
    expect(work(withDep.pipeline, withDep.stepsByNode.junta![0]!).dependsOn).toEqual([
      withDep.stepsByNode.a![0]!,
    ]);
    expectValidPipeline(pipeline);
  });

  it('passes the schema + topology gate', () => {
    expectValidPipeline(compile(booleanGraph()).pipeline);
  });
});

// ─────────────────────────── research: choice ───────────────────────────────

describe('graph-to-pipeline / research (choice)', () => {
  it('emits one outcome per option, in declaration order', () => {
    const { pipeline, stepsByNode } = compile(choiceGraph());
    expect(check(pipeline, stepsByNode.bundler![1]!).outcomes.map((o) => o.label)).toEqual([
      'vite',
      'esbuild',
      'rollup',
    ]);
  });

  it('routes every option to its own branch', () => {
    const { pipeline, stepsByNode } = compile(choiceGraph());
    const outcomes = check(pipeline, stepsByNode.bundler![1]!).outcomes;
    expect(outcomes.map((o) => o.nextStepName)).toEqual([
      stepsByNode['via-vite']![0],
      stepsByNode['via-esbuild']![0],
      stepsByNode['via-rollup']![0],
    ]);
  });

  it('marks exactly one default, the declared one', () => {
    const { pipeline, stepsByNode } = compile(choiceGraph());
    const outcomes = check(pipeline, stepsByNode.bundler![1]!).outcomes;
    expect(outcomes.filter((o) => o.default).map((o) => o.label)).toEqual(['esbuild']);
  });

  it('lists the closed enum in the judge condition', () => {
    const { pipeline, stepsByNode } = compile(choiceGraph());
    const condition = check(pipeline, stepsByNode.bundler![1]!).condition;
    expect(condition).toContain('<allowed-labels>');
    for (const id of ['vite', 'esbuild', 'rollup']) expect(condition).toContain(`- ${id}`);
    expect(condition).toContain('- esbuild (default)');
  });

  it('passes the schema + topology gate', () => {
    expectValidPipeline(compile(choiceGraph()).pipeline);
  });
});

// ────────────────────────────────── gates ───────────────────────────────────

describe('graph-to-pipeline / gate nodes', () => {
  function gateGraph(): DevGraph {
    return graphOf(
      [
        promptNode(),
        actionNode('trabalho'),
        gateNode('portao', { label: 'Suíte verde?' }),
        actionNode('selar', { block: 'docs' }),
        actionNode('refazer'),
      ],
      [
        edge('e1', 'objetivo', 'trabalho'),
        edge('e2', 'trabalho', 'portao'),
        edge('e3', 'portao', 'selar', 'aprovado'),
        edge('e4', 'portao', 'refazer', 'refazer'),
      ],
    );
  }

  it('compiles to a single CheckStep', () => {
    const { pipeline, stepsByNode } = compile(gateGraph());
    expect(stepsByNode.portao).toHaveLength(1);
    expect(check(pipeline, stepsByNode.portao![0]!).type).toBe('check');
  });

  it("quotes the human's condition verbatim", () => {
    const { pipeline, stepsByNode } = compile(gateGraph());
    expect(check(pipeline, stepsByNode.portao![0]!).condition).toContain(
      'a suíte de testes do projeto sai com zero?',
    );
  });

  it('routes each outcome to the first step of its target node', () => {
    const { pipeline, stepsByNode } = compile(gateGraph());
    const outcomes = check(pipeline, stepsByNode.portao![0]!).outcomes;
    expect(outcomes.find((o) => o.label === 'aprovado')!.nextStepName).toBe(stepsByNode.selar![0]);
    expect(outcomes.find((o) => o.label === 'refazer')!.nextStepName).toBe(stepsByNode.refazer![0]);
  });

  it('uses the outcome ID as the judge label, not the pt-BR chip text', () => {
    const { pipeline, stepsByNode } = compile(gateGraph());
    expect(check(pipeline, stepsByNode.portao![0]!).outcomes.map((o) => o.label)).toEqual([
      'aprovado',
      'refazer',
    ]);
  });

  it('appends the closed enum and the JSON output contract to the condition', () => {
    const { pipeline, stepsByNode } = compile(gateGraph());
    const condition = check(pipeline, stepsByNode.portao![0]!).condition;
    expect(condition).toContain('=== RÓTULOS PERMITIDOS');
    expect(condition).toContain('"label"');
    expect(condition).toContain('(default)');
  });

  it('exposes $runs to the condition', () => {
    const { pipeline, stepsByNode } = compile(gateGraph());
    expect(check(pipeline, stepsByNode.portao![0]!).condition).toContain('$runs');
  });

  it('marks exactly one default outcome', () => {
    const { pipeline, stepsByNode } = compile(gateGraph());
    expect(
      check(pipeline, stepsByNode.portao![0]!).outcomes.filter((o) => o.default === true),
    ).toHaveLength(1);
  });

  it('defaults maxRuns to the compiler cap', () => {
    const { pipeline, stepsByNode } = compile(gateGraph());
    expect(check(pipeline, stepsByNode.portao![0]!).maxRuns).toBe(DEVGRAPH_CHECK_MAX_RUNS);
  });

  it('honors the node maxRuns', () => {
    const graph = gateGraph();
    (graph.nodes[2] as GateNode).maxRuns = 4;
    const { pipeline, stepsByNode } = compile(graph);
    expect(check(pipeline, stepsByNode.portao![0]!).maxRuns).toBe(4);
  });

  it('handles a gate with three arms', () => {
    const graph = graphOf(
      [
        promptNode(),
        gateNode('portao', {
          outcomes: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C' },
          ],
          defaultOutcome: 'c',
        }),
        actionNode('ra'),
        actionNode('rb'),
        actionNode('rc'),
      ],
      [
        edge('e1', 'objetivo', 'portao'),
        edge('e2', 'portao', 'ra', 'a'),
        edge('e3', 'portao', 'rb', 'b'),
        edge('e4', 'portao', 'rc', 'c'),
      ],
    );
    const { pipeline, stepsByNode } = compile(graph);
    const outcomes = check(pipeline, stepsByNode.portao![0]!).outcomes;
    expect(outcomes).toHaveLength(3);
    expect(outcomes.filter((o) => o.default).map((o) => o.label)).toEqual(['c']);
    expectValidPipeline(pipeline);
  });

  it('REFUSES a loop-back arm: an edge into an ancestor is a cycle', () => {
    // `huu-devgraph-v1` is acyclic, so a "rework" arm drawn back at an earlier
    // node cannot be expressed today. The graph validator catches it, and the
    // compiler refuses — it does NOT silently emit a forward-only pipeline.
    const graph = gateGraph();
    graph.edges = graph.edges.map((e) =>
      e.id === 'e4' ? edge('e4', 'portao', 'trabalho', 'refazer') : e,
    );
    expect(validateGraph(graph).errors.map((i) => i.code)).toContain('cycle');
    expect(() => compile(graph)).toThrow(/cycle/);
  });

  it('passes the schema + topology gate', () => {
    expectValidPipeline(compile(gateGraph()).pipeline);
  });
});

// ─────────────────────────────── the envelope ───────────────────────────────

describe('graph-to-pipeline / the pipeline envelope', () => {
  it('names the pipeline after the graph', () => {
    expect(compile(threeLensGraph()).pipeline.name).toBe('Meu método');
  });

  it('falls back to the graph id when the name is blank', () => {
    const graph = threeLensGraph();
    graph.name = '   ';
    expect(compile(graph).pipeline.name).toBe('huu Devgraph — meu-metodo');
  });

  it('uses the graph description, capped at the schema ceiling', () => {
    const graph = threeLensGraph();
    graph.description = 'x'.repeat(400);
    expect(compile(graph).pipeline.description).toHaveLength(280);
  });

  it('falls back to the objective as the description', () => {
    expect(compile(threeLensGraph()).pipeline.description).toBe(GOAL);
  });

  it('carries meta.maxNodeExecutions', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a')],
      [edge('e1', 'objetivo', 'a')],
      { maxNodeExecutions: 12 },
    );
    expect(compile(graph).pipeline.maxNodeExecutions).toBe(12);
  });

  it('defaults maxNodeExecutions to at least the huu default', () => {
    expect(compile(threeLensGraph()).pipeline.maxNodeExecutions).toBe(DEFAULT_MAX_NODE_EXECUTIONS);
  });

  it('raises the default budget above the step count of a wide graph', () => {
    const nodes: GraphNode[] = [promptNode()];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 39; i += 1) {
      nodes.push(actionNode(`n${i}`));
      edges.push(edge(`e${i}`, 'objetivo', `n${i}`));
    }
    const { pipeline } = compile(graphOf(nodes, edges));
    expect(pipeline.maxNodeExecutions!).toBeGreaterThanOrEqual(pipeline.steps.length);
  });

  it('forwards the card timeouts', () => {
    const { pipeline } = compile(threeLensGraph(), {
      cardTimeoutMs: 900_000,
      singleFileCardTimeoutMs: 300_000,
    });
    expect(pipeline.cardTimeoutMs).toBe(900_000);
    expect(pipeline.singleFileCardTimeoutMs).toBe(300_000);
  });

  it('drops a non-positive timeout instead of failing the output gate', () => {
    const { pipeline, warnings } = compile(threeLensGraph(), { cardTimeoutMs: 0 });
    expect(pipeline.cardTimeoutMs).toBeUndefined();
    expect(warnings.some((w) => w.includes('cardTimeoutMs'))).toBe(true);
  });

  it('stamps the node model, then the graph model, then the run default', () => {
    const graph = graphOf(
      [promptNode(), actionNode('a', { modelId: 'vendor/no-no' }), actionNode('b')],
      [edge('e1', 'objetivo', 'a'), edge('e2', 'objetivo', 'b')],
      { modelId: 'vendor/graph' },
    );
    const { pipeline, stepsByNode } = compile(graph, { modelId: 'vendor/run' });
    expect(work(pipeline, stepsByNode.a![0]!).modelId).toBe('vendor/no-no');
    expect(work(pipeline, stepsByNode.b![0]!).modelId).toBe('vendor/graph');
  });

  it('falls back to the run default when the graph names no model', () => {
    const { pipeline } = compile(threeLensGraph(), { modelId: 'vendor/run' });
    for (const step of pipeline.steps) expect(step.modelId).toBe('vendor/run');
  });

  it('names only steps that exist in stepsByNode', () => {
    const { pipeline, stepsByNode } = compile(fanOutGraph());
    const names = new Set(pipeline.steps.map((s) => s.name));
    for (const list of Object.values(stepsByNode)) {
      for (const name of list) expect(names.has(name)).toBe(true);
    }
    expect(Object.values(stepsByNode).flat()).toHaveLength(pipeline.steps.length);
  });

  it('omits modelId entirely when nothing names one (AppConfig stays the authority)', () => {
    const { pipeline } = compile(threeLensGraph());
    for (const step of pipeline.steps) expect(step.modelId).toBeUndefined();
  });

  it('prefixes every AGENT prompt with the project router', () => {
    const { pipeline } = compile(fanOutGraph(), { routerPrefix: ROUTER_PREFIX });
    for (const step of pipeline.steps) {
      if (step.type === 'check') continue;
      expect(step.prompt.startsWith(ROUTER_PREFIX)).toBe(true);
    }
  });

  it('leaves judge conditions unprefixed — a judge transcribes, it does not route itself', () => {
    const { pipeline } = compile(fanOutGraph(), { routerPrefix: ROUTER_PREFIX });
    for (const step of pipeline.steps) {
      if (step.type !== 'check') continue;
      expect(step.condition.startsWith(ROUTER_PREFIX)).toBe(false);
    }
  });
});

// ──────────────────────────────── methodology ───────────────────────────────

describe('graph-to-pipeline / meta.methodology', () => {
  it('narrows the declared keys to real methodologies', () => {
    const graph = graphOf([promptNode(), actionNode('a')], [edge('e1', 'objetivo', 'a')], {
      methodology: { tdd: true, standards: true },
    });
    expect(narrowGraphMethodology(graph).methodology).toEqual({ tdd: true, standards: true });
  });

  it('names the keys that are not methodologies', () => {
    const graph = graphOf([promptNode(), actionNode('a')], [edge('e1', 'objetivo', 'a')], {
      methodology: { tdd: true, inventada: true },
    });
    expect(narrowGraphMethodology(graph).unknownKeys).toEqual(['inventada']);
  });

  it('says out loud that it carries them as metadata and compiles none', () => {
    const graph = graphOf([promptNode(), actionNode('a')], [edge('e1', 'objetivo', 'a')], {
      methodology: { tdd: true },
    });
    const { warnings } = compile(graph);
    expect(warnings.some((w) => w.includes('carried as metadata'))).toBe(true);
  });

  it('changes NO step because of a methodology flag', () => {
    const plain = compile(threeLensGraph()).pipeline;
    const graph = threeLensGraph();
    graph.meta = { methodology: { tdd: true, lintGate: true, standards: true } };
    expect(JSON.stringify(compile(graph).pipeline)).toBe(JSON.stringify(plain));
  });

  it('never invents a mergeGate', () => {
    const graph = threeLensGraph();
    graph.meta = { methodology: { lintGate: true } };
    expect(compile(graph).pipeline.mergeGate).toBeUndefined();
  });
});

// ─────────────────────────── determinism & coupling ─────────────────────────

describe('graph-to-pipeline / determinism', () => {
  it('compiles the same graph to the byte-identical pipeline', () => {
    for (const graph of [threeLensGraph(), booleanGraph(), choiceGraph(), fanOutGraph()]) {
      expect(JSON.stringify(compile(graph).pipeline)).toBe(JSON.stringify(compile(graph).pipeline));
    }
  });

  it('emits the same nodeOrder and stepsByNode twice', () => {
    const graph = fanOutGraph();
    const a = compile(graph);
    const b = compile(graph);
    expect(a.nodeOrder).toEqual(b.nodeOrder);
    expect(a.stepsByNode).toEqual(b.stepsByNode);
    expect(a.warnings).toEqual(b.warnings);
  });

  it('breaks topological ties by DECLARATION order', () => {
    const graph = graphOf(
      [promptNode(), actionNode('zebra'), actionNode('alfa')],
      [edge('e1', 'objetivo', 'zebra'), edge('e2', 'objetivo', 'alfa')],
    );
    expect(compile(graph).nodeOrder).toEqual(['zebra', 'alfa']);
  });
});

describe('graph-to-pipeline / catalog coupling', () => {
  it('branches on ActionBlock FIELDS, never on a block id', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./graph-to-pipeline.ts', import.meta.url)),
      'utf8',
    );
    for (const id of blockIds()) {
      expect(source.includes(`'${id}'`), `block id "${id}" is hard-coded in the compiler`).toBe(
        false,
      );
      expect(source.includes(`"${id}"`), `block id "${id}" is hard-coded in the compiler`).toBe(
        false,
      );
    }
  });

  it('compiles EVERY catalog block without throwing', () => {
    for (const block of ACTION_BLOCKS) {
      const graph = graphOf(
        [promptNode(), actionNode('n', { block: block.id, files: ['src/a.ts'] })],
        [edge('e1', 'objetivo', 'n')],
      );
      const { pipeline } = compile(graph);
      expectValidPipeline(pipeline);
    }
  });

  it('keeps the blackboard join in lockstep with the research contract', () => {
    // `nodeDir()` is private; its observable form is the critic's findingsDir,
    // which must land beside the research artifacts of the same node.
    const graph = graphOf(
      [promptNode(), actionNode('no-x', { block: 'tdd' })],
      [edge('e1', 'objetivo', 'no-x')],
    );
    const step = compile(graph).pipeline.steps[0] as WorkStep;
    expect(step.review!.findingsDir).toBe(`${researchDir(ROOT, 'no-x')}/review`);
  });
});
