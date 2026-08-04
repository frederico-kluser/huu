/* huu web UI — the method canvas (/graph).
   =======================================

   The surface the user asked for, in their words: "um pipeline de ações que se
   desenham como o n8n faz … eu clico na bolinha dele e aparece as opções que
   temos … posso definir quando rodam em paralelo simplesmente adicionando mais
   de uma do mesmo ponto de partida … e posso definir o que esperamos com join
   ou não."

   THE DEVGRAPH IS THE TRUTH; React Flow only draws it. `toFlow(graph, catalog)`
   derives what gets rendered, React Flow's change events come back through
   `fromFlowChanges`, and every mutation is one of the pure functions in
   `graph-model.js` / `palette-model.js`. This component decides NOTHING about
   graphs — it decides about pixels. That split is why the rules are testable in
   Node and why this file can be read in one sitting.

   THREE THINGS WORTH KNOWING BEFORE CHANGING ANYTHING HERE:

   1. THE CATALOG IS NOT OPTIONAL AND IS NEVER LOCAL. Blocks, node kinds and
      their labels come from `GET /api/graphs/catalog` — the one call that
      carries `promptTemplate`/`judgeClause`. `/api/bootstrap` serves a lighter
      projection for LISTING; it is not enough to EDIT. With no catalog the
      palette is empty, and that is the honest failure rather than a hardcoded
      list that can disagree with what actually runs.

   2. THE `global` ISSUE BUCKET NEEDS A PLACE THAT IS NOT A NODE. Almost every
      issue the validator reports carries a `nodeId` or an `edgeId` and paints
      that chip. `invalid-schema` does not — it arrives with no anchor because
      there is no single node to blame. A canvas that only knew how to
      highlight nodes would drop it and look green for a graph the store will
      refuse to save, so `groupIssues().global` gets its own list in the panel.

   3. A WARNING IS NOT A DEFECT. `join-subset-drops-barrier` is the EXPECTED
      answer for the very graph this screen exists to draw. It is reported in
      the advisory colour, counted separately, and never turns the status red.

   WHAT LIVES NEXT DOOR: `inspector.js` owns everything the human CONFIGURES —
   what a research node answers (`boolean`/`choice`/`info`), the behaviour tied
   to each output, the gate's outcomes, the action node's fan-out, the arm that
   goes back, and the method's life cycle (library, id, compile). This file owns
   the CANVAS and hands that module the graph plus the four seams it needs
   (`onPatch`, `onJoin`, `onGraph`, `onOpenPalette`). The split is what keeps
   both files readable in one sitting.

   NO JSX, NO BUILD, ONE REACT. `h` is `React.createElement` and React comes out
   of `vendor/reactflow.js`; importing `react` from anywhere else would put a
   second instance in the page and break hooks with no error message. */

import {
  createElement as h,
  createRoot,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
} from '../../vendor/reactflow.js';

import { $, S, api } from '../state.js';
import { toast } from '../utils.js';
import { t } from '../../i18n.js';
import { makeGraphApi } from './graph-api-client.js';
import {
  canConnect,
  connect,
  edgesOf,
  emptyGraph,
  fromFlowChanges,
  groupIssues,
  nodeById,
  nodesOf,
  outcomesOf,
  removeNode,
  setJoin,
  toFlow,
  updateNode,
} from './graph-model.js';
import { applyPaletteChoice } from './palette-model.js';
import { createNodeTypes } from './node-views.js';
import { PaletteMenu } from './palette.js';
import { CompileReport, GraphLibrary, Inspector, issueItem } from './inspector.js';

/**
 * The id a brand-new method opens with.
 *
 * A slug, because it NAMES THE FILE ON DISK (`graphIdIssue`), and deliberately
 * not translated: the same drawing must land on the same path whatever language
 * its author's browser is in. The NAME above it is chrome and is translated.
 */
const NEW_GRAPH_ID = 'novo-metodo';

/** How long the canvas sits still before it asks the server to re-validate. */
const VALIDATE_DEBOUNCE_MS = 400;

