# Changelog

All notable changes to `huu` are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
SemVer 0.x.x convention: breaking changes go in minor-version bumps.

## [Unreleased]

### Fixed

- Final pass of Portuguese strings the v1.0.1 "English everywhere" commit missed: welcome menu entries (`Assistente de pipeline`, `FAQ — perguntas frequentes`), every Pipeline Assistant stage (`pensando…`, `cancelar`, `enviar`, status line, free-text prompt, error screen), Project Recon header / spinner / progress / error (`Análise do projeto`, `Selecionando o que investigar`, `Falha no seletor`, `processos em paralelo`, `concluídos`), the Pipeline Editor per-card-timeout copy, Model Selector subtitle and legend, model catalog descriptions, Pi backend "model not found" error, and the `agent-env.ts` port-allocation prompt fed into agents.
- `example.pipeline.json` and `example.conditional.pipeline.json` translated to English so the on-disk samples match the README and `npm install -g huu-pipe` quick-start renders consistently.
- README touch-ups: Node badge bumped 18 → 20 (matches `engines.node`), `HUU_IMAGE` pin example bumped to `1.0.2`, embedded `example.pipeline.json` snippet retranslated to English.

## [1.0.2] - 2026-05-21

### Fixed

- Unblock `npm run build` by fixing the webui workspace's strict TypeScript pass: `domain-types.PromptStep` is now narrowed to the work-step shape (via `Extract<…, { prompt: string }>`) so `StepRow` / `StepEditor` keep accessing `prompt` and `files` type-safely. `PipelineCard` narrows `'files' in step` before summing, and `PipelineEditorPage` splits/recomposes work-vs-check steps at the boundary (check steps round-trip untouched on save). Drops the unused `CheckOutcome` import in `src/lib/pipeline-io.ts`.
- `Dockerfile` builder stage now copies the `webui/` workspace (`webui/package.json` before `npm ci`, full `webui/` tree before `npm run build`). Previously the workspace was added at the repo root but the Dockerfile only copied `src/`, so `docker build` errored with `npm error No workspaces found: --workspace=webui` once the build script started invoking `npm run build -w webui`.

### Added

- `webui/src/pages/FaqPage.tsx` + Router case for `screen.kind === 'faq'` — the FSM exposed an FAQ kind with no web-side counterpart, breaking the exhaustiveness check. The new page mirrors the TUI FAQ content and dispatches `faq.back` to return to the welcome screen.

## [1.0.1] - 2026-05-21

### Added

- **Five new bundled default pipelines** materialized by `pipeline-bootstrap` on first run, all framework-agnostic and report-only:
  - `huu Docs Audit` — Diátaxis classification + README quality scorecard + staleness scan + API-doc coverage.
  - `huu Quality Audit` — SonarSource-style cyclomatic / cognitive complexity, function/file size, parameter count, nesting depth, duplication (jscpd) and dead-code (depcheck / vulture / staticcheck).
  - `huu Performance Audit` — static N+1 / big-O / sync-I/O / memory hotspot scan plus Core Web Vitals (Lighthouse-CI) for frontends and Brendan Gregg's USE checklist for backends/CLIs.
  - `huu Refactor Plan` — Fowler smell catalog + Mikado-graph plan per target + Strangler-Fig hint, no code changes.
  - `huu Security Audit` — OWASP Top 10:2021 per-file scan (semgrep when available), gitleaks secret sweep, dependency CVE scan (npm audit / pip-audit / cargo audit / govulncheck / osv-scanner), CWE Top 25:2024-aligned remediation roadmap.
