#!/usr/bin/env bash
# Mechanical validation of the skill library (step 1 of meta-skill-consolidate).
# Checks, per skill dir: SKILL.md present; frontmatter name == directory;
# description 1..1024 chars (single-line descriptions assumed); body < 500
# lines and ~< 5000 tokens (bytes/4); LEARNINGS.md present; listed in
# catalog.md; .claude/skills symlink resolves. Also: every catalog entry must
# resolve to a real skill.
#
# Added checks (M2-05):
# - Closed vocabulary: LEARNINGS.md entries must match the canonical format.
# - TTL freshness: warn if skill files are >30d stale, fail if >90d.
# - Backend names: grep skill bodies for backend-kind references, verify
#   against src/orchestrator/backends/registry.ts.
# Exits non-zero on any violation.
set -uo pipefail

root="$(cd "$(dirname "$0")/../../../.." && pwd)"
skills="$root/.agents/skills"
fail=0
warns=0
err() { echo "FAIL[$1] $2"; fail=1; }
wrn() { echo "WARN[$1] $2"; warns=1; }

now_epoch=$(date +%s)
days_since() {
  local file_epoch
  file_epoch=$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0)
  echo $(( (now_epoch - file_epoch) / 86400 ))
}

# ---- Structural checks (original) ----

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

# ---- M2-05: Closed vocabulary for LEARNINGS.md entries ----
# Canonical format: "- [YYYY-MM-DD][source:user|inference|agent][task:<slug>][probation|promoted|superseded] <fact>"
# Only validates lines that start with "- [20" (actual entry lines), skipping
# headers, comments, and boilerplate.
LEARNINGS_ENTRY_RE='^- \[20[0-9][0-9]-[0-1][0-9]-[0-3][0-9]\]\[source:(user|inference|agent)\]\[task:[a-z0-9._-]+\]\[(probation|promoted|superseded)\] .+'

for dir in "$skills"/*/; do
  name="$(basename "$dir")"
  lf="$dir/LEARNINGS.md"
  [ -f "$lf" ] || continue
  # Only check lines after the entries marker
  past_marker=false
  while IFS= read -r line; do
    # Detect the entries-start marker
    [[ "$line" =~ ^\<\!--\ entries\ below ]] && past_marker=true && continue
    $past_marker || continue
    # Skip empty lines and HTML comments
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^\<\!\-\- ]] && continue
    # Skip non-entry lines (headings in entries section, etc.)
    [[ "$line" =~ ^# ]] && continue
    # Only check lines that start with "- [20" (actual entries)
    if [[ "$line" =~ ^-\ \[20 ]]; then
      if ! [[ "$line" =~ $LEARNINGS_ENTRY_RE ]]; then
        err "$name" "LEARNINGS entry violates closed vocabulary: '${line:0:120}...'"
      fi
    fi
  done < "$lf"
done

# ---- M2-05: TTL freshness check ----
# Warn if SKILL.md or LEARNINGS.md is >30d since last modification.
# Fail if >90d since last modification.
for dir in "$skills"/*/; do
  name="$(basename "$dir")"
  max_age=0
  for f in "$dir/SKILL.md" "$dir/LEARNINGS.md"; do
    [ -f "$f" ] || continue
    age=$(days_since "$f")
    [ "$age" -gt "$max_age" ] && max_age="$age"
  done
  if [ "$max_age" -gt 90 ]; then
    err "$name" "TTL expired: ${max_age}d since last modification (>90d cap)"
  elif [ "$max_age" -gt 30 ]; then
    wrn "$name" "TTL stale: ${max_age}d since last modification (>30d)"
  fi
done

# ---- M2-05: Backend name consistency check ----
# Extract valid backend kind names from registry.ts and verify that any
# backend-kind references in skill bodies are covered.
registry="$root/src/orchestrator/backends/registry.ts"
if [ -f "$registry" ]; then
  # Collect valid backend kind strings (union type + ALL_BACKENDS + aliases from parseBackendKind)
  valid_kinds_tmp=$(mktemp)
  # The union type: 'pi' | 'azure' | 'stub'
  grep -oE "'[a-z][a-z0-9-]*'" "$registry" | tr -d "'" | sort -u > "$valid_kinds_tmp"
  # Also capture parseBackendKind aliases (words after 'return')
  grep -oP "return '[a-z][a-z0-9-]*'" "$registry" | sed "s/return '//;s/'//" >> "$valid_kinds_tmp"
  grep -oP "return '[a-z][a-z0-9-]*'" "$registry" | sed "s/return '//;s/'//" >> "$valid_kinds_tmp"
  sort -u -o "$valid_kinds_tmp" "$valid_kinds_tmp"

  for dir in "$skills"/*/; do
    name="$(basename "$dir")"
    for f in "$dir/SKILL.md" "$dir/LEARNINGS.md"; do
      [ -f "$f" ] || continue
      # Find quoted strings that look like backend references (single words)
      while IFS= read -r ref; do
        [ -z "$ref" ] && continue
        # Skip common non-backend words
        case "$ref" in
          pi|azure|stub|openrouter|real|fake|mock|azure-openai|azure-foundry) ;;
          *) continue ;;  # only check known backend-like terms
        esac
        if ! grep -qxF "$ref" "$valid_kinds_tmp"; then
          err "$name" "references backend kind '$ref' not found in registry.ts"
        fi
      done < <(grep -oP "(?<![/a-zA-Z0-9_.-])($(tr '\n' '|' < "$valid_kinds_tmp"))(?![a-zA-Z0-9_-])" "$f" 2>/dev/null || true)
    done
  done
  rm -f "$valid_kinds_tmp"
fi

# ---- Report ----

if [ "$fail" -eq 0 ] && [ "$warns" -eq 0 ]; then
  echo "OK: all skills pass structural + vocabulary + TTL + backend-name validation"
elif [ "$fail" -eq 0 ]; then
  echo "OK: all checks pass (with warnings)"
fi
exit "$fail"
