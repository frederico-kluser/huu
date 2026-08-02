#!/usr/bin/env bash
# Mutation: run check-acceptance against an empty directory — must detect blindness.
# exit≠0 is not enough; the message must say "No test files found".
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

OUTPUT=$(cd "$ROOT" && npx tsx scripts/check-acceptance.ts --selector anything --root "$TMP" 2>&1) || true

if echo "$OUTPUT" | grep -q 'No test files found'; then
  echo "PASS check-acceptance-blind: blind guard message detected"
else
  echo "FAIL check-acceptance-blind: expected 'No test files found'"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
