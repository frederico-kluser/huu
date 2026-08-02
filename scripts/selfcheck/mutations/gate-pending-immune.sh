#!/usr/bin/env bash
# Mutation: corrupt a PENDING step's tool path — gate.sh MUST keep it PENDENTE (not FAIL).
# Pending steps are exempt from tool-exists and execution checks.
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Find a pending step (has "yes" flag)
TARGET_LINE=$(grep -n '^  "' "$ROOT/scripts/gate.sh" | grep 'yes"' | head -1 | cut -d: -f1)

if [ -z "$TARGET_LINE" ]; then
  echo "SKIP: no pending step found in gate.sh"
  exit 0
fi

LABEL=$(sed -n "${TARGET_LINE}p" "$ROOT/scripts/gate.sh" | cut -d'|' -f1 | sed 's/^ *"//')

cp "$ROOT/scripts/gate.sh" "$TMP/gate.sh"
chmod +x "$TMP/gate.sh"

# Corrupt its tool path so it would fail tool_exists
sed -i "${TARGET_LINE}s|/[a-zA-Z0-9_.-]*/[a-zA-Z0-9_.-]*\.\(sh\|ts\|tsx\)|/XXMISSING/BROKEN.sh|" "$TMP/gate.sh"

# Run
(cd "$ROOT" && bash "$TMP/gate.sh" 2>&1) >"$TMP/out" || true

OUTPUT=$(cat "$TMP/out")

# Pending steps must NOT show FAIL — they should show PENDENTE
if echo "$OUTPUT" | grep -q "FAIL.*$LABEL"; then
  echo "FAIL gate-pending-immune: pending step '$LABEL' was reported as FAIL"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi

if echo "$OUTPUT" | grep -q "PENDENTE.*$LABEL"; then
  echo "PASS gate-pending-immune: '$LABEL' stays PENDENTE despite corruption"
else
  echo "FAIL gate-pending-immune: expected PENDENTE for '$LABEL'"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
