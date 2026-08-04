// Compile a hand-drawn `huu-devgraph-v1` into a runnable `huu-pipeline-v2`.
//
// This is the module that makes the canvas WORTH drawing: the human draws the
// method — which blocks run, in which order, where a decision branches — and
// this file turns that drawing into an ordinary pipeline, which means the
// existing wave scheduler, memory fan-out, judge routing and deterministic
// stage merge run it UNCHANGED. No new scheduler, no new merge semantics, and
// nothing in here lets a model invent a node, an edge or a route.
//
// WHAT IT EMITS, per node kind:
//
//   prompt   → NOTHING. It is the objective, not a step. The nodes that hang
//              off it become the pipeline's ROOTS (`dependsOn: []`).
//   action   → one `WorkStep`.
//   research → one `WorkStep` (kind `info`), or a `WorkStep` + a `CheckStep`
//              that transcribes the artifact's verdict into a route.
//   gate     → one `CheckStep`.
//
// THE ENTRY GATE IS ASYMMETRIC WITH THE EDITOR, ON PURPOSE. `validateGraph`
// never throws because the editor validates on every keystroke of a half-drawn
// graph and a throw there is a blank canvas. THIS module throws on the first
// invalid graph it is handed, because a compiler that "repairs" a broken method
// silently runs a method nobody underwrote. Issues are something a human reads
// and fixes on the canvas; an invalid graph is not a pipeline.
//
// TWO INVARIANTS THIS COMPILER OWNS, both inherited from `validateTopology`:
//  - `dependsOn` may only name EARLIER steps. Steps are emitted in the graph's
//    topological order, so a dependency is always already in the array — but
//    the tests pin it, because a future emission reorder would break it
//    silently. The tests also pin that the array is NOT VACUOUSLY backwards: a
//    compiler that emitted `dependsOn: []` everywhere would satisfy "all
//    dependencies point backwards" and lose every join the human drew.
//  - a `memory`-scope step may not be at index 0. The graph validator already
//    requires a fan-out's producer to be an ANCESTOR, and an ancestor is
//    emitted first, so index 0 is structurally impossible here — pinned too,
//    together with the fact that the memory step DOES depend on its producer.
//
// THE ARM THAT GOES BACK. A rework edge (`GraphEdge.rework`) compiles to an
// `outcomes[].nextStepName` pointing at the FIRST step of a node that already
// ran — and to NOTHING in `dependsOn`. That asymmetry is the entire mechanism:
// `validateTopology` requires dependencies to point backwards in the array and
// says so in its own words ("loops belong to next/outcomes (activation edges)"),
// so a route back is legal exactly where a dependency back would not be. What
// bounds the loop is the gate's `maxRuns` (defaulted here to
// `DEVGRAPH_REWORK_CHECK_MAX_RUNS` when a gate actually has a rework arm), with
// `Pipeline.maxNodeExecutions` as the run-wide backstop — `resolveMaxNodeExecutions`
// budgets for the repeats instead of letting the backstop cut a legitimate loop.
//
// AUTHOR TEXT: WHAT IS NEUTRALIZED, AND WHY IT IS NOT EVERYTHING.
//
// One posture, stated once, so this file stops contradicting itself (it used to
// argue at length that the goal was too dangerous to hand a research prompt and
// then hand the same goal, raw, to every action prompt and every judge):
//
//   TEXT THAT TRAVELS IS NEUTRALIZED. The `goal` reaches nodes its author was
//   not writing (every block template, every critic brief) and the gate
//   `condition` is pasted into a JUDGE prompt whose closed enum and JSON
//   verdict contract are huu's MACHINERY. In both places the delimiters belong
//   to huu, and a forged `=== … ===` section or a stray ``` fence would rewrite
//   a mechanism rather than an instruction. Both go through
//   `neutralizePromptText` (`research-contract.ts`), the same function the
//   research prompt already used.
//
//   TEXT THAT STAYS IS NOT. A node's own `prompt` override IS the instruction
//   for that node — its fences and its headers are the author writing a prompt,
//   which is the feature. Neutralizing it would mangle legitimate code fences
//   to no purpose: there is no boundary to cross, because the author is
//   addressing their own agent. `notes` never reach an agent at all.
//
// This is a coherence rule, not a security boundary: the author of a devgraph
// underwrites the run. What it buys is that a human who pastes a spec
// containing `=== HARD RULES ===` into the objective gets a prompt that still
// means what it says.
//
// HONEST NOTE ON `subset` JOINS (repeated from `graph-types.ts` because this is
// where the temptation lives): relaxing a join removes the DEPENDENCY — of data
// and of success — between two branches. It does NOT remove huu's BSP merge
// barrier: every branch of a wave still merges into the integration worktree
// before the next wave starts. This compiler emits `dependsOn`, and `dependsOn`
// is a dependency. It does not, and cannot, compile "skip the barrier".
//
// Keep this file pure (no fs / no env / no clock): it is unit-tested without a
// repo and will be imported by the web server, the CLI and the driver alike.

import { prefixPrompt } from '../dev-mode/dev-protocol.js';
import { DEV_METHODOLOGIES } from '../dev-mode/methodology-registry.js';
import { PipelineSchema } from '../pipeline-io.js';
import {
  DEFAULT_MAX_NODE_EXECUTIONS,
  DEFAULT_MEMORY_MAX_FILES,
  DEFAULT_REVIEW_BLOCK_ON,
  DEFAULT_REVIEW_MAX_FINDINGS,
  DEFAULT_REVIEW_MAX_ROUNDS,
  type CheckOutcome,
  type CheckStep,
  type DevMethodology,
  type Pipeline,
  type PipelineStep,
  type ReviewSpec,
  type StepScope,
  type WorkStep,
} from '../types.js';
import {
  isActionNode,
  isGateNode,
  isPromptNode,
  isResearchNode,
  isReworkEdge,
  type ActionNode,
  type DevGraph,
  type GateNode,
  type GraphNode,
  type ResearchNode,
} from './graph-types.js';
import {
  ancestorsOf,
  branchOutcomesOf,
  descendantsOf,
  effectiveDependencies,
  outboundEdges,
  topoOrder,
  validateGraph,
} from './graph-validate.js';
import { findBlock, type ActionBlock } from './node-catalog.js';
import { researchSpecOf, upstreamInfoSpecs } from './research-bridge.js';
import {
  allowedLabels,
  buildResearchContextBlock,
  buildResearchJudgeCondition,
  buildResearchPrompt,
  defaultLabel,
  neutralizePromptText,
  sanitizeGraphRoot,
  sanitizeNodeId,
  type ResearchRoutingKind,
  type ResearchSpec,
} from './research-contract.js';

// ─────────────────────────────── caps & names ───────────────────────────────

/**
 * Fan-out width when a node does not set `maxFiles` — the SAME default the
 * orchestrator applies, so the emitted step and the MEMORY CONTRACT the
 * producer receives always quote one number.
 */
export const DEVGRAPH_DEFAULT_FAN_OUT = DEFAULT_MEMORY_MAX_FILES;

