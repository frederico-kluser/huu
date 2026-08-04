// The hand-drawn action graph — `huu-devgraph-v1`.
//
// WHY THIS FORMAT EXISTS (MANIFESTO §"O que é o huu"): today's dev mode hands
// the TOPOLOGY to an LLM planner — the model decides how many fronts run, what
// each one does and where they join. That is exactly the decision the manifesto
// says must not be delegated: "o humano subscreve o escopo; a IA executa dentro
// dele". A devgraph is the human's answer to that. The human DRAWS the method —
// which blocks run, in which order, where a decision branches, where the branches
// rejoin — and the agent only supplies the intelligence INSIDE each node. Nothing
// in this file lets a model invent a node, an edge or a route.
//
// This module is TYPES ONLY. The zod shape lives in `graph-schema.ts`, the
// structural rules in `graph-validate.ts`, the block library in
// `node-catalog.ts`. Compiling a devgraph into a runnable `huu-pipeline-v2` is a
// SEPARATE module (`graph-to-pipeline.ts`) and keeping that translation
// mechanical is what stops a badly drawn graph from becoming an invalid pipeline.
//
// Keep this file pure (no fs / no env / no imports beyond types) — the editor,
// the server and the compiler all import it.

// --- Caps -------------------------------------------------------------------
//
// These are the SAME numbers the zod schema and the structural validator use.
// One declaration surface, because the two layers disagreeing is the classic
// way a graph parses and then fails to compile (or worse, compiles into a
// pipeline that trips huu's own `validateTopology` at run time).

/** Node ids name pipeline steps downstream, so they must be path/step safe. */
export const DEVGRAPH_NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Same shape as node ids: graph ids, choice ids and outcome ids. */
export const DEVGRAPH_SLUG_PATTERN = DEVGRAPH_NODE_ID_PATTERN;

/** Hard cap on drawn nodes. A method a human cannot hold in one screen is not a method. */
export const DEVGRAPH_MAX_NODES = 40;
/** Hard cap on drawn edges. */
export const DEVGRAPH_MAX_EDGES = 80;
/** Node labels are chips on a canvas — they must fit. */
export const DEVGRAPH_MAX_LABEL = 80;
/** `prompt.goal` — the one thing the human writes before anything else. */
export const DEVGRAPH_MAX_GOAL = 4000;
/** `action.prompt` — the per-node override of the block's template. */
export const DEVGRAPH_MAX_PROMPT = 4000;
/** `research.query`. */
export const DEVGRAPH_MAX_QUERY = 2000;
/** `gate.condition`. */
export const DEVGRAPH_MAX_CONDITION = 2000;
/** Free-form canvas annotation on any node. Never reaches an agent. */
export const DEVGRAPH_MAX_NOTES = 2000;
/** Longest root→leaf path (in nodes) before the graph is flagged as too deep. */
export const DEVGRAPH_MAX_DEPTH = 12;
/** Cap on `research.choices` / `gate.outcomes` entries. Enforced as `too-many-branches`. */
export const DEVGRAPH_MAX_BRANCHES = 12;
/**
 * Cap on a node's hand-picked `files` list. Enforced as `too-many-files`,
 * because a `per-file` node compiles into ONE agent per entry: an unenforced
 * cap here is a fan-out width nobody underwrote.
 */
export const DEVGRAPH_MAX_FILES = 400;

// --- Join -------------------------------------------------------------------

/**
 * How a node decides WHICH of its inbound edges it actually waits for.
 *
 * - `all` (the default) — every direct predecessor is a dependency. This is
 *   plain `dependsOn` in `huu-pipeline-v2` terms.
 * - `subset` — only the listed predecessors are dependencies; the others become
 *   pure drawing (they still show the human where the work came from, but the
 *   node does not wait on them). This is the "fan out three reviews, continue
 *   from the performance one" shape.
 *
 * HONEST RUNTIME NOTE — read before designing around this. huu executes in BSP
 * waves over git: at the end of every stage EVERY branch is merged into the
 * integration worktree before the next stage starts. Relaxing a join removes the
 * DEPENDENCY (of data and of success) between the branches — the node no longer
 * waits for the dropped predecessors and no longer fails when they fail. It does
 * NOT remove the wave's merge barrier, and it does not make the node start
 * earlier in wall-clock terms once the dropped branches are already in the same
 * wave. There is no "skip the barrier" semantics in huu, and this format does
 * not invent one.
 */
