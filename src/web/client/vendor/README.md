# Vendored third-party assets

The browser client is a **no-build, no-CDN, offline-first** vanilla-ESM app
(see the `building-web-ui` skill). Anything it needs at runtime must live here
as a self-contained file that the `build` step copies raw into `dist/`.

## `motion.js`

- **What:** [Motion](https://motion.dev) — the animation engine (open-source
  core of Motion / Motion+). The UMD production build attaches a global
  `Motion` (`window.Motion.animate`, `.spring`, `.stagger`, …).
- **Version:** 12.42.0
- **License:** MIT (see `LICENSE.md`).
- **Why UMD, not ESM:** the package's ESM entry re-exports from sibling
  packages (`framer-motion/dom`), so it is NOT a single self-contained module —
  it can't be `import`ed without a bundler. The UMD `dist/motion.js` is one
  self-contained file; we load it via a classic `<script>` before `app.js`
  (deferred module), so `window.Motion` is guaranteed present. `app.js` reads
  it lazily and degrades gracefully (no animation) if it is ever absent.
- **Update:** `npm install motion@<ver>` in a scratch dir, then
  `cp node_modules/motion/dist/motion.js src/web/client/vendor/motion.js`
  (and refresh `LICENSE.md` + the version above).

> Note: `motion-plus` (the premium catalog) is React-only and served from a
> token-gated registry — it does not apply to this vanilla client. We use
> Motion's core `animate`/`spring`, which is the same engine Motion+ builds on.

## `reactflow.js` + `reactflow.css`

- **What:** [React Flow](https://reactflow.dev) (`@xyflow/react`) — the node
  graph engine used by the pipeline canvas — pre-bundled to a single ESM file
  together with the React runtime it needs. Named exports: `React`,
  `createElement`, `Fragment`, `useState`, `useEffect`, `useCallback`,
  `useMemo`, `useRef`, `memo`, `createRoot`, plus `ReactFlow`,
  `ReactFlowProvider`, `Background`, `BackgroundVariant`, `Controls`,
  `MiniMap`, `Panel`, `Handle`, `Position`, `MarkerType`, `useNodesState`,
  `useEdgesState`, `useReactFlow`, `addEdge`, `applyNodeChanges`,
  `applyEdgeChanges`, `getBezierPath`, `BaseEdge`, `EdgeLabelRenderer`,
  `NodeToolbar`. `reactflow.css` is React Flow's `dist/style.css` copied
  verbatim — the canvas does not render correctly without it.
- **Version:** `@xyflow/react` 12.11.2 · `react` 18.3.1 · `react-dom` 18.3.1 · built with esbuild 0.28.1 (minified, `NODE_ENV=production`).
  <br>The esbuild version is load-bearing — its minifier output is
  version-dependent, so the committed bytes only reproduce against that exact
  version. `scripts/vendor-reactflow.sh` stamps it into the bundle banner and
  `reactflow.test.js` fails if the banner and the line above disagree. Keep the
  whole thing on ONE line: the test looks for exactly one line that carries
  both the bold Version label and the word esbuild.
- **License:** the bundle inlines **17 npm packages**, not three — MIT
  (`@xyflow/react`, `@xyflow/system`, `react`, `react-dom`, `scheduler`,
  `use-sync-external-store`, `zustand`, `classcat`), ISC (seven `d3-*`
  modules) and BSD-3-Clause (`d3-ease`). The full per-package inventory and
  the verbatim license texts are in `LICENSE.md`; the script regenerates the
  inventory from esbuild's metafile on every run and warns when it drifts. The
  bundle itself is built with `--legal-comments=eof`, so the upstream
  copyright notices travel inside the artifact.
- **Why ESM bundled, not a raw dist copy:** unlike `motion.js`, React Flow has
  no self-contained artifact to copy. Its dist re-exports from `react`,
  `react-dom`, `zustand`, `classcat` and `@xyflow/system`, so a browser with no
  bundler and no import map cannot resolve it. We therefore pre-bundle
  everything into one ESM file and **commit it — the vendored file IS the
  dependency**. `package.json` gains nothing: `@xyflow/react` and `react-dom`
  are not runtime deps of the Node/Ink half, and adding them there would
  imply a build step this client does not have (`npm run build` is just
  `cp -R src/web/client/. dist/web/client/`).
- **Why React ships inside it:** the canvas is written in plain JavaScript with
  `React.createElement` — no JSX, no transpiler, no build. React Flow is a
  React component library, so the React runtime has to come along; exporting it
  from the same bundle guarantees the canvas and React Flow share ONE React
  instance (two copies would break hooks and context).
- **Update:** `bash scripts/vendor-reactflow.sh` (installs into a temp dir —
  never the repo's `node_modules` — bundles with the repo's esbuild, rewrites
  both files, prints the resolved versions and the package inventory, and
  warns if that inventory no longer matches `LICENSE.md`). Then refresh the
  Version line above, `LICENSE.md` if the inventory or an upstream text
  changed, and run `npx vitest run src/web/client/vendor/` —
  `reactflow.test.js` **imports the bundle** and asserts real behaviour (one
  shared React instance, the React Flow enums, `getBezierPath`, `addEdge`,
  `applyNodeChanges`/`applyEdgeChanges`, the genuine production `createRoot`)
  on top of the structural checks.

> Both vendored files carry a `// @ts-nocheck` first line: `tsconfig.client.json`
> runs `allowJs` + `checkJs` over `src/web/client/**/*.js`, and minified vendor
> code is not our source to type-check. Re-apply it if a bundle is ever
> regenerated by hand.
