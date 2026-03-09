# HUU

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/Tests-1214%20passing-brightgreen)](./ROADMAP.md)

A multi-agent orchestrator for software development that thinks like a **showrunner**.

HUU decomposes complex tasks into a **narrative arc** (Beat Sheet), delegates to **11 specialized agents** running in isolated Git worktrees, and integrates their work through a **4-tier progressive merge** pipeline. All communication, memory, and audit logs live in a single **SQLite WAL** database. You control everything through an interactive **Kanban TUI** built with React Ink.

```
┌─ huu ──────────────────────── Ato 2/3 ── Beat: Midpoint ── $1.23 ─┐
│                                                                     │
│  BACKLOG       RUNNING        REVIEW         DONE                  │
│  ─────────    ─────────      ─────────      ─────────              │
│  │ 2.3 │     │ 2.1   │      │ 1.3   │      │ 1.1   │              │
│  │ API  │     │🤖 bldr│      │🔍 revw│      │✅ auth│              │
│  │ endpt│     │ sonnet│      │ opus  │      │ 3m24s │              │
│  │      │     │ 1m02s │      │ 0m45s │      │ $0.12 │              │
│  └──────┘     └───────┘      └───────┘      └───────┘              │
│                                                                     │
│  [K]anban  [L]ogs  [M]erge Queue  [C]ost  [B]eat Sheet    [Q]uit  │
└─────────────────────────────────────────────────────────────────────┘
```

## How It Works

**1. You describe the task.** HUU's orchestrator (Opus) decomposes it into a hierarchical Beat Sheet — a fractal structure inspired by screenwriting where every level mirrors setup-conflict-resolution.

**2. Agents execute in parallel.** Each agent gets its own Git worktree, a clean context snapshot from the central scratchpad, and a focused subtask. Agents are stateless workers — the scratchpad is the real memory.

**3. Work is integrated progressively.** Completed work enters a FIFO merge queue with 4 resolution tiers: fast-forward, recursive, heuristic, and AI resolver. 90%+ of merges resolve without human intervention.

**4. You stay in control.** The Kanban TUI shows every agent's status at a glance. Select any card for live logs, diffs, and metrics. Steer, follow-up, or abort any agent at any time.

## Architecture

```
                    ┌──────────────────────┐
                    │   ORCHESTRATOR       │
                    │   (Showrunner/Opus)  │
                    └──────┬───────────────┘
                           │ Beat Sheet decomposition
              ┌────────────┼────────────────┐
              │            │                │
              ▼            ▼                ▼
    ┌─────────────┐ ┌────────────┐  ┌────────────┐
    │  BUILDER    │ │  TESTER    │  │  REVIEWER  │
    │  (Sonnet)   │ │  (Sonnet)  │  │  (Opus)    │
    │  worktree-1 │ │  worktree-2│  │  read-only │
    └──────┬──────┘ └─────┬──────┘  └─────┬──────┘
           │              │               │
           └──────────────┼───────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   SQLITE WAL          │
              │   messages + memory   │
              │   + scratchpad        │
              │   + audit log         │
              └───────────────────────┘
```

### The 11 Agents

| Agent | Default Model | Role |
|-------|---------------|------|
| `orchestrator` | Claude Sonnet 4.5 | Showrunner — decomposes, delegates, maintains coherence |
| `planner` | Claude Sonnet 4.5 | Hierarchical Beat Sheet decomposition |
| `builder` | Claude Sonnet 4 | Code implementation |
| `tester` | MiniMax M2.5 | TDD + test validation |
| `reviewer` | Claude Opus 4 | Code review + quality verification |
| `researcher` | Gemini 2.5 Flash | Search + context gathering |
| `merger` | GPT-4.1 | Conflict resolution + merge execution |
| `refactorer` | DeepSeek V3.2 | Cleanup + dead code removal |
| `doc-writer` | Gemini 3.1 Flash Lite | Documentation sync |
| `debugger` | Gemini 2.5 Pro | Deep bug investigation |
| `context-curator` | Gemini 2.5 Flash Lite | Post-activity memory curation |

### Model Tiering (via OpenRouter)

