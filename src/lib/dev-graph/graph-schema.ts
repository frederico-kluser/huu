// The persisted shape of a hand-drawn method — zod for `huu-devgraph-v1`.
//
// DIVISION OF LABOUR, and it is deliberate:
//
//   this file  → SHAPE. Is it an object? Is `kind` one of the four? Is
//                `position.x` a number? Plus denial-of-service ceilings on
//                array and string sizes, so a hostile file cannot exhaust the
//                editor before anyone looks at it.
//   validator  → PRODUCT RULES. Every LIMIT the human is meant to feel
//                (40 nodes, 80-char labels, 4000-char goals) and every
//                referential rule (does this edge point at a real node? does
//                this branch have a default?) lives in `graph-validate.ts`.
//
// The reason for the split is what the user SEES. A graph that breaks a product
// rule must still OPEN, with the problem shown on the canvas as an issue the
// human can fix. If the schema enforced the same limits, a 41-node graph would
// fail to parse and the editor would have nothing to render — a parse error is
// a dead end, an issue is a to-do. So the schema's ceilings sit an order of
// magnitude above the product caps, and every cap has exactly ONE owner.
//
// The same rule sorts the id fields: a DECLARATION is strict here (the graph
// id, a choice id, an outcome id — get it wrong and the file is malformed),
// while a REFERENCE is permissive here and checked by the validator (a node id,
// an edge's source/target, `fanOutFrom`, `defaultOutcome`, `join.subset.of`) —
// those are the fields a human breaks by deleting a node, and "your edge points
// at a node that no longer exists" is worth saying in words.
//
// Keep this file pure (no fs / no env / no clock inside a pure function). The
// single tolerated impurity is `emptyDevGraph`'s default timestamp, documented
// at its call site.

import { z } from 'zod';
import {
  DEVGRAPH_SLUG_PATTERN,
  type DevGraph,
  type GraphNode,
  type GraphNodeKind,
} from './graph-types.js';

/** The `_format` tag every persisted devgraph carries. */
export const DEVGRAPH_FORMAT_TAG = 'huu-devgraph-v1';

/**
 * The placeholder goal a brand-new graph opens with. Non-empty on purpose: the
 * schema requires at least one character, so a graph created and immediately
 * saved must still round-trip. The human overwrites it as their first act.
 */
export const DEVGRAPH_DEFAULT_GOAL = 'Descreva aqui o objetivo deste trabalho.';

/** Label of the root node created by {@link emptyDevGraph}. */
export const DEVGRAPH_PROMPT_LABEL = 'Entrada do prompt';

// --- Parse ceilings (NOT product caps — see the header) ---------------------

const PARSE_MAX_TEXT = 20_000;
const PARSE_MAX_LABEL = 500;
const PARSE_MAX_NAME = 200;
const PARSE_MAX_ID = 64;
const PARSE_MAX_NODES = 500;
const PARSE_MAX_EDGES = 1000;
const PARSE_MAX_LIST = 1000;

// --- Leaf schemas -----------------------------------------------------------

/** A strict slug. Used only where the id is DECLARED, never where it is used. */
const SlugSchema = z
  .string()
  .regex(DEVGRAPH_SLUG_PATTERN, 'must be a slug: a-z, 0-9 and dashes, 1-40 chars');

/** A reference to something named elsewhere. The validator resolves it. */
const RefSchema = z.string().min(1).max(PARSE_MAX_ID);

const PositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const JoinPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('subset'), of: z.array(RefSchema).max(PARSE_MAX_LIST) }),
]);

/**
 * `all` is the default because it is the SAFE reading of a drawing: an edge a
 * human drew is a dependency until they say otherwise. A factory, not a shared
 * object — zod hands the same reference to every node when the default is a
 * value, and a mutable object shared across nodes is a bug waiting for an
 * editor that edits in place.
 */
const joinField = JoinPolicySchema.default(() => ({ mode: 'all' as const }));

const nodeBase = {
  id: RefSchema,
  label: z.string().min(1).max(PARSE_MAX_LABEL),
  position: PositionSchema,
  notes: z.string().max(PARSE_MAX_TEXT).optional(),
};

const PromptNodeSchema = z.object({
  ...nodeBase,
  kind: z.literal('prompt'),
  goal: z.string().min(1).max(PARSE_MAX_TEXT),
});

const ActionNodeSchema = z.object({
  ...nodeBase,
  kind: z.literal('action'),
  block: RefSchema,
  prompt: z.string().max(PARSE_MAX_TEXT).optional(),
  scope: z.enum(['project', 'per-file', 'memory', 'flexible']).optional(),
  files: z.array(z.string().min(1).max(400)).max(PARSE_MAX_LIST).optional(),
  fanOutFrom: RefSchema.optional(),
  maxFiles: z.number().int().min(1).max(500).optional(),
  modelId: z.string().min(1).max(PARSE_MAX_NAME).optional(),
  review: z.boolean().optional(),
  join: joinField,
});

const ResearchChoiceSchema = z.object({
  id: SlugSchema,
  label: z.string().min(1).max(PARSE_MAX_LABEL),
});

