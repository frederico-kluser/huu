import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_METHODOLOGIES } from '../dev-mode/methodology-registry.js';
import { GRAPH_SAMPLES, findSample, type GraphSample } from './graph-samples.js';
import { parseDevGraph, serializeDevGraph } from './graph-schema.js';
import { readGraph, writeGraph } from './graph-store.js';
import {
  DEVGRAPH_MAX_LABEL,
  DEVGRAPH_SLUG_PATTERN,
  type ActionNode,
  type DevGraph,
  type GateNode,
  type ResearchNode,
} from './graph-types.js';
import {
  directPredecessors,
  effectiveDependencies,
  outboundEdges,
  validateGraph,
} from './graph-validate.js';
import { findBlock } from './node-catalog.js';

const NOW = '2026-08-03T12:00:00.000Z';

/**
 * The library order is served to the browser, so it is a CONTRACT: appending is
 * additive, reordering moves the user's muscle memory. This literal is the pin.
 */
const EXPECTED_SAMPLE_ORDER = [
  'tdd-seguranca-performance',
  'pesquisa-booleana',
  'pesquisa-multipla-escolha',
  'pesquisa-informativa',
  'recon-fanout',
  'portao-de-qualidade',
];

const CASES = GRAPH_SAMPLES.map((sample) => [sample.id, sample] as const);

/**
 * The footprint a node occupies on the canvas, in the same units
 * `NodePosition` uses — the estimated size of the chip the editor draws
 * (~260×100). It is an ESTIMATE on purpose: overlap is about what the human
 * sees, and two chips are unreadable long before their coordinates coincide.
 * Widen it if the chip grows; the sample layouts space nodes 360 apart
 * horizontally and at least 180 apart vertically, so they clear it with room.
 */
const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;

function sampleById(id: string): GraphSample {
  const found = findSample(id);
  if (!found) throw new Error(`sample "${id}" is missing`);
  return found;
}

function nodeById(graph: DevGraph, id: string): DevGraph['nodes'][number] {
  const found = graph.nodes.find((node) => node.id === id);
  if (!found) throw new Error(`node "${id}" is missing from "${graph.id}"`);
  return found;
}

describe('graph-samples / library', () => {
  it('ships the contracted samples, in the contracted order', () => {
    expect(GRAPH_SAMPLES.map((sample) => sample.id)).toEqual(EXPECTED_SAMPLE_ORDER);
  });

  it('ships at least the four shapes the editor has to teach', () => {
    for (const id of [
      'tdd-seguranca-performance',
      'pesquisa-booleana',
      'pesquisa-multipla-escolha',
      'pesquisa-informativa',
    ]) {
      expect(findSample(id), id).toBeDefined();
    }
  });

  it('gives every sample a slug id, unique in the library', () => {
    for (const sample of GRAPH_SAMPLES) {
      expect(DEVGRAPH_SLUG_PATTERN.test(sample.id), sample.id).toBe(true);
    }
    expect(new Set(GRAPH_SAMPLES.map((s) => s.id)).size).toBe(GRAPH_SAMPLES.length);
  });

  it('gives every sample a pt-BR name and a description that says what it teaches', () => {
    for (const sample of GRAPH_SAMPLES) {
      expect(sample.name.length, sample.id).toBeGreaterThan(0);
      expect(sample.description.length, sample.id).toBeGreaterThan(80);
    }
  });

  it('finds a sample by id and reports an unknown one as undefined', () => {
    expect(findSample('recon-fanout')?.name).toBe('Reconhecimento e leque por arquivo');
    expect(findSample('does-not-exist')).toBeUndefined();
    expect(findSample('')).toBeUndefined();
  });

  it('declares only methodology keys the registry actually has', () => {
    const known = new Set(DEV_METHODOLOGIES.map((entry) => entry.key as string));
    for (const sample of GRAPH_SAMPLES) {
      for (const key of Object.keys(sample.build(NOW).meta.methodology ?? {})) {
        expect(known.has(key), `${sample.id} → ${key}`).toBe(true);
      }
    }
  });
});

