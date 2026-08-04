/* huu web UI — PURE graph editing for the hand-drawn method canvas.
   ==================================================================

   Everything the editor DECIDES lives here, and nothing it DRAWS does. No DOM,
   no `fetch`, no `window` — not at import time and not at call time — so the
   whole decision surface imports in Node and is pinned by `graph-model.test.js`
   (the client suite runs under vitest with NO `environment`, i.e. no
   `document`). Logic that hides inside a React component is logic nobody can
   test; this module is the reason the wave-4 canvas can be verified at all.

   THE ONE RULE: every exported mutation is PURE. It takes a graph and returns a
   NEW graph; the input is never touched. When a call changes nothing — an
   unknown id, a rejected connection, a drag that lands where the node already
   is — it returns THE SAME REFERENCE back. That is deliberate: React re-renders
   on identity, so "nothing happened" must be observable with `===`.

   WHAT THIS MODULE IS NOT: a second authority. `src/lib/dev-graph/` holds the
   real rules — `graph-validate.ts` decides whether a graph is a sound method,
   and the server runs it on every save. What lives here is IMMEDIATE feedback
   on the canvas, expressed with THE SAME `code` strings the server reports
   (`GraphErrorCode` in `src/lib/dev-graph/graph-types.ts`), so the UI keeps one
   table of messages instead of two. When the two disagree, the server wins.

   WHAT THIS MODULE MUST NEVER CARRY: the block catalog. The client is plain
   JavaScript served raw from `src/web/client/` — it cannot import `src/lib`,
   and a hand-copied list of blocks is exactly the drift `modules/dev.js` calls
   out ("o cliente renderiza a tabela, nunca carrega uma cópia que possa
   discordar do que roda"). Blocks, node kinds and their labels arrive from
   `GET /api/graphs/catalog`; see `palette-model.js`. The few constants below
   are PROTOCOL, not catalog — the format tag, the id shapes, the caps and the
   two fixed boolean-research arms are things a payload must satisfy to be a
   devgraph at all, and every one of them can be overridden by what the server
   serves. */

/**
 * The shapes, written LOOSE on purpose: this file is checked as JavaScript
 * (`tsconfig.client.json`, `allowJs` + `checkJs`, `strict: false`) and every
 * value reaching it came off the wire or out of a half-drawn editor. The strict
 * declarations live where they belong — `src/lib/dev-graph/graph-types.ts` — and
 * the server enforces them; a typedef here that pretended a payload is
 * well-formed would only move the lie earlier.
 *
 * @typedef {{ x: number, y: number }} GraphPosition
 * @typedef {{ mode: 'all' } | { mode: 'subset', of: string[] }} JoinPolicy
 * @typedef {{ id?: string, kind?: string, label?: string, position?: GraphPosition } & Record<string, any>} GraphNode
 * @typedef {{ id?: string, source?: string, target?: string, sourceOutcome?: string, rework?: true } & Record<string, any>} GraphEdge
 * @typedef {{ _format?: string, id?: string, name?: string, createdAt?: string, updatedAt?: string, meta?: Record<string, any>, nodes?: GraphNode[], edges?: GraphEdge[] } & Record<string, any>} DevGraph
 * @typedef {{ id: string, label: string }} BranchOutcome
 * @typedef {{ code: string, message: string }} GraphDenial
 * @typedef {{ ok: boolean, code?: string, message?: string }} GraphVerdict
 *   `ok: true` and nothing else, or `ok: false` with the refusal. One loose
 *   shape rather than a discriminated union: this file is checked as JavaScript
 *   (`allowJs` + `checkJs`, `strict: false`), where narrowing a union across a
 *   `if (!v.ok)` boundary is not reliable enough to be worth the noise.
 */

/** The `_format` tag every persisted devgraph carries (`graph-schema.ts`). */
export const DEVGRAPH_FORMAT = 'huu-devgraph-v1';

/**
 * The product caps, mirrored so the canvas can refuse a 41st node without a
 * round-trip.
 *
 * `GET /api/graphs/catalog` does NOT serve these today (it serves `blocks`,
 * `kinds`, `methodologies` and `samples`), so this mirror is what is in force.
 * `capsOf` still reads `catalog.caps` first, which costs nothing and means the
 * day the server publishes them the client stops being a second opinion.
 */
export const GRAPH_CAPS = { maxNodes: 40, maxEdges: 80 };

/** A graph id is a slug — it names the file on disk and the run downstream. */
export const GRAPH_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Ids the `/api/graphs` routes have already claimed.
 *
 * Every one of them is also a legal slug, so `/api/graphs/catalog` is ambiguous
 * by construction and the ROUTE wins — a graph saved under one of these names
 * could be written and then never read back. The server refuses them with a
 * 400; refusing them here too is what turns that into a sentence next to the
 * field instead of a failed save.
 */
