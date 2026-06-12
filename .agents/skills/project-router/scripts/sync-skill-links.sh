#!/usr/bin/env bash
# Regenerates .claude/skills/<name> → ../../.agents/skills/<name> symlinks
# from the skill directories present in .agents/skills/ (those containing a
# SKILL.md), and removes dangling links left by renamed/deleted skills.
# Idempotent; safe to run any time.
set -euo pipefail

root="$(cd "$(dirname "$0")/../../../.." && pwd)"
src="$root/.agents/skills"
dst="$root/.claude/skills"
mkdir -p "$dst"

created=0
for dir in "$src"/*/; do
  name="$(basename "$dir")"
  [ -f "$dir/SKILL.md" ] || continue
  ln -sfn "../../.agents/skills/$name" "$dst/$name"
  created=$((created + 1))
done

removed=0
for link in "$dst"/*; do
  [ -L "$link" ] || continue
  if [ ! -e "$link" ]; then
    rm "$link"
    echo "removed dangling: $(basename "$link")"
    removed=$((removed + 1))
  fi
done

echo "synced $created links ($removed dangling removed) → $dst"
