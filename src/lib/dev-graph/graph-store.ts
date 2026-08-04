// Where a hand-drawn method LIVES — the on-disk CRUD of `huu-devgraph-v1`.
//
// WHERE, AND WHY NOT `pipelines/`: a devgraph is not a pipeline. It compiles
// INTO one (`graph-to-pipeline.ts`), and until it does it is a drawing that may
// legitimately be half finished. Dropping it next to `*.pipeline.json` would
// also hand it to the gate's `validate-graph` step, which parses everything it
// finds there as `huu-pipeline-v2` — a graph in that directory is a red CI run,
// not a saved draft. So graphs live in the dev blackboard, under
// `<repoRoot>/.huu/dev/graphs/<id>.json`, one file per graph, named by its own
// id (that is what makes {@link readGraph} a lookup instead of a scan).
//
// BE HONEST ABOUT ONE CONSEQUENCE: many repositories (this one included)
// `.gitignore` the whole `.huu/` tree, so a graph saved there is NOT versioned
// unless the user un-ignores it. Nothing in this module depends on git — the
// store reads and writes the working tree directly — but "my method vanished
// when I cloned elsewhere" is a real outcome, and it is the user's call to make,
// not a surprise this module should hide.
//
// WHAT THIS MODULE REFUSES TO DECIDE: whether the METHOD is any good. Saving is
// schema-checked, never rule-checked — a graph that fails `validateGraph` still
// saves, because the editor validates on every keystroke and a store that
// refused half-drawn work would make the canvas unusable. The listing carries
// `valid` so the UI can say so; that is the whole extent of the opinion here.
//
// FAILURE IS DATA. Every entry point returns an outcome object instead of
// throwing: this store is driven by an HTTP handler and a TUI screen, and a
// missing file, a truncated JSON or a read-only disk are all ordinary
// conditions there. The ONE exception is {@link graphPath}, documented at its
// own signature.

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DEV_MODE_DIR } from '../types/dev-mode.js';
import { parseDevGraph, serializeDevGraph } from './graph-schema.js';
import { DEVGRAPH_SLUG_PATTERN, type DevGraph } from './graph-types.js';
import { validateGraph } from './graph-validate.js';

/**
 * Repo-relative home of every saved graph. Derived from {@link DEV_MODE_DIR}
 * rather than spelled out, so the blackboard has ONE declaration surface — the
 * literal value (`.huu/dev/graphs`) is pinned by the colocated test.
 */
export const GRAPHS_DIR = `${DEV_MODE_DIR}/graphs`;

/** The only file extension this store reads or writes. */
const JSON_SUFFIX = '.json';

/** Absolute path of the graph directory inside `repoRoot`. */
export function graphsDir(repoRoot: string): string {
  return join(repoRoot, GRAPHS_DIR);
}

/**
 * Absolute path of one graph's file.
 *
 * THROWS a `TypeError` on an id that is not a slug, and that is the deliberate
 * exception to this module's failure-is-data rule. The id becomes a path
 * segment, so `../../etc/passwd` would resolve OUTSIDE {@link graphsDir} — a
 * function whose return type is `string` has no way to say "I refuse", and
 * handing back a traversal path would turn every caller into the vulnerability.
 * The public CRUD below checks the slug first and reports the refusal as data,
 * so no ordinary caller ever meets this throw.
 */
export function graphPath(repoRoot: string, id: string): string {
  if (!DEVGRAPH_SLUG_PATTERN.test(id)) {
    throw new TypeError(
      `graphPath: "${id}" is not a valid graph id - must be a slug: a-z, 0-9 and dashes, 1-40 chars`,
    );
  }
  return join(graphsDir(repoRoot), `${id}${JSON_SUFFIX}`);
}

/**
 * One row of the graph list — enough to render a picker without loading, and
 * WITHOUT deciding for the UI: `valid` reports whether `validateGraph` is happy,
 * it never hides the graph.
 */
export interface GraphSummary {
  id: string;
  name: string;
  description?: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
  valid: boolean;
}

export type ReadGraphResult = { ok: true; graph: DevGraph } | { ok: false; reason: string };

export type WriteGraphResult = { ok: true; graph: DevGraph } | { ok: false; reason: string };

export interface DeleteGraphResult {
  ok: boolean;
  reason?: string;
}

/**
 * `reason` strings open with a STABLE prefix and continue with free prose. The
 * prefix is the part a caller may branch on (an HTTP layer maps `not-found:` to
 * 404 and `invalid-id:` to 400); the prose after it is a developer-facing
 * English detail and may be reworded freely. Same division as `GraphIssue.code`
 * versus `GraphIssue.message` in `graph-types.ts`.
 */
