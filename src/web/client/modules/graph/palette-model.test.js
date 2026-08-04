import { describe, expect, it } from 'vitest';
import {
  addNode,
  connect,
  edgesOf,
  emptyGraph,
  nodeById,
  nodesOf,
  outboundEdges,
} from './graph-model.js';
import {
  applyPaletteChoice,
  groupOfBlock,
  groupPalette,
  paletteFor,
  PALETTE_GROUPS,
} from './palette-model.js';

const NOW = '2026-01-01T00:00:00.000Z';

/**
 * A stand-in for `GET /api/graphs/catalog`.
 *
 * Deliberately NOT the real catalog: two of these blocks do not exist
 * (`ghost-audit`, `ghost-writer`) and the node-kind labels are wrong on
 * purpose. Every assertion below reads what THIS object says, which is how the
 * suite proves the client carries no copy of the block library — the palette
 * can only ever show what the server served.
 */
const CATALOG = {
  blocks: [
    { id: 'recon', label: 'Reconhecimento', description: 'Escreve a lista de alvos.', produces: true, readOnly: false },
    { id: 'implement', label: 'Implementar', description: 'Executa a mudança.', produces: false, readOnly: false },
    { id: 'security-review', label: 'Revisão de segurança', description: 'Só relata.', produces: false, readOnly: true },
    { id: 'ghost-audit', label: 'Auditoria fantasma', description: 'Um bloco que só existe neste teste.', produces: false, readOnly: true },
    { id: 'ghost-writer', label: 'Escritor fantasma', description: 'Outro que só existe aqui.', produces: false, readOnly: false },
    { id: 'security-findings', label: 'Achados de segurança', description: 'Uma tarefa por achado.', produces: true, readOnly: false },
  ],
  kinds: [
    { kind: 'prompt', label: 'Entrada do prompt', description: 'A raiz.' },
    { kind: 'action', label: 'Ação', description: 'Um bloco de trabalho.' },
    { kind: 'research', label: 'Pesquisar na internet', description: 'Uma pergunta respondida antes.' },
    { kind: 'gate', label: 'Portão', description: 'Um juiz decide por onde segue.' },
  ],
};

function rooted() {
  const graph = emptyGraph('g', 'G', NOW);
  return { graph, root: graph.nodes[0].id };
}

/** A graph with a gate whose arms are `approved` / `rework`. */
function withGate() {
  let graph = emptyGraph('g', 'G', NOW);
  const root = graph.nodes[0].id;
  const gate = addNode(graph, 'gate', { label: 'Passou?' });
  graph = connect(gate.graph, root, gate.nodeId).graph;
  return { graph, root, gateId: gate.nodeId };
}

describe('groupOfBlock — the bucket comes from the FIELDS, never from a list of ids', () => {
  it('files a block that writes a list under the producers', () => {
    expect(groupOfBlock({ id: 'recon', produces: true, readOnly: false })).toBe(PALETTE_GROUPS.produce);
    expect(groupOfBlock({ id: 'security-findings', produces: true, readOnly: false })).toBe(
      PALETTE_GROUPS.produce,
    );
  });

  it('files a read-only block under the audits', () => {
    expect(groupOfBlock({ id: 'whatever', produces: false, readOnly: true })).toBe(PALETTE_GROUPS.audit);
  });

  it('files everything else under the writers', () => {
    expect(groupOfBlock({ id: 'implement', produces: false, readOnly: false })).toBe(PALETTE_GROUPS.code);
    expect(groupOfBlock({})).toBe(PALETTE_GROUPS.code);
    expect(groupOfBlock(null)).toBe(PALETTE_GROUPS.code);
  });

  it('files a block invented AFTER this file was written, with no edit here', () => {
    expect(groupOfBlock({ id: 'a-block-from-2027', produces: true })).toBe(PALETTE_GROUPS.produce);
    expect(groupOfBlock({ id: 'another-one', readOnly: true })).toBe(PALETTE_GROUPS.audit);
  });
});

