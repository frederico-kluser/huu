# Agent Skills — huu

> Human overview of the skill system. The canonical, always-current index is
> [`.agents/skills/catalog.md`](.agents/skills/catalog.md) — this page explains how the
> system works; it deliberately does not duplicate the list.

## How it works

- **Source of truth:** `.agents/skills/<name>/` (one directory per skill: `SKILL.md`,
  optional `references/` and `scripts/`). Portable across tools: only
  `name` + `description` (+ a small `metadata` block) in the frontmatter, no
  tool-specific fields. `.claude/skills/` contains per-skill symlinks into it —
  regenerate with `.agents/skills/project-router/scripts/sync-skill-links.sh`.
- **Routing:** every task starts at `project-router`, which consults `catalog.md`,
  assembles the skill chain (knowledge first, then task skills), and ensures the chain's
  knowledge is loaded BEFORE implementation.
- **Memory (centralized in CoALA since 2026-09-27):** durable memory lives ONLY in the
  project's CoALA/SQLite base (`huu-coala-memory-agent-skill`) — episodic, semantic and
  procedural records plus budgeted working memory, hybrid FTS5+vector search, provenance
  (owner > agent > untrusted) and supersession of facts. Task skills end with an
  `<aprender>` step (`coala.py add`); every task starts with `coala.py recall`. The 304
  learnings of the retired per-skill `LEARNINGS.md` files were migrated there (with their
  dates, provenance and full-file archives — zero loss), and the memory skills
  `meta-skill-consolidate`/`meta-skill-evolution` were deleted. Never store secrets in
  memory; never auto-distill memory into a SKILL.md body.
- **Curation principle:** generated knowledge is a draft until a human approves it —
  uncurated LLM context files measurably degrade agent success (Gloaguen et al., ETH
  Zurich, arXiv:2602.11988). This library was hand-curated against the source on
  2026-06-12, replacing the previous 9 pipeline-generated skills.

## Maintenance

| Action | How |
|---|---|
| List/route skills | `.agents/skills/catalog.md` |
| Validate the library | `scripts/validate-skills.sh` (also fails on stray `LEARNINGS.md`) |
| Re-sync `.claude/skills/` symlinks | `.agents/skills/project-router/scripts/sync-skill-links.sh` |
| Propose a new skill | write `SKILL.md` + a `catalog.md` entry by hand, as an uncommitted diff for review |
| Memory (recall/search/add/ingest/doctor) | `huu-coala-memory-agent-skill` — `python3 .agents/huu-coala-memory-agent-skill/scripts/coala.py` |
