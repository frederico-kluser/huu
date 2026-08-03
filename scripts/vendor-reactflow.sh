#!/usr/bin/env bash
#
# vendor-reactflow.sh — (re)generate `src/web/client/vendor/reactflow.js` + `.css`.
#
# WHAT
#   One self-contained ESM file exporting React Flow (@xyflow/react) together
#   with the slice of React / ReactDOM the canvas needs, plus React Flow's
#   stylesheet copied verbatim.
#
# VERSION
#   @xyflow/react 12.x · react 18.x · react-dom 18.x
#   (the EXACT versions of the committed bundle are recorded in
#    src/web/client/vendor/README.md — this script re-resolves them and
#    stamps the banner, so bump the README when you re-run it.)
#
#   The esbuild used is ALSO stamped in the banner and recorded in the README:
#   different esbuild versions minify differently, so the artifact is only
#   byte-reproducible against the version named there. The npx fallback is
#   pinned EXACTLY (not a range) for the same reason.
#
# LICENSE
#   The bundle inlines 17 npm packages, NOT 3 — @xyflow/react and react-dom
#   drag in @xyflow/system, seven ISC d3-* modules, BSD-3-Clause d3-ease,
#   zustand, classcat, scheduler and use-sync-external-store. This script
#   prints the full inventory (package · version · license, read from the real
#   package.json files) on every run and diffs it against the inventory table
#   in src/web/client/vendor/LICENSE.md, so a changed dependency set cannot
#   land silently. `--legal-comments=eof` keeps the upstream copyright notices
#   INSIDE the artifact (ISC requires the notice in all copies; BSD-3-Clause
#   requires it reproduced in binary distributions, and huu is redistributed
#   on npm and GHCR). `eof` rather than `linked` because `linked` emits a
#   sidecar .LEGAL.txt and the whole point of this file is to be ONE
#   self-contained module the no-build client can import.
#
# WHY THIS BUILD
#   The browser client is vanilla ESM: no bundler, no CDN, offline-first.
#   `npm run build` is literally `cp -R src/web/client/. dist/web/client/`.
#   @xyflow/react's own dist is NOT self-contained — it re-exports from
#   `react`, `react-dom`, `zustand`, `classcat` and `@xyflow/system`, so the
#   browser cannot `import` it without a resolver. Unlike motion.js (whose
#   UMD dist IS one file and is loaded via a classic <script>), React Flow has
#   no usable UMD-with-deps-inlined artifact, so we pre-bundle to ESM here and
#   COMMIT the result: the vendored file IS the dependency. package.json must
#   NOT gain @xyflow/react / react-dom — nothing in the Node/Ink half uses them.
#
# HOW TO UPDATE
#   1. bash scripts/vendor-reactflow.sh   # prints resolved versions + inventory
#   2. update the Version line (packages AND esbuild) in
#      src/web/client/vendor/README.md — reactflow.test.js cross-checks the
#      esbuild version in the banner against that line, so they cannot drift
#   3. if the inventory diff printed a WARNING, refresh the inventory table and
#      the license texts in src/web/client/vendor/LICENSE.md
#   4. npx vitest run src/web/client/vendor/ && npx tsc -p tsconfig.client.json --noEmit
#   5. commit the regenerated reactflow.js + reactflow.css
#
# The script never writes inside the repo's node_modules: it installs into a
# mktemp dir that is removed on exit. Idempotent — same inputs, same outputs.

set -euo pipefail

REACT_SPEC="${REACT_SPEC:-react@18}"
REACT_DOM_SPEC="${REACT_DOM_SPEC:-react-dom@18}"
XYFLOW_SPEC="${XYFLOW_SPEC:-@xyflow/react@12}"
# EXACT, never a range: esbuild's minifier output is version-dependent, and a
# floating `esbuild@0.25` produced bytes that differ from the committed bundle
# (which was built by the repo's transitive esbuild). Bump deliberately.
ESBUILD_PINNED="${ESBUILD_PINNED:-0.28.1}"
ESBUILD_FALLBACK="${ESBUILD_FALLBACK:-esbuild@$ESBUILD_PINNED}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/src/web/client/vendor"
OUT_JS="$OUT_DIR/reactflow.js"
OUT_CSS="$OUT_DIR/reactflow.css"
OUT_LICENSES="$OUT_DIR/LICENSE.md"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> workdir: $WORK"
cd "$WORK"
npm init -y >/dev/null
npm i --no-audit --no-fund "$REACT_SPEC" "$REACT_DOM_SPEC" "$XYFLOW_SPEC" >/dev/null

