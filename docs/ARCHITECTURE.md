# Architecture

This document describes the layered structure of `huu` and the design decisions behind it. For onboarding-level guidance, contributors should also consult the relevant `.agents/skills/<domain>/SKILL.md`.

## Layered tree

```
src/
├── cli.tsx                    # entry CLI (argv, --help, --yolo, --auto-scale, terminal restoration)
├── app.tsx                    # screen router (welcome / assistant / editor / run / summary)
├── lib/
│   ├── types.ts               # Pipeline, AgentStatus, RunManifest, AutoScaleStatus, defaults
│   ├── pipeline-io.ts         # JSON read/write (format v1)
│   ├── file-scanner.ts        # repo file tree (gitignore-aware)
│   ├── run-id.ts              # opaque run identifiers
│   ├── run-logger.ts          # per-run chronological + per-agent logs
│   ├── debug-logger.ts        # NDJSON tracing under .huu/
│   ├── api-key-registry.ts    # declarative spec list (openrouter, artificialAnalysis, …)
│   ├── api-key.ts             # generic resolver (mount → _FILE → env → ~/.config/huu/config.json)
│   ├── docker-reexec.ts       # auto-execs into the official image; signal-safe; secret-file mount
│   ├── active-run-sentinel.ts # /tmp/huu/active for the HEALTHCHECK probe
│   ├── init-docker.ts         # `huu init-docker` scaffolder
│   ├── status.ts              # `huu status` headless monitor
│   ├── prune.ts               # `huu prune` manual orphan inspection / cleanup
│   ├── resource-monitor.ts    # CPU/RAM sampling for the auto-scaler + SystemMetricsBar
│   ├── package-info.ts        # version/name pulled from package.json (used by --help and TUI)
│   ├── model-factory.ts       # LangChain ChatOpenAI factories (OpenRouter-tuned)
│   ├── openrouter.ts          # OpenRouter helpers shared by recon + assistant
│   ├── project-digest.ts      # compact project summary (file tree, package.json, README, …)
│   ├── project-recon.ts       # 4-agent pre-flight LLM recon (digest-only, single-pass)
│   ├── project-recon-prompts.ts  # mission statements for the four recon roles
│   ├── assistant-client.ts    # LangChain chat client used by the pipeline assistant
│   ├── assistant-prompts.ts   # interview system prompt + initial human message
│   └── assistant-schema.ts    # Zod schema for AssistantTurn / PipelineDraft
├── git/
│   ├── git-client.ts          # git wrapper with credential-helper isolation
│   ├── worktree-manager.ts    # create / dispose worktrees
│   ├── branch-namer.ts        # deterministic branch naming
│   ├── preflight.ts           # repo-state validation
│   └── integration-merge.ts   # branch merge into the central worktree
├── orchestrator/
│   ├── index.ts               # Orchestrator class (pool, lifecycle, abort, destroyAgent)
│   ├── task-decomposer.ts     # step → tasks
│   ├── stub-agent.ts          # synthetic lifecycle for demos / tests
│   ├── real-agent.ts          # real LLM agent via pi-coding-agent
│   ├── integration-agent.ts   # LLM conflict resolver
│   ├── auto-scaler.ts         # resource-bound concurrency state machine
│   ├── port-allocator.ts      # per-agent TCP port windows + probe
│   ├── agent-env.ts           # .env.huu writer + with-ports shim
│   ├── native-shim.ts         # on-demand compile of bind() interceptor
│   ├── agents-md-generator.ts # writes per-agent AGENTS.md briefings
│   └── types.ts               # AgentFactory and friends
├── models/                    # OpenRouter catalog + global recents
├── contracts/                 # zod schemas
├── prompts/                   # static prompt fragments shared by agents
└── ui/
    ├── components/
    │   ├── PipelineAssistant.tsx   # conversational pipeline authoring
    │   ├── PipelineEditor.tsx
    │   ├── PipelineImportList.tsx
    │   ├── PipelineIOScreen.tsx
    │   ├── ProjectRecon.tsx        # 4-agent pre-flight recon view
    │   ├── StepEditor.tsx
    │   ├── FileMultiSelect.tsx
    │   ├── ModelSelectorOverlay.tsx
    │   ├── RunDashboard.tsx
    │   ├── RunKanban.tsx
    │   ├── RunModal.tsx
    │   ├── LogArea.tsx
    │   ├── Spinner.tsx
    │   ├── SystemMetricsBar.tsx
    │   └── ApiKeyPrompt.tsx
    ├── hooks/
    │   ├── useTerminalClear.ts
    │   ├── useTerminalResize.ts
    │   └── useSystemMetrics.ts
    └── safe-terminal.ts       # belt-and-suspenders TTY restoration

native/
└── port-shim/
    ├── port-shim.c            # bind() interceptor (LD_PRELOAD / DYLD)
    └── Makefile               # local build target

scripts/
├── deploy.sh                  # interactive release driver (semver bump + tag + optional ghcr push)
├── huu-docker                 # bash wrapper documented in the README's Docker section
├── huu-compose                # auto-detects host UID/GID for `docker compose run`
└── smoke-image.sh, smoke-pipeline.sh
```