/**
 * Ceiling `WorkStepSchema.maxFiles` accepts. NOT the same number as
 * `DEVGRAPH_MAX_FILES` (400), which caps a node's HAND-PICKED file list: one is
 * how many files a human may select, the other is how wide a run-time fan-out
 * may get. `ActionNodeSchema` accepts `maxFiles` up to 500, so clamping here is
 * mandatory — an unclamped 500 turns the output gate into a "compiler bug"
 * throw for what is really an author's over-ambitious number.
 */
export const DEVGRAPH_MAX_FAN_OUT = 100;

/** Visit cap for a compiled check when the node does not name one. */
export const DEVGRAPH_CHECK_MAX_RUNS = 2;

/**
 * Visit cap for a gate that actually HAS a rework arm and named no `maxRuns`.
 *
 * Three visits = the first verdict plus two chances to fix, which is the
 * smallest number that makes a loop worth drawing (at 2 the human gets one
 * retry, and a gate that can retry once is barely a gate). It applies ONLY to
 * gates with a rework arm, so every graph drawn before loops existed keeps
 * {@link DEVGRAPH_CHECK_MAX_RUNS} and compiles byte-identically.
 *
 * This number is the REAL loop bound. `Pipeline.maxNodeExecutions` is the
 * run-wide backstop underneath it — see {@link resolveMaxNodeExecutions}, which
 * budgets for the repeats so the backstop never cuts a loop the human
 * legitimately drew.
 */
export const DEVGRAPH_REWORK_CHECK_MAX_RUNS = 3;

/**
 * Root of the `huu-memory-v1` lists producing blocks write — see
 * {@link fanOutPath} for the per-session, per-node path itself.
 *
 * NOT under `graphRoot`, and that is the one path decision in this file worth
 * arguing about. The producing blocks' own `promptTemplate`s instruct the agent
 * to un-ignore EXACTLY this directory with a minimal `!.huu/findings/` rewrite
 * when the repository ignores `.huu/`. A list written anywhere else in an
 * ignoring repo is simply never committed, and `resolveMemoryFiles` reads the
 * INTEGRATION worktree — so the next step would fan out over zero tasks, and
 * the stage would complete empty with nothing to show for it. Any future move
 * of this constant has to move the gitignore remedy in those templates with it.
 *
 * The listed PATHS survive regardless: `SKIPPED_PREFIXES` in `memory-files.ts`
 * covers `node_modules/`, `dist/`, `.git/` and friends — not `.huu/`.
 */
export const DEVGRAPH_FINDINGS_DIR = '.huu/findings';

/**
 * The namespace used when the caller names no session and `graphRoot`
 * sanitizes to nothing. Deliberately a WORD, not an empty segment: two
 * unrelated runs sharing `shared/` is a bug the human can see in a path,
 * whereas collapsing back onto `.huu/findings/<nodeId>.json` would silently
 * restore the collision this namespace exists to remove.
 */
const DEVGRAPH_SHARED_NAMESPACE = 'shared';

/** Step names are kanban cards; keep the human-readable half scannable. */
const MAX_STEP_LABEL = 40;

/** Ceiling `PipelineSchema` puts on `maxNodeExecutions`. */
const MAX_NODE_EXECUTIONS_CAP = 1000;

/** Ceiling `PipelineSchema` puts on `description`. */
const MAX_DESCRIPTION = 280;

// ───────────────────────────────── options ──────────────────────────────────

export interface CompileGraphOptions {
  graph: DevGraph;
  /** O objetivo do humano, verbatim. Substitui `$goal` nos templates. */
  goal?: string;
  /** Raiz do blackboard deste grafo, repo-relativa. Ex.: `.huu/dev/<sessionId>/graph` */
  graphRoot: string;
  /**
   * A sessão que este grafo está rodando — o namespace das listas de fan-out.
   *
   * Omitido, é DERIVADO de `graphRoot` (que o chamador já namespaceia por
   * sessão), nunca ausente: uma lista sem namespace é a colisão que
   * {@link fanOutPath} existe para eliminar.
   */
  sessionId?: string;
  /** Default de modelo do run; `node.modelId` e `graph.meta.modelId` vencem. */
  modelId?: string;
  cardTimeoutMs?: number;
  singleFileCardTimeoutMs?: number;
  /** Prefixo do project-router, prepended a TODO prompt (`ROUTER_PREFIX`). */
  routerPrefix?: string;
}

export interface CompiledGraph {
  pipeline: Pipeline;
  /** Ordem em que os nós foram emitidos (topológica, determinística). */
  nodeOrder: string[];
  /** Mapa nodeId → nomes dos steps que ele gerou (1 ou 2). */
  stepsByNode: Record<string, string[]>;
  /** Reparos não-fatais. */
  warnings: string[];
}

// ──────────────────────────────── small utils ───────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodesOf(graph: DevGraph): GraphNode[] {
  return Array.isArray(graph?.nodes) ? (graph.nodes.filter(isRecord) as GraphNode[]) : [];
}

/**
 * POSIX join for repo-relative blackboard paths, with both halves sanitized.
 *
 * Byte-identical to `researchDir()` in `research-contract.ts` for the same
 * inputs, and `graph-to-pipeline.test.ts` pins that equality. The two cannot be
 * ONE function without `research-contract.ts` importing the graph or this
 * module importing a private — and a research artifact and a producer list that
 * disagreed by one slash would put two directories on the blackboard for one
 * node.
 */
function nodeDir(graphRoot: string, nodeId: string): string {
  const root = sanitizeGraphRoot(graphRoot);
  const id = sanitizeNodeId(nodeId);
  return [root, id].filter((part) => part.length > 0).join('/');
}

/**
 * The session namespace of the fan-out lists: an explicit `sessionId`, else one
 * derived from `graphRoot`, else {@link DEVGRAPH_SHARED_NAMESPACE}.
 *
 * Derivation exists so a caller CANNOT accidentally opt out. `graphRoot` is
 * already per-session by construction (`.huu/dev/<sessionId>/graph`), so
 * folding it into one path segment yields a namespace that is unique whenever
 * the blackboard is — without adding a required option that an existing caller
 * would have to be taught.
 */
function fanOutNamespace(sessionId: string | undefined, graphRoot: string): string {
  const explicit = sanitizeNodeId(sessionId);
  if (explicit.length > 0) return explicit;
  const derived = sanitizeNodeId(sanitizeGraphRoot(graphRoot).replaceAll('/', '-'));
  return derived.length > 0 ? derived : DEVGRAPH_SHARED_NAMESPACE;
}