ver() { node -p "require('$WORK/node_modules/$1/package.json').version"; }
REACT_VER="$(ver react)"
REACT_DOM_VER="$(ver react-dom)"
XYFLOW_VER="$(ver @xyflow/react)"
echo "==> resolved: @xyflow/react@$XYFLOW_VER react@$REACT_VER react-dom@$REACT_DOM_VER"

# The entry defines the bundle's public surface. Keep it in sync with the
# export list asserted by src/web/client/vendor/reactflow.test.js.
cat > entry.js <<'ENTRY_EOF'
// Entry point for the vendored React Flow bundle. The huu canvas is written in
// plain JS with React.createElement (no JSX, no build step), so the default
// React namespace is re-exported by name alongside the hooks it uses.
import React from 'react';
export { React };
export {
  createElement,
  Fragment,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
} from 'react';
export { createRoot } from 'react-dom/client';
export {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  getBezierPath,
  BaseEdge,
  EdgeLabelRenderer,
  NodeToolbar,
} from '@xyflow/react';
ENTRY_EOF

# Prefer the esbuild already in the repo (no network, exact same binary the
# rest of the toolchain uses); fall back to the EXACT pinned npx download.
# Either way the version actually used is captured and stamped in the banner.
if [ -x "$REPO_ROOT/node_modules/.bin/esbuild" ]; then
  ESBUILD=("$REPO_ROOT/node_modules/.bin/esbuild")
  ESBUILD_SOURCE="repo node_modules"
else
  ESBUILD=(npx --yes "$ESBUILD_FALLBACK")
  ESBUILD_SOURCE="npx $ESBUILD_FALLBACK"
fi
ESBUILD_VER="$("${ESBUILD[@]}" --version)"
echo "==> esbuild: $ESBUILD_VER ($ESBUILD_SOURCE)"
if [ "$ESBUILD_VER" != "$ESBUILD_PINNED" ]; then
  echo "!!! WARNING: esbuild $ESBUILD_VER != pinned $ESBUILD_PINNED."
  echo "!!! The regenerated bundle will NOT be byte-identical to the committed"
  echo "!!! one. Either install esbuild@$ESBUILD_PINNED, or accept the new"
  echo "!!! version and update ESBUILD_PINNED + the README Version line."
fi

mkdir -p "$OUT_DIR"
# --legal-comments=eof  keeps upstream @license/copyright banners inside the
#                       single artifact (ISC + BSD-3-Clause require the notice
#                       to travel with the distributed copy).
# --define:import.meta.env / .MODE  kills zustand's `(import.meta.env ?
#                       import.meta.env.MODE : void 0) !== "production"` guard.
#                       In a browser `import.meta.env` is undefined, so the
#                       ternary yields `void 0`, the comparison is true and a
#                       [DEPRECATED] console.warn survives in a production
#                       bundle. Defining the object as `true` and the dotted
#                       path as "production" lets esbuild constant-fold the
#                       whole branch away (defining only the object does NOT:
#                       esbuild hoists an object literal to a var instead of
#                       folding through it).
"${ESBUILD[@]}" entry.js \
  --bundle \
  --format=esm \
  --platform=browser \
  --minify \
  --define:process.env.NODE_ENV='"production"' \
  --define:import.meta.env=true \
  --define:import.meta.env.MODE='"production"' \
  --outfile="$WORK/reactflow.bundle.js" \
  --metafile="$WORK/meta.json" \
  --legal-comments=eof

# ---------------------------------------------------------------------------
# Licence inventory, derived from the metafile — never hand-maintained.
# Every input path of the form .../node_modules/<pkg>/... is one bundled
# package; its version and SPDX id are read from that package's real
# package.json. The table is printed AND diffed against the one embedded in
# LICENSE.md, so a dependency appearing/disappearing is impossible to miss.
# ---------------------------------------------------------------------------
cat > "$WORK/inventory.cjs" <<'INV_EOF'
const fs = require('fs');
const path = require('path');
const work = process.argv[2];
const meta = JSON.parse(fs.readFileSync(path.join(work, 'meta.json'), 'utf8'));

