// Contract tests for `huu graph` — the terminal half of the drawn method.
//
// Two halves, mirroring the module:
//
//   PARSE   `parseGraphCliArgs` is pure, so every subcommand, every flag and
//           every refusal is provable with no repository at all. That purity is
//           the thing being pinned as much as the behavior: a parser that grew
//           a `readGraph` call would still pass its happy paths and stop being
//           testable this way.
//   RUN     `runGraphCli` against a REAL directory tree in `mkdtemp` — real
//           files, real JSON, the real store. Nothing here is mocked: the store
//           IS the product surface, and a mocked one would prove nothing about
//           `show` finding what `new` wrote.
//
// The one contract that gets its own test is the compiler's: `compileGraphPipeline`
// THROWS on an invalid graph by design, so `huu graph compile` has to validate
// first — an exception reaching the user as a stack trace is the failure mode.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GRAPH_SUBCOMMANDS,
  GRAPH_USAGE,
  graphCliRoot,
  parseGraphCliArgs,
  renderGraphTopology,
  renderGraphValidation,
  runGraphCli,
} from './graph-cli.js';
import { GRAPHS_DIR, readGraph } from './dev-graph/graph-store.js';
import { GRAPH_SAMPLES } from './dev-graph/graph-samples.js';
import { parseDevGraph } from './dev-graph/graph-schema.js';
import { PipelineSchema } from './pipeline-io.js';
import type { DevGraph } from './dev-graph/graph-types.js';

/** `parseGraphCliArgs` or a thrown assertion — keeps the happy path unindented. */
function parseOk(args: string[]) {
  const parsed = parseGraphCliArgs(args);
  if (!parsed.ok) throw new Error(`expected a parse, got refusal: ${parsed.message}`);
  return parsed.options;
}

function parseFail(args: string[]): string {
  const parsed = parseGraphCliArgs(args);
  if (parsed.ok) throw new Error(`expected a refusal, got a parse of ${JSON.stringify(parsed.options.command)}`);
  return parsed.message;
}

const STAMP = '2026-08-03T00:00:00.000Z';

/**
 * A hand-drawn method that exercises everything the renderer has to say:
 * a fan of two, a SUBSET join that drops one of them, a gate with two arms, a
 * default arm and a REWORK arm that goes back to work that already ran.
 */
function fixtureGraph(id = 'fixture'): DevGraph {
  return {
    _format: 'huu-devgraph-v1',
    id,
    name: 'Fixture',
    description: 'Um desenho de teste.',
    createdAt: STAMP,
    updatedAt: STAMP,
    meta: {},
    nodes: [
      { id: 'entrada', kind: 'prompt', label: 'Entrada', position: { x: 0, y: 0 }, goal: 'Objetivo do teste.' },
      { id: 'a', kind: 'action', label: 'A', position: { x: 1, y: 0 }, block: 'implement', join: { mode: 'all' } },
      { id: 'b', kind: 'action', label: 'B', position: { x: 1, y: 1 }, block: 'docs', join: { mode: 'all' } },
      {
        id: 'c',
        kind: 'action',
        label: 'C',
        position: { x: 2, y: 0 },
        block: 'consolidate',
        join: { mode: 'subset', of: ['a'] },
      },
      {
        id: 'portao',
        kind: 'gate',
        label: 'Passou?',
        position: { x: 3, y: 0 },
        condition: 'A suíte de testes do projeto sai com código zero neste worktree.',
        outcomes: [
          { id: 'aprovado', label: 'Aprovado' },
          { id: 'reprovado', label: 'Reprovado' },
        ],
        defaultOutcome: 'aprovado',
        maxRuns: 3,
        join: { mode: 'all' },
      },
      { id: 'fim', kind: 'action', label: 'Fim', position: { x: 4, y: 0 }, block: 'docs', join: { mode: 'all' } },
    ],
    edges: [
      { id: 'e-1', source: 'entrada', target: 'a' },
      { id: 'e-2', source: 'entrada', target: 'b' },
      { id: 'e-3', source: 'a', target: 'c' },
      { id: 'e-4', source: 'b', target: 'c' },
      { id: 'e-5', source: 'c', target: 'portao' },
      { id: 'e-6', source: 'portao', target: 'fim', sourceOutcome: 'aprovado' },
      { id: 'e-7', source: 'portao', target: 'a', sourceOutcome: 'reprovado', rework: true },
    ],
  };
}

/**
 * A drawing that PARSES but breaks a product rule (`unknown-block`) — the state
 * the store deliberately allows on disk, because the editor saves half-drawn
 * work. Everything downstream has to survive it as data.
 */