Dependencies flow **downward only**: the UI never imports the orchestrator's internals, and the orchestrator never imports the UI. See [`.agents/skills/architecture-conventions/SKILL.md`](../.agents/skills/architecture-conventions/SKILL.md) for the full set of layering rules.

## How a run unfolds

```
┌─────────────┐   ┌─────────────────┐   ┌─────────────────────────┐
│  Preflight  │──▶│ Build pipeline  │──▶│ Pick model + concurrency│
└─────────────┘   └─────────────────┘   └─────────────────────────┘
                                                     │
                                                     ▼
              ┌─────────────────────────────────────────────────┐
              │ Stage loop                                      │
              │   1. Decompose step into tasks                  │
              │   2. Spawn agents in isolated worktrees         │
              │      + allocate per-agent port window           │
              │      + write .env.huu and .huu-bin/with-ports   │
              │   3. Each agent commits to its own branch       │
              │   4. Merge branches serially into integration   │
              │   5. (rare) LLM resolves conflicts on a side wt │
              │   6. Next stage branches off the new integration│
              └─────────────────────────────────────────────────┘
                                                     │
                                                     ▼
                                        ┌────────────────────────┐
                                        │ Cleanup + summary view │
                                        └────────────────────────┘
```

1. **Preflight** validates repo state (clean tree, valid base branch, push capability where relevant).
2. The **integration worktree** is created on a disposable branch named `huu/<runId>/integration`.
3. Per stage, the orchestrator decomposes the step into tasks, allocates them to a bounded worker pool, and lets each agent work in its own worktree under `<repo>/.huu-worktrees/<runId>/`. Each worktree also receives a per-agent TCP port window (`.env.huu`) and a `.huu-bin/with-ports` shim — see [`PORT-SHIM.md`](../PORT-SHIM.md) and the [`port-isolation`](../.agents/skills/port-isolation/SKILL.md) skill.
4. As soon as all tasks for the stage finish, branches are merged serially into the integration worktree. In the rare case where a poorly-decomposed pipeline produces overlapping edits in the same stage, an integration agent backed by a real LLM resolves the conflict on a side worktree. Failed or timed-out tasks are retried up to `maxRetries` times in fresh worktrees.
5. The next stage branches off the **HEAD of the updated integration**, so each step sees the changes from every previous step.
6. Cleanup removes the integration worktree. Per-agent branches are preserved as artifacts; logs land under `.huu/`.

> See [`.agents/skills/git-workflow-orchestration/SKILL.md`](../.agents/skills/git-workflow-orchestration/SKILL.md) for the full lifecycle, branch naming, merge strategy, and conflict-resolution rules.

## Authoring layer (pipeline assistant + project recon)

The pipeline assistant (`ui/components/PipelineAssistant.tsx`) is the
guided alternative to writing JSON by hand. Triggered with `A` on the
welcome screen, it walks through five stages:

```
pick-model → intent → recon → asking ↻ ──┬──> editor (PipelineDraft → Pipeline)
                              answering ─┘
                              free-text ─┘
```

1. **`pick-model`** — the same `ModelSelectorOverlay` the run flow uses;
   the default is the cheap `DEFAULT_ASSISTANT_MODEL` because authoring
   shouldn't cost as much as running.
2. **`intent`** — a single free-text input describing what the pipeline
   should do.
3. **`recon`** — `lib/project-recon.ts` fans out four parallel
   `ChatOpenAI` calls (LangChain over OpenRouter), each with a focused
   mission (`stack`, `structure`, `libraries`, `conventions`). They
   share a single pre-built `lib/project-digest.ts` snapshot — the
   agents have **no tool access** and run **single-pass, digest-only**,
   so cost and latency are bounded. Each emits up to five terse bullets.
   Default model: `minimax/minimax-m2.7`. The aggregated bullets get
   embedded into the assistant's system prompt so the interview is
   project-specific.
4. **`asking` ↔ `answering` / `free-text`** — up to `MAX_TURNS = 8`
   multiple-choice questions. Every question carries a free-text escape
   hatch as its last option. The schema for each turn lives in
   `lib/assistant-schema.ts` (Zod-validated `AssistantTurn`). When the
   model emits a `done` turn, its `PipelineDraft` is converted to a
   `Pipeline` and handed to the editor.
5. The standard editor opens with the draft pre-loaded — review, tweak,
   `G` to run.