export const GRAPH_RESERVED_IDS = ['catalog', 'compile', 'validate', 'from-sample'];

/**
 * What is wrong with this graph id, or `null` when it is usable.
 *
 * The `code` values are the store's own refusal prefix (`invalid-id:`), so the
 * client's pre-flight and the server's 400 speak the same word.
 *
 * @param {string} id
 * @returns {GraphDenial|null}
 */
export function graphIdIssue(id) {
  const value = typeof id === 'string' ? id.trim() : '';
  if (!value) {
    return { code: 'invalid-id', message: 'Dê um id ao método — ele nomeia o arquivo no disco.' };
  }
  if (!GRAPH_ID_PATTERN.test(value)) {
    return {
      code: 'invalid-id',
      message: `"${value}" não é um slug: use a-z, 0-9 e hifens, de 1 a 40 caracteres, começando por letra ou número.`,
    };
  }
  if (GRAPH_RESERVED_IDS.includes(value)) {
    return {
      code: 'invalid-id',
      message: `"${value}" é um nome de rota do huu (${GRAPH_RESERVED_IDS.join(', ')}): um método com esse id seria salvo e nunca mais aberto. Escolha outro.`,
    };
  }
  return null;
}

/**
 * The two arms of a `boolean` research node. The IDS are a ROUTING CONTRACT
 * (the compiler routes on them and the judge is told to answer with one of
 * them), so they are pinned here; the labels are chrome and are replaced by
 * `catalog.researchBooleanOutcomes` as soon as the catalog is loaded.
 */
export const RESEARCH_BOOLEAN_OUTCOMES = [
  { id: 'yes', label: 'Sim' },
  { id: 'no', label: 'Não' },
];

/**
 * Placeholder text a freshly dropped node opens with.
 *
 * NOT catalog data and NOT a suggestion about method: the schema requires these
 * fields to be non-empty, so a node created and immediately saved must still
 * round-trip. The human overwrites them as their first act, and
 * `applyPaletteChoice` always passes the label the SERVER's catalog gave it, so
 * the labels below are a last-resort fallback for a palette-less caller.
 */
const NODE_SEEDS = {
  prompt: { label: 'Entrada do prompt', goal: 'Descreva aqui o objetivo deste trabalho.' },
  action: { label: 'Ação', block: 'custom' },
  research: { label: 'Pesquisa', query: 'Descreva aqui a pergunta desta pesquisa.' },
  gate: { label: 'Verificação', condition: 'Describe here the condition the judge must check.' },
};

/** Horizontal step between a node and the node the palette hangs off it. */
const LANE_X = 280;
/** Vertical step between two siblings fanned out from the same point. */
const LANE_Y = 140;

// --- Defensive readers ------------------------------------------------------
//
// Same posture as `graph-validate.ts`: the values reaching this module came
// from a server, a file and a half-drawn editor, so `{"nodes":[null]}` is a
// real payload. Every reader drops what it cannot understand and keeps the
// rest — a single junk entry must never cost the human the nine good nodes
// around it.

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entries of a list that are plain objects, in declaration order. */
function recordsOf(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** A trimmed string, or `''` for anything else. */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** A finite number, or `0`. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The graph's readable nodes.
 * @param {DevGraph} graph
 * @returns {GraphNode[]}
 */
export function nodesOf(graph) {
  return /** @type {GraphNode[]} */ (recordsOf(graph && graph.nodes));
}

/**
 * The graph's readable edges.
 * @param {DevGraph} graph
 * @returns {GraphEdge[]}
 */
export function edgesOf(graph) {
  return /** @type {GraphEdge[]} */ (recordsOf(graph && graph.edges));
}

/**
 * The node with this id, or `null`. First declaration wins, like the validator.
 * @param {DevGraph} graph
 * @param {string} nodeId
 * @returns {GraphNode|null}
 */
export function nodeById(graph, nodeId) {
  if (!nodeId) return null;
  return nodesOf(graph).find((node) => node.id === nodeId) || null;
}

/**
 * The edge with this id, or `null`.
 * @param {DevGraph} graph
 * @param {string} edgeId
 * @returns {GraphEdge|null}
 */
export function edgeById(graph, edgeId) {
  if (!edgeId) return null;
  return edgesOf(graph).find((edge) => edge.id === edgeId) || null;
}

/** Every edge leaving `nodeId` — THE DRAWING, rework arms included. */
export function outboundEdges(graph, nodeId) {
  return edgesOf(graph).filter((edge) => edge.source === nodeId);
}

/** Every edge entering `nodeId` — THE DRAWING, rework arms included. */
export function inboundEdges(graph, nodeId) {
  return edgesOf(graph).filter((edge) => edge.target === nodeId);
}

/**
 * The DEPENDENCY layer: every edge except the rework arms.
 *
 * A rework arm is a ROUTE BACK, never a dependency — leaving it in here would
 * make its target wait for the gate that comes after it, which is the real
 * cycle the format exists to avoid. Same split as `graph-validate.ts`.
 */
function dependencyEdges(graph) {
  return edgesOf(graph).filter((edge) => edge.rework !== true);
}

/**
 * Every node that RUNS BEFORE `nodeId`, over the dependency layer.
 *
 * The single predicate behind two opposite rules: a plain edge may NOT point at
 * an ancestor (that is a cycle), and a rework arm MUST (that is what "goes
 * back" means).
 *
 * @param {DevGraph} graph
 * @param {string} nodeId
 * @returns {Set<string>}
 */
export function ancestorsOf(graph, nodeId) {
  const known = new Set(nodesOf(graph).map((node) => node.id));
  const edges = dependencyEdges(graph);
  const result = new Set();
  const queue = [nodeId];
  const visited = new Set([nodeId]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.target !== current) continue;
      if (!known.has(edge.source)) continue;
      result.add(edge.source);
      if (visited.has(edge.source)) continue;
      visited.add(edge.source);
      queue.push(edge.source);
    }
  }
  return result;
}

