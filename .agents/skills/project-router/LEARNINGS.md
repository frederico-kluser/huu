# Learnings — project-router

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-07-30][source:inference][task:playbook-ondas][probation] The router was exercised across 34 cards in 11 waves (METODO.md playbook). The fan-out pattern held: one wave of hubs (W1: 6 independent tools) produced a wide wave next (W2: 7 cards composing on the gate). The catalog correctly routed domain-specific skills (editing-default-pipelines over authoring-pipelines for files under default-pipelines/). The evolution step at task completion was the bottleneck — deferring all evolutions to a single post-hoc pass is faster than per-card writes, at the cost of some recency precision. A future router should batch evolution appends per wave, not per card.
