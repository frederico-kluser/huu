// @vitest-environment jsdom
/* huu web UI — the inspector, mounted FOR REAL.
   ============================================

   THE CLAIM UNDER TEST is the user's own sentence: "se for uma pesquisa para
   definir uma afirmação então selecionamos que é booleana e conseguimos
   cadastrar comportamentos de sim e não na saída dela; se for de múltipla
   escolha podemos definir comportamentos para a saída; se for informativo não
   definimos nada e ela entra como contexto na próxima etapa." Every group below
   drives that through the DOM of the real component, over the injected seams
   (`graphApi`, `toast`, `initialGraph`, `debounceMs`) the canvas already
   exposes. Nothing is monkey-patched and no graph rule is re-implemented here:
   the assertions read the DEVGRAPH the component reports through
   `onGraphChange`, which is the only thing that gets saved and compiled.

   WHY THE REAL MOUNT NEEDS THE `flush()` DANCE: the vendored bundle is a
   PRODUCTION React build, so `React.act` refuses to run ("act(...) is not
   supported in production builds of React"). Updates are flushed by yielding to
   the scheduler's macrotasks, which is why every interaction is followed by an
   `await`.

   WHAT THIS SUITE CANNOT SEE, stated once so no reader assumes otherwise —
   jsdom has NO LAYOUT. Every element measures 0×0, React Flow marks the nodes
   `visibility: hidden` because it never measured them, and no edge PATH is ever
   computed. So this file proves the MODEL and the CHROME — which nodes, edges,
   arms, defaults and fields exist after an interaction, and what the UI refuses
   — and proves NOTHING about:

     • handle geometry (where an arm's dot actually lands on the card);
     • edge routing (the `rework` arm's dashed path, its arrowhead, its label
       position — only the `className` that selects that styling is observable);
     • pan/zoom, `fitView`, and therefore whether any of this is on screen;
     • popover anchoring (the palette's clamped `left/top` is computed from a
       viewport jsdom reports as a constant 1024×768);
     • that the inspector's column scrolls rather than clipping, or that the
       compile panel does not cover the node it just painted red.

   Those need a real browser. What is here is everything that survives without
   one, which is the whole decision surface. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { messagesFor } from '../../../../lib/i18n/index.js';
import { ACTION_BLOCKS, NODE_KINDS } from '../../../../lib/dev-graph/node-catalog.js';
import { setCatalog } from '../../i18n.js';
import { mountGraphCanvas } from './canvas.js';
import {
  armIdIssue,
  armsAfterOutputKind,
  edgesDroppedBy,
  fanOutCandidates,
  reworkTargets,
  slugifyOutcomeId,
} from './inspector.js';
import { addNode, connect, edgesOf, emptyGraph, nodeById, nodesOf } from './graph-model.js';

/* The catalog is the SERVER's own declaration surface, imported rather than
   re-typed — a hand-written fixture would let this suite pass while the editor
   disagreed with what actually runs. */
const CATALOG = {
  blocks: ACTION_BLOCKS,
  kinds: NODE_KINDS,
  methodologies: [],
  samples: [],
};

const STAMP = '2026-01-01T00:00:00.000Z';

/** Yield to React's scheduler (MessageChannel) and to the pending timers. */
async function flush(rounds = 14) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 6));
  }
}

function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * Type into a controlled field.
 *
 * `el.value = x` alone does NOT work: React 18 installs its own `value` setter
 * on the element to track changes, so a direct assignment updates the DOM behind
 * the tracker's back and the synthetic `change` never reaches the handler.
 * Calling the PROTOTYPE's setter is what keeps the tracker in step.
 */