/**
 * Unique ids of the nodes that point AT `nodeId` AS DEPENDENCIES, in
 * edge-declaration order. Mirrors `directPredecessors` in `graph-validate.ts`.
 */
export function directPredecessors(graph, nodeId) {
  const known = new Set(nodesOf(graph).map((node) => node.id));
  const out = [];
  for (const edge of dependencyEdges(graph)) {
    if (edge.target !== nodeId) continue;
    if (edge.source === nodeId) continue;
    if (!known.has(edge.source)) continue;
    if (!out.includes(edge.source)) out.push(edge.source);
  }
  return out;
}

/**
 * The arms this node routes on, or `null` when it does not branch.
 *
 * `null` and `[]` are different statements, exactly as in `branchOutcomesOf`
 * server-side: `null` means "one way out, so an edge must NOT name an arm";
 * `[]` means "it branches but declares no arm", which is a defect.
 *
 * @param {GraphNode|null} node
 * @param {object} [catalog] the `/api/graphs/catalog` payload, for arm labels
 * @returns {BranchOutcome[]|null}
 */
export function outcomesOf(node, catalog) {
  if (!isRecord(node)) return null;
  if (node.kind === 'gate') {
    return recordsOf(node.outcomes).map((outcome) => ({ id: outcome.id, label: outcome.label }));
  }
  if (node.kind !== 'research') return null;
  if (node.outputKind === 'info') return null;
  if (node.outputKind === 'boolean') return booleanOutcomes(catalog);
  return recordsOf(node.choices).map((choice) => ({ id: choice.id, label: choice.label }));
}

/** The boolean arms, preferring what the server serves over the local mirror. */
function booleanOutcomes(catalog) {
  const served = recordsOf(catalog && catalog.researchBooleanOutcomes);
  if (served.length > 0) return served.map((outcome) => ({ id: outcome.id, label: outcome.label }));
  return RESEARCH_BOOLEAN_OUTCOMES.map((outcome) => ({ ...outcome }));
}

/** The caps in force: what the catalog serves, falling back to the mirror. */
export function capsOf(catalog) {
  const served = isRecord(catalog) && isRecord(catalog.caps) ? catalog.caps : {};
  return {
    maxNodes: Number.isFinite(served.maxNodes) ? served.maxNodes : GRAPH_CAPS.maxNodes,
    maxEdges: Number.isFinite(served.maxEdges) ? served.maxEdges : GRAPH_CAPS.maxEdges,
  };
}

/**
 * Sort the issues a `POST /api/graphs/validate` (or a refused `/compile`)
 * answered with into the three places the UI can actually show them.
 *
 * THE `global` BUCKET IS THE POINT. Almost every issue is ANCHORED — it carries
 * a `nodeId` or an `edgeId`, and the canvas highlights that chip. But the
 * server contributes one code the graph validator cannot: `invalid-schema`, for
 * a payload that is not a devgraph at all (`_format` wrong, `createdAt`
 * missing, an unknown `kind`), and it arrives with NO anchor because there is no
 * single node to blame. A UI that only knows how to highlight nodes would drop
 * that issue on the floor and show a green canvas for a graph the store will
 * refuse to save. `global` is where it goes.
 *
 * Anchors that name a node the graph no longer holds also land in `global`
 * rather than vanishing — a stale issue you can read beats one you cannot.
 *
 * An issue carrying BOTH anchors (`branch-outcome-multiple-edges` does) is
 * filed under its NODE, the cause, and appears exactly ONCE — so the three
 * buckets always sum back to the input, and a badge counting them cannot
 * double-count one drawing mistake.
 *
 * @param {any[]} issues `errors` or `warnings` as served
 * @param {DevGraph} [graph] when given, anchors are checked against it
 * @returns {{ global: any[], byNode: Record<string, any[]>, byEdge: Record<string, any[]> }}
 */
