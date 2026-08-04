// Structural rules for `huu-devgraph-v1` — is this drawing a sound METHOD?
//
// `graph-schema.ts` already said the file is a devgraph. This module says
// whether the method it draws can run: one entry, no cycles, every branch with
// exactly one edge per arm and a safe forward default, every fan-out reading a
// list somebody upstream actually writes.
//
// TWO PROPERTIES THIS MODULE PROMISES, and both are load-bearing:
//
//  1. IT NEVER THROWS. Every problem comes back as data — INCLUDING the ones
//     the type signature says cannot happen. `{"nodes":[null]}` is a real
//     payload: `JSON.parse` produces it, a half-finished editor sends it, and
//     `parseDevGraph` may never have run. So every list this module reads is
//     filtered down to the entries it can understand, and each discard is
//     reported as `malformed-node-entry` / `malformed-edge-entry`. The editor
//     validates on every keystroke of a half-drawn graph — a throw there is a
//     blank canvas, and a human who lost their drawing does not draw again.
//  2. THE CODES ARE STABLE. `GraphIssue.code` is the identity of a problem; the
//     UI maps it to a translated sentence. `message` is an English fallback for
//     developers and may be reworded freely; renaming a `code` is a breaking
//     change to the front-end.
//
// The rules themselves are not opinions — each one exists because huu's own
// pipeline layer would otherwise reject, or silently mis-run, the compiled
// output: `dependsOn` may only point backwards (hence `cycle`), a `CheckStep`
// routes to exactly ONE `nextStepName` per outcome (hence
// `branch-outcome-multiple-edges`), and exactly one outcome is `default: true`
// and fires on judge failure (hence `default-outcome-missing`). Catching that
// here, on the canvas, is the difference between a human fixing a drawing and
// an agent run dying in stage 3.
//
// TWO LAYERS OVER ONE DRAWING (see `isReworkEdge` in `graph-types.ts` for the
// argument; this module is where the split is mechanical):
//
//   DEPENDENCY layer — `dependencyEdges()`, i.e. every edge WITHOUT `rework`.
//       `topoOrder`, `ancestorsOf`, `directPredecessors` and
//       `effectiveDependencies` all read THIS layer, because each of them
//       answers a question about ORDER ("what runs before what", "what does
//       this wait for"), and `cycle` is looked for here and nowhere else.
//   ACTIVATION layer — every edge. `inboundEdges`/`outboundEdges` and
//       reachability read THIS one, because a rework arm is a real route: it
//       reaches its target, it needs its `nextStepName`, and the node it points
//       at is not orphaned by being pointed at backwards.
//
// A rework arm therefore points backwards WITHOUT being a cycle, which is the
// whole reason the format can express "if it failed, go back and fix it".
//
// Keep this file pure (no fs / no env / no clock).

import {
  DEVGRAPH_MAX_BRANCHES,
  DEVGRAPH_MAX_CONDITION,
  DEVGRAPH_MAX_DEPTH,
  DEVGRAPH_MAX_EDGES,
  DEVGRAPH_MAX_FILES,
  DEVGRAPH_MAX_GOAL,
  DEVGRAPH_MAX_LABEL,
  DEVGRAPH_MAX_NODES,
  DEVGRAPH_MAX_NOTES,
  DEVGRAPH_MAX_PROMPT,
  DEVGRAPH_MAX_QUERY,
  DEVGRAPH_NODE_ID_PATTERN,
  DEVGRAPH_SLUG_PATTERN,
  hasJoin,
  isReworkEdge,
  type DevGraph,
  type GateOutcome,
  type GraphEdge,
  type GraphErrorCode,
  type GraphIssue,
  type GraphNode,
  type GraphValidation,
  type GraphWarningCode,
  type ResearchChoice,
} from './graph-types.js';
import { findBlock } from './node-catalog.js';

/**
 * The two arms of a `boolean` research node. Fixed ids, because the compiler
 * routes on them and a judge is told to answer with one of them; the labels are
 * pt-BR palette chrome.
 */
export const RESEARCH_BOOLEAN_OUTCOMES: readonly { id: string; label: string }[] = [
  { id: 'yes', label: 'Sim' },
  { id: 'no', label: 'Não' },
];

// --- Defensive readers ------------------------------------------------------
//
// The signature says `DevGraph`, but this module is called on values that came
// from a browser, a file and a half-finished editor state. `never throws` has
// to survive a `nodes` that is not an array AND a `nodes` that IS an array with
// a `null` sitting in it — the second is the one that used to blow up, because
// checking `Array.isArray` says nothing about what the array CONTAINS.
//
// Every reader below drops the entries it cannot understand and keeps the rest,
// so a single junk element never costs the human the nine good nodes around it.
// `validateGraph` reports each discard, which is the honest half of the deal:
// silently swallowing an entry would let a file lose a node without a word.

/** A plain object — the only thing a node, an edge or a branch arm can be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** The entries of a list that are plain objects, in declaration order. */
function recordsOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : [];
}