function typeInto(el, value) {
  const proto =
    el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Same trick for a `<select>`, whose tracked property is also `value`. */
function pick(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** @returns {any} the element, typed loose — this file runs under `checkJs`. */
function q(root, selector) {
  return root.querySelector(selector);
}

/** @returns {any[]} */
function qa(root, selector) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Mount the real canvas over a fake transport.
 *
 * `latest.graph` is the devgraph the component currently holds, reported through
 * its own `onGraphChange` seam — the assertions read the TRUTH, never the
 * drawing derived from it. `ops` records the wire calls IN ORDER, which is the
 * only way to prove the rename is `remove` THEN `save`.
 */
function mount(initialGraph, options = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const toasts = [];
  const ops = [];
  const latest = { graph: initialGraph };

  const graphApi = {
    async catalog() {
      ops.push({ op: 'catalog' });
      return CATALOG;
    },
    async validate(doc) {
      ops.push({ op: 'validate' });
      return options.validate ? options.validate(doc) : { ok: true, errors: [], warnings: [] };
    },
    async save(doc, dir) {
      ops.push({ op: 'save', id: doc && doc.id, dir });
      if (options.save) return options.save(doc);
      return { ok: true, graph: doc };
    },
    async remove(id, dir) {
      ops.push({ op: 'remove', id, dir });
      if (options.remove) return options.remove(id);
      return { ok: true };
    },
    async list(dir) {
      ops.push({ op: 'list', dir });
      return { graphs: options.graphs || [] };
    },
    async read(id) {
      ops.push({ op: 'read', id });
      if (options.read) return options.read(id);
      return { graph: emptyGraph(id, `Método ${id}`, STAMP) };
    },
    async compile(doc) {
      ops.push({ op: 'compile' });
      return options.compile
        ? options.compile(doc)
        : { ok: true, pipeline: { name: 'x', steps: [] }, warnings: [] };
    },
    async fromSample() {
      ops.push({ op: 'fromSample' });
      return { ok: true, graph: emptyGraph('sample', 'Sample', STAMP) };
    },
  };

  const mounted = mountGraphCanvas(host, {
    graphApi,
    dir: '',
    samples: options.samples || [],
    initialGraph,
    debounceMs: 5,
    toast: (message, isErr) => toasts.push({ message, isErr: !!isErr }),
    onGraphChange: (doc) => {
      latest.graph = doc;
    },
  });

  return { host, mounted, toasts, ops, latest };
}

const mounts = [];

function track(ctx) {
  mounts.push(ctx);
  return ctx;
}

beforeEach(() => {
  // The REAL catalog, so a key the inspector renders but nobody translated
  // makes this suite throw instead of silently showing a fake string.
  setCatalog({
    locale: 'en',
    defaultLocale: 'en',
    locales: [{ id: 'en', label: 'English' }],
    messages: messagesFor('en'),
  });
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

afterEach(() => {
  for (const ctx of mounts.splice(0)) {
    ctx.mounted.unmount();
    ctx.host.remove();
  }
  document.body.innerHTML = '';
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

function seedGraph() {
  return emptyGraph('teste', 'Teste', STAMP);
}

/** prompt → research (which opens as `info`, the schema's own default). */
function researchGraph() {
  const added = addNode(seedGraph(), 'research', { position: { x: 300, y: 0 } });
  const linked = connect(added.graph, 'prompt-1', added.nodeId, {});
  expect(linked.error).toBeUndefined();
  return { graph: linked.graph, id: added.nodeId };
}

/** prompt → tdd → gate, so a gate has both arms and an ancestor to go back to. */
function gateGraph() {
  const work = addNode(seedGraph(), 'action', { block: 'tdd', position: { x: 300, y: 0 } });
  let graph = connect(work.graph, 'prompt-1', work.nodeId, {}).graph;
  const gate = addNode(graph, 'gate', { position: { x: 600, y: 0 } });
  graph = connect(gate.graph, work.nodeId, gate.nodeId, {}).graph;
  return { graph, workId: work.nodeId, gateId: gate.nodeId };
}

/** prompt → recon (a producer) → implement, plus a producer OFF that path. */
function fanOutGraph() {
  const recon = addNode(seedGraph(), 'action', { block: 'recon', position: { x: 300, y: 0 } });
  let graph = connect(recon.graph, 'prompt-1', recon.nodeId, {}).graph;
  const work = addNode(graph, 'action', { block: 'implement', position: { x: 600, y: 0 } });
  graph = connect(work.graph, recon.nodeId, work.nodeId, {}).graph;
  const other = addNode(graph, 'action', { block: 'recon', position: { x: 300, y: 200 } });
  graph = connect(other.graph, 'prompt-1', other.nodeId, {}).graph;
  return { graph, reconId: recon.nodeId, workId: work.nodeId, strayId: other.nodeId };
}

async function selectNode(ctx, nodeId) {
  click(q(ctx.host, `.gph-node[data-node-id="${nodeId}"]`));
  await flush();
}

/** Open a research/gate node's inspector. */
async function openResearch() {
  const { graph, id } = researchGraph();
  const ctx = track(mount(graph));
  await flush();
  await selectNode(ctx, id);
  return { ctx, id };
}

function kindButton(host, kind) {
  return q(host, `.gph-seg__btn[data-kind="${kind}"]`);
}

function armRow(host, arm) {
  return q(host, `.gph-armrow[data-arm="${arm}"]`);
}

function outbound(graph, nodeId) {
  return edgesOf(graph).filter((edge) => edge.source === nodeId);
}

/* ══════════════════════════════════════════════════════════════════════════
   THE PURE HALF — helpers that answer questions about a graph without a DOM.
   ══════════════════════════════════════════════════════════════════════════ */

describe('inspector helpers — the questions, asked of graph-model', () => {
  it('slugifies a label into the id the compiler will route on', () => {
    expect(slugifyOutcomeId('Precisa de migração')).toBe('precisa-de-migracao');
    expect(slugifyOutcomeId('  SIM  ')).toBe('sim');
    expect(slugifyOutcomeId('Não')).toBe('nao');
  });

  it('returns nothing for a label that leaves no slug behind', () => {
    // `invalid-outcome-id` exists because the compiler sanitizes silently: an
    // arm called "!!!" would route to nowhere with no error the human can see.
    expect(slugifyOutcomeId('!!!')).toBe('');
    expect(slugifyOutcomeId('')).toBe('');
    expect(slugifyOutcomeId(undefined)).toBe('');
  });

  it('refuses an id the node already declares instead of suffixing it', () => {
    const arms = [{ id: 'sim', label: 'Sim' }];
    expect(armIdIssue(arms, 'sim')).toBe('taken');
    expect(armIdIssue(arms, 'nao')).toBeNull();
    expect(armIdIssue(arms, '')).toBe('invalid');
  });

  it('asks outcomesOf what the arms WOULD be after a switch', () => {
    const { graph, id } = researchGraph();
    const node = nodeById(graph, id);
    expect(armsAfterOutputKind(node, 'boolean', CATALOG).map((a) => a.id)).toEqual(['yes', 'no']);
    // Switching TO choice starts EMPTY — a seeded placeholder would put words
    // in the human's method that nobody underwrote.
    expect(armsAfterOutputKind(node, 'choice', CATALOG)).toEqual([]);
    // `null` and `[]` are different statements: `info` has ONE way out.
    expect(armsAfterOutputKind(node, 'info', CATALOG)).toBeNull();
  });

  it('counts the edges a switch would invalidate, and only those', () => {
    let graph = researchGraph().graph;
    const id = researchGraph().id;
    graph = { ...graph };
    const boolean = armsAfterOutputKind(nodeById(graph, id), 'boolean', CATALOG);
    // The plain edge that reaches the research node leaves prompt-1, not it.
    expect(edgesDroppedBy(graph, id, boolean)).toEqual([]);
  });

  it('offers a fan-out only from an ancestor whose block produces a list', () => {
    const { graph, workId, reconId, strayId } = fanOutGraph();
    const ids = fanOutCandidates(graph, nodeById(graph, workId), CATALOG).map((n) => n.id);
    expect(ids).toEqual([reconId]);
    // The second producer runs in a PARALLEL branch, so it is not an ancestor
    // (`fanout-source-not-ancestor`) and never appears.
    expect(ids).not.toContain(strayId);
    // And a non-producer ancestor is not offered either (`...-not-producer`).
    expect(fanOutCandidates(graph, nodeById(graph, reconId), CATALOG).map((n) => n.id)).toEqual([]);
  });

  it('offers a rework target only among the nodes that already ran', () => {
    const { graph, gateId, workId } = gateGraph();
    expect(reworkTargets(graph, gateId).map((n) => n.id).sort()).toEqual(
      ['prompt-1', workId].sort(),
    );
    expect(reworkTargets(graph, 'prompt-1')).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE REQUEST, PART 1 — "se for informativo não definimos nada e ela entra
   como contexto na próxima etapa".
   ══════════════════════════════════════════════════════════════════════════ */

describe('research — informative: nothing to configure, it becomes context', () => {
  it('opens as informative, which is what the schema seeds', async () => {
    const { ctx, id } = await openResearch();
    expect(nodeById(ctx.latest.graph, id).outputKind).toBe('info');
    expect(kindButton(ctx.host, 'info').getAttribute('aria-pressed')).toBe('true');
  });

  it('says so out loud: no output to route on, the result is context', async () => {
    const { ctx } = await openResearch();
    const hint = q(ctx.host, '.gph-inspector__outputhint');
    expect(hint.textContent).toContain('no output to route on');
    expect(hint.textContent).toContain('NEXT step as context');
  });

  it('offers no arms, no default and no rework builder', async () => {
    const { ctx } = await openResearch();
    expect(q(ctx.host, '.gph-arms')).toBeNull();
    expect(q(ctx.host, '.gph-default')).toBeNull();
    expect(q(ctx.host, '.gph-rework')).toBeNull();
  });

  it('edits the question the research answers', async () => {
    const { ctx, id } = await openResearch();
    const text = q(ctx.host, '.gph-inspector__text');
    expect(text.getAttribute('data-field')).toBe('query');
    typeInto(text, 'O projeto usa migrations versionadas?');
    await flush();
    expect(nodeById(ctx.latest.graph, id).query).toBe('O projeto usa migrations versionadas?');
  });

  it('toggles useContext and explains what reading the context DOES', async () => {
    const { ctx, id } = await openResearch();
    expect(nodeById(ctx.latest.graph, id).useContext).toBe(true);
    const box = q(ctx.host, '.gph-inspector__usecontext');
    expect(box.checked).toBe(true);
    click(box);
    await flush();
    expect(nodeById(ctx.latest.graph, id).useContext).toBe(false);
    expect(ctx.host.textContent).toContain('BEFORE writing its query');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE REQUEST, PART 2 — "se for uma pesquisa para definir uma afirmação então
   selecionamos que é booleana e conseguimos cadastrar comportamentos de sim e
   não na saída dela".
   ══════════════════════════════════════════════════════════════════════════ */

describe('research — boolean: two arms, and a behaviour on each', () => {
  async function boolResearch() {
    const { ctx, id } = await openResearch();
    click(kindButton(ctx.host, 'boolean'));
    await flush();
    return { ctx, id };
  }

  it('switches to the two fixed arms with no confirmation to give', async () => {
    const { ctx, id } = await boolResearch();
    const node = nodeById(ctx.latest.graph, id);
    expect(node.outputKind).toBe('boolean');
    expect(node.choices).toBeUndefined();
    // Nothing was lost, so nothing was asked.
    expect(q(ctx.host, '.gph-confirm')).toBeNull();
  });

  it('lists BOTH arms with their fixed routing ids', async () => {
    const { ctx } = await boolResearch();
    expect(qa(ctx.host, '.gph-armrow')).toHaveLength(2);
    expect(armRow(ctx.host, 'yes')).toBeTruthy();
    expect(armRow(ctx.host, 'no')).toBeTruthy();
    expect(armRow(ctx.host, 'yes').textContent).toContain('yes');
  });

  it('says each arm has NO behaviour registered yet', async () => {
    const { ctx } = await boolResearch();
    expect(armRow(ctx.host, 'yes').textContent).toContain('No behaviour registered');
    expect(armRow(ctx.host, 'no').textContent).toContain('No behaviour registered');
    expect(qa(ctx.host, '.gph-armrow__wire')).toHaveLength(2);
  });

  it('opens the palette ON THAT ARM from the arm row', async () => {
    const { ctx, id } = await boolResearch();
    click(q(ctx.host, '.gph-armrow__wire[data-arm="no"]'));
    await flush();
    const box = q(ctx.host, '.gph-palette');
    expect(box).toBeTruthy();
    expect(box.getAttribute('data-source-id')).toBe(id);
    expect(box.getAttribute('data-source-outcome')).toBe('no');
  });

  it('registers DIFFERENT behaviour on yes and on no — the user’s own words', async () => {
    const { ctx, id } = await boolResearch();

    click(q(ctx.host, '.gph-armrow__wire[data-arm="yes"]'));
    await flush();
    click(q(ctx.host, '.gph-palette [data-palette-id="tdd"]'));
    await flush();

    // The palette selects what it just created, so come back to the research.
    await selectNode(ctx, id);
    click(q(ctx.host, '.gph-armrow__wire[data-arm="no"]'));
    await flush();
    click(q(ctx.host, '.gph-palette [data-palette-id="security-review"]'));
    await flush();

    const graph = ctx.latest.graph;
    const edges = outbound(graph, id);
    expect(edges).toHaveLength(2);
    const byArm = Object.fromEntries(
      edges.map((edge) => [edge.sourceOutcome, nodeById(graph, edge.target).block]),
    );
    expect(byArm).toEqual({ yes: 'tdd', no: 'security-review' });
    expect(ctx.toasts.filter((toast) => toast.isErr)).toEqual([]);
  });

  it('then READS the behaviour back on each row', async () => {
    const { ctx, id } = await boolResearch();
    click(q(ctx.host, '.gph-armrow__wire[data-arm="yes"]'));
    await flush();
    click(q(ctx.host, '.gph-palette [data-palette-id="tdd"]'));
    await flush();
    await selectNode(ctx, id);

    expect(armRow(ctx.host, 'yes').textContent).toContain('Triggers');
    expect(armRow(ctx.host, 'yes').textContent).toContain('TDD');
    // A wired arm no longer offers the button that wires it.
    expect(q(ctx.host, '.gph-armrow__wire[data-arm="yes"]')).toBeNull();
    expect(armRow(ctx.host, 'no').textContent).toContain('No behaviour registered');
  });

  it('seeds the default with the first arm and says what a default IS', async () => {
    const { ctx, id } = await boolResearch();
    expect(nodeById(ctx.latest.graph, id).defaultOutcome).toBe('yes');
    expect(q(ctx.host, '.gph-default__opt[data-outcome="yes"]').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(ctx.host.textContent).toContain('It fires when the judge fails');
    expect(ctx.host.textContent).toContain('SAFE route forward');
  });

  it('moves the default to the other arm', async () => {
    const { ctx, id } = await boolResearch();
    click(q(ctx.host, '.gph-default__opt[data-outcome="no"]'));
    await flush();
    expect(nodeById(ctx.latest.graph, id).defaultOutcome).toBe('no');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE REQUEST, PART 3 — "se for de múltipla escolha podemos definir
   comportamentos para a saída".
   ══════════════════════════════════════════════════════════════════════════ */

describe('research — multiple choice: register the options, wire each one', () => {
  async function choiceResearch() {
    const { ctx, id } = await openResearch();
    click(kindButton(ctx.host, 'choice'));
    await flush();
    return { ctx, id };
  }

  async function addChoice(ctx, label) {
    typeInto(q(ctx.host, '.gph-addarm__input'), label);
    await flush();
    click(q(ctx.host, '.gph-addarm__btn'));
    await flush();
  }

  it('starts with NO options rather than inventing two', async () => {
    const { ctx, id } = await choiceResearch();
    const node = nodeById(ctx.latest.graph, id);
    expect(node.outputKind).toBe('choice');
    expect(node.choices).toEqual([]);
    expect(node.defaultOutcome).toBeUndefined();
    expect(q(ctx.host, '.gph-addarm__input')).toBeTruthy();
  });

  it('registers three options, each with the id the run will route on', async () => {
    const { ctx, id } = await choiceResearch();
    await addChoice(ctx, 'Precisa de migração');
    await addChoice(ctx, 'Só ajuste de código');
    await addChoice(ctx, 'Nada a fazer');

    expect(nodeById(ctx.latest.graph, id).choices).toEqual([
      { id: 'precisa-de-migracao', label: 'Precisa de migração' },
      { id: 'so-ajuste-de-codigo', label: 'Só ajuste de código' },
      { id: 'nada-a-fazer', label: 'Nada a fazer' },
    ]);
    expect(qa(ctx.host, '.gph-armrow')).toHaveLength(3);
  });

  it('makes the FIRST option the default, so the branch is never defaultless', async () => {
    const { ctx, id } = await choiceResearch();
    await addChoice(ctx, 'Sim');
    expect(nodeById(ctx.latest.graph, id).defaultOutcome).toBe('sim');
    await addChoice(ctx, 'Não');
    expect(nodeById(ctx.latest.graph, id).defaultOutcome).toBe('sim');
  });

  it('refuses a duplicate id, naming it, and changes nothing', async () => {
    const { ctx, id } = await choiceResearch();
    await addChoice(ctx, 'Sim');
    const before = ctx.latest.graph;
    await addChoice(ctx, 'sim');
    expect(ctx.latest.graph).toBe(before);
    const issue = q(ctx.host, '.gph-addarm__issue');
    expect(issue).toBeTruthy();
    expect(issue.textContent).toContain('sim');
    expect(issue.textContent).toContain('already an output');
  });

  it('refuses a name that leaves no id behind', async () => {
    const { ctx } = await choiceResearch();
    await addChoice(ctx, '!!!');
    expect(q(ctx.host, '.gph-addarm__issue').textContent).toContain('letters or digits');
    expect(qa(ctx.host, '.gph-armrow')).toHaveLength(0);
  });

  it('renames an option WITHOUT moving its id', async () => {
    const { ctx, id } = await choiceResearch();
    await addChoice(ctx, 'Sim');
    typeInto(q(ctx.host, '.gph-armrow__label[data-arm="sim"]'), 'Sim, com ressalvas');
    await flush();
    expect(nodeById(ctx.latest.graph, id).choices).toEqual([
      { id: 'sim', label: 'Sim, com ressalvas' },
    ]);
  });

  it('wires a different block to two different options', async () => {
    const { ctx, id } = await choiceResearch();
    await addChoice(ctx, 'Sim');
    await addChoice(ctx, 'Não');

    click(q(ctx.host, '.gph-armrow__wire[data-arm="sim"]'));
    await flush();
    click(q(ctx.host, '.gph-palette [data-palette-id="implement"]'));
    await flush();
    await selectNode(ctx, id);
    click(q(ctx.host, '.gph-armrow__wire[data-arm="nao"]'));
    await flush();
    click(q(ctx.host, '.gph-palette [data-palette-id="consolidate"]'));
    await flush();

    const graph = ctx.latest.graph;
    const byArm = Object.fromEntries(
      outbound(graph, id).map((edge) => [edge.sourceOutcome, nodeById(graph, edge.target).block]),
    );
    expect(byArm).toEqual({ sim: 'implement', nao: 'consolidate' });
  });

  it('will not remove an option while only two are left', async () => {
    const { ctx, id } = await choiceResearch();
    await addChoice(ctx, 'Sim');
    await addChoice(ctx, 'Não');
    const drop = q(ctx.host, '.gph-armrow__drop[data-arm="nao"]');
    expect(drop.getAttribute('aria-disabled')).toBe('true');
    click(drop);
    await flush();
    expect(nodeById(ctx.latest.graph, id).choices).toHaveLength(2);
    expect(q(ctx.host, '.gph-addarm__issue').textContent).toContain('at least two outputs');
  });

  it('removes the third option, and the default follows when it was the one', async () => {
    const { ctx, id } = await choiceResearch();
    await addChoice(ctx, 'Sim');
    await addChoice(ctx, 'Não');
    await addChoice(ctx, 'Talvez');
    click(q(ctx.host, '.gph-default__opt[data-outcome="talvez"]'));
    await flush();
    expect(nodeById(ctx.latest.graph, id).defaultOutcome).toBe('talvez');

    click(q(ctx.host, '.gph-armrow__drop[data-arm="talvez"]'));
    await flush();
    const node = nodeById(ctx.latest.graph, id);
    expect(node.choices.map((choice) => choice.id)).toEqual(['sim', 'nao']);
    // A default that no longer exists is `default-outcome-unknown`; it moves.
    expect(node.defaultOutcome).toBe('sim');
  });

  it('warns before removing an option that something is wired to', async () => {
    const { ctx, id } = await choiceResearch();
    await addChoice(ctx, 'Sim');
    await addChoice(ctx, 'Não');
    await addChoice(ctx, 'Talvez');
    click(q(ctx.host, '.gph-armrow__wire[data-arm="talvez"]'));
    await flush();
    click(q(ctx.host, '.gph-palette [data-palette-id="tdd"]'));
    await flush();
    await selectNode(ctx, id);

    const before = ctx.latest.graph;
    click(q(ctx.host, '.gph-armrow__drop[data-arm="talvez"]'));
    await flush();
    expect(ctx.latest.graph).toBe(before);
    expect(q(ctx.host, '.gph-confirm').textContent).toContain('1 link(s)');

    click(q(ctx.host, '.gph-confirm__apply'));
    await flush();
    expect(nodeById(ctx.latest.graph, id).choices.map((c) => c.id)).toEqual(['sim', 'nao']);
    expect(outbound(ctx.latest.graph, id)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SWITCHING THE OUTPUT KIND — the destructive edge, made visible first.
   ══════════════════════════════════════════════════════════════════════════ */

describe('research — switching the output kind never eats a link in silence', () => {
  /** A choice research with two options, each wired to its own block. */
  async function wiredChoice() {
    const { ctx, id } = await openResearch();
    click(kindButton(ctx.host, 'choice'));
    await flush();
    for (const label of ['Sim', 'Não']) {
      typeInto(q(ctx.host, '.gph-addarm__input'), label);
      await flush();
      click(q(ctx.host, '.gph-addarm__btn'));
      await flush();
    }
    for (const [arm, block] of [
      ['sim', 'tdd'],
      ['nao', 'consolidate'],
    ]) {
      click(q(ctx.host, `.gph-armrow__wire[data-arm="${arm}"]`));
      await flush();
      click(q(ctx.host, `.gph-palette [data-palette-id="${block}"]`));
      await flush();
      await selectNode(ctx, id);
    }
    expect(outbound(ctx.latest.graph, id)).toHaveLength(2);
    return { ctx, id };
  }

  it('COUNTS the links a choice→boolean switch would orphan, before applying', async () => {
    const { ctx, id } = await wiredChoice();
    const before = ctx.latest.graph;
    click(kindButton(ctx.host, 'boolean'));
    await flush();

    const confirm = q(ctx.host, '.gph-confirm');
    expect(confirm).toBeTruthy();
    expect(confirm.textContent).toContain('2 link(s)');
    // NOTHING happened yet — the graph is the very same object.
    expect(ctx.latest.graph).toBe(before);
    expect(nodeById(ctx.latest.graph, id).outputKind).toBe('choice');
  });

  it('names each doomed link by its arm and its target', async () => {
    const { ctx } = await wiredChoice();
    click(kindButton(ctx.host, 'boolean'));
    await flush();
    const rows = qa(ctx.host, '.gph-confirm__row').map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows.join(' ')).toContain('sim →');
    expect(rows.join(' ')).toContain('nao →');
  });

  it('cancelling leaves the drawing exactly as it was', async () => {
    const { ctx, id } = await wiredChoice();
    const before = ctx.latest.graph;
    click(kindButton(ctx.host, 'boolean'));
    await flush();
    click(q(ctx.host, '.gph-confirm__cancel'));
    await flush();
    expect(q(ctx.host, '.gph-confirm')).toBeNull();
    expect(ctx.latest.graph).toBe(before);
    expect(nodeById(ctx.latest.graph, id).choices).toHaveLength(2);
  });

  it('confirming switches AND removes the orphaned links', async () => {
    const { ctx, id } = await wiredChoice();
    click(kindButton(ctx.host, 'boolean'));
    await flush();
    click(q(ctx.host, '.gph-confirm__apply'));
    await flush();

    const node = nodeById(ctx.latest.graph, id);
    expect(node.outputKind).toBe('boolean');
    expect(node.choices).toBeUndefined();
    expect(node.defaultOutcome).toBe('yes');
    // The two nodes those links reached are STILL on the canvas: an orphaned
    // link is not orphaned work, and deleting the work was never asked for.
    expect(outbound(ctx.latest.graph, id)).toHaveLength(0);
    expect(nodesOf(ctx.latest.graph)).toHaveLength(4);
    expect(armRow(ctx.host, 'yes')).toBeTruthy();
  });

  it('choice→info drops the arms entirely and says the result becomes context', async () => {
    const { ctx, id } = await wiredChoice();
    click(kindButton(ctx.host, 'info'));
    await flush();
    click(q(ctx.host, '.gph-confirm__apply'));
    await flush();

    const node = nodeById(ctx.latest.graph, id);
    expect(node.outputKind).toBe('info');
    expect(node.choices).toBeUndefined();
    expect(node.defaultOutcome).toBeUndefined();
    expect(outbound(ctx.latest.graph, id)).toHaveLength(0);
    expect(q(ctx.host, '.gph-arms')).toBeNull();
    expect(q(ctx.host, '.gph-inspector__outputhint').textContent).toContain('as context');
  });

  it('clicking the kind it already is does nothing at all', async () => {
    const { ctx } = await wiredChoice();
    const before = ctx.latest.graph;
    click(kindButton(ctx.host, 'choice'));
    await flush();
    expect(ctx.latest.graph).toBe(before);
    expect(q(ctx.host, '.gph-confirm')).toBeNull();
  });

  it('drops a pending confirmation when another node is selected', async () => {
    const { ctx } = await wiredChoice();
    click(kindButton(ctx.host, 'boolean'));
    await flush();
    expect(q(ctx.host, '.gph-confirm')).toBeTruthy();
    await selectNode(ctx, 'prompt-1');
    expect(q(ctx.host, '.gph-confirm')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE GATE — the same treatment, because it had the same hole.
   ══════════════════════════════════════════════════════════════════════════ */

describe('gate — the outcomes stopped being frozen at approved/rework', () => {
  async function openGate() {
    const { graph, gateId, workId } = gateGraph();
    const ctx = track(mount(graph));
    await flush();
    await selectNode(ctx, gateId);
    return { ctx, gateId, workId };
  }

  it('edits the condition the judge is held to', async () => {
    const { ctx, gateId } = await openGate();
    const text = q(ctx.host, '.gph-inspector__text');
    expect(text.getAttribute('data-field')).toBe('condition');
    typeInto(text, 'A suíte inteira sai com zero.');
    await flush();
    expect(nodeById(ctx.latest.graph, gateId).condition).toBe('A suíte inteira sai com zero.');
  });

  it('lists the seeded outcomes with what each one triggers', async () => {
    const { ctx } = await openGate();
    expect(armRow(ctx.host, 'approved')).toBeTruthy();
    expect(armRow(ctx.host, 'rework')).toBeTruthy();
    expect(armRow(ctx.host, 'approved').textContent).toContain('No behaviour registered');
  });

  it('adds a third outcome and routes it somewhere of its own', async () => {
    const { ctx, gateId } = await openGate();
    typeInto(q(ctx.host, '.gph-addarm__input'), 'Precisa de decisão humana');
    await flush();
    click(q(ctx.host, '.gph-addarm__btn'));
    await flush();

    expect(nodeById(ctx.latest.graph, gateId).outcomes).toEqual([
      { id: 'approved', label: 'Aprovado' },
      { id: 'rework', label: 'Retrabalho' },
      { id: 'precisa-de-decisao-humana', label: 'Precisa de decisão humana' },
    ]);

    click(q(ctx.host, '.gph-armrow__wire[data-arm="precisa-de-decisao-humana"]'));
    await flush();
    click(q(ctx.host, '.gph-palette [data-palette-id="consolidate"]'));
    await flush();
    const edge = outbound(ctx.latest.graph, gateId)[0];
    expect(edge.sourceOutcome).toBe('precisa-de-decisao-humana');
  });

  it('renames an outcome without moving the id the judge answers with', async () => {
    const { ctx, gateId } = await openGate();
    typeInto(q(ctx.host, '.gph-armrow__label[data-arm="approved"]'), 'Passou');
    await flush();
    expect(nodeById(ctx.latest.graph, gateId).outcomes[0]).toEqual({
      id: 'approved',
      label: 'Passou',
    });
  });

  it('keeps the default on approved and shows it as the pressed one', async () => {
    const { ctx, gateId } = await openGate();
    expect(nodeById(ctx.latest.graph, gateId).defaultOutcome).toBe('approved');
    expect(
      q(ctx.host, '.gph-default__opt[data-outcome="approved"]').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('sets and clears the visit cap that bounds a loop', async () => {
    const { ctx, gateId } = await openGate();
    const input = q(ctx.host, '.gph-inspector__maxruns');
    typeInto(input, '3');
    await flush();
    expect(nodeById(ctx.latest.graph, gateId).maxRuns).toBe(3);
    typeInto(input, '');
    await flush();
    expect(nodeById(ctx.latest.graph, gateId).maxRuns).toBeUndefined();
  });

  it('sets a per-node model and clears it back to the run’s own', async () => {
    const { ctx, gateId } = await openGate();
    const input = q(ctx.host, '.gph-inspector__model');
    typeInto(input, 'z-ai/glm-5.2');
    await flush();
    expect(nodeById(ctx.latest.graph, gateId).modelId).toBe('z-ai/glm-5.2');
    typeInto(input, '   ');
    await flush();
    expect(nodeById(ctx.latest.graph, gateId).modelId).toBeUndefined();
  });

  it('keeps the human’s notes out of the agent’s way', async () => {
    const { ctx, gateId } = await openGate();
    typeInto(q(ctx.host, '.gph-inspector__notes'), 'Perguntar ao time de dados.');
    await flush();
    expect(nodeById(ctx.latest.graph, gateId).notes).toBe('Perguntar ao time de dados.');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE ARM THAT GOES BACK — the affordance that did not exist.
   ══════════════════════════════════════════════════════════════════════════ */

describe('rework — drawing the route back, and the two rules that bound it', () => {
  async function openGate() {
    const { graph, gateId, workId } = gateGraph();
    const ctx = track(mount(graph));
    await flush();
    await selectNode(ctx, gateId);
    return { ctx, gateId, workId };
  }

  it('offers only the steps that already ran as a destination', async () => {
    const { ctx, workId } = await openGate();
    const values = qa(ctx.host, '.gph-rework__target option').map((o) => o.value);
    expect(values).toEqual(['', 'prompt-1', workId]);
  });

  it('draws the arm, marked as rework and leaving the arm that was named', async () => {
    const { ctx, gateId, workId } = await openGate();
    pick(q(ctx.host, '.gph-rework__arm'), 'rework');
    await flush();
    pick(q(ctx.host, '.gph-rework__target'), workId);
    await flush();
    click(q(ctx.host, '.gph-rework__create'));
    await flush();

    const edges = outbound(ctx.latest.graph, gateId);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: gateId,
      target: workId,
      sourceOutcome: 'rework',
      rework: true,
    });
    expect(ctx.toasts.filter((toast) => toast.isErr)).toEqual([]);
  });

  it('then reads the arm back as a route BACK, not as ordinary work', async () => {
    const { ctx, gateId, workId } = await openGate();
    pick(q(ctx.host, '.gph-rework__arm'), 'rework');
    await flush();
    pick(q(ctx.host, '.gph-rework__target'), workId);
    await flush();
    click(q(ctx.host, '.gph-rework__create'));
    await flush();
    await selectNode(ctx, gateId);
    expect(armRow(ctx.host, 'rework').textContent).toContain('Goes BACK to');
    expect(armRow(ctx.host, 'rework').textContent).toContain('rework');
  });

  it('refuses to make the DEFAULT arm the one that loops, in graph-model’s words', async () => {
    const { ctx, gateId, workId } = await openGate();
    pick(q(ctx.host, '.gph-rework__arm'), 'approved');
    await flush();
    pick(q(ctx.host, '.gph-rework__target'), workId);
    await flush();
    const before = ctx.latest.graph;
    click(q(ctx.host, '.gph-rework__create'));
    await flush();

    expect(ctx.latest.graph).toBe(before);
    const errs = ctx.toasts.filter((toast) => toast.isErr);
    expect(errs).toHaveLength(1);
    // The sentence is `canConnect`'s own — the UI keeps no second table of the
    // 45 codes, so `default-outcome-is-rework` is READ, not re-worded.
    expect(errs[0].message).toContain('nunca o laço');
  });

  it('refuses an arm that is already wired forward, with the way around', async () => {
    const { ctx, gateId, workId } = await openGate();
    click(q(ctx.host, '.gph-armrow__wire[data-arm="rework"]'));
    await flush();
    click(q(ctx.host, '.gph-palette [data-palette-id="tdd"]'));
    await flush();
    await selectNode(ctx, gateId);

    pick(q(ctx.host, '.gph-rework__arm'), 'rework');
    await flush();
    pick(q(ctx.host, '.gph-rework__target'), workId);
    await flush();
    click(q(ctx.host, '.gph-rework__create'));
    await flush();
    const errs = ctx.toasts.filter((toast) => toast.isErr);
    expect(errs[errs.length - 1].message).toContain('ramifique a partir dele');
  });

  it('is not offered at all on a node with one way out', async () => {
    const { ctx } = await openResearch();
    expect(q(ctx.host, '.gph-rework')).toBeNull();
    await selectNode(ctx, 'prompt-1');
    expect(q(ctx.host, '.gph-rework')).toBeNull();
  });

  it('and the default picker then refuses that same arm, saying why', async () => {
    const { ctx, gateId, workId } = await openGate();
    pick(q(ctx.host, '.gph-rework__arm'), 'rework');
    await flush();
    pick(q(ctx.host, '.gph-rework__target'), workId);
    await flush();
    click(q(ctx.host, '.gph-rework__create'));
    await flush();
    await selectNode(ctx, gateId);

    const option = q(ctx.host, '.gph-default__opt[data-outcome="rework"]');
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('rework');
    click(option);
    await flush();
    expect(nodeById(ctx.latest.graph, gateId).defaultOutcome).toBe('approved');
    const errs = ctx.toasts.filter((toast) => toast.isErr);
    expect(errs[errs.length - 1].message).toContain('never the loop back');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE ACTION NODE — what it runs, over what, and how wide.
   ══════════════════════════════════════════════════════════════════════════ */

describe('action — scope, files, the fan-out and the template it really runs', () => {
  async function openWork() {
    const { graph, workId, reconId, strayId } = fanOutGraph();
    const ctx = track(mount(graph));
    await flush();
    await selectNode(ctx, workId);
    return { ctx, workId, reconId, strayId };
  }

  it('shows the block’s own prompt template, read-only', async () => {
    const { ctx } = await openWork();
    const tpl = q(ctx.host, '.gph-tpl');
    expect(tpl).toBeTruthy();
    // The catalog's text, not a paraphrase: this is what the agent receives.
    expect(tpl.textContent).toContain('Implement exactly that, and nothing beyond it.');
  });

  it('overrides the template and clears the override back to the block’s', async () => {
    const { ctx, workId } = await openWork();
    const text = q(ctx.host, '.gph-inspector__text');
    typeInto(text, 'Faça só o passo 2.');
    await flush();
    expect(nodeById(ctx.latest.graph, workId).prompt).toBe('Faça só o passo 2.');
    typeInto(text, '   ');
    await flush();
    expect(nodeById(ctx.latest.graph, workId).prompt).toBeUndefined();
  });

  it('offers ONLY the producing ancestor as a fan-out source', async () => {
    const { ctx, reconId, strayId } = await openWork();
    const values = qa(ctx.host, '.gph-inspector__fanout option').map((o) => o.value);
    expect(values).toEqual(['', reconId]);
    expect(values).not.toContain(strayId);
  });

  it('picking one sets scope memory, visibly, and locks the scope control', async () => {
    const { ctx, workId, reconId } = await openWork();
    pick(q(ctx.host, '.gph-inspector__fanout'), reconId);
    await flush();
    const node = nodeById(ctx.latest.graph, workId);
    expect(node.fanOutFrom).toBe(reconId);
    // `fanout-needs-memory-scope` is the rule; making it implicit would let the
    // human build the error by hand.
    expect(node.scope).toBe('memory');
    const scope = q(ctx.host, '.gph-inspector__scope');
    expect(scope.disabled).toBe(true);
    expect(scope.value).toBe('memory');
    expect(ctx.host.textContent).toContain('one agent per entry found');
  });

  it('clearing the fan-out takes the memory scope with it', async () => {
    const { ctx, workId, reconId } = await openWork();
    pick(q(ctx.host, '.gph-inspector__fanout'), reconId);
    await flush();
    pick(q(ctx.host, '.gph-inspector__fanout'), '');
    await flush();
    const node = nodeById(ctx.latest.graph, workId);
    // `scope-memory-needs-fanout` is the other half of the same rule.
    expect(node.fanOutFrom).toBeUndefined();
    expect(node.scope).toBeUndefined();
  });

  it('says so plainly when nothing upstream produces a list', async () => {
    const { graph, reconId } = fanOutGraph();
    const ctx = track(mount(graph));
    await flush();
    await selectNode(ctx, reconId);
    expect(q(ctx.host, '.gph-inspector__fanout')).toBeNull();
    expect(ctx.host.textContent).toContain('No step before this one writes a list');
  });

  it('picks a scope, and falls back to the block’s own when cleared', async () => {
    const { ctx, workId } = await openWork();
    pick(q(ctx.host, '.gph-inspector__scope'), 'per-file');
    await flush();
    expect(nodeById(ctx.latest.graph, workId).scope).toBe('per-file');
    pick(q(ctx.host, '.gph-inspector__scope'), '');
    await flush();
    expect(nodeById(ctx.latest.graph, workId).scope).toBeUndefined();
    // The empty option NAMES the block's default, so "unset" is not a mystery.
    expect(q(ctx.host, '.gph-inspector__scope').textContent).toContain('whole project');
  });

  it('never offers memory as a scope you can just pick', async () => {
    const { ctx } = await openWork();
    const values = qa(ctx.host, '.gph-inspector__scope option').map((o) => o.value);
    expect(values).toEqual(['', 'project', 'per-file', 'flexible']);
  });

  it('hand-picks files, one per line, and clears the list when emptied', async () => {
    const { ctx, workId } = await openWork();
    const files = q(ctx.host, '.gph-inspector__files');
    typeInto(files, 'src/a.ts\n  src/b.ts  \n\n');
    await flush();
    expect(nodeById(ctx.latest.graph, workId).files).toEqual(['src/a.ts', 'src/b.ts']);
    typeInto(files, '');
    await flush();
    expect(nodeById(ctx.latest.graph, workId).files).toBeUndefined();
  });

  it('caps the fan-out width, and never writes a non-finite number', async () => {
    const { ctx, workId } = await openWork();
    const input = q(ctx.host, '.gph-inspector__maxfiles');
    typeInto(input, '12');
    await flush();
    expect(nodeById(ctx.latest.graph, workId).maxFiles).toBe(12);

    // A `number` field cannot HOLD "abc" — the platform hands the handler an
    // empty string — so the cap is dropped rather than written as NaN.
    // `invalid-number` is what a NaN would become three layers downstream, and
    // it is reported there as "this is a huu bug".
    typeInto(input, 'abc');
    await flush();
    expect(nodeById(ctx.latest.graph, workId).maxFiles).toBeUndefined();
    expect(JSON.stringify(ctx.latest.graph)).not.toContain('null');
  });

  it('turns the critic loop on explicitly, starting from the block’s default', async () => {
    const { ctx, workId } = await openWork();
    const box = q(ctx.host, '.gph-inspector__review');
    // `implement` ships with review: true, so the box reflects the block.
    expect(box.checked).toBe(true);
    click(box);
    await flush();
    expect(nodeById(ctx.latest.graph, workId).review).toBe(false);
  });

  it('still shows which block the node is', async () => {
    const { ctx } = await openWork();
    expect(ctx.host.querySelector('.gph-inspector').textContent).toContain('implement');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE METHOD'S LIFE — open another, change the id, compile.
   ══════════════════════════════════════════════════════════════════════════ */

describe('the library — opening another method, and the rename that is not one', () => {
  it('lists what the project holds and opens the one that was clicked', async () => {
    const ctx = track(
      mount(seedGraph(), {
        graphs: [{ id: 'auditoria', name: 'Auditoria', nodeCount: 4, edgeCount: 3 }],
      }),
    );
    await flush();
    click(q(ctx.host, '.gph-lib__btn'));
    await flush();

    const row = q(ctx.host, '.gph-lib__open[data-graph-id="auditoria"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Auditoria');
    expect(row.textContent).toContain('4 nodes');

    click(row);
    await flush();
    expect(ctx.latest.graph.id).toBe('auditoria');
    expect(ctx.ops.map((op) => op.op)).toContain('read');
  });

  it('says the shelf is empty rather than showing an empty box', async () => {
    const ctx = track(mount(seedGraph(), { graphs: [] }));
    await flush();
    click(q(ctx.host, '.gph-lib__btn'));
    await flush();
    expect(q(ctx.host, '.gph-lib__empty').textContent).toContain('No method saved');
  });

  it('refuses a reserved id BEFORE the request, in the store’s own words', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    typeInto(q(ctx.host, '.gph-lib__id'), 'catalog');
    await flush();
    const issue = q(ctx.host, '.gph-lib__issue');
    expect(issue.textContent).toContain('nome de rota do huu');
    // No way to fire the write while the id cannot be written.
    expect(q(ctx.host, '.gph-lib__rename')).toBeNull();
    expect(ctx.ops.filter((op) => op.op === 'save')).toEqual([]);
  });

  it('refuses an id that is not a slug', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    typeInto(q(ctx.host, '.gph-lib__id'), 'Meu Método');
    await flush();
    expect(q(ctx.host, '.gph-lib__issue').textContent).toContain('não é um slug');
  });

  it('warns that renaming DELETES the old file, and does nothing until confirmed', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    typeInto(q(ctx.host, '.gph-lib__id'), 'auditoria-paralela');
    await flush();
    click(q(ctx.host, '.gph-lib__rename'));
    await flush();

    const warn = q(ctx.host, '.gph-lib__confirm');
    expect(warn.textContent).toContain('DELETE');
    expect(warn.textContent).toContain('teste');
    expect(warn.textContent).toContain('auditoria-paralela');
    expect(ctx.ops.filter((op) => op.op === 'remove' || op.op === 'save')).toEqual([]);
  });

  it('then removes the old and saves the new, IN THAT ORDER', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    typeInto(q(ctx.host, '.gph-lib__id'), 'auditoria-paralela');
    await flush();
    click(q(ctx.host, '.gph-lib__rename'));
    await flush();
    click(q(ctx.host, '.gph-lib__confirm-apply'));
    await flush();

    const writes = ctx.ops.filter((op) => op.op === 'remove' || op.op === 'save');
    expect(writes.map((op) => op.op)).toEqual(['remove', 'save']);
    expect(writes[0].id).toBe('teste');
    expect(writes[1].id).toBe('auditoria-paralela');
    expect(ctx.latest.graph.id).toBe('auditoria-paralela');
    expect(ctx.toasts[ctx.toasts.length - 1].message).toContain('auditoria-paralela');
  });

  it('saves the new id anyway when the old file cannot be deleted — and says both exist', async () => {
    const ctx = track(
      mount(seedGraph(), {
        remove: () => {
          throw new Error('not found');
        },
      }),
    );
    await flush();
    typeInto(q(ctx.host, '.gph-lib__id'), 'outro-nome');
    await flush();
    click(q(ctx.host, '.gph-lib__rename'));
    await flush();
    click(q(ctx.host, '.gph-lib__confirm-apply'));
    await flush();

    expect(ctx.latest.graph.id).toBe('outro-nome');
    const last = ctx.toasts[ctx.toasts.length - 1];
    expect(last.message).toContain('both exist now');
    expect(last.isErr).toBe(true);
  });

  it('cancelling the rename leaves the id alone', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    typeInto(q(ctx.host, '.gph-lib__id'), 'outro-nome');
    await flush();
    click(q(ctx.host, '.gph-lib__rename'));
    await flush();
    click(q(ctx.host, '.gph-lib__confirm-cancel'));
    await flush();
    expect(q(ctx.host, '.gph-lib__confirm')).toBeNull();
    expect(ctx.latest.graph.id).toBe('teste');
    expect(ctx.ops.filter((op) => op.op === 'remove')).toEqual([]);
  });
});

describe('compile — what the drawing becomes, and who blocked it', () => {
  const PIPELINE = {
    ok: true,
    warnings: [],
    pipeline: {
      name: 'teste',
      steps: [
        { name: 'prompt-1', prompt: 'x', files: [] },
        {
          type: 'check',
          name: 'gate-1',
          condition: 'ok?',
          dependsOn: ['prompt-1'],
          outcomes: [
            { label: 'approved', nextStepName: 'done-1', default: true },
            { label: 'rework', nextStepName: 'prompt-1' },
          ],
        },
      ],
    },
  };

  it('shows every step, what it waits for and where each verdict goes', async () => {
    const ctx = track(mount(seedGraph(), { compile: () => PIPELINE }));
    await flush();
    click(q(ctx.host, '.gph-panel__compile'));
    await flush();

    const panel = q(ctx.host, '.gph-compile');
    expect(panel.getAttribute('data-state')).toBe('ok');
    expect(panel.textContent).toContain('2 step(s)');
    const check = q(ctx.host, '.gph-compile__step[data-step="gate-1"]');
    expect(check.textContent).toContain('waits for prompt-1');
    expect(check.textContent).toContain('approved → done-1');
    expect(check.textContent).toContain('rework → prompt-1');
    // The forward default is marked, because it is the one nobody chooses.
    expect(check.querySelector('.gph-compile__default')).toBeTruthy();
  });

  it('PAINTS the nodes a refused compile blames, not just the sentence', async () => {
    const ctx = track(
      mount(seedGraph(), {
        compile: () => ({
          ok: false,
          error: 'the graph does not compile — 1 blocking issue(s) [prompt-goal-empty]',
          errors: [
            { code: 'prompt-goal-empty', message: 'Descreva o objetivo.', nodeId: 'prompt-1' },
          ],
          warnings: [],
        }),
      }),
    );
    await flush();
    click(q(ctx.host, '.gph-panel__compile'));
    await flush();

    expect(q(ctx.host, '.gph-compile').getAttribute('data-state')).toBe('failed');
    expect(q(ctx.host, '.gph-compile').textContent).toContain('prompt-goal-empty');
    const card = q(ctx.host, '.gph-node[data-node-id="prompt-1"]');
    expect(card.className).toContain('is-error');
    expect(card.querySelector('.gph-node__badge').textContent).toBe('1');
  });

  it('retires the answer on the next edit, because it is about an older drawing', async () => {
    const ctx = track(mount(seedGraph(), { compile: () => PIPELINE }));
    await flush();
    click(q(ctx.host, '.gph-panel__compile'));
    await flush();
    expect(q(ctx.host, '.gph-compile')).toBeTruthy();

    typeInto(q(ctx.host, '.gph-panel__name'), 'Outro nome');
    await flush();
    expect(q(ctx.host, '.gph-compile')).toBeNull();
  });

  it('closes on demand', async () => {
    const ctx = track(mount(seedGraph(), { compile: () => PIPELINE }));
    await flush();
    click(q(ctx.host, '.gph-panel__compile'));
    await flush();
    click(q(ctx.host, '.gph-compile__close'));
    await flush();
    expect(q(ctx.host, '.gph-compile')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   What the wave before this one already proved, kept honest across the move
   of the inspector into its own module.
   ══════════════════════════════════════════════════════════════════════════ */

describe('the inspector after the extraction — the old contract still holds', () => {
  it('says nothing is selected until something is', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    expect(q(ctx.host, '.gph-inspector').getAttribute('data-empty')).toBe('true');
    await selectNode(ctx, 'prompt-1');
    expect(q(ctx.host, '.gph-inspector').getAttribute('data-node-id')).toBe('prompt-1');
  });

  it('keeps the root free of a model, a delete button and a join', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    await selectNode(ctx, 'prompt-1');
    expect(q(ctx.host, '.gph-inspector__model')).toBeNull();
    expect(q(ctx.host, '.gph-inspector__delete')).toBeNull();
    expect(q(ctx.host, '.gph-join__note')).toBeTruthy();
  });

  it('deletes a node and drops the selection with it', async () => {
    const { graph, gateId } = gateGraph();
    const ctx = track(mount(graph));
    await flush();
    await selectNode(ctx, gateId);
    click(q(ctx.host, '.gph-inspector__delete'));
    await flush();
    expect(nodeById(ctx.latest.graph, gateId)).toBeNull();
    expect(q(ctx.host, '.gph-inspector').getAttribute('data-empty')).toBe('true');
  });

  it('shows the issues the validator anchored on the selected node', async () => {
    const ctx = track(
      mount(seedGraph(), {
        validate: () => ({
          ok: false,
          errors: [
            { code: 'prompt-goal-empty', message: 'Descreva o objetivo.', nodeId: 'prompt-1' },
          ],
          warnings: [],
        }),
      }),
    );
    await flush();
    await selectNode(ctx, 'prompt-1');
    const rows = qa(ctx.host, '.gph-issues li');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-code')).toBe('prompt-goal-empty');
    expect(rows[0].textContent).toContain('Descreva o objetivo.');
  });
});
