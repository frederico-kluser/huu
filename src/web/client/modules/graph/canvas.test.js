// @vitest-environment jsdom
/* huu web UI — the method canvas, mounted FOR REAL.
   ================================================

   This suite renders the actual React Flow tree into a jsdom document and
   drives it with DOM events, because the three things the user asked for are
   INTERACTIONS, and an interaction asserted through a mocked component is an
   assertion about the mock. The seams are the injected ones the component
   already exposes (`graphApi`, `toast`, `initialGraph`, `debounceMs`) — nothing
   is monkey-patched and no rule is re-implemented here.

   WHAT MAKES THE REAL MOUNT POSSIBLE, since it is not obvious: the vendored
   bundle is a PRODUCTION React build, so `React.act` refuses to run
   ("act(...) is not supported in production builds of React"). Updates are
   therefore flushed by yielding to the scheduler's macrotasks — `flush()`
   below — which is why every interaction is followed by an `await`.

   WHAT THIS SUITE CANNOT SEE, stated once so no reader assumes otherwise:
   jsdom has no layout. Every element measures 0×0, React Flow marks the nodes
   `visibility: hidden` because it never measured them, and no edge PATH is
   computed. So this file proves the GRAPH — which nodes and edges exist, from
   which arm, and what the UI refuses — and proves nothing about geometry:
   handle coordinates, edge routing, the pan/zoom transform, or whether the
   popover lands next to the dot it belongs to. Those need a real browser. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { messagesFor } from '../../../../lib/i18n/index.js';
import { ACTION_BLOCKS, NODE_KINDS } from '../../../../lib/dev-graph/node-catalog.js';
import { setCatalog } from '../../i18n.js';
import { S } from '../state.js';
import { RUN_GRAPH_EVENT, mountGraphCanvas, runBlockedReason, runGraphInDevMode } from './canvas.js';
import { addNode, connect, edgesOf, emptyGraph, nodeById, nodesOf } from './graph-model.js';

/* The catalog is the SERVER's own declaration surface, imported rather than
   re-typed. A hand-written fixture here would let this suite pass while the
   palette disagreed with what actually runs — the exact drift the client is
   built to avoid. */
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

function key(name) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
}

/**
 * Type into a controlled field.
 *
 * `el.value = x` alone does NOT work: React 18 installs its own `value` setter
 * on the element to track changes, and a direct assignment updates the DOM
 * behind that tracker's back — so the synthetic `change` fires with React
 * convinced nothing changed and the handler never sees the new text. Calling
 * the PROTOTYPE's setter is what keeps the tracker in step.
 */
function typeInto(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Mount the real component over a fake transport.
 *
 * `latest.graph` is the devgraph the canvas currently holds — reported through
 * the component's own `onGraphChange` seam, so the assertions read the TRUTH
 * (the devgraph) rather than scraping the drawing derived from it.
 */
function mount(initialGraph, options = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const toasts = [];
  const calls = { catalog: 0, validate: 0, save: 0, fromSample: 0 };
  const latest = { graph: initialGraph };

  const graphApi = {
    async catalog() {
      calls.catalog += 1;
      return CATALOG;
    },
    async validate(doc) {
      calls.validate += 1;
      return options.validate ? options.validate(doc) : { ok: true, errors: [], warnings: [] };
    },
    async save(doc) {
      calls.save += 1;
      return { ok: true, graph: doc };
    },
    async fromSample() {
      calls.fromSample += 1;
      return { ok: true, graph: emptyGraph('sample', 'Sample', STAMP) };
    },
  };

  const runs = [];
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
    // The hand-off seam. Left injected (like every other dependency here) so
    // the suite can read what the canvas would send to development mode; the
    // DEFAULT path — the `huu:run-graph` document event — is exercised on its
    // own below, with no `onRun` at all.
    ...(options.onRun === null ? {} : { onRun: (doc) => runs.push(doc) }),
  });

  return { host, mounted, toasts, calls, latest, runs };
}

/** The "Rodar este método" button, and the sentence that explains it. */
function runButton(host) {
  return host.querySelector('.gph-run__btn');
}