const bytes = new Map();
for (const [input, info] of Object.entries(meta.inputs)) {
  const at = input.lastIndexOf('node_modules/');
  if (at < 0) continue;
  const parts = input.slice(at + 'node_modules/'.length).split('/');
  const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  bytes.set(pkg, (bytes.get(pkg) ?? 0) + info.bytes);
}

const rows = [...bytes.keys()].sort().map((pkg) => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(work, 'node_modules', pkg, 'package.json'), 'utf8'),
  );
  const license =
    typeof manifest.license === 'string'
      ? manifest.license
      : (manifest.license?.type ??
         manifest.licenses?.map((l) => l.type ?? l).join(' OR ') ??
         'UNKNOWN');
  return `| \`${pkg}\` | ${manifest.version} | ${license} |`;
});

const table = [
  '| package | version | license |',
  '| --- | --- | --- |',
  ...rows,
].join('\n');
process.stdout.write(`${table}\n`);
INV_EOF
node "$WORK/inventory.cjs" "$WORK" > "$WORK/inventory.md"
PKG_COUNT="$(($(wc -l < "$WORK/inventory.md") - 2))"

echo "==> bundle inventory ($PKG_COUNT packages, from the esbuild metafile):"
sed 's/^/    /' "$WORK/inventory.md"

# LICENSE.md carries the same table between HTML markers; compare them.
INV_BEGIN='<!-- inventory:begin (generated by scripts/vendor-reactflow.sh) -->'
INV_END='<!-- inventory:end -->'
if [ -f "$OUT_LICENSES" ] && grep -qF "$INV_BEGIN" "$OUT_LICENSES"; then
  awk -v b="$INV_BEGIN" -v e="$INV_END" \
    'index($0,b){f=1;next} index($0,e){f=0} f && NF' "$OUT_LICENSES" \
    > "$WORK/inventory.committed.md"
  if diff -q "$WORK/inventory.committed.md" "$WORK/inventory.md" >/dev/null; then
    echo "==> inventory matches $OUT_LICENSES"
  else
    echo "!!! WARNING: the bundled packages changed — $OUT_LICENSES is STALE."
    echo "!!! Replace its inventory table with the one above and add/remove the"
    echo "!!! corresponding licence texts (read them from $WORK/node_modules)."
    diff -u "$WORK/inventory.committed.md" "$WORK/inventory.md" | sed 's/^/    /' || true
  fi
else
  echo "!!! WARNING: no inventory markers found in $OUT_LICENSES."
fi

# `// @ts-nocheck` FIRST LINE is load-bearing: tsconfig.client.json runs
# allowJs+checkJs over src/web/client/**/*.js, and a minified vendor bundle is
# not our source to type-check. motion.js uses the same header.
# Line 2 is the banner reactflow.test.js parses: package versions, the esbuild
# that produced the bytes, the package count and the licence pointer.
{
  echo '// @ts-nocheck'
  echo "/* vendored: @xyflow/react@$XYFLOW_VER + react@$REACT_VER + react-dom@$REACT_DOM_VER — built with esbuild@$ESBUILD_VER — inlines $PKG_COUNT npm packages, licenses in ./LICENSE.md — regenerate with scripts/vendor-reactflow.sh */"
  cat "$WORK/reactflow.bundle.js"
} > "$OUT_JS"

cp "$WORK/node_modules/@xyflow/react/dist/style.css" "$OUT_CSS"

size() { node -e "process.stdout.write((require('fs').statSync(process.argv[1]).size/1024).toFixed(1)+' KB')" "$1"; }
echo "==> wrote $OUT_JS  ($(size "$OUT_JS"))"
echo "==> wrote $OUT_CSS ($(size "$OUT_CSS"))"
echo "==> copyright/@license notices kept in the bundle: $(grep -c -i 'copyright\|@license' "$OUT_JS" || true)"
echo "==> done. Update the Version line in $OUT_DIR/README.md if it changed."
