/* huu web UI — the HTTP surface of the graph editor.
   =================================================

   One factory, one injected transport. `makeGraphApi(apiFn)` takes the very
   `api(path, opts)` that `modules/state.js` already exports (fetch + JSON +
   the `?token=` the server may require + `throw` on a non-2xx) and returns the
   eight calls the editor makes. Nothing here touches `fetch`, `window` or the
   DOM, at import time or at call time — which is exactly what lets
   `graph-api-client.test.js` drive the whole surface in Node with a two-line
   fake and assert the paths, the verbs and the bodies.

   THE CONTRACT, verified against `src/web/graph-api.ts` (the server half is a
   pure `(method, path, query, body) → {status, body}` function, so this table
   is the whole grammar):

     GET    /api/graphs?dir=              → { graphs: GraphSummary[] }
     GET    /api/graphs/:id?dir=          → { graph }
     PUT    /api/graphs/:id               ← { dir?, graph }        → { ok, graph }
     DELETE /api/graphs/:id?dir=          → { ok }
     POST   /api/graphs/validate          ← { graph }              → { ok, errors, warnings }
     POST   /api/graphs/compile           ← { graph, goal?, graphRoot?, sessionId? }
     GET    /api/graphs/catalog           → { blocks, kinds, methodologies, samples }
     POST   /api/graphs/from-sample       ← { dir?, sampleId, id?, name? } → { ok, graph }

   THE BODY IS ALWAYS AN ENVELOPE — `{ graph }`, never the devgraph raw. The
   server reads `body.graph` and answers `invalid-schema: the request carries no
   "graph" object` to anything else.

   WHERE `dir` TRAVELS IS NOT A DETAIL. On GET and DELETE it is a query
   parameter, because those verbs carry no body; on PUT and POST it is a BODY
   field (`body.dir`), because that is where `resolveGraphDir` reads it. A `dir`
   in the query of a PUT is silently ignored and the graph lands in huu's own
   working directory instead of the human's project — a bug with no error
   message, which is why the tests below assert the exact bytes that go out.

   `/validate` and `/compile` take NO `dir` at all: both are pure functions of
   the graph, and inventing a parameter the server does not read would be a
   promise the client cannot keep.

   ERRORS ARE NOT SWALLOWED — except where the server itself calls failure an
   answer. `api()` throws on `!res.ok` with the server's own `error` string,
   and every method here lets that through, because the editor has to say WHY a
   save was refused. `compile()` is the documented exception; see its comment.
   The only thing this module refuses on its own is a request that cannot be
   legal — no id, a non-slug id, an id the routes have reserved — and it does so
   BEFORE the request, so `PUT /api/graphs/undefined` never reaches the wire. */

import { graphIdIssue } from './graph-model.js';

const BASE = '/api/graphs';

/** Append `?dir=` only when there is a directory to name (GET / DELETE). */
function withDir(path, dir) {
  const value = typeof dir === 'string' ? dir.trim() : '';
  if (!value) return path;
  return path + (path.includes('?') ? '&' : '?') + 'dir=' + encodeURIComponent(value);
}

/**
 * The `{ dir }` half of a PUT/POST body — present only when set, so a
 * single-project session sends the body it always did and the server falls back
 * to its own cwd (`resolveGraphDir`).
 */
function bodyDir(dir) {
  const value = typeof dir === 'string' ? dir.trim() : '';
  return value ? { dir: value } : {};
}

/** `/api/graphs/<id>`, escaped — an id is a slug, but never trust that here. */
function idPath(id) {
  return BASE + '/' + encodeURIComponent(id);
}

/** A non-empty string, or a throw naming the call that was mis-used. */
function requireId(value, what) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) throw new TypeError(`makeGraphApi: ${what} requires a graph id`);
  return id;
}

/**
 * A WRITABLE graph id: present, a slug, and not one of the four names the
 * routes have taken. The server answers 400 for each of these; catching them
 * here turns a failed save into a sentence the human can act on.
 */
function requireWritableId(value, what) {
  const id = requireId(value, what);
  const issue = graphIdIssue(id);
  if (issue) throw new TypeError(`makeGraphApi: ${what} — ${issue.message}`);
  return id;
}

function postJson(payload) {
  return { method: 'POST', body: JSON.stringify(payload) };
}

/**
 * Bind the graph routes to a transport.
 *
 * @param {(path: string, opts?: any) => Promise<any>} apiFn usually `api` from
 *   `modules/state.js`; any fetch-shaped function works, which is the whole
 *   point of the injection.
 * @returns {Record<string, Function>} `{list, read, save, remove, validate,
 *   compile, catalog, fromSample}`
 */
