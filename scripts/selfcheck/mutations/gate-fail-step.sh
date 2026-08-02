#!/usr/bin/env bash
# Mutation: replace a non-pending step's command so it exits non-zero.
# gate.sh MUST report FAIL with the step label — not a generic exit code.
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Find a non-pending step that runs a command (not a path to a script)
# Look for "npm run" entries without "yes" pending flag
TARGET_LINE=$(grep -n '^  "' "$ROOT/scripts/gate.sh" | grep -v 'yes"' | grep 'npm' | head -1 | cut -d: -f1)

if [ -z "$TARGET_LINE" ]; then
  echo "SKIP: no npm-based non-pending step found"
  exit 0
fi

# Extract the step label for assertion
LABEL=$(sed -n "${TARGET_LINE}p" "$ROOT/scripts/gate.sh" | cut -d'|' -f1 | sed 's/^ *"//')

cp "$ROOT/scripts/gate.sh" "$TMP/gate.sh"
chmod +x "$TMP/gate.sh"

# Replace the command part (after first |, before second |) with 'false'
sed -i "${TARGET_LINE}s/|[^|]*|/|false|/" "$TMP/gate.sh"

# Run from repo root
(cd "$ROOT" && bash "$TMP/gate.sh" 2>&1) >"$TMP/out" || true

OUTPUT=$(cat "$TMP/out")

# Assert: the output contains FAIL and the label name (not just exit≠0)
if echo "$OUTPUT" | grep -q "FAIL.*$LABEL"; then
  echo "PASS gate-fail-step: FAIL '$LABEL' detected"
else
  echo "FAIL gate-fail-step: expected FAIL with label '$LABEL'"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
