import { describe, expect, it } from 'vitest';
import {
  PanelContainer,
  mergeStoredOrder,
  parseStoredState,
  reorderArray,
} from './collapsible-panels.js';

/* The component touches the DOM only at call time and huu's client tests run
   in Node with no jsdom — so the class is exercised against a minimal element
   shim that implements just the DOM surface the component uses. The pure
   helpers above the class are tested as plain functions. */

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attrs = new Map();
    this.parentNode = null;
    this.ownerDocument = /** @type {any} */ (null);
    this.hidden = false;
    this.textContent = '';
    this.draggable = false;
    this.type = '';
    this._cls = new Set();
    this._handlers = {};
  }

  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }

  get classList() {
    const self = this;
    const sync = () => { this.className = [...this._cls].join(' '); };
    return {
      add: (...cs) => { for (const c of cs) self._cls.add(c); sync(); },
      remove: (...cs) => { for (const c of cs) self._cls.delete(c); sync(); },
      contains: (c) => self._cls.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !self._cls.has(c) : !!force;
        if (on) self._cls.add(c); else self._cls.delete(c);
        sync();
        return on;
      },
    };
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  addEventListener(type, fn) {
    (this._handlers[type] || (this._handlers[type] = [])).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this._handlers[type];
    if (list) {
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    }
  }

  dispatchEvent(ev) {
    const list = this._handlers[ev.type];
    if (list) for (const fn of list.slice()) fn(ev);
    return true;
  }

  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }

  matches(sel) {
    return sel.startsWith('.') && this.classList.contains(sel.slice(1));
  }

  closest(sel) {
    let node = this;
    while (node) {
      if (node.matches(sel)) return node;
      node = node.parentNode;
    }
    return null;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }
}

function setup(opts = {}) {
  const doc = {
    createElement(tag) {
      const el = new FakeEl(tag);
      el.ownerDocument = doc;
      return el;
    },
  };
  const container = doc.createElement('div');
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const panels = new PanelContainer(container, { storage, ...opts });
  return { doc, container, storage, store, panels };
}

const content = (c) => c.ownerDocument.createElement('div');

