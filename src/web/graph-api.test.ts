import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDevGraph, serializeDevGraph } from '../lib/dev-graph/graph-schema.js';
import { GRAPH_SAMPLES, findSample } from '../lib/dev-graph/graph-samples.js';
import { graphPath, graphsDir } from '../lib/dev-graph/graph-store.js';
import type { DevGraph, GraphNode } from '../lib/dev-graph/graph-types.js';
import { ACTION_BLOCKS, NODE_KINDS } from '../lib/dev-graph/node-catalog.js';
import {
  GRAPH_RESERVED_SEGMENTS,
  compileGraphResult,
  deleteGraphResult,
  fromSampleResult,
  graphBlockOptions,
  graphCatalogResult,
  graphNodeKindOptions,
  graphSampleOptions,
  handleGraphRequest,
  isGraphApiPath,
  listGraphsResult,
  readGraphResult,
  resolveGraphDir,
  statusForReason,
  validateGraphResult,
  writeGraphResult,
  type GraphApiResult,
} from './graph-api.js';

const NOW = '2026-08-03T12:00:00.000Z';

/** A REAL directory per test — this repo does not mock the filesystem. */
let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'huu-graph-api-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** The smallest graph the schema accepts: the root prompt node and nothing else. */
function graph(id: string, name = `Graph ${id}`): DevGraph {
  return emptyDevGraph(id, name, NOW);
}

/** Write straight into the store directory, bypassing every check. */
function seedRaw(fileName: string, contents: string): void {
  mkdirSync(graphsDir(repo), { recursive: true });
  writeFileSync(join(graphsDir(repo), fileName), contents, 'utf8');
}

/** Save through the public route, the way the browser does. */
function put(id: string, value: DevGraph, dir = repo): GraphApiResult {
  return writeGraphResult(repo, id, { dir, graph: value as unknown as Record<string, unknown> });
}

function errorOf(result: GraphApiResult): string {
  return String(result.body.error ?? '');
}

/** A GET/DELETE through the router, with the query the browser would send. */
function route(
  method: string,
  path: string,
  query = '',
  body: Record<string, unknown> = {},
): GraphApiResult {
  return handleGraphRequest({
    cwd: repo,
    method,
    path,
    query: new URLSearchParams(query),
    body,
  });
}

describe('graph-api / statusForReason', () => {
  it('maps every prefix the store publishes', () => {
    // The table IS the contract with `graph-store.ts`'s `const REASON`. If a
    // prefix is ever renamed there, this test is where it must be renamed here.
    const expected: Record<string, number> = {
      'invalid-id': 400,
      'invalid-json': 400,
      'invalid-schema': 400,
      'id-mismatch': 400,
      'not-found': 404,
      'read-failed': 500,
      'write-failed': 500,
      'delete-failed': 500,
    };
    for (const [prefix, status] of Object.entries(expected)) {
      expect(statusForReason(`${prefix}: some free prose after the colon`), prefix).toBe(status);
    }
  });

  it('ignores the prose, which the store is free to reword', () => {
    expect(statusForReason('not-found: no graph "x" under .huu/dev/graphs')).toBe(404);
    expect(statusForReason('not-found: anything at all')).toBe(404);
  });

  it('answers 500 for a prefix nobody taught it — never 400', () => {
    // An unknown prefix is a store that grew an outcome the HTTP layer does not
    // know; blaming the caller with a 400 would be a lie.
    expect(statusForReason('brand-new-prefix: hello')).toBe(500);
    expect(statusForReason('a reason with no colon at all')).toBe(500);
    expect(statusForReason('')).toBe(500);
  });
});

describe('graph-api / resolveGraphDir', () => {
  it('falls back to the server cwd when no dir is given', () => {
    for (const absent of [undefined, null, '', '   ', 42, {}, []]) {
      expect(resolveGraphDir('/srv/repo', absent)).toBe('/srv/repo');
    }
  });

  it('keeps an absolute dir as given', () => {
    expect(resolveGraphDir('/srv/repo', '/other/project')).toBe('/other/project');
  });

  it('resolves a relative dir exactly like dev-manager does for runDirectory', () => {
    expect(resolveGraphDir('/srv/repo', './sub')).toBe(resolve('./sub'));
  });
});