function brokenGraph(id = 'quebrado'): DevGraph {
  const graph = fixtureGraph(id);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === 'a' ? { ...node, block: 'bloco-que-nao-existe' } : node)),
  };
}

describe('parseGraphCliArgs — the command surface', () => {
  it('answers a bare `huu graph` with the usage block', () => {
    const message = parseFail([]);
    expect(message).toBe(GRAPH_USAGE);
    for (const sub of GRAPH_SUBCOMMANDS) expect(message).toContain(sub);
  });

  it('refuses an unknown subcommand and names every valid one', () => {
    const message = parseFail(['desenhar']);
    expect(message).toContain('subcomando desconhecido "desenhar"');
    for (const sub of GRAPH_SUBCOMMANDS) expect(message).toContain(sub);
  });

  it('documents the portable-artifact promise of a written pipeline in the usage', () => {
    // The whole reason `compile --out` exists: the file it writes is runnable by
    // `huu auto`, with no dev mode involved. A user who cannot learn that from
    // --help has a feature they will never reach.
    expect(GRAPH_USAGE).toContain('huu auto');
    expect(GRAPH_USAGE).toContain('PORTÁTIL');
  });

  it('parses `list`', () => {
    expect(parseOk(['list']).command).toEqual({ kind: 'list' });
  });

  it('refuses a positional after a subcommand that takes none', () => {
    expect(parseFail(['list', 'algo'])).toContain('argumento inesperado "algo"');
  });

  it('parses every id-taking subcommand', () => {
    expect(parseOk(['show', 'auditoria']).command).toEqual({ kind: 'show', id: 'auditoria' });
    expect(parseOk(['validate', 'auditoria']).command).toEqual({ kind: 'validate', id: 'auditoria' });
    expect(parseOk(['rm', 'auditoria']).command).toEqual({ kind: 'rm', id: 'auditoria' });
  });

  it('refuses a missing id on every subcommand that addresses one graph', () => {
    for (const sub of ['show', 'validate', 'compile', 'new', 'rm']) {
      expect(parseFail([sub]), sub).toContain('falta o id do desenho');
    }
  });

  it('refuses an id that is not a slug — including a path traversal', () => {
    // The store throws a TypeError on a non-slug id (it becomes a path segment),
    // so the parser is the layer that has to turn that into a refusal a human
    // can read. `../../etc/passwd` must never reach `graphPath`.
    for (const bad of ['../../etc/passwd', 'Auditoria', 'com espaco', 'a'.repeat(41), 'ponto.json']) {
      expect(parseFail(['show', bad]), bad).toContain('não é um id válido');
    }
  });

  it('refuses an extra positional after the id', () => {
    expect(parseFail(['show', 'auditoria', 'demais'])).toContain('argumento inesperado "demais"');
  });

  it('reads --out in both spellings, and leaves it absent when not given', () => {
    expect(parseOk(['compile', 'x', '--out=p.json']).command).toEqual({ kind: 'compile', id: 'x', out: 'p.json' });
    expect(parseOk(['compile', 'x', '--out', 'p.json']).command).toEqual({ kind: 'compile', id: 'x', out: 'p.json' });
    // Not `out: undefined` under the key — NO key, so "no file" is a shape, not
    // a value the runner has to re-check.
    expect(parseOk(['compile', 'x']).command).not.toHaveProperty('out');
  });

  it('refuses an empty --out instead of compiling to nowhere', () => {
    expect(parseFail(['compile', 'x', '--out='])).toContain('--out=<arquivo> espera um caminho');
  });

  it('reads --from, --name and --force on `new`', () => {
    expect(parseOk(['new', 'meu', '--from=recon-fanout']).command).toEqual({
      kind: 'new',
      id: 'meu',
      force: false,
      from: 'recon-fanout',
    });
    expect(parseOk(['new', 'meu', '--from', 'recon-fanout', '--name', 'Meu método', '--force']).command).toEqual({
      kind: 'new',
      id: 'meu',
      force: true,
      from: 'recon-fanout',
      name: 'Meu método',
    });
  });

  it('leaves `new` at its minimal shape with no flags at all', () => {
    const command = parseOk(['new', 'meu']).command;
    expect(command).toEqual({ kind: 'new', id: 'meu', force: false });
  });

  it('refuses an empty --from and an empty --name', () => {
    expect(parseFail(['new', 'x', '--from='])).toContain('--from=<amostra>');
    expect(parseFail(['new', 'x', '--name='])).toContain('--name=<nome>');
  });

  it('refuses an unknown flag instead of silently dropping it', () => {
    // A swallowed `--outt=x` is a compile that writes nowhere and reports success.
    expect(parseFail(['compile', 'x', '--outt=p.json'])).toContain('flag desconhecida "--outt=p.json"');
    expect(parseFail(['list', '--json'])).toContain('flag desconhecida');
  });

  it('tolerates the CLI-global --dir in both spellings without reading it as a positional', () => {
    // `src/cli.tsx` chdirs into --dir=<path> at the very top and filters it out,
    // so this only matters for a caller forwarding raw argv — but it must not
    // turn into "unknown flag" or into the graph id.
    expect(parseOk(['show', 'auditoria', '--dir=/repo']).command).toEqual({ kind: 'show', id: 'auditoria' });
    expect(parseOk(['--dir', '/repo', 'show', 'auditoria']).command).toEqual({ kind: 'show', id: 'auditoria' });
  });

  it('is PURE — it parses a command naming a graph that exists nowhere', () => {
    // No fs, so "does this graph exist" is not a question this layer can even
    // ask. That is what makes the whole surface testable without a repository.
    expect(parseOk(['show', 'nao-existe-em-lugar-nenhum']).command).toEqual({
      kind: 'show',
      id: 'nao-existe-em-lugar-nenhum',
    });
  });
});

