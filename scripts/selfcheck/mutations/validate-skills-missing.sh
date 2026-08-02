#!/usr/bin/env bash
# Mutation: remove SKILL.md from one skill dir — validate-skills MUST report "missing SKILL.md".
# Calculated: dynamically finds a skill directory (not hardcoded name).
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Setup dirs matching the expected layout: root/.agents/skills, root/.claude/skills
mkdir -p "$TMP/.agents/skills" "$TMP/.claude/skills"
cp -r "$ROOT/.agents/skills/"* "$TMP/.agents/skills/"
# Create symlinks so the symlink check passes for non-mutated skills
for d in "$TMP/.agents/skills"/*/; do
  name=$(basename "$d")
  [ "$name" = "meta-skill-consolidate" ] && continue
  ln -s "../.agents/skills/$name" "$TMP/.claude/skills/$name"
done

cp "$ROOT/.agents/skills/meta-skill-consolidate/scripts/validate-skills.sh" "$TMP/validate-skills.sh"
chmod +x "$TMP/validate-skills.sh"

# Find one skill dir (not catalog.md, not the meta-skill itself) and remove its SKILL.md
SKILL_DIR=$(ls "$TMP/.agents/skills" | grep -v '^catalog\.md$' | grep -v '^meta-skill-consolidate$' | head -1)
rm "$TMP/.agents/skills/$SKILL_DIR/SKILL.md"

# Patch root path
sed -i "s|root=\".*\"|root=\"$TMP\"|" "$TMP/validate-skills.sh"

OUTPUT=$(cd "$TMP" && bash "$TMP/validate-skills.sh" 2>&1) || true

if echo "$OUTPUT" | grep -q 'missing SKILL.md'; then
  echo "PASS validate-skills-missing: 'missing SKILL.md' detected"
else
  echo "FAIL validate-skills-missing: expected 'missing SKILL.md' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
