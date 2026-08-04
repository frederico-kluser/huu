// The hand-drawn method, as TEXT.
//
// WHY IT LIVES IN `lib/` AND NOT IN THE INK COMPONENT: a diagram is the one
// thing a TUI screen cannot be tested through. Ink renders to a terminal buffer,
// so an assertion about "does the consolidator line say it waits only for the
// performance review" would have to go through a rendered frame, a width, a
// wrap and a color escape — four things that have nothing to do with the
// question. Everything below is a pure `DevGraph → string[]`: no fs, no ink, no
// color. The COMPONENT owns the color and the window; this module owns the
// drawing.
//
// WHAT IS TRANSLATED AND WHAT IS NOT, because the split is deliberate:
//
//  - the FRAME is translated — the join words, the counters, the verdict. It is
//    prose a human reads.
//  - the IDENTIFIERS are not — node ids, arm ids, `kind`, the block id, and the
//    `GraphIssueCode` of every problem. These are the format's stable surface
//    (`graph-types.ts` says it outright: "the code is the STABLE identity of the
//    problem"), they are what the human types into the editor, and they are what
//    a bug report can be searched by. Translating them would make the drawing
//    disagree with the file it came from.
//  - `GraphIssue.message` is not translated either, and that is the honest
//    call rather than the lazy one: the validator writes it with the SPECIFICS
//    of the instance (which node, which limit, which count), so a static
//    catalog sentence per code would be strictly less informative than what it
//    replaced — and 49 hand-copied sentences would drift from
//    `graph-validate.ts` the first time a message is reworded. Same rule as
//    `tStatus()`: the classifier stays locale-blind, the frame around it does
//    not.

import {
  isReworkEdge,
  type DevGraph,
  type GraphEdge,
  type GraphIssue,
  type GraphNode,
  type GraphValidation,
} from './dev-graph/graph-types.js';
import {
  branchOutcomesOf,
  directPredecessors,
  effectiveDependencies,
  outboundEdges,
  topoOrder,
  validateGraph,
} from './dev-graph/graph-validate.js';
import { t } from './i18n/index.js';

/** Indent of a branch-arm line, so arms read as belonging to the node above. */
const ARM_INDENT = '     ';

/** The glyph that says "this node waits for". */
const JOIN_GLYPH = '⇠';

/** An ordinary arm goes forward; a rework arm goes back. Two glyphs, one look. */
const FORWARD_GLYPH = '→';
const REWORK_GLYPH = '↺';

/** Separator between the segments of a node line. */
const SEP = '  ·  ';

/**
 * The same defensive reading `graph-validate.ts` performs — this module is
 * handed graphs that came off a disk and out of a half-finished editor, so a
 * `nodes` that is not an array (or that holds a `null`) must degrade to a
 * shorter drawing, never to a throw.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodesOf(graph: DevGraph): GraphNode[] {
  return Array.isArray(graph?.nodes) ? (graph.nodes.filter(isRecord) as GraphNode[]) : [];
}

function edgesOf(graph: DevGraph): GraphEdge[] {
  return Array.isArray(graph?.edges) ? (graph.edges.filter(isRecord) as GraphEdge[]) : [];
}

function label(node: GraphNode): string {
  const raw = typeof node.label === 'string' ? node.label.trim() : '';
  return raw.length > 0 ? raw : t('common.unnamed');
}

/**
 * The node's TYPE, in the format's own vocabulary: `action:tdd`,
 * `research:boolean`, `gate`, `prompt`. Never translated — see the header.
 */
function kindTag(node: GraphNode): string {
  if (node.kind === 'action') {
    const block = typeof node.block === 'string' && node.block.length > 0 ? node.block : '?';
    return `action:${block}`;
  }
  if (node.kind === 'research') {
    const out =
      typeof node.outputKind === 'string' && node.outputKind.length > 0 ? node.outputKind : '?';
    return `research:${out}`;
  }
  return node.kind === 'gate' ? 'gate' : 'prompt';
}