/** No compile has been asked for (or the drawing changed since the last one). */
const EMPTY_COMPILE = {
  state: 'idle',
  pipeline: null,
  message: '',
  errors: [],
  warnings: [],
};

/** The catalog's human name for a node kind, falling back to the raw kind. */
function kindLabelOf(catalog, kind) {
  const kinds = catalog && Array.isArray(catalog.kinds) ? catalog.kinds : [];
  const found = kinds.find((entry) => entry && entry.kind === kind);
  return (found && found.label) || kind;
}

/** The arm's own label, from what `outcomesOf` returned. */
function armLabelOf(arms, id) {
  if (!Array.isArray(arms) || !id) return '';
  const found = arms.find((arm) => arm && arm.id === id);
  return (found && (found.label || found.id)) || id;
}

/**
 * The name of the event the canvas fires when the human asks to RUN a drawing.
 *
 * A DOM event, and not a function call, for one structural reason: `launch.js`
 * imports this module (`initGraphSurface`), so importing `dev.js` — or
 * `launch.js` — from here would close an ESM cycle. The document is the one
 * seam both surfaces already share. `detail` carries `{id, name}`; the same
 * values are mirrored onto `S.devGraphId` / `S.devGraphName` so a listener that
 * wires up later still finds the selection.
 */
export const RUN_GRAPH_EVENT = 'huu:run-graph';

/**
 * Hand a SAVED drawing over to development mode.
 *
 * The canvas deliberately does NOT post `/api/dev` itself. A dev session needs
 * a goal, a project directory and a model routing, and all three already have
 * one owner — the /dev form. Starting from here would mean a second folder
 * browser, a second goal box and a second model panel that could disagree with
 * the first. So this only NAMES the method; `dev.js` pre-selects it and the
 * ordinary submit is what starts the session (carrying `graphId`, and never
 * `maxEpochs` — a drawn session is exactly one epoch).
 *
 * @param {{id?: string, name?: string}} graph
 */
export function runGraphInDevMode(graph) {
  const id = (graph && graph.id) || '';
  const name = (graph && graph.name) || id;
  if (!id) return false;
  S.devGraphId = id;
  S.devGraphName = name;
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return false;
  document.dispatchEvent(new CustomEvent(RUN_GRAPH_EVENT, { detail: { id, name } }));
  return true;
}

/**
 * Why the drawing cannot be run yet — or `null` when it can.
 *
 * PURE, and exported, because "what does this button refuse and why" is a rule,
 * not a pixel. Order matters: a broken method is a worse problem than an
 * unsaved one, and saying "save it first" about a graph with six errors would
 * send the human to the wrong repair.
 *
 * `saved` is REFERENCE equality against the last document that came off the
 * wire (save/open/from-sample), which is exactly "unchanged since the server
 * last saw it": every mutation in `graph-model.js` returns a new object. It
 * errs toward "unsaved", which is the harmless direction — `huu dev --graph`
 * reads the FILE, so running an edited-but-unsaved canvas would run the old
 * method with the new drawing on screen.
 *
 * @param {{state?: string, errors?: any[], warnings?: any[], message?: string} | null} check
 * @param {boolean} saved
 * @returns {string | null} the translated reason, or null when it may run
 */
export function runBlockedReason(check, saved) {
  const state = (check && check.state) || 'idle';
  const errors = (check && Array.isArray(check.errors) && check.errors) || [];
  if (state === 'idle' || state === 'pending') return t('web.graph.run_blocked_checking');
  if (state === 'failed') {
    return t('web.graph.run_blocked_check_failed', { message: (check && check.message) || '' });
  }
  if (errors.length > 0) return t('web.graph.run_blocked_invalid', { count: errors.length });
  if (!saved) return t('web.graph.run_blocked_unsaved');
  return null;
}

/**
 * The whole surface.
 *
 * Every dependency is INJECTED (`graphApi`, `toast`, `samples`, `initialGraph`,
 * `debounceMs`) so the component can be mounted for real in jsdom with a fake
 * transport — see `canvas.test.js`. `initGraphSurface()` below is the only
 * place that wires the real ones.
 *
 * @param {Record<string, any>} props
 */
