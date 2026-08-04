import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
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

  it('drops a `now` that is not an ISO instant and stamps the clock instead', () => {
    // `now` is an INTERNAL parameter, so a bad one is a caller bug — and
    // refusing the write would turn that bug into the human losing their
    // drawing. The stamp is dropped, the work is saved.
    for (const bad of ['not-a-date', 'undefined', '', '2026', 'August 3, 2026', '  ']) {
      const before = Date.now();
      const result = writeGraph(repoRoot, graph('alpha'), bad);
      const after = Date.now();
      expect(result.ok, JSON.stringify(bad)).toBe(true);
      if (!result.ok) return;
      expect(result.graph.updatedAt, JSON.stringify(bad)).not.toBe(bad);
      const stamped = Date.parse(result.graph.updatedAt);
      expect(stamped, JSON.stringify(bad)).toBeGreaterThanOrEqual(before - 1000);
      expect(stamped, JSON.stringify(bad)).toBeLessThanOrEqual(after + 1000);
      // And the value that reached the DISK is the one that came back.
      const reloaded = readGraph(repoRoot, 'alpha');
      expect(reloaded.ok && reloaded.graph.updatedAt, JSON.stringify(bad)).toBe(
        result.graph.updatedAt,
      );
    }
  });

  it('keeps a rejected timestamp from poisoning the list order forever', () => {
    // The consequence the validation exists for: `listGraphs` orders by
    // `updatedAt.localeCompare`, and "undefined" sorts ABOVE every ISO string
    // ("u" > "2"), so one bad stamp would pin that graph to the top of the
    // picker for good. A clock stamp cannot outrank a graph saved in 2099.
    writeGraph(repoRoot, graph('poisoned'), 'undefined');
    writeGraph(repoRoot, graph('real'), '2099-01-01T00:00:00.000Z');
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['real', 'poisoned']);
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

describe('graph-store / writeGraph is atomic', () => {
  // THE GUARD FOR THE MODULE'S CENTRAL ARGUMENT. `writeGraph`'s doc spends a
  // paragraph on tmp + rename, and until this block existed the whole suite
  // stayed green with the mechanism deleted (`writeFileSync` straight onto the
  // target) — including "leaves no staging file behind", which is vacuously
  // true when no staging file is ever created.
  //
  // Both assertions below observe the OBSERVABLE consequence of rename rather
  // than the implementation: rename SWAPS IN a new inode, a truncating write
  // reuses the old one. No timing, no watcher, no seam.

  it('swaps in a new inode instead of truncating the file that is already there', () => {
    // Truncate-then-write is exactly the window the doc refuses to accept: a
    // crash between the two leaves the human's method as an empty file. Under
    // rename, the target's inode is never the one that was being written into.
    writeGraph(repoRoot, graph('alpha', 'First'), NOW);
    const path = graphPath(repoRoot, 'alpha');
    const firstInode = statSync(path).ino;
    writeGraph(repoRoot, graph('alpha', 'Second'), NOW);
    expect(statSync(path).ino).not.toBe(firstInode);
    expect(readGraph(repoRoot, 'alpha').ok && readGraph(repoRoot, 'alpha')).toMatchObject({
      graph: { name: 'Second' },
    });
  });

  it('never shows a concurrent reader a half-written graph', () => {
    // A reader that opened the file BEFORE the save (the HTTP handler serving
    // the list while the editor autosaves) keeps reading the COMPLETE previous
    // version through its descriptor: rename unlinks the old inode, it does not
    // rewrite it. With a truncating write the same descriptor would follow the
    // save into whatever bytes are there at that instant.
    writeGraph(repoRoot, graph('alpha', 'First'), NOW);
    const path = graphPath(repoRoot, 'alpha');
    const previous = readFileSync(path, 'utf8');
    const reader = openSync(path, 'r');
    try {
      writeGraph(repoRoot, graph('alpha', 'Second'), NOW);
      const buffer = Buffer.alloc(previous.length * 4);
      const read = readSync(reader, buffer, 0, buffer.length, 0);
      expect(buffer.subarray(0, read).toString('utf8')).toBe(previous);
    } finally {
      closeSync(reader);
    }
    expect(readFileSync(path, 'utf8')).toContain('Second');
  });

  it.runIf(process.platform === 'linux')(
    'stages inside the graph directory, where rename is atomic',
    async () => {
      // The OTHER half of the doc's claim: the staging file lives in the SAME
      // directory, because `rename` is only atomic within one filesystem — a
      // tmp in the OS temp dir would be an EXDEV failure on any machine whose
      // repo is on a separate mount. inotify buffers events in the KERNEL, so
      // a watcher started here still sees the names the synchronous write
      // created and removed while the event loop was blocked. Linux only: the
      // macOS/Windows backends do not promise per-name events.
      mkdirSync(graphsDir(repoRoot), { recursive: true });
      const seen: string[] = [];
      const watcher = watch(graphsDir(repoRoot), (_event, name) => {
        if (name) seen.push(name);
      });
      try {
        writeGraph(repoRoot, graph('alpha'), NOW);
        await new Promise((resolve) => setTimeout(resolve, 200));
      } finally {
        watcher.close();
      }
      expect(seen.some((name) => name.includes('.huu.tmp'))).toBe(true);
      expect(seen).toContain('alpha.json');
      // …and it is gone again by the time the call returns.
      expect(readdirSync(graphsDir(repoRoot))).toEqual(['alpha.json']);
    },
  );
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

describe('graph-store / entries that are not regular files', () => {
  // THE THIRD OUTCOME the module header does not name. "Never throws" and
  // "one bad file never costs the others" both assume the reader RETURNS:
  // `readFileSync` on a FIFO with no writer never does, and on a character
  // device it may never stop. Both entry points are SYNCHRONOUS inside an HTTP
  // handler and a TUI render, so one such name in the directory freezes the
  // whole node event loop — every concurrent run's SSE stream with it.
  //
  // IF ONE OF THESE TESTS EVER HANGS INSTEAD OF FAILING, that IS the
  // regression: the guard that answers before opening the path is gone.

  function makeFifo(name: string): void {
    mkdirSync(graphsDir(repoRoot), { recursive: true });
    execFileSync('mkfifo', [join(graphsDir(repoRoot), name)]);
  }

  it('refuses a FIFO instead of blocking on it forever', () => {
    makeFifo('fifo.json');
    const started = Date.now();
    const result = readGraph(repoRoot, 'fifo');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.startsWith('read-failed:')).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('skips a FIFO while listing, and still lists the graphs next to it', () => {
    writeGraph(repoRoot, graph('good'), NOW);
    makeFifo('fifo.json');
    const started = Date.now();
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['good']);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses a symlink, even one pointing at a perfectly good graph', () => {
    // `lstat`, not `stat`: a symlink is the one way a name INSIDE the graph
    // directory can still address bytes outside it, and this module refuses
    // that in id form already.
    const outside = join(repoRoot, 'outside.json');
    writeFileSync(outside, serializeDevGraph(graph('linked')), 'utf8');
    mkdirSync(graphsDir(repoRoot), { recursive: true });
    symlinkSync(outside, join(graphsDir(repoRoot), 'linked.json'));
    const result = readGraph(repoRoot, 'linked');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.startsWith('read-failed:')).toBe(true);
    expect(listGraphs(repoRoot)).toEqual([]);
  });

  it('refuses a broken symlink as read-failed, not as a missing graph', () => {
    // It is not absent — something IS there. Saying "not-found" would invite a
    // caller to create a graph whose write lands wherever the link points.
    mkdirSync(graphsDir(repoRoot), { recursive: true });
    symlinkSync(join(repoRoot, 'nowhere.json'), join(graphsDir(repoRoot), 'dangling.json'));
    const result = readGraph(repoRoot, 'dangling');
    expect(result.ok === false && result.reason.startsWith('read-failed:')).toBe(true);
  });

  it('refuses a character device instead of reading it until memory runs out', () => {
    // `mknod` needs root, so the device is reached through a link — which is
    // exactly how one would appear in a checked-out tree anyway.
    mkdirSync(graphsDir(repoRoot), { recursive: true });
    symlinkSync('/dev/zero', join(graphsDir(repoRoot), 'zero.json'));
    const started = Date.now();
    const result = readGraph(repoRoot, 'zero');
    expect(result.ok === false && result.reason.startsWith('read-failed:')).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('lists the good graphs with a FIFO, a link and a directory all in the way', () => {
    writeGraph(repoRoot, graph('good'), NOW);
    makeFifo('fifo.json');
    symlinkSync('/dev/zero', join(graphsDir(repoRoot), 'zero.json'));
    mkdirSync(join(graphsDir(repoRoot), 'trap.json'), { recursive: true });
    const started = Date.now();
    expect(listGraphs(repoRoot).map((row) => row.id)).toEqual(['good']);
    expect(Date.now() - started).toBeLessThan(2000);
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

  it('skips a file whose name is not a readable id — at BOTH locks', () => {
    // DEFENSE IN DEPTH, said out loud. `listGraphs` filters the stem and
    // `readGraph` re-checks it, so removing EITHER guard alone leaves the
    // other holding the door: no black-box test can kill one in isolation,
    // and pretending otherwise is what made the old single-name version of
    // this test tautological. What IS pinned here is that both locks answer
    // the same way for the same name, which is the property that makes losing
    // one of them survivable.
    for (const stem of ['Weird Name', 'UPPER', 'dot.ted', '', 'a'.repeat(41)]) {
      const path = seedRaw(`${stem}.json`, serializeDevGraph(graph('weird')));
      expect(listGraphs(repoRoot), stem).toEqual([]);
      const direct = readGraph(repoRoot, stem);
      expect(direct.ok === false && direct.reason.startsWith('invalid-id:'), stem).toBe(true);
      rmSync(path, { force: true });
    }
  });

  it('lists every stem the slug pattern accepts — the filter is the pattern, not a second opinion', () => {
    // The direction a test CAN kill: a listing guard that grows stricter than
    // `DEVGRAPH_SLUG_PATTERN` (a minimum length, a required leading letter, no
    // trailing dash) would hide saved work from the picker while `readGraph`
    // still opens it happily — a graph that exists and cannot be found.
    const ids = ['a', '9', 'trailing-', 'my-graph', 'a'.repeat(40)];
    for (const id of ids) writeGraph(repoRoot, graph(id), NOW);
    expect(listGraphs(repoRoot).map((row) => row.id).sort()).toEqual([...ids].sort());
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