function runWhy(host) {
  return host.querySelector('.gph-run__why');
}

/** The clickable row of one outbound arm. `arm` is '' for a node that does not branch. */
function armRow(host, nodeId, arm) {
  return host.querySelector(`.gph-arm[data-node="${nodeId}"][data-arm="${arm}"]`);
}

function paletteBox(host) {
  return host.querySelector('.gph-palette');
}

function paletteRow(host, id) {
  return host.querySelector(`.gph-palette [data-palette-id="${id}"]`);
}

/** Open the bolinha of `nodeId` (arm `arm`) and pick `blockId` from the menu. */
async function addFromArm(ctx, nodeId, arm, blockId) {
  click(armRow(ctx.host, nodeId, arm));
  await flush();
  const row = paletteRow(ctx.host, blockId);
  expect(row, `palette row "${blockId}" is missing`).toBeTruthy();
  click(row);
  await flush();
  return row;
}

/** The prompt-only graph the canvas opens with. */
function seedGraph() {
  return emptyGraph('teste', 'Teste', STAMP);
}

/** prompt → gate, so the branching rules have something to bite on. */
function gateGraph() {
  let graph = seedGraph();
  const added = addNode(graph, 'gate', { position: { x: 300, y: 0 } });
  graph = added.graph;
  const linked = connect(graph, 'prompt-1', added.nodeId, {});
  expect(linked.error).toBeUndefined();
  return { graph: linked.graph, gateId: added.nodeId };
}

/** Every edge leaving a node, in declaration order. */
function outbound(graph, nodeId) {
  return edgesOf(graph).filter((edge) => edge.source === nodeId);
}

const mounts = [];

