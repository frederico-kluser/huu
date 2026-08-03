/**
 * Contract test for the vendored React Flow bundle.
 *
 * This suite IMPORTS the bundle for real (`await import()` on its file:// URL)
 * and asserts BEHAVIOUR. That is possible because the bundle touches no DOM API
 * at module-evaluation time — verified empirically, plain `node -e
 * "import('./reactflow.js')"` resolves with all 30 exports under vitest's
 * default `node` environment, with no jsdom and no `document` shim. (An earlier
 * revision of this file claimed the opposite and only inspected bytes; that
 * made every assertion satisfiable by a file of filler text with the right
 * `export{}` clause, which is why the checks below run the code instead.)
 *
 * What it guards: the vendored file really is React Flow + ONE React instance,
 * it is self-contained (no leftover require / bare specifier), and its banner
 * cannot drift from README.md.
 *
 * Regenerate the bundle with `bash scripts/vendor-reactflow.sh`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const JS_PATH = fileURLToPath(new URL('./reactflow.js', import.meta.url));
const CSS_PATH = fileURLToPath(new URL('./reactflow.css', import.meta.url));
const README_PATH = fileURLToPath(new URL('./README.md', import.meta.url));

/** Kept in sync with `entry.js` inside scripts/vendor-reactflow.sh. */
const REQUIRED_EXPORTS = [
  // React namespace + the hooks the no-JSX canvas uses.
  'React',
  'createElement',
  'Fragment',
  'useState',
  'useEffect',
  'useCallback',
  'useMemo',
  'useRef',
  'memo',
  // react-dom/client
  'createRoot',
  // @xyflow/react
  'ReactFlow',
  'ReactFlowProvider',
  'Background',
  'BackgroundVariant',
  'Controls',
  'MiniMap',
  'Panel',
  'Handle',
  'Position',
  'MarkerType',
  'useNodesState',
  'useEdgesState',
  'useReactFlow',
  'addEdge',
  'applyNodeChanges',
  'applyEdgeChanges',
  'getBezierPath',
  'BaseEdge',
  'EdgeLabelRenderer',
  'NodeToolbar',
];

/**
 * Names re-exported straight off the React namespace. Sharing IDENTITY with
 * `React.*` is the load-bearing property: two React copies inside one bundle
 * would still export all these names, but the functions would differ and hooks
 * / context would break at runtime.
 */
const REACT_SHARED = [
  'useState',
  'useEffect',
  'createElement',
  'Fragment',
  'memo',
  'useRef',
  'useCallback',
  'useMemo',
];

/** `$$typeof` tag each React Flow component must carry, empirically observed. */
const COMPONENT_TAGS = {
  ReactFlow: 'Symbol(react.forward_ref)',
  Panel: 'Symbol(react.forward_ref)',
  Handle: 'Symbol(react.memo)',
  Background: 'Symbol(react.memo)',
  Controls: 'Symbol(react.memo)',
  MiniMap: 'Symbol(react.memo)',
};

/** Components React Flow ships as plain function components. */
const FUNCTION_COMPONENTS = [
  'ReactFlowProvider',
  'BaseEdge',
  'EdgeLabelRenderer',
  'NodeToolbar',
];

const source = existsSync(JS_PATH) ? readFileSync(JS_PATH, 'utf8') : '';
/** Line 2 of the file, written by scripts/vendor-reactflow.sh. */
const banner = source.split('\n')[1] ?? '';

/** @param {RegExp} re @returns {string} first capture, or '' when absent. */
function stamped(re) {
  const m = banner.match(re);
  return m ? m[1] : '';
}

// Versions are read OUT of the banner and compared against what the code
// actually reports, so nothing is hardcoded on both sides of an assertion.
const BANNER_REACT = stamped(/(?:^|[\s+])react@(\d+\.\d+\.\d+)/);
const BANNER_REACT_DOM = stamped(/react-dom@(\d+\.\d+\.\d+)/);
const BANNER_XYFLOW = stamped(/@xyflow\/react@(\d+\.\d+\.\d+)/);
const BANNER_ESBUILD = stamped(/esbuild@(\d+\.\d+\.\d+)/);

/** @type {any} the bundle's module namespace, loaded once for the whole file. */
let mod;

beforeAll(async () => {
  mod = await import(pathToFileURL(JS_PATH).href);
});