describe('graph-api / isGraphApiPath', () => {
  it('claims the namespace and nothing next to it', () => {
    expect(isGraphApiPath('/api/graphs')).toBe(true);
    expect(isGraphApiPath('/api/graphs/')).toBe(true);
    expect(isGraphApiPath('/api/graphs/catalog')).toBe(true);
    expect(isGraphApiPath('/api/graphs/my-graph')).toBe(true);
    expect(isGraphApiPath('/api/graphsomething')).toBe(false);
    expect(isGraphApiPath('/api/graph')).toBe(false);
    expect(isGraphApiPath('/api/dev')).toBe(false);
    expect(isGraphApiPath('/graph')).toBe(false);
  });
});

describe('graph-api / catalog', () => {
  it('serves the blocks, the kinds, the methodologies and the samples', () => {
    const result = graphCatalogResult();
    expect(result.status).toBe(200);
    const body = result.body as {
      blocks: unknown[];
      kinds: unknown[];
      methodologies: unknown[];
      samples: unknown[];
    };
    expect(body.blocks).toHaveLength(ACTION_BLOCKS.length);
    expect(body.kinds).toHaveLength(NODE_KINDS.length);
    expect(body.samples).toHaveLength(GRAPH_SAMPLES.length);
    expect(body.methodologies.length).toBeGreaterThan(0);
  });

  it('keeps the prompt template in the catalog — the node editor shows it', () => {
    const blocks = (graphCatalogResult().body as { blocks: { id: string; promptTemplate: string }[] })
      .blocks;
    const recon = blocks.find((b) => b.id === 'recon');
    expect(recon?.promptTemplate).toContain('$goal');
  });

  it('drops the builders from the samples — a closure is not JSON', () => {
    const samples = graphSampleOptions();
    expect(samples).toHaveLength(GRAPH_SAMPLES.length);
    for (const sample of samples) {
      expect(Object.keys(sample).sort()).toEqual(['description', 'id', 'name']);
    }
    expect(JSON.parse(JSON.stringify(samples))).toEqual(samples);
  });

  it('projects the palette blocks WITHOUT the agent-facing prose', () => {
    const options = graphBlockOptions();
    expect(options).toHaveLength(ACTION_BLOCKS.length);
    for (const option of options) {
      expect(Object.keys(option).sort()).toEqual([
        'defaultScope',
        'description',
        'id',
        'label',
        'produces',
        'readOnly',
        'review',
      ]);
    }
    // The heavy halves stay server-side; /api/graphs/catalog still has them.
    expect(JSON.stringify(options)).not.toContain('$goal');
  });

  it('projects the palette from the single sources, never a hand-written copy', () => {
    expect(graphBlockOptions().map((b) => b.id)).toEqual(ACTION_BLOCKS.map((b) => b.id));
    expect(graphNodeKindOptions()).toEqual(
      NODE_KINDS.map(({ kind, label, description }) => ({ kind, label, description })),
    );
    expect(graphSampleOptions().map((s) => s.id)).toEqual(GRAPH_SAMPLES.map((s) => s.id));
  });
});

