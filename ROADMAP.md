# HUU Roadmap

> Implementation plan organized as a Beat Sheet — practicing what we preach.

---

## Phase 0 — Foundation (Act 1: Setup)

The skeleton. Nothing works end-to-end yet, but every piece can be tested in isolation.

### [x] 0.1 Project Scaffolding [depends: (none)]
- [x] `npm init` + TypeScript config (tsx, strict mode)
- [x] Directory structure: `src/`, `src/agents/`, `src/db/`, `src/tui/`, `src/git/`, `src/orchestrator/`
- [x] Install core dependencies: simple-git, better-sqlite3, ink, @anthropic-ai/sdk, @modelcontextprotocol/sdk
- [x] Install dev dependencies: vitest, tsx, @types/*
- [x] `.gitignore`, `tsconfig.json`, `package.json` scripts
- [x] Basic CLAUDE.md with project conventions

### [x] 0.2 SQLite Schema [depends: (0.1)]
- [x] Database initialization with WAL mode
- [x] `messages` table (typed mail system: task_assigned, task_done, merge_ready, escalation, health_check, broadcast, task_progress, merge_result)
- [x] `entities` table (knowledge graph: facts, decisions, patterns)
- [x] `relations` table (entity relationships)
- [x] `observations` table (tool usage events, 30-day decay)
- [x] `sessions` table (session summaries, 7-day window)
- [x] `instincts` table (learned patterns, confidence 0.3-0.85)
- [x] `beat_state` table (current beat sheet progress)
- [x] `audit_log` table (every tool call: timestamp, agent, tool, params, result)
- [x] Migration system (versioned schema changes)
- [x] Tests for all CRUD operations

### [x] 0.3 WorktreeManager [depends: (0.1)]
- [x] `WorktreeManager` class wrapping simple-git `raw()` calls
- [x] `create(agentId, baseBranch)` — creates branch + worktree
- [x] `remove(agentId)` — removes worktree + optionally deletes branch
- [x] `list()` — lists active worktrees with status
- [x] `getGit(agentId)` — returns isolated SimpleGit instance for a worktree
- [x] Mutex/semaphore for operations on shared refs
- [x] Dependency workspace strategy (`node_modules`) with fallback
- [x] Lifecycle management: stale detection + controlled prune
- [x] Tests with real git repos (temp directories)

**Checkpoint: Catalyst (~10%)** — Can we create worktrees, write to SQLite, and run tests?

---

## Phase 1 — Single Agent Loop (Act 1: Setup → Act 2: Confrontation)

One agent working end-to-end. No orchestration yet — just proving the agent → worktree → merge pipeline.

### [x] 1.1 Agent Runtime [depends: (0.2,0.3)]
- [x] Agent definition format (TypeScript interface matching YAML frontmatter)
- [x] Agent spawner: creates worktree, injects context, runs Claude API call
- [x] Context preparation: read from scratchpad, build focused prompt
- [x] Tool execution: map agent tools to actual implementations
- [x] Result collection: capture output, write to SQLite messages
- [x] Cleanup: remove worktree on completion or abort
- [x] Abort support via AbortController

### [x] 1.2 Builder Agent (first agent) [depends: (0.2,0.3,1.1)]
- [x] Builder agent definition (Sonnet, Read/Write/Edit/Bash tools)
- [x] End-to-end test: receive subtask → create worktree → implement → commit → signal done
- [x] File change tracking (which files were created/modified/deleted)

### [x] 1.3 Merge Workflow (Tier 1-2) [depends: (0.2,0.3,1.2)]
- [x] FIFO merge queue (SQLite-backed)
- [x] Tier 1: fast-forward detection and execution
- [x] Tier 2: recursive merge with automatic conflict detection
- [x] Pre-merge detection via `git merge-tree --write-tree`
- [x] Merge result logging to SQLite
- [x] Tests for clean merges and conflict detection

### [x] 1.4 Basic CLI [depends: (0.1,1.1,1.2,1.3)]
- [x] `huu run "task description"` — single agent execution
- [x] `huu status` — show current state
- [x] Structured console output (not TUI yet, just formatted logs)
- [x] CLI entry point + executable bin wiring (`src/cli/index.ts`, `bin/huu`, `package.json#bin`)

**Checkpoint: Midpoint (~50%)** — Can one agent receive a task, implement it in a worktree, and merge back?

---

## Phase 2 — Orchestration (Act 2: Confrontation)

The showrunner comes alive. Multiple agents working in parallel with coordination.

### [x] 2.1 Beat Sheet Engine [depends: (0.2,1.1)]
- [x] Beat sheet data model (4 levels: objective → acts → sequences → atomic tasks)
- [x] Decomposition prompt for planner agent (fractal: precondition → action → postcondition)
- [x] Checkpoint definitions (Catalyst, Midpoint, All Is Lost, Break Into Three, Final Image)
- [x] Dependency graph between atomic tasks (which can run in parallel)
- [x] Beat state persistence in SQLite
- [x] Visualization of beat sheet as structured text

### [x] 2.2 Orchestrator Loop [depends: (1.1,1.3,1.4,2.1)]
- [x] Main orchestrator loop: decompose → assign → monitor → collect → merge
- [x] Task assignment: match subtasks to agents by role
- [x] Parallel execution: spawn multiple agents concurrently
- [x] Progress monitoring: poll SQLite for task_progress messages
- [x] Completion handling: trigger merge when task_done received
- [x] Escalation handling: respond to agent escalations
- [x] Health check: periodic pings to detect stuck agents
- [x] Beat sheet advancement: move to next beat/sequence/act

### [x] 2.3 Remaining Agents [depends: (0.2,1.1,1.2,2.1,2.2)]
- [x] `planner` — Beat Sheet decomposition (Sonnet, read-only tools)
- [x] `tester` — TDD + test execution (Sonnet, read + bash)
- [x] `reviewer` — code review (Opus, strictly read-only)
- [x] `researcher` — web search + context gathering (Haiku, read-only)
- [x] `merger` — conflict resolution agent (Sonnet, read + git bash)
- [x] `refactorer` — cleanup agent (Haiku, read + write, no bash)
- [x] `doc-writer` — documentation sync (Haiku, read + write docs)
- [x] `debugger` — deep investigation (Opus, read + bash)
- [x] `context-curator` — post-activity memory curation (Haiku, read-only)

### [x] 2.4 Merge Workflow (Tier 3-4) [depends: (0.2,0.3,1.3,2.2,2.3)]
- [x] Tier 3: `ours`/`theirs` heuristic (multi-signal scoring: last-touch, ownership, history, risk)
- [x] Tier 4: AI Resolver (send conflict to Claude with full context bundle + validation gates)
- [x] Conflict history tracking in SQLite (frequency, strategies, outcomes, confidence)
- [x] Human escalation path (pause queue item, blocked_human state, operator actions)

### [x] 2.5 Context-Curator Integration [depends: (0.2,1.1,2.1,2.2,2.3)]
- [x] Post-activity hook: curator runs after every agent completes
- [x] Scratchpad update logic: what changed, what to add/remove from knowledge base
- [x] Strategic compact at beat sheet checkpoints
- [x] Retrieval just-in-time: load relevant context per agent, not everything

**Checkpoint: All Is Lost (~75%)** — What's the biggest risk? Likely: context quality degradation over long sessions, or coordination overhead exceeding productivity gains. Measure and adapt.

---

## Phase 3 — TUI (Act 2 → Act 3: Resolution)

The human interface. Everything that was CLI-only becomes visual and interactive.

### [x] 3.1 Kanban Board [depends: (0.2,2.1,2.2)]
- [x] Ink app shell with tab navigation (K/L/M/C/B)
- [x] 5-column Kanban: Backlog, Running, Review, Done, Failed
- [x] Card component: task ID, name, agent icon, model, elapsed time, cost
- [x] Header: current act, current beat, total cost
- [x] Keyboard navigation (arrow keys to select cards)
- [x] Auto-refresh from SQLite polling

### [x] 3.2 Detail View [depends: (0.2,1.1,1.2,2.2,3.1)]
- [x] Live log streaming from agent execution
- [x] Diff preview (files changed by agent)
- [x] Metrics panel: tokens used, context %, cost, elapsed
- [x] Context usage bar (visual)
- [x] ESC to return to Kanban

### [x] 3.3 Human Intervention [depends: (0.2,0.3,1.1,1.3,2.2,3.1,3.2)]
- [x] `[S]teer` — send redirect message to running agent
- [x] `[F]ollow-up` — queue instruction for after current turn
- [x] `[A]bort` — cancel agent, discard worktree, move to Failed
- [x] `[P]romote` — save learning from Done task to instincts

### [x] 3.4 Specialized Views [depends: (0.2,1.3,2.1,2.2,3.1)]
- [x] `[L]ogs` tab — aggregated log view from all agents
- [x] `[M]erge Queue` tab — FIFO queue with tier indicators
- [x] `[C]ost` tab — breakdown by agent, model, phase
- [x] `[B]eat Sheet` tab — hierarchical progress view with checkpoints

---

## Phase 4 — Intelligence (Act 3: Resolution)

The system learns and improves with every session.

### [x] 4.1 Anti-Hallucination Pipeline [depends: (1.2,2.1,2.2,2.3)]
- [x] L1: Prompt design templates with "I don't know" permission + source restriction
- [x] L2: Quote-first implementation for document-heavy tasks
- [x] L3: Reviewer agent loop (validate output vs requirements, max 3 iterations)
- [x] L4: Automated test gate (run tests before accepting builder output)
- [x] CoVe pipeline for critical outputs (4-step verification)
- [x] `critical: true` flag in beat sheet for high-risk tasks

### [x] 4.2 Memory & Learning [depends: (0.2,1.1,2.5)]
- [x] Observation logging via tool call hooks (100% coverage)
- [x] Pattern detection (threshold: 20+ observations → Haiku analysis)
- [x] Instinct generation with confidence scores (0.3-0.85)
- [x] Instinct decay when contradicted by evidence
- [x] Instinct promotion to project-level knowledge
- [x] Session summary generation on completion
- [x] Context loading: last 7 days of sessions on startup

### [x] 4.3 Audit System [depends: (0.2,1.1,2.2,2.3,2.4,2.5,3.4,4.1)]
- [x] Complete tool call logging (timestamp, agent, tool, params, result)
- [x] Post-session audit report generation
- [x] Suspicious action flagging (unusual patterns, unexpected file access)
- [x] Cost reporting per session, per feature, per agent

### [x] 4.4 MCP Bridge [depends: (0.1,1.1,2.2)]
- [x] MCP client programmatic setup (`@modelcontextprotocol/sdk`)
- [x] Bridge: MCP tools → agent custom tools
- [x] Lazy-start servers (connect on first use, disconnect after idle)
- [x] Token-efficient proxy pattern (single proxy tool, on-demand discovery)

---

## Phase 5 — Polish (Final Image)

### [x] 5.1 Developer Experience [depends: (0.2,1.4,2.1)]
- [x] `huu init` — initialize HUU in existing project
- [x] `huu config` — interactive configuration
- [x] Error messages with actionable suggestions
- [x] `--verbose` and `--quiet` modes
- [x] `--dry-run` for beat sheet preview without execution

### [x] 5.2 Resilience [depends: (0.2,0.3,1.1,1.3,2.1,2.2)]
- [x] Crash recovery: resume from last SQLite checkpoint
- [x] Stale worktree detection and cleanup
- [x] Agent timeout with automatic retry
- [x] Graceful shutdown (finish current agents, merge completed work)
- [x] State machine recovery patterns for orchestrator

### [ ] 5.3 Performance [depends: (0.2,0.3,2.2,3.4,5.1)]
- [ ] Agent concurrency cap (configurable, default 5)
- [ ] Coordination overhead metrics visible in TUI
- [ ] SQLite query optimization for large histories
- [ ] Worktree reuse (recycle instead of create/destroy)

### [ ] 5.4 Documentation [depends: (1.4,2.2,3.1,3.2,4.1,4.2,4.3)]
- [ ] API documentation
- [ ] Contributing guide
- [ ] Examples: common workflows with expected output
- [ ] Video demo

---

## Milestone Summary

| Phase | Name | Checkpoint | Key Deliverable | Progress |
|-------|------|-----------|-----------------|----------|
| 0 | Foundation | Catalyst (10%) | SQLite + WorktreeManager + tests | 3/3 |
| 1 | Single Agent | Midpoint (50%) | One agent end-to-end with merge | 4/4 |
| 2 | Orchestration | All Is Lost (75%) | Multi-agent parallel execution | 5/5 |
| 3 | TUI | Break Into Three (77%) | Interactive Kanban interface | 4/4 |
| 4 | Intelligence | Final approach (90%) | Learning + anti-hallucination | 4/4 |
| 5 | Polish | Final Image (100%) | Production-ready | 2/4 |

---

## Non-Goals (for now)

- Cloud/remote deployment (local-first)
- Web UI (terminal-only)
- Support for non-Claude models (Anthropic SDK only)
- Plugin/extension marketplace
- Multi-user collaboration (single operator)

These may become goals in future versions based on demand and evidence.
