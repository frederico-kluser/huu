#!/usr/bin/env bash
# Mutation: run check-acceptance with no --selector — MUST fail with the specific error message.
# exit≠0 is not enough; must assert "--selector is required".
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

OUTPUT=$(cd "$ROOT" && npx tsx scripts/check-acceptance.ts 2>&1) || true

if echo "$OUTPUT" | grep -q '\-\-selector is required'; then
  echo "PASS check-acceptance-no-selector: required argument message detected"
else
  echo "FAIL check-acceptance-no-selector: expected '--selector is required'"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