- `src/lib/default-pipelines/registry.ts` — single source of truth for the bundled catalog, consumed by `ensureAllDefaultPipelines()` in `pipeline-bootstrap`.
- `src/app.tsx` mount-time `useEffect` calls `ensureAllDefaultPipelines(repoRoot)` so the catalog actually materializes for end users (the bootstrap was previously dead code: callable from tests only).
- `scripts/smoke-defaults.sh` — verifies all 6 bundled defaults materialize, parse cleanly, and are idempotent on re-run. Run after `npx tsc` (or full `npm run build`).
- Registry-iterating test guards in `src/lib/pipeline-bootstrap.test.ts`: JSON-vs-TS drift (modulo `exportedAt`), exactly-one-default per CheckStep, no `$file` token in project-scope step prompts.
- Bundled-pipelines section in `README.md` and `docs/pipeline-json-guide.md` describing the strict report-only contract and the fan-out cap.
- Per-file step prompts in all 5 audit pipelines now carry an explicit SCOPE NOTE + SKIP RULE (skip `node_modules/`, `dist/`, `build/`, `vendor/`, `*.generated.*`, `*.d.ts`, lock/snapshot files, etc.) so users don't blow through `Pipeline.maxNodeExecutions` on generated trees.
- `PARALLEL_RULE_SHORT` exported from `src/lib/assistant-prompts.ts` and reused by the test, replacing a brittle inline regex.

### Changed

