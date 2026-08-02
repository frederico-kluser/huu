#!/usr/bin/env bash
# Mutation: blow SKILL.md past the token cap (5000 tokens ≈ 20000 bytes).
# Calculated: computes current size and adds enough /dev/urandom to exceed cap.
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

# Calculate bytes needed to exceed 20000 (cap is 5000 tokens ≈ bytes/4)
CURRENT=$(wc -c < "$SKILL_MD")
NEED=$((20001 - CURRENT))
if [ "$NEED" -gt 0 ]; then
  head -c "$NEED" /dev/urandom >> "$SKILL_MD"
fi

sed -i "s|root=\".*\"|root=\"$TMP\"|" "$TMP/validate-skills.sh"

OUTPUT=$(cd "$TMP" && bash "$TMP/validate-skills.sh" 2>&1) || true

if echo "$OUTPUT" | grep -q 'tokens.*cap 5000'; then
  echo "PASS validate-skills-token-cap: token cap violation detected"
else
  echo "FAIL validate-skills-token-cap: expected 'tokens (cap 5000)' in output"
  echo "--- output ---"
  echo "$OUTPUT"
  echo "---"
  exit 1
fi
