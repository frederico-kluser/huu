import { describe, expect, it } from 'vitest';
import { makeGraphApi } from './graph-api-client.js';

// The transport is injected, so the whole HTTP surface is testable in Node with
// no fetch and no browser.
//
// THESE ASSERTIONS EXIST TO STOP ONE BUG FROM COMING BACK. The client and the
// server halves of `/api/graphs` were written in parallel against a written
// contract, and the client's first draft got two things wrong in a way NOTHING
// would have reported: it PUT the devgraph raw (the server reads `body.graph`
// and answers `invalid-schema`) and it sent `dir` in the query of a PUT (the
// server reads `body.dir`, so the graph would have been silently saved into
// huu's own working directory instead of the human's project — a wrong file on
// disk, no error anywhere). So the tests below assert the exact BYTES that go
// out, not just the shape: the envelope, and which side of the request `dir`
// travels on.

/** A fake `api(path, opts)` that records the calls and answers `{ ok: true }`. */
function recorder(reply) {
  const calls = [];
  const api = async (path, opts) => {
    calls.push({ path, opts });
    if (typeof reply === 'function') return reply(path, opts);
    return reply === undefined ? { ok: true } : reply;
  };
  return { api, calls };
}

/** The parsed body of call `n`. */
function bodyOf(calls, n) {
  return JSON.parse(calls[n].opts.body);
}

const GRAPH = {
  _format: 'huu-devgraph-v1',
  id: 'tres-frentes',
  name: 'Três frentes',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  meta: {},
  nodes: [{ id: 'prompt-1', kind: 'prompt', label: 'Entrada', position: { x: 0, y: 0 }, goal: 'x' }],
  edges: [],
};

describe('makeGraphApi', () => {
  it('refuses a transport that is not callable', () => {
    expect(() => makeGraphApi(undefined)).toThrow(TypeError);
    expect(() => makeGraphApi(/** @type {any} */ ({}))).toThrow(/apiFn must be a function/);
  });

  it('exposes exactly the eight calls the editor makes', () => {
    const { api } = recorder();
    expect(Object.keys(makeGraphApi(api)).sort()).toEqual([
      'catalog',
      'compile',
      'fromSample',
      'list',
      'read',
      'remove',
      'save',
      'validate',
    ]);
  });
});

describe('GET and DELETE — `dir` rides in the QUERY (no body to put it in)', () => {
  it('lists the library, with and without a project', async () => {
    const { api, calls } = recorder({ graphs: [] });
    const graphs = makeGraphApi(api);
    await graphs.list();
    await graphs.list('/home/u/proj');
    await graphs.list('   ');
    expect(calls.map((c) => c.path)).toEqual([
      '/api/graphs',
      '/api/graphs?dir=%2Fhome%2Fu%2Fproj',
      '/api/graphs',
    ]);
    expect(calls.every((c) => c.opts === undefined)).toBe(true);
  });

  it('reads one graph and escapes the id', async () => {
    const { api, calls } = recorder({ graph: GRAPH });
    const graphs = makeGraphApi(api);
    await graphs.read('tres-frentes', '/p');
    await graphs.read('../../etc/passwd');
    expect(calls[0].path).toBe('/api/graphs/tres-frentes?dir=%2Fp');
    expect(calls[1].path).toBe('/api/graphs/..%2F..%2Fetc%2Fpasswd');
  });

  it('DELETEs by id, with `dir` in the query', async () => {
    const { api, calls } = recorder();
    await makeGraphApi(api).remove('tres-frentes', '/p');
    expect(calls[0].path).toBe('/api/graphs/tres-frentes?dir=%2Fp');
    expect(calls[0].opts).toEqual({ method: 'DELETE' });
  });

  it('fetches the catalog with no parameter at all — the library is huu’s, not the repo’s', async () => {
    const { api, calls } = recorder({ blocks: [], kinds: [], methodologies: [], samples: [] });
    await makeGraphApi(api).catalog();
    expect(calls[0].path).toBe('/api/graphs/catalog');
    expect(calls[0].opts).toBeUndefined();
  });
});