/**
 * The `huu-memory-v1` list one producing node writes:
 * `.huu/findings/<session>/<node>.json`.
 *
 * NAMESPACED BY NODE, never by block: `validateTopology` rejects two steps
 * declaring the same `produces`, and `memoryCapForPath` matches producer to
 * consumer by string equality. A per-node path is what lets the same block be
 * dropped twice on one canvas.
 *
 * NAMESPACED BY SESSION, and this half is a CORRECTNESS FIX, not tidiness —
 * the same one `devSessionPaths` (`dev-mode/dev-protocol.ts`) made for the
 * epoch blackboard, for exactly the same reason. `resolveMemoryFiles` reads
 * `filesFrom` out of the INTEGRATION worktree, which branches from the user's
 * checkout, and it performs NO validity check on what it finds — just
 * `existsSync`. Node ids are semantic (`recon`, `achados`), so the old
 * `.huu/findings/<node>.json` was a path two different runs of the same drawing
 * would share. Concretely: yesterday a recon found 30 targets and COMMITTED the
 * list; today the same graph runs for a different objective and its recon fails
 * (or finds 3) — and the fan-out dispatches 27 agents onto yesterday's targets
 * with yesterday's hints. Real worktrees, real cost, work nobody asked for. One
 * path segment turns that from likely into impossible: a session whose producer
 * wrote nothing finds no list, resolves to ZERO tasks, and the stage completes
 * empty, which is the honest outcome.
 *
 * WHY THE SEGMENT GOES *UNDER* `.huu/findings/` AND NOT UNDER `graphRoot`.
 * Putting the list at `<graphRoot>/findings/<node>.json` would have been tidier
 * — everything else this module writes lives there — and it would have been
 * WRONG, because it breaks a coupling that is invisible from here: the
 * producing blocks' `promptTemplate`s (`node-catalog.ts`) tell the agent that,
 * in a repository whose `.gitignore` has `.huu/`, it may rewrite that line to
 * `.huu/*` and add `!.huu/findings/` — "the one edit permitted". That remedy
 * re-includes `.huu/findings/**`, so a session sub-directory under it is
 * committed; `.huu/dev/<sessionId>/graph/findings/` is NOT re-included by it
 * and would stay ignored, uncommitted, and invisible to `resolveMemoryFiles` —
 * a fan-out over zero tasks, silently, in exactly the repositories that need
 * the remedy. The tidy path would have traded one silent-zero bug for another.
 */
function fanOutPath(namespace: string, producerNodeId: string): string {
  return `${DEVGRAPH_FINDINGS_DIR}/${namespace}/${sanitizeNodeId(producerNodeId)}.json`;
}

/** Where a node's per-task critic writes its finding shards. */
function reviewDir(graphRoot: string, nodeId: string): string {
  return `${nodeDir(graphRoot, nodeId)}/review`;
}

/** One line, trimmed, capped — falls back to the node id when the label is blank. */
function shortLabel(node: GraphNode): string {
  const raw = typeof node.label === 'string' ? node.label.replace(/\s+/g, ' ').trim() : '';
  const text = raw.length > 0 ? raw : String(node.id ?? '');
  return text.length <= MAX_STEP_LABEL ? text : `${text.slice(0, MAX_STEP_LABEL - 1)}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ─────────────────────────────── step naming ────────────────────────────────

/**
 * THE STEP-NAME SCHEME, and why it is what it is.
 *
 *   single-step node   `3. Revisão de segurança [seguranca]`
 *   research pair      `3a. Existe CVE conhecida? [cve]`
 *                      `3b. Existe CVE conhecida? — decisão [cve]`
 *
 * Three jobs, one string:
 *  - the POSITION prefix is the node's 1-based place in the topological order,
 *    so a kanban and a log read in execution order instead of alphabetically;
 *  - the LABEL is what the human wrote on the chip, so a card is recognizable
 *    without opening the graph;
 *  - the `[node-id]` suffix is the DURABLE identity. A step name is a routing
 *    key inside one compilation (`dependsOn`, `nextStepName`), not a stable
 *    external id — insert a node upstream and every downstream position shifts.
 *    The id in the name is what still lets a human map a card back to the box
 *    they drew, and `CompiledGraph.stepsByNode` is the machine-readable form of
 *    the same mapping.
 *
 * UNIQUENESS is structural, not hoped for: the position prefix is unique per
 * node (one node, one position) and the `a`/`b` suffix separates the two steps
 * of a research pair. Two nodes with the same label therefore cannot collide,
 * and `validateTopology`'s duplicate-name rule can never fire on this output.
 *
 * STABILITY means DETERMINISM: `topoOrder` breaks ties by declaration order, so
 * compiling the same graph twice yields the same names, always. It does not
 * mean names survive an edit of the graph — nothing that carries a position
 * could.
 */
function stepNamesOf(node: GraphNode, position: number): string[] {
  const label = shortLabel(node);
  const id = String(node.id ?? '');
  if (isResearchNode(node) && node.outputKind !== 'info') {
    return [`${position}a. ${label} [${id}]`, `${position}b. ${label} — decisão [${id}]`];
  }
  return [`${position}. ${label} [${id}]`];
}

// ────────────────────────────── prompt blocks ───────────────────────────────

/**
 * The objective, restated for a node whose text never asked for it.
 *
 * ENGLISH, like the catalog's own `promptTemplate`s and every prompt under
 * `src/lib/default-pipelines/` — the compiler's added text speaks the language
 * of the text it wraps. (The two CHECK scaffolds below are pt-BR for the same
 * reason: they wrap, and sit beside, the pt-BR judge condition
 * `research-contract.ts` builds.)
 */
function goalBlock(goal: string): string {
  return `=== THE OBJECTIVE (written by the human — never reinterpret or widen it) ===
${goal}`;
}

/**
 * The block's `judgeClause`, handed to the AGENT rather than only to a judge.
 *
 * WHERE `judgeClause` ENDS UP, in full: it does NOT become a step of its own —
 * a per-node CheckStep would double the run's node count and turn every action
 * into a gate the human never drew. It is used twice, both times as TEXT: here,
 * as the acceptance the agent is told it will be measured against (technique 3,
 * "state the output contract"), and inside {@link buildGraphReviewSpec} as the
 * declared standard for the per-task critic. A human who wants that clause to
 * ROUTE something draws a gate node and writes it there — which is exactly the
 * decision this format says belongs to the human.
 */
function acceptanceBlock(clause: string): string {
  return `=== ACCEPTANCE (what this node is measured against) ===
${clause}`;
}

/** The fixed-enum tail every compiled `CheckStep` carries. Mechanical on purpose. */
function outcomeContractBlock(
  outcomes: readonly { label: string; human?: string }[],
  fallback: string,
): string {
  const lines = outcomes.map(
    (outcome) =>
      `- \`${outcome.label}\`${outcome.human && outcome.human !== outcome.label ? ` — ${outcome.human}` : ''}${outcome.label === fallback ? ' (default)' : ''}`,
  );
  return `=== RÓTULOS PERMITIDOS (enum fechado — qualquer outra coisa é descartada) ===
${lines.join('\n')}

\`${fallback}\` é a rota SEGURA deste nó: é para onde o grafo vai se você falhar, se não conseguir decidir, ou se escrever um rótulo fora da lista. Qual rota é segura foi decisão do AUTOR do grafo, não sua — não a reavalie.

=== SAÍDA ===
Sua mensagem final deve conter um único bloco JSON:

\`\`\`json
{ "label": "<um dos rótulos permitidos>", "reason": "<a evidência que decidiu, em uma linha>" }
\`\`\``;
}

// ──────────────────────────────── review spec ───────────────────────────────