export function groupIssues(issues, graph) {
  /** @type {{ global: any[], byNode: Record<string, any[]>, byEdge: Record<string, any[]> }} */
  const out = { global: [], byNode: {}, byEdge: {} };
  const knownNodes = graph ? new Set(nodesOf(graph).map((node) => node.id)) : null;
  const knownEdges = graph ? new Set(edgesOf(graph).map((edge) => edge.id)) : null;

  for (const issue of recordsOf(issues)) {
    const nodeId = text(issue.nodeId);
    const edgeId = text(issue.edgeId);
    if (nodeId && (!knownNodes || knownNodes.has(nodeId))) {
      (out.byNode[nodeId] = out.byNode[nodeId] || []).push(issue);
      continue;
    }
    if (edgeId && (!knownEdges || knownEdges.has(edgeId))) {
      (out.byEdge[edgeId] = out.byEdge[edgeId] || []).push(issue);
      continue;
    }
    out.global.push(issue);
  }
  return out;
}

// --- Copying ----------------------------------------------------------------

/** A JSON-ish deep copy. Keeps the caller's objects out of the new graph. */
function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (isRecord(value)) {
    const out = {};
    for (const key of Object.keys(value)) {
      if (key === '__proto__') continue;
      out[key] = copyValue(value[key]);
    }
    return out;
  }
  return value;
}

function cloneNode(node) {
  return /** @type {GraphNode} */ (copyValue(node));
}

function cloneEdge(edge) {
  return /** @type {GraphEdge} */ (copyValue(edge));
}

/**
 * A new graph object with new node and edge objects. Entries that are not
 * records are dropped here, the same way the server's readers drop them.
 * @param {DevGraph} graph
 * @returns {DevGraph}
 */
function cloneGraph(graph) {
  const source = /** @type {DevGraph} */ (isRecord(graph) ? graph : {});
  const out = { ...source };
  out.meta = isRecord(source.meta) ? copyValue(source.meta) : {};
  out.nodes = nodesOf(graph).map(cloneNode);
  out.edges = edgesOf(graph).map(cloneEdge);
  return /** @type {DevGraph} */ (out);
}

// --- Ids --------------------------------------------------------------------