describe('paletteFor', () => {
  it('offers exactly what the catalog served, in catalog order', () => {
    const { graph, root } = rooted();
    const items = paletteFor(graph, root, null, CATALOG);
    expect(items.filter((i) => i.kind === 'action').map((i) => i.id)).toEqual(
      CATALOG.blocks.map((b) => b.id),
    );
    expect(items.find((i) => i.id === 'ghost-audit').label).toBe('Auditoria fantasma');
  });

  it('carries an EMPTY palette with no catalog — nothing about the library is embedded here', () => {
    const { graph, root } = rooted();
    expect(paletteFor(graph, root, null, undefined)).toEqual([]);
    expect(paletteFor(graph, root, null, {})).toEqual([]);
    expect(paletteFor(graph, root, null, { blocks: 'not-a-list' })).toEqual([]);
  });

  it('offers the two DRAWABLE node kinds, with the labels the server chose', () => {
    const { graph, root } = rooted();
    const kinds = paletteFor(graph, root, null, CATALOG).filter((i) => i.kind !== 'action');
    expect(kinds.map((i) => i.id)).toEqual(['research', 'gate']);
    expect(kinds.map((i) => i.label)).toEqual(['Pesquisar na internet', 'Portão']);
    expect(kinds.every((i) => i.group === PALETTE_GROUPS.kinds)).toBe(true);
  });

  it('never offers the root: the prompt takes no inbound edge, and `action` is its blocks', () => {
    const { graph, root } = rooted();
    const items = paletteFor(graph, root, null, CATALOG);
    expect(items.some((i) => i.id === 'prompt')).toBe(false);
    expect(items.filter((i) => i.id === 'action')).toEqual([]);
  });

  it('returns nothing at all when the bolinha belongs to no node', () => {
    const { graph } = rooted();
    expect(paletteFor(graph, 'ghost', null, CATALOG)).toEqual([]);
  });

  it('stays open on a node with ONE way out, however many nodes already hang off it', () => {
    let { graph, root } = rooted();
    for (let i = 0; i < 3; i += 1) {
      const added = addNode(graph, 'action', {});
      graph = connect(added.graph, root, added.nodeId).graph;
    }
    expect(paletteFor(graph, root, null, CATALOG).every((i) => !i.disabled)).toBe(true);
  });
});

describe('paletteFor — a branching source', () => {
  it('asks WHICH arm before it offers anything', () => {
    const { graph, gateId } = withGate();
    const items = paletteFor(graph, gateId, null, CATALOG);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.disabled === true)).toBe(true);
    expect(items[0].code).toBe('edge-outcome-required');
  });

  it('opens once an arm is named', () => {
    const { graph, gateId } = withGate();
    expect(paletteFor(graph, gateId, 'approved', CATALOG).every((i) => !i.disabled)).toBe(true);
  });

  it('greys the whole palette on an arm that already routes, and teaches the way around', () => {
    const { graph, gateId } = withGate();
    const added = addNode(graph, 'action', { label: 'Documentar' });
    const linked = connect(added.graph, gateId, added.nodeId, { sourceOutcome: 'approved' }).graph;
    const items = paletteFor(linked, gateId, 'approved', CATALOG);
    expect(items.every((i) => i.disabled === true)).toBe(true);
    expect(items[0].code).toBe('branch-outcome-multiple-edges');
    expect(items[0].reason).toContain('ligue este braço a UM bloco e ramifique a partir dele');
    // The OTHER arm is untouched — one busy arm never closes the node.
    expect(paletteFor(linked, gateId, 'rework', CATALOG).every((i) => !i.disabled)).toBe(true);
  });

  it('greys an arm the node never declared', () => {
    const { graph, gateId } = withGate();
    const items = paletteFor(graph, gateId, 'maybe', CATALOG);
    expect(items[0].code).toBe('edge-outcome-unknown');
  });

  it('greys an arm named on a node that does not branch', () => {
    const { graph, root } = rooted();
    const items = paletteFor(graph, root, 'approved', CATALOG);
    expect(items[0].code).toBe('edge-outcome-forbidden');
  });

  it('treats a boolean research node as branching, on the contract ids', () => {
    let { graph, root } = rooted();
    const added = addNode(graph, 'research', { outputKind: 'boolean', defaultOutcome: 'no' });
    graph = connect(added.graph, root, added.nodeId).graph;
    expect(paletteFor(graph, added.nodeId, null, CATALOG)[0].code).toBe('edge-outcome-required');
    expect(paletteFor(graph, added.nodeId, 'yes', CATALOG).every((i) => !i.disabled)).toBe(true);
    expect(paletteFor(graph, added.nodeId, 'no', CATALOG).every((i) => !i.disabled)).toBe(true);
    expect(paletteFor(graph, added.nodeId, 'sim', CATALOG)[0].code).toBe('edge-outcome-unknown');
  });

  it('treats an n-way research node as branching on ITS choices', () => {
    let { graph, root } = rooted();
    const added = addNode(graph, 'research', {
      outputKind: 'choice',
      choices: [{ id: 'rest', label: 'REST' }, { id: 'grpc', label: 'gRPC' }],
      defaultOutcome: 'rest',
    });
    graph = connect(added.graph, root, added.nodeId).graph;
    expect(paletteFor(graph, added.nodeId, 'grpc', CATALOG).every((i) => !i.disabled)).toBe(true);
    expect(paletteFor(graph, added.nodeId, 'yes', CATALOG)[0].code).toBe('edge-outcome-unknown');
  });

  it('treats an `info` research node as a node with one way out', () => {
    let { graph, root } = rooted();
    const added = addNode(graph, 'research', {});
    graph = connect(added.graph, root, added.nodeId).graph;
    expect(paletteFor(graph, added.nodeId, null, CATALOG).every((i) => !i.disabled)).toBe(true);
  });
});

