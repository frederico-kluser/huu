#!/usr/bin/env bash
# Stop-hook helper (OPT-IN — not wired by default; see
# .agents/workbench/stop-hook-proposal.md). Blocks session end while task-skill
# <evolution> steps are pending: the project-router writes the task-skill list
# to .agents/workbench/.pending-evolution (one name per line) when assembling a
# chain; each completed <evolution> step removes its line. Empty/absent file →
# allow stop.
f="$PWD/.agents/workbench/.pending-evolution"
if [ -s "$f" ]; then
  pending="$(tr '\n' ' ' < "$f")"
  printf '{"decision":"block","reason":"Pending <evolution> steps for: %s— run them, or delete .agents/workbench/.pending-evolution to override."}\n' "$pending"
fi
exit 0
