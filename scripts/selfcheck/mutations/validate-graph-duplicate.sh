#!/usr/bin/env bash
# Mutation: create a pipeline with duplicate step names.
# validate-graph MUST report "duplicate step name".
# Calculated: copies a real pipeline and duplicates a step name.
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Use the test-suite pipeline as base (guaranteed to exist)
SRC="$ROOT/pipelines/huu-test-suite.pipeline.json"
if [ ! -f "$SRC" ]; then
  echo "SKIP: no pipeline files found"
  exit 0
fi

cp "$SRC" "$TMP/pipeline.json"

# Extract a step name to duplicate (dynamically, never hardcoded)
FIRST_NAME=$(node -e "const p=JSON.parse(require('fs').readFileSync('$TMP/pipeline.json','utf8')); console.log(p.pipeline.steps[0].name)" 2>/dev/null)

# Duplicate the first step name by editing the second step's name
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('$TMP/pipeline.json', 'utf8'));
p.pipeline.steps[1].name = p.pipeline.steps[0].name;
fs.writeFileSync('$TMP/pipeline.json', JSON.stringify(p, null, 2));
"

OUTPUT=$(cd "$ROOT" && npx tsx scripts/validate-graph.ts "$TMP/pipeline.json" 2>&1) || true

if echo "$OUTPUT" | grep -q 'duplicate step name'; then
  echo "PASS validate-graph-duplicate: duplicate step name detected"
else
  echo "FAIL validate-graph-duplicate: expected 'duplicate step name' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
