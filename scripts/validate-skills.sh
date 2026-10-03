#!/usr/bin/env bash
# Mechanical guard of the memory-only knowledge world (wired into scripts/gate.sh).
#
# History. This script started as step 1 of meta-skill-consolidate: structural
# + vocabulary + TTL validation of a hand-curated skill library. The library
# then died in two migrations into the project's CoALA base:
#   2026-09-27 — 22 LEARNINGS.md + the meta memory skills migrated and deleted;
#               this script moved to scripts/ and gained the stray-LEARNINGS check.
#   2026-10-03 — EVERYTHING ELSE migrated (project-router + 19 SKILL.md +
#               catalog.md + agent-skills.md → CoALA records `skill/<name>`)
#               and deleted. Knowledge lives ONLY in
#               .agents/huu-coala-memory-agent-skill/memory/coala.sqlite.
#
# So this validator no longer validates a library — there is none. It enforces
# that the retired shape STAYS retired ("Ausência não falha sozinha", METODO
# §0.1): without this gate a stray SKILL.md or catalog.md silently grows back
# and the memory forks into two sources of truth again.
#
# FAILs on:
#   - any entry under .agents/skills/ that is not the memory registration
#     (a skill dir, a resurrected catalog.md — anything)
#   - a stray LEARNINGS.md anywhere under .agents/
#   - a root agent-skills.md (the deleted skill-system overview)
#   - no .agents/<p>-coala-memory-agent-skill/ (the memory skill itself)
#   - a missing/dangling .claude/skills registration for the memory skill
# PASS prints one OK line. Exits non-zero on any violation.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
skills="$root/.agents/skills"
fail=0
err() { echo "FAIL[$1] $2"; fail=1; }

memory_gone="knowledge lives only in .agents/huu-coala-memory-agent-skill/memory/coala.sqlite"

# ---- 1. .agents/skills/ holds ONLY the memory registration ----
# The coala installer registers the memory skill here (symlink) so agents can
# discover it; everything else is the retired library shape.
if [ -d "$skills" ]; then
  for entry in "$skills"/* "$skills"/.[!.]*; do
    [ -e "$entry" ] || continue
    name="$(basename "$entry")"
    case "$name" in
      *-coala-memory-agent-skill) continue ;;
      *) err "library" "'${entry#"$root"/}' — the skill library was migrated to the CoALA base (2026-10-03); $memory_gone" ;;
    esac
  done
fi

# ---- 2. No stray LEARNINGS.md anywhere under .agents/ ----
# The distributed per-skill journal died on 2026-09-27; a reappearance is the
# memory silently forking back into N files.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  err "learnings" "'${f#"$root"/}' — stray LEARNINGS.md — memory is centralized in the CoALA base (2026-09-27)"
done < <(find "$root/.agents" -name LEARNINGS.md -type f 2>/dev/null)

# ---- 3. No root agent-skills.md (the deleted skill-system overview) ----
if [ -e "$root/agent-skills.md" ]; then
  err "overview" "'agent-skills.md' — the skill-system overview was migrated to the CoALA base (2026-10-03); $memory_gone"
fi

# ---- 4. The memory skill itself must exist ----
mem_skill=""
for d in "$root"/.agents/*-coala-memory-agent-skill/ "$root"/.agents/skills/*-coala-memory-agent-skill/; do
  [ -f "$d/SKILL.md" ] && mem_skill="$d" && break
done
[ -n "$mem_skill" ] || err "memory" "no .agents/<p>-coala-memory-agent-skill/ — install it with the coala-agent-skill installer"

# ---- 5. Its .claude/skills registration must resolve ----
if [ -n "$mem_skill" ]; then
  mem_name="$(basename "$mem_skill")"
  link="$root/.claude/skills/$mem_name"
  { [ -L "$link" ] && [ -e "$link" ]; } || err "memory" "symlink missing or dangling in .claude/skills/$mem_name (re-run the coala-agent-skill installer)"
fi

# ---- Report ----
if [ "$fail" -eq 0 ]; then
  echo "OK: knowledge lives only in the CoALA base (memory skill registered, retired shapes absent)"
fi
exit "$fail"
