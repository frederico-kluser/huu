#!/usr/bin/env bash
# Mutation: create a dependsOn edge pointing to a LATER step (backwards).
# validate-graph MUST report "not an EARLIER step".
# Calculated: copies a real pipeline, picks the LAST step as a dependency of the FIRST.
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

# Make the first step depend on the LAST step (backwards edge)
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('$TMP/pipeline.json', 'utf8'));
const lastName = p.pipeline.steps[p.pipeline.steps.length - 1].name;
p.pipeline.steps[0].dependsOn = [lastName];
fs.writeFileSync('$TMP/pipeline.json', JSON.stringify(p, null, 2));
"

OUTPUT=$(cd "$ROOT" && npx tsx scripts/validate-graph.ts "$TMP/pipeline.json" 2>&1) || true

if echo "$OUTPUT" | grep -q 'not an EARLIER step'; then
  echo "PASS validate-graph-cycle: backwards dependsOn detected"
else
  echo "FAIL validate-graph-cycle: expected 'not an EARLIER step' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