/**
 * The per-task critic brief for one action node.
 *
 * Minimal and honest: everything it asks for is something this compiler
 * actually knows (the human's goal, the block's method, the block's acceptance
 * clause, the node's own findings directory). It does NOT reference an atlas,
 * task specs or verify commands — dev mode's epoch compiler has those because
 * an epoch WRITES them; a devgraph has no such artifacts, and a critic told to
 * load a file nobody wrote is a critic that invents a standard.
 *
 * Every ordering rule below defends against the measured dominant failure mode
 * of an LLM critic — SPURIOUS BLOCKING of correct code, not missed bugs — which
 * is why a blocking correctness claim needs a counterexample and "I could not
 * verify this" is spelled out as a correct answer.
 *
 * `modelId` is deliberately NOT stamped, even when the node names one: the
 * node's model is the WORKER's, and a model reviewing its own family's output
 * is this design's most fragile assumption. Leaving it unset makes the critic
 * fall back to `AppConfig.modelId`, which is a different model whenever the
 * node overrode it — the cross-family second opinion, for free.
 */
function buildGraphReviewSpec(
  node: ActionNode,
  block: ActionBlock,
  goal: string,
  graphRoot: string,
): ReviewSpec {
  const acceptance = block.judgeClause
    ? `\n\n=== THE DECLARED ACCEPTANCE (the block's own standard — binding here) ===\n${block.judgeClause}`
    : '';

  return {
    prompt: `You are auditing ONE task of the node "${node.id}" of a hand-drawn huu method. A different agent wrote this diff alone, in its own worktree.

=== THE OBJECTIVE (written by the human — never reinterpret it) ===
${goal}

=== WHAT THIS NODE WAS ASKED TO DO ===
${block.label} — ${block.description}${acceptance}

=== THE THREE LENSES, IN THIS ORDER ===
1. **correctness** — does the diff do what this node asked, without breaking what already worked?
2. **pattern** — does it follow THIS project's design patterns?
3. **style** — does it match THIS project's code style?

You do NOT invent the standard for 2 and 3. LOAD it from the project's own convention files (\`AGENTS.md\` / \`CLAUDE.md\` / the code around the diff). If none of them states a rule, that rule does not exist in this project — do not import a convention from somewhere else.

=== ORDER OF WORK (do not reorder) ===
1. RUN this project's own build / type-check / test commands FIRST and paste their real output into your reply BEFORE writing a single finding. Discover them from the project configuration; if this project genuinely has none, say so and never invent one.
2. Every failure a command actually demonstrated becomes a finding WITH \`proof\` (the command, its exit code, a short excerpt). Those come first.
3. ONLY THEN read the diff and judge pattern and style.

=== WHAT MAKES A FINDING LEGITIMATE HERE ===
- A correctness finding at \`blocker\` or \`major\` requires a CONCRETE COUNTEREXAMPLE — the input, the expected output, the actual output — or a command that failed. Without one it is a \`minor\`. A confident story about how the code "could" break is not evidence.
- Do NOT invent requirements. A constraint that is not in the objective above, not in this node's acceptance, and not in a project convention you can point at is not a violation.
- "I could not verify this" is a correct and cheap answer. Prefer it to a guess.
- At most ${DEFAULT_REVIEW_MAX_FINDINGS} findings, severity-descending, \`evidence\` ≤ 15 lines. A longer list is not a better review.
- Only this diff is yours to judge. A problem that already existed outside it does not belong here.

=== WHAT BLOCKING COSTS ===
${DEFAULT_REVIEW_BLOCK_ON.join(' and ')} findings hold the merge and send the work back to the SAME agent, for at most ${DEFAULT_REVIEW_MAX_ROUNDS} round(s). Everything else is recorded and merged. Blocking correct code is the failure mode this review is calibrated against, not missing a nit.`,
    maxRounds: DEFAULT_REVIEW_MAX_ROUNDS,
    blockOn: [...DEFAULT_REVIEW_BLOCK_ON],
    maxFindings: DEFAULT_REVIEW_MAX_FINDINGS,
    findingsDir: reviewDir(graphRoot, node.id),
  };
}

// ──────────────────────────────── methodology ───────────────────────────────

/**
 * Narrow `graph.meta.methodology` — a loose `Record<string, true>` so the
 * browser payload never drags the dev-mode types in — back to
 * {@link DevMethodology}, and name the keys that are not methodologies.
 *
 * WHAT THIS COMPILER DOES WITH THE RESULT: nothing but carry it. The twelve
 * methodologies are the EPOCH compiler's surface (`plan-to-pipeline.ts`), where
 * each flag compiles a structure — an extra step, an extra check, a critic
 * rubric, a merge gate, a judge clause — into a graph the PLANNER wrote. A
 * devgraph expresses method by DRAWING it: the human who wants test-first drops
 * the `tdd` block, and the human who wants a quality gate draws a gate node.
 * Applying the flags here would mean this compiler adding steps the human never
 * drew, which is the exact decision `huu-devgraph-v1` exists to take back from
 * the machine. So the flags are validated, reported, and left for whoever
 * launches the run.
 */
export function narrowGraphMethodology(graph: DevGraph): {
  methodology: DevMethodology;
  unknownKeys: string[];
} {
  const known = new Set<string>(DEV_METHODOLOGIES.map((definition) => definition.key));
  const methodology: Record<string, true> = {};
  const unknownKeys: string[] = [];
  const raw = isRecord(graph?.meta?.methodology) ? graph.meta.methodology : {};
  for (const key of Object.keys(raw)) {
    if (raw[key] !== true) continue;
    if (known.has(key)) methodology[key] = true;
    else unknownKeys.push(key);
  }
  return { methodology: methodology as DevMethodology, unknownKeys };
}

// ──────────────────────────────── the compiler ──────────────────────────────

/** Everything the per-node builders need, resolved once per compilation. */
interface Ctx {
  graph: DevGraph;
  /**
   * The objective as it enters a PROMPT — neutralized (see the file header's
   * "author text" section). The raw objective survives only in the pipeline
   * description, which is a label a human reads, not a prompt an agent obeys.
   */
  goal: string;
  graphRoot: string;
  /** Session segment of every fan-out list — see {@link fanOutPath}. */
  fanOutNamespace: string;
  /** node id → the step names it emitted, in emission order. */
  namesByNode: Map<string, string[]>;
  promptNodeId: string | undefined;
  /** Run-wide model default; a node may override it. */
  modelId: string | undefined;
  warn: (message: string) => void;
}

/** `{ modelId }` when something named one, `{}` otherwise (AppConfig then wins). */
function modelStamp(ctx: Ctx, node: GraphNode): { modelId?: string } {
  const own = 'modelId' in node && typeof node.modelId === 'string' ? node.modelId.trim() : '';
  if (own.length > 0) return { modelId: own };
  return ctx.modelId ? { modelId: ctx.modelId } : {};
}

/** First step of a node — the target of every routing edge that lands on it. */
function firstStepOf(ctx: Ctx, nodeId: string): string | undefined {
  return ctx.namesByNode.get(nodeId)?.[0];
}

/**
 * Last step of a node — what a DEPENDENT waits for. A research pair is only
 * done when its judge has routed, so a node depending on it depends on the
 * CheckStep, never on the work step alone.
 */
function lastStepOf(ctx: Ctx, nodeId: string): string | undefined {
  const names = ctx.namesByNode.get(nodeId);
  return names?.[names.length - 1];
}