const ResearchNodeSchema = z.object({
  ...nodeBase,
  kind: z.literal('research'),
  query: z.string().min(1).max(PARSE_MAX_TEXT),
  useContext: z.boolean(),
  outputKind: z.enum(['boolean', 'choice', 'info']),
  choices: z.array(ResearchChoiceSchema).max(PARSE_MAX_LIST).optional(),
  defaultOutcome: RefSchema.optional(),
  modelId: z.string().min(1).max(PARSE_MAX_NAME).optional(),
  join: joinField,
});

const GateOutcomeSchema = z.object({
  id: SlugSchema,
  label: z.string().min(1).max(PARSE_MAX_LABEL),
});

const GateNodeSchema = z.object({
  ...nodeBase,
  kind: z.literal('gate'),
  condition: z.string().min(1).max(PARSE_MAX_TEXT),
  outcomes: z.array(GateOutcomeSchema).max(PARSE_MAX_LIST),
  defaultOutcome: RefSchema,
  maxRuns: z.number().int().min(1).max(50).optional(),
  modelId: z.string().min(1).max(PARSE_MAX_NAME).optional(),
  join: joinField,
});

export const GraphNodeSchema = z.discriminatedUnion('kind', [
  PromptNodeSchema,
  ActionNodeSchema,
  ResearchNodeSchema,
  GateNodeSchema,
]);

export const GraphEdgeSchema = z.object({
  id: RefSchema,
  source: RefSchema,
  target: RefSchema,
  sourceOutcome: RefSchema.optional(),
  /**
   * `z.literal(true)`, not `z.boolean()`, and that follows the id rule at the
   * top of this file: `rework` is a DECLARATION, not a reference. A `false`
   * here is not a graph with a disabled loop — it is a writer who thinks the
   * field has two states. Failing the parse says so once; accepting it would
   * leave every reader downstream deciding what `false` meant.
   */
  rework: z.literal(true).optional(),
});

const DevGraphMetaSchema = z.object({
  /**
   * Keys are `keyof DevMethodology`, but they stay `string` here: narrowing
   * them would import the dev-mode types into a payload the browser reads, and
   * the compiler is where a bad key must fail anyway.
   */
  methodology: z.record(z.literal(true)).optional(),
  maxNodeExecutions: z.number().int().min(1).max(500).optional(),
  modelId: z.string().min(1).max(PARSE_MAX_NAME).optional(),
});

export const DevGraphSchema = z.object({
  _format: z.literal(DEVGRAPH_FORMAT_TAG),
  id: SlugSchema,
  name: z.string().min(1).max(PARSE_MAX_NAME),
  description: z.string().max(PARSE_MAX_TEXT).optional(),
  /**
   * ISO-8601 in practice, checked as a non-empty string on purpose: rejecting
   * a graph because its timestamp lost its milliseconds would destroy the
   * human's METHOD over a field nothing routes on.
   */
  createdAt: z.string().min(1).max(PARSE_MAX_ID),
  updatedAt: z.string().min(1).max(PARSE_MAX_ID),
  meta: DevGraphMetaSchema.default(() => ({})),
  nodes: z.array(GraphNodeSchema).max(PARSE_MAX_NODES),
  edges: z.array(GraphEdgeSchema).max(PARSE_MAX_EDGES),
});

// --- Parse / serialize ------------------------------------------------------

/** Outcome of {@link parseDevGraph}. Never a throw — malformed input is data. */
export type ParseDevGraphResult =
  | { ok: true; graph: DevGraph }
  | { ok: false; errors: string[] };

/**
 * Read an unknown value as a devgraph.
 *
 * A SHAPE failure only. A graph that parses may still be a nonsense method —
 * run `validateGraph` for that. The two are separate because they answer to
 * different people: this one answers "is this file a devgraph at all", the
 * other answers "is this method sound".
 */
export function parseDevGraph(json: unknown): ParseDevGraphResult {
  const parsed = DevGraphSchema.safeParse(json);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    });
    return { ok: false, errors };
  }
  return { ok: true, graph: parsed.data };
}

