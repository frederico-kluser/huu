#!/usr/bin/env bash
# Mutation: run check-acceptance with a selector guaranteed to match nothing.
# Message MUST say "No match for" — exit≠0 alone is not enough.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

OUTPUT=$(cd "$ROOT" && npx tsx scripts/check-acceptance.ts --selector ZZZZ_NO_MATCH_ZZZZ 2>&1) || true

if echo "$OUTPUT" | grep -q 'No match for'; then
  echo "PASS check-acceptance-no-match: 'No match for' message detected"
else
  echo "FAIL check-acceptance-no-match: expected 'No match for' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