export function makeGraphApi(apiFn) {
  if (typeof apiFn !== 'function') {
    throw new TypeError('makeGraphApi: apiFn must be a function');
  }

  return {
    /**
     * Every graph the project holds, as summaries
     * (`{id, name, description?, updatedAt, nodeCount, edgeCount, valid}`).
     * Never fails: an unreadable directory lists as `[]`.
     * @returns {Promise<any>} `{ graphs }`
     */
    async list(dir) {
      return apiFn(withDir(BASE, dir));
    },

    /**
     * One graph, in full.
     * @returns {Promise<any>} `{ graph }` — 404 when the id is unknown.
     */
    async read(id, dir) {
      return apiFn(withDir(idPath(requireId(id, 'read')), dir));
    },

    /**
     * Write a graph.
     *
     * The id in the PATH comes from the graph itself, so the server's
     * `id-mismatch:` 400 is structurally unreachable from this client. THE
     * CONSEQUENCE, and it is the one thing a caller must know: there is no
     * rename. Changing `graph.id` and saving creates a SECOND graph under the
     * new id and leaves the old file untouched — renaming is `remove(oldId)`
     * followed by `save(graphWithNewId)`, in that order, and the human should
     * be told that is what they are about to do.
     *
     * @returns {Promise<any>} `{ ok, graph }` — the graph AS STORED (the store
     *   re-stamps `updatedAt`), so adopt the response, not what you sent.
     */
    async save(graph, dir) {
      const id = requireWritableId(graph && graph.id, 'save');
      return apiFn(idPath(id), {
        method: 'PUT',
        body: JSON.stringify({ ...bodyDir(dir), graph }),
      });
    },

    /**
     * Delete a graph. A missing graph is a 404, not a silent 200.
     * @returns {Promise<any>} `{ ok }`
     */
    async remove(id, dir) {
      return apiFn(withDir(idPath(requireId(id, 'remove')), dir), { method: 'DELETE' });
    },

    /**
     * Check a graph WITHOUT saving it — the editor's live issue list.
     *
     * ALWAYS 200, including for a graph full of errors: a half-drawn method is
     * the normal input here, so `ok: false` is an ANSWER, never a transport
     * failure. Only a dead connection (or the token gate) rejects. Feed
     * `errors` / `warnings` to `groupIssues` — some rows carry no anchor.
     *
     * No `dir`: validation reads no repository.
     *
     * @returns {Promise<any>} `{ ok, errors, warnings }`
     */
    async validate(graph) {
      return apiFn(BASE + '/validate', postJson({ graph }));
    },

    /**
     * The `huu-pipeline-v2` this drawing becomes.
     *
     * THE ONE METHOD THAT NEVER REJECTS, and the server's own framing is why: a
     * method that will not compile answers 400 with `{ok:false, error,
     * errors?, warnings?}` — the `errors[]` being deliberately additive so the
     * canvas can highlight the offending nodes with NO second round-trip. A
     * rejection would throw that array away and leave the caller with a
     * sentence.  So every outcome comes back as one shape, and the caller
     * branches on `ok` instead of on `try`.
     *
     * CAVEAT worth knowing: `api()` in `modules/state.js` keeps only
     * `data.error` when it throws, so `errors[]` survives only if the injected
     * transport attaches the parsed body to the Error (`err.body` / `err.data`
     * are both read here). With today's `api()` the caller still gets
     * `ok: false` and the message; the array arrives the day that one line lands.
     *
     * @param {object} graph
     * @param {{goal?: string, graphRoot?: string, sessionId?: string}} [opts]
     * @returns {Promise<any>} `{ok:true, pipeline, nodeOrder, stepsByNode,
     *   warnings}` or `{ok:false, error, errors, warnings}`
     */
    async compile(graph, opts = {}) {
      const options = opts && typeof opts === 'object' ? opts : {};
      /** @type {Record<string, any>} */
      const payload = { graph };
      for (const key of ['goal', 'graphRoot', 'sessionId']) {
        const value = options[key];
        if (typeof value === 'string' && value.trim()) payload[key] = value;
      }
      try {
        return await apiFn(BASE + '/compile', postJson(payload));
      } catch (err) {
        const carried = (err && (err.body || err.data)) || {};
        return {
          ok: false,
          error: (err && err.message) || 'compile failed',
          errors: Array.isArray(carried.errors) ? carried.errors : [],
          warnings: Array.isArray(carried.warnings) ? carried.warnings : [],
        };
      }
    },

    /**
     * The palette's source of truth: the FULL blocks (prompt template and judge
     * clause included), the node kinds, the methodologies and the sample
     * library. No `?dir=` — the catalog is huu's, not the project's.
     *
     * `/api/bootstrap` carries a LIGHTER projection of the same data
     * (`graphBlocks`, `graphNodeKinds`, `graphSamples`) with `promptTemplate`
     * and `judgeClause` stripped, because it is refetched on every page load
     * and every SSE resync. Use bootstrap to LIST, this to EDIT.
     *
     * @returns {Promise<any>} `{ blocks, kinds, methodologies, samples }`
     */
    async catalog() {
      return apiFn(BASE + '/catalog');
    },

    /**
     * Open a worked example as a new graph, saved on the spot.
     *
     * NEVER OVERWRITES: if the id is taken the server suffixes it
     * (`recon-fanout-2`, `-3`, …) and returns the graph that actually reached
     * the disk. So the caller MUST navigate by `response.graph.id`, never by the
     * id it asked for — they can differ, and that is the feature.
     *
     * @param {string} sampleId
     * @param {{dir?: string, id?: string, name?: string}} [opts]
     * @returns {Promise<any>} `{ ok, graph }`
     */
    async fromSample(sampleId, opts = {}) {
      const sample = requireId(sampleId, 'fromSample');
      const options = opts && typeof opts === 'object' ? opts : {};
      /** @type {Record<string, any>} */
      const payload = { ...bodyDir(options.dir), sampleId: sample };
      if (typeof options.id === 'string' && options.id.trim()) {
        payload.id = requireWritableId(options.id, 'fromSample');
      }
      if (typeof options.name === 'string' && options.name.trim()) {
        payload.name = options.name.trim();
      }
      return apiFn(BASE + '/from-sample', postJson(payload));
    },
  };
}