/** The entries of a list that are strings, in declaration order. */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

/** The indices of the entries a reader above would drop. `[]` for a non-array. */
function malformedIndices(value: unknown, keep: (entry: unknown) => boolean): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!keep(value[index])) out.push(index);
  }
  return out;
}

function nodesOf(graph: DevGraph): GraphNode[] {
  return recordsOf<GraphNode>(graph?.nodes);
}

function edgesOf(graph: DevGraph): GraphEdge[] {
  return recordsOf<GraphEdge>(graph?.edges);
}

function lengthOf(value: unknown): number {
  return typeof value === 'string' ? value.length : 0;
}

/**
 * A real slug — `typeof` FIRST, deliberately.
 *
 * `DEVGRAPH_SLUG_PATTERN.test(undefined)` coerces to the string `"undefined"`,
 * which matches the pattern: a missing id would sail through the very check
 * written to catch it.
 */
function isSlug(value: unknown): boolean {
  return typeof value === 'string' && DEVGRAPH_SLUG_PATTERN.test(value);
}

/**
 * `NaN` / `±Infinity` in a field that is otherwise a number.
 *
 * Worth its own code because of where it lands: `Math.trunc(NaN)` is `NaN`,
 * `clamp(NaN, 1, 50)` is `NaN`, and `capped !== requested` is TRUE for two
 * NaNs — so a non-finite number is not merely untidy, it slips past every
 * repair the compiler has and only dies at `PipelineSchema`, where the message
 * says "this is a huu bug". A value the drawing carried must never be reported
 * as huu's defect.
 */
function isNonFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && !Number.isFinite(value);
}

// --- Pure helpers (the compiler consumes these) -----------------------------

/** Every edge whose `target` is `nodeId`, in declaration order. THE DRAWING — rework arms included. */
export function inboundEdges(graph: DevGraph, nodeId: string): GraphEdge[] {
  return edgesOf(graph).filter((edge) => edge.target === nodeId);
}

/** Every edge whose `source` is `nodeId`, in declaration order. THE DRAWING — rework arms included. */
export function outboundEdges(graph: DevGraph, nodeId: string): GraphEdge[] {
  return edgesOf(graph).filter((edge) => edge.source === nodeId);
}

/**
 * The DEPENDENCY layer: every edge except the rework arms.
 *
 * One function, so "what orders this graph" is decided in exactly one place —
 * `topoOrder`, `ancestorsOf` and `directPredecessors` all read it. A rework arm
 * left in here would make the target wait for the gate that comes AFTER it,
 * which is a real dependency cycle and would take the format straight back to
 * refusing the loop it exists to allow.
 */
function dependencyEdges(graph: DevGraph): GraphEdge[] {
  return edgesOf(graph).filter((edge) => !isReworkEdge(edge));
}

/** Inbound edges of `nodeId` in the DEPENDENCY layer. */
function dependencyInbound(graph: DevGraph, nodeId: string): GraphEdge[] {
  return dependencyEdges(graph).filter((edge) => edge.target === nodeId);
}

/**
 * Unique ids of the nodes that point AT `nodeId` AS DEPENDENCIES, in
 * edge-declaration order.
 *
 * Self-edges and edges from ids that are not nodes are skipped: neither can be
 * a dependency, and both are reported separately. Rework arms are skipped for
 * the same reason — a route back is not something the target waits for.
 */
export function directPredecessors(graph: DevGraph, nodeId: string): string[] {
  const known = new Set(nodesOf(graph).map((node) => node.id));
  const out: string[] = [];
  for (const edge of dependencyInbound(graph, nodeId)) {
    if (edge.source === nodeId) continue;
    if (!known.has(edge.source)) continue;
    if (!out.includes(edge.source)) out.push(edge.source);
  }
  return out;
}

/**
 * Kahn's algorithm over the DEPENDENCY layer, deterministic: whenever several
 * nodes are ready, the one declared FIRST wins. Two runs over the same graph
 * give the same array, which is what lets the compiler emit byte-identical
 * pipelines.
 *
 * `cycle` is true when some node could never be emitted. `order` then holds the
 * PARTIAL order — everything outside it is exactly the set of nodes tangled in
 * (or downstream of) the cycle, which is what the validator reports.
 *
 * Rework arms are excluded, so a loop-back gate does NOT make this report a
 * cycle and the emission order stays the order the work actually runs in.
 */
export function topoOrder(graph: DevGraph): { order: string[]; cycle: boolean } {
  const nodes = nodesOf(graph);
  const ids = nodes.map((node) => node.id);
  const known = new Set(ids);
  const edges = dependencyEdges(graph).filter(
    (edge) => known.has(edge.source) && known.has(edge.target),
  );

  const indegree = new Map<string, number>();
  for (const id of known) indegree.set(id, 0);
  for (const edge of edges) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);

  const order: string[] = [];
  const emitted = new Set<string>();
  for (;;) {
    const next = ids.find((id) => !emitted.has(id) && (indegree.get(id) ?? 0) === 0);
    if (next === undefined) break;
    emitted.add(next);
    order.push(next);
    for (const edge of edges) {
      if (edge.source === next) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) - 1);
    }
  }

  return { order, cycle: emitted.size < known.size };
}