/**
 * `dependsOn` for a node: its EFFECTIVE dependencies, mapped to step names.
 *
 * The prompt node is dropped rather than resolved — it emits no step, so a node
 * hanging directly off the objective becomes a pipeline ROOT (`[]`). Emitting
 * `[]` instead of leaving the field undefined is deliberate: `undefined` means
 * "depends on the previous step in the array" (the legacy cursor), which would
 * serialize branches the human drew in parallel.
 */
function dependsOnOf(ctx: Ctx, nodeId: string): string[] {
  const deps: string[] = [];
  for (const depId of effectiveDependencies(ctx.graph, nodeId)) {
    if (depId === ctx.promptNodeId) continue;
    const name = lastStepOf(ctx, depId);
    if (name === undefined) continue;
    if (!deps.includes(name)) deps.push(name);
  }
  return deps;
}

/** The research context every ACTION and GATE node upstream of an `info` node gets. */
function researchContextFor(ctx: Ctx, nodeId: string): string {
  return buildResearchContextBlock(upstreamInfoSpecs(ctx.graph, nodeId, ctx.graphRoot));
}

/**
 * arm id → the node that arm routes to.
 *
 * Reads the ACTIVATION layer (`outboundEdges`, rework arms included): a route
 * back is still a route, and the arm that carries it needs its `nextStepName`
 * exactly like every other. What a rework arm never becomes is a dependency —
 * that separation lives in `effectiveDependencies`, not here.
 */
function armTargets(graph: DevGraph, nodeId: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const edge of outboundEdges(graph, nodeId)) {
    if (typeof edge.sourceOutcome !== 'string') continue;
    if (!targets.has(edge.sourceOutcome)) targets.set(edge.sourceOutcome, edge.target);
  }
  return targets;
}

/** The arm ids of `nodeId` that go BACK, as the sanitized labels a judge emits. */
function reworkLabels(graph: DevGraph, nodeId: string): Set<string> {
  const out = new Set<string>();
  for (const edge of outboundEdges(graph, nodeId)) {
    if (!isReworkEdge(edge) || typeof edge.sourceOutcome !== 'string') continue;
    const label = sanitizeNodeId(edge.sourceOutcome);
    if (label.length > 0) out.add(label);
  }
  return out;
}

/**
 * Resolve one arm to the FIRST step of the node it points at.
 *
 * `label` arrives from `allowedLabels()`, which SANITIZES ids, while the edges
 * carry the ids exactly as drawn. On a schema-valid graph the two are identical
 * (`ResearchChoiceSchema`/`GateOutcomeSchema` already demand a slug), so the
 * `rawByLabel` detour is a no-op — it exists for the graph that reached this
 * module without ever passing `parseDevGraph`, where an id like `Yes` would
 * otherwise silently lose its route.
 */
function armStep(
  ctx: Ctx,
  node: GraphNode,
  label: string,
  rawByLabel: Map<string, string>,
  targets: Map<string, string>,
): string | undefined {
  const raw = rawByLabel.get(label) ?? label;
  const targetId = targets.get(raw) ?? targets.get(label);
  if (targetId === undefined) return undefined;
  return firstStepOf(ctx, targetId);
}

/** Every arm of a branching node, keyed by the label the judge will emit. */
function rawArmsByLabel(node: GraphNode, ctx: Ctx): Map<string, string> {
  const map = new Map<string, string>();
  for (const arm of branchOutcomesOf(node) ?? []) {
    const label = sanitizeNodeId(arm.id);
    if (label.length === 0) continue;
    if (map.has(label)) {
      ctx.warn(
        `node "${node.id}": outcomes "${map.get(label)}" and "${arm.id}" collapse to the same label "${label}" — one of the two arms will never be routable`,
      );
      continue;
    }
    map.set(label, arm.id);
  }
  return map;
}

/**
 * Force exactly one `default: true`, which `validateTopology` requires and the
 * forward-default rule depends on.
 *
 * On a valid graph the default is already there (`default-outcome-missing`,
 * `default-outcome-unknown` and `default-outcome-is-rework` are blocking
 * errors, and `defaultLabel()` always returns a member of the enum). This is
 * the net for the degraded case, and it picks the LAST outcome for the same
 * reason `defaultLabel` does: it is deterministic, in-enum, and honest about
 * not being a claim of safety.
 *
 * The one preference it does express is the forward-default rule: among the
 * candidates it prefers the last NON-REWORK arm, because the default fires when
 * the judge FAILS and a default that loops turns a broken judge into a run that
 * spins backwards until `maxNodeExecutions` kills it. Only if every arm goes
 * back does it take one anyway — and says so, loudly.
 */
function ensureSingleDefault(
  outcomes: CheckOutcome[],
  stepName: string,
  ctx: Ctx,
  reworkArms: ReadonlySet<string> = new Set(),
): CheckOutcome[] {
  const defaults = outcomes.filter((outcome) => outcome.default === true);
  if (defaults.length === 1 && !reworkArms.has(defaults[0]!.label)) return outcomes;

  const forward = outcomes.filter((outcome) => !reworkArms.has(outcome.label));
  const chosen = (forward.length > 0 ? forward : outcomes)[
    (forward.length > 0 ? forward : outcomes).length - 1
  ]!;
  ctx.warn(
    forward.length > 0
      ? `check "${stepName}" resolved ${defaults.length} usable default outcome(s) — forcing "${chosen.label}", the last arm that goes FORWARD`
      : `check "${stepName}" has NO forward arm — forcing the rework arm "${chosen.label}" as the default, which means a judge that fails will loop until the run's execution budget stops it`,
  );
  return outcomes.map((outcome) => ({ ...outcome, default: outcome === chosen }));
}

// --- action ------------------------------------------------------------------

