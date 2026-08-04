/* huu web UI — how a devgraph node is DRAWN.
   =========================================

   One component per node kind, registered as React Flow's `nodeTypes`. They
   are the dumbest layer of the canvas on purpose: they receive a fully
   prepared `data` object and render it. No graph rule is evaluated here — not
   "may this connect", not "does this node branch", not "which arms does it
   have". Every one of those questions was already answered by
   `graph-model.js` before `canvas.js` handed the answer down, because a rule
   that lives inside a React component is a rule no test in this repo can
   reach.

   THE BOLINHA IS THE POINT OF THIS FILE. A node that branches gets ONE outbound
   handle PER ARM, each on its own labelled row, each opening the palette for
   that arm. A node that does not branch gets exactly one. That is the entire
   difference between "the gate routes approved one way and rework the other"
   and "three fronts leave this step in parallel", and it has to be legible
   before the human clicks anything.

   NO JSX, NO BUILD. `h` is `React.createElement`, and React itself comes from
   `vendor/reactflow.js` — importing `react` from anywhere else would put a
   SECOND React instance in the page and break hooks silently.

   `data` is prepared by `canvas.js` and carries:
     kind       the node kind, also the React Flow node `type`
     kindLabel  the catalog's human name for that kind
     label      the node's label
     node       the devgraph node itself (READ-ONLY — every edit goes through
                the pure mutations in graph-model.js)
     arms       `outcomesOf(node, catalog)` VERBATIM: `null` = one way out,
                an array = the arms it routes on (possibly empty, which is a
                defect the validator reports rather than something to hide)
     errors / warnings   this node's slice of `groupIssues`
     handlers   a STABLE object (a ref's current) — `{ openPalette }` */

import { createElement as h, memo, Handle, Position } from '../../vendor/reactflow.js';
import { t } from '../../i18n.js';

/** The kinds this module draws. Also the keys React Flow dispatches `type` on. */
export const DRAWN_NODE_KINDS = ['prompt', 'action', 'research', 'gate'];

/**
 * The one line under the label: the node's OWN text, whichever field carries
 * it for this kind. Not a summary and not a suggestion — the words the human
 * typed, so a card can be read without opening the inspector.
 *
 * @param {Record<string, any>} node
 * @returns {string}
 */
export function nodeSubtitle(node) {
  if (!node || typeof node !== 'object') return '';
  const pick = (value) => (typeof value === 'string' ? value.trim() : '');
  if (node.kind === 'prompt') return pick(node.goal);
  if (node.kind === 'research') return pick(node.query);
  if (node.kind === 'gate') return pick(node.condition);
  if (node.kind === 'action') return pick(node.prompt) || pick(node.block);
  return '';
}

/** The severity chip a node shows, or `null` when it has nothing to report. */
function badgeFor(errors, warnings) {
  const e = Array.isArray(errors) ? errors.length : 0;
  const w = Array.isArray(warnings) ? warnings.length : 0;
  if (e > 0) return { sev: 'err', count: e, title: t('web.graph.node.issues', { count: e }) };
  if (w > 0) return { sev: 'warn', count: w, title: t('web.graph.node.warnings', { count: w }) };
  return null;
}

/**
 * One outbound row: the arm's name and the bolinha that opens the palette for
 * it.
 *
 * The CLICK LIVES ON THE ROW, not on the dot. React Flow's handle owns
 * `mousedown` (that is how a connection is dragged), so a click that lands on
 * the dot bubbles up to this row and opens the palette anyway — while a click
 * on the label works identically. `nodrag` keeps the row from doubling as a
 * drag grip for the whole node.
 *
 * @param {{ id: string|null, label: string, nodeId: string, open: Function }} arm
 */
