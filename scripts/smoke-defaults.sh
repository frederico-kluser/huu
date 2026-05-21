#!/usr/bin/env bash
# Smoke test: verify the bundled default pipelines materialize into a fresh
# git repo and each re-imports cleanly. Catches drift between the TS
# generators and the on-disk JSON layout.
#
# Run from the repo root after `npm run build` (the script loads the
# compiled bootstrap + pipeline-io modules from dist/).
#
# Exit code: 0 on success, non-zero on any failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_BOOTSTRAP="$REPO_ROOT/dist/lib/pipeline-bootstrap.js"
DIST_PIPELINE_IO="$REPO_ROOT/dist/lib/pipeline-io.js"

if [[ ! -f "$DIST_BOOTSTRAP" || ! -f "$DIST_PIPELINE_IO" ]]; then
  echo "smoke-defaults: dist/ not built. Run 'npm run build' first." >&2
  exit 2
fi

SCRATCH=$(mktemp -d)
trap "rm -rf $SCRATCH" EXIT

git init -q "$SCRATCH"
git -C "$SCRATCH" config user.email smoke@huu.test
git -C "$SCRATCH" config user.name smoke
echo "x" > "$SCRATCH/README.md"
git -C "$SCRATCH" add README.md
git -C "$SCRATCH" commit -q -m init

cd "$SCRATCH"

# Materialize via the same production code path the App mount uses.
node --input-type=module -e "
import('file://$DIST_BOOTSTRAP').then(m => {
  const res = m.ensureAllDefaultPipelines('$SCRATCH', (err, mod) => {
    console.error('bootstrap failed:', mod.DEFAULT_PIPELINE_NAME, err.message);
    process.exit(3);
  });
  console.log('materialized:', res.results.length, 'pipelines');
});
"

# Each expected file must exist and parse cleanly.
EXPECTED=(
  "huu-test-suite.pipeline.json"
  "huu-docs-audit.pipeline.json"
  "huu-quality-audit.pipeline.json"
  "huu-performance-audit.pipeline.json"
  "huu-refactor.pipeline.json"
  "huu-security-audit.pipeline.json"
)

for f in "${EXPECTED[@]}"; do
  path="$SCRATCH/pipelines/$f"
  if [[ ! -f "$path" ]]; then
    echo "smoke-defaults: missing $f" >&2
    exit 4
  fi
  node --input-type=module -e "
import('file://$DIST_PIPELINE_IO').then(m => {
  const p = m.importPipeline('$path');
  if (!p || !Array.isArray(p.steps) || p.steps.length < 1) {
    console.error('parse-empty:', '$f');
    process.exit(5);
  }
  console.log('parsed:', '$f', '(' + p.steps.length + ' steps)');
});
"
done

# Re-run is a no-op (idempotency check).
node --input-type=module -e "
import('file://$DIST_BOOTSTRAP').then(m => {
  const res = m.ensureAllDefaultPipelines('$SCRATCH');
  const created = res.results.filter(r => r.created);
  if (created.length !== 0) {
    console.error('idempotency-violation: re-run created', created.length, 'files');
    process.exit(6);
  }
  console.log('idempotency: ok (0 new files on re-run)');
});
"

echo "smoke-defaults: OK"
