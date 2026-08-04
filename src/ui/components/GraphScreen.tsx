// The Ink surface for hand-drawn methods (`huu-devgraph-v1`).
//
// WHY THIS SCREEN IS A PICKER AND NOT A CANVAS — the decision that shapes the
// whole file. A devgraph COMPILES into a `huu-pipeline-v2`, and this TUI already
// knows how to run one of those: backend-selector → model-selector →
// timeout → resolver → RunDashboard. So the screen lists graphs, reads one out
// loud, and hands the COMPILED pipeline to that chain (`state.pipeline`). It
// starts no run of its own, owns no session, and duplicates none of
// `src/web/dev-manager.ts`. Drawing a graph is the browser's job (a canvas needs
// a mouse); reading, checking and RUNNING one is what a terminal is good at.
//
// The diagram itself lives in `src/lib/graph-render.ts` — pure `DevGraph →
// string[]`, tested without Ink. Everything here is color, windowing and keys.
//
// COLOR: dev mode is AI-driven, so the accents are `theme.ai` / `theme.aiAccent`
// (magenta), per the repo's visual convention. The frame stays cyan like every
// other screen.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync } from 'node:fs';
import {
  GRAPHS_DIR,
  graphPath,
  listGraphs,
  readGraph,
  writeGraph,
  type GraphSummary,
} from '../../lib/dev-graph/graph-store.js';
import { GRAPH_SAMPLES } from '../../lib/dev-graph/graph-samples.js';
import { validateGraph } from '../../lib/dev-graph/graph-validate.js';
import { compileGraphPipeline } from '../../lib/dev-graph/graph-to-pipeline.js';
import {
  DEVGRAPH_SLUG_PATTERN,
  type DevGraph,
  type GraphValidation,
} from '../../lib/dev-graph/graph-types.js';
import { renderGraphSummary, renderGraphTree, renderIssues } from '../../lib/graph-render.js';
import { DEV_MODE_DIR } from '../../lib/types/dev-mode.js';
import { generateRunId } from '../../lib/run-id.js';
import { log as dlog } from '../../lib/debug-logger.js';
import type { Pipeline } from '../../lib/types.js';
import { theme } from '../theme.js';
import { ActionBar, type ActionHint } from './ActionBar.js';
import { t } from '../../lib/i18n/index.js';

/**
 * Which of the two screen kinds this instance is rendering. A discriminated
 * union rather than a loose `graphId?`, so "detail without an id" cannot be
 * constructed — same shape as the `Screen` variants it mirrors.
 */
export type GraphScreenMode = { kind: 'list' } | { kind: 'detail'; graphId: string };

interface Props {
  /** Where the run happens — graphs are read from `<repoRoot>/.huu/dev/graphs`. */
  repoRoot: string;
  mode: GraphScreenMode;
  onInspect: (graphId: string) => void;
  /** The compiled pipeline plus the name of the DRAWING it came from. */
  onLaunch: (pipeline: Pipeline, graphName: string) => void;
  onBack: () => void;
}

/** Rows of the graph list kept on screen at once. */
const LIST_WINDOW = 8;
/** Lines of the diagram kept on screen at once. */
const DIAGRAM_WINDOW = 16;
/** Lines of the problem list kept on screen at once. */
const ISSUE_WINDOW = 10;
/** How many `-2`, `-3`, … suffixes to try before refusing to save a sample. */
const MAX_ID_ATTEMPTS = 99;
/** Longest id the slug pattern accepts — `{0,39}` plus the leading character. */
const MAX_ID_LENGTH = 40;

/** A one-off message under the header: the result of the last action. */
interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

/**
 * `requested`, or the first free `requested-N` after it — the same
 * non-destructive rule `POST /api/graphs/from-sample` follows. Dropping an
 * example onto an id that is taken would overwrite a method somebody drew by
 * hand, and a key that can silently destroy work is a key nobody presses twice.
 *
 * Exported for the colocated test: this repo has no Ink renderer, so the only
 * way to pin a rule whose failure mode is DATA LOSS is to reach it directly.
 */
