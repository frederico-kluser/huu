# Learnings — following-architecture-conventions

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-07-28][source:inference][task:dev-mode][probation] The "lower layers never import upper layers" rule has ONE established exception: run DRIVERS living in `lib/` may import `orchestrator/`. Precedent is `src/lib/run-many.ts` (imports Orchestrator + GlobalScheduler); `src/lib/dev-mode/dev-driver.ts` follows it. The test is whether the module ORCHESTRATES runs (a driver) rather than being consumed BY the orchestrator — everything below a driver (planner, compiler, prompt blocks) must stay pure and importable from anywhere.
