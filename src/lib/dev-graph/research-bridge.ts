// The seam between the DRAWING and the RESEARCH CONTRACT.
//
// WHY THIS MODULE EXISTS AT ALL: `research-contract.ts` deliberately does not
// import `graph-types.ts`. It is written to be total over JSON that may never
// have been validated — a `ResearchSpec` is a flat, self-contained value, and
// keeping it free of the graph means the prompt/judge/parser trio can be reused
// (and unit-tested) without ever constructing a canvas. Somebody, though, has
// to answer the two questions that only the GRAPH knows:
//
//   1. which artifacts a research node may cite as its own context, and
//   2. which INFORMATIVE research already ran upstream of an arbitrary node.
//
// That is this file. It is the only place where a `ResearchNode` becomes a
// `ResearchSpec`, so the compiler never hand-rolls one and the two can never
// drift apart.
//
// THE ANCESTOR RULE (used by both functions, and the one real decision here):
// "upstream" means the transitive closure of `effectiveDependencies`, NOT of
// the drawn edges. The difference only shows up under a `subset` join, and it
// matters for a concrete reason: an artifact is a real file that some earlier
// agent had to WRITE and COMMIT, and the only thing that guarantees it exists
// by the time this node's agent looks for it is a dependency. A node that
// dropped an inbound edge no longer waits for that branch — it can be scheduled
// in the SAME wave as it — so citing that branch's `research.md` would hand an
// agent a path that may not exist yet. A prompt that names a missing file is
// worse than a prompt that names none: the agent burns a turn looking, and then
// invents. Dropping the edge was also the human saying "I do not want that
// input", and this module has no business overriding that.
//
// Keep this file pure (no fs / no env / no clock).

import {
  isResearchNode,
  type DevGraph,
  type GraphNode,
  type ResearchNode,
} from './graph-types.js';
import { effectiveDependencies, topoOrder } from './graph-validate.js';
import { researchMdPath, type ResearchSpec } from './research-contract.js';

/** Plain-object guard — the same defensive reading `graph-validate.ts` uses. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The nodes of a graph that could be read as nodes at all, in declaration order. */
function nodesOf(graph: DevGraph): GraphNode[] {
  return Array.isArray(graph?.nodes) ? (graph.nodes.filter(isRecord) as GraphNode[]) : [];
}

/**
 * Every node `nodeId` transitively WAITS FOR, after each hop's join policy.
 *
 * Deterministic: the result is ordered by {@link topoOrder}, which is the order
 * those nodes actually run in. Nodes a cycle left outside the topological order
 * are appended in declaration order, so this stays total on a graph the
 * validator would reject (the compiler refuses such a graph long before, but
 * this module is also called from the editor's preview path).
 *
 * `nodeId` itself is never included, even in the cyclic case.
 */
function effectiveAncestors(graph: DevGraph, nodeId: string): string[] {
  const seen = new Set<string>();
  const queue: string[] = [...effectiveDependencies(graph, nodeId)];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dep of effectiveDependencies(graph, current)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  seen.delete(nodeId);

  const order = topoOrder(graph).order;
  const ranked: string[] = [];
  for (const id of order) if (seen.has(id)) ranked.push(id);
  for (const node of nodesOf(graph)) {
    if (seen.has(node.id) && !ranked.includes(node.id)) ranked.push(node.id);
  }
  return ranked;
}

/** The research nodes among a list of ids, in the order given. */
function researchNodesIn(graph: DevGraph, ids: readonly string[]): ResearchNode[] {
  const byId = new Map<string, GraphNode>();
  for (const node of nodesOf(graph)) if (!byId.has(node.id)) byId.set(node.id, node);
  const out: ResearchNode[] = [];
  for (const id of ids) {
    const node = byId.get(id);
    if (node && isResearchNode(node)) out.push(node);
  }
  return out;
}

/**
 * Build the {@link ResearchSpec} of one research node.
 *
 * Three fields are set CONDITIONALLY, and each omission is a statement:
 *
 * - `choices` only for `kind: 'choice'` — for a boolean node the arms are fixed
 *   (`yes`/`no`) and for an informative one there are none, so carrying a list
 *   there would describe a route that does not exist;
 * - `defaultOutcome` only for a node that BRANCHES — an informative node routes
 *   nothing, so it has no safe route to name;
 * - `contextFiles` only when the human turned `useContext` on AND some upstream
 *   research actually wrote something. `buildResearchPrompt` already says the
 *   right thing for `useContext` with an empty list ("no context was declared;
 *   research from the query alone"), so an empty array is left off rather than
 *   emitted.
 *
 * The context list is EVERY upstream research node, not only the informative
 * ones: a `boolean` node's `research.md` states what it concluded and why, and
 * for a later question that is exactly the ground the human wired it to stand
 * on. Informative nodes are singled out only by {@link upstreamInfoSpecs},
 * whose consumers are ACTION and GATE nodes with no context channel of their
 * own.
 */
export function researchSpecOf(
  graph: DevGraph,
  node: ResearchNode,
  graphRoot: string,
): ResearchSpec {
  const branching = node.outputKind === 'boolean' || node.outputKind === 'choice';
  const spec: ResearchSpec = {
    nodeId: node.id,
    label: node.label,
    query: node.query,
    kind: node.outputKind,
    useContext: node.useContext === true,
    graphRoot,
  };

  if (node.outputKind === 'choice' && Array.isArray(node.choices)) {
    spec.choices = node.choices
      .filter(isRecord)
      .map((choice) => ({ id: String(choice.id ?? ''), label: String(choice.label ?? '') }));
  }
  if (branching && node.defaultOutcome !== undefined) {
    spec.defaultOutcome = node.defaultOutcome;
  }
  if (spec.useContext) {
    const files = researchNodesIn(graph, effectiveAncestors(graph, node.id)).map((ancestor) =>
      researchMdPath(graphRoot, ancestor.id),
    );
    if (files.length > 0) spec.contextFiles = files;
  }

  return spec;
}

/**
 * The specs of every INFORMATIVE research node that feeds `nodeId` as context.
 *
 * This is the whole input of `buildResearchContextBlock`, i.e. the ONLY channel
 * an informative research node has: it routes nothing, and a `CheckStep`'s
 * `reason` never reaches the next prompt, so the committed `research.md` is the
 * one thing that survives the node it was written in.
 *
 * Ordered topologically — the order the answers were produced — so two
 * compilations of the same graph emit byte-identical prompts.
 */
export function upstreamInfoSpecs(
  graph: DevGraph,
  nodeId: string,
  graphRoot: string,
): ResearchSpec[] {
  return researchNodesIn(graph, effectiveAncestors(graph, nodeId))
    .filter((node) => node.outputKind === 'info')
    .map((node) => researchSpecOf(graph, node, graphRoot));
}