/**
 * What this node waits for, in the two shapes the format has: `⇠ all` (every
 * drawn predecessor) and `⇠ only a, b` (a `subset` join — the rest of the
 * inbound arrows stay drawing).
 *
 * Empty string when nothing points at the node: the root has nothing to join,
 * and a node with no inbound edge is reported by the validator as
 * `unreachable-node` rather than described here as waiting for nobody.
 */
function joinSegment(graph: DevGraph, node: GraphNode): string {
  if (node.kind === 'prompt') return '';
  const direct = directPredecessors(graph, node.id);
  if (direct.length === 0) return '';
  const join = (node as { join?: { mode?: string } }).join;
  if (!join || join.mode !== 'subset') return `  ${JOIN_GLYPH} ${t('tui.graph.join_all')}`;
  const deps = effectiveDependencies(graph, node.id);
  const ids = deps.length > 0 ? deps.join(', ') : t('common.none');
  return `  ${JOIN_GLYPH} ${t('tui.graph.join_only', { ids })}`;
}

/**
 * The fan-out marker: this node opens ONE agent per entry of a list an earlier
 * node wrote. Worth a segment of its own because it is the only place on the
 * canvas where a single chip becomes N agents, and `maxFiles` is the width the
 * human underwrote.
 */
function fanOutSegment(node: GraphNode): string {
  if (node.kind !== 'action') return '';
  const source = typeof node.fanOutFrom === 'string' ? node.fanOutFrom.trim() : '';
  if (source.length === 0) return '';
  const cap =
    typeof node.maxFiles === 'number' && Number.isFinite(node.maxFiles)
      ? `${SEP}${t('tui.graph.max_files', { count: node.maxFiles })}`
      : '';
  return `${SEP}${t('tui.graph.fanout', { source })}${cap}`;
}

/** The `defaultOutcome` of a branching node, or `''` for everything else. */
function defaultOutcomeOf(node: GraphNode): string {
  if (node.kind === 'gate' || node.kind === 'research') {
    const value = (node as { defaultOutcome?: unknown }).defaultOutcome;
    return typeof value === 'string' ? value : '';
  }
  return '';
}

/**
 * One line per ARM of a branching node, with the destination each arm reaches.
 *
 * Rework arms are marked `↺` instead of `→`, and that difference carries the
 * whole meaning: a rework arm routes the run BACK to a node that already ran, so
 * reading it as an ordinary continuation would make the drawing look like a
 * cycle that huu refuses. An arm with no edge shows `(none)` — the validator
 * reports it as `branch-outcome-missing-edge`, and the drawing must not hide the
 * hole it is complaining about.
 */
function armLines(graph: DevGraph, node: GraphNode): string[] {
  const arms = branchOutcomesOf(node);
  if (!arms || arms.length === 0) return [];
  const outbound = outboundEdges(graph, node.id);
  const fallback = defaultOutcomeOf(node);
  return arms.map((arm, index) => {
    const stem = index === arms.length - 1 ? '└' : '├';
    const mine = outbound.filter((edge) => edge.sourceOutcome === arm.id);
    const destination =
      mine.length === 0
        ? `${FORWARD_GLYPH} ${t('common.none')}`
        : mine
            .map((edge) => `${isReworkEdge(edge) ? REWORK_GLYPH : FORWARD_GLYPH} ${edge.target}`)
            .join('  ');
    const isDefault = fallback.length > 0 && fallback === arm.id;
    return `${ARM_INDENT}${stem} ${arm.id} ${destination}${
      isDefault ? `${SEP}${t('tui.check.default_tag')}` : ''
    }`;
  });
}

/**
 * The three-line header of a graph: its name, what it is made of, and whether it
 * would compile right now.
 *
 * `valid: false` is a statement about the METHOD, never about the file — the
 * store lists a broken graph precisely so a human can open it and fix it, so
 * this header says "does not compile" and counts the problems instead of hiding
 * the row.
 */