/** Smallest `<prefix>-<n>` (n >= 1) not already taken. Deterministic. */
function nextSequentialId(taken, prefix) {
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * An unused node id for a new node of `kind` — `action-1`, `action-2`, …
 * Kind-prefixed, not random: node ids become step names in the compiled
 * pipeline, and `action-3` is something a human can find in a run log.
 */
export function newNodeId(graph, kind) {
  return nextSequentialId(new Set(nodesOf(graph).map((node) => node.id)), kind || 'node');
}

/** An unused edge id — `e-1`, `e-2`, … */
export function newEdgeId(graph) {
  return nextSequentialId(new Set(edgesOf(graph).map((edge) => edge.id)), 'e');
}

// --- Construction -----------------------------------------------------------

/**
 * A fresh graph carrying ONLY the root prompt node.
 *
 * The CLIENT-SIDE mirror of `emptyDevGraph` (`graph-schema.ts`), for the moment
 * between "new graph" and the first save. The server re-stamps `createdAt` /
 * `updatedAt` when it writes, so its copy stays authoritative; nothing here
 * pre-draws a topology, because a suggested method is a method somebody else
 * underwrote.
 *
 * `now` is the ONE tolerated impurity, mirroring the server helper: omit it and
 * the clock is read. Pass it from tests and from any caller that needs a
 * reproducible object.
 *
 * @param {string} id slug — names the file on disk
 * @param {string} name human-readable name
 * @param {string} [now] ISO-8601 timestamp
 * @returns {DevGraph}
 */
export function emptyGraph(id, name, now) {
  const stamp = text(now) || new Date().toISOString();
  return {
    _format: DEVGRAPH_FORMAT,
    id: String(id || ''),
    name: String(name || ''),
    createdAt: stamp,
    updatedAt: stamp,
    meta: {},
    nodes: [
      {
        id: 'prompt-1',
        kind: 'prompt',
        label: NODE_SEEDS.prompt.label,
        position: { x: 0, y: 0 },
        goal: NODE_SEEDS.prompt.goal,
      },
    ],
    edges: [],
  };
}

/** A position object built from anything, defaulting to the origin. */
function normalizePosition(position) {
  if (!isRecord(position)) return { x: 0, y: 0 };
  return { x: num(position.x), y: num(position.y) };
}

/**
 * A spot for a node hung off `sourceId`: one column to the right, one lane down
 * per sibling already fanned out from that point, nudged until it is free.
 *
 * The lane per sibling is what makes "more than one from the same starting
 * point" READ as parallel on the canvas instead of stacking into one chip.
 *
 * @param {DevGraph} graph
 * @param {string} sourceId
 * @returns {GraphPosition}
 */
export function suggestPosition(graph, sourceId) {
  const source = nodeById(graph, sourceId);
  const base = source ? normalizePosition(source.position) : { x: 0, y: 0 };
  const lane = outboundEdges(graph, sourceId).length;
  const spot = { x: base.x + LANE_X, y: base.y + lane * LANE_Y };
  const taken = nodesOf(graph).map((node) => normalizePosition(node.position));
  let guard = 0;
  while (taken.some((p) => p.x === spot.x && p.y === spot.y) && guard < 200) {
    spot.y += LANE_Y;
    guard += 1;
  }
  return spot;
}

/** The fields a caller may not set through `opts` / a patch. */
const RESERVED_KEYS = new Set(['id', 'kind', '__proto__']);

/** Apply a shallow patch to an ALREADY-CLONED node. `undefined` deletes. */
function applyPatch(node, patch) {
  for (const key of Object.keys(patch)) {
    if (RESERVED_KEYS.has(key)) continue;
    // The root has nothing to join — it waits for nobody by construction.
    if (key === 'join' && node.kind === 'prompt') continue;
    const value = patch[key];
    if (value === undefined) delete node[key];
    else node[key] = copyValue(value);
  }
  return node;
}

/** The node a `kind` opens as, before the caller's extra fields land on it. */
function seedNode(kind, id, opts) {
  const seed = NODE_SEEDS[kind];
  const node = {
    id,
    kind,
    label: text(opts.label) || seed.label,
    position: normalizePosition(opts.position),
  };
  if (kind === 'prompt') {
    node.goal = seed.goal;
    return node;
  }
  // Every node but the root waits on its predecessors until the human says
  // otherwise: an edge somebody drew is a dependency by default.
  node.join = { mode: 'all' };
  if (kind === 'action') {
    node.block = text(opts.block) || seed.block;
  } else if (kind === 'research') {
    node.query = seed.query;
    node.useContext = true;
    node.outputKind = 'info';
  } else if (kind === 'gate') {
    node.condition = seed.condition;
    // Two arms and a forward default, so the gate is a GATE the moment it
    // lands: huu's rule is that the default fires when the judge FAILS, so it
    // has to be the safe route forward.
    node.outcomes = [
      { id: 'approved', label: 'Aprovado' },
      { id: 'rework', label: 'Retrabalho' },
    ];
    node.defaultOutcome = 'approved';
  }
  return node;
}

/**
 * Drop a node on the canvas.
 *
 * @param {DevGraph} graph
 * @param {string} kind `prompt` | `action` | `research` | `gate`
 * @param {object} [opts] `{label?, position?, block?, id?, …}` — every other key
 *   lands on the node as-is (`scope`, `outputKind`, `choices`, `goal`, …)
 * @returns {{ graph: DevGraph, nodeId: string|null, error?: GraphDenial }}
 */
export function addNode(graph, kind, opts = {}) {
  const options = isRecord(opts) ? opts : {};
  if (!NODE_SEEDS[kind]) {
    return {
      graph,
      nodeId: null,
      error: deny('invalid-node-kind', `"${String(kind)}" não é um tipo de nó do huu.`),
    };
  }
  const caps = capsOf(options.catalog);
  if (nodesOf(graph).length >= caps.maxNodes) {
    return {
      graph,
      nodeId: null,
      error: deny(
        'too-many-nodes',
        `O grafo já tem ${caps.maxNodes} nós, que é o limite. Um método que não cabe numa tela não é um método.`,
      ),
    };
  }
  const next = cloneGraph(graph);
  const nodeId = text(options.id) || newNodeId(next, kind);
  const node = seedNode(kind, nodeId, options);
  const extra = { ...options };
  delete extra.label;
  delete extra.position;
  delete extra.id;
  delete extra.catalog;
  if (kind === 'action') delete extra.block;
  applyPatch(node, extra);
  next.nodes = [...next.nodes, node];
  return { graph: next, nodeId };
}

// --- Connecting -------------------------------------------------------------

/** @returns {GraphDenial} */
function deny(code, message) {
  return { code, message };
}

/** @returns {GraphVerdict} */
function no(code, message) {
  return { ok: false, code, message };
}

/** The label of an arm, falling back to its id. */
function armLabel(outcomes, id) {
  const found = (outcomes || []).find((outcome) => outcome.id === id);
  return (found && text(found.label)) || id;
}

/**
 * May this connection be drawn? IMMEDIATE feedback, not a second authority —
 * every `code` is the SAME string `graph-validate.ts` would report, so the UI
 * keeps one table of sentences. The server still decides on save.
 *
 * The rules, and the reason each one exists:
 *
 *  - the root takes no inbound edge (`prompt-has-inbound`);
 *  - a branching node routes each arm to exactly ONE step, because huu's
 *    `CheckStep` carries a single `nextStepName` per outcome — so the second
 *    edge off one arm is refused with the WAY AROUND in the message
 *    (`branch-outcome-multiple-edges`);
 *  - a NON-branching node may fan out to as many targets as the human likes.
 *    That is the parallelism, and it is the whole point of the canvas: several
 *    fronts leaving the same point, merged by the wave at the end of the stage;
 *  - a plain edge pointing at an ancestor is a dependency cycle (`cycle`);
 *  - a `rework` arm must do the opposite — leave a branching node, name its arm
 *    and point BACK at an ancestor — and may never be the node's default,
 *    because the default fires when the judge fails and must go forward;
 *  - the drawn caps hold (`too-many-edges`).
 *
 * @param {DevGraph} graph
 * @param {string} sourceId
 * @param {string} targetId
 * @param {Record<string, any>} [opts] `{sourceOutcome?, rework?, catalog?}`
 * @returns {GraphVerdict}
 */
export function canConnect(graph, sourceId, targetId, opts = {}) {
  const options = isRecord(opts) ? opts : {};
  const caps = capsOf(options.catalog);
  const source = nodeById(graph, sourceId);
  const target = nodeById(graph, targetId);

  if (!source || !target) {
    return no(
      'edge-unknown-node',
      `A ligação "${String(sourceId)}" → "${String(targetId)}" cita algo que não é um nó do grafo.`,
    );
  }
  if (sourceId === targetId) {
    return no('self-edge', `"${source.label}" não pode se ligar a si mesmo.`);
  }
  if (target.kind === 'prompt') {
    return no(
      'prompt-has-inbound',
      'A entrada do prompt é a raiz do método: ela é o começo de tudo e não recebe ligações.',
    );
  }
  if (edgesOf(graph).length >= caps.maxEdges) {
    return no('too-many-edges', `O grafo já tem ${caps.maxEdges} ligações, que é o limite.`);
  }

  const outcome = text(options.sourceOutcome);
  const rework = options.rework === true;
  const outcomes = outcomesOf(source, options.catalog);
  const ancestors = ancestorsOf(graph, sourceId);

  // --- the arm that goes back ---
  // ONE DEFECT, ONE CODE: when a rework rule fires it REPLACES the generic
  // outcome codes, exactly as the server's validator does.
  if (rework) {
    if (outcomes === null) {
      return no(
        'rework-edge-not-from-branch',
        `"${source.label}" tem uma saída só, então não há braço onde pendurar um retrabalho. Só uma verificação (ou uma pesquisa que ramifica) tem veredito para voltar.`,
      );
    }
    if (!outcome) {
      return no(
        'rework-edge-needs-outcome',
        'Um retrabalho continua sendo um BRAÇO: diga qual veredito de "' +
          source.label +
          '" leva de volta.',
      );
    }
    if (!ancestors.has(targetId)) {
      return no(
        'rework-edge-not-backward',
        `"${target.label}" não roda antes de "${source.label}", então voltar para lá não é voltar. Um retrabalho aponta para um nó de que este já depende.`,
      );
    }
    if (!outcomes.some((entry) => entry.id === outcome)) {
      return no(
        'edge-outcome-unknown',
        `"${source.label}" não declara o braço "${outcome}".`,
      );
    }
    if (text(source.defaultOutcome) === outcome) {
      return no(
        'default-outcome-is-rework',
        `"${armLabel(outcomes, outcome)}" é o veredito padrão de "${source.label}". O padrão dispara quando o juiz FALHA, então ele tem que ser o caminho seguro PARA A FRENTE — nunca o laço.`,
      );
    }
  } else if (outcomes === null) {
    if (outcome) {
      return no(
        'edge-outcome-forbidden',
        `"${source.label}" tem uma saída só, então esta ligação não nomeia braço nenhum.`,
      );
    }
  } else if (!outcome) {
    return no(
      'edge-outcome-required',
      `"${source.label}" ramifica: escolha de qual braço esta ligação sai.`,
    );
  } else if (!outcomes.some((entry) => entry.id === outcome)) {
    return no('edge-outcome-unknown', `"${source.label}" não declara o braço "${outcome}".`);
  }

  const key = outcome || null;
  const duplicate = edgesOf(graph).some(
    (edge) =>
      edge.source === sourceId &&
      edge.target === targetId &&
      (text(edge.sourceOutcome) || null) === key,
  );
  if (duplicate) {
    return no(
      'duplicate-edge',
      `Esta ligação de "${source.label}" para "${target.label}" já está desenhada.`,
    );
  }

  if (outcomes !== null && outcome) {
    const taken = outboundEdges(graph, sourceId).filter(
      (edge) => text(edge.sourceOutcome) === outcome,
    );
    if (taken.length > 0) {
      const busy = nodeById(graph, taken[0].target);
      return no(
        'branch-outcome-multiple-edges',
        `O braço "${armLabel(outcomes, outcome)}" de "${source.label}" já segue para "${
          busy ? busy.label : taken[0].target
        }". Uma verificação do huu roteia cada braço para UM passo só — ligue este braço a UM bloco e ramifique a partir dele.`,
      );
    }
  }

  if (!rework && ancestors.has(targetId)) {
    return no(
      'cycle',
      `"${target.label}" já roda antes de "${source.label}", então esta ligação fecha um ciclo. Se a intenção é voltar e refazer, desenhe o braço como RETRABALHO a partir de uma verificação.`,
    );
  }

  return { ok: true };
}

/**
 * Draw a connection.
 *
 * @param {DevGraph} graph
 * @param {string} sourceId
 * @param {string} targetId
 * @param {Record<string, any>} [opts] `{sourceOutcome?, rework?, id?, catalog?}`
 * @returns {{ graph: DevGraph, edgeId?: string, error?: GraphDenial }}
 *   on refusal: the SAME graph back, plus `error`.
 */
export function connect(graph, sourceId, targetId, opts = {}) {
  const options = isRecord(opts) ? opts : {};
  const verdict = canConnect(graph, sourceId, targetId, options);
  if (!verdict.ok) return { graph, error: deny(verdict.code, verdict.message) };

  const next = cloneGraph(graph);
  const edgeId = text(options.id) || newEdgeId(next);
  /** @type {GraphEdge} */
  const edge = { id: edgeId, source: sourceId, target: targetId };
  const outcome = text(options.sourceOutcome);
  if (outcome) edge.sourceOutcome = outcome;
  // `true` and ONLY `true`. The OFF state of this field is its ABSENCE — a
  // `rework: false` would read as "a rework arm that is disabled", and there is
  // no such thing (`graph-types.ts`).
  if (options.rework === true) edge.rework = true;
  next.edges = [...next.edges, edge];
  return { graph: next, edgeId };
}

// --- Removing ---------------------------------------------------------------

/**
 * Drop references a removal just invalidated.
 *
 * Removing a node or an edge can leave a join subset naming something that no
 * longer flows in, or a fan-out reading a producer that no longer exists —
 * both of which the server reports as errors on the next save. Repairing them
 * here keeps a delete from silently breaking a graph somewhere the human is not
 * looking. An emptied subset falls back to `all`, never to an empty subset
 * (which is its own error, `join-subset-empty`).
 */
function pruneDanglingRefs(graph) {
  const known = new Set(graph.nodes.map((node) => node.id));
  graph.nodes = graph.nodes.map((node) => {
    let out = node;
    if (isRecord(out.join) && out.join.mode === 'subset') {
      const direct = directPredecessors(graph, out.id);
      const current = Array.isArray(out.join.of) ? out.join.of : [];
      const kept = current.filter((id) => direct.includes(id));
      if (kept.length !== current.length) {
        out = { ...out, join: kept.length > 0 ? { mode: 'subset', of: kept } : { mode: 'all' } };
      }
    }
    if (typeof out.fanOutFrom === 'string' && !known.has(out.fanOutFrom)) {
      out = { ...out };
      delete out.fanOutFrom;
      // `scope: 'memory'` without a producer is `scope-memory-needs-fanout`.
      if (out.scope === 'memory') delete out.scope;
    }
    return out;
  });
  return graph;
}

/**
 * Remove a node AND every edge that touched it.
 * @returns {DevGraph} the same reference when there was nothing to remove.
 */
export function removeNode(graph, nodeId) {
  if (!nodeById(graph, nodeId)) return graph;
  const next = cloneGraph(graph);
  next.nodes = next.nodes.filter((node) => node.id !== nodeId);
  next.edges = next.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
  return pruneDanglingRefs(next);
}

/**
 * Remove one connection.
 * @returns {DevGraph} the same reference when there was nothing to remove.
 */
export function removeEdge(graph, edgeId) {
  if (!edgeById(graph, edgeId)) return graph;
  const next = cloneGraph(graph);
  next.edges = next.edges.filter((edge) => edge.id !== edgeId);
  return pruneDanglingRefs(next);
}

// --- Editing ----------------------------------------------------------------

/**
 * Move a node. Non-finite coordinates are refused rather than written: a
 * `NaN` survives every clamp downstream and only dies at the pipeline schema,
 * where the compiler blames huu for a value the drawing carried.
 *
 * @returns {DevGraph} the same reference when the node is already there.
 */
export function moveNode(graph, nodeId, position) {
  const node = nodeById(graph, nodeId);
  if (!node || !isRecord(position)) return graph;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return graph;
  const current = normalizePosition(node.position);
  if (current.x === x && current.y === y) return graph;
  const next = cloneGraph(graph);
  next.nodes = next.nodes.map((entry) =>
    entry.id === nodeId ? { ...entry, position: { x, y } } : entry,
  );
  return next;
}

/**
 * Shallow-merge fields onto a node. `undefined` DELETES a field, which is how
 * the inspector clears an optional one. `id` and `kind` are identity and are
 * never patched — changing a node's kind mid-flight would leave the fields of
 * the old kind sitting on it.
 *
 * @returns {DevGraph} the same reference when the node is unknown.
 */
export function updateNode(graph, nodeId, patch) {
  if (!nodeById(graph, nodeId) || !isRecord(patch)) return graph;
  const next = cloneGraph(graph);
  next.nodes = next.nodes.map((node) => (node.id === nodeId ? applyPatch(node, patch) : node));
  return next;
}

/**
 * Set a node's join policy.
 *
 * `all` waits for every predecessor; `subset` waits only for the listed ones.
 * HONEST NOTE for whatever the UI says about it: relaxing a join removes the
 * DEPENDENCY (this node stops waiting for those branches, and stops failing
 * when they fail). It does NOT remove the wave's merge barrier — huu still
 * merges every branch of the stage before the next one starts.
 *
 * @param {DevGraph} graph
 * @param {string} nodeId
 * @param {Record<string, any>} join a {@link JoinPolicy}
 * @returns {DevGraph} the same reference for the root (it joins nothing) or an
 *   unreadable policy.
 */
export function setJoin(graph, nodeId, join) {
  const node = nodeById(graph, nodeId);
  if (!node || node.kind === 'prompt') return graph;
  const normalized = normalizeJoin(join);
  if (!normalized) return graph;
  const next = cloneGraph(graph);
  next.nodes = next.nodes.map((entry) =>
    entry.id === nodeId ? { ...entry, join: normalized } : entry,
  );
  return next;
}

function normalizeJoin(join) {
  if (!isRecord(join)) return null;
  if (join.mode === 'all') return { mode: 'all' };
  if (join.mode === 'subset') {
    const of = (Array.isArray(join.of) ? join.of : []).filter(
      (id) => typeof id === 'string' && id.length > 0,
    );
    return { mode: 'subset', of: [...new Set(of)] };
  }
  return null;
}

// --- React Flow -------------------------------------------------------------

/**
 * Project a devgraph into the shape React Flow renders.
 *
 * `type` is the node KIND, so the canvas registers one custom node component
 * per kind and never switches on data. `sourceHandle` is the ARM id, which is
 * how React Flow knows which handle an edge leaves from — the same string the
 * compiled `CheckStep` routes on.
 *
 * `data.node` is the SAME object the graph holds, not a copy: this module never
 * mutates, so sharing is safe. Treat it as read-only — every change goes back
 * through the mutations above.
 *
 * @param {DevGraph} graph
 * @param {object} [catalog]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function toFlow(graph, catalog) {
  const nodes = nodesOf(graph).map((node) => ({
    id: node.id,
    type: node.kind,
    position: normalizePosition(node.position),
    data: {
      kind: node.kind,
      label: node.label,
      outcomes: outcomesOf(node, catalog) || [],
      node,
    },
  }));

  const edges = edgesOf(graph).map((edge) => {
    const source = nodeById(graph, edge.source);
    const outcomes = outcomesOf(source, catalog);
    const outcome = text(edge.sourceOutcome);
    const rework = edge.rework === true;
    const flow = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: outcome || null,
      targetHandle: null,
      data: { sourceOutcome: outcome || null, rework },
    };
    if (outcome) flow.label = armLabel(outcomes, outcome);
    if (rework) flow.className = 'rework';
    return flow;
  });

  return { nodes, edges };
}

/**
 * Fold React Flow's change events back into the graph.
 *
 * Only the two that carry MEANING are applied: `position` (the human dragged a
 * chip) and `remove` (they deleted one). `select` and `dimensions` are canvas
 * presentation and belong to React Flow's own state — writing them into the
 * saved method would put a selection highlight in a git diff.
 *
 * A `remove` change names an id without saying whether it is a node or an edge,
 * so it is resolved against the graph, nodes first.
 *
 * @param {DevGraph} graph
 * @param {any[]} changes React Flow's `NodeChange[]` / `EdgeChange[]`
 * @returns {DevGraph} the same reference when nothing applied.
 */
export function fromFlowChanges(graph, changes) {
  const list = Array.isArray(changes) ? changes : [];
  let next = graph;
  for (const change of list) {
    if (!isRecord(change)) continue;
    if (change.type === 'position') {
      if (isRecord(change.position)) next = moveNode(next, change.id, change.position);
      continue;
    }
    if (change.type === 'remove') {
      if (nodeById(next, change.id)) next = removeNode(next, change.id);
      else if (edgeById(next, change.id)) next = removeEdge(next, change.id);
    }
  }
  return next;
}
