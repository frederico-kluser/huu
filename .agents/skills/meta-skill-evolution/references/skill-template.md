# Canonical skill template

Copy, fill, and delete the comments. Frontmatter keeps ONLY name + description (+ metadata) for cross-tool portability — no allowed-tools or tool-specific fields.

```markdown
---
name: <gerund-lowercase-hyphen, ≤64 chars, equals the directory name>
description: <3rd person; what it does AND when to use it; explicit triggers; slightly pushy; ≤1024 chars>
metadata:
  version: 0.1.0
  type: <knowledge|task|router|meta>
---

# <Skill Title>

## When to use

<activation context: tasks, symptoms, file paths that should trigger this skill>

## Injected knowledge

<the minimum high-signal content the agent lacks: exact commands, constraints,
non-obvious patterns, gotchas. Explain the WHY of every rule. Provide the default
plus its escape hatch. No generic overviews; no unexplained MUST/ALWAYS/NEVER.>

## Procedure   <!-- task skills only -->

<numbered action steps; point deterministic steps at scripts/ files>

## References

<links to references/*.md, project docs, source files (prefer symbol names over line numbers), related skills by name>

> Facts verified against source on <YYYY-MM-DD>.

## <evolution>   <!-- task skills only — keep verbatim -->

After the task completes:

1. Only persist learnings if the task passed its tests/criteria.
2. Keep only non-obvious, durable learnings: surprises, user corrections, discovered conventions, failed approaches. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain. Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.
```

Companion files per skill directory:

- `LEARNINGS.md` — seeded with the append protocol header (copy from any existing skill).
- `references/*.md` — only when the content exists nowhere else (link to `docs/` instead of duplicating).
- `scripts/*.sh` — deterministic steps an agent should not improvise.

After creating: add one line to `catalog.md` and run `project-router/scripts/sync-skill-links.sh`.
