#!/usr/bin/env bash
# Mutation: the CoALA memory skill is missing — the memory-only guard MUST
# detect it (a project with no local memory has no knowledge at all).
# Message: "no .agents/<p>-coala-memory-agent-skill/"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Fixture: an empty skill surface and NO memory skill.
mkdir -p "$TMP/.agents/skills" "$TMP/.claude/skills"

cp "$ROOT/scripts/validate-skills.sh" "$TMP/validate-skills.sh"
chmod +x "$TMP/validate-skills.sh"
sed -i "s|root=\".*\"|root=\"$TMP\"|" "$TMP/validate-skills.sh"

OUTPUT=$(cd "$TMP" && bash "$TMP/validate-skills.sh" 2>&1) || true

if echo "$OUTPUT" | grep -q "no .agents/<p>-coala-memory-agent-skill"; then
  echo "PASS validate-skills-no-memory: missing memory skill detected"
else
  echo "FAIL validate-skills-no-memory: expected 'no .agents/<p>-coala-memory-agent-skill'"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