export function GraphCanvasApp(props) {
  const graphApi = props.graphApi;
  const debounceMs =
    typeof props.debounceMs === 'number' ? props.debounceMs : VALIDATE_DEBOUNCE_MS;

  const [graph, setGraph] = useState(
    () => props.initialGraph || emptyGraph(NEW_GRAPH_ID, t('web.graph.untitled')),
  );
  const [catalog, setCatalog] = useState(props.catalog || null);
  const [selectedId, setSelectedId] = useState(null);
  const [palette, setPalette] = useState(null);
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState({ state: 'idle', errors: [], warnings: [], message: '' });
  // The compile answer is a SECOND source of anchored errors, and the reason
  // `/compile` bothers to return `errors[]` on a 400: the canvas paints the very
  // nodes that blocked it with no second round-trip. It is invalidated by any
  // edit, because a pipeline compiled from a drawing that has since changed is
  // a claim about a method nobody is looking at.
  const [compile, setCompile] = useState(EMPTY_COMPILE);
  // The last document that came OFF THE WIRE — a save's answer, a graph opened
  // from the library, a sample the server materialised. It is the only honest
  // answer to "is what I see on disk?", and it starts as `null` on purpose: a
  // canvas restored from `S.graphDoc` after a view swap cannot prove anything
  // about the file, and "save it again" costs one click while running the wrong
  // method costs an epoch.
  const [savedDoc, setSavedDoc] = useState(null);

  // Latest-value refs so every handler below can be created ONCE. React Flow
  // remounts a node whose `nodeTypes` or callbacks change identity, and a
  // remount mid-click closes the palette the click just opened.
  const graphRef = useRef(graph);
  const catalogRef = useRef(catalog);
  const paletteRef = useRef(palette);
  const notifyRef = useRef(/** @type {(msg: string, isErr?: boolean) => void} */ (() => {}));
  graphRef.current = graph;
  catalogRef.current = catalog;
  paletteRef.current = palette;
  notifyRef.current = typeof props.toast === 'function' ? props.toast : () => {};

  /* ── The catalog: the palette's only source of blocks and labels ────────── */
  useEffect(() => {
    if (catalog || !graphApi || typeof graphApi.catalog !== 'function') return undefined;
    let alive = true;
    graphApi
      .catalog()
      .then((payload) => {
        if (!alive) return;
        setCatalog(payload);
        if (props.onCatalog) props.onCatalog(payload);
      })
      .catch((err) => {
        if (!alive) return;
        notifyRef.current(t('web.graph.catalog_failed', { message: err.message }), true);
      });
    return () => {
      alive = false;
    };
    // Runs once: a catalog that failed to load is retried by reopening the view.
  }, []);

  /* ── Validation: the server decides, on every change, debounced ─────────── */
  const seqRef = useRef(0);
  const runValidate = useCallback(
    async (doc) => {
      if (!graphApi || typeof graphApi.validate !== 'function') return;
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      setCheck((prev) => ({ ...prev, state: 'pending' }));
      try {
        const res = await graphApi.validate(doc);
        // A slower answer to an OLDER graph must never overwrite a newer one.
        if (seq !== seqRef.current) return;
        setCheck({
          state: 'done',
          errors: Array.isArray(res && res.errors) ? res.errors : [],
          warnings: Array.isArray(res && res.warnings) ? res.warnings : [],
          message: '',
        });
      } catch (err) {
        if (seq !== seqRef.current) return;
        setCheck({ state: 'failed', errors: [], warnings: [], message: err.message || '' });
      }
    },
    [graphApi],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void runValidate(graph);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [graph, runValidate, debounceMs]);

  useEffect(() => {
    if (props.onGraphChange) props.onGraphChange(graph);
  }, [graph]);

  // Any edit retires the compile answer, errors included.
  useEffect(() => {
    setCompile((prev) => (prev.state === 'idle' ? prev : EMPTY_COMPILE));
  }, [graph]);

  /* ── Derived: the drawing ──────────────────────────────────────────────── */
  // The two error sources are ONE list before grouping, so a node blamed by both
  // the validator and the compiler is still one chip with one badge count.
  const allErrors = useMemo(
    () => (compile.errors.length > 0 ? [...check.errors, ...compile.errors] : check.errors),
    [check.errors, compile.errors],
  );
  const grouped = useMemo(() => groupIssues(allErrors, graph), [allErrors, graph]);
  const groupedWarn = useMemo(() => groupIssues(check.warnings, graph), [check.warnings, graph]);
  const flow = useMemo(() => toFlow(graph, catalog), [graph, catalog]);
  const nodeTypes = useMemo(() => createNodeTypes(), []);

  // A STABLE object handed to every node through `data`. The node views call
  // `data.handlers.openPalette(...)`; because the object never changes
  // identity, React Flow does not remount a card between the click that opens
  // the palette and the render that shows it.
  const handlers = useRef({ openPalette: () => {} });

  const rfNodes = useMemo(
    () =>
      flow.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedId,
        data: {
          ...node.data,
          // `outcomesOf` VERBATIM: `null` means one way out, an array means it
          // branches. The node view never re-derives this — that is the rule
          // and the rule lives in graph-model.js.
          arms: outcomesOf(node.data.node, catalog),
          kindLabel: kindLabelOf(catalog, node.data.kind),
          errors: grouped.byNode[node.id] || [],
          warnings: groupedWarn.byNode[node.id] || [],
          handlers: handlers.current,
        },
      })),
    [flow, selectedId, catalog, grouped, groupedWarn],
  );

  const rfEdges = useMemo(
    () =>
      flow.edges.map((edge) => {
        const classes = [edge.className || ''];
        if (grouped.byEdge[edge.id]) classes.push('gph-edge-error');
        else if (groupedWarn.byEdge[edge.id]) classes.push('gph-edge-warn');
        return {
          ...edge,
          className: classes.filter(Boolean).join(' ') || undefined,
          markerEnd: { type: MarkerType.ArrowClosed },
        };
      }),
    [flow, grouped, groupedWarn],
  );

  /* ── Handlers ──────────────────────────────────────────────────────────── */
  const openPalette = useCallback((sourceId, sourceOutcome, ev) => {
    setPalette({
      sourceId,
      sourceOutcome: sourceOutcome || null,
      x: (ev && ev.clientX) || 0,
      y: (ev && ev.clientY) || 0,
    });
  }, []);
  handlers.current.openPalette = openPalette;

  const closePalette = useCallback(() => setPalette(null), []);

  const pickPaletteItem = useCallback((item) => {
    const source = paletteRef.current;
    if (!source) return;
    // A greyed row is still clickable ON PURPOSE: the refusal has to be SAID,
    // and `paletteFor` already wrote the sentence that teaches the way around.
    if (item && item.disabled) {
      notifyRef.current(item.reason || t('web.graph.palette.blocked'), true);
      return;
    }
    const res = applyPaletteChoice(
      graphRef.current,
      source.sourceId,
      source.sourceOutcome,
      item,
    );
    if (res.error) {
      notifyRef.current(res.error.message, true);
      return;
    }
    setGraph(res.graph);
    setSelectedId(res.nodeId || null);
    setPalette(null);
  }, []);

  const onNodesChange = useCallback((changes) => {
    setGraph((current) => fromFlowChanges(current, changes));
  }, []);

  const onEdgesChange = useCallback((changes) => {
    setGraph((current) => fromFlowChanges(current, changes));
  }, []);

  const onConnect = useCallback((params) => {
    const res = connect(graphRef.current, params.source, params.target, {
      sourceOutcome: params.sourceHandle || undefined,
      catalog: catalogRef.current,
    });
    // The refusal MESSAGE is the product here: `canConnect` writes the sentence
    // that says why and what to do instead, so it is shown verbatim.
    if (res.error) {
      notifyRef.current(res.error.message, true);
      return;
    }
    setGraph(res.graph);
  }, []);

  const isValidConnection = useCallback(
    (connection) =>
      canConnect(graphRef.current, connection.source, connection.target, {
        sourceOutcome: connection.sourceHandle || undefined,
        catalog: catalogRef.current,
      }).ok,
    [],
  );

  const onNodeClick = useCallback((_ev, node) => setSelectedId(node.id), []);
  const onPaneClick = useCallback(() => {
    setSelectedId(null);
    setPalette(null);
  }, []);

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const patchNode = useCallback((patch) => {
    const id = selectedRef.current;
    if (!id) return;
    setGraph((current) => updateNode(current, id, patch));
  }, []);

  const joinNode = useCallback((join) => {
    const id = selectedRef.current;
    if (!id) return;
    setGraph((current) => setJoin(current, id, join));
  }, []);

  const deleteNode = useCallback((id) => {
    setGraph((current) => removeNode(current, id));
    setSelectedId(null);
  }, []);

  /**
   * A whole new graph, from the inspector's composite edits.
   *
   * Switching a research node's output kind is `updateNode` PLUS one `removeEdge`
   * per orphaned arm; the inspector composes them off the graph it was rendered
   * with and hands the result back here. Every one of those steps is still a
   * `graph-model.js` mutation — this seam only carries the result.
   */
  const applyGraph = useCallback((next) => {
    setGraph(next);
  }, []);

  /** Adopt a graph that came off the wire (the library, a sample). */
  const adoptGraph = useCallback((doc) => {
    if (!doc) return;
    setGraph(doc);
    // It came from the store, so it IS the file — that is what makes "open it
    // from the library, press Run" work without a pointless re-save.
    setSavedDoc(doc);
    setSelectedId(null);
    setPalette(null);
  }, []);

  const onCompile = useCallback(async () => {
    if (!graphApi || typeof graphApi.compile !== 'function') return;
    setCompile({ ...EMPTY_COMPILE, state: 'busy' });
    try {
      const res = await graphApi.compile(graphRef.current, {});
      if (res && res.ok) {
        setCompile({
          state: 'ok',
          pipeline: res.pipeline || null,
          message: '',
          errors: [],
          warnings: Array.isArray(res.warnings) ? res.warnings : [],
        });
        return;
      }
      // `errors[]` is ADDITIVE on the 400 exactly so the culprits can be painted
      // instead of summarised in a sentence nobody can locate on the canvas.
      setCompile({
        state: 'failed',
        pipeline: null,
        message: (res && res.error) || '',
        errors: Array.isArray(res && res.errors) ? res.errors : [],
        warnings: Array.isArray(res && res.warnings) ? res.warnings : [],
      });
    } catch (err) {
      setCompile({ ...EMPTY_COMPILE, state: 'failed', message: err.message || '' });
    }
  }, [graphApi]);

  const onSave = useCallback(async () => {
    setBusy('save');
    try {
      const res = await graphApi.save(graphRef.current, props.dir);
      // The STORE re-stamps `updatedAt`, so what came back is the truth.
      if (res && res.graph) {
        setGraph(res.graph);
        setSavedDoc(res.graph);
      }
      notifyRef.current(
        t('web.graph.saved', { name: (res && res.graph && res.graph.name) || '' }),
      );
    } catch (err) {
      notifyRef.current(t('web.graph.save_failed', { message: err.message }), true);
    } finally {
      setBusy('');
    }
  }, [graphApi, props.dir]);

  const onOpenSample = useCallback(
    async (sampleId) => {
      if (!sampleId) return;
      setBusy('sample');
      try {
        const res = await graphApi.fromSample(sampleId, { dir: props.dir });
        // NEVER navigate by the id you asked for: the store suffixes a taken id
        // and answers with the graph that actually reached the disk.
        if (res && res.graph) {
          setGraph(res.graph);
          // `/from-sample` WRITES the graph before answering, so it is on disk.
          setSavedDoc(res.graph);
          setSelectedId(null);
        }
      } catch (err) {
        notifyRef.current(t('web.graph.sample_failed', { message: err.message }), true);
      } finally {
        setBusy('');
      }
    },
    [graphApi, props.dir],
  );

  /* ── Status line ───────────────────────────────────────────────────────── */
  let statusSeverity = 'ok';
  let statusText = t('web.graph.status_ok');
  if (check.state === 'pending' || check.state === 'idle') {
    statusSeverity = 'pending';
    statusText = t('web.graph.status_checking');
  } else if (check.state === 'failed') {
    statusSeverity = 'err';
    statusText = t('web.graph.validate_failed', { message: check.message });
  } else if (check.errors.length > 0) {
    statusSeverity = 'err';
    statusText = t('web.graph.status_errors', { count: check.errors.length });
  } else if (check.warnings.length > 0) {
    // A WARNING IS AN ANSWER, NOT A DEFECT.
    statusSeverity = 'warn';
    statusText = t('web.graph.status_warnings', { count: check.warnings.length });
  }

  const globalRows = [
    ...grouped.global.map((issue, i) => issueItem(issue, i, 'err', 'gph-global__item')),
    ...groupedWarn.global.map((issue, i) => issueItem(issue, i, 'warn', 'gph-global__item')),
  ];

  /* ── Running it ────────────────────────────────────────────────────────────
     The refusal is computed on the CLIENT even though the server would refuse
     too (`graph-not-found` / `graph-invalid` on `POST /api/dev`): a disabled
     button with the reason under it answers before the round-trip, and names
     the repair instead of a stop code. */
  const runBlocked = runBlockedReason(check, savedDoc !== null && savedDoc === graph);
  const onRun = typeof props.onRun === 'function' ? props.onRun : runGraphInDevMode;

  const selectedNode = nodeById(graph, selectedId);
  const paletteNode = palette ? nodeById(graph, palette.sourceId) : null;
  const paletteArms = paletteNode ? outcomesOf(paletteNode, catalog) : null;

  return h(
    'div',
    { className: 'gph-shell' },
    h(
      'div',
      { className: 'gph-flow' },
      h(
        ReactFlowProvider,
        null,
        h(
          ReactFlow,
          {
            nodes: rfNodes,
            edges: rfEdges,
            nodeTypes,
            onNodesChange,
            onEdgesChange,
            onConnect,
            isValidConnection,
            onNodeClick,
            onPaneClick,
            fitView: true,
            minZoom: 0.2,
            maxZoom: 2,
          },
          h(Background, { variant: BackgroundVariant.Dots, gap: 22, size: 1 }),
          h(Controls, null),
          h(MiniMap, { pannable: true, zoomable: true }),
          h(
            Panel,
            { position: 'top-left', className: 'gph-panel' },
            h(
              'div',
              { className: 'gph-panel__row' },
              h('input', {
                type: 'text',
                className: 'gph-panel__name',
                'aria-label': t('web.graph.name_label'),
                value: graph.name || '',
                onChange: (ev) => {
                  const name = ev.target.value;
                  setGraph((current) => ({ ...current, name }));
                },
              }),
              h(
                'span',
                { className: 'gph-panel__id', title: t('web.graph.id_title') },
                graph.id || '',
              ),
            ),
            h(
              'div',
              { className: 'gph-panel__row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn--primary btn--sm gph-panel__save',
                  disabled: busy !== '',
                  onClick: () => {
                    void onSave();
                  },
                },
                busy === 'save' ? t('web.graph.saving') : t('web.graph.save'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn--ghost btn--sm gph-panel__check',
                  onClick: () => {
                    void runValidate(graphRef.current);
                  },
                },
                t('web.graph.validate'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn--ghost btn--sm gph-panel__compile',
                  disabled: compile.state === 'busy',
                  onClick: () => {
                    void onCompile();
                  },
                },
                compile.state === 'busy' ? t('web.graph.compiling') : t('web.graph.compile'),
              ),
              h(
                'select',
                {
                  className: 'gph-panel__select',
                  'aria-label': t('web.graph.sample_label'),
                  value: '',
                  disabled: busy !== '',
                  onChange: (ev) => {
                    const id = ev.target.value;
                    ev.target.value = '';
                    void onOpenSample(id);
                  },
                },
                h('option', { value: '' }, t('web.graph.sample_placeholder')),
                (props.samples || []).map((sample) =>
                  h('option', { key: sample.id, value: sample.id, title: sample.description }, sample.name),
                ),
              ),
              h(
                'span',
                { className: 'gph-panel__count' },
                t('web.graph.node_count', {
                  nodes: nodesOf(graph).length,
                  edges: edgesOf(graph).length,
                }),
              ),
            ),
            h(GraphLibrary, {
              graph,
              graphApi,
              dir: props.dir,
              onOpenGraph: adoptGraph,
              onNotify: (message, isErr) => notifyRef.current(message, isErr),
            }),
            h(
              'div',
              { className: 'gph-status', 'data-s': statusSeverity },
              h('span', { className: 'gph-status__dot' }),
              h('span', { className: 'gph-status__text' }, statusText),
            ),
            h(
              'div',
              { className: 'gph-run' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn--primary btn--sm gph-run__btn',
                  disabled: runBlocked !== null,
                  title: runBlocked || t('web.graph.run_title'),
                  onClick: () => {
                    const doc = graphRef.current;
                    onRun(doc);
                    notifyRef.current(
                      t('web.graph.run_handoff', { name: doc.name || doc.id || '' }),
                    );
                  },
                },
                t('web.graph.run'),
              ),
              h(
                'span',
                {
                  className: 'gph-run__why',
                  'data-blocked': runBlocked === null ? '0' : '1',
                },
                runBlocked === null ? t('web.graph.run_ready') : runBlocked,
              ),
            ),
            globalRows.length > 0
              ? h('ul', { className: 'gph-global' }, globalRows)
              : null,
          ),
        ),
      ),
      h(CompileReport, {
        result: compile,
        onClose: () => setCompile(EMPTY_COMPILE),
      }),
      palette && paletteNode
        ? h(PaletteMenu, {
            graph,
            catalog,
            source: palette,
            sourceLabel: paletteNode.label || paletteNode.id,
            armLabel: armLabelOf(paletteArms, palette.sourceOutcome),
            onPick: pickPaletteItem,
            onClose: closePalette,
          })
        : null,
    ),
    h(Inspector, {
      graph,
      node: selectedNode,
      catalog,
      errors: selectedNode ? grouped.byNode[selectedNode.id] || [] : [],
      warnings: selectedNode ? groupedWarn.byNode[selectedNode.id] || [] : [],
      onPatch: patchNode,
      onJoin: joinNode,
      onGraph: applyGraph,
      onDelete: deleteNode,
      onNotify: (message, isErr) => notifyRef.current(message, isErr),
      onOpenPalette: openPalette,
    }),
  );
}