/**
 * Every node that RUNS BEFORE `nodeId` — the transitive closure of the
 * DEPENDENCY layer, walked backwards.
 *
 * Rework arms are excluded on purpose, and both callers depend on it: a
 * fan-out's producer must genuinely run first (a producer reachable only
 * through a loop-back arm has written nothing when the consumer starts), and
 * `rework-edge-not-backward` asks precisely "is my target upstream of me in
 * the order the work runs".
 *
 * Faithful to the drawing rather than tidy: in a graph with a DEPENDENCY cycle
 * a node CAN be its own ancestor, and this returns that. Callers that need
 * "strictly upstream" (the fan-out check does) must exclude the node themselves.
 */
export function ancestorsOf(graph: DevGraph, nodeId: string): Set<string> {
  const known = new Set(nodesOf(graph).map((node) => node.id));
  const result = new Set<string>();
  const queue: string[] = [nodeId];
  const visited = new Set<string>([nodeId]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of dependencyInbound(graph, current)) {
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
 * Every node `nodeId` RUNS BEFORE — the mirror of {@link ancestorsOf}, walked
 * forwards over the DEPENDENCY layer.
 *
 * Exists for the compiler's loop budget: the body of a rework loop is exactly
 * `descendantsOf(target) ∩ (ancestorsOf(gate) ∪ {gate})`, and that intersection
 * cannot be written without both directions. Excludes `nodeId` unless a
 * dependency cycle genuinely brings it back to itself.
 */
export function descendantsOf(graph: DevGraph, nodeId: string): Set<string> {
  const known = new Set(nodesOf(graph).map((node) => node.id));
  const edges = dependencyEdges(graph);
  const result = new Set<string>();
  const queue: string[] = [nodeId];
  const visited = new Set<string>([nodeId]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.source !== current) continue;
      if (!known.has(edge.target)) continue;
      result.add(edge.target);
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);
      queue.push(edge.target);
    }
  }
  return result;
}

/**
 * The predecessors this node ACTUALLY waits for, after its `JoinPolicy`.
 *
 * This is the heart of the join and the one function the compiler turns
 * straight into `WorkStep.dependsOn` / `CheckStep.dependsOn`:
 *
 * - the root (`prompt`) waits for nothing, even if something was drawn into it;
 * - a REWORK arm is never a dependency — it never reaches this function,
 *   because `directPredecessors` already reads the dependency layer. That is
 *   what keeps "the gate sends the work back" from compiling into "the work
 *   waits for the gate";
 * - `all` waits for every direct predecessor;
 * - `subset` waits only for the listed predecessors — ids in `of` that are not
 *   direct predecessors are dropped here and reported by the validator, so a
 *   stale list can never silently ADD a dependency.
 *
 * Order is edge-declaration order, never the order of `of` — the compiler must
 * be able to diff two emissions.
 */
export function effectiveDependencies(graph: DevGraph, nodeId: string): string[] {
  const direct = directPredecessors(graph, nodeId);
  const node = nodesOf(graph).find((candidate) => candidate.id === nodeId);
  if (!node) return direct;
  if (!hasJoin(node)) return [];
  const join = node.join;
  if (!join || join.mode !== 'subset') return direct;
  const wanted = new Set(stringsOf(join.of));
  return direct.filter((id) => wanted.has(id));
}

/**
 * The arms this node routes on, or `null` when it does not branch.
 *
 * `null` is a different statement from `[]`: `null` means "this node has one
 * way out, so an edge leaving it must NOT name an arm", while `[]` means "this
 * node branches but declares no arm" — which is a defect, not a shape.
 */
export function branchOutcomesOf(node: GraphNode): { id: string; label: string }[] | null {
  if (node.kind === 'gate') {
    return recordsOf<GateOutcome>(node.outcomes).map((outcome) => ({
      id: outcome.id,
      label: outcome.label,
    }));
  }
  if (node.kind !== 'research') return null;
  if (node.outputKind === 'info') return null;
  if (node.outputKind === 'boolean') {
    return RESEARCH_BOOLEAN_OUTCOMES.map((outcome) => ({ ...outcome }));
  }
  return recordsOf<ResearchChoice>(node.choices).map((choice) => ({
    id: choice.id,
    label: choice.label,
  }));
}

// --- Validation -------------------------------------------------------------

type GraphIssueCodeAny = GraphErrorCode | GraphWarningCode;

interface IssueAnchor {
  nodeId?: string;
  edgeId?: string;
}

function issue(code: GraphIssueCodeAny, message: string, anchor: IssueAnchor = {}): GraphIssue {
  const out: GraphIssue = { code, message };
  if (anchor.nodeId !== undefined) out.nodeId = anchor.nodeId;
  if (anchor.edgeId !== undefined) out.edgeId = anchor.edgeId;
  return out;
}

