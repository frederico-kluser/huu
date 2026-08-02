/* huu web UI — collapsible panels with drag-to-reorder (zero dependencies).
   A generic stack of panels: each has a title, an optional status badge, a
   collapse toggle (max-height transition, no JS measurement) and a drag
   handle (⠿) that reorders via the HTML5 Drag API. Order and collapsed state
   persist to localStorage (huu-panel-order / huu-panel-state).

   Pure helpers (reorderArray / mergeStoredOrder / parseStoredState) are
   DOM-free and unit-test in Node; the class touches the DOM only inside
   methods, so the module imports cleanly in Node too (see
   collapsible-panels.test.js, which drives it against a minimal DOM shim). */

export const ORDER_KEY = 'huu-panel-order';
export const STATE_KEY = 'huu-panel-state';

/* ---- Pure helpers (Node-testable) ---- */

/** Move arr[from] to index `to` (a valid insertion index in [0, length]).
    Returns a NEW array; the input is never mutated. Unchanged copy when the
    move is a no-op or the indexes are out of range. */
export function reorderArray(arr, from, to) {
  if (!Array.isArray(arr)) return arr;
  const n = arr.length;
  if (from < 0 || from >= n || to < 0 || to > n || from === to) return arr.slice();
  const out = arr.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/** Stored order wins for ids that still exist; unknown stored ids are dropped
    (stale localStorage from an older build); ids missing from storage keep
    insertion order at the end. Duplicates are deduped. */
export function mergeStoredOrder(currentIds, storedOrder) {
  const known = new Set(currentIds);
  const out = [];
  if (Array.isArray(storedOrder)) {
    for (const id of storedOrder) {
      if (known.has(id) && !out.includes(id)) out.push(id);
    }
  }
  for (const id of currentIds) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Parse the huu-panel-state payload: { id: true|false } (true = collapsed).
    Anything else - corrupt JSON, arrays, primitives, null - yields {}. */
export function parseStoredState(raw) {
  if (raw === null || raw === undefined) return {};
  let data;
  try {
    data = JSON.parse(String(raw));
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) out[k] = !!v;
  return out;
}

function isElement(node) {
  return !!node && node.nodeType === 1;
}

/* ---- PanelContainer ---- */

/**
 * Manages a stack of collapsible, drag-reorderable panels inside containerEl.
 *
 * @param {HTMLElement} containerEl - existing element; gets class cp-container.
 * @param {object} [opts]
 * @param {object} [opts.storage] - getItem/setItem pair; defaults to
 *   localStorage, pass null to disable persistence.
 * @param {number} [opts.transitionMs=300] - expand/collapse animation length;
 *   0 collapses/expands instantly.
 */
export class PanelContainer {
  constructor(containerEl, opts = {}) {
    const doc = containerEl && containerEl.ownerDocument;
    if (!doc || !doc.createElement || !containerEl.appendChild || !containerEl.classList) {
      throw new Error('PanelContainer: containerEl must be a DOM element');
    }
    this.container = containerEl;
    this.opts = opts;
    this.storage = opts.storage !== undefined ? opts.storage
      : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.transitionMs = Number.isFinite(opts.transitionMs) ? opts.transitionMs : 300;
    this.els = new Map();   // panelId -> entry (see addPanel)
    this.ids = [];          // panel ids in DOM order — the source of truth
    this._seq = 0;
    this._dragId = null;
    this._orderListeners = new Set();
    containerEl.classList.add('cp-container');
    // Drag wiring lives on the container (children come and go; events bubble).
    containerEl.addEventListener('dragover', (e) => this._onDragOver(e));
    containerEl.addEventListener('drop', (e) => this._onDrop(e));
  }

  /**
   * Add a panel and return its id.
   * @param {string} title
   * @param {HTMLElement} [contentEl] - moved into the collapsible body.
   * @param {object} [opts]
   * @param {string} [opts.id] - explicit panel id (defaults to cp-panel-N).
   * @param {'running'|'pending'|'error'|'done'|string} [opts.badge] - status
   *   badge color; badge hidden when absent.
   * @param {boolean} [opts.collapsed] - start collapsed (persisted state wins).
   */
  addPanel(title, contentEl, opts = {}) {
    const doc = this.container.ownerDocument;
    const id = typeof opts.id === 'string' && opts.id ? opts.id : `cp-panel-${++this._seq}`;
    if (this.els.has(id)) throw new Error(`PanelContainer: duplicate panel id "${id}"`);
    const status = typeof opts.badge === 'string' ? opts.badge : null;

    const root = doc.createElement('div');
    root.classList.add('cp-panel', 'cp-slide-in');
    root.dataset.cpId = id;

    const header = doc.createElement('div');
    header.className = 'cp-header';
    const titleEl = doc.createElement('span');
    titleEl.className = 'cp-title';
    titleEl.textContent = String(title ?? '');
    const badge = doc.createElement('span');
    badge.className = 'cp-badge';
    if (status) {
      badge.dataset.s = status;
      badge.textContent = status;
    } else {
      badge.hidden = true;
    }
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cp-toggle';
    toggle.setAttribute('aria-label', 'Toggle panel');
    toggle.setAttribute('aria-expanded', 'true');
    const handle = doc.createElement('button');
    handle.type = 'button';
    handle.className = 'cp-handle';
    handle.draggable = true;
    handle.setAttribute('aria-label', 'Drag to reorder');
    handle.textContent = '⠿';
    const body = doc.createElement('div');
    body.className = 'cp-body';
    if (contentEl) body.appendChild(contentEl);

    header.appendChild(titleEl);
    header.appendChild(badge);
    header.appendChild(toggle);
    header.appendChild(handle);
    root.appendChild(header);
    root.appendChild(body);
    this.container.appendChild(root);

    /** @type {{root: HTMLElement, toggle: HTMLElement, handle: HTMLElement, body: HTMLElement, badge: HTMLElement, collapsed: boolean, seq: number, timer: (number|undefined)}} */
    const entry = { root, toggle, handle, body, badge, collapsed: false, seq: 0, timer: undefined };
    this.els.set(id, entry);
    this.ids.push(id);

    toggle.addEventListener('click', () => this._setCollapsed(id, !entry.collapsed, true));
    handle.addEventListener('dragstart', (e) => this._onDragStart(e, id, entry));
    handle.addEventListener('dragend', () => this._onDragEnd());
    root.addEventListener('animationend', () => root.classList.remove('cp-slide-in'), { once: true });
    // Safety net for reduced-motion setups where animationend never fires.
    if (this.transitionMs > 0) setTimeout(() => root.classList.remove('cp-slide-in'), this.transitionMs + 60);

    // Persisted collapsed state wins; the opts flag is the fallback.
    if (this._storedState()[id] === true) this._setCollapsed(id, true, false);
    else if (opts.collapsed === true) this._setCollapsed(id, true, false);
    this._applyStoredOrder();
    this._persistOrder();
    return id;
  }

  removePanel(panelId) {
    const entry = this.els.get(panelId);
    if (!entry) return;
    this.container.removeChild(entry.root);
    this.els.delete(panelId);
    const idx = this.ids.indexOf(panelId);
    if (idx !== -1) this.ids.splice(idx, 1);
    this._persistOrder();
    this._persistState();
    for (const cb of this._orderListeners) cb([...this.ids]);
  }

  expandPanel(panelId) { this._setCollapsed(panelId, false, true); }

  collapsePanel(panelId) { this._setCollapsed(panelId, true, true); }

  /** Live badge update - same statuses as addPanel's opts.badge; null hides it. */
  setStatus(panelId, status) {
    const entry = this.els.get(panelId);
    if (!entry) return;
    if (status === null || status === undefined || status === '') {
      entry.badge.hidden = true;
      delete entry.badge.dataset.s;
      entry.badge.textContent = '';
      return;
    }
    entry.badge.hidden = false;
    entry.badge.dataset.s = String(status);
    entry.badge.textContent = String(status);
  }

  /** Move a panel to `newIndex` (clamped to [0, length-1]). */
  movePanel(panelId, newIndex) {
    if (!this.els.has(panelId)) return;
    const from = this.ids.indexOf(panelId);
    const n = this.ids.length;
    const to = Math.max(0, Math.min(n - 1, Number.isFinite(newIndex) ? newIndex : from));
    const next = reorderArray(this.ids, from, to);
    if (!this._sameOrder(next, this.ids)) this._applyOrder(next, true, true);
  }

  /** Current panel order - a copy, safe to mutate. */
  getPanelOrder() { return [...this.ids]; }

  /** Register a callback fired with the new order whenever it changes
      (drag-drop, movePanel, removePanel). Returns this for chaining. */
  onOrderChange(callback) {
    if (typeof callback === 'function') this._orderListeners.add(callback);
    return this;
  }

  /* ---- internals ---- */

  _setCollapsed(panelId, collapsed, animate) {
    const entry = this.els.get(panelId);
    if (!entry || entry.collapsed === collapsed) return;
    entry.collapsed = collapsed;
    entry.root.classList.toggle('cp-collapsed', collapsed);
    entry.toggle.setAttribute('aria-expanded', String(!collapsed));
    this._transition(entry, collapsed, animate);
    this._persistState();
  }

  /**
   * Animate max-height (the element's CSS transition drives the motion) and
   * keep `overflow: hidden` for the duration so the scrollbar can't pop in
   * mid-animation. `var(--cp-body-max-h, 42vh)` needs no JS measurement: the
   * box's rendered height is min(content, max-height), so animating 0 - cap
   * tracks the content height exactly and never overshoots the scroll cap.
   */
  _transition(entry, collapsed, animate) {
    const { body } = entry;
    const finalize = () => {
      body.style.maxHeight = collapsed ? '0px' : '';
      body.style.overflow = collapsed ? 'hidden' : '';
    };
    if (!animate || this.transitionMs <= 0) { finalize(); return; }
    const seq = ++entry.seq;
    if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined; }
    body.style.overflow = 'hidden';
    body.style.maxHeight = collapsed ? '0px' : 'var(--cp-body-max-h, 42vh)';
    const done = () => {
      if (entry.seq !== seq) return; // a newer transition superseded this one
      if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined; }
      finalize();
    };
    entry.timer = setTimeout(done, this.transitionMs + 60);
    body.addEventListener('transitionend', (e) => {
      if (e.propertyName !== 'max-height') return;
      done();
    }, { once: true });
  }

  _applyOrder(newIds, persist, notify) {
    this.ids = newIds;
    for (const id of this.ids) this.container.appendChild(this.els.get(id).root);
    if (persist) this._persistOrder();
    if (notify) for (const cb of this._orderListeners) cb([...this.ids]);
  }

  _applyStoredOrder() {
    if (!this.storage) return;
    let raw = null;
    try { raw = this.storage.getItem(ORDER_KEY); } catch { return; }
    let stored = null;
    if (raw !== null) {
      try { stored = JSON.parse(String(raw)); } catch { stored = null; }
    }
    const merged = mergeStoredOrder(this.ids, stored ?? []);
    if (!this._sameOrder(merged, this.ids)) this._applyOrder(merged, false, false);
  }

  _persistOrder() {
    if (!this.storage) return;
    try { this.storage.setItem(ORDER_KEY, JSON.stringify(this.ids)); } catch { /* storage disabled */ }
  }

  _persistState() {
    if (!this.storage) return;
    const state = {};
    for (const [id, entry] of this.els) state[id] = entry.collapsed;
    try { this.storage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage disabled */ }
  }

  _storedState() {
    if (!this.storage) return {};
    try { return parseStoredState(this.storage.getItem(STATE_KEY)); } catch { return {}; }
  }

  _sameOrder(a, b) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }

  /* ---- HTML5 Drag API ---- */

  _onDragStart(e, id, entry) {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', id); } catch { /* some browsers block setData */ }
    }
    this._dragId = id;
    entry.root.classList.add('cp-dragging');
  }

  _onDragOver(e) {
    if (!this._dragId) return;
    e.preventDefault(); // required for drop to fire
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this._highlightDropTarget(e.target);
  }

  _onDrop(e) {
    if (!this._dragId) return;
    e.preventDefault();
    const dragId = this._dragId;
    const targetRoot = this._rootOf(e.target);
    if (targetRoot && targetRoot.dataset.cpId === dragId) {
      this._clearDrag(); // dropped on itself — nothing to do
      return;
    }
    const from = this.ids.indexOf(dragId);
    let to;
    if (targetRoot) {
      const rect = targetRoot.getBoundingClientRect();
      const upperHalf = e.clientY < rect.top + rect.height / 2;
      const targetIdx = this.ids.indexOf(targetRoot.dataset.cpId);
      to = targetIdx + (upperHalf ? 0 : 1);
    } else {
      to = this.ids.length; // dropped on empty container space → move to the end
    }
    const next = reorderArray(this.ids, from, to);
    this._clearDrag();
    if (!this._sameOrder(next, this.ids)) this._applyOrder(next, true, true);
  }

  _onDragEnd() { this._clearDrag(); }

  _clearDrag() {
    this._dragId = null;
    for (const entry of this.els.values()) entry.root.classList.remove('cp-dragging', 'cp-drop-target');
  }

  _highlightDropTarget(node) {
    for (const entry of this.els.values()) entry.root.classList.remove('cp-drop-target');
    if (!isElement(node)) return;
    const root = this._rootOf(node);
    if (root && root.dataset.cpId !== this._dragId) root.classList.add('cp-drop-target');
  }

  _rootOf(node) {
    if (!isElement(node)) return null;
    if (node.classList.contains('cp-panel')) return node;
    if (typeof node.closest === 'function') {
      const el = node.closest('.cp-panel');
      return isElement(el) ? el : null;
    }
    return null;
  }
}
