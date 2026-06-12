# Learnings — authoring-pipelines

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-06-12][source:user][task:memory-scope][probation] Third file-selection mode shipped: scope "memory" + filesFrom (huu-memory-v1: {"_format":"huu-memory-v1","files":[{"path","hint?","priority?"}]}) — an earlier step writes the list, the step fans out one agent per path, $hint carries the producer's note. Rules: never the first step (schema-enforced), maxFiles default 40, config.files override wins, missing→empty stage / corrupt→fail. Docs: pipeline-json-guide "memory" section.
