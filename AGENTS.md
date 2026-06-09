# huu

A TypeScript/React (Ink) CLI TUI that runs LLM-agent pipelines in isolated git worktrees. Each stage decomposes into parallel tasks, deterministically merged into a central worktree at the end of every stage.

## Build & Run

```bash
# Install dependencies
npm install

# Run in dev (hot reload)
npm run dev

# Run directly (no build)
npm start

# Compile for production
npm run build

# Run tests
npm test

# Type-check only
npm run typecheck
```

## Agent Skills

Detailed domain-specific guidance lives in `.agents/skills/`:

| Skill | Domain |
|---|---|
| `architecture-conventions` | Layered architecture, naming, imports, dependency rules |
| `git-workflow-orchestration` | Worktree lifecycle, branch naming, merge, conflict resolution |
| `pipeline-agents` | Pipeline creation, task decomposition, AgentFactory usage |
| `port-isolation` | Per-agent port allocation, bind() shim (LD_PRELOAD/DYLD), `.env.huu`, native compile |
| `ui-tui-ink` | Ink (React for terminals) component patterns, screen routing |
| `web-ui-react` | Browser front-end for `huu --web` (Vite + React + Tailwind, Atomic Design) |
| `build-dev-tools` | Build, dev, test commands and tooling config |
| `llm-integration` | OpenRouter model selection, Pi SDK, thinking detection |
| `docker-runtime` | Host wrapper, signal lifecycle, image variants, HEALTHCHECK |

Consult the relevant skill before starting any task.

### Web UI mode (`huu --web`)

Alternate entry point that swaps Ink (TUI) for a browser front-end while reusing 100% of the back-end (Orchestrator, FSM, handlers).

- `src/web/` — back-end (HTTP+WS server, session, handlers, orchestrator-bridge). Cannot import from `ui/`.
- `src/lib/screen-fsm.ts` — pure FSM shared by both TUI and web session.
- `webui/` — front-end workspace (Vite + React + TS + Tailwind). Build output → `src/web/dist-static/`.
- Protocol: `src/web/ws-protocol.ts` (Node-free types; imported via `@shared` path alias from `webui/`).
- Phase-1 constraint: `--web` requires `--yolo` (Docker port-publishing not yet implemented).

## Architecture (summary)

```
[host]   cli.tsx top-level → decideReexec → reexecInDocker
                ↓ (when not in container, not --help, not init-docker/status)
         docker run --cidfile … ghcr.io/…/huu:latest
                ↓
[container]  cli.tsx → app.tsx (entry + screen router)
                ↓
              ui/components/ (Ink React views)
                ↓
              orchestrator/ (worker pool, stage lifecycle, merge)
                ↓
              orchestrator/backends/ (pluggable agent SDKs:
                pi/      — @mariozechner/pi-coding-agent (default, OpenRouter)
                copilot/ — @github/copilot-sdk (GitHub subscription)
                stub/    — no-LLM mock for smoke tests
                registry.ts — single dispatch from kind → factory)
                ↓
              git/ (worktree manager, branch ops, preflight, merge)
                ↓
              lib/ (types, pipeline-io, file-scanner, run-id, status,
                    init-docker, docker-reexec, active-run-sentinel,
                    api-key, prune, debug-logger, run-logger,
                    screen-fsm, assistant-check-feasibility)
                ↓ (web mode only — alternate front-end, not above ui/)
              web/ (HTTP+WS server, session, handlers, orchestrator-bridge,
                    ws-protocol; consumed by `webui/` Vite build)
```

Dependencies flow **downward only** — lower layers never import upper layers.

### Visual conventions

- Color tokens are centralized in `src/ui/theme.ts`.
- `theme.ai` (magenta) is reserved for AI-driven UI: Smart Select on the file picker, Pipeline Assistant, Project Recon, agent logs.
- Non-AI components must not introduce magenta. Use `theme.info` (blue) or `cyanBright` for purple-ish needs.
- See README "Visual conventions" for the user-facing summary.

