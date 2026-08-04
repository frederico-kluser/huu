/* huu web UI — the popover the bolinha opens.
   ==========================================

   The whole interaction the user asked for: click the little dot on a node,
   see WHAT CAN COME NEXT, pick one, and the new node lands already connected.

   This file is the VIEW of that menu and nothing else. What to offer comes from
   `paletteFor`, how to bucket it from `groupPalette`, and what a click does
   from `applyPaletteChoice` — all three in `palette-model.js`, all three pure,
   all three pinned in Node. If a rule ever feels like it wants to live here,
   it is in the wrong file.

   TWO DECISIONS THAT LOOK LIKE DETAILS AND ARE NOT:

   1. A BLOCKED ITEM IS RENDERED, GREYED, WITH ITS REASON. `paletteFor` returns
      every item marked `disabled` with a `reason` rather than returning an
      empty list, precisely so the menu can teach the rule instead of appearing
      broken. Hiding those rows would throw away the one sentence that explains
      the way around ("this arm already goes to X — link it to ONE block and
      branch from there").

   2. A BLOCKED ROW STAYS CLICKABLE. It carries `aria-disabled`, never the
      `disabled` attribute, because a `disabled` button swallows the click and
      a human who clicks a greyed row deserves the refusal SAID OUT LOUD (the
      caller toasts `item.reason`), not silence. */

import {
  createElement as h,
  useEffect,
  useMemo,
  useRef,
  useState,
} from '../../vendor/reactflow.js';
import { groupPalette, paletteFor } from './palette-model.js';
import { t } from '../../i18n.js';

/** Keep the popover inside the window, with the same 12px margin on all sides. */
function clamp(value, size, viewport) {
  const max = Math.max(8, viewport - size - 12);
  return Math.max(8, Math.min(value, max));
}

/**
 * Where the popover is drawn, in viewport coordinates.
 *
 * @param {{x: number, y: number}} at the click position
 * @param {{width: number, height: number}} [viewport] injectable for tests —
 *   jsdom reports 1024×768 and a real browser reports whatever it is.
 */
export function palettePosition(at, viewport) {
  const w = (viewport && viewport.width) || 1024;
  const hgt = (viewport && viewport.height) || 768;
  return {
    left: clamp((at && at.x) || 0, 320, w),
    top: clamp(((at && at.y) || 0) + 8, 380, hgt),
  };
}

/**
 * The menu.
 *
 * @param {object} props
 * @param {Record<string, any>} props.graph the devgraph, for `paletteFor`
 * @param {Record<string, any>} [props.catalog] `/api/graphs/catalog` — with no
 *   catalog the palette is EMPTY, which is the honest failure and also the
 *   proof that no block list is hardcoded in the client
 * @param {{sourceId: string, sourceOutcome: string|null, x: number, y: number}} props.source
 * @param {(item: any) => void} props.onPick fired for enabled AND disabled rows
 * @param {() => void} props.onClose
 * @param {string} props.sourceLabel the node the bolinha belongs to
 * @param {string} [props.armLabel] the arm, when the source branches
 */
export function PaletteMenu(props) {
  const { graph, catalog, source, onPick, onClose } = props;
  const boxRef = useRef(null);

  const items = useMemo(
    () => paletteFor(graph, source.sourceId, source.sourceOutcome, catalog),
    [graph, catalog, source.sourceId, source.sourceOutcome],
  );
  const groups = useMemo(() => groupPalette(items), [items]);
  // Keyboard order must be READING order, and `groupPalette` may reorder rows
  // into their sections — so the arrow keys walk the GROUPED list, never the
  // flat one that came out of `paletteFor`.
  const flat = useMemo(() => {
    /** @type {any[]} */
    const out = [];
    for (const group of groups) for (const item of group.items) out.push(item);
    return out;
  }, [groups]);

  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive(0);
  }, [flat.length, source.sourceId, source.sourceOutcome]);

  // ESC closes, the arrows move, Enter picks. Bound on the DOCUMENT because the
  // popover is not what has focus — the click that opened it landed on a node.
  useEffect(() => {
    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
        return;
      }
      if (flat.length === 0) return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setActive((i) => (i + 1) % flat.length);
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setActive((i) => (i - 1 + flat.length) % flat.length);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const item = flat[active];
        if (item) onPick(item);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [flat, active, onPick, onClose]);

  // Click outside closes. `mousedown` (not `click`) so a drag that starts on
  // the canvas dismisses the menu before the pan begins; the capture phase so
  // React Flow cannot swallow it first.
  useEffect(() => {
    function onDown(ev) {
      const box = boxRef.current;
      if (box && ev.target instanceof Node && box.contains(ev.target)) return;
      onClose();
    }
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const at = palettePosition(
    { x: source.x, y: source.y },
    typeof window === 'undefined'
      ? undefined
      : { width: window.innerWidth, height: window.innerHeight },
  );

  const rows = [];
  let index = 0;
  for (const group of groups) {
    rows.push(
      h('div', { className: 'gph-palette__glabel', key: `g:${group.group}` }, group.group),
    );
    for (const item of group.items) {
      const i = index;
      index += 1;
      const classes = ['gph-palette__item'];
      if (item.disabled) classes.push('is-disabled');
      if (i === active) classes.push('is-active');
      rows.push(
        h(
          'button',
          {
            type: 'button',
            key: `${item.kind}:${item.id}`,
            className: classes.join(' '),
            'data-palette-id': item.id,
            'data-palette-kind': item.kind,
            'aria-disabled': item.disabled ? 'true' : 'false',
            onMouseEnter: () => setActive(i),
            onClick: (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onPick(item);
            },
          },
          h('span', { className: 'gph-palette__label' }, item.label || item.id),
          item.description
            ? h('span', { className: 'gph-palette__desc' }, item.description)
            : null,
          item.disabled && item.reason
            ? h('span', { className: 'gph-palette__reason' }, item.reason)
            : null,
        ),
      );
    }
  }

  return h(
    'div',
    {
      className: 'gph-palette',
      ref: boxRef,
      role: 'menu',
      'data-source-id': source.sourceId,
      'data-source-outcome': source.sourceOutcome || '',
      style: { left: `${at.left}px`, top: `${at.top}px` },
      onContextMenu: (ev) => ev.preventDefault(),
    },
    h(
      'div',
      { className: 'gph-palette__head' },
      h('div', { className: 'gph-palette__title' }, t('web.graph.palette.title')),
      h(
        'div',
        { className: 'gph-palette__from' },
        props.armLabel
          ? t('web.graph.palette.from_arm', {
              label: props.sourceLabel,
              arm: props.armLabel,
            })
          : t('web.graph.palette.from', { label: props.sourceLabel }),
      ),
    ),
    h(
      'div',
      { className: 'gph-palette__body' },
      rows.length > 0
        ? rows
        : h('div', { className: 'gph-palette__empty' }, t('web.graph.palette.empty')),
    ),
    h('div', { className: 'gph-palette__foot' }, t('web.graph.palette.hint')),
  );
}
