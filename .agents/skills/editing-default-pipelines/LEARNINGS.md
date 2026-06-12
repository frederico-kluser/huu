# Learnings — editing-default-pipelines

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-06-12][source:inference][task:knowledge-system][probation] registry.test.ts is NOT the whole default-pipeline contract: src/lib/pipeline-bootstrap.test.ts ALSO pins per-pipeline shapes (no $file in single-task steps; named check-loop topologies per pipeline). Replacing huu Agent Knowledge broke two of its asserts silently because only registry.test was run — the gate for default-pipeline changes is the FULL suite, not the named contract file.