describe('PUT and POST — the body is an ENVELOPE and `dir` rides INSIDE it', () => {
  it('PUTs `{dir, graph}` to the id the GRAPH carries, with a clean path', async () => {
    const { api, calls } = recorder({ ok: true, graph: GRAPH });
    await makeGraphApi(api).save(GRAPH, '/home/u/proj');
    expect(calls[0].path).toBe('/api/graphs/tres-frentes');
    expect(calls[0].path).not.toContain('dir=');
    expect(calls[0].opts.method).toBe('PUT');
    expect(bodyOf(calls, 0)).toEqual({ dir: '/home/u/proj', graph: GRAPH });
  });

  it('leaves `dir` out of the PUT body when there is no project — the server falls back to its cwd', async () => {
    const { api, calls } = recorder();
    const graphs = makeGraphApi(api);
    await graphs.save(GRAPH);
    await graphs.save(GRAPH, '   ');
    expect(bodyOf(calls, 0)).toEqual({ graph: GRAPH });
    expect('dir' in bodyOf(calls, 1)).toBe(false);
  });

  it('POSTs `{graph}` to validate — no dir, because validation reads no repository', async () => {
    const { api, calls } = recorder({ ok: true, errors: [], warnings: [] });
    await makeGraphApi(api).validate(GRAPH);
    expect(calls[0].path).toBe('/api/graphs/validate');
    expect(calls[0].opts.method).toBe('POST');
    expect(bodyOf(calls, 0)).toEqual({ graph: GRAPH });
  });

  it('POSTs `{graph, goal?, graphRoot?, sessionId?}` to compile, omitting what is blank', async () => {
    const { api, calls } = recorder({
      ok: true,
      pipeline: {},
      nodeOrder: [],
      stepsByNode: {},
      warnings: [],
    });
    const graphs = makeGraphApi(api);
    await graphs.compile(GRAPH);
    await graphs.compile(GRAPH, {
      goal: 'Cobrir o parser',
      sessionId: 's-1',
      graphRoot: '.huu/dev/s-1/graph',
    });
    await graphs.compile(GRAPH, { goal: '   ', sessionId: undefined });
    expect(calls[0].path).toBe('/api/graphs/compile');
    expect(bodyOf(calls, 0)).toEqual({ graph: GRAPH });
    expect(bodyOf(calls, 1)).toEqual({
      graph: GRAPH,
      goal: 'Cobrir o parser',
      graphRoot: '.huu/dev/s-1/graph',
      sessionId: 's-1',
    });
    expect(bodyOf(calls, 2)).toEqual({ graph: GRAPH });
  });

  it('POSTs `{dir, sampleId, id?, name?}` to from-sample — `dir` in the BODY, never the query', async () => {
    const { api, calls } = recorder({ ok: true, graph: GRAPH });
    const graphs = makeGraphApi(api);
    await graphs.fromSample('tdd-security-performance');
    await graphs.fromSample('tdd-security-performance', {
      dir: '/p',
      id: 'meu-metodo',
      name: '  Meu método  ',
    });
    await graphs.fromSample('tdd-security-performance', { id: '   ' });
    expect(calls.every((c) => !c.path.includes('dir='))).toBe(true);
    expect(calls[0].path).toBe('/api/graphs/from-sample');
    expect(bodyOf(calls, 0)).toEqual({ sampleId: 'tdd-security-performance' });
    expect(bodyOf(calls, 1)).toEqual({
      dir: '/p',
      sampleId: 'tdd-security-performance',
      id: 'meu-metodo',
      name: 'Meu método',
    });
    expect(bodyOf(calls, 2)).toEqual({ sampleId: 'tdd-security-performance' });
  });

  it('never sends the devgraph raw — every write body carries it under `graph`', async () => {
    const { api, calls } = recorder();
    const graphs = makeGraphApi(api);
    await graphs.save(GRAPH, '/p');
    await graphs.validate(GRAPH);
    await graphs.compile(GRAPH);
    for (let i = 0; i < 3; i += 1) {
      const body = bodyOf(calls, i);
      expect(body._format).toBeUndefined();
      expect(body.graph._format).toBe('huu-devgraph-v1');
    }
  });
});

describe('refusals — caught before the wire', () => {
  it('never sends a request with no id — `/api/graphs/undefined` must not exist', async () => {
    const { api, calls } = recorder();
    const graphs = makeGraphApi(api);
    await expect(graphs.read('')).rejects.toThrow(/requires a graph id/);
    await expect(graphs.read(null)).rejects.toThrow(TypeError);
    await expect(graphs.remove(undefined)).rejects.toThrow(/requires a graph id/);
    await expect(graphs.save({ name: 'sem id' })).rejects.toThrow(/requires a graph id/);
    await expect(graphs.save(null)).rejects.toThrow(TypeError);
    await expect(graphs.fromSample('')).rejects.toThrow(/requires a graph id/);
    expect(calls).toEqual([]);
  });

  it('refuses an id the ROUTES have reserved, before the server has to', async () => {
    const { api, calls } = recorder();
    const graphs = makeGraphApi(api);
    for (const id of ['catalog', 'compile', 'validate', 'from-sample']) {
      await expect(graphs.save({ ...GRAPH, id })).rejects.toThrow(/nome de rota do huu/);
      await expect(graphs.fromSample('recon-fanout', { id })).rejects.toThrow(/nome de rota do huu/);
    }
    expect(calls).toEqual([]);
  });

  it('refuses a graph id that is not a slug', async () => {
    const { api, calls } = recorder();
    const graphs = makeGraphApi(api);
    await expect(graphs.save({ ...GRAPH, id: 'Meu Método' })).rejects.toThrow(/não é um slug/);
    await expect(graphs.save({ ...GRAPH, id: '-comeca-errado' })).rejects.toThrow(/não é um slug/);
    expect(calls).toEqual([]);
  });

  it('still READS and DELETES a reserved-looking id — only writes are refused', async () => {
    const { api, calls } = recorder();
    const graphs = makeGraphApi(api);
    await graphs.read('catalog');
    await graphs.remove('catalog');
    expect(calls).toHaveLength(2);
  });

  it('lets the server’s own error through — the editor has to say WHY a save failed', async () => {
    const { api } = recorder(() => {
      throw new Error('write-failed: the store could not write the file');
    });
    await expect(makeGraphApi(api).save(GRAPH)).rejects.toThrow(/write-failed/);
  });

  it('lets a rejected read through untouched', async () => {
    const api = async () => {
      throw new Error('not-found: no graph with id "ghost"');
    };
    await expect(makeGraphApi(api).read('ghost')).rejects.toThrow(/not-found/);
  });
});

