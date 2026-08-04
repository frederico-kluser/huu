// `huu graph <subcomando>` — the DRAWN METHOD, from a terminal.
//
// The canvas lives in the browser and the picker lives in the TUI, but a
// devgraph is a FILE (`.huu/dev/graphs/<id>.json`) and the people who live in a
// terminal must not have to open a browser to answer "what does this method
// actually do", "does it compile", or "give me the pipeline". This module is
// that answer: list · show · validate · compile · new · rm.
//
// SHAPE, mirroring `dev-mode/dev-cli.ts` — and for the same reason. Everything
// up to "touch the disk" is the PURE {@link parseGraphCliArgs}: argv in, either
// a refusal message or a fully resolved command out. No fs, no network, no
// process state. That is what makes the whole surface testable without a
// repository, and it is why `src/cli.tsx` only ever dispatches.
//
// OUTPUT DISCIPLINE, mirroring `headless-run.ts`:
//   stdout — the PAYLOAD (the listing, the topology, the validation report, the
//            compiled pipeline when no `--out` was given). Pipeable.
//   stderr — progress, confirmations, refusals and warnings.
// So `huu graph compile <id> > pipeline.json` writes a pipeline and nothing
// else, and `huu graph compile <id> --out pipeline.json` leaves stdout empty.
//
// LANGUAGE: pt-BR string literals, like the sibling `dev-mode/dev-cli.ts` (and
// unlike `status.ts`/`prune.ts`, which are English). The `huu graph` family is
// the terminal half of dev mode's drawn method, so it matches the surface it
// belongs to. The one thing that IS translated is `huu --help`, which lives in
// `src/lib/i18n/locales/{en,pt-BR}/cli.ts` like every other help text.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { DEV_MODE_DIR } from './types/dev-mode.js';
import {
  GRAPHS_DIR,
  deleteGraph,
  graphPath,
  listGraphs,
  readGraph,
  writeGraph,
} from './dev-graph/graph-store.js';
import { GRAPH_SAMPLES, findSample } from './dev-graph/graph-samples.js';
import { emptyDevGraph } from './dev-graph/graph-schema.js';
import { findBlock } from './dev-graph/node-catalog.js';
import { compileGraphPipeline } from './dev-graph/graph-to-pipeline.js';
import {
  branchOutcomesOf,
  effectiveDependencies,
  directPredecessors,
  outboundEdges,
  topoOrder,
  validateGraph,
} from './dev-graph/graph-validate.js';
import {
  DEVGRAPH_SLUG_PATTERN,
  isActionNode,
  isGateNode,
  isPromptNode,
  isResearchNode,
  isReworkEdge,
  type DevGraph,
  type GraphIssue,
  type GraphNode,
} from './dev-graph/graph-types.js';

// ─────────────────────────────── the command ────────────────────────────────

/** Every subcommand, in help order. Exported so the tests cannot go stale. */
export const GRAPH_SUBCOMMANDS = ['list', 'show', 'validate', 'compile', 'new', 'rm'] as const;

export type GraphSubcommand = (typeof GRAPH_SUBCOMMANDS)[number];

/** The subcommands that address ONE saved graph and therefore need an id. */
const ID_SUBCOMMANDS: ReadonlySet<GraphSubcommand> = new Set<GraphSubcommand>([
  'show',
  'validate',
  'compile',
  'new',
  'rm',
]);

export type GraphCliCommand =
  | { kind: 'list' }
  | { kind: 'show'; id: string }
  | { kind: 'validate'; id: string }
  /** `--out` is UNRESOLVED here — resolving a path is I/O policy, not parsing. */
  | { kind: 'compile'; id: string; out?: string }
  | { kind: 'new'; id: string; from?: string; name?: string; force: boolean }
  | { kind: 'rm'; id: string };

export interface GraphCliOptions {
  command: GraphCliCommand;
  /** Non-fatal notes to print before doing anything. */
  warnings: string[];
}