function buildActionStep(
  node: ActionNode,
  ctx: Ctx,
  producers: ReadonlySet<string>,
): WorkStep {
  const block = findBlock(node.block);
  if (!block) {
    // Unreachable: `unknown-block` is a blocking error and the entry gate ran.
    throw new Error(
      `devgraph compiler bug: node "${node.id}" survived validation with the unknown block "${node.block}"`,
    );
  }

  const name = ctx.namesByNode.get(node.id)![0]!;
  const fanOutFrom = typeof node.fanOutFrom === 'string' ? node.fanOutFrom : undefined;

  // --- scope -----------------------------------------------------------------
  let scope: StepScope = fanOutFrom !== undefined ? 'memory' : (node.scope ?? block.defaultScope);
  if (scope === 'memory' && fanOutFrom === undefined) {
    // Only reachable through a CATALOG block whose `defaultScope` is `memory`:
    // the graph validator's `scope-memory-needs-fanout` checks the node's OWN
    // scope, which is undefined here. Left as `memory` this would fail the
    // output gate as a "compiler bug" for what is a block/graph mismatch.
    ctx.warn(
      `node "${node.id}": block "${block.id}" defaults to scope "memory" but the node has no fanOutFrom — compiled as "project" (a memory step with no list to read runs zero tasks)`,
    );
    scope = 'project';
  }

  // --- files -----------------------------------------------------------------
  let files = Array.isArray(node.files) ? node.files.filter((f) => typeof f === 'string') : [];
  if ((scope === 'project' || scope === 'memory') && files.length > 0) {
    ctx.warn(
      `node "${node.id}": ${files.length} hand-picked file(s) dropped — scope "${scope}" decides its own file set`,
    );
    files = [];
  }
  if (scope === 'per-file' && files.length === 0) {
    ctx.warn(
      `node "${node.id}": scope "per-file" with no files picked — this step decomposes into ZERO tasks and the stage completes empty`,
    );
  }

  // --- prompt ----------------------------------------------------------------
  const override = typeof node.prompt === 'string' ? node.prompt.trim() : '';
  const source = override.length > 0 ? node.prompt! : block.promptTemplate;
  // `$goal` is the catalog's own token and is substituted in BOTH the template
  // and a node's override — same vocabulary, one substitution. `$file`/`$hint`
  // are NEVER touched here: they are huu's per-agent fan-out tokens and are
  // substituted by the orchestrator, once per task.
  const hadGoalToken = source.includes('$goal');
  const body = source.replaceAll('$goal', ctx.goal).trim();
  if (body.length === 0) {
    ctx.warn(
      `node "${node.id}": block "${block.id}" has no prompt template and the node wrote none — the agent gets the objective and nothing else`,
    );
  }

  const context = researchContextFor(ctx, node.id);
  const parts = [
    ...(hadGoalToken ? [] : [goalBlock(ctx.goal)]),
    ...(context ? [context] : []),
    ...(body ? [body] : []),
    ...(block.judgeClause ? [acceptanceBlock(block.judgeClause)] : []),
  ];

  // --- read-only vs produces -------------------------------------------------
  let readOnly = block.readOnly === true;
  if (readOnly && block.produces === true) {
    ctx.warn(
      `node "${node.id}": block "${block.id}" is both readOnly and a producer — readOnly dropped, since writing a huu-memory-v1 list needs the write tool`,
    );
    readOnly = false;
  }

  const step: WorkStep = {
    type: 'work',
    name,
    scope,
    files,
    dependsOn: dependsOnOf(ctx, node.id),
    ...modelStamp(ctx, node),
    prompt: parts.join('\n\n'),
  };

  // A producer declares `produces` whenever its BLOCK says it writes a list —
  // by FIELD, never by block id, and not only when some node fans out from it.
  // `produces` is the ONLY thing that makes huu append the MEMORY CONTRACT
  // (exact path + `huu-memory-v1` + the consumer's cap + the hint rule) to this
  // prompt at run time, and the producing templates literally point at "the
  // MEMORY CONTRACT appended at the end of this prompt" — without the field the
  // agent is told to follow a contract it was never given. No format
  // boilerplate is written here, by design.
  if (block.produces === true) {
    step.produces = fanOutPath(ctx.fanOutNamespace, node.id);
  }
  if (readOnly) step.readOnly = true;

  if (fanOutFrom !== undefined) {
    step.filesFrom = fanOutPath(ctx.fanOutNamespace, fanOutFrom);
    const requested = typeof node.maxFiles === 'number' ? node.maxFiles : DEVGRAPH_DEFAULT_FAN_OUT;
    const capped = clamp(Math.trunc(requested), 1, DEVGRAPH_MAX_FAN_OUT);
    if (capped !== requested) {
      ctx.warn(
        `node "${node.id}": fan-out width ${requested} clamped to ${capped} (a pipeline step accepts at most ${DEVGRAPH_MAX_FAN_OUT})`,
      );
    }
    step.maxFiles = capped;
    if (!producers.has(fanOutFrom)) {
      // Unreachable on a valid graph (`fanout-source-not-producer`), kept as a
      // net: a `filesFrom` nobody produces resolves to zero tasks at run time.
      ctx.warn(
        `node "${node.id}": fans out from "${fanOutFrom}", which declares no produces — the fan-out will find no list`,
      );
    }
  }

  if (node.review ?? block.review) {
    step.review = buildGraphReviewSpec(node, block, ctx.goal, ctx.graphRoot);
  }

  return step;
}

// --- research ----------------------------------------------------------------

function buildResearchSteps(node: ResearchNode, ctx: Ctx): PipelineStep[] {
  const names = ctx.namesByNode.get(node.id)!;
  const spec: ResearchSpec = researchSpecOf(ctx.graph, node, ctx.graphRoot);

  // The research prompt is NOT given the graph objective, and the reason is
  // ASSIGNMENT, not safety — the file header's posture already neutralizes the
  // objective everywhere it enters a prompt, here as much as anywhere else. A
  // research node's assignment is its QUERY: the prompt is built around one
  // question, with a closed label enum and an artifact contract, and widening
  // it with a project-wide objective is how a question becomes "tell me about
  // the project". If the objective matters to the question, the human writes it
  // into the query — which is the same rule the canvas states everywhere else.
  const work: WorkStep = {
    type: 'work',
    name: names[0]!,
    scope: 'project',
    files: [],
    dependsOn: dependsOnOf(ctx, node.id),
    ...modelStamp(ctx, node),
    prompt: buildResearchPrompt(spec),
  };

  if (node.outputKind === 'info') return [work];

  const targets = armTargets(ctx.graph, node.id);
  const rawByLabel = rawArmsByLabel(node, ctx);
  const fallback = defaultLabel(spec);
  const checkName = names[1]!;
  const rework = reworkLabels(ctx.graph, node.id);

  const outcomes: CheckOutcome[] = [];
  for (const label of allowedLabels(spec)) {
    const nextStepName = armStep(ctx, node, label, rawByLabel, targets);
    if (nextStepName === undefined) {
      // Unreachable on a valid graph: `branch-outcome-missing-edge` is blocking.
      throw new Error(
        `devgraph compiler bug: research node "${node.id}" has no outgoing edge for its arm "${label}"`,
      );
    }
    outcomes.push({ label, nextStepName, ...(label === fallback ? { default: true } : {}) });
  }

  const check: CheckStep = {
    type: 'check',
    name: checkName,
    dependsOn: [work.name],
    // A research node that sends work back gets the loop budget, like a gate.
    maxRuns: rework.size > 0 ? DEVGRAPH_REWORK_CHECK_MAX_RUNS : DEVGRAPH_CHECK_MAX_RUNS,
    ...modelStamp(ctx, node),
    // The judge TRANSCRIBES the artifact the work step committed; it does not
    // re-research and does not weigh the research's merit. The compile-time
    // barrier on `kind` is why the cast below is safe: `info` returned above.
    condition: buildResearchJudgeCondition(spec as ResearchSpec & { kind: ResearchRoutingKind }),
    outcomes: ensureSingleDefault(outcomes, checkName, ctx, rework),
  };

  return [work, check];
}

// --- gate --------------------------------------------------------------------

