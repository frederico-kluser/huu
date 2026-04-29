# Architecture

This document describes the layered structure of `huu` and the design decisions behind it. For onboarding-level guidance, contributors should also consult the relevant `.agents/skills/<domain>/SKILL.md`.

## Layered tree

```
src/
├── cli.tsx                    # entry CLI (argv, --help, terminal restoration)
├── app.tsx                    # screen router (welcome / editor / run / summary)
├── lib/
│   ├── types.ts               # Pipeline, AgentStatus, RunManifest, defaults
│   ├── pipeline-io.ts         # JSON read/write (format v1)
│   ├── file-scanner.ts        # repo file tree (gitignore-aware)
│   ├── run-id.ts              # opaque run identifiers
│   ├── run-logger.ts          # per-run chronological + per-agent logs
│   ├── debug-logger.ts        # NDJSON tracing under .huu/
│   ├── api-key.ts             # OPENROUTER_API_KEY resolver (env / _FILE / docker secret)
│   ├── docker-reexec.ts       # auto-execs into the official image; signal-safe; secret-file mount
│   ├── active-run-sentinel.ts # /tmp/huu/active for the HEALTHCHECK probe
│   ├── init-docker.ts         # `huu init-docker` scaffolder
│   ├── status.ts              # `huu status` headless monitor
│   └── prune.ts               # `huu prune` manual orphan inspection / cleanup
├── git/
│   ├── git-client.ts          # git wrapper with credential-helper isolation
│   ├── worktree-manager.ts    # create / dispose worktrees
│   ├── branch-namer.ts        # deterministic branch naming
│   ├── preflight.ts           # repo-state validation
│   └── integration-merge.ts   # branch merge into the central worktree
├── orchestrator/
│   ├── index.ts               # Orchestrator class (pool, lifecycle, abort)
│   ├── task-decomposer.ts     # step → tasks
│   ├── stub-agent.ts          # synthetic lifecycle for demos / tests
│   ├── real-agent.ts          # real LLM agent via pi-coding-agent
│   ├── integration-agent.ts   # LLM conflict resolver
│   ├── port-allocator.ts      # per-agent TCP port windows + probe
│   ├── agent-env.ts           # .env.huu writer + with-ports shim
│   ├── native-shim.ts         # on-demand compile of bind() interceptor
│   └── types.ts               # AgentFactory and friends
├── models/                    # OpenRouter catalog + global recents
├── contracts/                 # zod schemas
└── ui/
    ├── components/
    │   ├── PipelineEditor.tsx
    │   ├── StepEditor.tsx
    │   ├── FileMultiSelect.tsx
    │   ├── ModelSelectorOverlay.tsx
    │   ├── PipelineIOScreen.tsx
    │   ├── RunDashboard.tsx
    │   ├── RunKanban.tsx
    │   ├── RunModal.tsx
    │   ├── LogArea.tsx
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
                   │       ├── HUU_NO_DOCKER=1     → native      │
                   │       ├── --help/-h           → native      │
                   │       ├── init-docker | status → native     │
                   │       └── otherwise           → re-exec     │
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