The Docker host wrapper (`lib/docker-reexec.ts`) is invoked from the very top
of `cli.tsx` BEFORE the heavy Ink/React imports, so on the wrapper path none
of the TUI code loads. Inside the container, `HUU_IN_CONTAINER=1` (set by
the Dockerfile) short-circuits the gate so the same binary runs the TUI
directly. See the `docker-runtime` skill for the full lifecycle.

## Bundled default pipelines

`pipeline-bootstrap.ts` materializes a small catalog of framework-agnostic
default pipelines into `pipelines/` on first run. Each one is idempotent
(it never overwrites an existing file). Source of truth lives in
`src/lib/default-pipelines/<name>.ts` and is registered in
`src/lib/default-pipelines/registry.ts`.

| Pipeline | What it does | Methodology |
|---|---|---|
| `huu Test Suite` (`_default`) | Stack detection → test runner setup → unit tests for 3 representative files + user-selected files → prune failing blocks → add coverage badge to README. | Unit-test fundamentals |
| `huu Agent Knowledge` | Recon → per-file deep study converging into `.huu/knowledge/` (atlas + findings) → topic synthesis → materializes Agent Skills under `.agents/skills/` (one per topic + a `project-knowledge` router skill) → judge validates frontmatter/naming/router coverage, looping back on `rework`. Setup pipeline — mutates the repo. | [Agent Skills spec](https://agentskills.io/specification) + progressive knowledge |
| `huu Docs Audit` | Inventories every doc, classifies by Diátaxis quadrant, scores the README, flags stale references, measures inline API-doc coverage. Report-only. | [Diátaxis](https://diataxis.fr/) + Awesome-README |
| `huu Quality Audit` | Sonar-style report: cyclomatic / cognitive complexity, function/file size, parameter count, nesting depth, duplication, dead code, composite score. Report-only. | [SonarSource](https://www.sonarsource.com/resources/library/cyclomatic-complexity/) + Fowler smells |
| `huu Performance Audit` | Static hotspot scan (N+1, big-O, sync I/O, memory leak signals), Core Web Vitals scorecard for frontends, USE-method checklist for backends/CLIs. Report-only. | [USE method](https://www.brendangregg.com/usemethod.html) + [Core Web Vitals](https://web.dev/articles/vitals) |
| `huu Refactor Plan` | Characterization-test baseline → per-file smell catalog → top-5 target ranking → STATIC Mikado-style graph per target → final Fowler recommendations. Report-only. | [Fowler refactoring catalog](https://refactoring.com/catalog/) + [Mikado method](https://www.manning.com/books/the-mikado-method) |
| `huu Security Audit` | Secrets sweep (gitleaks), OWASP Top 10:2021 per-file scan (semgrep when available), dependency CVE scan, remediation roadmap. Report-only. | [OWASP Top 10](https://owasp.org/Top10/2021/) + [CWE Top 25 (2024)](https://cwe.mitre.org/top25/archive/2024/2024_cwe_top25.html) |

Only `huu Test Suite` carries `_default: true` — it's the entry the Welcome
screen highlights. The other six are surfaced in the pipeline picker but
are not flagged as "the default".

### Side-effect surface

The five audits are **report-only**: they write ONLY to
`.huu/audits/<topic>.md` and `.huu/audits/<topic>-faq.json` (working
files under `.huu/audits/.tmp/`), plus at most ONE `.gitignore`
adjustment (rewriting a committed `.huu/` line to `.huu/*` +
`!.huu/audits/` so the reports survive the stage merge — without it,
worktree commits silently drop everything under an ignored `.huu/`).
They never touch `README.md`, `package.json`, `requirements.txt`,
`pyproject.toml`, `Cargo.toml`, `go.mod`, lockfiles, or any production
source. Auxiliary tooling (gitleaks, semgrep, jscpd, lighthouse-ci,
depcheck, vulture, …) is invoked ephemerally via `npx --yes`,
`pipx run`, or vendored binaries under `$HOME/.huu/bin/` — never added
to your project's manifests.

Two pipelines mutate production state by design (setup pipelines, not
audits): `huu Test Suite` (writes `huu-tests.md` to repo root + inserts
a tests-coverage badge in `README.md`) and `huu Agent Knowledge`
(writes `.agents/skills/**` + `.huu/knowledge/**`, same single
`.gitignore` adjustment rule with `!.huu/knowledge/`).

Per-file steps are bounded by `Pipeline.maxNodeExecutions = 50`. Each
per-file prompt opens with an auto-skip rule for `node_modules/`,
`dist/`, `build/`, `vendor/`, `*.generated.*`, `*.d.ts`, lock/snapshot
files, etc.

## Commit Rules

- Run `npm run typecheck && npm test` before every commit. **There is no
  automated CI** — convention is the contributor's responsibility. To
  harden it locally, enable the pre-push hook: `git config core.hooksPath .githooks`.
- Prefer Conventional Commits.
- Never force-push to main.

## Release procedure (manual — no CI)

To cut release v`X.Y.Z` (semver; in 0.x.x, breaking changes go into minor
bumps by convention):

1. Update `package.json` `version` and `CHANGELOG.md` (move entries
   from `[Unreleased]` into `[X.Y.Z] - YYYY-MM-DD`, following
   [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)).

2. Validate locally:
   ```bash
   npm run typecheck
   npm test
   docker build -t huu:local .
   ./scripts/smoke-image.sh
   ./scripts/smoke-pipeline.sh
   ```

3. Tag + commit:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. **Optional** — publish the image to GHCR. Prerequisite: `docker login
   ghcr.io` with a Personal Access Token having the `write:packages` scope.

   ```bash
   # Make sure buildx + QEMU are set up (once per machine):
   docker buildx create --use --name huu-builder 2>/dev/null \
       || docker buildx use huu-builder

   # Multi-arch build + push straight to GHCR
   docker buildx build \
       --platform linux/amd64,linux/arm64 \
       --tag ghcr.io/frederico-kluser/huu:X.Y.Z \
       --tag ghcr.io/frederico-kluser/huu:X.Y \
       --tag ghcr.io/frederico-kluser/huu:X \
       --tag ghcr.io/frederico-kluser/huu:latest \
       --push \
       .
   ```

5. Smoke against the published image:
   ```bash
   ./scripts/smoke-image.sh ghcr.io/frederico-kluser/huu:X.Y.Z
   ./scripts/smoke-pipeline.sh ghcr.io/frederico-kluser/huu:X.Y.Z
   ```

If step 4 is skipped, users need to build locally with
`docker build -t huu:local .` (the default path documented in the README).

## Smoke tests

Without automated CI, it is the maintainer's / contributor's
responsibility to run the local smoke suite before every release or
non-trivial PR:

```bash
docker build -t huu:local .
./scripts/smoke-image.sh        # ~10s — image sanity
./scripts/smoke-pipeline.sh     # ~60s — end-to-end pipeline with --stub
./scripts/smoke-web.sh          # ~5s — sanity for `huu --web` mode (port bind)
```

All exit 0 on success and !=0 on failure — chainable with `&&`.

### Conditional pipeline steps (v2)

Pipelines can include `CheckStep` (decision nodes): a judge agent with
shell access running in the integration worktree emits a verdict JSON
and the cursor jumps to `outcomes[].nextStepName`. The integration
worktree never rewinds — loops re-execute on top of the current HEAD,
accumulating commits. Schema: `huu-pipeline-v2` (v1 still accepted,
`type` is optional on work steps). Safeguards:
`Pipeline.maxNodeExecutions` (default 50), `CheckStep.maxRuns`
(default 5), and the `default: true` outcome (exactly one per check)
fires on judge failure / unknown label / cap. See
`.agents/skills/pipeline-agents/SKILL.md` and
`docs/pipeline-json-guide.md` (`#conditional-steps-check-nodes`).

## References (load on demand)
- Skill catalog: `agent-skills.md`
