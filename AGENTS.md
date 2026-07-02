# huu

A TypeScript/React (Ink) CLI TUI that runs LLM-agent pipelines in isolated git worktrees. Each stage decomposes into parallel tasks, deterministically merged into a central worktree at the end of every stage.

**Identity:** huu designs pipelines that make *thinking* agents follow a
*deterministic* process. It is NOT a tool for building new features — the
focus is audits, test generation, knowledge extraction, and any
assembly-line process with real, predictable value. No LLM planner invents
scope; the human underwrites the method, the agent supplies the
intelligence. Keep this framing in all docs and default pipelines.

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

Every task in this repo routes through the skill system under
`.agents/skills/` (source of truth, mirrored into `.claude/skills/` via
per-skill symlinks — regenerate with
`.agents/skills/project-router/scripts/sync-skill-links.sh`).

Start at **`project-router`**: it classifies the task, assembles the skill
chain from `.agents/skills/catalog.md` (the canonical routing index), loads
the knowledge BEFORE implementation, and guarantees each task skill runs its
`<evolution>` step at the end — learnings land in per-skill `LEARNINGS.md`
(probation) and are promoted into skill bodies only by
`meta-skill-consolidate`, always as uncommitted diffs for human review.

18 skills: 1 router · 9 knowledge (architecture, orchestrator, git
worktrees, LLM backends, ports, Docker, tests, docs, agent-prompts) · 6 task
(pipelines, default pipelines, TUI, web UI, commit gate, release) · 2 meta
(evolution, consolidate). The catalog is canonical — consult it, not this
paragraph, for the current list.

## Architecture (summary)