describe('graph-samples / every sample', () => {
  // THE NET. A rotten sample is the user's FIRST contact with the format, so
  // "it validates" is not a nice-to-have here — it is the reason this file
  // exists.
  it.each(CASES)('%s validates with zero errors', (_id, sample) => {
    const result = validateGraph(sample.build(NOW));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(CASES)('%s round-trips through serialize + parse unchanged', (_id, sample) => {
    const graph = sample.build(NOW);
    const parsed = parseDevGraph(JSON.parse(serializeDevGraph(graph)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.graph).toEqual(graph);
  });

  it.each(CASES)('%s is deterministic given `now`', (_id, sample) => {
    const graph = sample.build(NOW);
    expect(sample.build(NOW)).toEqual(graph);
    expect(graph.createdAt).toBe(NOW);
    expect(graph.updatedAt).toBe(NOW);
  });

  it.each(CASES)('%s falls back to the clock when `now` is omitted', (_id, sample) => {
    const before = Date.now();
    const graph = sample.build();
    expect(Number.isNaN(Date.parse(graph.createdAt))).toBe(false);
    expect(Date.parse(graph.updatedAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it.each(CASES)('%s says the same thing in the library and in the file', (_id, sample) => {
    const graph = sample.build(NOW);
    expect(graph.id).toBe(sample.id);
    expect(graph.name).toBe(sample.name);
    expect(graph.description).toBe(sample.description);
  });

  it.each(CASES)('%s uses only blocks that exist in the catalog today', (_id, sample) => {
    for (const node of sample.build(NOW).nodes) {
      if (node.kind !== 'action') continue;
      expect(findBlock(node.block), `${sample.id} → ${node.id}`).toBeDefined();
    }
  });

  it.each(CASES)('%s lays out on a canvas without overlapping', (_id, sample) => {
    const graph = sample.build(NOW);
    const placed: { id: string; x: number; y: number }[] = [];
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.position.x), node.id).toBe(true);
      expect(Number.isFinite(node.position.y), node.id).toBe(true);
      const { x, y } = node.position;
      // BOUNDING BOX, not coordinate equality. Two chips 20px apart do not
      // share a coordinate and still cover each other on screen, so an exact
      // `x:y` comparison passes a layout the user cannot read.
      for (const other of placed) {
        const overlaps =
          Math.abs(x - other.x) < NODE_WIDTH && Math.abs(y - other.y) < NODE_HEIGHT;
        expect(overlaps, `${sample.id} → ${node.id} overlaps ${other.id}`).toBe(false);
      }
      placed.push({ id: node.id, x, y });
    }
    // The root is the leftmost thing on the canvas — a method reads left to right.
    const root = graph.nodes.find((node) => node.kind === 'prompt');
    const leftmost = Math.min(...graph.nodes.map((node) => node.position.x));
    expect(root?.position.x).toBe(leftmost);
  });

  it.each(CASES)('%s keeps every label inside the chip', (_id, sample) => {
    for (const node of sample.build(NOW).nodes) {
      expect(node.label.length, `${sample.id} → ${node.id}`).toBeLessThanOrEqual(
        DEVGRAPH_MAX_LABEL,
      );
      expect(node.label.length, `${sample.id} → ${node.id}`).toBeGreaterThan(0);
    }
  });

  it.each(CASES)('%s has exactly one entry and at least one ending', (_id, sample) => {
    const graph = sample.build(NOW);
    expect(graph.nodes.filter((node) => node.kind === 'prompt')).toHaveLength(1);
    expect(graph.nodes.some((node) => outboundEdges(graph, node.id).length === 0)).toBe(true);
  });

  it.each(CASES)('%s survives a save/load through the store', (_id, sample) => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'huu-graph-samples-'));
    try {
      const graph = sample.build(NOW);
      const saved = writeGraph(repoRoot, graph, NOW);
      expect(saved.ok, sample.id).toBe(true);
      const reloaded = readGraph(repoRoot, sample.id);
      expect(reloaded.ok, sample.id).toBe(true);
      if (!reloaded.ok) return;
      expect(reloaded.graph).toEqual(graph);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('warns only where a warning is the point', () => {
    // Warnings are legitimate things a human may mean, but an UNEXPLAINED one
    // in a worked example teaches the wrong lesson. Exactly one sample carries
    // one, and its description is what justifies it.
    const warned = GRAPH_SAMPLES.map(
      (sample) => [sample.id, validateGraph(sample.build(NOW)).warnings.map((w) => w.code)] as const,
    ).filter(([, codes]) => codes.length > 0);
    expect(warned).toEqual([['tdd-seguranca-performance', ['join-subset-drops-barrier']]]);
  });
});

describe('graph-samples / tdd-seguranca-performance', () => {
  const graph = sampleById('tdd-seguranca-performance').build(NOW);

  it('fires the three fronts in parallel, straight from the prompt', () => {
    expect(outboundEdges(graph, 'entrada').map((edge) => edge.target)).toEqual([
      'tdd',
      'seguranca',
      'performance',
    ]);
    // Parallel means no arm is named: only a branching node routes.
    for (const edge of outboundEdges(graph, 'entrada')) {
      expect(edge.sourceOutcome).toBeUndefined();
    }
  });

  it('keeps the three connections drawn but depends only on the performance one', () => {
    expect(directPredecessors(graph, 'consolidar')).toEqual(['tdd', 'seguranca', 'performance']);
    expect(effectiveDependencies(graph, 'consolidar')).toEqual(['performance']);
  });

  it('says out loud that the relaxed join is a dependency, not the merge barrier', () => {
    const description = sampleById('tdd-seguranca-performance').description;
    expect(description).toContain('DEPENDÊNCIA');
    expect(description).toContain('merge');
  });
});

describe('graph-samples / pesquisa-booleana', () => {
  const graph = sampleById('pesquisa-booleana').build(NOW);
  const research = nodeById(graph, 'ha-testes') as ResearchNode;

  it('asks a yes/no question grounded in the repository', () => {
    expect(research.kind).toBe('research');
    expect(research.outputKind).toBe('boolean');
    expect(research.useContext).toBe(true);
  });

  it('wires BOTH arms, each to a different node', () => {
    const arms = outboundEdges(graph, 'ha-testes');
    expect(arms.map((edge) => edge.sourceOutcome)).toEqual(['yes', 'no']);
    expect(new Set(arms.map((edge) => edge.target)).size).toBe(2);
  });

  it('declares the safe route explicitly', () => {
    expect(research.defaultOutcome).toBe('no');
  });
});

describe('graph-samples / pesquisa-multipla-escolha', () => {
  const graph = sampleById('pesquisa-multipla-escolha').build(NOW);
  const research = nodeById(graph, 'natureza') as ResearchNode;

  it('offers three options, each with its own destination', () => {
    expect(research.outputKind).toBe('choice');
    expect(research.choices?.map((choice) => choice.id)).toEqual([
      'defeito',
      'melhoria',
      'documentacao',
    ]);
    const arms = outboundEdges(graph, 'natureza');
    expect(arms.map((edge) => edge.sourceOutcome)).toEqual(['defeito', 'melhoria', 'documentacao']);
    expect(new Set(arms.map((edge) => edge.target)).size).toBe(3);
  });

  it('defaults to the option that does not touch production code', () => {
    expect(research.defaultOutcome).toBe('documentacao');
    const target = outboundEdges(graph, 'natureza').find(
      (edge) => edge.sourceOutcome === 'documentacao',
    )?.target;
    expect((nodeById(graph, target ?? '') as ActionNode).block).toBe('docs');
  });
});

describe('graph-samples / pesquisa-informativa', () => {
  const graph = sampleById('pesquisa-informativa').build(NOW);
  const research = nodeById(graph, 'convencoes') as ResearchNode;

  it('answers into the context instead of routing', () => {
    expect(research.outputKind).toBe('info');
    expect(research.useContext).toBe(true);
    expect(research.defaultOutcome).toBeUndefined();
  });

  it('continues through exactly one unnamed edge', () => {
    const out = outboundEdges(graph, 'convencoes');
    expect(out).toHaveLength(1);
    expect(out[0]?.sourceOutcome).toBeUndefined();
    expect(out[0]?.target).toBe('implementar');
  });
});

describe('graph-samples / recon-fanout', () => {
  const graph = sampleById('recon-fanout').build(NOW);
  const fanOut = nodeById(graph, 'gerar-testes') as ActionNode;

  it('fans out from a block that actually produces a target list', () => {
    expect(fanOut.scope).toBe('memory');
    expect(fanOut.fanOutFrom).toBe('mapear-alvos');
    const producer = nodeById(graph, 'mapear-alvos') as ActionNode;
    expect(findBlock(producer.block)?.produces).toBe(true);
  });

  it('underwrites the width of the fan-out', () => {
    expect(fanOut.maxFiles).toBe(8);
  });
});

describe('graph-samples / portao-de-qualidade', () => {
  const graph = sampleById('portao-de-qualidade').build(NOW);
  const gate = nodeById(graph, 'portao') as GateNode;

  it('routes each outcome to exactly one node', () => {
    expect(gate.outcomes.map((outcome) => outcome.id)).toEqual(['approved', 'rejected']);
    const arms = outboundEdges(graph, 'portao');
    expect(arms.map((edge) => edge.sourceOutcome)).toEqual(['approved', 'rejected']);
    expect(new Set(arms.map((edge) => edge.target)).size).toBe(2);
  });

  it('keeps one outcome as the forward default, huu-style', () => {
    expect(gate.defaultOutcome).toBe('approved');
    expect(gate.outcomes.some((outcome) => outcome.id === gate.defaultOutcome)).toBe(true);
  });

  it('states a condition a judge can check mechanically', () => {
    expect(gate.condition).toContain('exit zero');
  });
});