/** Drop `undefined` values while preserving insertion order. */
function compact(entries: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function orderedJoin(node: GraphNode): Record<string, unknown> | undefined {
  if (node.kind === 'prompt') return undefined;
  return node.join.mode === 'subset'
    ? { mode: node.join.mode, of: [...node.join.of] }
    : { mode: node.join.mode };
}

function orderedNode(node: GraphNode): Record<string, unknown> {
  const head = {
    id: node.id,
    kind: node.kind,
    label: node.label,
    position: { x: node.position.x, y: node.position.y },
    notes: node.notes,
  };
  switch (node.kind) {
    case 'prompt':
      return compact({ ...head, goal: node.goal });
    case 'action':
      return compact({
        ...head,
        block: node.block,
        prompt: node.prompt,
        scope: node.scope,
        files: node.files ? [...node.files] : undefined,
        fanOutFrom: node.fanOutFrom,
        maxFiles: node.maxFiles,
        modelId: node.modelId,
        review: node.review,
        join: orderedJoin(node),
      });
    case 'research':
      return compact({
        ...head,
        query: node.query,
        useContext: node.useContext,
        outputKind: node.outputKind,
        choices: node.choices?.map((choice) => ({ id: choice.id, label: choice.label })),
        defaultOutcome: node.defaultOutcome,
        modelId: node.modelId,
        join: orderedJoin(node),
      });
    case 'gate':
      return compact({
        ...head,
        condition: node.condition,
        outcomes: node.outcomes.map((outcome) => ({ id: outcome.id, label: outcome.label })),
        defaultOutcome: node.defaultOutcome,
        maxRuns: node.maxRuns,
        modelId: node.modelId,
        join: orderedJoin(node),
      });
  }
}

/**
 * A devgraph as JSON: 2-space indent, DECLARED key order, no trailing newline
 * (matching `pipeline-io.ts`).
 *
 * Deterministic on purpose. This file is versioned next to the code it
 * describes, so a save that only reorders keys would produce a diff that says
 * the method changed when it did not — and the whole promise of the format is
 * that a method you can read in a diff is a method you can review. `JSON.
 * stringify` follows insertion order, so the ordering here IS the file layout;
 * the one place with no natural order (`meta.methodology`, a record) is sorted
 * by key.
 */
export function serializeDevGraph(graph: DevGraph): string {
  const methodology = graph.meta.methodology;
  const orderedMethodology = methodology
    ? Object.fromEntries(
        Object.keys(methodology)
          .sort()
          .map((key) => [key, true as const]),
      )
    : undefined;

  const payload = compact({
    _format: DEVGRAPH_FORMAT_TAG,
    id: graph.id,
    name: graph.name,
    description: graph.description,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    meta: compact({
      methodology: orderedMethodology,
      maxNodeExecutions: graph.meta.maxNodeExecutions,
      modelId: graph.meta.modelId,
    }),
    nodes: graph.nodes.map(orderedNode),
    edges: graph.edges.map((edge) =>
      compact({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceOutcome: edge.sourceOutcome,
        // `compact` drops it when absent, so an ordinary edge serializes to
        // exactly the same three keys it always did — a graph drawn before
        // this field existed still round-trips byte-identically.
        rework: edge.rework,
      }),
    ),
  });

  return JSON.stringify(payload, null, 2);
}

// --- Construction helpers ---------------------------------------------------

/** Smallest `<prefix>-<n>` (n >= 1) that is not already taken. Deterministic. */
function nextSequentialId(taken: ReadonlySet<string>, prefix: string): string {
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * A fresh graph containing ONLY the root prompt node.
 *
 * That is the whole starting position on purpose: the human writes the
 * objective first and then draws the method that serves it. Nothing is
 * pre-drawn, because a suggested topology is a topology somebody else
 * underwrote.
 *
 * `now` is the ONE tolerated impurity in this module: omitted, it falls back to
 * `new Date().toISOString()`. Pass it explicitly from tests and from any caller
 * that needs a reproducible file.
 *
 * THROWS on an `id` that is not a slug, and that is deliberate — the one place
 * in this stack where throwing is the right answer. `validateGraph` never
 * throws because it runs on half-drawn HUMAN input; this function runs on an id
 * a CALLER chose, and returning a graph its own schema would refuse to parse
 * would hand that caller a file it can never save. Slugifying silently was the
 * alternative and it is worse: it renames the human's method behind their back
 * and can collide two graphs onto one id. Callers that start from free text
 * must slugify BEFORE calling, so the human sees the id they will live with.
 */
export function emptyDevGraph(id: string, name: string, now?: string): DevGraph {
  if (!DEVGRAPH_SLUG_PATTERN.test(id)) {
    throw new TypeError(
      `emptyDevGraph: "${id}" is not a valid graph id - must be a slug: a-z, 0-9 and dashes, 1-40 chars`,
    );
  }
  const timestamp = now ?? new Date().toISOString();
  return {
    _format: DEVGRAPH_FORMAT_TAG,
    id,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    meta: {},
    nodes: [
      {
        id: nextSequentialId(new Set<string>(), 'prompt'),
        kind: 'prompt',
        label: DEVGRAPH_PROMPT_LABEL,
        position: { x: 0, y: 0 },
        goal: DEVGRAPH_DEFAULT_GOAL,
      },
    ],
    edges: [],
  };
}

/**
 * An unused node id for a new node of `kind` — `action-1`, `action-2`, …
 *
 * Kind-prefixed rather than random: node ids reach the compiled pipeline's step
 * names, and a step called `action-3` is something a human can find in a run
 * log. A uuid is not.
 */
export function newNodeId(graph: DevGraph, kind: GraphNodeKind): string {
  return nextSequentialId(new Set(graph.nodes.map((node) => node.id)), kind);
}

/** An unused edge id — `e-1`, `e-2`, … */
export function newEdgeId(graph: DevGraph): string {
  return nextSequentialId(new Set(graph.edges.map((edge) => edge.id)), 'e');
}