```
[host]   cli.tsx top-level → decideReexec → reexecInDocker
                ↓ (when not in container, not --help, not init-docker/status)
         docker run --cidfile … ghcr.io/…/huu:latest
                ↓
[container]  cli.tsx → web/serve.ts (DEFAULT front-end) | app.tsx (TUI, via --cli)
                ↓
              web/ (node:http + SSE server + vanilla-JS browser client:
                kanban, a real-time run-log activity console (live cross-run
                task counter, per-agent hue, unified multi-project stream), and
                an agent-output firehose
                mirrored to the browser console; the `/simulation` route serves
                a fully synthetic demo run — SimulationEngine, no git/LLM/key
                — see the building-web-ui skill)
              ui/components/ (Ink React views — the --cli TUI)
                ↓ (both front-ends can host N concurrent runs via the
                  GlobalScheduler — see Multi-run scheduling)
              orchestrator/ (worker pool, stage lifecycle, merge;
                global-scheduler.ts multiplexes N runs — see Multi-run scheduling)
                ↓
              orchestrator/backends/ (pluggable agent SDKs:
                pi/      — @mariozechner/pi-coding-agent (the only user-facing
                           backend; provider OpenRouter|Azure chosen via
                           LlmProvider — see src/lib/providers.ts)
                azure/   — internal dispatch kind serving the Azure AI Foundry
                           provider (docs/azure-backend.md)
                stub/    — no-LLM mock for smoke tests
                registry.ts — single dispatch from kind → factory)
                ↓
              git/ (worktree manager, branch ops, preflight, merge)
                ↓
              lib/ (types, pipeline-io, file-scanner, run-id, status,
                    init-docker, docker-reexec, active-run-sentinel,
                    api-key, prune, debug-logger, run-logger, repo-lock,
                    run-many (headless multi-run driver),
                    screen-fsm, assistant-check-feasibility)
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
directly. Native bypasses: `--yolo`, `--no-docker` (neutral CI spelling),
or `HUU_NO_DOCKER=1` — see `docs/ci.md` for the GitHub Actions / GitLab
recipes. See the `running-in-docker` skill for the full lifecycle.

### Dynamic concurrency (memory-aware, default ON)

The orchestrator always instantiates the `AutoScaler`
(`src/orchestrator/auto-scaler.ts`). In `auto` mode (the default) the
concurrency target is the **RAM BUDGET dial** — a configurable % of TOTAL RAM
(`HUU_RAM_PERCENT` / `--ram-percent` / web Setting; default 85, clamp 10–95;
`src/lib/budget.ts`, floored at `total − 512MiB` for the OS) minus
`ramUsedBytes`, divided by an EMA-observed per-agent footprint (seeded
PESSIMISTIC at 1536MiB so a cold start under-admits then opens up as the EMA
corrects DOWN on MATURE cohorts only, with reservation charges for in-flight spawns; clamped 128MiB–4GiB). The dial is **machine-global**: in
multi-run it configures the one shared budget `AutoScaler` via
`GlobalScheduler.setBudgetPercent`. The **front brake is Linux PSI**, run as a
CLOSED-LOOP controller (Fase 2.2, `updateController()`, senpai/TMO + Netflix
AIMD/Vegas): a `controlledLimit` ramps up additively while
`SystemMetrics.memPressureSome10` (cgroup `memory.pressure` →
`/proc/pressure/memory`; `null` off-Linux → falls back to the RAM stop-gate)
stays under the `targetPsi` setpoint (0.5%), cuts ×0.5 above the cut band
(2× setpoint = 1.0%) with a 5 s hold, and holds in the hysteresis band —
always clamped within the RAM budget ceiling (`effectiveLimit()` uses the live
ceiling in open-loop so the scheduler's synchronous read never lags). The binary
`shouldSpawn()` freeze moved to the cut band, so the controller can run the
machine AT the setpoint without the gate fighting it — pressure rises BEFORE RAM
saturates. Spawns FAST-RAMP geometrically (`executeTaskPool` caps new
spawns/tick to `max(1, ceil(busy·0.5))`, manual mode excepted) so no single tick
bursts the pool. `huu` also nudges its own `oom_score_adj` (best-effort,
configurable via `HUU_OOM_SCORE_ADJ`, conservative default; `src/lib/oom-score.ts`).
`--concurrency=N` or `--no-auto-scale` (or `RunConfig.concurrency` in headless)
pins `manual` mode. A third mode, `greedy` (TUI label **MAX**, the `M` hotkey),
floods one agent per queued task up to the hard ceiling and lets the guard be the
sole backstop, so concurrency settles at the destroy threshold. The MEMORY
GUARD runs in ALL THREE modes: at ≥95% RAM/CPU it preempts the NEWEST agent
(least work done — picked by `startedAt`). By default (Fase 2.3) it PAUSES it
instead of killing: `pauseAgent()` takes a checkpoint (`SpawnedAgent.checkpoint()`
→ the pi session-file path), disposes the agent to free RAM, PRESERVES its
worktree + branch + transcript, and requeues the task in a `paused` phase (DONE
column, amber `PAUSED`, `⏸N` badge, `pauses` counter) — the existing
`shouldSpawn` gate then RESUMES it IN PLACE (reuses the worktree, threads
`AgentRuntimeContext.restoreSessionPath` so the pi agent continues without
redoing tool calls) once headroom returns. `HUU_NO_PAUSE=1`, or any backend that
can't checkpoint (returns `null`/omits the method — azure, stub-less mocks),
falls back to the legacy KILL: `destroyAgent()` deletes the worktree+branch and
resets the card to `pending` with a `requeues` counter (TODO column, `↻N` badge).
The consumable preempt markers are the sibling `pausedAgentIds` / `killedAgentIds`
Sets in `orchestrator/index.ts` — never status flags (see `requeue.test.ts` for
both paths + the race/stale-flag regression). pi sessions persist to a
run-scoped `.huu-sessions/` dir OUTSIDE the worktree (else finalize would commit
the transcript); a paused task in `pendingTasks` keeps the pool alive so the
stage can't merge under it, making base-staleness structurally impossible.
CheckStep judges surface as kanban cards via `OrchestratorState.checkRuns`
(persisted to `RunManifest.checkRuns`). Each agent card also tracks
`AgentStatus.actionCounts` (keyed `stream`/`tool`/`file`/`log`/`usage`/`done`/
`error`) and `lastAction`, bumped once per `AgentEvent` in `handleAgentEvent`
(via `bumpAction`, mutating the map without emitting — the trailing `emit()`
publishes; accumulates like tokens/logs, NOT reset on requeue). The Ink kanban
(`RunKanban.tsx`) renders them as a per-action counters label plus a colored
`→ <action>` marker folded onto the `log:` line (the merge costs no extra
`cardHeight()` row; the counters label does — keep them in sync).

### Interactive retry of failed cards (`awaiting_retry`)

A timed-out card carries `AgentStatus.errorKind = 'timeout'` (vs `'failed'`),
surfaced distinctly in both front-ends (amber `TIMEOUT` vs red `FAILED`). When
the step walk ends with one or more task cards in `error` AND the orchestrator
was created with `OrchestratorOptions.interactiveRetry` (set by the single-run
TUI `RunDashboard` and every web run — NOT by `run-many`/smoke/simulation), the
run does not tear down: it enters a new `OrchestratorState.status` value
**`awaiting_retry`**, keeping the integration worktree alive while `start()`
parks on a finish gate. `Orchestrator.retryTask(agentId, {timeoutMs?})` re-runs
ONE failed task against the current integration HEAD (reusing the pool +
per-attempt auto-retry, with an optional longer per-task timeout) and merges its
branch on success; `finish()` (or `abort()`) releases the gate so the run
finalizes normally. User retries bump `AgentStatus.manualRetries` (kanban `⟳N`).
Headless paths are byte-identical — without `interactiveRetry`, `start()`
resolves immediately as before. TUI: `R` retries the focused card, `D` finishes;
web: an error card's drawer offers **Retry** (+ minutes for timeouts) and
**Finish**, via `POST /api/run/retry` and `/api/run/finish`. The multi-run TUI
dashboard has no per-card retry (no per-card focus); the web covers multi-run.

### Multi-run scheduling (GlobalScheduler)

A `GlobalScheduler` (`src/orchestrator/global-scheduler.ts`) runs MULTIPLE
pipeline runs in ONE process under a single shared RAM/concurrency budget. It
is the sole owner of the machine read — one `SystemMetricsSampler`
(`resource-monitor.ts`, de-globalized so concurrent samplers no longer corrupt
the CPU delta) plus one budget `AutoScaler`; per-run AutoScalers go DORMANT.
Each `Orchestrator` becomes a subordinate "run driver" via
`OrchestratorOptions.scheduler`. **When that option is ABSENT the scheduling
path is unchanged** — the shared-Set `port-allocator`, the per-repo git lock
(`WorktreeManager`'s `serializeGitOps`, which keeps two SAME-repo runs from
racing on `.git` worktree/branch ops; merges are excluded), and the dormant
per-run AutoScaler all engage only in multi-run.

Distribution is the pure `distributeBudget(demands, B)`: top-down by
registration order (= priority). Earlier runs are served first, later runs
backfill the remainder, and a bottlenecked run (mid-merge, demand ≈ 0) cascades
its slots onward. A lower-priority run whose grant drops below its busy count
DRAINS (stops spawning) — no wasted work. The memory guard is now CROSS-RUN:
`selectGlobalVictim()` preempts the LOWEST-priority run's newest agent first
(reusing each run's guard machinery — `pauseAgent` by default, `destroyAgent`
under `HUU_NO_PAUSE=1` or when the driver omits `pauseAgent`), never a
higher-priority run's agent while a lower one has a live agent — pinned by
`multi-run-priority.test.ts` (both the paused-victim and forced-kill paths). The
`RunDriver` the scheduler holds is an EXPLICIT wrapper (not the Orchestrator
itself), so `pauseAgent` had to be added to that literal too, not just the class. `B` is demand-capped, so the admission signal is
`headroomCapacity − demand` (`GlobalScheduler.remaining`), NOT `B − grants`.
`src/lib/run-many.ts` is the headless driver (lazy, monotonic admission:
admit the top run, pull in the next only on sustained spare capacity or while a
run is merging). The **web** front-end is wired: `WebRunManager` holds a
`Map<runId>` of concurrent runs over one scheduler, `/api/run` returns a runId
(no 409), SSE frames + the agent-stream firehose are per-`runId`, and the
browser shows a **project selector** when >1 run is active. Admission is **LAZY
server-side** (the OOM fix — the queue no longer dispatches everything at once):
`WebRunManager` keeps a `pending` queue drained by a 500ms loop using the shared
`AdmissionController` (`src/lib/admission-controller.ts`, also used by
`run-many`) — the first run starts immediately, the rest sit in a **`queued`**
phase until the shared budget shows sustained spare capacity (`MAX_LIVE_RUNS`
admitted at once, `MAX_CONCURRENT_RUNS` total accepted). The browser still POSTs
the whole queue (it just renders `queued`); the SERVER paces them. You can also
**return to the launch view and add more projects** mid-run — each new
`/api/run` is accepted and queued. See the building-web-ui skill. The **Ink TUI** has the same
capability via `MultiRunDashboard` (`src/ui/components/MultiRunDashboard.tsx`):
multi-select 2+ saved pipelines (SPACE) → run them concurrently with a
`Tab`/`1-9` project switcher — see the building-tui-screens skill.

## Bundled default pipelines

`pipeline-bootstrap.ts` materializes a small catalog of framework-agnostic
default pipelines into `pipelines/` on first run. Each one is idempotent
(it never overwrites an existing file). Source of truth lives in
`src/lib/default-pipelines/<name>.ts` and is registered in
`src/lib/default-pipelines/registry.ts`.

| Pipeline | What it does | Methodology |
|---|---|---|
| `huu Test Suite` (`_default`) | Stack detection → test runner setup → **autonomous recon** picks the most test-worthy files (memory-scope, NO manual picking) → parallel per-file unit tests → cleanup + coverage badge, gated by a CheckStep loop that reworks until the suite is green. **CODE-FROZEN**: it only writes tests + its own artifacts and NEVER edits your source — a bug a test exposes is *characterized* (current behavior pinned) and reported in `huu-tests-findings.md`, never fixed. Prompts bake in mutation-surviving assertion rules and an anti-flaky determinism ruleset; the judge diffs `$baseCommit..HEAD` to enforce the freeze and reject cheap-green (assertion-free) tests. | Google Testing Blog (behavior, not implementation) + [Fowler non-determinism](https://martinfowler.com/articles/nonDeterminism.html) + Feathers characterization testing + [Stryker](https://stryker-mutator.io/) follow-up |
| `huu Knowledge System` | Builds the full knowledge-skills system on a shared `.huu/knowledge/` blackboard — fully autonomous via `scope: "memory"` (no user file-picking): recon writes the study list (with per-file hints) → memory fan-out deep study (findings) → ONE synthesis step (topics + routing ground truth, written before any skill exists) → per-topic dossiers → skills materialized one-parallel-agent-per-dossier (memory fan-out, judge-looped) → meta-skills + LEARNINGS + routing surface (router-aware: extends an existing router/`catalog.md`, else creates `project-knowledge`) → blind routing eval gated by a description-sharpening rework loop. Engineered for small models: one cognitive op per step, mechanical judges, stub-safe forward defaults. Setup pipeline — mutates the repo. | [Agent Skills spec](https://agentskills.io/specification) + CoALA memory taxonomy + Voyager self-verification |
| `huu Docs Audit` | Inventories every doc, classifies via the Diátaxis compass, scores the README (standard-readme grounded), flags stale references, measures inline API-doc coverage. Report-only + judge gate. | [Diátaxis](https://diataxis.fr/) + [standard-readme](https://github.com/RichardLitt/standard-readme) |
| `huu Quality Audit` | Sonar-style report: cyclomatic + cognitive complexity, size metrics, churn×complexity hotspots (git-log mining), duplication, dead code, hotspot-weighted composite score. Report-only + judge gate. | [SonarSource cognitive complexity](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) + [Tornhill hotspots](https://docs.enterprise.codescene.io/versions/4.0.16/guides/technical/hotspots.html) |
| `huu Performance Audit` | Static hotspot scan (N+1, big-O, sync I/O, memory leaks, unbounded concurrency, missing caching), Core Web Vitals scorecard (INP via TBT lab proxy, caveat explicit), USE-method checklist. Report-only + judge gate. | [USE method](https://www.brendangregg.com/usemethod.html) + [Core Web Vitals](https://web.dev/articles/vitals) |
| `huu Refactor Plan` | Characterization-test baseline → per-file smell catalog → top-5 ranking by smell-weight × churn → STATIC Mikado-style graph per target → final Fowler recommendations. Report-only + judge gate. | [Fowler refactoring catalog](https://refactoring.com/catalog/) + [Mikado method](https://www.manning.com/books/the-mikado-method) + Tornhill hotspots |
| `huu Security Audit` | Secrets sweep (gitleaks v8.19+ `git`/`dir`), OWASP Top 10:2025 scan (autonomous memory-scope fan-out; semgrep when available), dependency CVE scan, supply-chain & CI posture (SLSA v1.2 / OpenSSF Scorecard informed), remediation roadmap. The four independent scan dimensions run as parallel `dependsOn` **waves** joined by consolidation. Report-only + judge gate. | [OWASP Top 10:2025](https://owasp.org/Top10/2025/) + [CWE Top 25 (2025)](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) + [SLSA](https://slsa.dev/spec/v1.2/) |

Only `huu Test Suite` carries `_default: true` — it's the entry the Welcome
screen highlights. The other six are surfaced in the pipeline picker but
are not flagged as "the default".

**Autonomy (v2) — no manual file-picking.** All six pipelines that used to
require `scope: "per-file"` (Test Suite + the five audits) now discover their
own targets: a recon step `produces` a `huu-memory-v1` list and the work step
fans out via `scope: "memory"` + `filesFrom` (the proven Knowledge System
pattern; huu auto-appends the MEMORY CONTRACT — see `src/lib/memory-contract.ts`).
The shared recon prompt is `targetsRecon()` in `knowledge-protocol.ts`, and
`registry.test.ts` enforces that NO default ever reintroduces `scope:
"per-file"`. `huu Security Audit` additionally fans its four INDEPENDENT scan
dimensions (recon, secrets, CVE, supply-chain) into parallel `dependsOn`
**waves** joined by consolidation; `huu Test Suite` ends with a CheckStep
cleanup loop. Step prompts follow `docs/prompting-playbook.md` (skill
`authoring-agent-prompts`).

Every report-only audit ENDS with a judge CheckStep (`N. Validate report`,
shared `reportJudgeCondition()` in `knowledge-protocol.ts`): sections
complete, summary counts match the FAQ, ordering correct, report-only
contract held. `approved` (the default outcome) advances to a terminal
`Finalize report` stamp step; `rework` loops back to consolidation
(maxRuns 2). `registry.test.ts` guards this contract — keep it green when
editing the modules. Note `pipeline-bootstrap` never overwrites: users with
already-materialized pipeline files keep them; delete
`pipelines/<name>.pipeline.json` to re-materialize the current version.

### Side-effect surface

The five audits are **report-only**: they write ONLY to
`.huu/audits/<topic>.md`, `.huu/audits/<topic>-faq.json`, and
`.huu/audits/<topic>-targets.json` (the recon target list; working
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
audits): `huu Test Suite` (writes test files + `huu-tests.md` +
`huu-tests-faq.json` + `huu-tests-findings.md` to the repo root, inserts
a tests-coverage badge in `README.md`, and adds only test/dev-deps + a
test script to the runner manifest; its recon hands off a transient
`huu-tests-targets.json` at the root that the finalize step deletes). It
is **code-frozen** — it never edits application/library source: the
cleanup step restores any drifted file to `$baseCommit` and the judge
rejects the run if `git diff --name-only $baseCommit..HEAD` shows a
non-test source path. Suspected bugs are pinned by characterization
tests and surfaced in `huu-tests-findings.md`, not fixed. The other
setup pipeline is `huu Knowledge System`
(writes `.agents/skills/**` + `.huu/knowledge/**`, same single
`.gitignore` adjustment rule with `!.huu/knowledge/`).

`Pipeline.maxNodeExecutions` (default 50) caps cursor VISITS to steps — a
per-file fan-out of N files counts as ONE visit; width is bounded by the
file selection (or `maxFiles` on memory steps) and the worker pool. Each
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
fires on judge failure / unknown label / cap. Work steps also support
`scope: "memory"` + `filesFrom`: the per-file fan-out is read at stage
start from a huu-memory-v1 JSON an EARLIER step wrote into the
integration worktree (per-entry `hint`s reach prompts via `$hint`;
missing file → empty stage, corrupt file → run fails). Steps can also
declare `dependsOn` (GitHub-Actions `needs` style): the run then executes
in DETERMINISTIC WAVES — every ready step's tasks share one pool (parallel
branches), merges happen sequentially in array order, ready checks run as
singleton waves, and outcomes/`next` become activation edges that re-pend
their downstream cone. No `dependsOn` → the legacy linear cursor runs
unchanged. See
`.agents/skills/authoring-pipelines/SKILL.md` and
`docs/pipeline-json-guide.md` (`#conditional-steps-check-nodes`).

## References (load on demand)
- Skill catalog (canonical): `.agents/skills/catalog.md` — router: `project-router`
- Human overview of the skill system: `agent-skills.md`
