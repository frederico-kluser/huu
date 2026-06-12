# Learnings — writing-tests

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-06-12][source:inference][task:dag-waves][probation] Captures inside parallel-pool stub factories arrive in COMPLETION order, not creation order — assert by identity (sort captured tasks by file, find() prompts by content), never by arrival index. A capture-order assertion is a latent flake that surfaces only under load.