function buildGateStep(node: GateNode, ctx: Ctx): CheckStep {
  const name = ctx.namesByNode.get(node.id)![0]!;
  const targets = armTargets(ctx.graph, node.id);
  const arms = branchOutcomesOf(node) ?? [];
  const rawByLabel = rawArmsByLabel(node, ctx);
  const rework = reworkLabels(ctx.graph, node.id);

  // The judge answers with the arm's ID, never its pt-BR chip label: the id is a
  // slug, it is what the edges route on, and it is what `defaultOutcome` names.
  const declaredDefault =
    typeof node.defaultOutcome === 'string' ? sanitizeNodeId(node.defaultOutcome) : '';
  const labels = [...rawByLabel.keys()];
  const fallback = labels.includes(declaredDefault)
    ? declaredDefault
    : (labels[labels.length - 1] ?? '');

  const outcomes: CheckOutcome[] = [];
  for (const label of labels) {
    const nextStepName = armStep(ctx, node, label, rawByLabel, targets);
    if (nextStepName === undefined) {
      // Unreachable on a valid graph: `branch-outcome-missing-edge` is blocking.
      throw new Error(
        `devgraph compiler bug: gate "${node.id}" has no outgoing edge for its outcome "${label}"`,
      );
    }
    outcomes.push({ label, nextStepName, ...(label === fallback ? { default: true } : {}) });
  }

  const human = new Map(arms.map((arm) => [sanitizeNodeId(arm.id), arm.label]));
  // AUTHOR TEXT THAT TRAVELS (see the file header): the condition is pasted
  // into a judge prompt whose closed enum and JSON verdict block are huu's
  // machinery, so it is neutralized exactly like a research query — a condition
  // containing `=== RÓTULOS PERMITIDOS ===` must not be able to forge the enum
  // the route is read from.
  const condition = neutralizePromptText(node.condition);
  if (condition.length === 0) {
    ctx.warn(
      `gate "${node.id}": no condition was drawn — the judge is told to take the default route "${fallback}" instead of inventing a criterion`,
    );
  }

  const body =
    condition.length > 0
      ? `Você é o juiz do portão \`${node.id}\` ("${shortLabel(node)}"), rodando no worktree de integração com acesso a shell. Reúna evidência ANTES de responder — rode os comandos e leia os arquivos que a condição exigir.

=== A CONDIÇÃO (escrita pelo humano — não a reinterprete nem a amplie) ===
${condition}

Esta é a visita nº $runs a este portão.`
      : `O portão \`${node.id}\` ("${shortLabel(node)}") foi desenhado SEM condição. Isto é um defeito de autoria do grafo, não um erro seu: não existe critério para avaliar e você não deve inventar um. Responda com o rótulo default \`${fallback}\` e diga no \`reason\` que a condição estava vazia. (Visita nº $runs.)`;

  const context = researchContextFor(ctx, node.id);

  return {
    type: 'check',
    name,
    dependsOn: dependsOnOf(ctx, node.id),
    // THE LOOP BOUND. A gate with a rework arm is the only thing that can make
    // work repeat, so its visit cap IS the retry budget the human gets. Gates
    // without one keep the historical default, which is what makes every graph
    // drawn before loops existed compile byte-identically.
    maxRuns: clamp(
      Math.trunc(
        typeof node.maxRuns === 'number'
          ? node.maxRuns
          : rework.size > 0
            ? DEVGRAPH_REWORK_CHECK_MAX_RUNS
            : DEVGRAPH_CHECK_MAX_RUNS,
      ),
      1,
      50,
    ),
    ...modelStamp(ctx, node),
    condition: [
      ...(context ? [context] : []),
      body,
      outcomeContractBlock(
        outcomes.map((outcome) => ({ label: outcome.label, human: human.get(outcome.label) })),
        fallback,
      ),
    ].join('\n\n'),
    outcomes: ensureSingleDefault(outcomes, name, ctx, rework),
  };
}

// --- entry point -------------------------------------------------------------

/**
 * Compile a `huu-devgraph-v1` into a validated `huu-pipeline-v2`.
 *
 * THROWS on an invalid graph (the entry gate — see the file header) and on a
 * pipeline this compiler itself got wrong (the output gate). It never throws
 * for anything it can repair: clamped numbers, dropped file lists and degraded
 * scopes come back in `warnings`, which the caller is expected to SHOW.
 */