const REASON = {
  invalidId: 'invalid-id',
  notFound: 'not-found',
  invalidJson: 'invalid-json',
  invalidSchema: 'invalid-schema',
  idMismatch: 'id-mismatch',
  readFailed: 'read-failed',
  writeFailed: 'write-failed',
  deleteFailed: 'delete-failed',
} as const;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** ENOENT (nothing there) and ENOTDIR (a parent is a file) both mean "absent". */
function isAbsent(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function invalidId(id: string): string {
  return `${REASON.invalidId}: "${id}" is not a slug (a-z, 0-9, dashes, 1-40) - refused before touching the filesystem`;
}

/**
 * A timestamp is only accepted when it is an ISO-8601 instant.
 *
 * WHY THE SHAPE AND NOT JUST `Date.parse`: `updatedAt` is compared with
 * `localeCompare` by {@link listGraphs}, so ordering is only meaningful while
 * every stamp is the SAME lexicographically sortable shape. `Date.parse`
 * happily accepts `"2026"` and `"August 3, 2026"`, which sort against real ISO
 * strings as text, not as time.
 */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * The value that gets stamped into `updatedAt`.
 *
 * A `now` that is not an ISO-8601 instant FALLS BACK TO THE CLOCK instead of
 * failing the write. `now` is an internal parameter (tests and reproducible
 * callers pass it; the UI never does), so refusing would turn a caller's bug
 * into the human losing their drawing — while a garbage stamp is a permanent
 * corruption of the list order: `"undefined"` and `"not-a-date"` sort ABOVE
 * every real ISO string, pinning that graph to the top of the picker forever.
 * Dropping the bad value costs one field of provenance; refusing costs work.
 */
function stampedAt(now?: string): string {
  return typeof now === 'string' && ISO_INSTANT_PATTERN.test(now) && !Number.isNaN(Date.parse(now))
    ? now
    : new Date().toISOString();
}

function summarize(graph: DevGraph): GraphSummary {
  return {
    id: graph.id,
    name: graph.name,
    // Spread instead of a post-assignment so the key order matches the
    // interface: this object is served as JSON, and a stable shape is what
    // keeps a snapshot diff meaningful.
    ...(graph.description !== undefined ? { description: graph.description } : {}),
    updatedAt: graph.updatedAt,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    valid: validateGraph(graph).ok,
  };
}

/**
 * Every saved graph, newest first (`updatedAt` descending, then id ascending so
 * two saves in the same millisecond still have ONE order).
 *
 * NEVER throws and never lets one bad file cost the others: a missing directory
 * is `[]`, and anything the reader cannot understand — a truncated JSON, a
 * `.json` that is some other format, a file whose name does not address it — is
 * SKIPPED. A graph that parses but breaks a product rule is NOT skipped; it is
 * listed with `valid: false`, because the human needs to open it to fix it.
 */
export function listGraphs(repoRoot: string): GraphSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(graphsDir(repoRoot));
  } catch {
    return [];
  }

  const out: GraphSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(JSON_SUFFIX)) continue;
    const id = entry.slice(0, entry.length - JSON_SUFFIX.length);
    // A stem that is not a slug cannot be passed to `readGraph`, so listing it
    // would hand the UI an id that 404s on the very next click.
    if (!DEVGRAPH_SLUG_PATTERN.test(id)) continue;
    // The SAME reader the UI will use, deliberately: "shows up in the list" and
    // "opens" are then the same predicate, including the id/filename agreement
    // it enforces.
    const result = readGraph(repoRoot, id);
    if (!result.ok) continue;
    out.push(summarize(result.graph));
  }

  out.sort((a, b) => {
    const byTime = b.updatedAt.localeCompare(a.updatedAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  return out;
}

/**
 * Load one graph by id.
 *
 * The id must be a slug BEFORE any path is built (traversal is refused as data,
 * never as an exception), and the loaded graph must carry that same id — a file
 * whose contents disagree with its name cannot be saved back without either
 * moving it or renaming the method behind the human's back, so the honest
 * answer is to refuse and say why.
 *
 * ONLY A REGULAR FILE IS READ, and that check is not cosmetic: `readFileSync`
 * on a FIFO with no writer NEVER RETURNS, and every caller here is synchronous
 * inside an HTTP handler or a TUI render — one such entry in the directory
 * would freeze the whole node event loop, taking every other run's SSE stream
 * down with it. `lstat` (not `stat`) is deliberate: it also refuses a symlink,
 * which is the one way a name inside the directory could still address bytes
 * outside it, and it reports a broken link as "not a regular file" instead of
 * as a missing graph.
 */
export function readGraph(repoRoot: string, id: string): ReadGraphResult {
  if (!DEVGRAPH_SLUG_PATTERN.test(id)) return { ok: false, reason: invalidId(id) };

  const path = graphPath(repoRoot, id);
  try {
    if (!lstatSync(path).isFile()) {
      return {
        ok: false,
        reason: `${REASON.readFailed}: "${id}${JSON_SUFFIX}" is not a regular file - refused before opening it`,
      };
    }
  } catch (err) {
    if (isAbsent(err)) {
      return { ok: false, reason: `${REASON.notFound}: no graph "${id}" under ${GRAPHS_DIR}` };
    }
    return { ok: false, reason: `${REASON.readFailed}: ${errText(err)}` };
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (isAbsent(err)) {
      return { ok: false, reason: `${REASON.notFound}: no graph "${id}" under ${GRAPHS_DIR}` };
    }
    return { ok: false, reason: `${REASON.readFailed}: ${errText(err)}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `${REASON.invalidJson}: ${errText(err)}` };
  }

  const parsed = parseDevGraph(json);
  if (!parsed.ok) {
    return { ok: false, reason: `${REASON.invalidSchema}: ${parsed.errors.join('; ')}` };
  }
  if (parsed.graph.id !== id) {
    return {
      ok: false,
      reason: `${REASON.idMismatch}: the file "${id}${JSON_SUFFIX}" holds a graph whose id is "${parsed.graph.id}"`,
    };
  }
  return { ok: true, graph: parsed.graph };
}

/**
 * Save a graph (create or replace), atomically.
 *
 * WHAT IS CHECKED: the SHAPE (`parseDevGraph`) and the id. Not the method — a
 * graph with `validateGraph` errors saves exactly like a clean one, see the
 * module header.
 *
 * WHAT IS STAMPED: `updatedAt`, always, from `now` when it is an ISO-8601
 * instant and otherwise from the clock (see {@link stampedAt} for why a bad
 * `now` is dropped rather than refused). That fallback is the one impurity in
 * this module and it is deliberate: every test and every reproducible caller
 * passes `now`, and the returned graph carries the value that actually reached
 * the disk, so nobody has to guess. `createdAt` is the caller's and is never
 * touched.
 *
 * WHY tmp + rename: a `writeFileSync` straight onto the target truncates it
 * first, so a crash (or a full disk) between truncate and write leaves the
 * human's method as an empty file. The temp lives in the SAME directory —
 * `rename` is only atomic within a filesystem — and carries a per-call unique
 * suffix so two concurrent saves of the same graph cannot scribble over each
 * other's staging file. Same recipe as `surf-research.ts`.
 *
 * That paragraph is GUARDED, not merely asserted: `graph-store.test.ts` /
 * "graph-store / writeGraph is atomic" fails if the staging file and the
 * rename are ever replaced by a direct write onto the target.
 */
export function writeGraph(repoRoot: string, graph: DevGraph, now?: string): WriteGraphResult {
  if (typeof graph !== 'object' || graph === null || Array.isArray(graph)) {
    return { ok: false, reason: `${REASON.invalidSchema}: the graph is not an object` };
  }
  // Checked before the schema so a hostile id gets the precise refusal rather
  // than a generic zod sentence. `DevGraphSchema` enforces the same slug, which
  // is the layer that would catch it if this one were ever removed.
  const id: unknown = graph.id;
  if (typeof id !== 'string' || !DEVGRAPH_SLUG_PATTERN.test(id)) {
    return { ok: false, reason: invalidId(String(id)) };
  }

  const stamped = { ...graph, updatedAt: stampedAt(now) };
  const parsed = parseDevGraph(stamped);
  if (!parsed.ok) {
    return { ok: false, reason: `${REASON.invalidSchema}: ${parsed.errors.join('; ')}` };
  }

  const path = graphPath(repoRoot, parsed.graph.id);
  const tmp = `${path}.${process.pid}-${Math.random().toString(36).slice(2, 10)}.huu.tmp`;
  try {
    mkdirSync(graphsDir(repoRoot), { recursive: true, mode: 0o700 });
    // The serializer owns the bytes: no trailing newline is added here, so the
    // file on disk is byte-identical to `serializeDevGraph`, and a caller can
    // compare the two without knowing this module exists.
    writeFileSync(tmp, serializeDevGraph(parsed.graph), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    // A staging file left behind would be listed by nothing and cleaned by
    // nobody. Best effort: if even this fails, the write error is the news.
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* nothing left to do — the real failure is reported below */
    }
    return { ok: false, reason: `${REASON.writeFailed}: ${errText(err)}` };
  }

  try {
    // `mode` only applies when the file is CREATED; replacing an existing graph
    // keeps whatever bits it already had on some platforms.
    chmodSync(path, 0o600);
  } catch {
    /* Windows / fs without chmod — best effort */
  }

  return { ok: true, graph: parsed.graph };
}

/**
 * Remove one graph.
 *
 * A missing graph is `ok: false` with `not-found:` rather than a silent success:
 * the caller is the one who knows whether deleting nothing is fine (a cleanup
 * loop) or a 404 (an HTTP DELETE), and only a distinguishable answer lets it
 * choose.
 */
export function deleteGraph(repoRoot: string, id: string): DeleteGraphResult {
  if (!DEVGRAPH_SLUG_PATTERN.test(id)) return { ok: false, reason: invalidId(id) };
  try {
    unlinkSync(graphPath(repoRoot, id));
    return { ok: true };
  } catch (err) {
    if (isAbsent(err)) {
      return { ok: false, reason: `${REASON.notFound}: no graph "${id}" under ${GRAPHS_DIR}` };
    }
    return { ok: false, reason: `${REASON.deleteFailed}: ${errText(err)}` };
  }
}
