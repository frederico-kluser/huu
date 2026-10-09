# Contributing to huu

> **Versão em português:** [CONTRIBUTING.md](CONTRIBUTING.md)

Thanks for your interest in contributing. This file is the terrain map:
what huu is (and is not), how to set up the environment, what CI
requires, and which conventions are non-negotiable. Read
[MANIFESTO.md](MANIFESTO.md) (pt-BR) or [MANIFESTO.en.md](MANIFESTO.en.md)
before proposing anything — the manifesto owns the project's identity,
and any contribution that contradicts it without declaring the
divergence will be rejected.

**Identity in one paragraph:** huu designs pipelines that make
*thinking* agents follow a *deterministic* process. It is NOT a tool
for building arbitrary new features — the focus is audits, test
generation, knowledge extraction, and any assembly-line process with
real, predictable value. **The human underwrites the method; the model
supplies the intelligence.** No LLM planner invents scope.

## Scope — what lands here

Welcome:

- Bug fixes and hardening of the gate, CI and isolation.
- New **bundled pipelines** (audits, tests, knowledge) with a declared
  methodology and a green `registry.test.ts`.
- Documentation (with the pt-BR ⇄ EN twin updated — see below).
- A new backend (`src/orchestrator/backends/<kind>/`) — dispatch is by
  *kind* (`jcode` | `stub` today), never by vendor.

Out of scope: features that turn huu into a general-purpose
productivity agent (Jira/Slack integrations, MCP, "do anything" mode).
Discuss in an issue before writing code — for a project like this, the
design comes before the implementation.

## Before you start

1. **Open an issue** (or comment on an existing one) describing the
   problem and the approach — structural changes never arrive as a
   surprise in a PR.
2. **Security vulnerability?** Never open a public issue — follow
   [SECURITY.md](SECURITY.md) ([English](SECURITY.en.md)).
3. By contributing you agree to the [Code of Conduct](CODE_OF_CONDUCT.md)
   ([English](CODE_OF_CONDUCT.en.md)).

## Development environment

- **Node.js ≥ 20**, `git` and **Docker** (huu is docker by default; the
  container carries the memory ceiling and the credential isolation).
- Install dependencies: `npm install`.
- Enable the local hooks (once per clone):
  `git config core.hooksPath .githooks` — they bring the `pre-push`
  (typecheck + tests) and the `commit-msg` (Conventional Commits) hooks.

| Command | What for |
|---|---|
| `npm run dev` | **native** hot reload (`HUU_DEV_NATIVE=1`) — contributor loop; it prints a banner because isolation is OFF |
| `npm run dev:docker` | hot reload through Docker — the faithful rehearsal of what a user gets |
| `npm start` | runs the CLI (rebuilds the `huu:local` image first — the stale-image trap) |
| `npm run build` | compiles to `dist/` |
| `npm run typecheck` | type-check only (TS + client) |
| `npm test` | the Vitest suite (thousands of cases; ~a minute) |

## The gate — the same yardstick as CI

**Run `bash scripts/gate.sh` before opening the PR.** It reproduces CI
(`.github/workflows/gate.yml`) exactly — **ten steps** today: typecheck ·
test · validate-skills · check-acceptance · smoke-defaults ·
validate-graph · check-pins · check-twins · check-metodo ·
check-dockerfile. `bash scripts/gate.sh --list-from-ci` reads the
workflow YAML and prints the steps CI runs, so the two lists cannot
drift silently.

The everyday minimum — and what the `pre-push` hook runs — is
`npm run typecheck && npm test` before **every** commit. CI is a
backstop, not a substitute: it only reports after the push.

## Commits — Conventional Commits

Format: `type(scope)!: short description` (header ≤ 100 characters).

- **Closed type set:** `feat` `fix` `docs` `style` `refactor` `perf`
  `test` `build` `ci` `chore` `revert`.
- **BREAKING CHANGE:** mark with `!` after the scope and describe the
  rupture in the body (`BREAKING CHANGE: …`).
- The body explains *why*, not the diff. Reference issues as `#123`.
- PR titles follow the same format — on squash merge, the squash
  message is the PR title.

The `commit-msg` hook rejects messages outside the format (and
`pre-push` rejects a push without a green local yardstick). Same
mechanism in any clone, without waiting for CI.

## Branches, PRs and merge

- `main` is the trunk. **Never force-push to `main`.**
- Ephemeral branch (`feat/…`, `fix/…`, `docs/…`) → PR against `main` →
  merge. The repository's `pull-request-rule` ruleset requires **1
  approval** and a CODEOWNER review; allowed merge methods are merge,
  squash and rebase.
- Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`): the
  checklist is mandatory and the question *"if this change disappeared,
  what would go red?"* needs an honest answer — if the answer is
  "nothing", the PR needs a test or a gate.
- Linear history and conventional messages matter more than
  implementation detail in the diff — review the commit, not just the
  code.

## Two-language documentation (pt-BR ⇄ EN twins)

Every user-facing document exists as a pair: `README.md` ↔
`README.en.md`, `MANIFESTO.md` ↔ `MANIFESTO.en.md`, `CONTRIBUTING.md` ↔
`CONTRIBUTING.en.md`, `SECURITY.md` ↔ `SECURITY.en.md`,
`CODE_OF_CONDUCT.md` ↔ `CODE_OF_CONDUCT.en.md`, and under `docs/` the
pairs `X.md` ↔ `X.pt-BR.md` (English on the canonical name). **Change
one, change the other**, with the same `##` headings in the same order —
the `check-twins` gate (`scripts/check-twins.ts`) fails on divergence.
The color convention (magenta reserved for AI-driven UI) lives in the
README ("Visual conventions") and in `src/ui/theme.ts`.

## Project knowledge — CoALA memory

The project's durable knowledge lives in the CoALA memory
(`.agents/huu-coala-memory-agent-skill/`). There is no skill library in
the repository — the `validate-skills` gate **fails** on a stray
`SKILL.md`, `catalog.md`, `LEARNINGS.md` or `agent-skills.md`.

- Before implementing: `python3 .agents/huu-coala-memory-agent-skill/scripts/coala.py recall "<task>" --budget 1500`.
- At the end, record what is durable and verified:
  `… add --type episodic|semantic|procedural --content "…" [--key <subject>]`.
- Facts that change are **superseded** (`--key`/`supersede`), never
  rewritten. Never store secrets in memory.

## Changelog — fragments under `.changes/`

`CHANGELOG.md` follows Keep a Changelog and is consolidated from
fragments: write a `.changes/<card>.md` with `### Added` / `### Changed`
/ `### Fixed` / `### Removed` sections instead of editing
`[Unreleased]` directly (it avoids conflicts between parallel
worktrees). Validate with `npx tsx scripts/changelog.ts --check`; the
maintainer consolidates at release time (`npx tsx scripts/changelog.ts`).

Releases are cut by the maintainer: SemVer bump + CHANGELOG + annotated
tag + publish to npm (`huu-pipe`) and GHCR. There are no GitHub Release
objects — the tag is the release.

## Security and vulnerabilities

Vulnerability reports follow [SECURITY.md](SECURITY.en.md): **never** in
a public issue, never with keys or credentials in the text. huu handles
third-party API keys at runtime — treat any potential leak as an
incident.

## License of contributions

`huu` (the runner) is **Apache License 2.0** — see [LICENSE](LICENSE).
By submitting a contribution you license it under the same license.
**Pipelines are not the runner**: the `huu-pipeline-v1` format is an
open specification, and pipelines you write are yours — the cookbook
convention is MIT or CC0.