describe('validate — a wrong graph is an ANSWER, not a transport failure', () => {
  it('hands back the 200 payload untouched, `ok:false` included', async () => {
    const payload = {
      ok: false,
      errors: [{ code: 'cycle', message: '"a" sits on a cycle', nodeId: 'a' }],
      warnings: [{ code: 'deep-graph', message: 'the longest path is 13 nodes deep' }],
    };
    const { api } = recorder(payload);
    const answer = await makeGraphApi(api).validate(GRAPH);
    expect(answer).toBe(payload);
    expect(answer.ok).toBe(false);
  });

  it('carries the UNANCHORED schema issue through, so the UI can show it somewhere', async () => {
    const { api } = recorder({
      ok: false,
      errors: [{ code: 'invalid-schema', message: '_format: Invalid literal value' }],
      warnings: [],
    });
    const [issue] = (await makeGraphApi(api).validate(GRAPH)).errors;
    expect(issue.code).toBe('invalid-schema');
    expect(issue.nodeId).toBeUndefined();
    expect(issue.edgeId).toBeUndefined();
  });
});

describe('compile — one shape for every outcome', () => {
  it('passes a successful compile straight through', async () => {
    const payload = {
      ok: true,
      pipeline: { name: 'p' },
      nodeOrder: ['prompt-1'],
      stepsByNode: {},
      warnings: [],
    };
    const { api } = recorder(payload);
    expect(await makeGraphApi(api).compile(GRAPH)).toBe(payload);
  });

  it('turns a 400 into `{ok:false}` instead of a rejection, keeping `errors[]` when the transport carries it', async () => {
    const { api } = recorder(() => {
      const err = new Error(
        'the graph does not compile — 2 blocking issue(s) [cycle, unreachable-node]',
      );
      // What a transport that keeps the parsed body would attach.
      // @ts-ignore — an ad-hoc field on an Error, exactly as a richer api() would set it.
      err.body = {
        ok: false,
        errors: [
          { code: 'cycle', message: 'x', nodeId: 'action-2' },
          { code: 'unreachable-node', message: 'y', nodeId: 'action-9' },
        ],
        warnings: [{ code: 'deep-graph', message: 'z' }],
      };
      throw err;
    });
    const answer = await makeGraphApi(api).compile(GRAPH);
    expect(answer.ok).toBe(false);
    expect(answer.error).toMatch(/does not compile/);
    expect(answer.errors.map((e) => e.nodeId)).toEqual(['action-2', 'action-9']);
    expect(answer.warnings).toHaveLength(1);
  });

  it('still answers `{ok:false}` with today’s `api()`, which keeps only the message', async () => {
    const { api } = recorder(() => {
      throw new Error('the graph does not compile — 1 blocking issue(s) [cycle]');
    });
    const answer = await makeGraphApi(api).compile(GRAPH);
    expect(answer).toEqual({
      ok: false,
      error: 'the graph does not compile — 1 blocking issue(s) [cycle]',
      errors: [],
      warnings: [],
    });
  });

  it('does not pretend a dead connection compiled', async () => {
    const api = async () => {
      throw new Error('Failed to fetch');
    };
    const answer = await makeGraphApi(api).compile(GRAPH);
    expect(answer.ok).toBe(false);
    expect(answer.error).toBe('Failed to fetch');
  });
});

describe('the payload the caller gets', () => {
  it('returns exactly what the transport returned, unwrapped', async () => {
    const payload = { graphs: [{ id: 'a', name: 'A', valid: true }] };
    const { api } = recorder(payload);
    expect(await makeGraphApi(api).list()).toBe(payload);
  });

  it('hands back the graph AS STORED, which is what the caller must adopt', async () => {
    // The store re-stamps `updatedAt`, and `from-sample` may SUFFIX the id when
    // one is taken — so the response, never the request, is the truth.
    const stored = { ...GRAPH, id: 'recon-fanout-2', updatedAt: '2026-08-03T12:00:00.000Z' };
    const { api } = recorder({ ok: true, graph: stored });
    const answer = await makeGraphApi(api).fromSample('recon-fanout', { id: 'recon-fanout' });
    expect(answer.graph.id).toBe('recon-fanout-2');
    expect(answer.graph.updatedAt).not.toBe(GRAPH.updatedAt);
  });

  it('appends `?dir=` after an existing query string rather than a second `?`', async () => {
    const { api, calls } = recorder();
    await makeGraphApi(api).read('a', '/p');
    expect(calls[0].path.match(/\?/g)).toHaveLength(1);
    expect(calls[0].path.endsWith('?dir=%2Fp')).toBe(true);
  });
});