export type GraphCliParse = { ok: true; options: GraphCliOptions } | { ok: false; message: string };

/**
 * The blackboard root a CLI-compiled pipeline writes its per-node artifacts
 * under.
 *
 * Deliberately NOT `devGraphRoot()` from `dev-mode/dev-driver.ts`, and the
 * difference is the point: that root is namespaced by SESSION because a dev
 * session runs the same drawing more than once. `huu graph compile` has no
 * session — it produces a PORTABLE ARTEFACT the user runs with `huu auto`, and
 * a path with a random session id baked into it would be neither portable nor
 * reproducible. So the root is derived from the graph id alone, which makes two
 * compilations of the same drawing byte-identical.
 */
export function graphCliRoot(graphId: string): string {
  return `${DEV_MODE_DIR}/graph-cli/${graphId}`;
}

/** Flags that consume the next token when written without `=`. */
const VALUE_FLAGS: ReadonlySet<string> = new Set(['out', 'from', 'name']);
/** Flags that stand alone. */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['force']);
/**
 * `--dir=<repo>` is a CLI-GLOBAL: `src/cli.tsx` `chdir`s into it at the very top
 * (before the Docker gate) and filters it out of the argv a subcommand sees. It
 * is tolerated here — and ignored — so a direct caller that forwards raw argv
 * gets the same behavior as the real command line instead of an "unknown flag".
 */
const GLOBAL_FLAGS: ReadonlySet<string> = new Set(['dir']);

export const GRAPH_USAGE = [
  'Uso: huu graph <subcomando> [--dir=<repo>]',
  '',
  '  list                        lista os métodos desenhados salvos em ' + GRAPHS_DIR,
  '  show <id>                   desenha a topologia em texto (nós, joins, braços, retrabalho)',
  '  validate <id>               roda as regras do desenho; sai != 0 se houver erro',
  '  compile <id> [--out <arq>]  compila o desenho num huu-pipeline-v2',
  '                              Um pipeline gravado é um artefato PORTÁTIL: rode-o com',
  '                              `huu auto <arq> --config <config.json>`, sem modo dev.',
  '  new <id> [--from <amostra>] [--name <nome>] [--force]',
  '                              cria um desenho vazio, ou a partir de uma amostra',
  '  rm <id>                     apaga o desenho salvo',
  '',
  'Amostras de --from: ' + GRAPH_SAMPLES.map((sample) => sample.id).join(', '),
  '',
  'Um id é um slug (a-z, 0-9, hífens, 1-40). Para RODAR um desenho: huu dev "<objetivo>" --graph=<id>',
].join('\n');

function flagValue(args: readonly string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] !== undefined && !args[idx + 1]!.startsWith('--')) {
    return args[idx + 1];
  }
  return undefined;
}

function refuse(message: string): GraphCliParse {
  return { ok: false, message: `${message}\n\n${GRAPH_USAGE}` };
}

/**
 * Split argv into positional arguments, refusing any flag this command does not
 * know. A silently swallowed `--outt=x` is a compile that writes nowhere and
 * says it succeeded.
 */
function splitArgs(args: readonly string[]): { positionals: string[] } | { error: string } {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const hasEq = token.includes('=');
    const name = (hasEq ? token.slice(2, token.indexOf('=')) : token.slice(2)).trim();
    if (GLOBAL_FLAGS.has(name) || VALUE_FLAGS.has(name)) {
      // `--x v` consumes its value; `--x=v` carries it.
      if (!hasEq && args[i + 1] !== undefined && !args[i + 1]!.startsWith('--')) i += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(name)) continue;
    return { error: `huu graph: flag desconhecida "${token}".` };
  }
  return { positionals };
}

/**
 * Parse argv into a runnable command, or into the message that refuses it.
 * Pure: no fs, no network, no process state — the whole surface the tests need.
 */
