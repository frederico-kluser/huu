/**
 * HTTP surface of the hand-drawn method — `huu-devgraph-v1` over `/api/graphs`.
 *
 * WHY THE LOGIC LIVES HERE AND NOT IN `server.ts`: the server is one 1100-line
 * `handleRequest` whose every branch needs a live socket to exercise. The eight
 * routes below are pure functions of (method, path, query, body) → `{status,
 * body}`, so the whole status map — every store prefix, every hostile id, the
 * compiler that throws by contract — is testable WITHOUT binding a port.
 * `server.ts` keeps exactly two jobs: recognizing the namespace and parsing the
 * request body. `graph-api.test.ts` covers this module, `server.test.ts` covers
 * the wiring; neither is a substitute for the other.
 *
 * FAILURE IS DATA, ALL THE WAY UP. `src/lib/dev-graph/graph-store.ts` returns
 * outcome objects whose `reason` opens with a STABLE prefix; this module's only
 * opinion about them is {@link statusForReason}, which is a table, not a chain
 * of `if`s. The two functions in the stack that DO throw are contained here:
 * `graphPath`/`emptyDevGraph` throw on a non-slug id (so every id is checked
 * against {@link DEVGRAPH_SLUG_PATTERN} before a path is built) and
 * `compileGraphPipeline` throws on an invalid graph (so `/compile` validates
 * first AND still wraps the call — see {@link compileGraphResult}).
 *
 * Layering: `src/web/` imports from `lib/`, never the other way round.
 */

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { DEV_MODE_DIR } from '../lib/types/dev-mode.js';
import { GRAPH_SAMPLES, findSample } from '../lib/dev-graph/graph-samples.js';
import { parseDevGraph } from '../lib/dev-graph/graph-schema.js';
import {
  deleteGraph,
  graphPath,
  listGraphs,
  readGraph,
  writeGraph,
} from '../lib/dev-graph/graph-store.js';
import { DEVGRAPH_SLUG_PATTERN, type DevGraph } from '../lib/dev-graph/graph-types.js';
import { validateGraph } from '../lib/dev-graph/graph-validate.js';
import { compileGraphPipeline } from '../lib/dev-graph/graph-to-pipeline.js';
import {
  ACTION_BLOCKS,
  NODE_KINDS,
  methodologyOptions,
  type NodeKindInfo,
} from '../lib/dev-graph/node-catalog.js';

/** Everything a handler returns: an HTTP status and a JSON body. Nothing else. */
export interface GraphApiResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * One row of `errors` / `warnings` on the wire.
 *
 * `code` widens to `string` because THIS layer contributes one code the graph
 * validator cannot: `invalid-schema`, for a payload that is not a devgraph at
 * all. Narrowing it to `GraphIssueCode` would force a cast at every emit site
 * and would say the enum owns a value it does not. Every OTHER row is a real
 * {@link import('../lib/dev-graph/graph-types.js').GraphIssue}, which is
 * structurally assignable to this shape — the anchors the canvas highlights by
 * (`nodeId` / `edgeId`) survive untouched.
 */
export interface GraphApiIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

/** The request, already reduced to data — no socket, no stream, no `IncomingMessage`. */
export interface GraphApiRequest {
  /** The server's own working directory: the default repository. */
  cwd: string;
  method: string;
  /** `url.pathname`, never the query string. */
  path: string;
  query: URLSearchParams;
  /** Parsed JSON body (`{}` for GET/DELETE). `server.ts` owns the parse. */
  body: Record<string, unknown>;
}

/** The namespace this module owns, in full. */
const GRAPHS_PREFIX = '/api/graphs';

/**
 * Sub-paths that are ROUTES, not graph ids.
 *
 * Every one of them is also a legal slug, so `/api/graphs/catalog` is ambiguous
 * by construction. The route wins — which means a graph called `catalog` would
 * be saved and then be unaddressable. Rather than let that happen quietly, the
 * write paths REFUSE these four ids (400), so the ambiguity is reported at the
 * moment it is created instead of discovered on the next click.
 */
export const GRAPH_RESERVED_SEGMENTS: readonly string[] = [
  'catalog',
  'compile',
  'validate',
  'from-sample',
];

/**
 * Store `reason` prefix → HTTP status.
 *
 * A TABLE, deliberately: the prefixes are the store's published contract
 * (`graph-store.ts`, `const REASON`), so mapping them anywhere else — or
 * re-deriving them from the prose after the colon — is how a 404 quietly
 * becomes a 500 the day a message is reworded.
 */
