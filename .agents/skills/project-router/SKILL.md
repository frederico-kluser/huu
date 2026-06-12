---
name: project-router
description: Routes EVERY implementation task in this codebase to the correct skills BEFORE any step. Use whenever the user asks for any change, bug fix, feature, analysis or refactor — even when no skill is mentioned explicitly. Classifies the task, assembles the skill chain from catalog.md, loads knowledge first, and guarantees each task skill runs its evolution step at the end.
metadata:
  version: 0.1.0
  type: router
---

# Project Router

## Protocol (run BEFORE any work)

1. Classify the task: domain(s) touched, type (bug/feature/refactor/analysis/docs/release), complexity.
2. Consult `.agents/skills/catalog.md` and select the relevant knowledge + task skills.
3. Assemble the CHAIN: knowledge skills first, then task skills; note which steps can run in parallel via subagents (isolated context).
4. Load the selected skills' knowledge BEFORE implementing — that is the point of the system; don't re-derive what a skill already states.
5. Execute the chain. Dispatch independent steps to subagents; keep merge/序 decisions in the main context.
6. On completion, make sure every task skill in the chain ran its `<evolution>` step (learnings → the domain-owner skill's LEARNINGS.md, as an uncommitted diff).

Optional (only when the Stop-hook integration is enabled): at step 3 write the task-skill list to `.agents/workbench/.pending-evolution`, one name per line; each completed `<evolution>` removes its line. The hook blocks session end while lines remain.

## Rules

- If no skill covers the task, invoke meta-skill-evolution to propose one — don't improvise undocumented conventions.
- When two skills could apply, prefer the more domain-specific one (e.g. editing-default-pipelines over authoring-pipelines for files under `src/lib/default-pipelines/`).
- Trivial conversational/informational requests (and one-liner commands the user dictates verbatim) pass through without a chain — routing overhead must stay below task value.
- Never skip the evolution step on completed task-skill work; if the task FAILED its gates, skip persistence (failed learnings are noise).

## Maintenance

- `scripts/sync-skill-links.sh` regenerates the `.claude/skills/` symlinks from `.agents/skills/` (run after adding/renaming skills).
- The catalog is the single routing surface — a skill not listed there is invisible to this router.

## References

- `.agents/skills/catalog.md` (routing table), meta-skill-evolution, meta-skill-consolidate