export function parseGraphCliArgs(args: readonly string[]): GraphCliParse {
  const split = splitArgs(args);
  if ('error' in split) return refuse(split.error);
  const [rawSub, rawId, ...extra] = split.positionals;

  if (rawSub === undefined || rawSub.trim().length === 0) {
    return { ok: false, message: GRAPH_USAGE };
  }
  const sub = rawSub.trim();
  if (!(GRAPH_SUBCOMMANDS as readonly string[]).includes(sub)) {
    return refuse(
      `huu graph: subcomando desconhecido "${sub}". Válidos: ${GRAPH_SUBCOMMANDS.join(', ')}.`,
    );
  }
  const subcommand = sub as GraphSubcommand;

  if (extra.length > 0) {
    return refuse(`huu graph ${subcommand}: argumento inesperado "${extra[0]}".`);
  }

  const id = rawId?.trim();
  if (ID_SUBCOMMANDS.has(subcommand)) {
    if (id === undefined || id.length === 0) {
      return refuse(`huu graph ${subcommand}: falta o id do desenho.`);
    }
    if (!DEVGRAPH_SLUG_PATTERN.test(id)) {
      return refuse(
        `huu graph ${subcommand}: "${id}" não é um id válido — um slug de a-z, 0-9 e hífens, de 1 a 40 caracteres.`,
      );
    }
  } else if (id !== undefined && id.length > 0) {
    return refuse(`huu graph ${subcommand}: argumento inesperado "${id}".`);
  }

  const warnings: string[] = [];

  switch (subcommand) {
    case 'list':
      return { ok: true, options: { command: { kind: 'list' }, warnings } };
    case 'show':
      return { ok: true, options: { command: { kind: 'show', id: id! }, warnings } };
    case 'validate':
      return { ok: true, options: { command: { kind: 'validate', id: id! }, warnings } };
    case 'rm':
      return { ok: true, options: { command: { kind: 'rm', id: id! }, warnings } };
    case 'compile': {
      const out = flagValue(args, 'out');
      if (out !== undefined && out.trim().length === 0) {
        return refuse('huu graph compile: --out=<arquivo> espera um caminho.');
      }
      return {
        ok: true,
        options: {
          command: { kind: 'compile', id: id!, ...(out !== undefined ? { out: out.trim() } : {}) },
          warnings,
        },
      };
    }
    case 'new': {
      const from = flagValue(args, 'from')?.trim();
      if (from !== undefined && from.length === 0) {
        return refuse('huu graph new: --from=<amostra> espera o id de uma amostra.');
      }
      const name = flagValue(args, 'name')?.trim();
      if (name !== undefined && name.length === 0) {
        return refuse('huu graph new: --name=<nome> espera um nome.');
      }
      return {
        ok: true,
        options: {
          command: {
            kind: 'new',
            id: id!,
            force: args.includes('--force'),
            ...(from !== undefined ? { from } : {}),
            ...(name !== undefined ? { name } : {}),
          },
          warnings,
        },
      };
    }
  }
}

// ───────────────────────────── the text topology ────────────────────────────

/** `todos (a, b)` / `apenas a  [entram no desenho: a, b]` / `nada`. */
function joinLine(graph: DevGraph, node: GraphNode): string {
  if (isPromptNode(node)) return 'espera: nada — é a raiz do método';
  const direct = directPredecessors(graph, node.id);
  const effective = effectiveDependencies(graph, node.id);
  if (direct.length === 0) return 'espera: nada (nenhuma aresta de dependência entra aqui)';
  const subset = node.join?.mode === 'subset';
  if (!subset) return `espera: todos (${direct.join(', ')})`;
  const waited = effective.length > 0 ? effective.join(', ') : '(nenhum dos que entram)';
  return `espera: apenas ${waited}  [entram no desenho: ${direct.join(', ')}]`;
}

/** Terminal width this renderer wraps prose at. Fits an 80-column terminal. */
const WRAP_COLUMNS = 78;