- **English everywhere.** The entire app now communicates in English: bundled pipeline prompts, the Pipeline Assistant interview prompt, the project-recon catalog and selector, file-suggestion prompt, FAQ screen, error messages, project-digest banners, assistant stubs (`assistant-client.ts`, `assistant-check-feasibility.ts`, `assistant-schema.ts`), and the root `AGENTS.md` (a.k.a. `CLAUDE.md` symlink). Old example pipelines `demo-rapida.pipeline.json` and `testes-seguranca.pipeline.json` renamed to `demo-quick.pipeline.json` and `security-tests.pipeline.json` with translated bodies.
- **Audit pipelines are now strict report-only.** They write exclusively to `.huu/audits/<topic>.md` and `.huu/audits/<topic>-faq.json` (working files under `.huu/audits/.tmp/`). They no longer mutate `README.md` (badges removed), `package.json`, lockfiles, or any production source. Tool installs are ephemeral only — `npx --yes`, `pipx run`, or vendored binaries under `$HOME/.huu/bin/`. Only `huu Test Suite` still touches production state (writes `huu-tests.md` + a tests badge — by design, it is a setup pipeline).
- `huu Refactor Plan` step 4 renamed and re-framed: it produces a STATIC Mikado-style dependency graph (we can't try-and-revert in report-only mode), and the report now states this honestly instead of implying empirical Mikado.
- `ensureDefaultPipeline` retained as a back-compat thin wrapper; new entry point is `ensureAllDefaultPipelines` which iterates the catalog and is idempotent per default.

### Removed

- `huu Test Suite` CheckStep "3.5 All tests green?" — the gate looped `failing → step 2` ("Test 3 representative files"), but failures actually surface from step 3 (per-file). The gate added LLM-judge cost without addressing the root cause; step 4's existing 3-iteration delete-failing-blocks logic is the correct circuit-breaker.
- `huu Security Audit` CheckStep "4.5 Critical findings present?" — both outcomes pointed to step 5, making it a no-op LLM call.

## [1.0.0] - 2026-05-20

### Added

- `huu --web` — alternate browser UI that mirrors the TUI 1:1 with a click-driven layout (Atomic Design + Tailwind). Real-time updates via WebSocket. Bind: 127.0.0.1 + UUID token. Companion flags: `--web-port=<n>`, `--no-open`, env `HUU_WEB_NO_OPEN=1`. Phase 1 requires `--yolo` (Docker port-publishing pending).
- `src/lib/screen-fsm.ts` — pure FSM extracted from `src/app.tsx`; consumed by both the Ink TUI and the new web session.
- `webui/` workspace — Vite + React + TypeScript + Tailwind front-end (Atomic Design: 11 atoms, 10 molecules, 9 organisms, 3 templates, 15 pages).
- `scripts/smoke-web.sh` — fast-port smoke test for the web mode.
- **Conditional pipeline steps with LLM-judged routing.** Pipelines
  can now include `CheckStep` nodes — decision points whose verdict is
  produced by an LLM judge agent with full shell access running in the
  integration worktree. Checks evaluate a natural-language `condition`
  (with `$runs` token substitution for iteration counting) and route to
  one of their declared `outcomes`, enabling forward jumps, loops back
  to earlier steps, and branching. **The integration worktree is never
  rewound** — loops re-execute the target step on top of the current
  HEAD, accumulating commits. Schema bumped to `huu-pipeline-v2`
  (v1 still accepted; the `type` field is optional on work steps for
  back-compat). New safety nets: `Pipeline.maxNodeExecutions` (default
  50) caps total node visits per run; `CheckStep.maxRuns` (default 5)
  caps per-check revisits; the `default: true` outcome (exactly one
  required) fires on judge failure / unknown label / cap overflow.
  New files: `src/orchestrator/check-evaluator.ts` (judge spawner,
  reserved agentId 9998), `src/lib/assistant-check-feasibility.ts`
  (setup-time LangChain feasibility analysis producing an
  `instructionDraft`), `src/ui/components/CheckStepEditor.tsx` (TUI
  subform with embedded `OutcomesEditor`, `theme.ai` magenta).
  PipelineEditor gains the `C` shortcut for new check steps.
  Schema (`pipeline-io.ts`) gains topology validation: unique names,
  reference validity, default-outcome presence. Orchestrator's linear
  stage loop replaced with a graph cursor state machine; `RunManifest`
  gains `executionTrace`. Full reference in
  [`docs/pipeline-json-guide.md`](docs/pipeline-json-guide.md#conditional-steps-check-nodes);
  example: [`example.conditional.pipeline.json`](example.conditional.pipeline.json).

### Internal

- Extracted `StateCoalescer` (`src/web/orchestrator-bridge.ts`) — reusable 8 Hz state coalescer for the WS broadcast path.
- `Screen['model-selector']` now carries `backendKind`, replacing the front-end's hardcoded `'pi'` assumption in `ModelSelectorPage`.

### Added (Docker / persistence)

- **Saved pipelines now survive `docker run --rm`.** The wrapper
  (`src/lib/docker-reexec.ts`) bind-mounts the host's `~/.huu` (and
  `~/Downloads` when present) into the container at the same absolute
  path, and forwards `HUU_HOST_HOME` so the in-container code resolves
  pipeline memory, global pipelines, model recents, and the default
  export Downloads target to the host filesystem. Before this, every
  "Save pipeline" inside Docker wrote to the container's ephemeral
  `$HOME` and was lost on exit; the saved-pipelines list reopened empty.
  A new helper `src/lib/huu-home.ts::getHuuHome()` reads `HUU_HOST_HOME`
  and falls back to `homedir()` for native runs (`--yolo`,
  `HUU_NO_DOCKER`, native-only subcommands) — no behavior change there.
  `compose.yaml` and the `huu init-docker` scaffold templates
  (`compose.huu.yaml`, `scripts/huu-docker`) mirror the new mount + env
  so all entry points are consistent.

### Fixed

- **Agent execution and observability hardening.** Surgical fixes across the
  orchestrator, backends, git layer, and logging stack to close gaps that
  silently corrupted state or hid failures from operators:
  - `Orchestrator.abort()` now tracks each `agent.dispose()` promise and
    `start()`'s `finally` block awaits all in-flight `dispose`/`finalize`
    work with a 5s grace period before resolving — previously the
    `void agent.dispose()` fire-and-forget let the run "complete" while
    subprocess teardown raced with the next run's worktree creation.
  - `finalizeAgent` is now wrapped in a tracked promise with a `.catch`
    that surfaces unhandled errors instead of yielding a silent process-1
    exit. `dlog` calls now bracket `git.hasChanges`, `commit`, and
    worktree removal so post-mortem can tell where finalize broke.
  - Integration worktree teardown moved into `start()`'s `finally` block,
    eliminating the orphan worktree+branch that previously leaked when
    a stage threw mid-run.
  - `WorktreeManager.createIntegrationWorktree` / `createAgentWorktree`
    now roll back the orphan branch when `git worktree add` fails. Without
    this, a retried run hit "branch already exists" forever.
  - `GitClient.merge()` returns an explicit `error` field carrying the
    underlying git stderr — previously a failed conflict-probe was
    smuggled into `conflicts[]`, where callers treated the error string
    as a file path and tried to spawn an LLM resolver against it.
  - `mergeAgentBranches` emits per-branch `dlog` entries (`merge.attempt`,
    `merge.ok`, `merge.conflict`, `merge.stage_end`) so "which branch
    introduced the conflict?" is answerable post-run.
  - `lib/openrouter.ts` capability cache is now keyed by API key. The
    previous global cache silently served keyA's view of the model
    catalog to keyB on multi-tenant / BYOK swaps.
  - `lib/active-run-sentinel.ts` records the writer PID alongside the
    cwd; new `probeActiveRunLiveness()` answers "is that PID still
    alive?" so stale sentinels (process killed before exit handler ran)
    can be detected. Format is forward-compatible with the legacy
    single-line cwd reader the HEALTHCHECK shell uses.
  - `lib/debug-logger.ts` now redacts API-key-shaped substrings
    (`sk-or-`, `sk-ant-`, `ghp_`, Bearer headers) before any structured
    field reaches disk. `lib/run-logger.ts` applies the same redaction
    when rendering the chronological + per-agent log files.
  - `LogEntry` gained `runId`, `stageIndex`, `stageName`, `kind`
    (`'orchestrator' | 'integrator' | 'worker' | 'system'`). Every
    orchestrator-emitted log line is enriched with current run/stage
    context — log aggregation can finally pivot across runs.
  - New `usage` AgentEvent variant carries structured token / cost
    telemetry. Both pi and copilot mappers emit it alongside the
    human-readable log line; the orchestrator accumulates it into
    `AgentStatus.tokensIn/Out/cacheRead/cacheWrite/cost`. Per-agent
    token reporting in the run log is no longer always zero.
  - `safe-terminal.ts` now emits a structured `signal.safe_exit` /
    `error.safe_uncaught` debug event with a process snapshot
    (active handles, RSS, uptime) before exit. Diagnosing "what was
    huu doing when SIGINT hit?" no longer requires guessing.

- **Running `huu` from inside a git worktree (or a subdirectory of a repo) no
  longer fails with "not a git repository" after the Docker pull.** The wrapper
  now runs a host-side git preflight (`lib/git-preflight.ts`) BEFORE re-execing
  into the container, so a missing repo fails fast without a wasted image pull.
  When the preflight detects that `--git-common-dir` (worktree case) or
  `--show-toplevel` (subdirectory case) live outside cwd, those paths are added
  as additional same-path bind mounts so the worktree's `.git` file resolves
  identically inside the container. The in-container `ensureGitRepoOrExit`
  remains as a defensive backup for `--yolo`/native runs.

### Added

- **Recommended model catalog refreshed + Artificial Analysis enrichment in the picker.**
  - Removed `deepseek/deepseek-v3.2`. Added `deepseek/deepseek-v4-pro`,
    `deepseek/deepseek-v4-flash`, and `xiaomi/mimo-v2.5-pro`. Existing
    entries (`minimax/minimax-m2.7`, `moonshotai/kimi-k2.6`, `z-ai/glm-5.1`,
    `google/gemini-3.1-pro-preview`, `openai/gpt-5.4-mini`, `openai/gpt-5.4`)
    were retained.
  - Each catalog entry now carries `description`, `bestFor` (use-case tags:
    `coding` / `reasoning` / `agentic` / `fast` / `cheap` / `general`), and
    `tier` (`flagship` / `workhorse` / `fast`). The fields are optional on
    the schema for retrocompatibility but populated for every recommended
    entry.
  - The quick model picker renders a fixed-width table — `Model · tok/s ·
    Agnt · Code · Razn · $in/$out · BestFor` — with metrics pulled from
    Artificial Analysis when `ARTIFICIAL_ANALYSIS_API_KEY` is set. Without a
    key the columns degrade to `—` placeholders without blocking selection.
    "More models..." also forwards the AA key so both views share the data
    source.
  - The pipeline-assistant prompt now lists each model's description and
    bestFor tags inline, plus a "modelo recomendado por cenário" matrix so
    the assistant picks `modelId` per step against the scenario rather than
    a flat preference list.
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