describe('paletteFor — the caps', () => {
  it('greys everything once the graph is full of nodes', () => {
    const { graph, root } = rooted();
    const items = paletteFor(graph, root, null, { ...CATALOG, caps: { maxNodes: 1, maxEdges: 80 } });
    expect(items.every((i) => i.disabled === true)).toBe(true);
    expect(items[0].code).toBe('too-many-nodes');
  });

  it('greys everything once the graph is full of edges', () => {
    let { graph, root } = rooted();
    const added = addNode(graph, 'action', {});
    graph = connect(added.graph, root, added.nodeId).graph;
    const items = paletteFor(graph, root, null, { ...CATALOG, caps: { maxNodes: 40, maxEdges: 1 } });
    expect(items[0].code).toBe('too-many-edges');
  });
});

describe('groupPalette', () => {
  it('buckets into sections in FIRST-APPEARANCE order, so the catalog decides the layout', () => {
    const { graph, root } = rooted();
    const groups = groupPalette(paletteFor(graph, root, null, CATALOG));
    expect(groups.map((g) => g.group)).toEqual([
      PALETTE_GROUPS.produce,
      PALETTE_GROUPS.code,
      PALETTE_GROUPS.audit,
      PALETTE_GROUPS.kinds,
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['recon', 'security-findings']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['implement', 'ghost-writer']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['security-review', 'ghost-audit']);
    expect(groups[3].items.map((i) => i.id)).toEqual(['research', 'gate']);
  });

  it('loses nothing and survives junk', () => {
    const { graph, root } = rooted();
    const items = paletteFor(graph, root, null, CATALOG);
    const total = groupPalette(items).reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(items.length);
    expect(groupPalette([null, undefined, 1])).toEqual([]);
    expect(groupPalette(null)).toEqual([]);
  });
});

describe('applyPaletteChoice', () => {
  it('creates the node ALREADY CONNECTED, in one move', () => {
    const { graph, root } = rooted();
    const item = paletteFor(graph, root, null, CATALOG).find((i) => i.id === 'implement');
    const result = applyPaletteChoice(graph, root, null, item);
    expect(result.error).toBeUndefined();
    expect(nodesOf(result.graph)).toHaveLength(2);
    expect(nodeById(result.graph, result.nodeId)).toMatchObject({
      kind: 'action',
      block: 'implement',
      label: 'Implementar',
    });
    expect(edgesOf(result.graph)).toEqual([
      { id: result.edgeId, source: root, target: result.nodeId },
    ]);
  });

  it('never touches the graph it was given', () => {
    const { graph, root } = rooted();
    const before = JSON.stringify(graph);
    applyPaletteChoice(graph, root, null, { kind: 'action', id: 'implement', label: 'Implementar' });
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('drops the node kinds as themselves, with the catalog’s label', () => {
    const { graph, root } = rooted();
    const items = paletteFor(graph, root, null, CATALOG);
    const research = applyPaletteChoice(graph, root, null, items.find((i) => i.id === 'research'));
    expect(nodeById(research.graph, research.nodeId)).toMatchObject({
      kind: 'research',
      label: 'Pesquisar na internet',
    });
    const gate = applyPaletteChoice(graph, root, null, items.find((i) => i.id === 'gate'));
    expect(nodeById(gate.graph, gate.nodeId)).toMatchObject({ kind: 'gate', label: 'Portão' });
    expect(nodeById(gate.graph, gate.nodeId).defaultOutcome).toBe('approved');
  });

  it('hangs the new node off the named arm of a branching source', () => {
    const { graph, gateId } = withGate();
    const result = applyPaletteChoice(graph, gateId, 'approved', {
      kind: 'action',
      id: 'implement',
      label: 'Implementar',
    });
    expect(result.error).toBeUndefined();
    const edge = edgesOf(result.graph).find((e) => e.id === result.edgeId);
    expect(edge.sourceOutcome).toBe('approved');
    expect(edge.rework).toBeUndefined();
  });

  it('is ATOMIC: a refused connection leaves no node behind', () => {
    const { graph, gateId } = withGate();
    const before = nodesOf(graph).length;
    const result = applyPaletteChoice(graph, gateId, null, {
      kind: 'action',
      id: 'implement',
      label: 'Implementar',
    });
    expect(result.error.code).toBe('edge-outcome-required');
    expect(result.graph).toBe(graph);
    expect(nodesOf(result.graph)).toHaveLength(before);
    expect(result.nodeId).toBeUndefined();
  });

  it('fans siblings into their own lanes when no position is given', () => {
    let { graph, root } = rooted();
    const item = { kind: 'action', id: 'implement', label: 'Implementar' };
    const spots = [];
    for (let i = 0; i < 3; i += 1) {
      const result = applyPaletteChoice(graph, root, null, item);
      graph = result.graph;
      spots.push(nodeById(graph, result.nodeId).position);
    }
    expect(spots).toEqual([
      { x: 280, y: 0 },
      { x: 280, y: 140 },
      { x: 280, y: 280 },
    ]);
    expect(outboundEdges(graph, root)).toHaveLength(3);
  });

  it('honours an explicit position — the human dropped it somewhere', () => {
    const { graph, root } = rooted();
    const result = applyPaletteChoice(
      graph,
      root,
      null,
      { kind: 'action', id: 'implement', label: 'Implementar' },
      { x: -40, y: 900 },
    );
    expect(nodeById(result.graph, result.nodeId).position).toEqual({ x: -40, y: 900 });
  });

  it('accepts a bare id as a convenience, falling back to the generic label', () => {
    const { graph, root } = rooted();
    const block = applyPaletteChoice(graph, root, null, 'implement');
    expect(nodeById(block.graph, block.nodeId)).toMatchObject({ kind: 'action', block: 'implement', label: 'Ação' });
    const gate = applyPaletteChoice(graph, root, null, 'gate');
    expect(nodeById(gate.graph, gate.nodeId).kind).toBe('gate');
  });

  it('refuses an unreadable choice without changing anything', () => {
    const { graph, root } = rooted();
    for (const bad of [null, undefined, '', {}, { kind: 'wormhole' }, 42]) {
      const result = applyPaletteChoice(graph, root, null, bad);
      expect(result.error.code).toBe('invalid-palette-choice');
      expect(result.graph).toBe(graph);
    }
  });

  it('passes a rework choice through as the arm that goes back', () => {
    let { graph, root, gateId } = withGate();
    const work = addNode(graph, 'action', { label: 'Implementar' });
    graph = connect(work.graph, root, work.nodeId).graph;
    // The gate must run after the work for a route back to be backwards.
    graph = connect(graph, work.nodeId, gateId).graph;
    const forward = applyPaletteChoice(graph, gateId, 'approved', {
      kind: 'action',
      id: 'implement',
      label: 'Seguir',
    });
    expect(forward.error).toBeUndefined();
    const denied = applyPaletteChoice(forward.graph, gateId, 'rework', {
      kind: 'action',
      id: 'implement',
      label: 'Refazer',
      rework: true,
    });
    // A rework arm points at a node that ALREADY RAN; a brand-new node never
    // has, so the palette can only ever draw the forward arm.
    expect(denied.error.code).toBe('rework-edge-not-backward');
  });
});
