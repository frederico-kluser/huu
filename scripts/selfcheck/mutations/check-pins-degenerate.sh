#!/usr/bin/env bash
# Mutation: create a degenerate pin (no path, no hash).
# check-pins MUST detect and report it.
# Calculated: creates a fixture with invalid pin syntax derived from real files.
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Create a fixture file with degenerate pins (empty path, empty hash)
cat > "$TMP/degenerate.md" << 'PINEOF'
# Test file with degenerate pins
Ref: `:10@abc1234`  (missing path before colon)
Ref: `src/foo.ts:5@`  (missing hash)
Ref: `@abcdef1`  (no path or line, just hash)
PINEOF

# Create the referenced target file (but the pin format itself is degenerate)
OUTPUT=$(cd "$ROOT" && npx tsx scripts/check-pins.ts --root "$TMP" 2>&1) || true

# The script should either report "file not found" (for the empty-path case) 
# or count them as drifts
if echo "$OUTPUT" | grep -q 'file not found\|drift'; then
  echo "PASS check-pins-degenerate: degenerate pins rejected"
else
  echo "FAIL check-pins-degenerate: expected rejection of degenerate pins"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