export type JoinPolicy = { mode: 'all' } | { mode: 'subset'; of: string[] };

/** The default join: wait for every direct predecessor. */
export const DEFAULT_JOIN: JoinPolicy = { mode: 'all' };

// --- Nodes ------------------------------------------------------------------

/** The four things a human can drop on the canvas. */
export type GraphNodeKind = 'prompt' | 'action' | 'research' | 'gate';

/** Canvas coordinates. Pure presentation — the compiler ignores them. */
export interface GraphPosition {
  x: number;
  y: number;
}

/** Fields every node carries, whatever its `kind`. */
export interface GraphNodeBase {
  /** Slug, unique in the graph. Becomes part of the compiled step name. */
  id: string;
  /** What the chip says on the canvas. */
  label: string;
  position: GraphPosition;
  /** Human annotation. Never sent to an agent — this is the human's margin. */
  notes?: string;
}

/**
 * The ENTRY of the graph: the human's objective, in their own words.
 *
 * Exactly one per graph, and it may have no inbound edge — it is the root the
 * whole method hangs from. Every block's `promptTemplate` can inject it via the
 * `$goal` token, which is how one sentence written once reaches twelve nodes
 * without being retyped.
 */
export interface PromptNode extends GraphNodeBase {
  kind: 'prompt';
  goal: string;
}

/**
 * Scope of an action node, mirroring `WorkStep.scope` in `huu-pipeline-v2`:
 * `project` = one whole-repo task, `per-file` = one task per hand-picked file,
 * `memory` = one task per entry of a `huu-memory-v1` list an EARLIER node wrote
 * (see `fanOutFrom`), `flexible` = the legacy free-form shape.
 */
export type ActionScope = 'project' | 'per-file' | 'memory' | 'flexible';

/** A unit of work: one catalog block, executed by agents. */
export interface ActionNode extends GraphNodeBase {
  kind: 'action';
  /** A block id from `ACTION_BLOCKS` (including `custom`). */
  block: string;
  /** Overrides the block's `promptTemplate` when set. */
  prompt?: string;
  /** Defaults to the block's `defaultScope` when omitted. */
  scope?: ActionScope;
  /** Hand-picked files. Only meaningful for `per-file` / `flexible`. */
  files?: string[];
  /**
   * Id of an ANCESTOR action node whose block `produces` a `huu-memory-v1`
   * list. Setting it means "fan out one agent per entry that node found" —
   * `scope: 'memory'` + `filesFrom` once compiled.
   */
  fanOutFrom?: string;
  /** Cap on the fan-out width (`WorkStep.maxFiles`). */
  maxFiles?: number;
  /** Per-node model override. */
  modelId?: string;
  /** Turn the per-task generator→critic loop on (`WorkStep.review`). */
  review?: boolean;
  join: JoinPolicy;
}

/**
 * What a research node hands back: a two-way branch, an n-way branch, or
 * nothing routable at all (`info` just deposits knowledge for the nodes after
 * it and has exactly one continuation).
 */
export type ResearchOutputKind = 'boolean' | 'choice' | 'info';

/** One arm of an n-way research branch. */
export interface ResearchChoice {
  id: string;
  label: string;
}

/**
 * A question answered BEFORE the work continues — optionally routing the graph.
 *
 * `useContext` says whether the answer is grounded in this repository (the agent
 * reads the code) or answered from the model/web alone.
 */