describe('graph-api / list', () => {
  it('answers 200 with an empty list for a repo that never saved one', () => {
    const result = listGraphsResult(repo, undefined);
    expect(result.status).toBe(200);
    expect(result.body.graphs).toEqual([]);
  });

  it('lists what was written, with the summary the picker renders', () => {
    put('alpha', graph('alpha', 'Alpha'));
    const graphs = listGraphsResult(repo, undefined).body.graphs as Record<string, unknown>[];
    expect(graphs).toHaveLength(1);
    expect(graphs[0]).toMatchObject({ id: 'alpha', name: 'Alpha', nodeCount: 1, edgeCount: 0 });
    expect(typeof graphs[0]!.valid).toBe('boolean');
  });

  it('reads the repo named by dir, not the server cwd', () => {
    const other = mkdtempSync(join(tmpdir(), 'huu-graph-api-other-'));
    try {
      writeGraphResult(repo, 'beta', {
        dir: other,
        graph: graph('beta') as unknown as Record<string, unknown>,
      });
      expect(listGraphsResult(repo, undefined).body.graphs).toEqual([]);
      expect((listGraphsResult(repo, other).body.graphs as unknown[])).toHaveLength(1);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('skips a file it cannot read instead of failing the whole listing', () => {
    put('good', graph('good'));
    seedRaw('broken.json', '{ not json');
    seedRaw('alien.json', '{"hello":1}');
    const graphs = listGraphsResult(repo, undefined).body.graphs as { id: string }[];
    expect(graphs.map((g) => g.id)).toEqual(['good']);
  });
});

describe('graph-api / read', () => {
  it('reads back exactly what was written', () => {
    put('alpha', graph('alpha', 'Alpha'));
    const result = readGraphResult(repo, undefined, 'alpha');
    expect(result.status).toBe(200);
    expect((result.body.graph as DevGraph).name).toBe('Alpha');
  });

  it('404s an id nobody saved', () => {
    const result = readGraphResult(repo, undefined, 'missing');
    expect(result.status).toBe(404);
    expect(errorOf(result)).toMatch(/^not-found:/);
  });

  it('400s a traversal id BEFORE any path is built', () => {
    const result = readGraphResult(repo, undefined, '../../etc/passwd');
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-id:/);
  });

  it('400s every non-slug id', () => {
    for (const bad of ['', 'Upper', 'has space', 'a/b', 'a.b', '-leading', 'a'.repeat(41)]) {
      const result = readGraphResult(repo, undefined, bad);
      expect(result.status, bad).toBe(400);
      expect(errorOf(result), bad).toMatch(/^invalid-id:/);
    }
  });

  it('400s a reserved id — it could be saved but never read back', () => {
    for (const reserved of GRAPH_RESERVED_SEGMENTS) {
      const result = readGraphResult(repo, undefined, reserved);
      expect(result.status, reserved).toBe(400);
      expect(errorOf(result), reserved).toMatch(/reserved/);
    }
  });

  it('400s a truncated file as invalid-json', () => {
    seedRaw('broken.json', '{ "id": "broken"');
    const result = readGraphResult(repo, undefined, 'broken');
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-json:/);
  });

  it('400s a .json that is some other format as invalid-schema', () => {
    seedRaw('alien.json', '{"hello":1}');
    const result = readGraphResult(repo, undefined, 'alien');
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-schema:/);
  });

  it('400s a file whose graph disagrees with its own name', () => {
    seedRaw('renamed.json', serializeDevGraph(graph('alpha')));
    const result = readGraphResult(repo, undefined, 'renamed');
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^id-mismatch:/);
  });

  it('500s a name that is not a regular file — the store refuses to open it', () => {
    mkdirSync(join(graphsDir(repo), 'weird.json'), { recursive: true });
    const result = readGraphResult(repo, undefined, 'weird');
    expect(result.status).toBe(500);
    expect(errorOf(result)).toMatch(/^read-failed:/);
  });
});

