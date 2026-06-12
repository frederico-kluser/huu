# Changelog

All notable changes to `huu` are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
SemVer 0.x.x convention: breaking changes go in minor-version bumps.

## [Unreleased]

### Added

- **`scope: "memory"` — file fan-out decided by an EARLIER step.** Third file-selection mode beyond whole-project and user-picked: a producer step writes a `huu-memory-v1` JSON (`{"_format":"huu-memory-v1","files":[{"path","hint?","priority?"}]}`) and the consuming step declares `filesFrom`; at stage start huu reads it from the integration worktree (check-loop rewrites are picked up) and spawns one agent per listed path, injecting each entry's `hint` via the new `$hint` prompt token. Deterministic failure split: missing memory file → zero tasks, stage completes empty with a loud warning (stub-safe); corrupt file → run fails. `maxFiles` (default 40) caps width; entries run priority-desc then list order; `config.files` overrides win in headless runs. Surfaces: schema + topology validation (filesFrom required, never the first step), TUI StepEditor (`M` shortcut, filesFrom input replaces the picker), Web UI step editor (new Scope select + filesFrom input — scope wasn't editable on the web at all before), Pipeline Assistant can emit the mode, dedicated guide `docs/memory-scope.md` (+ pt-BR) and a `docs/pipeline-json-guide.md` section. Note: `maxNodeExecutions` counts cursor VISITS — a fan-out of N files is ONE visit (docs corrected).
- **Memory-aware dynamic concurrency is now the DEFAULT.** The orchestrator always runs the `AutoScaler`: in `auto` mode (default) the worker-pool target is computed from real memory headroom — `ramAvailableBytes` (new in `SystemMetrics`: cgroup `limit − current`, `/proc/meminfo MemAvailable` on Linux hosts, `os.freemem()` fallback) minus a 10%/512 MiB safety margin, divided by an EMA-observed per-agent footprint (seeded 250 MiB, clamped 128 MiB–2 GiB) — replacing the old fixed total-RAM/250 MB estimate. New flags: `--concurrency=N` (pins manual mode at N) and `--no-auto-scale`; headless configs gain `autoScale?: boolean` with back-compat derivation (a config that sets `concurrency` keeps exact manual behavior). New web message `run.setAutoScale`; `run.setConcurrency` now pins manual (parity with the TUI `+`/`-` keys). Headless NDJSON state events now include `concurrency` and `autoScale` mode.
- **Always-on memory guard with kill→TODO requeue.** In BOTH modes, at ≥95% RAM/CPU the orchestrator kills the NEWEST agent (least work done — picked by `startedAt`), resets its kanban card to `pending` with a `requeues` counter (TODO column, `↻N` badge in the TUI, `requeued ×N` badge in the web UI) and requeues the task at the front of the queue — older agents' finished work is never lost. TUI header shows `~MB/agent` + free MB in auto mode and a `GUARD` chip (+ kill count) in manual mode.
- **CheckStep judges are now kanban cards** (TUI + web). New `CheckRun` slice (`OrchestratorState.checkRuns`, persisted to `manifest.checkRuns`): one entry per check visit with phase `judging → done/error`, the chosen outcome label, `fromJudge` flag (yellow `DEFAULT:` badge when the fallback fired), judge model, resolved condition, reason and live last-log. The maxRuns-exceeded forced default is its own DONE card instead of an invisible skip. TUI: `judge:` cards in `RunKanban` (`theme.ai` while judging); web: new `CheckRunPill` molecule.
- **`--no-docker`** — neutral CI spelling of `--yolo` (accepted everywhere `--yolo` is: re-exec gate, `--web` gate, credentials warning).
- **`docs/ci.md` + `docs/ci.pt-BR.md`** — running huu in CI without Docker: GitHub Actions and GitLab CI recipes for `huu auto` (npm install, secrets, `fetch-depth: 0` for history-scanning audits, `.huu/audits/**` artifacts, exit-code gating, dynamic per-file config via `git ls-files`, concurrency guidance for small runners). Linked from the READMEs and `docs/README.md`.
- **Judge gate on the five report-only audits.** Docs/Quality/Performance/Refactor/Security now END with a `N. Validate report` CheckStep (shared `reportJudgeCondition()` helper in `knowledge-protocol.ts`: sections complete, summary counts match the FAQ, ordering correct, report-only contract held) looping `rework` back to consolidation (maxRuns 2, `approved` is the default outcome) plus a terminal `Finalize report` stamp step. New `registry.test.ts` guards the contract (schema round-trip incl. topology, judge shape, REPORT-ONLY marker, caps).