describe('renderGraphTopology — the drawing, as text', () => {
  it('renders every shipped sample without throwing, naming each node', () => {
    for (const sample of GRAPH_SAMPLES) {
      const graph = sample.build(STAMP);
      const text = renderGraphTopology(graph);
      for (const node of graph.nodes) expect(text, `${sample.id}/${node.id}`).toContain(node.id);
      expect(text, sample.id).toContain('topologia');
    }
  });

  it('spells out the join: `todos` by default, `apenas X` for a subset', () => {
    const text = renderGraphTopology(fixtureGraph());
    expect(text).toContain('espera: todos (entrada)');
    // The subset says BOTH what it waits for and what is drawn into it —
    // the dropped edge is still on the canvas and still means something.
    expect(text).toContain('espera: apenas a  [entram no desenho: a, b]');
  });

  it('lists each branch arm with its target and marks the default', () => {
    const text = renderGraphTopology(fixtureGraph());
    expect(text).toContain('braços:');
    expect(text).toMatch(/aprovado.*"Aprovado".*→ fim.*\(default/);
  });

  it('marks a rework arm as going BACK, and summarizes the rework edges', () => {
    const text = renderGraphTopology(fixtureGraph());
    expect(text).toMatch(/reprovado.*↺ a.*RETRABALHO/);
    expect(text).toContain('retrabalho (1): portao --[reprovado]--> a');
  });

  it('says so when a method only goes forward', () => {
    const graph = fixtureGraph();
    const text = renderGraphTopology({ ...graph, edges: graph.edges.filter((e) => e.rework !== true) });
    expect(text).toContain('nenhuma aresta de retrabalho');
  });

  it('names a terminal node and an arm that goes nowhere', () => {
    const graph = fixtureGraph();
    expect(renderGraphTopology(graph)).toContain('(nó terminal — nada sai daqui)');
    const armless = { ...graph, edges: graph.edges.filter((e) => e.id !== 'e-6') };
    expect(renderGraphTopology(armless)).toContain('(sem aresta — o braço não vai a lugar nenhum)');
  });

  it('reports a node kind with the detail a reader needs to check it', () => {
    const text = renderGraphTopology(fixtureGraph());
    expect(text).toContain('bloco implement');
    // Scope is shown even when the node left it unset — naming the block's own
    // default beats a blank, because the fan-out width depends on it.
    expect(text).toContain('(do bloco)');
    expect(text).toContain('maxRuns 3');
  });

  it('says out loud that an invalid drawing does not compile, and where to look', () => {
    const text = renderGraphTopology(brokenGraph());
    expect(text).toContain('válido: NÃO');
    expect(text).toContain('huu graph validate quebrado');
  });

  it('reports run-wide meta only when the graph carries some', () => {
    expect(renderGraphTopology(fixtureGraph())).not.toContain('  meta:');
    const withMeta = { ...fixtureGraph(), meta: { modelId: 'x/y', maxNodeExecutions: 40 } };
    expect(renderGraphTopology(withMeta)).toContain('maxNodeExecutions 40');
    expect(renderGraphTopology(withMeta)).toContain('modelo x/y');
  });
});

describe('renderGraphValidation', () => {
  it('reports a clean drawing as compiling, counting the warnings', () => {
    const text = renderGraphValidation(fixtureGraph());
    expect(text).toContain('o desenho compila');
    expect(text).toContain('0 erro(s)');
    // The subset join is a legitimate thing to mean, so it is a WARNING.
    expect(text).toContain('[join-subset-drops-barrier]');
  });

  it('prints the stable code and the anchor of every error', () => {
    const text = renderGraphValidation(brokenGraph());
    expect(text).toContain('ERRO');
    expect(text).toContain('[unknown-block]');
    expect(text).toContain('nó a');
  });
});

describe('graphCliRoot', () => {
  it('is derived from the graph id alone, so two compilations agree', () => {
    // Deliberately NOT the driver's session-namespaced root: a CLI compile has
    // no session, and a random id baked into a portable artefact is neither
    // portable nor reproducible.
    expect(graphCliRoot('auditoria')).toBe(graphCliRoot('auditoria'));
    expect(graphCliRoot('auditoria')).not.toBe(graphCliRoot('outra'));
    expect(graphCliRoot('auditoria')).toContain('.huu/dev');
  });
});

describe('runGraphCli — against a real directory tree', () => {
  let repo: string;
  let out: string[];
  let errs: string[];

  const run = (...args: string[]): number =>
    runGraphCli({
      args,
      cwd: repo,
      stdout: (line) => out.push(line),
      stderr: (line) => errs.push(line),
      now: STAMP,
    });

  const stdout = (): string => out.join('\n');
  const stderr = (): string => errs.join('\n');

  /** Write a graph straight to the store's directory, bypassing the CLI. */
  function seed(graph: DevGraph): void {
    mkdirSync(join(repo, GRAPHS_DIR), { recursive: true });
    writeFileSync(join(repo, GRAPHS_DIR, `${graph.id}.json`), JSON.stringify(graph, null, 2), 'utf8');
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'huu-graph-cli-'));
    out = [];
    errs = [];
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('lists nothing helpfully in a repo with no drawings', () => {
    expect(run('list')).toBe(0);
    expect(stderr()).toContain('nenhum método desenhado');
    // It names the way OUT of the empty state, not just the empty state.
    expect(stderr()).toContain('huu graph new');
    expect(stderr()).toContain(GRAPH_SAMPLES[0]!.id);
  });

  it('creates an empty drawing, lists it and shows it', () => {
    expect(run('new', 'meu-metodo', '--name', 'Meu método')).toBe(0);
    expect(existsSync(join(repo, GRAPHS_DIR, 'meu-metodo.json'))).toBe(true);
    const stored = readGraph(repo, 'meu-metodo');
    expect(stored.ok && stored.graph.name).toBe('Meu método');
    // A fresh graph is the root prompt and nothing else — no topology anybody
    // else underwrote.
    expect(stored.ok && stored.graph.nodes).toHaveLength(1);

    out = [];
    expect(run('list')).toBe(0);
    expect(stdout()).toContain('meu-metodo');
    expect(stdout()).toContain('Meu método');

    out = [];
    expect(run('show', 'meu-metodo')).toBe(0);
    expect(stdout()).toContain('grafo "meu-metodo"');
  });

  it('refuses to overwrite an existing drawing without --force', () => {
    expect(run('new', 'meu-metodo')).toBe(0);
    errs = [];
    expect(run('new', 'meu-metodo')).toBe(1);
    expect(stderr()).toContain('já existe');
    expect(stderr()).toContain('--force');
    errs = [];
    expect(run('new', 'meu-metodo', '--force')).toBe(0);
  });

  it('copies a shipped sample UNDER THE NEW ID, not under the sample id', () => {
    const sample = GRAPH_SAMPLES.find((s) => s.id === 'portao-de-qualidade')!;
    expect(run('new', 'minha-copia', '--from', sample.id)).toBe(0);
    // `writeGraph` derives the filename from `graph.id`, so a copy that kept
    // the sample's id would have overwritten the sample instead of copying it.
    expect(existsSync(join(repo, GRAPHS_DIR, 'minha-copia.json'))).toBe(true);
    expect(existsSync(join(repo, GRAPHS_DIR, `${sample.id}.json`))).toBe(false);
    const stored = readGraph(repo, 'minha-copia');
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.graph.id).toBe('minha-copia');
      expect(stored.graph.nodes.length).toBe(sample.build(STAMP).nodes.length);
    }
  });

  it('refuses an unknown sample and names the ones it ships', () => {
    expect(run('new', 'x', '--from', 'nao-existe')).toBe(1);
    expect(stderr()).toContain('não existe a amostra "nao-existe"');
    for (const sample of GRAPH_SAMPLES) expect(stderr()).toContain(sample.id);
  });

  it('reports a graph it cannot find, and says where it looked', () => {
    expect(run('show', 'fantasma')).toBe(1);
    expect(stderr()).toContain('not-found');
    expect(stderr()).toContain(GRAPHS_DIR);
  });

  it('validates a clean drawing with exit 0 and a broken one with exit != 0', () => {
    seed(fixtureGraph('limpo'));
    expect(run('validate', 'limpo')).toBe(0);
    expect(stdout()).toContain('o desenho compila');

    out = [];
    seed(brokenGraph('quebrado'));
    expect(run('validate', 'quebrado')).toBe(1);
    expect(stdout()).toContain('[unknown-block]');
  });

  it('compiles a drawing into a real huu-pipeline-v2 on stdout', () => {
    seed(fixtureGraph('limpo'));
    expect(run('compile', 'limpo')).toBe(0);
    const parsed = PipelineSchema.safeParse(JSON.parse(stdout()));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    // Progress belongs on stderr so stdout stays a pipeable artefact.
    expect(stderr()).toContain('passo(s)');
  });

  it('writes the pipeline to --out and says it is runnable by `huu auto`', () => {
    seed(fixtureGraph('limpo'));
    expect(run('compile', 'limpo', '--out', 'artefatos/p.json')).toBe(0);
    const written = join(repo, 'artefatos', 'p.json');
    expect(existsSync(written)).toBe(true);
    expect(PipelineSchema.safeParse(JSON.parse(readFileSync(written, 'utf8'))).success).toBe(true);
    // With --out, stdout carries nothing: `huu graph compile x --out f` must not
    // also dump the JSON into the terminal.
    expect(stdout()).toBe('');
    expect(stderr()).toContain('huu auto');
    expect(stderr()).toContain('PORTÁTIL');
  });

  it('refuses to compile an invalid drawing instead of letting the compiler throw', () => {
    // `compileGraphPipeline` THROWS on an invalid graph BY CONTRACT. Validating
    // first is what turns that into a report; without it the user gets a stack
    // trace, and the CLI process would die instead of exiting 1.
    seed(brokenGraph('quebrado'));
    expect(() => run('compile', 'quebrado')).not.toThrow();
    expect(errs.join('\n')).toContain('[unknown-block]');
    expect(errs.join('\n')).toContain('não compila enquanto houver erro');
    expect(stdout()).toBe('');
  });

  it('deletes a drawing, and reports a second delete as a miss', () => {
    expect(run('new', 'descartavel')).toBe(0);
    errs = [];
    expect(run('rm', 'descartavel')).toBe(0);
    expect(existsSync(join(repo, GRAPHS_DIR, 'descartavel.json'))).toBe(false);
    errs = [];
    expect(run('rm', 'descartavel')).toBe(1);
    expect(stderr()).toContain('not-found');
  });

  it('turns a parse refusal into exit 1 plus the usage block', () => {
    expect(run('compile', 'x', '--nope')).toBe(1);
    expect(stderr()).toContain('flag desconhecida');
    expect(stderr()).toContain('Uso: huu graph');
    expect(stdout()).toBe('');
  });

  it('round-trips: `new --from` then `show` then `compile`, all off the same file', () => {
    expect(run('new', 'ciclo-completo', '--from', 'portao-de-qualidade')).toBe(0);
    out = [];
    expect(run('show', 'ciclo-completo')).toBe(0);
    expect(stdout()).toContain('braços:');
    out = [];
    expect(run('compile', 'ciclo-completo')).toBe(0);
    const pipeline = JSON.parse(stdout());
    expect(PipelineSchema.safeParse(pipeline).success).toBe(true);
    expect(pipeline.steps.length).toBeGreaterThan(0);
  });

  it('skips a file the store cannot understand instead of failing the whole listing', () => {
    seed(fixtureGraph('bom'));
    mkdirSync(join(repo, GRAPHS_DIR), { recursive: true });
    writeFileSync(join(repo, GRAPHS_DIR, 'lixo.json'), '{ not json', 'utf8');
    expect(run('list')).toBe(0);
    expect(stdout()).toContain('bom');
    expect(stdout()).not.toContain('lixo');
  });

  it('writes a file the store can read back — the drawing survives the round trip', () => {
    expect(run('new', 'ida-e-volta', '--from', 'recon-fanout')).toBe(0);
    const raw = readFileSync(join(repo, GRAPHS_DIR, 'ida-e-volta.json'), 'utf8');
    const parsed = parseDevGraph(JSON.parse(raw));
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true);
  });
});
