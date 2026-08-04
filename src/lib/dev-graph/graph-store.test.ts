import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEV_MODE_DIR } from '../types/dev-mode.js';
import { emptyDevGraph, serializeDevGraph } from './graph-schema.js';
import { DEVGRAPH_SLUG_PATTERN, type DevGraph, type PromptNode } from './graph-types.js';
import {
  GRAPHS_DIR,
  deleteGraph,
  graphPath,
  graphsDir,
  listGraphs,
  readGraph,
  writeGraph,
} from './graph-store.js';

const NOW = '2026-08-03T12:00:00.000Z';

/** A REAL directory tree per test — this repo does not mock the filesystem. */
let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'huu-graph-store-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function graph(id: string, name = `Graph ${id}`, now = NOW): DevGraph {
  return emptyDevGraph(id, name, now);
}

/** Write a raw file straight into the graph directory, bypassing the store. */
function seedRaw(fileName: string, contents: string): string {
  mkdirSync(graphsDir(repoRoot), { recursive: true });
  const path = join(graphsDir(repoRoot), fileName);
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('graph-store / paths', () => {
  it('stores graphs inside the dev blackboard, never in pipelines/', () => {
    // Pinned literally: the gate's validate-graph step parses every
    // `pipelines/*.pipeline.json`, so a graph there would break CI.
    expect(GRAPHS_DIR).toBe('.huu/dev/graphs');
    expect(GRAPHS_DIR.startsWith(`${DEV_MODE_DIR}/`)).toBe(true);
  });

  it('resolves the graph directory under the repo root', () => {
    expect(graphsDir('/repo')).toBe(join('/repo', '.huu/dev/graphs'));
  });

  it('names a graph file after its own id', () => {
    expect(graphPath('/repo', 'my-graph')).toBe(join('/repo', '.huu/dev/graphs', 'my-graph.json'));
  });

  it('throws instead of returning a path that escapes the graph directory', () => {
    expect(() => graphPath('/repo', '../../etc/passwd')).toThrow(TypeError);
  });

  it('throws on ids that are not slugs', () => {
    for (const bad of ['', 'Upper', 'has space', 'a/b', 'a.b', '-leading', 'a'.repeat(41)]) {
      expect(() => graphPath('/repo', bad), bad).toThrow(TypeError);
    }
  });

  it('accepts exactly what DEVGRAPH_SLUG_PATTERN accepts, no more and no less', () => {
    // The pattern is the authority — a trailing dash is legal there, so it is
    // legal here too. This test exists so the store can never grow its own,
    // second opinion about what an id is.
    for (const id of ['a', '9', 'my-graph', 'trailing-', 'a'.repeat(40)]) {
      expect(DEVGRAPH_SLUG_PATTERN.test(id), id).toBe(true);
      expect(() => graphPath('/repo', id), id).not.toThrow();
    }
  });
});

describe('graph-store / writeGraph', () => {
  it('creates the directory tree and saves the graph', () => {
    const result = writeGraph(repoRoot, graph('alpha'), NOW);
    expect(result.ok).toBe(true);
    expect(existsSync(graphPath(repoRoot, 'alpha'))).toBe(true);
  });

  it('writes exactly what serializeDevGraph produces, byte for byte', () => {
    const saved = writeGraph(repoRoot, graph('alpha'), NOW);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(readFileSync(graphPath(repoRoot, 'alpha'), 'utf8')).toBe(serializeDevGraph(saved.graph));
  });

  it('stamps updatedAt from `now` and leaves createdAt alone', () => {
    const later = '2026-09-01T00:00:00.000Z';
    const result = writeGraph(repoRoot, graph('alpha'), later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.updatedAt).toBe(later);
    expect(result.graph.createdAt).toBe(NOW);
  });

  it('falls back to the clock when `now` is omitted', () => {
    const before = Date.now();
    const result = writeGraph(repoRoot, graph('alpha'));
    const after = Date.now();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stamped = Date.parse(result.graph.updatedAt);
    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(after + 1000);
  });

  it('returns the graph that actually reached the disk', () => {
    const result = writeGraph(repoRoot, graph('alpha'), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reloaded = readGraph(repoRoot, 'alpha');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.graph).toEqual(result.graph);
  });

  it('upserts in place instead of accumulating files', () => {
    writeGraph(repoRoot, graph('alpha', 'First'), NOW);
    writeGraph(repoRoot, graph('alpha', 'Second'), NOW);
    expect(readdirSync(graphsDir(repoRoot))).toEqual(['alpha.json']);
    const reloaded = readGraph(repoRoot, 'alpha');
    expect(reloaded.ok && reloaded.graph.name).toBe('Second');
  });

  it('leaves no staging file behind', () => {
    writeGraph(repoRoot, graph('alpha'), NOW);
    expect(readdirSync(graphsDir(repoRoot)).filter((f) => f.includes('.huu.tmp'))).toEqual([]);
  });

  it('refuses a traversal id as DATA and writes nothing anywhere', () => {
    const hostile = { ...graph('alpha'), id: '../../evil' } as DevGraph;
    const result = writeGraph(repoRoot, hostile, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.startsWith('invalid-id:')).toBe(true);
    expect(existsSync(join(repoRoot, '.huu'))).toBe(false);
    expect(existsSync(join(repoRoot, 'evil.json'))).toBe(false);
  });

  it('refuses an id that is not a slug', () => {
    const result = writeGraph(repoRoot, { ...graph('alpha'), id: 'Not A Slug' } as DevGraph, NOW);
    expect(result.ok === false && result.reason.startsWith('invalid-id:')).toBe(true);
  });

  it('refuses a payload that is not a devgraph at all', () => {
    const result = writeGraph(repoRoot, { id: 'alpha' } as unknown as DevGraph, NOW);
    expect(result.ok === false && result.reason.startsWith('invalid-schema:')).toBe(true);
    expect(existsSync(graphsDir(repoRoot))).toBe(false);
  });

  it('refuses a non-object payload without throwing', () => {
    for (const bad of [null, undefined, 42, 'graph', []]) {
      const result = writeGraph(repoRoot, bad as unknown as DevGraph, NOW);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('SAVES a graph that fails validateGraph — half-drawn work must survive', () => {
    // Two prompt nodes: schema-valid, rule-invalid. The editor validates on
    // every keystroke; a store that refused this would lose the drawing.
    const half = graph('alpha');
    const second: PromptNode = {
      id: 'prompt-2',
      kind: 'prompt',
      label: 'Segunda entrada',
      position: { x: 100, y: 100 },
      goal: 'rascunho',
    };
    half.nodes.push(second);
    const result = writeGraph(repoRoot, half, NOW);
    expect(result.ok).toBe(true);
    expect(readGraph(repoRoot, 'alpha').ok).toBe(true);
    expect(listGraphs(repoRoot)[0]?.valid).toBe(false);
  });

  it('reports a filesystem failure as data instead of throwing', () => {
    // A DIRECTORY sitting where the file belongs: rename cannot replace it.
    mkdirSync(join(graphsDir(repoRoot), 'blocked.json'), { recursive: true });
    const result = writeGraph(repoRoot, graph('blocked'), NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.startsWith('write-failed:')).toBe(true);
    expect(readdirSync(graphsDir(repoRoot)).filter((f) => f.includes('.huu.tmp'))).toEqual([]);
  });
});

describe('graph-store / readGraph', () => {
  it('round-trips a saved graph', () => {
    const original = graph('alpha', 'Meu método');
    writeGraph(repoRoot, original, NOW);
    const result = readGraph(repoRoot, 'alpha');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph).toEqual(original);
  });

  it('reports a missing graph as not-found', () => {
    const result = readGraph(repoRoot, 'nope');
    expect(result.ok === false && result.reason.startsWith('not-found:')).toBe(true);
  });

  it('refuses a traversal id and never reads outside the graph directory', () => {
    const decoy = join(repoRoot, 'decoy.json');
    writeFileSync(decoy, serializeDevGraph(graph('decoy')), 'utf8');
    for (const hostile of ['../decoy', '../../decoy', '/etc/passwd', './decoy']) {
      const result = readGraph(repoRoot, hostile);
      expect(result.ok, hostile).toBe(false);
      expect(result.ok === false && result.reason.startsWith('invalid-id:'), hostile).toBe(true);
    }
    expect(existsSync(decoy)).toBe(true);
  });

  it('reports a truncated file as invalid-json', () => {
    seedRaw('alpha.json', '{"_format": "huu-devgraph-v1"');
    const result = readGraph(repoRoot, 'alpha');
    expect(result.ok === false && result.reason.startsWith('invalid-json:')).toBe(true);
  });

  it('reports a well-formed JSON that is not a devgraph as invalid-schema', () => {
    seedRaw('alpha.json', JSON.stringify({ hello: true }));
    const result = readGraph(repoRoot, 'alpha');
    expect(result.ok === false && result.reason.startsWith('invalid-schema:')).toBe(true);
  });

  it('refuses a file whose contents disagree with its name', () => {
    seedRaw('alpha.json', serializeDevGraph(graph('beta')));
    const result = readGraph(repoRoot, 'alpha');
    expect(result.ok === false && result.reason.startsWith('id-mismatch:')).toBe(true);
  });

  it('reports a directory in the file slot as read-failed', () => {
    mkdirSync(join(graphsDir(repoRoot), 'alpha.json'), { recursive: true });
    const result = readGraph(repoRoot, 'alpha');
    expect(result.ok === false && result.reason.startsWith('read-failed:')).toBe(true);
  });
});

describe('graph-store / listGraphs', () => {
  it('returns [] when nothing was ever saved', () => {
    expect(listGraphs(repoRoot)).toEqual([]);
  });

  it('returns [] when the repo root itself does not exist', () => {
    expect(listGraphs(join(repoRoot, 'gone'))).toEqual([]);
  });

  it('summarizes a saved graph with its counts and validity', () => {
    const g = graph('alpha', 'Meu método');
    g.description = 'Uma descrição';
    writeGraph(repoRoot, g, NOW);
    expect(listGraphs(repoRoot)).toEqual([
      {
        id: 'alpha',
        name: 'Meu método',
        description: 'Uma descrição',
        updatedAt: NOW,
        nodeCount: 1,
        edgeCount: 0,
        valid: true,
      },
    ]);
  });

  it('omits description entirely when the graph has none', () => {
    writeGraph(repoRoot, graph('alpha'), NOW);
    expect(Object.keys(listGraphs(repoRoot)[0] ?? {})).not.toContain('description');
  });

  it('orders by updatedAt descending, then by id', () => {
    writeGraph(repoRoot, graph('old'), '2026-01-01T00:00:00.000Z');
    writeGraph(repoRoot, graph('new'), '2026-06-01T00:00:00.000Z');
    writeGraph(repoRoot, graph('beta'), '2026-03-01T00:00:00.000Z');
    writeGraph(repoRoot, graph('alpha'), '2026-03-01T00:00:00.000Z');
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['new', 'alpha', 'beta', 'old']);
  });

  it('lists a graph that breaks a product rule, flagged invalid', () => {
    const half = graph('alpha');
    half.edges.push({ id: 'e-1', source: 'prompt-1', target: 'ghost' });
    writeGraph(repoRoot, half, NOW);
    const rows = listGraphs(repoRoot);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.valid).toBe(false);
    expect(rows[0]?.edgeCount).toBe(1);
  });

  it('survives a corrupt file next to a good one', () => {
    writeGraph(repoRoot, graph('good'), NOW);
    seedRaw('broken.json', '{ not json at all');
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['good']);
  });

  it('skips a .json that is some other format', () => {
    writeGraph(repoRoot, graph('good'), NOW);
    seedRaw('other.json', JSON.stringify({ _format: 'huu-pipeline-v2', steps: [] }));
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['good']);
  });

  it('ignores files that are not .json', () => {
    writeGraph(repoRoot, graph('good'), NOW);
    seedRaw('notes.md', '# rascunho');
    seedRaw('alpha.json.1234-abcd.huu.tmp', serializeDevGraph(graph('alpha')));
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['good']);
  });

  it('skips a file whose name is not a readable id', () => {
    seedRaw('Weird Name.json', serializeDevGraph(graph('weird')));
    expect(listGraphs(repoRoot)).toEqual([]);
  });

  it('skips a file whose name does not address the graph inside it', () => {
    seedRaw('alpha.json', serializeDevGraph(graph('beta')));
    expect(listGraphs(repoRoot)).toEqual([]);
  });

  it('skips a directory that happens to end in .json', () => {
    writeGraph(repoRoot, graph('good'), NOW);
    mkdirSync(join(graphsDir(repoRoot), 'trap.json'), { recursive: true });
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['good']);
  });

  it('lists exactly what readGraph can open', () => {
    writeGraph(repoRoot, graph('good'), NOW);
    seedRaw('broken.json', '{');
    seedRaw('alpha.json', serializeDevGraph(graph('beta')));
    for (const row of listGraphs(repoRoot)) {
      expect(readGraph(repoRoot, row.id).ok, row.id).toBe(true);
    }
  });
});

