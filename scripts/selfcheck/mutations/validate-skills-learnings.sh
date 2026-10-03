#!/usr/bin/env bash
# Mutation: a stray LEARNINGS.md appears — the memory-only guard MUST detect it
# (the per-skill journal was migrated to the CoALA base on 2026-09-27).
# Message: "stray LEARNINGS.md"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Fixture: the CLEAN memory-only state (memory skill + its registrations).
mkdir -p "$TMP/.agents/skills" "$TMP/.claude/skills" "$TMP/.agents/huu-coala-memory-agent-skill"
echo '# memory skill' > "$TMP/.agents/huu-coala-memory-agent-skill/SKILL.md"
ln -s ../huu-coala-memory-agent-skill "$TMP/.agents/skills/huu-coala-memory-agent-skill"
ln -s ../../.agents/skills/huu-coala-memory-agent-skill "$TMP/.claude/skills/huu-coala-memory-agent-skill"

cp "$ROOT/scripts/validate-skills.sh" "$TMP/validate-skills.sh"
chmod +x "$TMP/validate-skills.sh"
sed -i "s|root=\".*\"|root=\"$TMP\"|" "$TMP/validate-skills.sh"

# The defect: the distributed journal grows back.
echo '# Learnings' > "$TMP/.agents/skills/LEARNINGS.md"

OUTPUT=$(cd "$TMP" && bash "$TMP/validate-skills.sh" 2>&1) || true

if echo "$OUTPUT" | grep -q "stray LEARNINGS.md"; then
  echo "PASS validate-skills-learnings: stray LEARNINGS.md detected"
else
  echo "FAIL validate-skills-learnings: expected 'stray LEARNINGS.md'"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
