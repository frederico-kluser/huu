# Learnings — committing-and-validating

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-06-26][source:inference][task:openrouter-models-keyless-public-catalog][probation] `web` is a real Conventional-Commit scope in this repo (the web front-end under `src/web/`), but the SKILL.md "Scopes actually used" list OMITS it. Precedent: HEAD `feat(web): download full OpenRouter catalog…` and this task's `feat(web): load full OpenRouter catalog…`. Consolidate should add `web` to the scope list. A markdown-only follow-up commit (docs + skills) still runs the FULL gate (`npm run typecheck && npm test`) because it ships alongside the code change it documents — both stayed green (704 passed, 1 skipped).
- [2026-06-30][source:user][task:fase1-docs-commit][probation] huu's Conventional-Commit scope vocabulary is WIDER than the list in this SKILL body — `web` (web/ UI+server; e.g. `feat(web): configurable max time per agent`) and `memory` (lib/memory-*; e.g. `feat(memory): make memory file parsing resilient`) are BOTH in history. A cross-cutting change may use a compound scope, e.g. `feat(orchestrator,web): …`. Do not reject a scope just because it is absent from the body list; check `git log` for prior art first.