describe('graph-store / deleteGraph', () => {
  it('removes a saved graph', () => {
    writeGraph(repoRoot, graph('alpha'), NOW);
    expect(deleteGraph(repoRoot, 'alpha')).toEqual({ ok: true });
    expect(existsSync(graphPath(repoRoot, 'alpha'))).toBe(false);
    expect(listGraphs(repoRoot)).toEqual([]);
  });

  it('distinguishes "deleted nothing" from "deleted it"', () => {
    const result = deleteGraph(repoRoot, 'nope');
    expect(result.ok).toBe(false);
    expect(result.reason?.startsWith('not-found:')).toBe(true);
  });

  it('refuses a traversal id and leaves the outside file alone', () => {
    const decoy = join(repoRoot, 'decoy.json');
    writeFileSync(decoy, 'keep me', 'utf8');
    const result = deleteGraph(repoRoot, '../decoy');
    expect(result.ok).toBe(false);
    expect(result.reason?.startsWith('invalid-id:')).toBe(true);
    expect(existsSync(decoy)).toBe(true);
  });

  it('reports a filesystem refusal as data instead of throwing', () => {
    mkdirSync(join(graphsDir(repoRoot), 'alpha.json'), { recursive: true });
    const result = deleteGraph(repoRoot, 'alpha');
    expect(result.ok).toBe(false);
    expect(result.reason?.startsWith('delete-failed:')).toBe(true);
  });

  it('leaves the other graphs untouched', () => {
    writeGraph(repoRoot, graph('alpha'), NOW);
    writeGraph(repoRoot, graph('beta'), NOW);
    deleteGraph(repoRoot, 'alpha');
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['beta']);
  });
});