/** Collapse whitespace and hard-wrap, continuation lines carrying `indent`. */
function wrap(text: string, indent: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) current = word;
    else if (current.length + 1 + word.length <= WRAP_COLUMNS) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines.map((line, index) => (index === 0 ? line : `${indent}${line}`));
}

/** `bloco X · escopo Y` — with the block's own default named when unset. */
function actionShape(node: GraphNode & { block: string; scope?: string }): string[] {
  const block = findBlock(node.block);
  const scope = node.scope ?? block?.defaultScope;
  return [
    `bloco ${node.block}${block ? '' : ' (DESCONHECIDO)'}`,
    `escopo ${scope ?? '?'}${node.scope === undefined ? ' (do bloco)' : ''}`,
  ];
}

/** `<id> · <kind> · <bloco/…>` — the headline of one node. */
function nodeHeadline(node: GraphNode): string {
  const label = typeof node.label === 'string' ? node.label.replace(/\s+/g, ' ').trim() : '';
  const kind = isActionNode(node)
    ? [
        'action',
        ...actionShape(node),
        ...(node.fanOutFrom ? [`leque a partir de ${node.fanOutFrom}`] : []),
        ...(node.maxFiles !== undefined ? [`maxFiles ${node.maxFiles}`] : []),
        ...(node.review === true ? ['crítico ligado'] : []),
      ].join(' · ')
    : isResearchNode(node)
      ? [
          'research',
          node.outputKind,
          node.useContext ? 'lê o repositório' : 'sem contexto do repositório',
        ].join(' · ')
      : isGateNode(node)
        ? ['gate', `default "${node.defaultOutcome}"`, ...(node.maxRuns !== undefined ? [`maxRuns ${node.maxRuns}`] : [])].join(' · ')
        : 'prompt';
  const model = 'modelId' in node && node.modelId ? ` · modelo ${node.modelId}` : '';
  return `${node.id} · ${kind}${model}${label ? ` · "${label}"` : ''}`;
}

/** One line per outgoing route: the arms of a branch, or the single way out. */
function routeLines(graph: DevGraph, node: GraphNode): string[] {
  const outbound = outboundEdges(graph, node.id);
  const arms = branchOutcomesOf(node);
  if (arms === null) {
    if (outbound.length === 0) return ['(nó terminal — nada sai daqui)'];
    return outbound.map((edge) => `→ ${edge.target}`);
  }
  if (arms.length === 0) return ['braços: (nenhum declarado)'];
  const defaultOutcome = isGateNode(node)
    ? node.defaultOutcome
    : isResearchNode(node)
      ? node.defaultOutcome
      : undefined;
  const width = Math.max(...arms.map((arm) => arm.id.length));
  const lines = ['braços:'];
  arms.forEach((arm, index) => {
    const last = index === arms.length - 1;
    const edges = outbound.filter((edge) => edge.sourceOutcome === arm.id);
    const target =
      edges.length === 0
        ? '(sem aresta — o braço não vai a lugar nenhum)'
        : edges
            .map((edge) => `${isReworkEdge(edge) ? '↺ ' : '→ '}${edge.target}${isReworkEdge(edge) ? '  (RETRABALHO)' : ''}`)
            .join(' , ');
    const mark = arm.id === defaultOutcome ? '  (default — a rota segura quando o juiz falha)' : '';
    lines.push(`  ${last ? '└' : '├'} ${arm.id.padEnd(width)}  "${arm.label}"  ${target}${mark}`);
  });
  return lines;
}

/** `meta:` line — only when the graph actually carries run-wide settings. */
function metaLine(graph: DevGraph): string | null {
  const parts: string[] = [];
  const methodology = Object.keys(graph.meta?.methodology ?? {});
  if (methodology.length > 0) parts.push(`metodologia declarada: ${methodology.sort().join(', ')}`);
  if (graph.meta?.maxNodeExecutions !== undefined) {
    parts.push(`maxNodeExecutions ${graph.meta.maxNodeExecutions}`);
  }
  if (graph.meta?.modelId) parts.push(`modelo ${graph.meta.modelId}`);
  return parts.length > 0 ? `  meta: ${parts.join(' · ')}` : null;
}

