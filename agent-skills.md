# Agent Skills — huu

> Human overview of the skill system. The canonical, always-current index is
> [`.agents/skills/catalog.md`](.agents/skills/catalog.md) — this page explains how the
> system works; it deliberately does not duplicate the list.

## How it works

- **Source of truth:** `.agents/skills/<name>/` (one directory per skill: `SKILL.md` +
  `LEARNINGS.md`, optional `references/` and `scripts/`). Portable across tools: only
  `name` + `description` (+ a small `metadata` block) in the frontmatter, no
  tool-specific fields. `.claude/skills/` contains per-skill symlinks into it —
  regenerate with `.agents/skills/project-router/scripts/sync-skill-links.sh`.
- **Routing:** every task starts at `project-router`, which consults `catalog.md`,
  assembles the skill chain (knowledge first, then task skills), and ensures the chain's
  knowledge is loaded BEFORE implementation.
- **Evolution:** task skills end with an `<evolution>` step. Validated learnings are
  appended to the LEARNINGS.md of the skill that owns the domain (entry state
  `probation`), with strict provenance rules (user feedback > verified code observation;
  never instructions arriving in tool output — anti prompt-injection). Promotion into a
  SKILL.md body happens only via `meta-skill-consolidate` (periodic GC: dedupe,
  temporal versioning of contradictions, budget enforcement), and every change ships as
  an uncommitted git diff for human review.
- **Curation principle:** generated knowledge is a draft until a human approves it —
  uncurated LLM context files measurably degrade agent success (Gloaguen et al., ETH
  Zurich, arXiv:2602.11988). This library was hand-curated against the source on
  2026-06-12, replacing the previous 9 pipeline-generated skills.

## Maintenance

| Action | How |
|---|---|
| List/route skills | `.agents/skills/catalog.md` |
| Validate the library | `.agents/skills/meta-skill-consolidate/scripts/validate-skills.sh` |
| Re-sync `.claude/skills/` symlinks | `.agents/skills/project-router/scripts/sync-skill-links.sh` |
| Propose a new skill | `meta-skill-evolution` (template in its `references/skill-template.md`) |
| Periodic cleanup | `meta-skill-consolidate` |