function armRow(arm) {
  const branching = arm.id !== null;
  return h(
    'div',
    {
      key: arm.id === null ? '__default__' : arm.id,
      className: 'gph-arm nodrag',
      role: 'button',
      tabIndex: 0,
      'data-arm': arm.id === null ? '' : arm.id,
      'data-node': arm.nodeId,
      title: branching
        ? t('web.graph.node.arm_open', { arm: arm.label })
        : t('web.graph.node.next_open'),
      onClick: (ev) => {
        ev.stopPropagation();
        arm.open(arm.nodeId, arm.id, ev);
      },
      onKeyDown: (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        ev.stopPropagation();
        arm.open(arm.nodeId, arm.id, ev);
      },
    },
    h('span', { className: 'gph-arm__label' }, arm.label),
    h('span', { className: 'gph-arm__plus', 'aria-hidden': 'true' }, '+'),
    // `id: undefined` is React Flow's DEFAULT handle — the same `null`
    // `sourceHandle` that `toFlow` puts on an edge with no arm. Handing it the
    // string 'null' instead would orphan every unbranched edge.
    h(Handle, {
      type: 'source',
      position: Position.Right,
      id: branching ? arm.id : undefined,
      className: 'gph-dot',
      isConnectable: true,
    }),
  );
}

/**
 * The shared card. Every kind renders this; only the accent class and the
 * catalog's kind name differ, which is what keeps four node types from
 * becoming four divergent layouts.
 */
function GraphNodeCard(props) {
  const data = props.data || {};
  const node = data.node || {};
  const kind = data.kind || node.kind || 'action';
  const arms = data.arms;
  const handlers = data.handlers || {};
  const open = typeof handlers.openPalette === 'function' ? handlers.openPalette : () => {};
  const badge = badgeFor(data.errors, data.warnings);
  const subtitle = nodeSubtitle(node);

  const classes = ['gph-node', `gph-node--${kind}`];
  if (props.selected) classes.push('is-selected');
  if (badge && badge.sev === 'err') classes.push('is-error');
  else if (badge) classes.push('is-warn');

  const rows = [];
  if (arms === null || arms === undefined) {
    rows.push(armRow({ id: null, label: t('web.graph.node.next'), nodeId: props.id, open }));
  } else {
    for (const arm of arms) {
      rows.push(
        armRow({
          id: arm.id,
          label: arm.label || arm.id,
          nodeId: props.id,
          open,
        }),
      );
    }
  }

  return h(
    'div',
    { className: classes.join(' '), 'data-node-id': props.id, 'data-kind': kind },
    // THE ROOT TAKES NO INBOUND EDGE. `prompt-has-inbound` is a validator rule,
    // and the drawing has to agree with it: no target handle means the human
    // cannot even attempt the connection the server would refuse.
    kind === 'prompt'
      ? null
      : h(Handle, {
          type: 'target',
          position: Position.Left,
          className: 'gph-node__in',
          'aria-label': t('web.graph.node.in'),
        }),
    h(
      'div',
      { className: 'gph-node__head' },
      h('span', { className: 'gph-node__kind' }, data.kindLabel || kind),
      badge
        ? h(
            'span',
            {
              className: 'gph-node__badge',
              'data-sev': badge.sev,
              title: badge.title,
            },
            String(badge.count),
          )
        : null,
    ),
    h('div', { className: 'gph-node__label' }, data.label || node.label || props.id),
    subtitle ? h('div', { className: 'gph-node__sub' }, subtitle) : null,
    h('div', { className: 'gph-node__arms' }, rows),
  );
}

/**
 * The `nodeTypes` map React Flow dispatches `node.type` on.
 *
 * Built ONCE by the caller and memoized: React Flow warns (and remounts every
 * node on every render) when this object's identity changes, which would kill
 * an open palette mid-click.
 *
 * @returns {Record<string, Function>}
 */
export function createNodeTypes() {
  const Card = memo(GraphNodeCard);
  /** @type {Record<string, any>} */
  const types = {};
  for (const kind of DRAWN_NODE_KINDS) types[kind] = Card;
  return types;
}
