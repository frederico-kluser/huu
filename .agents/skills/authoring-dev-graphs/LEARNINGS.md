# Learnings — authoring-dev-graphs

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-08-04][source:inference][task:devgraph-skill-seed][probation] Seed. `huu-devgraph-v1` shipped as ~18 modules under `src/lib/dev-graph/` with no covering skill; this skill was created by meta-skill-evolution at the end of the wave that built it. Facts to watch as the feature settles: whether `GraphIssueCode` stays additive (the front-end maps codes to translated sentences, so a rename is a breaking change), and whether the `.huu/findings/` path contract survives — it is coupled to a gitignore remedy embedded in the block `promptTemplate`s, which is the kind of coupling that gets refactored away by someone who cannot see it from either side.
