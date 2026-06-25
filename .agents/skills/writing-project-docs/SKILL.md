---
name: writing-project-docs
description: Doc conventions for huu — pt-BR-first at the repo root (README.md + README.en.md twins), docs/ in English with .pt-BR.md variants, CHANGELOG in Keep a Changelog 1.1.0 with semver-0.x rules, and the MANIFESTO identity framing that all docs must respect. Use when creating or editing any markdown documentation, README section, or changelog entry.
metadata:
  version: 0.1.0
  type: knowledge
---

# Writing Project Docs

## When to use

Any markdown work: READMEs, docs/, CHANGELOG, MANIFESTO, doc comments that will be surfaced to users.

## Injected knowledge

### Language layout (bilingual by twin files, never mixed in one file)

- Repo root is pt-BR-first: `README.md` and `MANIFESTO.md` are Portuguese; their English twins are `README.en.md` / `MANIFESTO.en.md`. Editing one side of a pair means updating the twin in the same change — they drift otherwise.
- `docs/` is English-first with explicit pt-BR variants: `ci.md` + `ci.pt-BR.md`, `onboarding.md` + `onboarding.pt-BR.md`, `operations.md` + `operations.pt-BR.md`. Single-language docs there (ARCHITECTURE.md, PORT-SHIM.md, KEYBOARD.md, pipeline-json-guide.md — EN; azure-backend.md — pt-BR) have no twin; don't invent one unless asked.
- New long-form docs go under `docs/`, not the repo root.

### CHANGELOG

- Keep a Changelog 1.1.0 format; new entries go under `[Unreleased]` and move into `[X.Y.Z] - YYYY-MM-DD` at release time.
- Versioning is 0.x-style semver: breaking changes ride MINOR bumps by convention. `npm run release-notes` prints commits since the package.json version as raw material.

### Identity framing — the rule that shapes wording

huu "designs pipelines that make thinking agents follow a deterministic process… No LLM planner invents scope; the human underwrites the method, the agent supplies the intelligence" (AGENTS.md). Docs must not market huu as a feature-building/autonomous-coding tool — position it for audits, test generation, knowledge extraction, assembly-line work with predictable value. When in doubt, mirror MANIFESTO.md's framing.

### Visual conventions (when documenting UI)

`theme.ai` magenta/fuchsia means "AI-driven UI" in both TUI and web; README's "Visual conventions" section is the user-facing source. Screenshots/descriptions should respect that mapping.

### Pointers

- Architecture deep-dive: `docs/ARCHITECTURE.md`; pipeline JSON spec: `docs/pipeline-json-guide.md` (anchor `#conditional-steps-check-nodes` exists — safe to link); CI recipes: `docs/ci.md`; keyboard map: `docs/KEYBOARD.md`.
- AGENTS.md is the agent-facing entrypoint (CLAUDE.md is a symlink to it) — changes to build/run/skill instructions land there, once, not duplicated across docs.

## References

- `README.md` / `README.en.md`, `CHANGELOG.md`, `MANIFESTO.md`, `docs/`
- Related skill: committing-and-validating (docs-only commits still follow Conventional Commits — `docs:` type)

> Facts verified against source on 2026-06-12.