export interface ResearchNode extends GraphNodeBase {
  kind: 'research';
  query: string;
  useContext: boolean;
  outputKind: ResearchOutputKind;
  /** Required (>= 2) when `outputKind === 'choice'`; meaningless otherwise. */
  choices?: ResearchChoice[];
  /**
   * The SAFE route when the judge fails, times out or answers something
   * unknown. Required whenever the node branches (`boolean` / `choice`).
   */
  defaultOutcome?: string;
  modelId?: string;
  join: JoinPolicy;
}

/** One arm of a gate. */
export interface GateOutcome {
  id: string;
  label: string;
}

/**
 * A human-authored check: an LLM judge evaluates `condition` in the integration
 * worktree and picks one of the declared `outcomes`. Compiles to a `CheckStep`.
 *
 * `defaultOutcome` is mandatory and is huu's forward-default rule: the judge
 * failing must never stall the run, so one outcome is always the safe way
 * forward.
 */
export interface GateNode extends GraphNodeBase {
  kind: 'gate';
  condition: string;
  outcomes: GateOutcome[];
  defaultOutcome: string;
  /** Visit cap (`CheckStep.maxRuns`). */
  maxRuns?: number;
  modelId?: string;
  join: JoinPolicy;
}

/** Discriminated union of everything that can sit on the canvas. */
export type GraphNode = PromptNode | ActionNode | ResearchNode | GateNode;

/** Every node kind EXCEPT `prompt` carries a join — the root has nothing to join. */
export type JoiningNode = ActionNode | ResearchNode | GateNode;

// --- Edges ------------------------------------------------------------------

/**
 * A drawn connection.
 *
 * `sourceOutcome` names WHICH arm of a branching source this edge leaves from.
 * It is REQUIRED when the source branches (`research` with `boolean`/`choice`,
 * or any `gate`) and FORBIDDEN otherwise — a `prompt`, an `action` and an
 * `info` research node each have exactly one way out, so naming an arm there
 * would be a route that does not exist.
 *
 * `rework` marks THE ARM THAT GOES BACK — see {@link isReworkEdge} for the full
 * argument. Absent means an ordinary edge, so every graph drawn before this
 * field existed keeps its exact meaning and compiles to the exact same
 * pipeline.
 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceOutcome?: string;
  /**
   * `true` — and ONLY `true` — turns this arm into a rework route. The OFF
   * state is the field's ABSENCE, never `false`: a boolean with two meanings
   * invites `rework: false` to be read as "a rework edge that is disabled",
   * and there is no such thing here.
   */
  rework?: true;
}

/**
 * THE ARM THAT GOES BACK — a `gate` (or branching `research`) arm routed at a
 * node that already ran.
 *
 * WHY IT HAS TO BE EXPLICIT, AND WHY IT IS NOT A CYCLE:
 *
 * "quality gate: if it failed, go back and fix it" is the single most common
 * reason a gate exists, and until this field it was not drawable — a backwards
 * arm was rejected as `cycle`, so the human's only option was a SECOND node
 * that redid the work, duplicating the block on the canvas and still unable to
 * repeat. The limitation was in this FORMAT, never in the runtime:
 * `validateTopology` (`src/lib/pipeline-io.ts`) says it outright — dependency
 * cycles are structurally impossible because "loops belong to next/outcomes
 * (activation edges)". Dev mode's own front judge has always compiled exactly
 * this shape (`plan-to-pipeline.ts`: `{approved, default:true}` forward,
 * `{rework, nextStepName: <the work step>}` backwards).
 *
 * So a devgraph has TWO layers over the same drawing:
 *
 *   DEPENDENCY layer — every edge WITHOUT `rework`. This is what becomes
 *                      `dependsOn`, what `topoOrder` sorts, what "ancestor"
 *                      means, and the ONLY layer a `cycle` is looked for in.
 *   ACTIVATION layer — every edge, rework included. This is what routes
 *                      (`outcomes[].nextStepName`) and what reachability
 *                      follows, so a rework arm still reaches its target.
 *
 * A rework edge NEVER becomes a dependency: if it did, the target would start
 * waiting for the gate that comes after it and the drawing would be a genuine
 * dependency cycle. It is inferred from NOTHING — a backwards arm without this
 * field stays an error — because a loop the human did not underwrite is a loop
 * nobody signed. What bounds it is the gate's own `maxRuns`, with
 * `Pipeline.maxNodeExecutions` as the run-wide backstop.
 */