export function availableGraphId(repoRoot: string, requested: string): string | null {
  if (!existsSync(graphPath(repoRoot, requested))) return requested;
  for (let n = 2; n <= MAX_ID_ATTEMPTS; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${requested.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    if (!DEVGRAPH_SLUG_PATTERN.test(candidate)) continue;
    if (!existsSync(graphPath(repoRoot, candidate))) return candidate;
  }
  return null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `2026-08-03T12:34:56.789Z` → `2026-08-03 12:34`. Ordering, not precision.
 * Exported for the colocated test, like {@link availableGraphId}.
 */
export function shortStamp(iso: string): string {
  return typeof iso === 'string' && iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

/**
 * Hints are built by a FUNCTION, never a module constant: a `t()` at module
 * scope would translate at IMPORT time, before `initI18n()` resolved the locale
 * (the `editorNavHints()` precedent in `PipelineEditor.tsx`).
 */
function listHints(canRun: boolean): ActionHint[] {
  return [
    { key: '↑↓', label: t('common.action.navigate'), color: theme.info },
    { key: 'ENTER', label: t('tui.graph.hint_inspect'), color: theme.aiAccent, bold: true },
    {
      key: 'R',
      label: t('tui.graph.hint_run'),
      color: canRun ? theme.success : theme.warning,
      bold: canRun,
    },
    { key: 'S', label: t('tui.graph.hint_samples'), color: theme.ai },
    { key: 'ESC', label: t('common.action.back'), color: theme.error },
  ];
}

function sampleHints(): ActionHint[] {
  return [
    { key: '↑↓', label: t('common.action.navigate'), color: theme.info },
    { key: 'ENTER', label: t('common.action.save'), color: theme.success, bold: true },
    { key: 'ESC', label: t('common.action.back'), color: theme.error },
  ];
}

function detailHints(pane: 'diagram' | 'issues', canRun: boolean): ActionHint[] {
  return [
    { key: '↑↓', label: t('common.action.navigate'), color: theme.info },
    {
      key: 'V',
      label: pane === 'diagram' ? t('tui.graph.hint_issues') : t('tui.graph.hint_diagram'),
      color: theme.info,
    },
    {
      key: 'R',
      label: t('tui.graph.hint_run'),
      color: canRun ? theme.success : theme.warning,
      bold: canRun,
    },
    { key: 'L', label: t('tui.graph.hint_reload'), color: theme.info },
    { key: 'ESC', label: t('common.action.back'), color: theme.error },
  ];
}

/** A scrolled slice plus the `↑ more` / `↓ more` affordances around it. */
function windowOf(lines: string[], offset: number, size: number): { slice: string[]; start: number } {
  const start = Math.max(0, Math.min(offset, Math.max(0, lines.length - size)));
  return { slice: lines.slice(start, start + size), start };
}

export function GraphScreen({
  repoRoot,
  mode,
  onInspect,
  onLaunch,
  onBack,
}: Props): React.JSX.Element {
  const isDetail = mode.kind === 'detail';
  const graphId = mode.kind === 'detail' ? mode.graphId : '';

  /** Bumped to re-read the disk (after saving an example, or on `L`). */
  const [reloadToken, setReloadToken] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [sampleCursor, setSampleCursor] = useState(0);
  const [showSamples, setShowSamples] = useState(false);
  const [pane, setPane] = useState<'diagram' | 'issues'>('diagram');
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);

  const graphs: GraphSummary[] = useMemo(
    () => (isDetail ? [] : listGraphs(repoRoot)),
    [isDetail, repoRoot, reloadToken],
  );

  const loaded = useMemo(
    () => (isDetail ? readGraph(repoRoot, graphId) : null),
    [isDetail, repoRoot, graphId, reloadToken],
  );
  const graph: DevGraph | null = loaded?.ok ? loaded.graph : null;
  const validation: GraphValidation | null = useMemo(
    () => (graph ? validateGraph(graph) : null),
    [graph],
  );

  const diagram = useMemo(() => (graph ? renderGraphTree(graph) : []), [graph]);
  const header = useMemo(() => (graph ? renderGraphSummary(graph) : []), [graph]);
  const issues = useMemo(() => (validation ? renderIssues(validation) : []), [validation]);

  /**
   * Compile and hand off. The compiler THROWS on an invalid graph — that is its
   * documented entry gate, not a defect — so the guard runs FIRST and the call
   * is still wrapped: `compileGraphPipeline` has a second gate on its own output
   * and an escaping throw would take the TUI down mid-keystroke.
   */
  const launch = useCallback(
    (candidate: DevGraph) => {
      const check = validateGraph(candidate);
      if (!check.ok) {
        setNotice({
          tone: 'error',
          text:
            check.errors.length === 1
              ? t('tui.graph.blocked_one', { count: check.errors.length })
              : t('tui.graph.blocked_other', { count: check.errors.length }),
        });
        return;
      }
      try {
        // A FRESH session per launch: the compiled steps write their findings
        // under this namespace, so two runs of the same drawing must not land on
        // one blackboard. Mirrors `defaultGraphRoot` in `src/web/graph-api.ts`,
        // with a run id instead of the graph id.
        const sessionId = `graph-${generateRunId()}`;
        const compiled = compileGraphPipeline({
          graph: candidate,
          graphRoot: `${DEV_MODE_DIR}/${sessionId}/graph`,
          sessionId,
        });
        dlog('action', 'GraphScreen.launch', {
          graph: candidate.id,
          steps: compiled.pipeline.steps.length,
          warnings: compiled.warnings.length,
        });
        onLaunch(compiled.pipeline, candidate.name);
      } catch (err) {
        setNotice({ tone: 'error', text: t('tui.graph.compile_failed', { reason: errText(err) }) });
      }
    },
    [onLaunch],
  );

  /** Read the highlighted row off disk and run it. */
  const launchById = useCallback(
    (id: string) => {
      const result = readGraph(repoRoot, id);
      if (!result.ok) {
        setNotice({ tone: 'error', text: t('tui.graph.read_failed', { reason: result.reason }) });
        return;
      }
      launch(result.graph);
    },
    [repoRoot, launch],
  );

  const saveSample = useCallback(
    (index: number) => {
      const sample = GRAPH_SAMPLES[index];
      if (!sample) return;
      const id = availableGraphId(repoRoot, sample.id);
      if (id === null) {
        setNotice({ tone: 'error', text: t('tui.graph.sample_no_id', { id: sample.id }) });
        return;
      }
      const built = sample.build();
      const result = writeGraph(repoRoot, { ...built, id });
      if (!result.ok) {
        setNotice({ tone: 'error', text: t('tui.graph.sample_failed', { reason: result.reason }) });
        return;
      }
      dlog('action', 'GraphScreen.sample_saved', { sample: sample.id, id });
      setNotice({ tone: 'ok', text: t('tui.graph.sample_saved', { id }) });
      setShowSamples(false);
      setReloadToken((n) => n + 1);
    },
    [repoRoot],
  );

  // Ink re-attaches its listener whenever the handler identity changes, and
  // SystemMetricsBar re-renders the whole App once a second. Refs feed the fresh
  // state into a handler whose deps never change (app.tsx:276-286).
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const sampleCursorRef = useRef(sampleCursor);
  sampleCursorRef.current = sampleCursor;
  const showSamplesRef = useRef(showSamples);
  showSamplesRef.current = showSamples;
  const graphsRef = useRef(graphs);
  graphsRef.current = graphs;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const isDetailRef = useRef(isDetail);
  isDetailRef.current = isDetail;
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const lineCountRef = useRef(0);
  lineCountRef.current = pane === 'diagram' ? diagram.length : issues.length;

  const handleInput = useCallback(
    (
      input: string,
      key: { escape: boolean; upArrow: boolean; downArrow: boolean; return: boolean },
    ) => {
      // ── detail ────────────────────────────────────────────────────────────
      if (isDetailRef.current) {
        if (key.escape) {
          onBack();
          return;
        }
        if (key.upArrow) {
          setOffset((o) => Math.max(0, o - 1));
          return;
        }
        if (key.downArrow) {
          setOffset((o) => Math.min(Math.max(0, lineCountRef.current - 1), o + 1));
          return;
        }
        if (input === 'v' || input === 'V') {
          setPane((p) => (p === 'diagram' ? 'issues' : 'diagram'));
          setOffset(0);
          return;
        }
        if (input === 'l' || input === 'L') {
          setNotice(null);
          setOffset(0);
          setReloadToken((n) => n + 1);
          return;
        }
        if (input === 'r' || input === 'R') {
          const current = graphRef.current;
          if (current) launch(current);
        }
        return;
      }

      // ── list → examples ───────────────────────────────────────────────────
      if (showSamplesRef.current) {
        if (key.escape) {
          setShowSamples(false);
          return;
        }
        if (key.upArrow) {
          setSampleCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.downArrow) {
          setSampleCursor((c) => Math.min(GRAPH_SAMPLES.length - 1, c + 1));
          return;
        }
        if (key.return) saveSample(sampleCursorRef.current);
        return;
      }

      // ── list ──────────────────────────────────────────────────────────────
      if (key.escape) {
        onBack();
        return;
      }
      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(Math.max(0, graphsRef.current.length - 1), c + 1));
        return;
      }
      if (input === 's' || input === 'S') {
        setNotice(null);
        setSampleCursor(0);
        setShowSamples(true);
        return;
      }
      if (key.return) {
        const row = graphsRef.current[cursorRef.current];
        if (row) onInspect(row.id);
        return;
      }
      if (input === 'r' || input === 'R') {
        const row = graphsRef.current[cursorRef.current];
        if (!row) return;
        if (!row.valid) {
          // The compiler THROWS on an invalid graph, so the run affordance must
          // never reach it. Say the reason instead of failing behind the scenes.
          const result = readGraph(repoRoot, row.id);
          const count = result.ok ? validateGraph(result.graph).errors.length : 1;
          setNotice({
            tone: 'error',
            text:
              count === 1
                ? t('tui.graph.blocked_one', { count })
                : t('tui.graph.blocked_other', { count }),
          });
          return;
        }
        launchById(row.id);
      }
    },
    [onBack, onInspect, launch, launchById, saveSample, repoRoot],
  );

  useInput(handleInput);

  const noticeBlock =
    notice === null ? null : (
      <Box marginTop={1}>
        <Text color={notice.tone === 'ok' ? theme.success : theme.error} wrap="wrap">
          {notice.text}
        </Text>
      </Box>
    );

  // ── examples library ──────────────────────────────────────────────────────
  if (!isDetail && showSamples) {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color={theme.ai}>{t('tui.graph.samples_title')}</Text>
          <Text dimColor wrap="wrap">{t('tui.graph.samples_subtitle')}</Text>

          <Box marginTop={1} flexDirection="column">
            {GRAPH_SAMPLES.map((sample, idx) => {
              const isCursor = idx === sampleCursor;
              return (
                <Box key={sample.id} flexDirection="column">
                  <Text color={isCursor ? theme.aiAccent : undefined} bold={isCursor}>
                    {isCursor ? '  › ' : '    '}
                    {sample.name}
                    <Text dimColor>{`  (${sample.id})`}</Text>
                  </Text>
                  {isCursor ? (
                    <Text dimColor wrap="wrap">{`      ${sample.description}`}</Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>

          {noticeBlock}

          <Box marginTop={1}>
            <ActionBar hints={sampleHints()} />
          </Box>
        </Box>
      </Box>
    );
  }

  // ── one graph, read out loud ──────────────────────────────────────────────
  if (isDetail) {
    if (!graph || !validation) {
      return (
        <Box flexDirection="column" width="100%">
          <Box borderStyle="round" borderColor="red" paddingX={1} flexDirection="column" width="100%">
            <Text bold color={theme.error}>{t('tui.graph.title')}</Text>
            <Text color={theme.error} wrap="wrap">
              {t('tui.graph.read_failed', {
                reason: loaded && !loaded.ok ? loaded.reason : graphId,
              })}
            </Text>
            <Box marginTop={1}>
              <ActionBar hints={detailHints('diagram', false)} />
            </Box>
          </Box>
        </Box>
      );
    }

    const lines = pane === 'diagram' ? diagram : issues;
    const size = pane === 'diagram' ? DIAGRAM_WINDOW : ISSUE_WINDOW;
    const { slice, start } = windowOf(lines, offset, size);
    const canRun = validation.ok;

    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color={theme.ai}>{header[0]}</Text>
          <Text dimColor>{header[1]}</Text>
          <Text color={canRun ? theme.success : theme.error}>{header[2]}</Text>
          {graph.description ? (
            <Box marginTop={1}>
              <Text dimColor wrap="wrap">{graph.description}</Text>
            </Box>
          ) : null}

          <Box marginTop={1} flexDirection="column">
            <Text bold color={pane === 'diagram' ? theme.aiAccent : theme.warning}>
              {pane === 'diagram'
                ? t('tui.graph.diagram_title')
                : t('tui.graph.issues_title', {
                    count: validation.errors.length + validation.warnings.length,
                  })}
            </Text>
            {start > 0 ? <Text dimColor>{`  ${t('common.more_up')}`}</Text> : null}
            {slice.map((line, i) => (
              <Text
                key={`${start + i}:${line}`}
                color={
                  pane === 'issues'
                    ? line.startsWith('✗')
                      ? theme.error
                      : line.startsWith('⚠')
                        ? theme.warning
                        : theme.success
                    : undefined
                }
                wrap="truncate-end"
              >
                {line}
              </Text>
            ))}
            {start + size < lines.length ? (
              <Text dimColor>{`  ${t('common.more_down')}`}</Text>
            ) : null}
          </Box>

          {noticeBlock}

          <Box marginTop={1}>
            <ActionBar hints={detailHints(pane, canRun)} />
          </Box>
        </Box>
      </Box>
    );
  }

  // ── the library ───────────────────────────────────────────────────────────
  const listStart = Math.min(
    Math.max(0, cursor - Math.floor(LIST_WINDOW / 2)),
    Math.max(0, graphs.length - LIST_WINDOW),
  );
  const visible = graphs.slice(listStart, listStart + LIST_WINDOW);
  const highlighted = graphs[cursor];

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color={theme.ai}>{t('tui.graph.title')}</Text>
        <Text dimColor wrap="wrap">{t('tui.graph.subtitle')}</Text>
        <Text dimColor>{t('tui.graph.dir', { dir: GRAPHS_DIR })}</Text>

        <Box marginTop={1} flexDirection="column">
          {graphs.length === 0 ? (
            <Text color={theme.warning} wrap="wrap">{t('tui.graph.empty')}</Text>
          ) : null}
          {listStart > 0 ? <Text dimColor>{`  ${t('common.more_up')}`}</Text> : null}
          {visible.map((row, i) => {
            const idx = listStart + i;
            const isCursor = idx === cursor;
            return (
              <Box key={row.id} flexDirection="column">
                <Text color={isCursor ? theme.aiAccent : undefined} bold={isCursor}>
                  {isCursor ? '  › ' : '    '}
                  {row.name}
                  <Text dimColor>{`  (${row.id})`}</Text>
                  {row.valid ? null : (
                    <Text color={theme.warning}>{`  ⚠ ${t('tui.graph.needs_fixing')}`}</Text>
                  )}
                </Text>
                <Text dimColor>
                  {`      ${t('tui.graph.row_meta', {
                    nodes: row.nodeCount,
                    edges: row.edgeCount,
                    updated: shortStamp(row.updatedAt),
                  })}`}
                </Text>
              </Box>
            );
          })}
          {listStart + LIST_WINDOW < graphs.length ? (
            <Text dimColor>{`  ${t('common.more_down')}`}</Text>
          ) : null}
        </Box>

        {highlighted?.description ? (
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">{highlighted.description}</Text>
          </Box>
        ) : null}

        {noticeBlock}

        <Box marginTop={1}>
          <ActionBar hints={listHints(highlighted?.valid === true)} />
        </Box>
      </Box>
    </Box>
  );
}