const STATUS_BY_REASON: Record<string, number> = {
  'invalid-id': 400,
  'invalid-json': 400,
  'invalid-schema': 400,
  'id-mismatch': 400,
  'not-found': 404,
  'read-failed': 500,
  'write-failed': 500,
  'delete-failed': 500,
};

/**
 * The status for one store refusal.
 *
 * An UNKNOWN prefix is a 500 on purpose. A prefix this table does not carry is
 * a store that grew an outcome nobody taught the HTTP layer about — that is a
 * server-side gap, and answering 400 would blame the caller for it.
 */
export function statusForReason(reason: string): number {
  const colon = reason.indexOf(':');
  const prefix = colon === -1 ? reason.trim() : reason.slice(0, colon).trim();
  return STATUS_BY_REASON[prefix] ?? 500;
}

/**
 * The repository a request addresses.
 *
 * The SAME policy `dev-manager.ts` applies to `runDirectory`
 * (`params.runDirectory ? resolvePath(params.runDirectory) : this.cwd`), plus
 * `run-manager.ts`'s trim. Deliberately not a second path policy: a graph saved
 * through `/api/graphs` and a run started through `/api/dev` must land in the
 * same directory for the same `dir` string, or the editor and the runner would
 * disagree about where the method lives.
 */
export function resolveGraphDir(cwd: string, dir: unknown): string {
  const raw = typeof dir === 'string' ? dir.trim() : '';
  return raw.length > 0 ? resolvePath(raw) : cwd;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `{ error }` — the shape every other error in `server.ts` already uses. */
function fail(status: number, error: string): GraphApiResult {
  return { status, body: { error } };
}

/**
 * Refuse an id BEFORE it becomes a path segment (or a file the routes cannot
 * reach afterwards). Returns the refusal, or `null` when the id is usable.
 */
function refuseId(id: string): GraphApiResult | null {
  if (!DEVGRAPH_SLUG_PATTERN.test(id)) {
    return fail(
      400,
      `invalid-id: "${id}" is not a slug (a-z, 0-9, dashes, 1-40) - refused before touching the filesystem`,
    );
  }
  if (GRAPH_RESERVED_SEGMENTS.includes(id)) {
    return fail(
      400,
      `invalid-id: "${id}" is reserved by the /api/graphs routes (${GRAPH_RESERVED_SEGMENTS.join(', ')}) - a graph with this id could be saved but never read back`,
    );
  }
  return null;
}

// ─────────────────────────────── catalog ────────────────────────────────────

/**
 * The palette-sized view of one action block.
 *
 * `promptTemplate` and `judgeClause` are DROPPED: they are agent-facing English
 * measured in kilobytes, and `/api/bootstrap` is fetched on every page load and
 * on every SSE resync. The full block — template included — is one call away at
 * `GET /api/graphs/catalog`, which the node editor fetches once when it opens.
 * Same division `DEV_METHODOLOGY_OPTIONS` already makes for the /dev form: only
 * the browser-facing columns cross the wire.
 */
export interface GraphBlockOption {
  id: string;
  label: string;
  description: string;
  defaultScope: 'project' | 'per-file' | 'memory';
  produces: boolean;
  readOnly: boolean;
  review: boolean;
}

/** One library entry, without the `build()` closure (which cannot be JSON). */
export interface GraphSampleOption {
  id: string;
  name: string;
  description: string;
}

/**
 * The blocks, projected for the palette. PROJECTED, never re-declared —
 * {@link ACTION_BLOCKS} is the single declaration surface and a hand-written
 * second list is the drift bug this function exists to prevent.
 */
export function graphBlockOptions(): GraphBlockOption[] {
  return ACTION_BLOCKS.map(
    ({ id, label, description, defaultScope, produces, readOnly, review }) => ({
      id,
      label,
      description,
      defaultScope,
      produces,
      readOnly,
      review,
    }),
  );
}

/**
 * The four node kinds. {@link NODE_KINDS} already carries only browser-facing
 * columns, so this is a copy, not a narrowing — it exists so `server.ts` has
 * ONE import surface for the whole graph payload.
 */
export function graphNodeKindOptions(): NodeKindInfo[] {
  return NODE_KINDS.map(({ kind, label, description }) => ({ kind, label, description }));
}

/** The samples, without their builders — id, name and the honest description. */
export function graphSampleOptions(): GraphSampleOption[] {
  return GRAPH_SAMPLES.map(({ id, name, description }) => ({ id, name, description }));
}

/**
 * `GET /api/graphs/catalog` — everything the editor needs to draw, in one call.
 *
 * `blocks` here are the FULL blocks (prompt template and judge clause
 * included): the node editor shows the template a node will actually run, and
 * hiding it would leave the human overriding a prompt they cannot read.
 */
export function graphCatalogResult(): GraphApiResult {
  return {
    status: 200,
    body: {
      blocks: ACTION_BLOCKS,
      kinds: NODE_KINDS,
      methodologies: methodologyOptions(),
      samples: graphSampleOptions(),
    },
  };
}

// ──────────────────────────────── CRUD ──────────────────────────────────────

/** `GET /api/graphs?dir=` — never fails; an unreadable directory lists as `[]`. */
export function listGraphsResult(cwd: string, dir: unknown): GraphApiResult {
  return { status: 200, body: { graphs: listGraphs(resolveGraphDir(cwd, dir)) } };
}

/** `GET /api/graphs/:id?dir=` */
export function readGraphResult(cwd: string, dir: unknown, id: string): GraphApiResult {
  const refused = refuseId(id);
  if (refused) return refused;
  const result = readGraph(resolveGraphDir(cwd, dir), id);
  if (!result.ok) return fail(statusForReason(result.reason), result.reason);
  return { status: 200, body: { graph: result.graph } };
}

/**
 * `PUT /api/graphs/:id` with `{ dir?, graph }`.
 *
 * THE PATH IS THE AUTHORITY. A body whose graph carries a different id is a 400
 * (`id-mismatch:`), never a silent rewrite of either side: the store names the
 * file after `graph.id`, so honoring the body would write a graph the URL that
 * created it cannot read, and honoring the URL would rename the human's method
 * behind their back. The same disagreement `readGraph` refuses on the way out.
 */
export function writeGraphResult(
  cwd: string,
  id: string,
  body: Record<string, unknown>,
): GraphApiResult {
  const refused = refuseId(id);
  if (refused) return refused;

  const raw = body.graph;
  if (!isRecord(raw)) {
    return fail(400, 'invalid-schema: the request carries no "graph" object');
  }
  if (typeof raw.id !== 'string' || raw.id !== id) {
    return fail(
      400,
      `id-mismatch: PUT /api/graphs/${id} carries a graph whose id is "${String(raw.id)}"`,
    );
  }

  const result = writeGraph(resolveGraphDir(cwd, body.dir), raw as unknown as DevGraph);
  if (!result.ok) return fail(statusForReason(result.reason), result.reason);
  return { status: 200, body: { ok: true, graph: result.graph } };
}

/** `DELETE /api/graphs/:id?dir=` — a missing graph is a 404, not a silent 200. */
export function deleteGraphResult(cwd: string, dir: unknown, id: string): GraphApiResult {
  const refused = refuseId(id);
  if (refused) return refused;
  const result = deleteGraph(resolveGraphDir(cwd, dir), id);
  if (!result.ok) {
    const reason = result.reason ?? 'delete-failed: the store refused without a reason';
    return fail(statusForReason(reason), reason);
  }
  return { status: 200, body: { ok: true } };
}

// ────────────────────────────── validate ────────────────────────────────────

/**
 * `POST /api/graphs/validate` with `{ graph }` → ALWAYS 200.
 *
 * A half-drawn method is the NORMAL input here — the editor calls this on every
 * change — so "this graph is wrong" is an answer, not a transport failure. The
 * only 4xx this route can produce is the token gate.
 *
 * TWO LAYERS, ONE ANSWER. `validateGraph` runs first and unedited because its
 * codes are ANCHORED (`nodeId`/`edgeId`) and the canvas highlights by code: an
 * unslugged node id must come back as `invalid-node-id` on that node, not as a
 * schema sentence with nowhere to point. `parseDevGraph` is then consulted only
 * to close the hole the anchored pass cannot see — a graph the SHAPE refuses
 * (`_format` wrong, `createdAt` missing, an unknown `kind`) but the structural
 * rules are happy with. Reporting `ok: true` for a graph the store would refuse
 * to save is the one outcome this route may never produce.
 */
export function validateGraphResult(body: Record<string, unknown>): GraphApiResult {
  const schemaIssue = (message: string): GraphApiIssue => ({ code: 'invalid-schema', message });

  const raw = body.graph;
  if (!isRecord(raw)) {
    return {
      status: 200,
      body: {
        ok: false,
        errors: [schemaIssue('the request carries no "graph" object')],
        warnings: [],
      },
    };
  }

  const result = validateGraph(raw as unknown as DevGraph);
  if (result.errors.length > 0) {
    return {
      status: 200,
      body: { ok: false, errors: result.errors, warnings: result.warnings },
    };
  }

  const parsed = parseDevGraph(raw);
  if (!parsed.ok) {
    return {
      status: 200,
      body: {
        ok: false,
        errors: [schemaIssue(parsed.errors.join('; '))],
        warnings: result.warnings,
      },
    };
  }

  return { status: 200, body: { ok: true, errors: [], warnings: result.warnings } };
}

// ────────────────────────────── compile ─────────────────────────────────────

/**
 * The blackboard root a preview compile writes against when the caller names
 * none — the shape `graph-to-pipeline.ts` documents (`.huu/dev/<sessionId>/
 * graph`), with the graph's own id standing in for the session.
 *
 * A preview compiles a pipeline and writes NOTHING, so this value only has to
 * be deterministic (the same graph must preview identically twice) and
 * namespaced (two graphs must not preview onto one path). `sanitizeGraphRoot`
 * inside the compiler drops `.`/`..` and every character outside
 * `[A-Za-z0-9._/-]`, so an arbitrary `sessionId` cannot climb out of the tree.
 */
function defaultGraphRoot(sessionId: string | undefined, graphId: string): string {
  const namespace = (sessionId ?? '').trim() || graphId;
  return `${DEV_MODE_DIR}/${namespace}/graph`;
}

/**
 * `POST /api/graphs/compile` with `{ graph, goal?, graphRoot?, sessionId? }`.
 *
 * `compileGraphPipeline` THROWS on an invalid graph — that is its documented
 * contract, not a defect — so this route validates first and reports the issues
 * as data. It then STILL wraps the call: the compiler also throws on a pipeline
 * it built wrong (its own output gate), and an uncaught throw here would reach
 * `server.ts`'s catch-all as a bare 500. A method that will not compile is the
 * caller's news to act on, so it is a 400 with the message attached, always.
 */
export function compileGraphResult(body: Record<string, unknown>): GraphApiResult {
  const raw = body.graph;
  if (!isRecord(raw)) {
    return { status: 400, body: { ok: false, error: 'invalid-schema: the request carries no "graph" object' } };
  }

  const parsed = parseDevGraph(raw);
  if (!parsed.ok) {
    return {
      status: 400,
      body: { ok: false, error: `invalid-schema: ${parsed.errors.join('; ')}` },
    };
  }
  const graph = parsed.graph;

  const validation = validateGraph(graph);
  if (!validation.ok) {
    const codes = validation.errors.map((issue) => issue.code).join(', ');
    return {
      status: 400,
      body: {
        ok: false,
        error: `the graph does not compile — ${validation.errors.length} blocking issue(s) [${codes}]`,
        // Additive, and the reason the client needs no second round-trip: the
        // canvas can highlight the very nodes that blocked the compile.
        errors: validation.errors,
        warnings: validation.warnings,
      },
    };
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  const goal = typeof body.goal === 'string' ? body.goal : undefined;
  const graphRoot =
    typeof body.graphRoot === 'string' && body.graphRoot.trim().length > 0
      ? body.graphRoot
      : defaultGraphRoot(sessionId, graph.id);

  try {
    const compiled = compileGraphPipeline({
      graph,
      graphRoot,
      ...(goal !== undefined ? { goal } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
    return {
      status: 200,
      body: {
        ok: true,
        pipeline: compiled.pipeline,
        nodeOrder: compiled.nodeOrder,
        stepsByNode: compiled.stepsByNode,
        warnings: compiled.warnings,
      },
    };
  } catch (err) {
    return { status: 400, body: { ok: false, error: errText(err) } };
  }
}

// ───────────────────────────── from-sample ──────────────────────────────────

/** Longest id the slug pattern accepts — `{0,39}` plus the leading character. */
const MAX_ID_LENGTH = 40;
/** How many `-2`, `-3`, … suffixes to try before giving up on a free id. */
const MAX_ID_ATTEMPTS = 99;

/**
 * `requested`, or the first free `requested-N` after it.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION. Dropping a sample onto an id that is already
 * taken would overwrite a method the human drew by hand, and a library button
 * that can silently destroy work is a library button nobody can click twice.
 * The suffix is what a file manager does, for the same reason.
 *
 * Returns `null` when nothing is free — the caller reports that instead of
 * picking a victim.
 */
function availableGraphId(root: string, requested: string): string | null {
  if (!existsSync(graphPath(root, requested))) return requested;
  for (let n = 2; n <= MAX_ID_ATTEMPTS; n += 1) {
    const suffix = `-${n}`;
    const base = requested.slice(0, MAX_ID_LENGTH - suffix.length);
    const candidate = `${base}${suffix}`;
    if (!DEVGRAPH_SLUG_PATTERN.test(candidate)) continue;
    if (!existsSync(graphPath(root, candidate))) return candidate;
  }
  return null;
}

/**
 * `POST /api/graphs/from-sample` with `{ dir?, sampleId, id?, name? }`.
 *
 * Builds one of the shipped samples and SAVES it, so the response is a graph
 * the editor can open by id on the very next request. The saved id may differ
 * from the requested one (see {@link availableGraphId}) — the response carries
 * the graph that actually reached the disk, so the client never has to guess.
 */
export function fromSampleResult(cwd: string, body: Record<string, unknown>): GraphApiResult {
  const sampleId = typeof body.sampleId === 'string' ? body.sampleId.trim() : '';
  const sample = findSample(sampleId);
  if (!sample) {
    return fail(
      400,
      `unknown sample "${sampleId}" - known samples: ${GRAPH_SAMPLES.map((s) => s.id).join(', ')}`,
    );
  }

  const requested =
    typeof body.id === 'string' && body.id.trim().length > 0 ? body.id.trim() : sample.id;
  const refused = refuseId(requested);
  if (refused) return refused;

  const root = resolveGraphDir(cwd, body.dir);
  const id = availableGraphId(root, requested);
  if (id === null) {
    return fail(
      409,
      `"${requested}" and every "${requested}-N" up to ${MAX_ID_ATTEMPTS} are taken - delete one or pass a different id`,
    );
  }

  const built = sample.build();
  const name =
    typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : built.name;
  const graph: DevGraph = { ...built, id, name };

  const result = writeGraph(root, graph);
  if (!result.ok) return fail(statusForReason(result.reason), result.reason);
  return { status: 200, body: { ok: true, graph: result.graph } };
}

// ─────────────────────────────── routing ────────────────────────────────────

/** True for every path this module owns — the ONE test `server.ts` performs. */
export function isGraphApiPath(path: string): boolean {
  return path === GRAPHS_PREFIX || path.startsWith(`${GRAPHS_PREFIX}/`);
}

/** True when the route exists but not for this verb. 405 tells them apart from 404. */
function methodNotAllowed(method: string, path: string, allowed: string): GraphApiResult {
  return fail(405, `${method} ${path} is not allowed - use ${allowed}`);
}

/**
 * The whole `/api/graphs` grammar, as a pure function.
 *
 * Reserved segments are matched BEFORE the `:id` route, which is what makes
 * `/api/graphs/catalog` a catalog and not a lookup for a graph named "catalog"
 * (see {@link GRAPH_RESERVED_SEGMENTS}). Nested paths are a 404: this namespace
 * is one level deep and pretending otherwise would let `/api/graphs/a/b` fall
 * through to the id route with a segment that can never be a slug.
 */
export function handleGraphRequest(req: GraphApiRequest): GraphApiResult {
  const { cwd, method, path, query, body } = req;

  if (!isGraphApiPath(path)) return fail(404, `not found: ${path}`);

  const rest = path === GRAPHS_PREFIX ? '' : path.slice(GRAPHS_PREFIX.length + 1);

  // The collection: `/api/graphs` and `/api/graphs/` are the same resource.
  if (rest === '') {
    if (method !== 'GET') return methodNotAllowed(method, path, 'GET');
    return listGraphsResult(cwd, query.get('dir'));
  }

  if (rest.includes('/')) return fail(404, `not found: ${path}`);

  let segment: string;
  try {
    segment = decodeURIComponent(rest);
  } catch {
    // A malformed percent-escape never reaches the store: it is a 400 about the
    // URL, not a 500 about the decoder.
    return fail(400, `invalid-id: "${rest}" is not a decodable path segment`);
  }

  switch (segment) {
    case 'catalog':
      if (method !== 'GET') return methodNotAllowed(method, path, 'GET');
      return graphCatalogResult();
    case 'validate':
      if (method !== 'POST') return methodNotAllowed(method, path, 'POST');
      return validateGraphResult(body);
    case 'compile':
      if (method !== 'POST') return methodNotAllowed(method, path, 'POST');
      return compileGraphResult(body);
    case 'from-sample':
      if (method !== 'POST') return methodNotAllowed(method, path, 'POST');
      return fromSampleResult(cwd, body);
    default:
      break;
  }

  switch (method) {
    case 'GET':
      return readGraphResult(cwd, query.get('dir'), segment);
    case 'PUT':
      return writeGraphResult(cwd, segment, body);
    case 'DELETE':
      return deleteGraphResult(cwd, query.get('dir'), segment);
    default:
      return methodNotAllowed(method, path, 'GET, PUT or DELETE');
  }
}
