---
name: project-router
description: Routes EVERY implementation task in this codebase to the correct skills BEFORE any step. Use whenever the user asks for any change, bug fix, feature, analysis or refactor — even when no skill is mentioned explicitly. Classifies the task, assembles the skill chain from catalog.md, loads knowledge first, and guarantees each task skill runs its <aprender> step at the end (durable learnings → the project's CoALA memory).
metadata:
  version: 0.2.0
  type: router
---

# Project Router

## Protocol (run BEFORE any work)

0. **Orient in memory** — `python3 .agents/huu-coala-memory-agent-skill/scripts/coala.py recall "<task objective>" --budget 1500` (add `--type episodic --budget 600` for past decisions/events). All durable project memory lives in the CoALA base; there are no per-skill `LEARNINGS.md` files.
1. Classify the task: domain(s) touched, type (bug/feature/refactor/analysis/docs/release/**design**), complexity.
   - Type **design/plan/spec/architecture** (including plan/approval mode, and "what's the best way to…") ⇒ the chain STARTS with `surf-plan-skill`: its research gate must open before any plan reaches the user. The domain skills then follow, for whatever the plan proposes to touch.
2. Consult `.agents/skills/catalog.md` and select the relevant knowledge + task skills.
3. Assemble the CHAIN: knowledge skills first, then task skills; note which steps can run in parallel via subagents (isolated context).
4. Load the selected skills' knowledge BEFORE implementing — that is the point of the system; don't re-derive what a skill already states.
5. Execute the chain. Dispatch independent steps to subagents; keep merge/integration decisions in the main context.
6. On completion, make sure every task skill in the chain ran its `<aprender>` step (durable learnings → `coala.py add` in the project's CoALA memory).

## Rules

- If no skill covers the task, propose one by hand (SKILL.md + `catalog.md` entry) as an uncommitted git diff for human review — don't improvise undocumented conventions.
- When two skills could apply, prefer the more domain-specific one (e.g. editing-default-pipelines over authoring-pipelines for files under `src/lib/default-pipelines/`).
- `surf-plan-skill` beats improvising a plan. If its research layer is unavailable, say so INSIDE the plan (`NOT WEB-RESEARCHED` + a `blocker` finding) instead of presenting an unresearched plan as if it were researched.
- Trivial conversational/informational requests (and one-liner commands the user dictates verbatim) pass through without a chain — routing overhead must stay below task value.
- Never skip the `<aprender>` step on completed task-skill work; if the task FAILED its gates, skip persistence (failed learnings are noise).

## Maintenance

- `scripts/sync-skill-links.sh` regenerates the `.claude/skills/` symlinks from `.agents/skills/` (run after adding/renaming skills).
- The catalog is the single routing surface — a skill not listed there is invisible to this router.
- `scripts/validate-skills.sh` is the mechanical gate of the library (wired into `scripts/gate.sh`); it fails if a stray `LEARNINGS.md` reappears — memory stays centralized in CoALA.

## References

- `.agents/skills/catalog.md` (routing table), `huu-coala-memory-agent-skill` (project memory — orient/recover/act/learn)