The assistant uses LangChain (`@langchain/openai`, `@langchain/core`)
because the OpenAI tool-calling/structured-output surface there is
better-tested than building a JSON-mode loop on the Pi SDK. The Pi SDK
is reserved for the actual run agents — they need filesystem tools, and
LangChain doesn't.

## Auto-scaling layer

`orchestrator/auto-scaler.ts` is a small state machine driven by
`lib/resource-monitor.ts` (1Hz CPU/RAM sampling). It exposes three
hooks the worker pool consults: `shouldSpawn()`, `shouldDestroy()`, and
`notifyAgentSpawned/notifyTaskQueued`. The states are surfaced to the
UI via `OrchestratorState.autoScale` (`AutoScaleStatus`):

| State | Meaning |
|---|---|
| `NORMAL` | Under both thresholds; will grant `shouldSpawn() === true`. |
| `SCALING_UP` | Actively granting spawn slots while the queue has work. |
| `BACKING_OFF` | CPU or RAM ≥ stop threshold (default 90%); refuses new spawns but leaves running agents alone. |
| `DESTROYING` | CPU or RAM ≥ destroy threshold (default 95%); `Orchestrator.destroyAgent(newestId)` runs and the killed task is requeued. |
| `COOLDOWN` | 30s pause after a destroy/back-off event so the system doesn't oscillate. |

Manual `+`/`-` on the run dashboard disables auto-scale (a single `A`
press re-enables it). Killed agents land on the `killed_by_autoscaler`
lifecycle phase, preserved in the run summary.

## Docker layer (host wrapper + container runtime)

The `huu` binary is the same in both worlds; an environment-gated branch
at the very top of `cli.tsx` decides which it is.

```
                   ┌─────────────────── HOST ────────────────────┐
                   │                                             │
                   │  $ huu run pipeline.json                    │
                   │       │                                     │
                   │       ▼                                     │
                   │  cli.tsx top-level                          │
                   │  decideReexec(argv, env)                    │
                   │       │                                     │
                   │       ├── HUU_NO_DOCKER=1 / --yolo → native │
                   │       ├── --help/-h               → native  │
                   │       ├── init-docker|status|prune → native │
                   │       └── otherwise               → re-exec │
                   │                                  │          │
                   │  reexecInDocker(argv):           │          │
                   │  spawn `docker run --rm -it     │           │
                   │    --cidfile /tmp/huu-cids/...  │           │
                   │    --user $UID:$GID             │           │
                   │    -v $PWD:$PWD -w $PWD         │           │
                   │    -e OPENROUTER_API_KEY ...    │           │
                   │    ghcr.io/.../huu:latest`      │           │
                   │                                  │          │
                   │  Trap SIGINT/SIGTERM/SIGHUP →   │           │
                   │    docker kill --signal <X>     │           │
                   │      <cid>                      │           │
                   │                                  ▼          │
                   └─────────────────────────────────┼───────────┘
                                                     │
                   ┌──────────── CONTAINER ──────────┼───────────┐
                   │                                 ▼           │
                   │  PID 1: tini                                │
                   │   └─ PID 2: huu-entrypoint (shell)          │
                   │        └─ PID 3: huu (Node)                 │
                   │              cli.tsx (HUU_IN_CONTAINER=1    │
                   │              short-circuits to native)      │
                   │                                             │
                   │  HEALTHCHECK probe reads /tmp/huu/active    │
                   │  (sentinel written by the TUI launcher) and │
                   │  cd's there before `huu status --liveness`. │
                   └─────────────────────────────────────────────┘
```

Key invariants:

- **Same-path bind mount.** `-v $PWD:$PWD -w $PWD` keeps the absolute paths git stores inside `.git/worktrees/<name>/gitdir` consistent on both sides. Without this, worktrees created in the container resolve to nowhere on the host.
- **Wrapper-side signal trap, not docker's sig-proxy.** [moby#28872](https://github.com/moby/moby/issues/28872) documents that `docker run -it` sometimes drops signals on the way to the container. We trap in the host process and explicitly `docker kill <cid>` to bypass that.
- **Orphan prune on startup.** SIGKILL of the wrapper bypasses traps and would leave orphans. The next `huu` invocation reads stale cidfiles in `/tmp/huu-cids/`, checks the recorded parent PID with `process.kill(pid, 0)`, and kills any container whose parent is gone.
- **Subcommand affinity.** `init-docker` and `status` operate on host filesystem state — running them in a container with a bind mount works but is wasted work. They stay native.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| LLM SDK | [`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) via OpenRouter | Lean, multi-provider-capable SDK designed for coding agents. |
| MCP | Not supported, deliberately | Tool definitions × N parallel agents = a significant fixed token cost on every turn before any useful work. Pi SDK's default tools (read/bash/edit/write) cover the supported use cases. |
| Conflict resolution | Integration agent (real LLM) on a side worktree | Fallback for misdesigned pipelines, not a core path — see "Decomposition is human work" in the README. |
| Worktree location | `<repo>/.huu-worktrees/<runId>/` | Isolated edits, native git audit trail. |
| Per-agent network isolation | `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES` shim that rewrites `bind(2)` against a per-agent port table | No Docker, no privileges, no edits to customer code. Worktrees isolate FS but not network — without this, parallel `npm run dev` invocations collide on port 3000. See [`PORT-SHIM.md`](../PORT-SHIM.md) for the full alternatives analysis (Docker / netns / code rewriting / serialization rejected). |
| Native shim build | On-demand compile via `cc` into `<repo>/.huu-cache/native-shim/<os>-<arch>/` | Avoids shipping prebuilts; gracefully falls back to env-only mode when `cc` is unavailable. Source at `native/port-shim/port-shim.c` (~150 lines C). |
| Recents storage | `~/.huu/recents.json` (global) | Stays out of repo state. |
| Default concurrency | `10` (live-tunable with `+`/`-`) | Empirically a good default for OpenRouter throughput. |
| Default port range | `55100..56000`, window of 10 ports per agent (configurable via `pipeline.portAllocation`) | Above well-known + registered ranges; TCP probe slides the window if the user already occupies part of it. |
| Default timeouts | `300000ms` single-file · `600000ms` multi-file/whole-project | Single-file work has very different latency from whole-project work. |
| Default retries | `1` per card | Retries run in fresh worktrees off the current integration HEAD. |
| Pipeline editor | Full in-app TUI, plus JSON import/export | Pipelines are reusable artifacts and round-trip cleanly. |
| Pipeline assistant | Conversational drafting with mandatory single-pass project recon | Authoring is the work; the recon is digest-only (`lib/project-digest.ts` + `lib/project-recon.ts`) so cost is bounded and the interview can ground itself in real project facts before asking ≤8 questions. |
| Auto-scaling | Resource-bound state machine (`orchestrator/auto-scaler.ts`) | Overnight runs need concurrency to track CPU/RAM headroom without operator input. Default thresholds: stop at 90%, destroy newest agent at 95%, 30s cooldown after each event, max 200 agents. Manual `+`/`-` disables auto-scale until `A` re-enables. |
| API key registry | Declarative spec list (`lib/api-key-registry.ts`) | Adding a key is a one-entry append; resolver, TUI prompt, Docker-secret bind-mount, env passthrough, orphan secret-file cleanup all iterate the same list. |
| Native escape hatch | `--yolo` flag (and `HUU_NO_DOCKER=1`) | Some users (and most contributors) need to skip Docker. The flag is composable with every other CLI mode (`huu --yolo run x.json`, `huu --yolo --stub`); a stderr warning is printed once per run because the agent gains access to the host's shell credentials. |

## Agent skills

The `.agents/skills/` directory contains domain-scoped guidance that the agents themselves consult before acting. They are also the canonical reference if you are extending `huu`.

| Skill | Domain |
|---|---|
| [`architecture-conventions`](../.agents/skills/architecture-conventions/SKILL.md) | Layered architecture, naming, imports, dependency rules |
| [`git-workflow-orchestration`](../.agents/skills/git-workflow-orchestration/SKILL.md) | Worktree lifecycle, branch naming, merge, conflict resolution |
| [`pipeline-agents`](../.agents/skills/pipeline-agents/SKILL.md) | Pipeline creation, task decomposition, AgentFactory usage |
| [`port-isolation`](../.agents/skills/port-isolation/SKILL.md) | Per-agent port allocation, bind() shim (LD_PRELOAD/DYLD), `.env.huu`, native compile |
| [`ui-tui-ink`](../.agents/skills/ui-tui-ink/SKILL.md) | Ink (React for terminals) component patterns, screen routing |
| [`build-dev-tools`](../.agents/skills/build-dev-tools/SKILL.md) | Build, dev, test commands and tooling config |
| [`llm-integration`](../.agents/skills/llm-integration/SKILL.md) | OpenRouter model selection, Pi SDK, thinking detection |

A condensed catalog also lives at [`agent-skills.md`](../agent-skills.md).

## Logs and debugging

- The kanban dashboard streams `LogArea` lines for every agent in real time. Use `F` to scope the log column to a single agent.
- The run summary screen shows totals (cost, tokens, duration), per-agent outcomes, and the full list of merged branches.
- For deeper post-mortems, open the chronological log under `.huu/`. It records every state transition, prompt, tool call, and merge result.
- A keyboard "freeze" diagnostic trace lands in `.huu/debug-<ISO>.log` (NDJSON). The CLI sets up this logger before mounting Ink, so even crashes during initial render leave a trail.