### Changed

- **`huu Agent Knowledge` replaced by `huu Knowledge System`** — the knowledge pipeline became the most ambitious bundled default: it builds the FULL knowledge-skills system on a shared `.huu/knowledge/` blackboard (atlas → parallel per-file findings → ONE synthesis step that also writes the routing ground truth BEFORE any skill exists → per-topic dossiers → skills materialized by template transformation in judge-bounded batches of ≤3 → meta-skills + LEARNINGS + router-aware routing surface → blind routing eval with a description-sharpening rework loop). Engineered for quality on SMALL models: one cognitive operation per step, mechanical judge conditions, stub-safe forward defaults, verbatim-copy scaffolding. Bootstrap never overwrites: an existing `pipelines/huu-agent-knowledge.pipeline.json` keeps working on the old design — delete it if unwanted; the new `huu-knowledge-system.pipeline.json` materializes on next start.
- **All 7 default pipelines redesigned on cited, current methodology** (delete `pipelines/<name>.pipeline.json` to re-materialize — bootstrap never overwrites):
  - *Security Audit*: OWASP Top 10 **2021 → 2025** (new A03 Software Supply Chain Failures and A10 Mishandling of Exceptional Conditions; SSRF folded into A01), CWE Top 25 **2025**, NEW step "Supply chain & CI posture" (SLSA v1.2 / OpenSSF Scorecard informed: lockfile + SHA pinning, `pull_request_target` pwn-request detection, workflow `permissions:`, `curl | bash`, binary artifacts), gitleaks v8.19+ `git`/`dir` subcommands, `semgrep scan`, osv-scanner v2 `scan source`, path-traversal patterns.
  - *Quality Audit*: NEW step "Hotspot analysis (churn × complexity)" (Tornhill/CodeScene git-log mining), cognitive-complexity scoring rules + thresholds (Sonar S3776 = 15) alongside cyclomatic, hotspot-weighted refactor-first ranking.
  - *Performance Audit*: explicit INP lab caveat (Lighthouse can't measure INP — TBT is the lab proxy; field/CrUX required), p75 framing, unbounded-concurrency and missing-caching/extraneous-fetching patterns.
  - *Docs Audit*: classification via the Diátaxis compass; README rubric grounded in standard-readme required sections + assessment-badge evidence (ICSE 2018).
  - *Refactor Plan*: top-5 target ranking is now smell-weight × churn; characterization-test rationale (Feathers) spelled out.
  - *Test Suite*: assertion-quality rules that survive mutation testing (behavior not implementation, no change-detector/snapshot-only tests), determinism ruleset (no sleeps/network, frozen clocks, fixed seeds, hermetic tests), optional Stryker/mutmut/PIT follow-up documented in `huu-tests.md`.
  - *Agent Knowledge*: agentskills.io spec details (optional frontmatter fields, 3-level progressive disclosure, scripts-over-prose guidance).
- TUI `+`/`-` keys and web `run.setConcurrency` now PIN manual mode (auto-scale re-enabled with `A` / the web toggle). `--auto-scale` is deprecated (now the default; still accepted — with `--concurrency` it forces auto mode with that seed).
- `AutoScaleStatus` gains `mode`, `observedAgentMemoryMb`, `ramAvailableMb`, `guardKillCount`; `OrchestratorState.autoScale` is now always present.
- Positioning across READMEs, MANIFESTO, docs and package description: huu designs pipelines that make thinking agents follow a deterministic process — audits, test generation, knowledge extraction and predictable-value processes; NOT a tool for building new features.

### Deprecated

- `--auto-scale` flag (auto-scale is now the default), `AgentStatus.killedByAutoScaler`, lifecycle phase `killed_by_autoscaler` (kept so old manifests still parse; no longer produced).

### Fixed

- **macOS: the orchestrator could never spawn agents on a warmed-up host.** The resource monitor's host fallback used `os.freemem()`, which on macOS counts only truly-free pages (file cache excluded) — on any Mac in normal use that saturates `ramPercent` ≥95%, permanently gating `AutoScaler.shouldSpawn()` (runs sat forever with every card pending and $0 spent) and spuriously arming the memory guard. The darwin path now derives available memory from `vm_stat` reclaimable pages (free + inactive + purgeable + speculative — the macOS analogue of Linux's `MemAvailable`), cached 500ms, with `os.freemem()` as last resort. Also un-hung the orchestrator integration suite on macOS (16 chronic test timeouts → green, 42s → 6s).
- Guard-killed agents no longer park as `killed_by_autoscaler` errors in the DONE column — the card visibly returns to TODO with its requeue counter.
- Stale `killedByAutoScaler` status flag could swallow a requeued task's later genuine failure (silent drop — never retried, never counted, never marked error). Replaced by a consumable kill-marker set; regression-tested in `requeue.test.ts`.
- Auto-scaler active-agent accounting no longer inflates on retry/final-fail (it skewed the observed per-agent memory estimate).
- `npm run build && npm test` no longer runs the compiled `dist/**/*.test.js` twins in parallel with `src/` (vitest 4 dropped the dist exclude; the duplicated native-shim tests raced each other on port 3000). New `vitest.config.ts`.