function rule(title: string): string {
  const dashes = Math.max(4, 74 - title.length);
  return `── ${title} ${'─'.repeat(dashes)}`;
}

/**
 * The drawn method, as text. PURE — takes a graph, returns the block a terminal
 * prints. `huu graph show` is nothing but this plus a file read, which is what
 * lets the rendering be pinned by a test with no repository at all.
 *
 * The order is `topoOrder`'s: the order the work RUNS in, which is the only
 * order a reader can check a method against. Rework arms are excluded from it
 * (they are routes back, never dependencies) and reported on their own arm line
 * plus in a closing summary, so "where does this loop" is answerable.
 */
export function renderGraphTopology(graph: DevGraph): string {
  const validation = validateGraph(graph);
  const { order, cycle } = topoOrder(graph);
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  const lines: string[] = [
    rule(`grafo "${graph.id}"`),
    `  nome:      ${graph.name}`,
  ];
  if (graph.description) {
    for (const line of wrap(`descrição: ${graph.description}`, ' '.repeat(11))) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(
    `  nós: ${graph.nodes.length} · arestas: ${graph.edges.length} · válido: ${
      validation.ok ? 'sim' : `NÃO (${validation.errors.length} erro(s))`
    }${validation.warnings.length > 0 ? ` · ${validation.warnings.length} aviso(s)` : ''}`,
  );
  lines.push(`  criado em ${graph.createdAt} · atualizado em ${graph.updatedAt}`);
  const meta = metaLine(graph);
  if (meta) lines.push(meta);
  lines.push('');
  lines.push('  topologia (na ordem em que o método roda):');
  lines.push('');

  const visible = order.filter((id) => byId.has(id));
  visible.forEach((id, index) => {
    const node = byId.get(id)!;
    const last = index === visible.length - 1;
    const cont = last ? '     ' : '  │  ';
    lines.push(`  ${last ? '└─' : '├─'} ${nodeHeadline(node)}`);
    if (isPromptNode(node)) {
      for (const line of wrap(`objetivo: ${node.goal}`, ' '.repeat(10))) {
        lines.push(`${cont}${line}`);
      }
    }
    lines.push(`${cont}${joinLine(graph, node)}`);
    for (const route of routeLines(graph, node)) lines.push(`${cont}${route}`);
    if (!last) lines.push('  │');
  });

  const stranded = graph.nodes.map((node) => node.id).filter((id) => !order.includes(id));
  if (stranded.length > 0) {
    lines.push('');
    lines.push(
      `  ⚠ fora da ordem${cycle ? ' (presos num ciclo de dependência, ou depois dele)' : ''}: ${stranded.join(', ')}`,
    );
  }

  const rework = graph.edges.filter((edge) => isReworkEdge(edge));
  lines.push('');
  lines.push(
    rework.length === 0
      ? '  retrabalho: nenhuma aresta de retrabalho — o método só anda para frente.'
      : `  retrabalho (${rework.length}): ${rework
          .map((edge) => `${edge.source} --[${edge.sourceOutcome ?? '?'}]--> ${edge.target}`)
          .join(' · ')}`,
  );

  if (!validation.ok) {
    lines.push('');
    lines.push('  ⚠ este desenho NÃO compila. Rode `huu graph validate ' + graph.id + '` para o relatório completo.');
  }
  return lines.join('\n');
}

/** One issue, with its stable code and the anchor a human can look at. */
function issueLine(prefix: string, issue: GraphIssue): string {
  const anchor = [
    issue.nodeId !== undefined ? `nó ${issue.nodeId}` : undefined,
    issue.edgeId !== undefined ? `aresta ${issue.edgeId}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' / ');
  return `  ${prefix} [${issue.code}]${anchor ? ` ${anchor}` : ''}: ${issue.message}`;
}

/** The validation report, as text. PURE. */
export function renderGraphValidation(graph: DevGraph): string {
  const validation = validateGraph(graph);
  const lines = [
    validation.ok
      ? `huu graph validate "${graph.id}": o desenho compila — 0 erro(s), ${validation.warnings.length} aviso(s).`
      : `huu graph validate "${graph.id}": ${validation.errors.length} erro(s), ${validation.warnings.length} aviso(s).`,
  ];
  for (const issue of validation.errors) lines.push(issueLine('ERRO ', issue));
  for (const issue of validation.warnings) lines.push(issueLine('aviso', issue));
  return lines.join('\n');
}

// ───────────────────────────────── the runner ───────────────────────────────

export interface RunGraphCliArgs {
  /** Argv after the `graph` subcommand, with CLI-global flags already filtered. */
  args: string[];
  cwd: string;
  /** Injected so a test can capture the two streams instead of the process's. */
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** ISO-8601 stamp for `new`, so a created graph is reproducible in a test. */
  now?: string;
}

/** Reads one graph or writes the refusal. `null` means "already reported". */
function loadOrReport(
  cwd: string,
  id: string,
  err: (line: string) => void,
): DevGraph | null {
  const read = readGraph(cwd, id);
  if (!read.ok) {
    err(`huu graph: não consegui ler o desenho "${id}" — ${read.reason}`);
    err(`  procurei em ${graphPath(cwd, id)}`);
    return null;
  }
  return read.graph;
}

function runList(cwd: string, out: (l: string) => void, err: (l: string) => void): number {
  const graphs = listGraphs(cwd);
  if (graphs.length === 0) {
    err(`huu graph: nenhum método desenhado em ${cwd}/${GRAPHS_DIR}.`);
    err("  crie um com `huu graph new <id>` ou `huu graph new <id> --from <amostra>`.");
    err(`  amostras: ${GRAPH_SAMPLES.map((sample) => sample.id).join(', ')}`);
    return 0;
  }
  const idWidth = Math.max(2, ...graphs.map((g) => g.id.length));
  out(`${graphs.length} método(s) desenhado(s) em ${GRAPHS_DIR}:`);
  out(`  ${'ID'.padEnd(idWidth)}  NÓS  ARESTAS  VÁLIDO  ATUALIZADO                NOME`);
  for (const g of graphs) {
    out(
      `  ${g.id.padEnd(idWidth)}  ${String(g.nodeCount).padStart(3)}  ${String(g.edgeCount).padStart(7)}  ${
        g.valid ? 'sim   ' : 'NÃO   '
      }  ${g.updatedAt.padEnd(24)}  ${g.name}`,
    );
  }
  return 0;
}

function runCompile(
  cwd: string,
  id: string,
  outPath: string | undefined,
  out: (l: string) => void,
  err: (l: string) => void,
): number {
  const graph = loadOrReport(cwd, id, err);
  if (!graph) return 1;

  // `compileGraphPipeline` THROWS on an invalid graph, BY CONTRACT. Validating
  // first is what turns that contract into a readable report instead of one
  // very long exception line.
  const validation = validateGraph(graph);
  if (!validation.ok) {
    err(renderGraphValidation(graph));
    err(`huu graph compile: "${id}" não compila enquanto houver erro. Corrija o desenho e tente de novo.`);
    return 1;
  }

  let compiled;
  try {
    compiled = compileGraphPipeline({
      graph,
      graphRoot: graphCliRoot(graph.id),
      sessionId: `graph-cli-${graph.id}`,
    });
  } catch (e) {
    err(`huu graph compile: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  for (const warning of compiled.warnings) err(`  ⚠ ${warning}`);
  err(
    `huu graph compile: "${graph.id}" → ${compiled.pipeline.steps.length} passo(s) a partir de ${compiled.nodeOrder.length} nó(s).`,
  );

  const json = `${JSON.stringify(compiled.pipeline, null, 2)}\n`;
  if (outPath === undefined) {
    out(json.trimEnd());
    err('  (sem --out: o pipeline saiu no stdout — redirecione para um arquivo para guardá-lo)');
    return 0;
  }

  const absolute = resolvePath(cwd, outPath);
  try {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, json, 'utf8');
  } catch (e) {
    err(`huu graph compile: não consegui gravar ${absolute} — ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  err(`  gravado em ${absolute}`);
  err(
    '  esse arquivo é um ARTEFATO PORTÁTIL: rode-o com `huu auto ' +
      outPath +
      ' --config <config.json>`, sem modo dev, em qualquer repositório.',
  );
  return 0;
}

function runNew(
  cwd: string,
  command: Extract<GraphCliCommand, { kind: 'new' }>,
  err: (l: string) => void,
  now?: string,
): number {
  const { id, from, name, force } = command;
  const target = graphPath(cwd, id);
  if (existsSync(target) && !force) {
    err(`huu graph new: já existe um desenho "${id}" em ${target}. Use --force para substituí-lo.`);
    return 1;
  }

  let graph: DevGraph;
  if (from === undefined) {
    graph = emptyDevGraph(id, name ?? id, now);
  } else {
    const sample = findSample(from);
    if (!sample) {
      err(`huu graph new: não existe a amostra "${from}".`);
      err(`  amostras: ${GRAPH_SAMPLES.map((s) => s.id).join(', ')}`);
      return 1;
    }
    // The sample builds itself under ITS OWN id, and `writeGraph` derives the
    // filename from `graph.id` — so a copy that kept the sample's id would
    // silently overwrite the sample's own file instead of creating a new one.
    graph = { ...sample.build(now), id, name: name ?? sample.name, description: sample.description };
  }

  const written = writeGraph(cwd, graph, now);
  if (!written.ok) {
    err(`huu graph new: não consegui gravar "${id}" — ${written.reason}`);
    return 1;
  }
  const validation = validateGraph(written.graph);
  err(
    `huu graph new: "${id}" criado em ${target} — ${written.graph.nodes.length} nó(s), ${written.graph.edges.length} aresta(s), ${
      validation.ok ? 'válido' : `${validation.errors.length} erro(s) a corrigir`
    }.`,
  );
  err(`  veja com \`huu graph show ${id}\` · rode com \`huu dev "<objetivo>" --graph=${id}\``);
  return 0;
}

/**
 * Parse + run. Returns the process exit code; never throws for a user error
 * (those print a usage block and return 1).
 *
 * Synchronous, like `runStatusCli`/`runPruneCli`: every operation here is a
 * local file read or write, and an async wrapper around sync fs buys nothing
 * but a promise nobody awaits differently.
 */
export function runGraphCli(input: RunGraphCliArgs): number {
  const out = input.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = input.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));

  const parsed = parseGraphCliArgs(input.args);
  if (!parsed.ok) {
    err(parsed.message);
    return 1;
  }
  for (const warning of parsed.options.warnings) err(`huu graph: ${warning}`);

  const { command } = parsed.options;
  const cwd = input.cwd;

  switch (command.kind) {
    case 'list':
      return runList(cwd, out, err);
    case 'show': {
      const graph = loadOrReport(cwd, command.id, err);
      if (!graph) return 1;
      out(renderGraphTopology(graph));
      return 0;
    }
    case 'validate': {
      const graph = loadOrReport(cwd, command.id, err);
      if (!graph) return 1;
      out(renderGraphValidation(graph));
      return validateGraph(graph).ok ? 0 : 1;
    }
    case 'compile':
      return runCompile(cwd, command.id, command.out, out, err);
    case 'new':
      return runNew(cwd, command, err, input.now);
    case 'rm': {
      const removed = deleteGraph(cwd, command.id);
      if (!removed.ok) {
        err(`huu graph rm: ${removed.reason ?? 'falhou'}`);
        return 1;
      }
      err(`huu graph rm: "${command.id}" apagado de ${GRAPHS_DIR}.`);
      return 0;
    }
  }
}
