#!/usr/bin/env bash
# Mutation: create a pin with a wrong hash — check-pins MUST detect hash drift.
# Calculated: writes a target file, creates a pin with a hash that doesn't match,
# derived from the real file content.
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Write a target file with known content, then pin it with a WRONG hash
echo 'const answer = 42;' > "$TMP/target.ts"

# Compute the real SHA1 of line 1
REAL_HASH=$(echo -n 'const answer = 42;' | sha1sum | cut -d' ' -f1)

# Create a pin file referencing a DIFFERENT hash (reverse the hash to guarantee mismatch)
WRONG_HASH=$(echo "$REAL_HASH" | rev)

cat > "$TMP/pins.md" << PINEOF
# Pins
Ref: \`target.ts:1@${WRONG_HASH}\`
PINEOF

OUTPUT=$(cd "$ROOT" && npx tsx scripts/check-pins.ts --root "$TMP" 2>&1) || true

if echo "$OUTPUT" | grep -q 'hash drift'; then
  echo "PASS check-pins-stale: hash drift detected"
else
  echo "FAIL check-pins-stale: expected 'hash drift' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
