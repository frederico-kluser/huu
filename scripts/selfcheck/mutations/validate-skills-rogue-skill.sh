#!/usr/bin/env bash
# Mutation: a skill dir grows back under .agents/skills/ — the memory-only guard
# MUST detect it (knowledge lives only in the CoALA base since 2026-10-03).
# Message: "the skill library was migrated to the CoALA base"
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

# The defect: a rogue skill appears.
mkdir -p "$TMP/.agents/skills/rogue-skill"
echo '# rogue' > "$TMP/.agents/skills/rogue-skill/SKILL.md"

OUTPUT=$(cd "$TMP" && bash "$TMP/validate-skills.sh" 2>&1) || true

if echo "$OUTPUT" | grep -q "the skill library was migrated to the CoALA base"; then
  echo "PASS validate-skills-rogue-skill: rogue skill detected"
else
  echo "FAIL validate-skills-rogue-skill: expected 'the skill library was migrated to the CoALA base'"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