## [1.3.0] - 2026-06-10

### Added

- **`Pipeline.integrationModelId`** — pipeline-level model override for the merge/integration agent (the conflict resolver that runs between stages). Falls back to the run's global model. Editable in the TUI pipeline editor (`T` → "Integration agent model", backed by the model selector) and in the web pipeline editor; documented in `docs/pipeline-json-guide.md`.
- **Merge cards on the kanban** — every stage visit now creates a `StageIntegration` entry (`OrchestratorState.stageIntegrations`, persisted to `manifest.stageIntegrations`) that both dashboards render as a display-only card flowing TODO → DOING → DONE (`pending → merging → conflict_resolving → done/error/skipped`), with live last-log, branches/conflicts counts, elapsed time and the effective integration model. The UI no longer looks frozen during `status: integrating`. TUI: `RunKanban`; web: new `IntegrationPill` molecule in `KanbanBoard`. The `conflict_resolving` state uses the AI color token (`theme.ai`); the deterministic merge stays cyan.
- **`huu Agent Knowledge` default pipeline** — studies the project progressively (recon → per-file deep study → topic synthesis, accumulating into `.huu/knowledge/atlas.md` + `findings.json`) and compiles the knowledge into Agent Skills under `.agents/skills/` following the [agentskills.io](https://agentskills.io/specification) spec: one skill per topic plus a `project-knowledge` router skill that any future agent loads first. A check step validates frontmatter/naming/router coverage and loops back to the materialize step on `rework` (max 3 runs; `approved` is the default outcome). Setup pipeline — mutates the repo by design.
- **`MANIFESTO.md` + `MANIFESTO.en.md`** — the project thesis ("deterministic in method, not in result", BSP over git), including an honest prior-art counterpoint section. Linked from both READMEs.

### Changed

- **Progressive knowledge protocol across the six bundled defaults** (new shared `src/lib/default-pipelines/knowledge-protocol.ts`): project-scope steps that previously acted blind now read the run's findings JSON before acting and append after (re-read + dedupe, append-only); findings gain optional `priority`/`fixability` fields that the final consolidation steps use to order recommendations; audit bootstraps gain a `.gitignore` persistence check (a committed `.huu/` line is rewritten to `.huu/*` + `!.huu/audits/` so reports survive the stage merge — previously they were silently dropped). Test Suite: step 2 records its 3 picks as a `category:"selection"` entry, step 3 builds on it instead of re-testing, step 4 closes the loop with a `category:"run-summary"` entry. Note: pipeline bootstrap is skip-if-exists, so already-materialized `pipelines/*.json` keep their old prompts — delete the file to re-materialize.
- `ensureGitignored()` now treats an existing `dir/*` line as satisfying `dir/`, so it no longer re-appends `.huu/` after a user adopts the negation pattern.

### Fixed

- `scripts/smoke-image.sh` / `scripts/smoke-pipeline.sh` now work on macOS with Docker Desktop/colima: the scratch repo moves from `mktemp -d` (which lands in `/var/folders/…`, outside the Docker VM's file sharing, so the bind mount arrived empty) to a `.smoke-tmp/` dir inside the huu repo itself (override with `HUU_SMOKE_TMPDIR`), and the path is normalized before being used as a `-v`/`-w` target (an unresolved `..` made git try to create the leading directories inside the container and fail with `Permission denied`).
- `scripts/smoke-pipeline.sh` drove `huu --stub run pipeline.json` expecting it to finish without keyboard input — but `huu run` is interactive by contract (it opens the pipeline editor and waits for `G`), so the smoke hung forever at the editor screen. It now drives the headless `huu auto pipeline.json --config config.json` path (stub backend) and asserts the final stdout JSON has `"ok": true` instead of the TUI-only `wait_until_exit_resolved` log event.
- **Guaranteed add/add merge conflict on `.env.huu` in fresh repos** — agent worktrees check out the *committed* `.gitignore`, so in any repo that hadn't committed the huu entries, every parallel agent committed its own `.env.huu`/`.huu-bin` (different ports → different content) and every stage merge conflicted (failing the run without a resolver, or burning an LLM call on a junk file with one). The orchestrator now writes these runtime-only paths to `.git/info/exclude` (shared by all worktrees, never touches tracked files). Found by exercising the new merge cards in a scratch repo.
- `scripts/smoke-dashboard.tsx` was broken since the backend registry refactor (imported the long-gone `orchestrator/stub-agent.js` and didn't pass `backend: 'stub'`, so the OpenRouter key probe 401-ed the run).
- `portAllocation` was silently stripped from pipelines on import/export round-trips (missing from the Zod schema).
- `huu Security Audit` step 5 told the agent to add a README badge while its own HARD RULES forbid it; `huu Quality Audit` step 1 allowed `package.json` devDeps additions against its own report-only rule; quality/performance step-5 names still said "+ badge". All report-only contracts are now consistent.

## [1.2.0] - 2026-05-21

### Added

- **`huu auto <pipeline.json> --config <config.json>`** — ONE-COMMAND headless pipeline run. Drives the same `Orchestrator` the TUI uses but without Ink: parses the pipeline + a small config JSON (`modelId`, `backend`, per-step `files` override, optional timeouts/retries/concurrency), resolves the API key via the existing `resolveApiKey` chain, runs `await orch.start()` and exits 0 / 1 based on `manifest.status`. NDJSON progress events stream to stderr (throttled ~250 ms); ONE final JSON object lands on stdout (`{ ok, runId, integrationBranch, status, totalCost, durationMs, filesModified, agents[] }`) so `huu auto … | jq .runId` works. Inherits the auto-MTU docker network from 1.1.0 — works in VPN out of the box. Unblocks CI/cron use cases, demos, and unattended overnight runs.
- `src/lib/run-config.ts` — zod-validated `RunConfig` schema + `loadRunConfig(path)` + `applyRunConfig(pipeline, config) → { pipeline, warnings }`. The `files` map matches step names; mismatched keys emit warnings instead of failing so typos are surfaced without blocking.
- `src/lib/headless-run.ts` — `runHeadless({ pipeline, config, cwd, agentFactory, conflictResolverFactory, concurrency, emitIntervalMs })`. Reusable from scripts and the new CLI subcommand.

### Verification

End-to-end smoke against `/home/ondokai/Projects/integracao-vael` with `huu Test Suite` pipeline + config injecting one file into step 3: real `minimax/minimax-m2.7` agent ran inside the auto-MTU docker network, committed `huu-tests.md` to the integration branch — deterministic success marker (per step 1's prompt: "always writes huu-tests.md at repo root").

### Added

- **Auto MTU-aware docker network** — the headline fix of this release. At wrapper start, `detectDefaultRouteMtu()` reads the MTU of the host's default-route interface (Linux only, parsing `ip route get 1.1.1.1` + `/sys/class/net/<iface>/mtu`); when it's below 1500 — typical of VPN tunnels (WireGuard 1420, Tailscale 1280, OpenVPN ~1500-overhead) — `ensureHuuDockerNetwork(mtu)` idempotently creates a docker bridge `huu-net-mtu<N>` with the matching MTU and pins the container to it via `--network=<name>`. No env var, no `/etc/docker/daemon.json` edit, no `--network=host` (which would break the port-isolation netns). Works whether the user is on a VPN or not — falls back cleanly to the default bridge when the route MTU is 1500 or detection isn't possible (macOS / Windows / Docker-Desktop VMs). The pre-1.1.0 behavior reproduced exactly the symptom in run `dtv2feyz`: 43 agents, all `tokens +0in +0out`, "Request timed out" on every retry — because the docker0 bridge (1500) was larger than a 1280-MTU VPN tunnel and silently dropped every TLS ClientHello. Post-fix on the same machine: pi agent against `minimax/minimax-m2.7` returns `+1786in +17out tokens` in 2.6 s.
- `HUU_DOCKER_NETWORK` env var, forwarded verbatim as `docker run --network=<value>`. Use case: explicit override of the auto-detection — force `host`, use a pre-existing user-managed network, or pin a name during testing. Auto-detection still runs when this is unset.
- Run-start network reachability probe (`checkOpenRouterReachable` in `src/lib/openrouter.ts`) that hits `/auth/key` with an 8 s `AbortController` before any agent spawns. Defense-in-depth backstop for exotic setups (outbound firewall, proxy misconfig) where MTU detection can't help. On `unreachable` inside a container, the error message includes copy-paste-friendly hints mentioning `HUU_DOCKER_NETWORK=host` and the `/etc/docker/daemon.json` MTU edit. Wired into `Orchestrator.start()`, gated on `config.backend === 'pi'` so stub / copilot runs aren't affected.

### Fixed

- Last pocket of Portuguese strings in error paths — `OpenRouter API key ausente. Defina OPENROUTER_API_KEY.` → `… missing. Set …`, `Model ID ausente.` → `Model ID missing.` (in both `pi/factory.ts` and `copilot/factory.ts`), and the project-recon "API key missing" log. The v1.1.0 release is now fully English in user-visible surfaces.
- Earlier in this cycle (folded in here): the v1.0.1 "English everywhere" pass had missed the welcome menu entries (`Assistente de pipeline`, `FAQ — perguntas frequentes`), every Pipeline Assistant stage (`pensando…`, `cancelar`, `enviar`, status line, free-text prompt, error screen), Project Recon (`Análise do projeto`, `Selecionando o que investigar`, `Falha no seletor`, `processos em paralelo`, `concluídos`), the Pipeline Editor per-card-timeout copy, Model Selector subtitle and legend, model catalog descriptions, and the `agent-env.ts` port-allocation prompt fed into agents.
- `example.pipeline.json` and `example.conditional.pipeline.json` translated to English so the on-disk samples match the README quick-start.
- README: Node badge bumped 18 → 20 (matches `engines.node`); `HUU_IMAGE` pin example refreshed; embedded `example.pipeline.json` snippet retranslated to English; new "On a VPN?" section in **Run with Docker** documenting the auto MTU network and override env var.
- `Dockerfile` builder stage copies the `webui/` workspace (`webui/package.json` before `npm ci`, full `webui/` tree before `npm run build`). Without this, `docker build` errored with `npm error No workspaces found: --workspace=webui` after the workspace was added at repo root in v1.0.1.
- webui workspace's strict-mode TypeScript build now passes: `domain-types.PromptStep` narrowed via `Extract<…, { prompt: string }>` so editor components keep accessing `prompt` / `files` type-safely; `PipelineCard` narrows `'files' in step`; `PipelineEditorPage` splits / recomposes work-vs-check steps at the boundary; new `webui/src/pages/FaqPage.tsx` + Router case satisfy the screen-FSM exhaustiveness check; unused `CheckOutcome` import removed from `pipeline-io.ts`.

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


[Unreleased]: https://github.com/frederico-kluser/huu/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/frederico-kluser/huu/releases/tag/v1.3.0
[1.2.0]: https://github.com/frederico-kluser/huu/releases/tag/v1.2.0
[1.1.0]: https://github.com/frederico-kluser/huu/releases/tag/v1.1.0
[1.0.2]: https://github.com/frederico-kluser/huu/releases/tag/v1.0.2
[1.0.1]: https://github.com/frederico-kluser/huu/releases/tag/v1.0.1
[0.3.1]: https://github.com/frederico-kluser/huu/releases/tag/v0.3.1
[0.3.0]: https://github.com/frederico-kluser/huu/releases/tag/v0.3.0
