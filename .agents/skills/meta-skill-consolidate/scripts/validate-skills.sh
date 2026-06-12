#!/usr/bin/env bash
# Mechanical validation of the skill library (step 1 of meta-skill-consolidate).
# Checks, per skill dir: SKILL.md present; frontmatter name == directory;
# description 1..1024 chars (single-line descriptions assumed); body < 500
# lines and ~< 5000 tokens (bytes/4); LEARNINGS.md present; listed in
# catalog.md; .claude/skills symlink resolves. Also: every catalog entry must
# resolve to a real skill. Exits non-zero on any violation.
set -uo pipefail

root="$(cd "$(dirname "$0")/../../../.." && pwd)"
skills="$root/.agents/skills"
fail=0
err() { echo "FAIL[$1] $2"; fail=1; }

for dir in "$skills"/*/; do
  name="$(basename "$dir")"
  f="$dir/SKILL.md"
  [ -f "$f" ] || { err "$name" "missing SKILL.md"; continue; }

  fmname="$(awk -F': ' '/^name:/{print $2; exit}' "$f")"
  [ "$fmname" = "$name" ] || err "$name" "frontmatter name '$fmname' != directory name"

  desc_len="$(awk '/^description:/{sub(/^description: /,""); print length($0); exit}' "$f")"
  if [ -z "${desc_len:-}" ] || [ "$desc_len" -lt 1 ] || [ "$desc_len" -gt 1024 ]; then
    err "$name" "description length ${desc_len:-0} outside 1..1024"
  fi

  lines="$(wc -l < "$f")"
  [ "$lines" -lt 500 ] || err "$name" "body $lines lines (cap 500)"

  toks=$(( $(wc -c < "$f") / 4 ))
  [ "$toks" -lt 5000 ] || err "$name" "~$toks tokens (cap 5000)"

  [ -f "$dir/LEARNINGS.md" ] || err "$name" "missing LEARNINGS.md"

  grep -q "($name/SKILL.md)" "$skills/catalog.md" || err "$name" "not listed in catalog.md"

  link="$root/.claude/skills/$name"
  { [ -L "$link" ] && [ -e "$link" ]; } || err "$name" "symlink missing or dangling in .claude/skills (run sync-skill-links.sh)"
done

# Reverse check: catalog entries must point at existing skills.
while IFS= read -r n; do
  [ -f "$skills/$n/SKILL.md" ] || err "catalog" "lists '$n' but no such skill exists"
done < <(grep -o '([a-z0-9-]*/SKILL.md)' "$skills/catalog.md" | sed 's|^(\(.*\)/SKILL.md)$|\1|')

if [ "$fail" -eq 0 ]; then
  echo "OK: all skills pass structural validation"
fi
exit "$fail"