export function renderGraphSummary(graph: DevGraph): string[] {
  const validation = validateGraph(graph);
  const id = typeof graph?.id === 'string' && graph.id.length > 0 ? graph.id : '?';
  const verdict = validation.ok ? t('tui.graph.valid') : t('tui.graph.invalid');
  return [
    typeof graph?.name === 'string' && graph.name.trim().length > 0
      ? graph.name.trim()
      : t('common.unnamed'),
    t('tui.graph.summary_counts', {
      id,
      nodes: nodesOf(graph).length,
      edges: edgesOf(graph).length,
    }),
    `${verdict}${SEP}${t('tui.graph.issue_counts', {
      errors: validation.errors.length,
      warnings: validation.warnings.length,
    })}`,
  ];
}

/**
 * The drawing, in reading order: one line per node in TOPOLOGICAL order, each
 * followed by one indented line per branch arm.
 *
 * The order is the order the work actually runs in (`topoOrder` walks the
 * DEPENDENCY layer, so a rework arm does not reorder anything). Nodes the topo
 * sort could not place — everything tangled in or downstream of a dependency
 * cycle — are NOT dropped: they come last, in declaration order, flagged, so a
 * broken graph still renders every node the human drew.
 */
export function renderGraphTree(graph: DevGraph): string[] {
  const nodes = nodesOf(graph);
  if (nodes.length === 0) return [t('tui.graph.empty_tree')];

  const byId = new Map<string, GraphNode>();
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  const placed = new Set<string>();
  const ordered: GraphNode[] = [];
  for (const id of topoOrder(graph).order) {
    const node = byId.get(id);
    if (!node || placed.has(id)) continue;
    placed.add(id);
    ordered.push(node);
  }
  const stranded: GraphNode[] = [];
  for (const node of nodes) {
    if (placed.has(node.id)) continue;
    placed.add(node.id);
    stranded.push(node);
  }

  const lines: string[] = [];
  const all = [...ordered, ...stranded];
  all.forEach((node, index) => {
    const position = `${String(index + 1).padStart(2, ' ')}.`;
    const cycle = stranded.includes(node) ? `${SEP}⚠ ${t('tui.graph.in_cycle')}` : '';
    lines.push(
      `${position} ${label(node)}${SEP}${node.id}${SEP}${kindTag(node)}${fanOutSegment(node)}${joinSegment(
        graph,
        node,
      )}${cycle}`,
    );
    lines.push(...armLines(graph, node));
  });
  return lines;
}

/**
 * Every problem the validator found, errors first, each anchored to the node
 * (`@id`) or edge (`#id`) it belongs to.
 *
 * The CODE leads the line on purpose: it is the stable identity of the defect,
 * the thing the editor highlights on and the thing worth searching for. A clean
 * graph gets one affirmative line rather than an empty block — "nothing here"
 * and "nothing checked" must not look the same.
 *
 * BOTH anchors are printed when the validator supplies both, and that is not
 * belt-and-braces: the `edge-outcome-*` family names an ARM of a node, so
 * `@portao #e-4` is the only pair that locates it — dropping the edge id would
 * point at a node with four arrows and dropping the node id would point at an
 * arrow with no context.
 */
export function renderIssues(validation: GraphValidation): string[] {
  const line = (marker: string, issue: GraphIssue): string => {
    const anchor = [
      issue.nodeId ? `@${issue.nodeId}` : '',
      issue.edgeId ? `#${issue.edgeId}` : '',
    ]
      .filter((part) => part.length > 0)
      .join(' ');
    return `${marker} [${issue.code}]${anchor.length > 0 ? ` ${anchor}` : ''}  ${issue.message}`;
  };
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  const out = [
    ...errors.map((issue) => line('✗', issue)),
    ...warnings.map((issue) => line('⚠', issue)),
  ];
  return out.length > 0 ? out : [t('tui.graph.no_issues')];
}