describe('graph-api / write', () => {
  it('saves and answers with the stamped graph', () => {
    const result = put('alpha', graph('alpha'));
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    const saved = result.body.graph as DevGraph;
    expect(saved.id).toBe('alpha');
    // `writeGraph` always stamps; `createdAt` is the caller's and survives.
    expect(saved.createdAt).toBe(NOW);
    expect(typeof saved.updatedAt).toBe('string');
  });

  it('round-trips through read', () => {
    put('alpha', graph('alpha', 'Round trip'));
    const read = readGraphResult(repo, undefined, 'alpha');
    expect((read.body.graph as DevGraph).name).toBe('Round trip');
  });

  it('400s a body with no graph object', () => {
    for (const raw of [undefined, null, 'a string', 7, []]) {
      const result = writeGraphResult(repo, 'alpha', { graph: raw });
      expect(result.status).toBe(400);
      expect(errorOf(result)).toMatch(/^invalid-schema:/);
    }
  });

  it('400s when the path id and the body id disagree — the URL is the authority', () => {
    const result = writeGraphResult(repo, 'alpha', {
      graph: graph('beta') as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^id-mismatch:/);
    // …and nothing was written under either id.
    expect(readGraphResult(repo, undefined, 'alpha').status).toBe(404);
    expect(readGraphResult(repo, undefined, 'beta').status).toBe(404);
  });

  it('400s a hostile path id before it becomes a filename', () => {
    const result = writeGraphResult(repo, '../escape', {
      graph: graph('escape') as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-id:/);
  });

  it('400s a reserved id so no unreachable graph is ever created', () => {
    const result = writeGraphResult(repo, 'catalog', {
      graph: { ...graph('catalog') } as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/reserved/);
  });

  it('400s a graph the schema refuses', () => {
    const broken = { ...graph('alpha'), _format: 'not-a-devgraph' };
    const result = writeGraphResult(repo, 'alpha', {
      graph: broken as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-schema:/);
  });

  it('writes into dir, not into the server cwd', () => {
    const other = mkdtempSync(join(tmpdir(), 'huu-graph-api-other-'));
    try {
      const result = writeGraphResult(repo, 'gamma', {
        dir: other,
        graph: graph('gamma') as unknown as Record<string, unknown>,
      });
      expect(result.status).toBe(200);
      expect(readGraphResult(repo, other, 'gamma').status).toBe(200);
      expect(readGraphResult(repo, undefined, 'gamma').status).toBe(404);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('500s a disk that refuses the write', () => {
    // A FILE where the store wants its directory: mkdir fails, and that is a
    // server-side condition, not the caller's mistake.
    mkdirSync(join(repo, '.huu', 'dev'), { recursive: true });
    writeFileSync(join(repo, '.huu', 'dev', 'graphs'), 'not a directory', 'utf8');
    const result = put('alpha', graph('alpha'));
    expect(result.status).toBe(500);
    expect(errorOf(result)).toMatch(/^write-failed:/);
  });
});

describe('graph-api / delete', () => {
  it('deletes a saved graph and the next read 404s', () => {
    put('alpha', graph('alpha'));
    const result = deleteGraphResult(repo, undefined, 'alpha');
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(readGraphResult(repo, undefined, 'alpha').status).toBe(404);
  });

  it('404s a graph nobody saved instead of a silent 200', () => {
    const result = deleteGraphResult(repo, undefined, 'missing');
    expect(result.status).toBe(404);
    expect(errorOf(result)).toMatch(/^not-found:/);
  });

  it('400s a hostile id', () => {
    const result = deleteGraphResult(repo, undefined, '../../etc/passwd');
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-id:/);
  });

  it('500s when the entry cannot be unlinked', () => {
    mkdirSync(join(graphsDir(repo), 'weird.json'), { recursive: true });
    const result = deleteGraphResult(repo, undefined, 'weird');
    expect(result.status).toBe(500);
    expect(errorOf(result)).toMatch(/^delete-failed:/);
  });
});

describe('graph-api / validate', () => {
  it('answers 200 ok for a graph the rules are happy with', () => {
    const result = validateGraphResult({ graph: graph('alpha') as unknown as Record<string, unknown> });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.errors).toEqual([]);
  });

  it('answers 200 — never a transport error — for a graph full of mistakes', () => {
    const broken = {
      ...graph('alpha'),
      nodes: [] as GraphNode[],
    };
    const result = validateGraphResult({ graph: broken as unknown as Record<string, unknown> });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(false);
    const errors = result.body.errors as { code: string }[];
    expect(errors.map((e) => e.code)).toContain('no-prompt-node');
  });

  it('keeps the anchors the canvas highlights by', () => {
    const anchored = {
      ...graph('alpha'),
      nodes: [{ ...graph('alpha').nodes[0]!, id: 'NOT A SLUG' }],
    };
    const errors = validateGraphResult({
      graph: anchored as unknown as Record<string, unknown>,
    }).body.errors as { code: string; nodeId?: string }[];
    const issue = errors.find((e) => e.code === 'invalid-node-id');
    expect(issue?.nodeId).toBe('NOT A SLUG');
  });

  it('reports a payload that is not a graph as invalid-schema, still 200', () => {
    for (const raw of [undefined, null, 'a string', 7, []]) {
      const result = validateGraphResult({ graph: raw });
      expect(result.status).toBe(200);
      expect(result.body.ok).toBe(false);
      const errors = result.body.errors as { code: string }[];
      expect(errors[0]!.code).toBe('invalid-schema');
    }
  });

  it('never answers ok for a graph the store would refuse to save', () => {
    // The structural rules are happy (one prompt node, no edges) but the SHAPE
    // is wrong — the hole `parseDevGraph` closes.
    const wrongFormat = { ...graph('alpha'), _format: 'huu-devgraph-v0' };
    const result = validateGraphResult({
      graph: wrongFormat as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(false);
    const errors = result.body.errors as { code: string }[];
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('invalid-schema');
    // And the same graph really is unsaveable.
    expect(
      writeGraphResult(repo, 'alpha', { graph: wrongFormat as unknown as Record<string, unknown> })
        .status,
    ).toBe(400);
  });

  it('surfaces warnings without blocking — a relaxed join is a choice, not a defect', () => {
    const sample = findSample('tdd-seguranca-performance')!;
    const result = validateGraphResult({
      graph: sample.build(NOW) as unknown as Record<string, unknown>,
    });
    expect(result.body.ok).toBe(true);
    const warnings = result.body.warnings as { code: string }[];
    expect(warnings.map((w) => w.code)).toContain('join-subset-drops-barrier');
  });

  it('validates every shipped sample as ok', () => {
    for (const sample of GRAPH_SAMPLES) {
      const result = validateGraphResult({
        graph: sample.build(NOW) as unknown as Record<string, unknown>,
      });
      expect(result.status, sample.id).toBe(200);
      expect(result.body.ok, `${sample.id}: ${JSON.stringify(result.body.errors)}`).toBe(true);
    }
  });

  it('never throws, whatever the payload carries', () => {
    const hostile: unknown[] = [
      { nodes: null, edges: null },
      { nodes: [null, 7, 'x'], edges: [null] },
      { ...graph('alpha'), nodes: [{ kind: 'action' }] },
      { ...graph('alpha'), edges: [{ id: 'e1', source: 'nope', target: 'nope' }] },
      { ...graph('alpha'), meta: 'not an object' },
    ];
    for (const raw of hostile) {
      const result = validateGraphResult({ graph: raw });
      expect(result.status, JSON.stringify(raw)).toBe(200);
      expect(typeof result.body.ok).toBe('boolean');
    }
  });
});

describe('graph-api / compile', () => {
  const sampleGraph = (id: string): DevGraph => findSample(id)!.build(NOW);

  it('compiles a shipped sample into a pipeline', () => {
    const result = compileGraphResult({
      graph: sampleGraph('tdd-seguranca-performance') as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    const pipeline = result.body.pipeline as { name: string; steps: unknown[] };
    expect(pipeline.steps.length).toBeGreaterThan(0);
    expect(Array.isArray(result.body.nodeOrder)).toBe(true);
    expect((result.body.nodeOrder as string[]).length).toBeGreaterThan(0);
    expect(Object.keys(result.body.stepsByNode as Record<string, string[]>).length).toBeGreaterThan(0);
    expect(Array.isArray(result.body.warnings)).toBe(true);
  });

  it('compiles every shipped sample — the library is not a museum', () => {
    for (const sample of GRAPH_SAMPLES) {
      const result = compileGraphResult({
        graph: sample.build(NOW) as unknown as Record<string, unknown>,
      });
      expect(result.status, `${sample.id}: ${String(result.body.error)}`).toBe(200);
    }
  });

  it('turns the compiler’s contractual throw into a 400 carrying the issues', () => {
    // `compileGraphPipeline` THROWS on an invalid graph. The route must never
    // let that reach the caller as a bare 500.
    const invalid = { ...graph('alpha'), nodes: [] as GraphNode[] };
    const result = compileGraphResult({ graph: invalid as unknown as Record<string, unknown> });
    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(String(result.body.error)).toMatch(/does not compile/);
    const errors = result.body.errors as { code: string }[];
    expect(errors.map((e) => e.code)).toContain('no-prompt-node');
  });

  it('400s a payload that is not a graph', () => {
    for (const raw of [undefined, null, 'a string', 7, []]) {
      const result = compileGraphResult({ graph: raw });
      expect(result.status).toBe(400);
      expect(result.body.ok).toBe(false);
      expect(String(result.body.error)).toMatch(/^invalid-schema:/);
    }
  });

  it('400s a graph the schema refuses', () => {
    const result = compileGraphResult({
      graph: { ...graph('alpha'), _format: 'huu-devgraph-v0' } as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toMatch(/^invalid-schema:/);
  });

  it('is never a 500, whatever the graph carries', () => {
    const hostile: unknown[] = [
      {},
      { nodes: [], edges: [] },
      { ...graph('alpha'), nodes: [{ kind: 'action' }] },
      { ...graph('alpha'), edges: [{ id: 'e1', source: 'prompt-1', target: 'prompt-1' }] },
      sampleGraph('portao-de-qualidade'),
    ];
    for (const raw of hostile) {
      const result = compileGraphResult({ graph: raw });
      expect(result.status, JSON.stringify(raw).slice(0, 80)).toBeLessThan(500);
    }
  });

  it('namespaces the blackboard by the graph id when no session is named', () => {
    const result = compileGraphResult({
      graph: sampleGraph('pesquisa-booleana') as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body.pipeline)).toContain('.huu/dev/pesquisa-booleana/graph');
  });

  it('honors an explicit sessionId in the default blackboard root', () => {
    const result = compileGraphResult({
      graph: sampleGraph('pesquisa-booleana') as unknown as Record<string, unknown>,
      sessionId: 'sessao-7',
    });
    expect(JSON.stringify(result.body.pipeline)).toContain('.huu/dev/sessao-7/graph');
  });

  it('honors an explicit graphRoot over the default', () => {
    const result = compileGraphResult({
      graph: sampleGraph('pesquisa-booleana') as unknown as Record<string, unknown>,
      graphRoot: 'custom/blackboard',
    });
    expect(JSON.stringify(result.body.pipeline)).toContain('custom/blackboard');
    expect(JSON.stringify(result.body.pipeline)).not.toContain('.huu/dev/pesquisa-booleana/graph');
  });

  it('cannot be talked into climbing out of the repository with graphRoot', () => {
    const result = compileGraphResult({
      graph: sampleGraph('pesquisa-booleana') as unknown as Record<string, unknown>,
      graphRoot: '../../etc',
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body.pipeline)).not.toContain('../../etc');
  });

  it('injects the caller’s goal instead of the drawn one', () => {
    const result = compileGraphResult({
      graph: sampleGraph('pesquisa-booleana') as unknown as Record<string, unknown>,
      goal: 'Audit the authentication module for missing rate limits.',
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body.pipeline)).toContain('missing rate limits');
  });
});

describe('graph-api / from-sample', () => {
  it('builds and SAVES the sample, so the next read finds it', () => {
    const result = fromSampleResult(repo, { sampleId: 'recon-fanout' });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    const saved = result.body.graph as DevGraph;
    expect(saved.id).toBe('recon-fanout');
    expect(readGraphResult(repo, undefined, 'recon-fanout').status).toBe(200);
  });

  it('400s an unknown sampleId and names the ones that exist', () => {
    const result = fromSampleResult(repo, { sampleId: 'nope' });
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/unknown sample "nope"/);
    expect(errorOf(result)).toContain('recon-fanout');
  });

  it('400s a missing sampleId', () => {
    expect(fromSampleResult(repo, {}).status).toBe(400);
  });

  it('honors an id and a name override', () => {
    const result = fromSampleResult(repo, {
      sampleId: 'recon-fanout',
      id: 'meu-metodo',
      name: 'Meu método',
    });
    const saved = result.body.graph as DevGraph;
    expect(saved.id).toBe('meu-metodo');
    expect(saved.name).toBe('Meu método');
    expect(readGraphResult(repo, undefined, 'meu-metodo').status).toBe(200);
  });

  it('never overwrites a saved method — it suffixes instead', () => {
    const first = fromSampleResult(repo, { sampleId: 'recon-fanout' }).body.graph as DevGraph;
    const second = fromSampleResult(repo, { sampleId: 'recon-fanout' }).body.graph as DevGraph;
    const third = fromSampleResult(repo, { sampleId: 'recon-fanout' }).body.graph as DevGraph;
    expect(first.id).toBe('recon-fanout');
    expect(second.id).toBe('recon-fanout-2');
    expect(third.id).toBe('recon-fanout-3');
    // All three are on disk; nothing was destroyed.
    expect((listGraphsResult(repo, undefined).body.graphs as unknown[])).toHaveLength(3);
  });

  it('400s a hostile id override', () => {
    const result = fromSampleResult(repo, { sampleId: 'recon-fanout', id: '../escape' });
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-id:/);
  });

  it('400s a reserved id override', () => {
    const result = fromSampleResult(repo, { sampleId: 'recon-fanout', id: 'compile' });
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/reserved/);
  });

  it('saves into dir, not into the server cwd', () => {
    const other = mkdtempSync(join(tmpdir(), 'huu-graph-api-other-'));
    try {
      expect(fromSampleResult(repo, { sampleId: 'recon-fanout', dir: other }).status).toBe(200);
      expect(readGraphResult(repo, other, 'recon-fanout').status).toBe(200);
      expect(readGraphResult(repo, undefined, 'recon-fanout').status).toBe(404);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('500s when the disk refuses the write', () => {
    mkdirSync(join(repo, '.huu', 'dev'), { recursive: true });
    writeFileSync(join(repo, '.huu', 'dev', 'graphs'), 'not a directory', 'utf8');
    const result = fromSampleResult(repo, { sampleId: 'recon-fanout' });
    expect(result.status).toBe(500);
    expect(errorOf(result)).toMatch(/^write-failed:/);
  });

  it('lands a graph that validates and compiles', () => {
    const saved = fromSampleResult(repo, { sampleId: 'portao-de-qualidade' }).body.graph as DevGraph;
    expect(validateGraphResult({ graph: saved as unknown as Record<string, unknown> }).body.ok).toBe(
      true,
    );
    expect(
      compileGraphResult({ graph: saved as unknown as Record<string, unknown> }).status,
    ).toBe(200);
  });
});

describe('graph-api / routing', () => {
  it('routes the collection, with or without the trailing slash', () => {
    put('alpha', graph('alpha'));
    for (const path of ['/api/graphs', '/api/graphs/']) {
      const result = route('GET', path);
      expect(result.status, path).toBe(200);
      expect((result.body.graphs as unknown[]).length, path).toBe(1);
    }
  });

  it('passes dir through from the query string', () => {
    const other = mkdtempSync(join(tmpdir(), 'huu-graph-api-other-'));
    try {
      route('PUT', '/api/graphs/beta', '', {
        dir: other,
        graph: graph('beta') as unknown as Record<string, unknown>,
      });
      expect(route('GET', '/api/graphs', `dir=${other}`).body.graphs).toHaveLength(1);
      expect(route('GET', '/api/graphs').body.graphs).toHaveLength(0);
      expect(route('GET', '/api/graphs/beta', `dir=${other}`).status).toBe(200);
      expect(route('GET', '/api/graphs/beta').status).toBe(404);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('405s the collection for every verb but GET', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const result = route(method, '/api/graphs');
      expect(result.status, method).toBe(405);
      expect(errorOf(result), method).toContain('GET');
    }
  });

  it('routes the item verbs', () => {
    const written = route('PUT', '/api/graphs/alpha', '', {
      graph: graph('alpha') as unknown as Record<string, unknown>,
    });
    expect(written.status).toBe(200);
    expect(route('GET', '/api/graphs/alpha').status).toBe(200);
    expect(route('DELETE', '/api/graphs/alpha').status).toBe(200);
    expect(route('GET', '/api/graphs/alpha').status).toBe(404);
  });

  it('405s an item verb nobody implements', () => {
    const result = route('PATCH', '/api/graphs/alpha');
    expect(result.status).toBe(405);
    expect(errorOf(result)).toContain('GET, PUT or DELETE');
  });

  it('matches the reserved segments BEFORE the :id route', () => {
    expect(route('GET', '/api/graphs/catalog').status).toBe(200);
    expect(route('POST', '/api/graphs/validate', '', { graph: graph('a') as unknown as Record<string, unknown> }).status).toBe(200);
    expect(route('POST', '/api/graphs/compile', '', { graph: graph('a') as unknown as Record<string, unknown> }).body.ok).toBeDefined();
    expect(route('POST', '/api/graphs/from-sample', '', { sampleId: 'recon-fanout' }).status).toBe(200);
  });

  it('405s a write against a reserved segment — it is a route, never a graph', () => {
    for (const [method, segment] of [
      ['PUT', 'catalog'],
      ['DELETE', 'catalog'],
      ['GET', 'validate'],
      ['PUT', 'validate'],
      ['GET', 'compile'],
      ['GET', 'from-sample'],
      ['DELETE', 'from-sample'],
    ] as const) {
      const result = route(method, `/api/graphs/${segment}`);
      expect(result.status, `${method} ${segment}`).toBe(405);
    }
    // …and nothing named after a route was ever written.
    expect(listGraphsResult(repo, undefined).body.graphs).toEqual([]);
  });

  it('404s a nested path instead of feeding a slash to the id route', () => {
    const result = route('GET', '/api/graphs/a/b');
    expect(result.status).toBe(404);
  });

  it('404s a path outside the namespace', () => {
    expect(route('GET', '/api/dev').status).toBe(404);
  });

  it('400s a percent-escaped traversal — decoded, then refused as an id', () => {
    const result = route('GET', '/api/graphs/..%2Fetc');
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-id:/);
  });

  it('400s a malformed percent-escape instead of throwing', () => {
    const result = route('GET', '/api/graphs/%E0%A4%A');
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatch(/^invalid-id:/);
  });

  it('decodes a legal escape back into a slug', () => {
    put('my-graph', graph('my-graph'));
    expect(route('GET', '/api/graphs/my%2Dgraph').status).toBe(200);
  });

  it('never lets a route write outside the graph directory', () => {
    // The whole traversal corpus, through the front door.
    for (const hostile of ['..%2F..%2Fetc%2Fpasswd', '%2E%2E', 'UPPER', 'a%20b']) {
      const result = route('PUT', `/api/graphs/${hostile}`, '', {
        graph: graph('alpha') as unknown as Record<string, unknown>,
      });
      expect(result.status, hostile).toBe(400);
    }
    expect(graphPath(repo, 'alpha').startsWith(graphsDir(repo))).toBe(true);
  });
});
