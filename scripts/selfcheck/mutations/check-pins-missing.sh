#!/usr/bin/env bash
# Mutation: create a pin referencing a file that doesn't exist.
# check-pins MUST report "file not found".
# Calculated: generates a pin with a valid-format but non-existent path.
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Generate a UUID-based filename guaranteed to not exist
MISSING_FILE="zzz-missing-$(date +%s).ts"

cat > "$TMP/pins.md" << PINEOF
# Pins
Ref: \`${MISSING_FILE}:1@abc1234\`
PINEOF

OUTPUT=$(cd "$ROOT" && npx tsx scripts/check-pins.ts --root "$TMP" 2>&1) || true

if echo "$OUTPUT" | grep -q 'file not found'; then
  echo "PASS check-pins-missing: missing file detected"
else
  echo "FAIL check-pins-missing: expected 'file not found' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