export function compileGraphPipeline(opts: CompileGraphOptions): CompiledGraph {
  const graph = opts.graph;
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
  };

  // --- entry gate ------------------------------------------------------------
  const validation = validateGraph(graph);
  if (!validation.ok) {
    const codes = validation.errors.map((issue) => issue.code).join(', ');
    const detail = validation.errors
      .map((issue) => `${issue.code}${issue.nodeId ? ` (${issue.nodeId})` : ''}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `devgraph "${graph?.id ?? '?'}" does not compile — ${validation.errors.length} blocking issue(s) [${codes}]: ${detail}`,
    );
  }
  for (const issue of validation.warnings) {
    warn(`graph warning [${issue.code}]${issue.nodeId ? ` on "${issue.nodeId}"` : ''}: ${issue.message}`);
  }

  // --- resolved inputs -------------------------------------------------------
  const nodes = nodesOf(graph);
  const promptNode = nodes.find(isPromptNode);
  const rawGoal = (opts.goal ?? promptNode?.goal ?? '').trim();
  // AUTHOR TEXT THAT TRAVELS (see the file header): the objective is injected
  // into templates this compiler wrote, into every `$goal` token and into the
  // critic's brief — prompts whose `=== … ===` sections are huu's machinery and
  // whose author is not the one who wrote the objective. The RAW text survives
  // only in `pipeline.description`, which is a label for a human, not an
  // instruction for an agent.
  const goal = neutralizePromptText(rawGoal);
  if (goal.length === 0) {
    warn('the graph carries no objective — every prompt that injects $goal will inject nothing');
  }

  const graphRoot = sanitizeGraphRoot(opts.graphRoot);
  if (graphRoot.length === 0) {
    warn(
      'graphRoot is empty after sanitization — every artifact this graph writes lands at the repository root',
    );
  }

  const { methodology, unknownKeys } = narrowGraphMethodology(graph);
  for (const key of unknownKeys) {
    warn(`meta.methodology names "${key}", which is not a huu methodology — ignored`);
  }
  const declared = Object.keys(methodology);
  if (declared.length > 0) {
    warn(
      `meta.methodology declares ${declared.join(', ')} — carried as metadata, NOT compiled: a devgraph expresses method by drawing it (the tdd block, a gate node), and the 12 flags are the epoch compiler's surface`,
    );
  }

  // --- topological emission order -------------------------------------------
  const order = topoOrder(graph).order;
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  const emittedNodes: GraphNode[] = [];
  for (const id of order) {
    const node = byId.get(id);
    if (!node || isPromptNode(node)) continue;
    emittedNodes.push(node);
  }

  const namesByNode = new Map<string, string[]>();
  emittedNodes.forEach((node, index) => {
    namesByNode.set(node.id, stepNamesOf(node, index + 1));
  });

  const producers = new Set<string>();
  for (const node of emittedNodes) {
    if (!isActionNode(node)) continue;
    if (findBlock(node.block)?.produces === true) producers.add(node.id);
  }

  const ctx: Ctx = {
    graph,
    goal,
    graphRoot,
    fanOutNamespace: fanOutNamespace(opts.sessionId, graphRoot),
    namesByNode,
    promptNodeId: promptNode?.id,
    modelId:
      (typeof graph.meta?.modelId === 'string' ? graph.meta.modelId.trim() : '') ||
      (typeof opts.modelId === 'string' ? opts.modelId.trim() : '') ||
      undefined,
    warn,
  };

  // --- steps -----------------------------------------------------------------
  const steps: PipelineStep[] = [];
  const stepsByNode: Record<string, string[]> = {};
  for (const node of emittedNodes) {
    let emitted: PipelineStep[];
    if (isActionNode(node)) emitted = [buildActionStep(node, ctx, producers)];
    else if (isResearchNode(node)) emitted = buildResearchSteps(node, ctx);
    else if (isGateNode(node)) emitted = [buildGateStep(node, ctx)];
    else {
      // Unreachable: `prompt` was filtered out and the union is closed.
      throw new Error(`devgraph compiler bug: node "${node.id}" has an unknown kind`);
    }
    steps.push(...emitted);
    stepsByNode[node.id] = emitted.map((step) => step.name);
  }

  if (steps.length === 0) {
    throw new Error(
      `devgraph "${graph.id}" compiles to zero steps — a method with only an objective has nothing to run`,
    );
  }

  // The router prefix rides every AGENT prompt, exactly as dev mode does it.
  // CheckStep conditions are left alone: a judge that stops to read the project
  // router before transcribing one field is a judge paying for nothing.
  if (opts.routerPrefix) {
    for (const step of steps) {
      if ('prompt' in step && typeof step.prompt === 'string') {
        (step as WorkStep).prompt = prefixPrompt(step.prompt, opts.routerPrefix);
      }
    }
  }

  // --- pipeline envelope -----------------------------------------------------
  const name =
    (typeof graph.name === 'string' ? graph.name.trim() : '') || `huu Devgraph — ${graph.id}`;
  const rawDescription =
    (typeof graph.description === 'string' ? graph.description.replace(/\s+/g, ' ').trim() : '') ||
    rawGoal.replace(/\s+/g, ' ').trim();

  const pipeline: Pipeline = {
    name,
    ...(rawDescription ? { description: rawDescription.slice(0, MAX_DESCRIPTION) } : {}),
    steps,
    maxNodeExecutions: resolveMaxNodeExecutions(graph, steps, stepsByNode, warn),
    ...(isPositiveInt(opts.cardTimeoutMs) ? { cardTimeoutMs: opts.cardTimeoutMs } : {}),
    ...(isPositiveInt(opts.singleFileCardTimeoutMs)
      ? { singleFileCardTimeoutMs: opts.singleFileCardTimeoutMs }
      : {}),
  };
  if (opts.cardTimeoutMs !== undefined && !isPositiveInt(opts.cardTimeoutMs)) {
    warn(`cardTimeoutMs ${opts.cardTimeoutMs} is not a positive integer — dropped`);
  }
  if (opts.singleFileCardTimeoutMs !== undefined && !isPositiveInt(opts.singleFileCardTimeoutMs)) {
    warn(`singleFileCardTimeoutMs ${opts.singleFileCardTimeoutMs} is not a positive integer — dropped`);
  }

  // --- output gate -----------------------------------------------------------
  // The exact schema + topology a run performs at load time: unique names,
  // backwards-only `dependsOn`, exactly one `default: true` per check, a
  // `memory` step that is neither first nor without `filesFrom`, one producer
  // per `produces` path. A failure here is a COMPILER BUG, not a bad drawing —
  // the drawing was already accepted by the entry gate.
  const parsed = PipelineSchema.safeParse(pipeline);
  if (!parsed.success) {
    throw new Error(
      `devgraph "${graph.id}" compiled to an invalid pipeline (this is a huu bug): ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  return {
    pipeline,
    nodeOrder: emittedNodes.map((node) => node.id),
    stepsByNode,
    warnings,
  };
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * How many times each node may run because a rework loop encloses it.
 *
 * The body of one loop is `descendants(target) ∩ (ancestors(gate) ∪ {target})`
 * in the DEPENDENCY layer — everything the gate's arm sends back through. Each
 * node in it may run once per gate VISIT, so it carries the gate's `maxRuns` as
 * a multiplier; nested loops multiply, which is an upper bound and is meant to
 * be (the result is clamped, and a budget that is too tight cuts a legitimate
 * loop mid-run while a budget that is too loose costs nothing until something
 * actually spins).
 *
 * The gate itself is excluded: its own `maxRuns` already counts its visits, and
 * multiplying that by itself would square a number nobody meant.
 */
function reworkLoopFactors(
  graph: DevGraph,
  visitsOfNode: (nodeId: string) => number,
): Map<string, number> {
  const factors = new Map<string, number>();
  for (const node of nodesOf(graph)) {
    const arms = outboundEdges(graph, node.id).filter(isReworkEdge);
    if (arms.length === 0) continue;
    const visits = visitsOfNode(node.id);
    if (visits <= 1) continue;
    const upstream = ancestorsOf(graph, node.id);
    for (const arm of arms) {
      const body = new Set<string>([arm.target, ...descendantsOf(graph, arm.target)]);
      for (const id of body) {
        if (id === node.id) continue;
        if (!upstream.has(id)) continue;
        factors.set(id, (factors.get(id) ?? 1) * visits);
      }
    }
  }
  return factors;
}

/**
 * The run's last-resort loop cap.
 *
 * The DEPENDENCY layer of a devgraph is acyclic, so the ceiling is computable:
 * every work step runs once, every check may be visited up to its own
 * `maxRuns`, and every step inside a rework loop may repeat once per visit of
 * the gate that sends it back ({@link reworkLoopFactors}). The default is that
 * number or {@link DEFAULT_MAX_NODE_EXECUTIONS}, whichever is larger — a
 * 40-node graph would otherwise be cut off mid-run by a constant that was sized
 * for a 4-front epoch, and a drawn loop would be cut off by the very backstop
 * that exists for loops nobody drew.
 */
function resolveMaxNodeExecutions(
  graph: DevGraph,
  steps: readonly PipelineStep[],
  stepsByNode: Record<string, string[]>,
  warn: (message: string) => void,
): number {
  const declared = graph.meta?.maxNodeExecutions;
  if (typeof declared === 'number' && Number.isFinite(declared)) {
    const capped = clamp(Math.trunc(declared), 1, MAX_NODE_EXECUTIONS_CAP);
    if (capped !== declared) {
      warn(`meta.maxNodeExecutions ${declared} clamped to ${capped}`);
    }
    return capped;
  }

  const stepByName = new Map(steps.map((step) => [step.name, step]));
  const nodeByStep = new Map<string, string>();
  for (const [nodeId, names] of Object.entries(stepsByNode)) {
    for (const name of names) nodeByStep.set(name, nodeId);
  }
  const visitsOf = (nodeId: string): number => {
    for (const name of stepsByNode[nodeId] ?? []) {
      const step = stepByName.get(name);
      if (step?.type === 'check') return step.maxRuns ?? DEVGRAPH_CHECK_MAX_RUNS;
    }
    return 1;
  };
  const factors = reworkLoopFactors(graph, visitsOf);

  let budget = 0;
  for (const step of steps) {
    const runs = step.type === 'check' ? (step.maxRuns ?? DEVGRAPH_CHECK_MAX_RUNS) : 1;
    const nodeId = nodeByStep.get(step.name);
    budget += runs * (nodeId === undefined ? 1 : (factors.get(nodeId) ?? 1));
  }
  return clamp(Math.max(DEFAULT_MAX_NODE_EXECUTIONS, budget), 1, MAX_NODE_EXECUTIONS_CAP);
}