/** Forward reachability from a set of roots. */
function reachableFrom(graph: DevGraph, roots: readonly string[]): Set<string> {
  const known = new Set(nodesOf(graph).map((node) => node.id));
  const reached = new Set<string>();
  const queue: string[] = [];
  for (const root of roots) {
    if (known.has(root) && !reached.has(root)) {
      reached.add(root);
      queue.push(root);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of outboundEdges(graph, current)) {
      if (!known.has(edge.target) || reached.has(edge.target)) continue;
      reached.add(edge.target);
      queue.push(edge.target);
    }
  }
  return reached;
}

/**
 * Longest root-to-node path measured in NODES (a lone root has depth 1).
 *
 * Over the DEPENDENCY layer, like `order` itself: a rework arm does not make
 * the method deeper, it makes one stretch of it repeat.
 */
function longestDepth(
  graph: DevGraph,
  order: readonly string[],
  roots: ReadonlySet<string>,
): number {
  const depth = new Map<string, number>();
  for (const id of order) {
    let best = roots.has(id) ? 1 : 0;
    for (const edge of dependencyInbound(graph, id)) {
      const upstream = depth.get(edge.source) ?? 0;
      if (upstream > 0) best = Math.max(best, upstream + 1);
    }
    depth.set(id, best);
  }
  return Math.max(0, ...depth.values());
}

/**
 * Check a devgraph and report everything wrong with it.
 *
 * NEVER throws. `ok` is `errors.length === 0`; warnings never block — they are
 * the things a human may legitimately mean.
 */
