# Learnings — surf-plan-skill

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.
This skill is VENDORED from `surf-skill@5.2.0`; upstream-drift observations belong here too.

<!-- entries below this line -->
- [2026-07-31][source:inference][task:dev-mode-metodologias][probation] On THIS host, the research layers have a working hybrid: `surf-research-skill` CLI v5.0.0 (Layer A) served the synthesis batch directly, and explore-type subagents carrying WebSearch/FetchURL covered baseline + grounding in ONE parallel round (6 agents: 3 codebase + 3 web) — the vendored "no harness WebSearch rung" caveat binds the pi agent inside huu's container, not a host harness that has those tools. Deep-mode clarify also compresses well: a single AskUserQuestion round with multi_select settled 4 register items at once (scope/options/BDD/enforcement), no second round needed, and the answers mapped 1:1 onto plan Decisions.