HUU routes each agent through [OpenRouter](https://openrouter.ai/), selecting the optimal model per role based on cost-benefit analysis:

| Tier | Agents | Default Models | Blended $/MTok |
|------|--------|----------------|----------------|
| **Critical** | orchestrator, reviewer, debugger | Sonnet 4.5, Opus 4.6, Gemini 3.1 Pro | $9–$19 |
| **Principal** | planner, builder, tester, merger | Sonnet 4.5/4.6, MiniMax M2.5, GPT-4.1 | $0.86–$11.40 |
| **Economy** | researcher, refactorer, doc-writer, context-curator | Gemini Flash, DeepSeek V3.2, Flash Lite | $0.10–$2.50 |

The Setup Wizard lets you choose models per agent with cost-benefit rankings, input/output pricing, and explanations. All 28 models from the catalog are available for every agent — recommended models appear first, with the rest accessible by scrolling. A text filter (`/`) makes it easy to search through models.

You can also change agent models at runtime via the `G` hotkey from the main TUI.

Estimated cost per feature: **~$0.20–$0.55** (depends on caching and model choices)

### Beat Sheet Decomposition

Tasks are decomposed into 4 fractal levels inspired by Robert McKee's narrative hierarchy:

```
Level 1: GLOBAL OBJECTIVE (complete arc)
  └─ Level 2: ACTS (3) — Setup, Confrontation, Resolution
       └─ Level 3: SEQUENCES — subtask groups
            └─ Level 4: ATOMIC TASKS — action + verification
```

Mandatory checkpoints at Catalyst (10%), Midpoint (50%), All Is Lost (75%), and Final Image (100%).

### Merge Pipeline

| Tier | Strategy | When |
|------|----------|------|
| 1 | Fast-forward | No divergence |
| 2 | Recursive auto-merge | No conflicts |
| 3 | `ours`/`theirs` heuristic | Mechanical conflicts |
| 4 | AI Resolver with per-file history | Semantic conflicts |

If all tiers fail → escalation to human via TUI.

### Anti-Hallucination

4-layer defense on every output + selective Chain-of-Verification (CoVe) for critical paths:

- **L1** — Prompt design (allows "I don't know")
- **L2** — Quote-first for document tasks
- **L3** — Reviewer agent validates against requirements (max 3 loops)
- **L4** — Automated tests as final gate
- **CoVe** — activated only for outputs marked `critical: true`

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js LTS (v22+) |
| Language | TypeScript (tsx) |
| Git | simple-git + `raw()` for worktrees |
| Database | better-sqlite3 (WAL mode) |
| TUI | React Ink |
| AI SDK | @anthropic-ai/sdk |
| AI Router | OpenRouter (per-agent model selection) |
| MCP | @modelcontextprotocol/sdk v1.x |
| Tests | vitest |

## TUI Controls

The TUI interface is in **Brazilian Portuguese (pt-BR)**.

| Key | Action |
|-----|--------|
| `↑↓←→` | Navigate Kanban cards |
| `Enter` | Open Detail View |
| `Esc` | Back to Kanban / Cancel |
| `G` | Open agent model settings (guided flow) |
| `S` | Steer agent (redirect now) |
| `F` | Follow-up (queue for after current turn) |
| `A` | Abort agent (discard worktree) |
| `P` | Promote learning to instinct |
| `K/L/M/C/B` | Switch tabs (Kanban, Logs, Merge, Custo, Beat Sheet) |
| `/` | Text filter (in model/agent selection screens) |
| `Q` | Quit |

## Guiding Principles

1. **Fractal decomposition** — every level mirrors setup-conflict-resolution
2. **Mandatory state change** — subtask without verifiable output = overhead
3. **Stateless agents, stateful scratchpad** — agents receive snapshot, execute, return
4. **SQLite for everything** — communication, memory, audit — one database, zero infra
5. **Curation > accumulation** — context-curator decides what persists
6. **Model tiering** — Opus for decisions, Sonnet for work, Haiku for mechanics
7. **Verification proportional to risk** — light defense on happy path, heavy on critical
8. **Human-in-the-loop on demand** — steer/follow-up/abort always available
9. **Simplicity first** — start simple, measure, scale with evidence

## Quick Start

```bash
# Install
git clone https://github.com/frederico-kluser/huu.git
cd huu && npm install

# Initialize in your project
huu init

# Run a task
huu run "Add a health check endpoint"

# Check status
huu status
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — full architectural manifest with all 12 decisions and rationale
- [ROADMAP.md](./ROADMAP.md) — implementation phases and milestones
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, conventions, and PR workflow
- [API Reference](./docs/api.md) — public API overview with examples
- [Model Catalog](./docs/models-llm-openrouter-deep.md) — OpenRouter model analysis and tiering strategy
- [Ink TUI Guide](./docs/ink-react-terminal-do-zero-ao-dashboard.md) — React Ink tutorial with setup wizard docs
- [Examples](./examples/) — common workflows with expected output
- [Demo](./docs/demo/) — VHS tape for reproducible terminal demo

## License

MIT