beforeEach(() => {
  // The REAL catalog, so a key the canvas renders but nobody translated makes
  // this suite throw instead of silently rendering a fake string.
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

function track(ctx) {
  mounts.push(ctx);
  return ctx;
}

describe('method canvas — it mounts and draws the devgraph', () => {
  it('renders the prompt entry with one outbound bolinha and no inbound handle', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();

    const card = ctx.host.querySelector('.gph-node[data-node-id="prompt-1"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Entrada do prompt');
    // The root takes no inbound edge (`prompt-has-inbound`), so the drawing
    // does not offer one to aim at.
    expect(card.querySelector('.gph-node__in')).toBeNull();
    // One way out ⇒ exactly one arm row.
    expect(card.querySelectorAll('.gph-arm')).toHaveLength(1);
    expect(armRow(ctx.host, 'prompt-1', '')).toBeTruthy();
  });

  it('draws one labelled bolinha per arm when the node branches', async () => {
    const { graph, gateId } = gateGraph();
    const ctx = track(mount(graph));
    await flush();

    const card = ctx.host.querySelector(`.gph-node[data-node-id="${gateId}"]`);
    expect(card.querySelectorAll('.gph-arm')).toHaveLength(2);
    expect(armRow(ctx.host, gateId, 'approved')).toBeTruthy();
    expect(armRow(ctx.host, gateId, 'rework')).toBeTruthy();
    // The arm's own label is visible — the human has to know which verdict
    // they are hanging work off before they click.
    expect(armRow(ctx.host, gateId, 'approved').textContent).toContain('Aprovado');
    expect(armRow(ctx.host, gateId, 'rework').textContent).toContain('Retrabalho');
  });

  it('fetches the catalog from /api/graphs/catalog, not from a local copy', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    expect(ctx.calls.catalog).toBe(1);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   ACCEPTANCE (i) — the bolinha of "Entrada do prompt" opens the palette, and
   picking `tdd` inserts the node ALREADY CONNECTED.
   ────────────────────────────────────────────────────────────────────────── */
describe('acceptance (i) — the bolinha adds a node already connected', () => {
  it('opens the palette from the prompt entry and lands tdd wired to it', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    expect(nodesOf(ctx.latest.graph)).toHaveLength(1);

    click(armRow(ctx.host, 'prompt-1', ''));
    await flush();

    const box = paletteBox(ctx.host);
    expect(box, 'clicking the bolinha did not open the palette').toBeTruthy();
    expect(box.getAttribute('data-source-id')).toBe('prompt-1');
    // The menu is the CATALOG's, in the catalog's order, bucketed by section.
    expect(ctx.host.querySelectorAll('.gph-palette__glabel').length).toBeGreaterThan(1);
    expect(paletteRow(ctx.host, 'tdd')).toBeTruthy();
    expect(paletteRow(ctx.host, 'tdd').textContent).toContain('TDD');

    click(paletteRow(ctx.host, 'tdd'));
    await flush();

    const graph = ctx.latest.graph;
    expect(nodesOf(graph)).toHaveLength(2);
    const added = nodesOf(graph).find((node) => node.id !== 'prompt-1');
    expect(added.kind).toBe('action');
    expect(added.block).toBe('tdd');

    // ALREADY CONNECTED — that is the whole point of the interaction.
    const edges = edgesOf(graph);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('prompt-1');
    expect(edges[0].target).toBe(added.id);
    // A node with one way out names no arm.
    expect(edges[0].sourceOutcome).toBeUndefined();

    // And it is on the canvas, not just in the model.
    expect(ctx.host.querySelector(`.gph-node[data-node-id="${added.id}"]`)).toBeTruthy();
    // The palette closed behind the pick.
    expect(paletteBox(ctx.host)).toBeNull();
    // Nothing was refused.
    expect(ctx.toasts.filter((toast) => toast.isErr)).toEqual([]);
  });

  it('picks with the keyboard too — ArrowDown then Enter', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();

    click(armRow(ctx.host, 'prompt-1', ''));
    await flush();
    key('ArrowDown');
    await flush();
    key('Enter');
    await flush();

    expect(nodesOf(ctx.latest.graph)).toHaveLength(2);
    // Second row of the first section: the catalog's second block.
    const added = nodesOf(ctx.latest.graph).find((node) => node.id !== 'prompt-1');
    expect(typeof added.block).toBe('string');
    expect(edgesOf(ctx.latest.graph)).toHaveLength(1);
  });

  it('closes on Escape without touching the graph', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();

    click(armRow(ctx.host, 'prompt-1', ''));
    await flush();
    expect(paletteBox(ctx.host)).toBeTruthy();

    key('Escape');
    await flush();
    expect(paletteBox(ctx.host)).toBeNull();
    expect(nodesOf(ctx.latest.graph)).toHaveLength(1);
  });

  it('closes when the click lands outside it', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();

    click(armRow(ctx.host, 'prompt-1', ''));
    await flush();
    expect(paletteBox(ctx.host)).toBeTruthy();

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await flush();
    expect(paletteBox(ctx.host)).toBeNull();
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   ACCEPTANCE (ii) — THE USER'S LITERAL REQUEST: "posso definir quando rodam em
   paralelo simplesmente adicionando mais de uma do mesmo ponto de partida".
   ────────────────────────────────────────────────────────────────────────── */
describe('acceptance (ii) — three parallel arms off ONE starting point', () => {
  it('adds tdd, security-review and performance-review from the same bolinha with no error', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();

    await addFromArm(ctx, 'prompt-1', '', 'tdd');
    await addFromArm(ctx, 'prompt-1', '', 'security-review');
    await addFromArm(ctx, 'prompt-1', '', 'performance-review');

    const graph = ctx.latest.graph;
    expect(nodesOf(graph)).toHaveLength(4);

    // THREE edges, all leaving the SAME point, each to its own node.
    const edges = outbound(graph, 'prompt-1');
    expect(edges).toHaveLength(3);
    expect(new Set(edges.map((edge) => edge.target)).size).toBe(3);
    expect(edges.map((edge) => nodeById(graph, edge.target).block).sort()).toEqual([
      'performance-review',
      'security-review',
      'tdd',
    ]);

    // NOT ONE REFUSAL. A node with one way out may feed as many fronts as the
    // human draws — that is the parallelism this canvas exists for.
    expect(ctx.toasts.filter((toast) => toast.isErr)).toEqual([]);

    // Each front lands in its own lane, so "parallel" READS as parallel rather
    // than stacking three cards on one spot.
    const lanes = edges.map((edge) => nodeById(graph, edge.target).position.y);
    expect(new Set(lanes).size).toBe(3);

    // All three are on the canvas.
    for (const edge of edges) {
      expect(ctx.host.querySelector(`.gph-node[data-node-id="${edge.target}"]`)).toBeTruthy();
    }
  });

  it('keeps offering the palette from that same point after each addition', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    await addFromArm(ctx, 'prompt-1', '', 'tdd');

    click(armRow(ctx.host, 'prompt-1', ''));
    await flush();
    // Nothing greyed out: the point is still open.
    expect(paletteRow(ctx.host, 'security-review').className).not.toContain('is-disabled');
    expect(ctx.host.querySelectorAll('.gph-palette__reason')).toHaveLength(0);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   ACCEPTANCE (iii) — a branching arm routes to ONE step. The second attempt is
   refused WITH THE WAY AROUND, and the node's OTHER arms stay open.
   ────────────────────────────────────────────────────────────────────────── */
describe('acceptance (iii) — one step per arm, refused with the way around', () => {
  it('greys the whole palette on a taken arm and says how to branch anyway', async () => {
    const { graph, gateId } = gateGraph();
    const ctx = track(mount(graph));
    await flush();

    await addFromArm(ctx, gateId, 'approved', 'tdd');
    const afterFirst = ctx.latest.graph;
    expect(outbound(afterFirst, gateId)).toHaveLength(1);
    expect(outbound(afterFirst, gateId)[0].sourceOutcome).toBe('approved');

    // Second attempt on the SAME arm.
    click(armRow(ctx.host, gateId, 'approved'));
    await flush();

    const row = paletteRow(ctx.host, 'security-review');
    expect(row).toBeTruthy();
    // IT IS STILL THERE, greyed — a menu that empties itself teaches nothing.
    expect(row.className).toContain('is-disabled');
    expect(row.getAttribute('aria-disabled')).toBe('true');

    // …and the reason is ON SCREEN, not hidden behind a hover.
    const reason = row.querySelector('.gph-palette__reason');
    expect(reason).toBeTruthy();
    expect(reason.textContent).toContain('ligue este braço a UM bloco e ramifique a partir dele');
    expect(reason.textContent).toContain('Aprovado');

    // Clicking it REFUSES OUT LOUD and changes nothing.
    click(row);
    await flush();
    expect(ctx.latest.graph).toBe(afterFirst);
    const errs = ctx.toasts.filter((toast) => toast.isErr);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('ligue este braço a UM bloco e ramifique a partir dele');
  });

  it('leaves the OTHER arms of the same node open', async () => {
    const { graph, gateId } = gateGraph();
    const ctx = track(mount(graph));
    await flush();

    await addFromArm(ctx, gateId, 'approved', 'tdd');

    // The rework arm never had an edge, so it is business as usual.
    click(armRow(ctx.host, gateId, 'rework'));
    await flush();
    const row = paletteRow(ctx.host, 'security-review');
    expect(row.className).not.toContain('is-disabled');
    expect(ctx.host.querySelectorAll('.gph-palette__reason')).toHaveLength(0);

    click(row);
    await flush();

    const after = ctx.latest.graph;
    expect(outbound(after, gateId)).toHaveLength(2);
    expect(outbound(after, gateId).map((edge) => edge.sourceOutcome).sort()).toEqual([
      'approved',
      'rework',
    ]);
    expect(ctx.toasts.filter((toast) => toast.isErr)).toEqual([]);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   The JOIN — the user's second explicit request.
   ────────────────────────────────────────────────────────────────────────── */
describe('the inspector — join, label and the node’s own text', () => {
  /** prompt → two fronts → one consolidating node that waits on both. */
  async function fanIn() {
    const ctx = track(mount(seedGraph()));
    await flush();
    await addFromArm(ctx, 'prompt-1', '', 'security-review');
    await addFromArm(ctx, 'prompt-1', '', 'performance-review');
    const fronts = outbound(ctx.latest.graph, 'prompt-1').map((edge) => edge.target);
    await addFromArm(ctx, fronts[0], '', 'consolidate');
    const join = outbound(ctx.latest.graph, fronts[0])[0].target;
    // Second front feeds the same consolidating node — drawn by dragging in the
    // real UI, drawn here through the same pure mutation the drag calls.
    click(ctx.host.querySelector(`.gph-node[data-node-id="${join}"]`));
    await flush();
    return { ctx, fronts, join };
  }

  it('edits the label and the node’s own text through the pure mutations', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    click(ctx.host.querySelector('.gph-node[data-node-id="prompt-1"]'));
    await flush();

    const label = ctx.host.querySelector('.gph-inspector__label');
    expect(label).toBeTruthy();
    typeInto(label, 'Meu objetivo');
    await flush();
    expect(nodeById(ctx.latest.graph, 'prompt-1').label).toBe('Meu objetivo');

    // The prompt entry's own text is its `goal`.
    const text = ctx.host.querySelector('.gph-inspector__text');
    expect(text.getAttribute('data-field')).toBe('goal');
    typeInto(text, 'Cobrir o parser com testes.');
    await flush();
    expect(nodeById(ctx.latest.graph, 'prompt-1').goal).toBe('Cobrir o parser com testes.');
  });

  it('says the root waits for nobody and offers no join controls for it', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    click(ctx.host.querySelector('.gph-node[data-node-id="prompt-1"]'));
    await flush();
    expect(ctx.host.querySelector('.gph-join__note')).toBeTruthy();
    expect(ctx.host.querySelector('.gph-join__all')).toBeNull();
  });

  it('switches a node to “wait only for the selected” and drops one predecessor', async () => {
    const { ctx, fronts, join } = await fanIn();

    // It starts waiting for everything an edge brought in.
    expect(nodeById(ctx.latest.graph, join).join).toEqual({ mode: 'all' });

    const subset = ctx.host.querySelector('.gph-join__subset');
    expect(subset).toBeTruthy();
    subset.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    // Opening the subset ticks every predecessor, so the switch alone changes
    // no behaviour — the human then unticks what this step must not wait for.
    expect(nodeById(ctx.latest.graph, join).join.mode).toBe('subset');

    // THE HONEST SENTENCE is on screen the moment the join is relaxed.
    const honest = ctx.host.querySelector('.gph-join__honest');
    expect(honest).toBeTruthy();
    // The suite runs the `en` catalog (see beforeEach), so this is the English
    // half of the twin; the pt-BR one is pinned by the i18n parity checks.
    expect(honest.textContent).toContain('DEPENDENCY');
    expect(honest.textContent).toContain('merge barrier');

    const preds = ctx.host.querySelectorAll('.gph-join__pred input');
    expect(preds.length).toBeGreaterThanOrEqual(1);
    expect(fronts).toContain(preds[0].getAttribute('data-pred'));
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   Validation — anchored issues paint a node, unanchored ones get their own
   place, and a WARNING never looks like a defect.
   ────────────────────────────────────────────────────────────────────────── */
describe('validation — where each issue lands', () => {
  it('paints the node an anchored error names', async () => {
    const ctx = track(
      mount(seedGraph(), {
        validate: () => ({
          ok: false,
          errors: [{ code: 'prompt-goal-empty', message: 'Descreva o objetivo.', nodeId: 'prompt-1' }],
          warnings: [],
        }),
      }),
    );
    await flush();

    const card = ctx.host.querySelector('.gph-node[data-node-id="prompt-1"]');
    expect(card.className).toContain('is-error');
    expect(card.querySelector('.gph-node__badge').textContent).toBe('1');
    expect(ctx.host.querySelector('.gph-status').getAttribute('data-s')).toBe('err');
  });

  it('gives the UNANCHORED invalid-schema a visible place that is not a node', async () => {
    const ctx = track(
      mount(seedGraph(), {
        validate: () => ({
          ok: false,
          // No nodeId and no edgeId — there is no single node to blame, so a
          // canvas that only knew how to paint nodes would drop this and show
          // green for a graph the store refuses to save.
          errors: [{ code: 'invalid-schema', message: 'o payload não é um devgraph.' }],
          warnings: [],
        }),
      }),
    );
    await flush();

    const global = ctx.host.querySelectorAll('.gph-global__item');
    expect(global).toHaveLength(1);
    expect(global[0].textContent).toContain('o payload não é um devgraph.');
    expect(global[0].getAttribute('data-code')).toBe('invalid-schema');
    expect(ctx.host.querySelector('.gph-node[data-node-id="prompt-1"]').className).not.toContain(
      'is-error',
    );
  });

  it('reports join-subset-drops-barrier as a NOTE, never as a defect', async () => {
    const ctx = track(
      mount(seedGraph(), {
        validate: () => ({
          ok: true,
          errors: [],
          warnings: [
            {
              code: 'join-subset-drops-barrier',
              message: 'relaxar o join tira a dependência, não a barreira.',
              nodeId: 'prompt-1',
            },
          ],
        }),
      }),
    );
    await flush();

    const status = ctx.host.querySelector('.gph-status');
    expect(status.getAttribute('data-s')).toBe('warn');
    const card = ctx.host.querySelector('.gph-node[data-node-id="prompt-1"]');
    expect(card.className).toContain('is-warn');
    expect(card.className).not.toContain('is-error');
    expect(card.querySelector('.gph-node__badge').getAttribute('data-sev')).toBe('warn');
  });

  it('re-validates after every change, debounced', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    const before = ctx.calls.validate;
    expect(before).toBeGreaterThan(0);

    await addFromArm(ctx, 'prompt-1', '', 'tdd');
    expect(ctx.calls.validate).toBeGreaterThan(before);
  });

  it('keeps the canvas usable when the validator itself is unreachable', async () => {
    const ctx = track(
      mount(seedGraph(), {
        validate: () => {
          throw new Error('connection lost');
        },
      }),
    );
    await flush();
    expect(ctx.host.querySelector('.gph-status').textContent).toContain('connection lost');
    // Still editable — a dead validator is not a dead editor.
    await addFromArm(ctx, 'prompt-1', '', 'tdd');
    expect(nodesOf(ctx.latest.graph)).toHaveLength(2);
  });
});

describe('the panel — name, save and the sample library', () => {
  it('renames the graph and saves what the store answered with', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();

    const name = ctx.host.querySelector('.gph-panel__name');
    typeInto(name, 'Auditoria paralela');
    await flush();
    expect(ctx.latest.graph.name).toBe('Auditoria paralela');

    click(ctx.host.querySelector('.gph-panel__save'));
    await flush();
    expect(ctx.calls.save).toBe(1);
    expect(ctx.toasts[ctx.toasts.length - 1].isErr).toBe(false);
  });

  it('lists the samples /api/bootstrap served', async () => {
    const ctx = track(
      mount(seedGraph(), {
        samples: [{ id: 'recon-fanout', name: 'Recon fan-out', description: 'x' }],
      }),
    );
    await flush();
    const options = Array.from(ctx.host.querySelectorAll('.gph-panel__select option'));
    expect(options.map((option) => option.value)).toEqual(['', 'recon-fanout']);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   RUNNING THE DRAWING — "Rodar este método".

   The canvas does NOT post `/api/dev`. A dev session needs a goal, a project
   directory and a model routing, and the /dev form already owns all three; a
   second folder browser here could only disagree with the first. So this button
   HANDS THE METHOD OVER and the ordinary /dev submit is what starts the
   session. What this block pins is therefore: WHEN the hand-off is offered, WHY
   it is refused, and WHAT travels with it.

   WHAT IT CANNOT SEE: jsdom has no layout, so nothing here says the button is
   visible, reachable by tab order, or not covered by the minimap. `disabled`
   and the sentence beside it are asserted; pixels are not. */
describe('the canvas — handing a method over to development mode', () => {
  it('refuses to run while the validation has not answered', async () => {
    // A validator that never answers pins the PENDING state: this is what every
    // mount looks like for its first instants, and what an edit looks like
    // while the debounced re-check is in flight.
    const ctx = track(mount(seedGraph(), { validate: () => new Promise(() => {}) }));
    await flush();
    expect(runButton(ctx.host).disabled).toBe(true);
    expect(runWhy(ctx.host).textContent).toContain('Checking');
    expect(runWhy(ctx.host).getAttribute('data-blocked')).toBe('1');
  });

  it('refuses to run an INVALID drawing, and says how many problems', async () => {
    const ctx = track(
      mount(seedGraph(), {
        validate: () => ({
          ok: false,
          errors: [
            { code: 'prompt-missing', message: 'no prompt', nodeId: 'prompt-1' },
            { code: 'node-unreachable', message: 'orphan', nodeId: 'prompt-1' },
          ],
          warnings: [],
        }),
      }),
    );
    await flush();
    expect(runButton(ctx.host).disabled).toBe(true);
    expect(runWhy(ctx.host).textContent).toContain('2 problem(s)');
    // The REASON is visible, not just a tooltip — but it is also the tooltip.
    expect(runButton(ctx.host).getAttribute('title')).toContain('2 problem(s)');
  });

  it('refuses to run when the validator itself did not answer', async () => {
    const ctx = track(
      mount(seedGraph(), {
        validate: () => {
          throw new Error('connection lost');
        },
      }),
    );
    await flush();
    expect(runButton(ctx.host).disabled).toBe(true);
    expect(runWhy(ctx.host).textContent).toContain('connection lost');
  });

  it('refuses to run a VALID drawing that was never saved', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    // Valid — the status line agrees.
    expect(ctx.host.querySelector('.gph-status').getAttribute('data-s')).toBe('ok');
    expect(runButton(ctx.host).disabled).toBe(true);
    expect(runWhy(ctx.host).textContent).toContain('Save it first');
  });

  it('offers the run once the drawing is valid AND saved', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    click(ctx.host.querySelector('.gph-panel__save'));
    await flush();

    expect(ctx.calls.save).toBe(1);
    expect(runButton(ctx.host).disabled).toBe(false);
    expect(runWhy(ctx.host).getAttribute('data-blocked')).toBe('0');
    expect(runWhy(ctx.host).textContent).toContain('ONE epoch');
  });

  it('takes the offer BACK the moment the drawing is edited again', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    click(ctx.host.querySelector('.gph-panel__save'));
    await flush();
    expect(runButton(ctx.host).disabled).toBe(false);

    // One more node: the canvas now differs from the file on disk, and
    // `huu dev --graph` reads the FILE.
    await addFromArm(ctx, 'prompt-1', '', 'tdd');
    await flush();
    expect(runButton(ctx.host).disabled).toBe(true);
    expect(runWhy(ctx.host).textContent).toContain('Save it first');
  });

  it('counts a graph OPENED from the store as saved — no pointless re-save', async () => {
    const ctx = track(
      mount(seedGraph(), { samples: [{ id: 'recon-fanout', name: 'Recon', description: '' }] }),
    );
    await flush();
    expect(runButton(ctx.host).disabled).toBe(true);

    const select = ctx.host.querySelector('.gph-panel__select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'recon-fanout');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(ctx.calls.fromSample).toBe(1);
    // `/from-sample` writes before it answers, so the graph IS on disk.
    expect(runButton(ctx.host).disabled).toBe(false);
  });

  it('hands the CURRENT document over, and says so', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    const name = ctx.host.querySelector('.gph-panel__name');
    typeInto(name, 'Auditoria paralela');
    await flush();
    click(ctx.host.querySelector('.gph-panel__save'));
    await flush();

    click(runButton(ctx.host));
    await flush();

    expect(ctx.runs).toHaveLength(1);
    expect(ctx.runs[0].id).toBe('teste');
    expect(ctx.runs[0].name).toBe('Auditoria paralela');
    // The human is told where the method went.
    const last = ctx.toasts[ctx.toasts.length - 1];
    expect(last.isErr).toBe(false);
    expect(last.message).toContain('Auditoria paralela');
  });

  it('does nothing at all while the button is disabled', async () => {
    const ctx = track(mount(seedGraph()));
    await flush();
    // A disabled <button> does not dispatch click handlers in the DOM either;
    // the assertion is that the canvas relies on that rather than on a guard
    // it could forget.
    click(runButton(ctx.host));
    await flush();
    expect(ctx.runs).toEqual([]);
  });
});

describe('the hand-off itself — runGraphInDevMode', () => {
  it('fires huu:run-graph with the id and the name', () => {
    const seen = [];
    const listener = (ev) => seen.push(ev.detail);
    document.addEventListener(RUN_GRAPH_EVENT, listener);
    try {
      expect(runGraphInDevMode({ id: 'auditoria', name: 'Auditoria' })).toBe(true);
    } finally {
      document.removeEventListener(RUN_GRAPH_EVENT, listener);
    }
    expect(seen).toEqual([{ id: 'auditoria', name: 'Auditoria' }]);
  });

  it('mirrors the selection onto S, for a listener that wires up later', () => {
    S.devGraphId = '';
    S.devGraphName = '';
    runGraphInDevMode({ id: 'metodo-minimo', name: 'Método mínimo' });
    expect(S.devGraphId).toBe('metodo-minimo');
    expect(S.devGraphName).toBe('Método mínimo');
  });

  it('falls back to the id when the drawing has no name', () => {
    const seen = [];
    const listener = (ev) => seen.push(ev.detail);
    document.addEventListener(RUN_GRAPH_EVENT, listener);
    try {
      runGraphInDevMode({ id: 'sem-nome' });
    } finally {
      document.removeEventListener(RUN_GRAPH_EVENT, listener);
    }
    expect(seen).toEqual([{ id: 'sem-nome', name: 'sem-nome' }]);
  });

  it('refuses a graph with no id — there would be nothing to select', () => {
    const seen = [];
    const listener = (ev) => seen.push(ev.detail);
    document.addEventListener(RUN_GRAPH_EVENT, listener);
    try {
      expect(runGraphInDevMode({ name: 'só nome' })).toBe(false);
      expect(runGraphInDevMode(null)).toBe(false);
    } finally {
      document.removeEventListener(RUN_GRAPH_EVENT, listener);
    }
    expect(seen).toEqual([]);
  });

  it('is what the canvas uses when nothing is injected', async () => {
    const seen = [];
    const listener = (ev) => seen.push(ev.detail);
    document.addEventListener(RUN_GRAPH_EVENT, listener);
    try {
      const ctx = track(mount(seedGraph(), { onRun: null }));
      await flush();
      click(ctx.host.querySelector('.gph-panel__save'));
      await flush();
      click(runButton(ctx.host));
      await flush();
    } finally {
      document.removeEventListener(RUN_GRAPH_EVENT, listener);
    }
    expect(seen).toEqual([{ id: 'teste', name: 'Teste' }]);
  });
});

describe('runBlockedReason — the rule, without a canvas', () => {
  it('ranks a broken method above an unsaved one', () => {
    const reason = runBlockedReason({ state: 'done', errors: [{ code: 'x' }] }, false);
    expect(reason).toContain('1 problem(s)');
    expect(reason).not.toContain('Save it first');
  });

  it('lets a WARNING through — a note is not a defect', () => {
    // `join-subset-drops-barrier` is the expected answer for the very method
    // this screen exists to draw, and it must not block the run.
    expect(runBlockedReason({ state: 'done', errors: [], warnings: [{ code: 'w' }] }, true)).toBeNull();
  });

  it('answers null only when the drawing is checked, clean and on disk', () => {
    expect(runBlockedReason({ state: 'done', errors: [] }, true)).toBeNull();
    expect(runBlockedReason({ state: 'done', errors: [] }, false)).toBeTruthy();
    expect(runBlockedReason({ state: 'pending', errors: [] }, true)).toBeTruthy();
    expect(runBlockedReason({ state: 'idle', errors: [] }, true)).toBeTruthy();
  });

  it('survives a malformed check object rather than taking the panel down', () => {
    expect(runBlockedReason(null, true)).toBeTruthy();
    expect(runBlockedReason({}, true)).toBeTruthy();
    expect(runBlockedReason({ state: 'done' }, true)).toBeNull();
  });
});