export function validateGraph(graph: DevGraph): GraphValidation {
  const errors: GraphIssue[] = [];
  const warnings: GraphIssue[] = [];
  const err = (code: GraphErrorCode, message: string, anchor?: IssueAnchor): void => {
    errors.push(issue(code, message, anchor));
  };
  const warn = (code: GraphWarningCode, message: string, anchor?: IssueAnchor): void => {
    warnings.push(issue(code, message, anchor));
  };
  /**
   * One issue per malformed LIST, not per malformed entry: a file with 300
   * `null`s is one defect, and 300 identical rows would bury the nine real
   * problems under it.
   */
  const reportMalformed = (
    code: GraphErrorCode,
    raw: unknown,
    what: string,
    keep: (entry: unknown) => boolean,
    anchor?: IssueAnchor,
  ): void => {
    const bad = malformedIndices(raw, keep);
    if (bad.length === 0) return;
    err(
      code,
      `${what} carries ${bad.length} entry/entries that could not be read and were ignored (first at index ${bad[0]})`,
      anchor,
    );
  };

  const nodes = nodesOf(graph);
  const edges = edgesOf(graph);
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  // --- Entries the defensive readers had to drop ---
  reportMalformed('malformed-node-entry', graph?.nodes, '"nodes"', isRecord);
  reportMalformed('malformed-edge-entry', graph?.edges, '"edges"', isRecord);

  // --- Size caps ---
  if (nodes.length > DEVGRAPH_MAX_NODES) {
    err('too-many-nodes', `the graph has ${nodes.length} nodes; the cap is ${DEVGRAPH_MAX_NODES}`);
  }
  if (edges.length > DEVGRAPH_MAX_EDGES) {
    err('too-many-edges', `the graph has ${edges.length} edges; the cap is ${DEVGRAPH_MAX_EDGES}`);
  }

  // --- Per-node identity and text caps ---
  const seenNodeIds = new Set<string>();
  for (const node of nodes) {
    if (!DEVGRAPH_NODE_ID_PATTERN.test(node.id)) {
      err('invalid-node-id', `node id "${node.id}" is not a slug (a-z, 0-9, dashes, 1-40)`, {
        nodeId: node.id,
      });
    }
    if (seenNodeIds.has(node.id)) {
      err('duplicate-node-id', `two nodes share the id "${node.id}"`, { nodeId: node.id });
    } else {
      seenNodeIds.add(node.id);
    }
    if (lengthOf(node.label) > DEVGRAPH_MAX_LABEL) {
      err('label-too-long', `label of "${node.id}" exceeds ${DEVGRAPH_MAX_LABEL} characters`, {
        nodeId: node.id,
      });
    }
    if (lengthOf(node.notes) > DEVGRAPH_MAX_NOTES) {
      err('text-too-long', `notes of "${node.id}" exceed ${DEVGRAPH_MAX_NOTES} characters`, {
        nodeId: node.id,
      });
    }
    // Canvas coordinates route nothing, but a non-finite one is a node the
    // editor cannot place and a file `PositionSchema` (`z.number().finite()`)
    // will not re-open — the human loses the drawing, not just the chip.
    const position: unknown = node.position;
    if (isRecord(position)) {
      for (const axis of ['x', 'y'] as const) {
        if (isNonFiniteNumber(position[axis])) {
          err('invalid-number', `position.${axis} of "${node.id}" is ${String(position[axis])}`, {
            nodeId: node.id,
          });
        }
      }
    }
    switch (node.kind) {
      case 'prompt':
        if (lengthOf(node.goal) > DEVGRAPH_MAX_GOAL) {
          err('text-too-long', `goal of "${node.id}" exceeds ${DEVGRAPH_MAX_GOAL} characters`, {
            nodeId: node.id,
          });
        }
        break;
      case 'action':
        if (lengthOf(node.prompt) > DEVGRAPH_MAX_PROMPT) {
          err('text-too-long', `prompt of "${node.id}" exceeds ${DEVGRAPH_MAX_PROMPT} characters`, {
            nodeId: node.id,
          });
        }
        if (isNonFiniteNumber(node.maxFiles)) {
          err('invalid-number', `maxFiles of "${node.id}" is ${String(node.maxFiles)}`, {
            nodeId: node.id,
          });
        }
        break;
      case 'research':
        if (lengthOf(node.query) > DEVGRAPH_MAX_QUERY) {
          err('text-too-long', `query of "${node.id}" exceeds ${DEVGRAPH_MAX_QUERY} characters`, {
            nodeId: node.id,
          });
        }
        break;
      case 'gate':
        if (lengthOf(node.condition) > DEVGRAPH_MAX_CONDITION) {
          err(
            'text-too-long',
            `condition of "${node.id}" exceeds ${DEVGRAPH_MAX_CONDITION} characters`,
            { nodeId: node.id },
          );
        }
        if (isNonFiniteNumber(node.maxRuns)) {
          err('invalid-number', `maxRuns of "${node.id}" is ${String(node.maxRuns)}`, {
            nodeId: node.id,
          });
        }
        break;
    }
  }

  // --- Entries dropped from a list INSIDE a node ---
  for (const node of nodes) {
    if (node.kind === 'gate') {
      reportMalformed('malformed-node-entry', node.outcomes, `"outcomes" of "${node.id}"`, isRecord, {
        nodeId: node.id,
      });
    }
    if (node.kind === 'research') {
      reportMalformed('malformed-node-entry', node.choices, `"choices" of "${node.id}"`, isRecord, {
        nodeId: node.id,
      });
    }
    if (node.kind === 'action') {
      reportMalformed('malformed-node-entry', node.files, `"files" of "${node.id}"`, isString, {
        nodeId: node.id,
      });
    }
    if (hasJoin(node)) {
      const join = node.join;
      if (join && join.mode === 'subset') {
        reportMalformed('malformed-node-entry', join.of, `"join.of" of "${node.id}"`, isString, {
          nodeId: node.id,
        });
      }
    }
  }

  // --- The single entry ---
  const promptNodes = nodes.filter((node) => node.kind === 'prompt');
  if (promptNodes.length === 0) {
    err('no-prompt-node', 'the graph has no prompt node - every method starts from one objective');
  }
  for (const extra of promptNodes.slice(1)) {
    err('multiple-prompt-nodes', `"${extra.id}" is a second prompt node; only one is allowed`, {
      nodeId: extra.id,
    });
  }
  for (const promptNode of promptNodes) {
    if (inboundEdges(graph, promptNode.id).length > 0) {
      err('prompt-has-inbound', `the prompt node "${promptNode.id}" cannot have incoming edges`, {
        nodeId: promptNode.id,
      });
    }
  }

  // --- Edges ---
  const seenEdgeKeys = new Set<string>();
  const seenEdgeIds = new Set<string>();
  for (const edge of edges) {
    // An edge id is the anchor the editor highlights, so it has to identify ONE
    // edge — the same reason node ids are checked, and the same slug rule.
    if (!DEVGRAPH_SLUG_PATTERN.test(edge.id)) {
      err('invalid-edge-id', `edge id "${edge.id}" is not a slug (a-z, 0-9, dashes, 1-40)`, {
        edgeId: edge.id,
      });
    }
    if (seenEdgeIds.has(edge.id)) {
      err('duplicate-edge-id', `two edges share the id "${edge.id}"`, { edgeId: edge.id });
    } else {
      seenEdgeIds.add(edge.id);
    }

    const sourceNode = byId.get(edge.source);
    const targetNode = byId.get(edge.target);
    if (!sourceNode || !targetNode) {
      err(
        'edge-unknown-node',
        `edge "${edge.id}" links "${edge.source}" to "${edge.target}", and one of them is not a node`,
        { edgeId: edge.id },
      );
    }
    if (edge.source === edge.target) {
      err('self-edge', `edge "${edge.id}" connects "${edge.source}" to itself`, { edgeId: edge.id });
    }
    // Structured, not string-joined: a separator that can appear inside an id
    // makes `"a b" -> "c"` and `"a" -> "b c"` collide, and calling two distinct
    // connections a duplicate deletes a route the human drew on purpose.
    const key = JSON.stringify([edge.source, edge.target, edge.sourceOutcome ?? null]);
    if (seenEdgeKeys.has(key)) {
      err('duplicate-edge', `edge "${edge.id}" repeats an existing connection`, { edgeId: edge.id });
    } else {
      seenEdgeKeys.add(key);
    }

    if (sourceNode) {
      const outcomes = branchOutcomesOf(sourceNode);

      // --- the arm that goes back ---
      //
      // Three rules, and they REPLACE the generic outcome checks below for this
      // edge (ONE DEFECT, ONE CODE): a rework arm leaving an action node is one
      // mistake, and `rework-edge-not-from-branch` is the sentence that names
      // it — `edge-outcome-forbidden` would describe the same edge from a
      // vocabulary that says nothing about the loop the human drew.
      let reworkRuleFired = false;
      if (isReworkEdge(edge)) {
        if (outcomes === null) {
          err(
            'rework-edge-not-from-branch',
            `edge "${edge.id}" is a rework arm, but "${sourceNode.id}" does not branch - only a gate (or a boolean/choice research node) has an outcome to hang a route back on`,
            { edgeId: edge.id, nodeId: sourceNode.id },
          );
          reworkRuleFired = true;
        } else if (edge.sourceOutcome === undefined) {
          err(
            'rework-edge-needs-outcome',
            `edge "${edge.id}" is a rework arm without a sourceOutcome - a route back is still an ARM, so it must say which verdict takes it`,
            { edgeId: edge.id, nodeId: sourceNode.id },
          );
          reworkRuleFired = true;
        }
        // A rework arm that does not actually go back is an ordinary forward
        // edge wearing the loop's clothes: it would compile to a plain route
        // while telling the human, on the canvas, that the work repeats. The
        // unknown-node and self-edge cases are already reported above.
        if (
          !reworkRuleFired &&
          targetNode &&
          edge.source !== edge.target &&
          !ancestorsOf(graph, edge.source).has(edge.target)
        ) {
          err(
            'rework-edge-not-backward',
            `edge "${edge.id}" is a rework arm, but "${edge.target}" does not run before "${edge.source}" - a route back must point at a node this one already depends on`,
            { edgeId: edge.id, nodeId: sourceNode.id },
          );
          reworkRuleFired = true;
        }
      }

      if (!reworkRuleFired) {
        if (outcomes === null) {
          if (edge.sourceOutcome !== undefined) {
            err(
              'edge-outcome-forbidden',
              `edge "${edge.id}" names an outcome, but "${sourceNode.id}" does not branch`,
              { edgeId: edge.id, nodeId: sourceNode.id },
            );
          }
        } else if (edge.sourceOutcome === undefined) {
          err(
            'edge-outcome-required',
            `edge "${edge.id}" leaves the branching node "${sourceNode.id}" without naming an outcome`,
            { edgeId: edge.id, nodeId: sourceNode.id },
          );
        } else if (!outcomes.some((outcome) => outcome.id === edge.sourceOutcome)) {
          err(
            'edge-outcome-unknown',
            `edge "${edge.id}" names outcome "${edge.sourceOutcome}", which "${sourceNode.id}" does not declare`,
            { edgeId: edge.id, nodeId: sourceNode.id },
          );
        }
      }
    }
  }

  // --- Branching nodes: one edge per arm, plus a valid forward default ---
  for (const node of nodes) {
    const outcomes = branchOutcomesOf(node);
    if (outcomes === null) continue;
    const outgoing = outboundEdges(graph, node.id);
    const uniqueOutcomeIds = [...new Set(outcomes.map((outcome) => outcome.id))];
    for (const outcomeId of uniqueOutcomeIds) {
      const matching = outgoing.filter((edge) => edge.sourceOutcome === outcomeId);
      if (matching.length === 0) {
        err(
          'branch-outcome-missing-edge',
          `outcome "${outcomeId}" of "${node.id}" has no outgoing edge; every arm must point somewhere because huu's CheckStep requires a nextStepName on each outcome - if this arm has no work left, route it to a terminal action node (a "consolidate" block, say)`,
          { nodeId: node.id },
        );
      } else if (matching.length > 1) {
        err(
          'branch-outcome-multiple-edges',
          `outcome "${outcomeId}" of "${node.id}" has ${matching.length} outgoing edges; a check routes to exactly one step`,
          { nodeId: node.id, edgeId: matching[1]?.id },
        );
      }
    }
    const declaredDefault =
      node.kind === 'gate' || node.kind === 'research' ? node.defaultOutcome : undefined;
    if (declaredDefault === undefined || declaredDefault === '') {
      err(
        'default-outcome-missing',
        `"${node.id}" branches, so it needs a defaultOutcome - the safe route taken when the judge fails`,
        { nodeId: node.id },
      );
    } else if (!uniqueOutcomeIds.includes(declaredDefault)) {
      err(
        'default-outcome-unknown',
        `defaultOutcome "${declaredDefault}" of "${node.id}" is not one of its outcomes`,
        { nodeId: node.id },
      );
    } else if (outgoing.some((edge) => edge.sourceOutcome === declaredDefault && isReworkEdge(edge))) {
      // THE GOLDEN RULE OF THE FORWARD DEFAULT. The default outcome fires on
      // judge failure, on an unknown label and on the maxRuns cap — never
      // because anyone decided it. So it has to be the SAFE route, forward: a
      // default that loops turns a judge that cannot answer into a run that
      // spins backwards until `maxNodeExecutions` kills it, and the human sees
      // an exhausted budget instead of a verdict. See "Why `approved` must
      // carry `default: true`" in docs/pipeline-json-guide.md.
      err(
        'default-outcome-is-rework',
        `defaultOutcome "${declaredDefault}" of "${node.id}" is a rework arm - the default fires when the judge FAILS, so it must be the safe route FORWARD, never the loop`,
        { nodeId: node.id },
      );
    }
  }

  // --- Arity and duplicate ids on the branch declarations ---
  for (const node of nodes) {
    if (node.kind === 'research' && node.outputKind === 'choice') {
      const choices = recordsOf<ResearchChoice>(node.choices);
      if (choices.length < 2) {
        err(
          'choice-needs-two',
          `"${node.id}" offers ${choices.length} choice(s); a branch needs at least 2`,
          { nodeId: node.id },
        );
      }
      if (choices.length > DEVGRAPH_MAX_BRANCHES) {
        err(
          'too-many-branches',
          `"${node.id}" offers ${choices.length} choices; the cap is ${DEVGRAPH_MAX_BRANCHES}`,
          { nodeId: node.id },
        );
      }
      const seen = new Set<string>();
      for (const choice of choices) {
        // The COMPILER routes on `sanitizeNodeId(choice.id)` while the edges
        // carry the id as drawn, so an unslugged arm ('!!!' → '') either loses
        // its route or collapses onto a sibling. The zod schema declares these
        // strict, but a graph reaches the compiler without ever being parsed —
        // and the compiler's own gate reports the fallout as "this is a huu
        // bug". This is the entry gate covering what the exit gate assumes.
        if (!isSlug(choice.id)) {
          err(
            'invalid-outcome-id',
            `"${node.id}" declares the choice id "${String(choice.id)}", which is not a slug (a-z, 0-9, dashes, 1-40)`,
            { nodeId: node.id },
          );
        }
        if (seen.has(choice.id)) {
          err('duplicate-choice-id', `"${node.id}" declares the choice id "${choice.id}" twice`, {
            nodeId: node.id,
          });
        } else {
          seen.add(choice.id);
        }
      }
    }
    if (node.kind === 'gate') {
      const outcomes = recordsOf<GateOutcome>(node.outcomes);
      if (outcomes.length < 2) {
        err(
          'gate-needs-two',
          `"${node.id}" declares ${outcomes.length} outcome(s); a gate needs at least 2`,
          { nodeId: node.id },
        );
      }
      if (outcomes.length > DEVGRAPH_MAX_BRANCHES) {
        err(
          'too-many-branches',
          `"${node.id}" declares ${outcomes.length} outcomes; the cap is ${DEVGRAPH_MAX_BRANCHES}`,
          { nodeId: node.id },
        );
      }
      const seen = new Set<string>();
      for (const outcome of outcomes) {
        // Same reason as the choice ids above: the judge is told to answer with
        // the SANITIZED id, and `@@@` sanitizes to nothing.
        if (!isSlug(outcome.id)) {
          err(
            'invalid-outcome-id',
            `"${node.id}" declares the outcome id "${String(outcome.id)}", which is not a slug (a-z, 0-9, dashes, 1-40)`,
            { nodeId: node.id },
          );
        }
        if (seen.has(outcome.id)) {
          err('duplicate-outcome-id', `"${node.id}" declares the outcome id "${outcome.id}" twice`, {
            nodeId: node.id,
          });
        } else {
          seen.add(outcome.id);
        }
      }
    }
  }

  // --- Join policies ---
  for (const node of nodes) {
    if (!hasJoin(node)) continue;
    const join = node.join;
    if (!join || join.mode !== 'subset') continue;
    // The SAME filtered list `effectiveDependencies` acts on. Entries that are
    // not strings were already reported as `malformed-node-entry`; re-reporting
    // one of them as "not a node" would name a single defect twice, and an
    // emptiness caused purely by those discards is that defect, not a second one.
    const of = stringsOf(join.of);
    const dropped = malformedIndices(join.of, isString).length > 0;
    const direct = directPredecessors(graph, node.id);

    if (of.length === 0 && !dropped) {
      err('join-subset-empty', `the join subset of "${node.id}" is empty; use mode "all" instead`, {
        nodeId: node.id,
      });
    }
    for (const wanted of of) {
      if (!byId.has(wanted)) {
        err(
          'join-subset-unknown-node',
          `the join subset of "${node.id}" names "${wanted}", which is not a node`,
          { nodeId: node.id },
        );
      } else if (!direct.includes(wanted)) {
        err(
          'join-subset-not-inbound',
          `the join subset of "${node.id}" names "${wanted}", which does not connect into it`,
          { nodeId: node.id },
        );
      }
    }

    if (direct.length <= 1) {
      warn(
        'join-subset-single-inbound',
        `"${node.id}" has ${direct.length} incoming connection(s), so a join subset changes nothing`,
        { nodeId: node.id },
      );
    } else if (effectiveDependencies(graph, node.id).length < direct.length) {
      warn(
        'join-subset-drops-barrier',
        `"${node.id}" stops depending on some of its inputs: it will no longer wait for them, nor fail when they fail. huu still merges every branch of the wave before the next stage, so this relaxes the DEPENDENCY, not the merge barrier`,
        { nodeId: node.id },
      );
    }
  }

  // --- Action nodes: blocks, fan-out and scope ---
  for (const node of nodes) {
    if (node.kind !== 'action') continue;
    if (!findBlock(node.block)) {
      err(
        'unknown-block',
        `"${node.id}" uses the block "${node.block}", which is not in the catalog`,
        { nodeId: node.id },
      );
    }
    // One hand-picked file is one agent once compiled, so this cap is a fan-out
    // width the human has to underwrite - not a cosmetic list length.
    const files = stringsOf(node.files);
    if (files.length > DEVGRAPH_MAX_FILES) {
      err(
        'too-many-files',
        `"${node.id}" hand-picks ${files.length} files; the cap is ${DEVGRAPH_MAX_FILES}`,
        { nodeId: node.id },
      );
    }
    const fanOutFrom = node.fanOutFrom;
    if (fanOutFrom !== undefined) {
      const source = byId.get(fanOutFrom);
      if (!source) {
        err(
          'fanout-source-unknown',
          `"${node.id}" fans out from "${fanOutFrom}", which is not a node`,
          { nodeId: node.id },
        );
      } else if (fanOutFrom === node.id || !ancestorsOf(graph, node.id).has(fanOutFrom)) {
        err(
          'fanout-source-not-ancestor',
          `"${node.id}" fans out from "${fanOutFrom}", which does not run before it`,
          { nodeId: node.id },
        );
      } else if (source.kind !== 'action' || findBlock(source.block)?.produces !== true) {
        err(
          'fanout-source-not-producer',
          `"${node.id}" fans out from "${fanOutFrom}", which does not produce a target list`,
          { nodeId: node.id },
        );
      }
      if (node.scope !== undefined && node.scope !== 'memory') {
        err(
          'fanout-needs-memory-scope',
          `"${node.id}" fans out from "${fanOutFrom}" but declares scope "${node.scope}"; a fan-out is scope "memory"`,
          { nodeId: node.id },
        );
      }
    } else if (node.scope === 'memory') {
      err(
        'scope-memory-needs-fanout',
        `"${node.id}" uses scope "memory" without fanOutFrom; nothing tells it which list to read`,
        { nodeId: node.id },
      );
    }
  }

  // --- Reachability, cycles, shape warnings ---
  //
  // ONE DEFECT, ONE CODE (see `GraphErrorCode`). A node tangled in a cycle is
  // also unreachable in any runnable sense, so `cycle` - the CAUSE - is the only
  // code it gets; `unreachable-node` would be the consequence reported a second
  // time, which is exactly why `orphan-node` does not exist either.
  const topo = topoOrder(graph);
  const tangled = new Set<string>();
  if (topo.cycle) {
    const ordered = new Set(topo.order);
    for (const node of nodes) if (!ordered.has(node.id)) tangled.add(node.id);
  }

  const rootIds = promptNodes.map((node) => node.id);
  if (rootIds.length > 0) {
    const reached = reachableFrom(graph, rootIds);
    const reported = new Set<string>();
    for (const node of nodes) {
      if (reached.has(node.id) || reported.has(node.id) || tangled.has(node.id)) continue;
      reported.add(node.id);
      err('unreachable-node', `"${node.id}" cannot be reached from the prompt node`, {
        nodeId: node.id,
      });
    }
  }

  if (tangled.size > 0) {
    const reported = new Set<string>();
    for (const node of nodes) {
      if (!tangled.has(node.id) || reported.has(node.id)) continue;
      reported.add(node.id);
      err('cycle', `"${node.id}" sits on a cycle; a devgraph must be acyclic`, { nodeId: node.id });
    }
  }

  if (nodes.length > 0 && !nodes.some((node) => outboundEdges(graph, node.id).length === 0)) {
    warn('no-terminal-node', 'no node ends the graph - every path loops back into another node');
  }

  if (!topo.cycle && rootIds.length > 0) {
    const depth = longestDepth(graph, topo.order, new Set(rootIds));
    if (depth > DEVGRAPH_MAX_DEPTH) {
      warn(
        'deep-graph',
        `the longest path is ${depth} nodes deep (over ${DEVGRAPH_MAX_DEPTH}); consider splitting the method`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
