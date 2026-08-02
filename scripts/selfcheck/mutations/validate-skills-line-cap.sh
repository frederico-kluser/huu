#!/usr/bin/env bash
# Mutation: blow SKILL.md past the line cap (500 lines).
# Calculated: counts current lines and adds enough to exceed 500.
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

SKILL_DIR=$(ls "$TMP/.agents/skills" | grep -v '^catalog\.md$' | grep -v '^meta-skill-consolidate$' | head -1)
SKILL_MD="$TMP/.agents/skills/$SKILL_DIR/SKILL.md"

CURRENT=$(wc -l < "$SKILL_MD")
NEED=$((501 - CURRENT))
if [ "$NEED" -gt 0 ]; then
  for _ in $(seq 1 "$NEED"); do
    echo "." >> "$SKILL_MD"
  done
fi

sed -i "s|root=\".*\"|root=\"$TMP\"|" "$TMP/validate-skills.sh"

OUTPUT=$(cd "$TMP" && bash "$TMP/validate-skills.sh" 2>&1) || true

if echo "$OUTPUT" | grep -q 'lines.*cap 500'; then
  echo "PASS validate-skills-line-cap: line cap violation detected"
else
  echo "FAIL validate-skills-line-cap: expected 'lines (cap 500)' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