describe('vendor/reactflow.js — structure', () => {
  it('is committed and plausibly sized', () => {
    expect(existsSync(JS_PATH)).toBe(true);
    expect(source.length).toBeGreaterThan(100 * 1024);
    expect(source.length).toBeLessThan(3 * 1024 * 1024);
  });

  it('starts with the @ts-nocheck header the client typecheck needs', () => {
    // tsconfig.client.json runs allowJs+checkJs over src/web/client/**/*.js.
    expect(source.startsWith('// @ts-nocheck')).toBe(true);
  });

  it('records the vendored versions and the esbuild that built it', () => {
    expect(BANNER_XYFLOW).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BANNER_REACT).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BANNER_REACT_DOM).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BANNER_ESBUILD).toMatch(/^\d+\.\d+\.\d+$/);
    expect(banner).toContain('scripts/vendor-reactflow.sh');
  });

  it('keeps the upstream copyright / @license notices inside the artifact', () => {
    // --legal-comments=eof. ISC (the d3-* modules) requires the notice in all
    // copies and BSD-3-Clause (d3-ease) in binary distributions; huu ships this
    // file on npm and in the GHCR image. See LICENSE.md for the full texts.
    expect(source).toMatch(/@license|Copyright/i);
  });

  it('carries no dead import.meta.env branch', () => {
    // zustand guards a [DEPRECATED] console.warn with
    // `(import.meta.env ? import.meta.env.MODE : void 0) !== "production"`,
    // which is TRUE in a browser (import.meta.env is undefined). The build
    // defines it away; a survivor means the --define was dropped.
    expect(source).not.toContain('import.meta');
    expect(source).not.toContain('[DEPRECATED]');
  });

  it('is fully bundled — no CommonJS require left', () => {
    // esbuild rewrites every require() it resolves; a survivor means an
    // external was left unbundled.
    expect(source).not.toContain('require(');
  });

  it('is fully bundled — no bare-specifier import left', () => {
    // Any `from"x"` whose specifier is not relative (./ ../) or absolute (/)
    // would need a resolver the no-build client does not have.
    const bare = [];
    for (const m of source.match(/from"([^"]*)"/g) ?? []) {
      const spec = m.slice('from"'.length, -1);
      if (!spec.startsWith('.') && !spec.startsWith('/')) bare.push(spec);
    }
    expect(bare).toEqual([]);
    expect(source).not.toContain('from"react"');
  });

  it('agrees with README.md on the esbuild that produced it', () => {
    // The minifier's output is version-dependent, so the artifact is only
    // reproducible against the version named in both places at once.
    const readme = readFileSync(README_PATH, 'utf8');
    const versionLines = readme
      .split('\n')
      .filter((l) => l.includes('**Version:**') && l.includes('esbuild'));
    expect(versionLines).toHaveLength(1);
    const m = versionLines[0].match(/esbuild[@ ](\d+\.\d+\.\d+)/);
    expect(m, `no esbuild version in: ${versionLines[0]}`).toBeTruthy();
    expect(m[1]).toBe(BANNER_ESBUILD);
  });
});

describe('vendor/reactflow.js — runtime', () => {
  it('imports in a plain Node ESM context with no DOM shim', () => {
    expect(mod).toBeTruthy();
    expect(Object.keys(mod).sort()).toEqual([...REQUIRED_EXPORTS].sort());
  });

  it('ships the React version its banner claims', () => {
    expect(BANNER_REACT).toMatch(/^18\./); // entry.js pins react@18
    expect(mod.React.version).toBe(BANNER_REACT);
    expect(BANNER_REACT_DOM).toBe(BANNER_REACT); // react-dom tracks react
  });

  it.each(REACT_SHARED)('re-exports the SAME React.%s (one React instance)', (name) => {
    // Fragment is a symbol tag, the rest are functions — never undefined.
    expect(['function', 'symbol']).toContain(typeof mod[name]);
    expect(mod[name]).toBe(mod.React[name]);
  });

  it('exposes React Flow enums with their real values', () => {
    expect({ ...mod.Position }).toEqual({
      Left: 'left',
      Top: 'top',
      Right: 'right',
      Bottom: 'bottom',
    });
    expect(mod.MarkerType.Arrow).toBe('arrow');
    expect(mod.MarkerType.ArrowClosed).toBe('arrowclosed');
    expect({ ...mod.BackgroundVariant }).toEqual({
      Lines: 'lines',
      Dots: 'dots',
      Cross: 'cross',
    });
  });

  it.each(Object.entries(COMPONENT_TAGS))('%s is a real React component (%s)', (name, tag) => {
    const component = mod[name];
    expect(typeof component).toBe('object');
    expect(component).not.toBeNull();
    expect(String(component.$$typeof)).toBe(tag);
  });

  it.each(FUNCTION_COMPONENTS)('%s is a function component', (name) => {
    expect(typeof mod[name]).toBe('function');
  });

  it.each(['useNodesState', 'useEdgesState', 'useReactFlow'])('%s is a hook', (name) => {
    expect(typeof mod[name]).toBe('function');
  });

  it('computes a bezier edge path', () => {
    expect(
      mod.getBezierPath({ sourceX: 0, sourceY: 0, targetX: 100, targetY: 100 }),
    ).toEqual(['M0,0 C0,50 100,50 100,100', 50, 50, 50, 50]);
  });

  it('addEdge mints React Flow’s deterministic edge id', () => {
    expect(mod.addEdge({ source: 'a', target: 'b' }, [])).toEqual([
      { source: 'a', target: 'b', id: 'xy-edge__a-b' },
    ]);
  });

  it('applyNodeChanges moves and removes nodes', () => {
    const nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      { id: 'n2', position: { x: 1, y: 1 }, data: {} },
    ];
    expect(
      mod.applyNodeChanges(
        [{ id: 'n1', type: 'position', position: { x: 10, y: 20 } }],
        nodes,
      )[0].position,
    ).toEqual({ x: 10, y: 20 });
    expect(
      mod.applyNodeChanges([{ id: 'n1', type: 'remove' }], nodes).map((n) => n.id),
    ).toEqual(['n2']);
  });

  it('applyEdgeChanges removes edges', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    expect(
      mod.applyEdgeChanges([{ id: 'e1', type: 'remove' }], edges).map((e) => e.id),
    ).toEqual(['e2']);
  });

  it('createRoot is the genuine production react-dom', () => {
    // Handed a non-element it throws React's MINIFIED invariant #299
    // ("createRoot(...): Target container is not a DOM element"). Only the real
    // production react-dom build produces that message.
    expect(() => mod.createRoot({})).toThrow(/Minified React error #299/);
  });
});

describe('vendor/reactflow.css', () => {
  it.each([
    '.react-flow',
    '.react-flow__pane',
    '.react-flow__node',
    '.react-flow__edge',
    '.react-flow__handle',
  ])('carries the %s rules the canvas needs', (selector) => {
    expect(existsSync(CSS_PATH)).toBe(true);
    expect(readFileSync(CSS_PATH, 'utf8')).toContain(selector);
  });
});
