#!/usr/bin/env bash
# Mutation: create a pipeline with an unknown step reference in dependsOn.
# validate-graph MUST report "dependsOn unknown step".
# Calculated: copies a real pipeline and references a non-existent step.
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

SRC="$ROOT/pipelines/huu-test-suite.pipeline.json"
if [ ! -f "$SRC" ]; then
  echo "SKIP: no pipeline files found"
  exit 0
fi

cp "$SRC" "$TMP/pipeline.json"

# Add a dependsOn referencing a non-existent step to the LAST step
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('$TMP/pipeline.json', 'utf8'));
const last = p.pipeline.steps[p.pipeline.steps.length - 1];
last.dependsOn = ['ZZNT_ORPHAN_STEP_ZZNT'];
fs.writeFileSync('$TMP/pipeline.json', JSON.stringify(p, null, 2));
"

OUTPUT=$(cd "$ROOT" && npx tsx scripts/validate-graph.ts "$TMP/pipeline.json" 2>&1) || true

if echo "$OUTPUT" | grep -q 'dependsOn unknown step'; then
  echo "PASS validate-graph-orphan: orphan dependsOn detected"
else
  echo "FAIL validate-graph-orphan: expected 'dependsOn unknown step' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