/**
 * Render the canvas into a container.
 *
 * Separated from `initGraphSurface` so tests can mount the REAL component with
 * a fake transport and no `index.html`.
 *
 * @param {Element} container
 * @param {Record<string, any>} deps
 */
export function mountGraphCanvas(container, deps) {
  const root = createRoot(container);
  root.render(h(GraphCanvasApp, deps || {}));
  return {
    root,
    unmount() {
      root.unmount();
    },
  };
}

/**
 * Wire the /graph surface to the live app.
 *
 * IDEMPOTENT and LAZY, exactly like `initDevSurface`: `switchMode` calls it the
 * first time the human actually opens the canvas, and the `S.graphBooted` guard
 * makes every later call a no-op. Nothing here runs at import time — this
 * module has no top-level side effect, so importing it cannot boot the app a
 * second time.
 */
export function initGraphSurface() {
  if (S.graphBooted) return null;
  const host = $('graphCanvasHost');
  if (!host) return null;
  S.graphBooted = true;
  S.graphDir = S.graphDir || S.cwd || '';
  const mounted = mountGraphCanvas(host, {
    graphApi: makeGraphApi(api),
    dir: S.graphDir,
    // `/api/bootstrap` is the right source for LISTING the samples (it carries
    // the light projection); the full catalog is fetched by the component.
    samples: (S.boot && S.boot.graphSamples) || [],
    initialGraph: S.graphDoc || emptyGraph(NEW_GRAPH_ID, t('web.graph.untitled')),
    toast,
    onGraphChange: (doc) => {
      S.graphDoc = doc;
    },
    onCatalog: (payload) => {
      S.graphCatalog = payload;
    },
  });
  S.graphMount = mounted;
  return mounted;
}
