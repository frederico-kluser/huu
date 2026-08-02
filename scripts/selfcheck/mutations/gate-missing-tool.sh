#!/usr/bin/env bash
# Mutation: replace one non-pending tool's path with a non-existent one.
# gate.sh MUST report FAIL with "ferramenta nao encontrada" — exit≠0 alone is not enough.
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Extract a non-pending step that uses a path (contains /) — calculated from current STEPS array
LINE_NUM=$(grep -n '^  "' "$ROOT/scripts/gate.sh" | grep -v 'yes"' | grep '/' | head -1 | cut -d: -f1)

if [ -z "$LINE_NUM" ]; then
  echo "SKIP: no path-based non-pending step found in gate.sh"
  exit 0
fi

cp "$ROOT/scripts/gate.sh" "$TMP/gate.sh"
chmod +x "$TMP/gate.sh"

# Replace the tool path (between first and second |) with a non-existent path
sed -i "${LINE_NUM}s/|[^|]*|/|\/ZZNONEXISTENT\/BROKEN.sh|/" "$TMP/gate.sh"

# Run the mutated gate from the repo root so relative paths work
(cd "$ROOT" && bash "$TMP/gate.sh" 2>&1) >"$TMP/out" || true

OUTPUT=$(cat "$TMP/out")

if echo "$OUTPUT" | grep -q 'ferramenta nao encontrada'; then
  echo "PASS gate-missing-tool: FAIL message 'ferramenta nao encontrada' found"
else
  echo "FAIL gate-missing-tool: expected 'ferramenta nao encontrada' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
