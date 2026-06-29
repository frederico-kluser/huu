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
