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
  directPredecessors,
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

/**
 * Which field carries a node's own text, per kind. The devgraph schema
 * (`graph-types.ts`) gives each kind exactly one, and the inspector edits that
 * one — `prompt` on an action is the OPTIONAL override of the block's template,
 * which is why clearing it DELETES the field instead of writing an empty string.
 */
const TEXT_FIELD = {
  prompt: 'goal',
  action: 'prompt',
  research: 'query',
  gate: 'condition',
};

/** Label for each of those fields. */
const TEXT_LABEL_KEY = {
  goal: 'web.graph.inspector.text_goal',
  prompt: 'web.graph.inspector.text_prompt',
  query: 'web.graph.inspector.text_query',
  condition: 'web.graph.inspector.text_condition',
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
 * One issue row. `code` is shown small and monospaced next to the sentence: it
 * is the SAME string the server reports and the one thing worth quoting when
 * asking for help.
 */
function issueItem(issue, index, sev, className) {
  return h(
    'li',
    { key: `${sev}:${index}`, className, 'data-sev': sev, 'data-code': issue.code || '' },
    issue.code ? h('code', { className: 'gph-global__code' }, issue.code) : null,
    issue.message || '',
  );
}

/**
 * The minimum inspector: rename a node, edit its own text, and set the JOIN.
 *
 * The full one (outcomes, fanOutFrom, live per-field validation) belongs to a
 * later wave; what is here is what makes the two things the user asked for
 * EDITABLE — the text of a step and what it waits for.
 *
 * @param {Record<string, any>} props
 */
function Inspector(props) {
  const { graph, node, errors, warnings, onPatch, onJoin, onDelete } = props;

  if (!node) {
    return h(
      'aside',
      { className: 'gph-inspector', 'data-empty': 'true' },
      h('div', { className: 'gph-inspector__title' }, t('web.graph.inspector.title')),
      h('div', { className: 'gph-inspector__empty' }, t('web.graph.inspector.empty')),
    );
  }

  const field = TEXT_FIELD[node.kind];
  const preds = directPredecessors(graph, node.id);
  const join = node.join && node.join.mode === 'subset' ? node.join : { mode: 'all' };
  const chosen = Array.isArray(join.of) ? join.of : [];

  /** Toggle one predecessor. Emptying the subset falls back to `all`, never to
   *  an empty subset — which is its own validator error (`join-subset-empty`)
   *  and the same repair `pruneDanglingRefs` performs server-side. */
  function togglePred(id) {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    onJoin(next.length > 0 ? { mode: 'subset', of: next } : { mode: 'all' });
  }

  const joinBody = [];
  if (node.kind === 'prompt') {
    joinBody.push(
      h('div', { className: 'gph-join__note', key: 'root' }, t('web.graph.inspector.join_root')),
    );
  } else if (preds.length === 0) {
    joinBody.push(
      h('div', { className: 'gph-join__note', key: 'none' }, t('web.graph.inspector.join_none')),
    );
  } else {
    joinBody.push(
      h(
        'label',
        { className: 'gph-join__opt', key: 'all' },
        h('input', {
          type: 'radio',
          name: 'gph-join',
          className: 'gph-join__all',
          checked: join.mode === 'all',
          onChange: () => onJoin({ mode: 'all' }),
        }),
        h('span', null, t('web.graph.inspector.join_all')),
      ),
      h(
        'label',
        { className: 'gph-join__opt', key: 'subset' },
        h('input', {
          type: 'radio',
          name: 'gph-join',
          className: 'gph-join__subset',
          checked: join.mode === 'subset',
          // Opening the subset with EVERY predecessor ticked changes nothing on
          // its own: the human then unticks what this step must not wait for,
          // so the relaxation is always something they did deliberately.
          onChange: () => onJoin({ mode: 'subset', of: preds.slice() }),
        }),
        h('span', null, t('web.graph.inspector.join_subset')),
      ),
      h(
        'div',
        { className: 'gph-join__preds', key: 'preds' },
        preds.map((id) => {
          const pred = nodeById(graph, id);
          return h(
            'label',
            { className: 'gph-join__pred', key: id },
            h('input', {
              type: 'checkbox',
              'data-pred': id,
              disabled: join.mode !== 'subset',
              checked: join.mode === 'all' || chosen.includes(id),
              onChange: () => togglePred(id),
            }),
            h('span', null, (pred && pred.label) || id, ' ', h('code', null, id)),
          );
        }),
      ),
    );
    if (join.mode === 'subset') {
      joinBody.push(
        h(
          'div',
          { className: 'gph-join__honest', key: 'honest' },
          t('web.graph.inspector.join_honest'),
        ),
      );
    }
  }

  const issueRows = [
    ...(errors || []).map((issue, i) => issueItem(issue, i, 'err', '')),
    ...(warnings || []).map((issue, i) => issueItem(issue, i, 'warn', '')),
  ];

  return h(
    'aside',
    { className: 'gph-inspector', 'data-node-id': node.id },
    h('div', { className: 'gph-inspector__title' }, t('web.graph.inspector.title')),

    h(
      'div',
      { className: 'gph-field' },
      h('label', { htmlFor: 'gphLabel' }, t('web.graph.inspector.label')),
      h('input', {
        id: 'gphLabel',
        type: 'text',
        className: 'gph-inspector__label',
        value: node.label || '',
        onChange: (ev) => onPatch({ label: ev.target.value }),
      }),
    ),

    field
      ? h(
          'div',
          { className: 'gph-field' },
          h('label', { htmlFor: 'gphText' }, t(TEXT_LABEL_KEY[field])),
          h('textarea', {
            id: 'gphText',
            className: 'gph-inspector__text',
            'data-field': field,
            value: typeof node[field] === 'string' ? node[field] : '',
            onChange: (ev) => {
              const value = ev.target.value;
              // An action's `prompt` is optional: emptying it must REMOVE the
              // override so the block's own template runs again. `updateNode`
              // deletes a field handed `undefined`.
              const optional = node.kind === 'action' && field === 'prompt';
              onPatch({ [field]: optional && value.trim() === '' ? undefined : value });
            },
          }),
        )
      : null,

    node.kind === 'action'
      ? h(
          'div',
          { className: 'gph-field' },
          h('label', null, t('web.graph.inspector.block')),
          h('div', { className: 'gph-panel__id' }, node.block || ''),
        )
      : null,

    h(
      'div',
      { className: 'gph-field' },
      h('label', null, t('web.graph.inspector.join')),
      h('div', { className: 'gph-join' }, joinBody),
    ),

    issueRows.length > 0
      ? h(
          'div',
          { className: 'gph-field' },
          h('label', null, t('web.graph.inspector.issues')),
          h('ul', { className: 'gph-issues' }, issueRows),
        )
      : null,

    node.kind === 'prompt'
      ? null
      : h(
          'button',
          {
            type: 'button',
            className: 'btn btn--danger btn--sm gph-inspector__delete',
            onClick: () => onDelete(node.id),
          },
          t('web.graph.inspector.delete'),
        ),
  );
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

  /* ── Derived: the drawing ──────────────────────────────────────────────── */
  const grouped = useMemo(() => groupIssues(check.errors, graph), [check.errors, graph]);
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

  const onSave = useCallback(async () => {
    setBusy('save');
    try {
      const res = await graphApi.save(graphRef.current, props.dir);
      // The STORE re-stamps `updatedAt`, so what came back is the truth.
      if (res && res.graph) setGraph(res.graph);
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
            h(
              'div',
              { className: 'gph-status', 'data-s': statusSeverity },
              h('span', { className: 'gph-status__dot' }),
              h('span', { className: 'gph-status__text' }, statusText),
            ),
            globalRows.length > 0
              ? h('ul', { className: 'gph-global' }, globalRows)
              : null,
          ),
        ),
      ),
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
      errors: selectedNode ? grouped.byNode[selectedNode.id] || [] : [],
      warnings: selectedNode ? groupedWarn.byNode[selectedNode.id] || [] : [],
      onPatch: patchNode,
      onJoin: joinNode,
      onDelete: deleteNode,
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
