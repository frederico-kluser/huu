# Changelog

All notable changes to `huu` are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
SemVer 0.x.x convention: breaking changes go in minor-version bumps.

## [Unreleased]

### Added

- **Project recon stage in the pipeline assistant.** Before the assistant
  starts asking questions, it now fires four MiniMax M2.7 agents in
  parallel — `stack`, `structure`, `libraries`, and `conventions` — each
  with its own loader and its own focused mission. Their findings are
  aggregated into a "Contexto do projeto" section injected into the
  assistant's system prompt, so the interview can ask project-specific
  questions instead of generic ones.
  - Errors are isolated per agent: if one times out or fails to parse,
    the other three still complete and the assistant proceeds with
    whatever context survived.
  - Stub mode (`apiKey === "stub"` / `HUU_LANGCHAIN_STUB=1`) returns
    canned bullets so smoke tests never touch the network.
  - `ESC` during recon goes back to the intent prompt (no
    confirm dialog — there's no user work to lose).

## [0.3.1] - 2026-04-29

### Added

- **Step `scope` field.** Each pipeline step now declares whether it runs
  on the **whole project** (`scope: "project"`), **once per file**
  (`scope: "per-file"`), or is left **flexible** (`scope: "flexible"`,
  also the default when `scope` is omitted). The Step Editor shows a
  Scope row above Files; cycle with `ENTER` or jump with `P`/`F`/`X`.
  - `project` locks the Files row to "whole project" — `F`/`W` are
    disabled and pressing `ENTER` is a no-op.
  - `per-file` makes file selection mandatory, and pressing `ENTER` on
    the Files row opens the picker (in addition to `F`).
  - `flexible` keeps the previous behavior (`F` to pick, `W` for whole
    project).
  - Loading older `huu-pipeline-v1` JSON without the `scope` field is
    fully back-compatible — those steps behave as `flexible`.

## [0.3.0] - 2026-04-29

Initial public release. Available on npm as `huu-pipe`
(`npm install -g huu-pipe`) and as a container image at
`ghcr.io/frederico-kluser/huu:latest`.

### Features

- **Auto-Docker re-exec.** Typing `huu` in any folder transparently
  mounts that folder into the official container and runs there — the
  LLM agent never sees host-side `~/.ssh`, `~/.aws`, or `~/.npmrc`
  tokens. Set `HUU_NO_DOCKER=1` for native execution (development).
- **Subcommands:** `huu run`, `huu init-docker`, `huu status`,
  `huu prune`.
- **Bundled reference pipelines** at `$HUU_COOKBOOK_DIR`
  (`/opt/huu/cookbook/`) — usable without cloning the repo.
- **Configurable via** `HUU_IMAGE`, `HUU_NO_DOCKER`,
  `HUU_DOCKER_PASS_ENV`, `HUU_WORKTREE_BASE`,
  `OPENROUTER_API_KEY_FILE`.

### Security

- `OPENROUTER_API_KEY` delivered via bind-mounted file at
  `/run/secrets/openrouter_api_key` (mode `0600`); never appears in
  `docker inspect` or `ps auxf`.
- Container UID/GID matched to host user via
  `--user "$(id -u):$(id -g)"`.
- `safe.directory '*'` set system-wide in the image.


[Unreleased]: https://github.com/frederico-kluser/huu/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/frederico-kluser/huu/releases/tag/v0.3.1
[0.3.0]: https://github.com/frederico-kluser/huu/releases/tag/v0.3.0