describe('reorderArray', () => {
  it('moves an item to a later index', () => {
    expect(reorderArray(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves an item to an earlier index', () => {
    expect(reorderArray(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('accepts length as the insertion index (append)', () => {
    expect(reorderArray(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op for same index and out-of-range indexes', () => {
    expect(reorderArray(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    expect(reorderArray(['a', 'b', 'c'], -1, 1)).toEqual(['a', 'b', 'c']);
    expect(reorderArray(['a', 'b', 'c'], 3, 1)).toEqual(['a', 'b', 'c']);
    expect(reorderArray(['a', 'b', 'c'], 1, 4)).toEqual(['a', 'b', 'c']);
  });

  it('never mutates the input array', () => {
    const arr = ['a', 'b', 'c'];
    reorderArray(arr, 0, 2);
    expect(arr).toEqual(['a', 'b', 'c']);
  });
});

describe('mergeStoredOrder', () => {
  it('applies the stored order when all ids are known', () => {
    expect(mergeStoredOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('drops stale ids and appends new ones in insertion order', () => {
    expect(mergeStoredOrder(['a', 'b', 'c'], ['x', 'c', 'a', 'y'])).toEqual(['c', 'a', 'b']);
  });

  it('drops non-string stored ids', () => {
    expect(mergeStoredOrder(['a'], [7, 'a'])).toEqual(['a']);
  });

  it('dedupes stored ids', () => {
    expect(mergeStoredOrder(['a', 'b'], ['b', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('falls back to insertion order for missing or corrupt storage', () => {
    expect(mergeStoredOrder(['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c']);
    expect(mergeStoredOrder(['a', 'b', 'c'], 'nope')).toEqual(['a', 'b', 'c']);
  });
});

describe('parseStoredState', () => {
  it('parses a {id: boolean} payload', () => {
    expect(parseStoredState('{"a":true,"b":false}')).toEqual({ a: true, b: false });
  });

  it('coerces truthy values to booleans', () => {
    expect(parseStoredState('{"a":1,"b":0}')).toEqual({ a: true, b: false });
  });

  it('yields {} for corrupt JSON, arrays, primitives and null', () => {
    expect(parseStoredState('not json')).toEqual({});
    expect(parseStoredState('[1,2]')).toEqual({});
    expect(parseStoredState('"s"')).toEqual({});
    expect(parseStoredState('null')).toEqual({});
    expect(parseStoredState(null)).toEqual({});
    expect(parseStoredState(undefined)).toEqual({});
  });
});

describe('PanelContainer', () => {
  it('rejects non-element containers and duplicate ids', () => {
    expect(() => new PanelContainer(null)).toThrow();
    expect(() => new PanelContainer({})).toThrow();
    const { container, panels } = setup();
    panels.addPanel('A', content(container));
    expect(() => panels.addPanel('B', content(container), { id: 'cp-panel-1' })).toThrow();
  });

  it('addPanel builds the full panel structure and returns its id', () => {
    const { container, panels } = setup();
    const contentEl = content(container);
    const id = panels.addPanel('Mission', contentEl, { badge: 'running' });
    expect(id).toBe('cp-panel-1');
    expect(panels.getPanelOrder()).toEqual([id]);
    expect(container.classList.contains('cp-container')).toBe(true);

    const root = container.children[0];
    expect(root.classList.contains('cp-panel')).toBe(true);
    expect(root.dataset.cpId).toBe(id);

    const header = root.children[0];
    expect(header.classList.contains('cp-header')).toBe(true);
    expect(header.children[0].classList.contains('cp-title')).toBe(true);
    expect(header.children[0].textContent).toBe('Mission');
    expect(header.children[1].classList.contains('cp-badge')).toBe(true);
    expect(header.children[1].dataset.s).toBe('running');
    expect(header.children[2].classList.contains('cp-toggle')).toBe(true);
    expect(header.children[2].getAttribute('aria-expanded')).toBe('true');
    expect(header.children[3].classList.contains('cp-handle')).toBe(true);
    expect(header.children[3].draggable).toBe(true);

    const body = root.children[1];
    expect(body.classList.contains('cp-body')).toBe(true);
    expect(contentEl.parentNode).toBe(body);
  });

  it('hides the badge when no status is given', () => {
    const { container, panels } = setup();
    panels.addPanel('T', content(container));
    const badge = container.children[0].children[0].children[1];
    expect(badge.hidden).toBe(true);
    expect(badge.dataset.s).toBeUndefined();
  });

  it('collapsePanel/expandPanel animate max-height and persist state', async () => {
    const { container, store, panels } = setup({ transitionMs: 30 });
    const id = panels.addPanel('T', content(container));
    const root = container.children[0];
    const body = root.children[1];
    const toggle = root.children[0].children[2];

    panels.collapsePanel(id);
    expect(root.classList.contains('cp-collapsed')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.style.maxHeight).toBe('0px');
    expect(body.style.overflow).toBe('hidden');
    expect(JSON.parse(store.get('huu-panel-state'))).toEqual({ [id]: true });

    panels.expandPanel(id);
    expect(root.classList.contains('cp-collapsed')).toBe(false);
    expect(body.style.maxHeight).toBe('var(--cp-body-max-h, 42vh)');
    expect(body.style.overflow).toBe('hidden');

    // the transition settles: inline max-height is released back to CSS
    await new Promise((r) => setTimeout(r, 120));
    expect(body.style.maxHeight).toBe('');
    expect(body.style.overflow).toBe('');
    expect(JSON.parse(store.get('huu-panel-state'))).toEqual({ [id]: false });
  });

  it('collapses and expands instantly when transitionMs is 0', () => {
    const { container, panels } = setup({ transitionMs: 0 });
    const id = panels.addPanel('T', content(container));
    const body = container.children[0].children[1];
    panels.collapsePanel(id);
    expect(body.style.maxHeight).toBe('0px');
    expect(body.style.overflow).toBe('hidden');
    panels.expandPanel(id);
    expect(body.style.maxHeight).toBe('');
    expect(body.style.overflow).toBe('');
  });

  it('starts collapsed when opts.collapsed is set', () => {
    const { container, store, panels } = setup();
    const id = panels.addPanel('A', content(container), { collapsed: true });
    expect(container.children[0].classList.contains('cp-collapsed')).toBe(true);
    expect(JSON.parse(store.get('huu-panel-state'))).toEqual({ [id]: true });
  });

  it('setStatus updates the badge live and hides it when cleared', () => {
    const { container, panels } = setup();
    const id = panels.addPanel('T', content(container));
    const badge = container.children[0].children[0].children[1];
    panels.setStatus(id, 'error');
    expect(badge.hidden).toBe(false);
    expect(badge.dataset.s).toBe('error');
    expect(badge.textContent).toBe('error');
    panels.setStatus(id, null);
    expect(badge.hidden).toBe(true);
    expect(badge.dataset.s).toBeUndefined();
  });

  it('movePanel reorders the DOM, persists, and notifies listeners', () => {
    const { container, store, panels } = setup();
    const seen = [];
    panels.onOrderChange((order) => seen.push(order));
    const a = panels.addPanel('A', content(container));
    const b = panels.addPanel('B', content(container));
    const c = panels.addPanel('C', content(container));

    panels.movePanel(c, 0);
    expect(panels.getPanelOrder()).toEqual([c, a, b]);
    expect(container.children.map((el) => el.dataset.cpId)).toEqual([c, a, b]);
    expect(JSON.parse(store.get('huu-panel-order'))).toEqual([c, a, b]);
    expect(seen[seen.length - 1]).toEqual([c, a, b]);

    // listeners receive a copy — mutating it must not touch internal state
    seen[seen.length - 1].push('mutated');
    expect(panels.getPanelOrder()).toEqual([c, a, b]);

    // out-of-range index is clamped, unknown id is a no-op
    panels.movePanel(a, 99);
    expect(panels.getPanelOrder()).toEqual([c, b, a]);
    panels.movePanel('nope', 0);
    expect(panels.getPanelOrder()).toEqual([c, b, a]);
  });

  it('removePanel drops the node, order entry and persisted state', () => {
    const { container, store, panels } = setup();
    const a = panels.addPanel('A', content(container));
    const b = panels.addPanel('B', content(container));
    panels.collapsePanel(b);
    panels.removePanel(b);
    expect(container.children.map((el) => el.dataset.cpId)).toEqual([a]);
    expect(panels.getPanelOrder()).toEqual([a]);
    expect(JSON.parse(store.get('huu-panel-order'))).toEqual([a]);
    expect(JSON.parse(store.get('huu-panel-state'))).toEqual({ [a]: false });
    panels.removePanel('nope'); // unknown id is a silent no-op
  });

  it('restores persisted order and collapsed state on a fresh container', () => {
    const { container, store, panels } = setup();
    const a = panels.addPanel('A', content(container));
    panels.collapsePanel(a);
    const b = panels.addPanel('B', content(container));
    panels.movePanel(b, 0); // order: [b, a]

    const container2 = container.ownerDocument.createElement('div');
    const panels2 = new PanelContainer(/** @type {any} */ (container2), {
      storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: () => {} },
    });
    const a2 = panels2.addPanel('A2', content(container2));
    const b2 = panels2.addPanel('B2', content(container2));
    expect(panels2.getPanelOrder()).toEqual([b2, a2]);
    expect(container2.children[1].classList.contains('cp-collapsed')).toBe(true);
  });

  it('works with no storage (Node / storage disabled)', () => {
    const { doc, container } = setup();
    const panels = new PanelContainer(/** @type {any} */ (container), { storage: null, transitionMs: 0 });
    const id = panels.addPanel('A', /** @type {any} */ (doc.createElement('div')));
    panels.collapsePanel(id);
    panels.expandPanel(id);
    panels.movePanel(id, 0);
    panels.removePanel(id);
    expect(panels.getPanelOrder()).toEqual([]);
  });
});

describe('drag and drop', () => {
  it('reorders panels via the HTML5 drag flow', () => {
    const { container, store, panels } = setup();
    const a = panels.addPanel('A', content(container));
    const b = panels.addPanel('B', content(container));
    const c = panels.addPanel('C', content(container));
    const rootA = container.children[0];
    const rootC = container.children[2];
    const handleA = rootA.children[0].children[3];
    const titleC = rootC.children[0].children[0];

    const dt = { effectAllowed: '', dropEffect: '', setData(k, v) { this[k] = v; } };
    const ev = (type, target, clientY) => ({
      type,
      target,
      clientY: clientY === undefined ? 0 : clientY,
      preventDefault() {},
      dataTransfer: dt,
    });

    handleA.dispatchEvent(ev('dragstart', handleA));
    expect(rootA.classList.contains('cp-dragging')).toBe(true);
    expect(dt['text/plain']).toBe(a);

    // hovering the LOWER half of C marks it as the drop target
    container.dispatchEvent(ev('dragover', titleC, 90));
    expect(rootC.classList.contains('cp-drop-target')).toBe(true);
    expect(rootA.classList.contains('cp-drop-target')).toBe(false);

    container.dispatchEvent(ev('drop', titleC, 90));
    handleA.dispatchEvent(ev('dragend', handleA));
    expect(panels.getPanelOrder()).toEqual([b, c, a]);
    expect(rootA.classList.contains('cp-dragging')).toBe(false);
    expect(rootC.classList.contains('cp-drop-target')).toBe(false);
    expect(JSON.parse(store.get('huu-panel-order'))).toEqual([b, c, a]);
  });

  it('inserts before a panel when dropped on its upper half', () => {
    const { container, panels } = setup();
    const a = panels.addPanel('A', content(container));
    const b = panels.addPanel('B', content(container));
    const c = panels.addPanel('C', content(container));
    const handleC = container.children[2].children[0].children[3];
    const titleB = container.children[1].children[0].children[0];
    const dt = { setData(k, v) { this[k] = v; } };
    const ev = (type, target, clientY) => ({
      type, target, clientY: clientY ?? 0, preventDefault() {}, dataTransfer: dt,
    });

    handleC.dispatchEvent(ev('dragstart', handleC));
    container.dispatchEvent(ev('drop', titleB, 10));
    expect(panels.getPanelOrder()).toEqual([a, c, b]);
  });

  it('dropping a panel on itself is a no-op', () => {
    const { container, panels } = setup();
    const a = panels.addPanel('A', content(container));
    const b = panels.addPanel('B', content(container));
    const rootA = container.children[0];
    const handleA = rootA.children[0].children[3];
    const dt = { setData(k, v) { this[k] = v; } };
    const ev = (type, target, clientY) => ({
      type, target, clientY: clientY ?? 0, preventDefault() {}, dataTransfer: dt,
    });

    handleA.dispatchEvent(ev('dragstart', handleA));
    container.dispatchEvent(ev('drop', rootA.children[1], 50));
    expect(panels.getPanelOrder()).toEqual([a, b]);
  });

  it('dropping on empty container space moves the panel to the end', () => {
    const { container, panels } = setup();
    const a = panels.addPanel('A', content(container));
    const b = panels.addPanel('B', content(container));
    const handleA = container.children[0].children[0].children[3];
    const dt = { setData(k, v) { this[k] = v; } };
    const ev = (type, target, clientY) => ({
      type, target, clientY: clientY ?? 0, preventDefault() {}, dataTransfer: dt,
    });

    handleA.dispatchEvent(ev('dragstart', handleA));
    container.dispatchEvent(ev('drop', container, 0));
    expect(panels.getPanelOrder()).toEqual([b, a]);
  });
});
