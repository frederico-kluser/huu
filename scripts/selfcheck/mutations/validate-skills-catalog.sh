#!/usr/bin/env bash
# Mutation: add a non-existent skill to catalog.md — reverse check MUST detect it.
# Message: "lists 'X' but no such skill exists"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

mkdir -p "$TMP/.agents/skills" "$TMP/.claude/skills"
cp -r "$ROOT/.agents/skills/"* "$TMP/.agents/skills/"
for d in "$TMP/.agents/skills"/*/; do
  name=$(basename "$d")
  [ "$name" = "meta-skill-consolidate" ] && continue
  ln -s "../.agents/skills/$name" "$TMP/.claude/skills/$name"
done

cp "$ROOT/.agents/skills/meta-skill-consolidate/scripts/validate-skills.sh" "$TMP/validate-skills.sh"
chmod +x "$TMP/validate-skills.sh"

# Add a fake skill entry to catalog.md — calculated name (not hardcoded)
FAKE_SKILL="zzz-fake-skill-for-selfcheck"
echo "- [${FAKE_SKILL}](${FAKE_SKILL}/SKILL.md) \`knowledge\` — fake entry for selfcheck." >> "$TMP/.agents/skills/catalog.md"

sed -i "s|root=\".*\"|root=\"$TMP\"|" "$TMP/validate-skills.sh"

OUTPUT=$(cd "$TMP" && bash "$TMP/validate-skills.sh" 2>&1) || true

if echo "$OUTPUT" | grep -q "lists '${FAKE_SKILL}' but no such skill exists"; then
  echo "PASS validate-skills-catalog: phantom catalog entry detected"
else
  echo "FAIL validate-skills-catalog: expected catalog phantom detection"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