export function isReworkEdge(edge: GraphEdge | undefined | null): boolean {
  return edge?.rework === true;
}

// --- Envelope ---------------------------------------------------------------

/** Run-wide settings the graph carries, independent of any single node. */
export interface DevGraphMeta {
  /**
   * The methodologies the human underwrote, keyed by `DevMethodology` field —
   * the same table `node-catalog.methodologyOptions()` projects. Deliberately
   * typed loose (`Record<string, true>`) so this module does not drag the
   * dev-mode types into the browser payload; the COMPILER narrows the keys.
   */
  methodology?: Record<string, true>;
  /** Last-resort loop cap, mapped to `Pipeline.maxNodeExecutions`. */
  maxNodeExecutions?: number;
  /** Run-wide model default; each node may override it. */
  modelId?: string;
}

/** A whole hand-drawn method, ready to be persisted and later compiled. */
export interface DevGraph {
  _format: 'huu-devgraph-v1';
  /** Slug. Names the file on disk and the run downstream. */
  id: string;
  name: string;
  description?: string;
  /** ISO-8601. Set once, at creation. */
  createdAt: string;
  /** ISO-8601. Bumped by the editor on every save. */
  updatedAt: string;
  meta: DevGraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Guards -----------------------------------------------------------------

export function isPromptNode(node: GraphNode): node is PromptNode {
  return node.kind === 'prompt';
}

export function isActionNode(node: GraphNode): node is ActionNode {
  return node.kind === 'action';
}

export function isResearchNode(node: GraphNode): node is ResearchNode {
  return node.kind === 'research';
}

export function isGateNode(node: GraphNode): node is GateNode {
  return node.kind === 'gate';
}

/** True for every node that waits on predecessors — i.e. everything but the root. */
export function hasJoin(node: GraphNode): node is JoiningNode {
  return node.kind !== 'prompt';
}

// --- Validation issue codes -------------------------------------------------

/**
 * Blocking problems. The code is the STABLE identity of the problem — the UI
 * maps it to a translated sentence, so renaming one is a breaking change while
 * rewording `GraphIssue.message` is not.
 *
 * ONE DEFECT, ONE CODE. Two rules follow from it, and both are load-bearing
 * because the UI turns a code into a highlight:
 *
 *  - there is deliberately NO `orphan-node`: a node with no inbound edge that
 *    is not the root is, by construction, also not reachable from the root, and
 *    reporting the same defect under two codes would make the UI show it twice.
 *    `unreachable-node` is the single code for that case.
 *  - a node tangled in (or downstream of) a cycle is likewise unreachable in
 *    any runnable sense, so it is reported ONLY as `cycle`. The cycle is the
 *    CAUSE and the unreachability is its consequence; naming the cause is what
 *    the human can act on, and naming both would double-count one drawing
 *    mistake exactly the way `orphan-node` would have.
 *  - the same rule governs the four `rework-*` codes: an edge that fails one of
 *    them is NOT also reported under the generic `edge-outcome-*` family. A
 *    rework arm leaving an action node is one mistake, and
 *    `rework-edge-not-from-branch` is the sentence that explains it.
 */
export type GraphErrorCode =
  | 'no-prompt-node'
  | 'multiple-prompt-nodes'
  | 'prompt-has-inbound'
  | 'duplicate-node-id'
  | 'invalid-node-id'
  /** A `nodes` entry that is not an object at all (`null`, a number, a string). */
  | 'malformed-node-entry'
  /** An `edges` entry that is not an object at all. */
  | 'malformed-edge-entry'
  | 'edge-unknown-node'
  | 'invalid-edge-id'
  | 'duplicate-edge-id'
  | 'self-edge'
  | 'duplicate-edge'
  /**
   * A cycle in the DEPENDENCY layer — edges without `rework`. A rework arm may
   * point backwards as far as it likes; that is the whole point of
   * {@link isReworkEdge}, and it is why this code is no longer what a
   * loop-back gate gets.
   */
  | 'cycle'
  /** `rework: true` on an edge leaving a node that has only one way out. */
  | 'rework-edge-not-from-branch'
  /** `rework: true` without a `sourceOutcome` — a rework route is still an ARM. */
  | 'rework-edge-needs-outcome'
  /**
   * `rework: true` whose target is NOT an ancestor in the dependency layer —
   * an ordinary forward edge wearing the loop's clothes. Refused so the drawing
   * cannot say "this goes back" about something that goes forward.
   */
  | 'rework-edge-not-backward'
  /**
   * The node's `defaultOutcome` is a rework arm. huu's forward-default rule:
   * the default fires when the judge FAILS, so it has to be the safe route
   * forward — a default that loops turns a broken judge into a run that spins
   * until `maxNodeExecutions` kills it.
   */
  | 'default-outcome-is-rework'
  | 'unreachable-node'
  | 'branch-outcome-missing-edge'
  | 'branch-outcome-multiple-edges'
  | 'edge-outcome-required'
  | 'edge-outcome-forbidden'
  | 'edge-outcome-unknown'
  | 'default-outcome-missing'
  | 'default-outcome-unknown'
  | 'choice-needs-two'
  | 'duplicate-choice-id'
  | 'gate-needs-two'
  | 'duplicate-outcome-id'
  /**
   * A branch arm id (a research `choice.id`, a gate `outcome.id`) that is not a
   * slug. The zod schema declares these strict, but a graph reaches the
   * compiler without ever passing `parseDevGraph`, and the compiler routes on
   * the SANITIZED id — so an unslugged arm silently becomes a different label
   * (or collapses onto a sibling) instead of failing where a human can see it.
   */
  | 'invalid-outcome-id'
  /**
   * A numeric field that is `NaN` or `Infinity` (`maxRuns`, `maxFiles`,
   * `position.x/y`). Not merely untidy: a non-finite number survives every
   * `clamp`/`Math.trunc` this stack applies and only dies at `PipelineSchema`,
   * where the compiler reports it as "this is a huu bug" — a message that
   * blames huu for a value the drawing carried.
   */
  | 'invalid-number'
  | 'join-subset-empty'
  | 'join-subset-not-inbound'
  | 'join-subset-unknown-node'
  | 'unknown-block'
  | 'fanout-source-unknown'
  | 'fanout-source-not-ancestor'
  | 'fanout-source-not-producer'
  | 'scope-memory-needs-fanout'
  | 'fanout-needs-memory-scope'
  | 'too-many-nodes'
  | 'too-many-edges'
  /** A node's hand-picked `files` list is longer than {@link DEVGRAPH_MAX_FILES}. */
  | 'too-many-files'
  /** A branching node declares more arms than {@link DEVGRAPH_MAX_BRANCHES}. */
  | 'too-many-branches'
  | 'label-too-long'
  | 'text-too-long';

/** Non-blocking observations. The graph still compiles with these present. */
export type GraphWarningCode =
  | 'join-subset-single-inbound'
  | 'join-subset-drops-barrier'
  | 'no-terminal-node'
  | 'deep-graph';

export type GraphIssueCode = GraphErrorCode | GraphWarningCode;

/**
 * One problem found on the canvas. `nodeId` / `edgeId` are the anchors the
 * editor highlights; `message` is a developer-facing English fallback for the
 * cases where no translation exists yet.
 */
export interface GraphIssue {
  code: GraphIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

/** What `validateGraph` returns. It never throws — every problem is data. */
export interface GraphValidation {
  ok: boolean;
  errors: GraphIssue[];
  warnings: GraphIssue[];
}
