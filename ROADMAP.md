# HUU Roadmap

> Implementation plan organized as a Beat Sheet — practicing what we preach.

---

## Phase 0 — Foundation (Act 1: Setup)

The skeleton. Nothing works end-to-end yet, but every piece can be tested in isolation.

### 0.1 Project Scaffolding
- [ ] `npm init` + TypeScript config (tsx, strict mode)
- [ ] Directory structure: `src/`, `src/agents/`, `src/db/`, `src/tui/`, `src/git/`, `src/orchestrator/`
- [ ] Install core dependencies: simple-git, better-sqlite3, ink, @anthropic-ai/sdk, @modelcontextprotocol/sdk
- [ ] Install dev dependencies: vitest, tsx, @types/*
- [ ] `.gitignore`, `tsconfig.json`, `package.json` scripts
- [ ] Basic CLAUDE.md with project conventions

### 0.2 SQLite Schema
- [ ] Database initialization with WAL mode
- [ ] `messages` table (typed mail system: task_assigned, task_done, merge_ready, escalation, health_check, broadcast, task_progress, merge_result)
- [ ] `entities` table (knowledge graph: facts, decisions, patterns)
- [ ] `relations` table (entity relationships)
- [ ] `observations` table (tool usage events, 30-day decay)
- [ ] `sessions` table (session summaries, 7-day window)
- [ ] `instincts` table (learned patterns, confidence 0.3-0.85)
- [ ] `beat_state` table (current beat sheet progress)
- [ ] `audit_log` table (every tool call: timestamp, agent, tool, params, result)
- [ ] Migration system (versioned schema changes)
- [ ] Tests for all CRUD operations

### 0.3 WorktreeManager
- [ ] `WorktreeManager` class wrapping simple-git `raw()` calls
- [ ] `create(agentId, baseBranch)` — creates branch + worktree
- [ ] `remove(agentId)` — removes worktree + optionally deletes branch
- [ ] `list()` — lists active worktrees with status
- [ ] `getGit(agentId)` — returns isolated SimpleGit instance for a worktree
- [ ] Mutex/semaphore for operations on shared refs
- [ ] Symlink support for `node_modules` (avoid redundant installs)
- [ ] Tests with real git repos (temp directories)

**Checkpoint: Catalyst (~10%)** — Can we create worktrees, write to SQLite, and run tests?

---

## Phase 1 — Single Agent Loop (Act 1: Setup → Act 2: Confrontation)

One agent working end-to-end. No orchestration yet — just proving the agent → worktree → merge pipeline.

### 1.1 Agent Runtime
- [ ] Agent definition format (TypeScript interface matching YAML frontmatter)
- [ ] Agent spawner: creates worktree, injects context, runs Claude API call
- [ ] Context preparation: read from scratchpad, build focused prompt
- [ ] Tool execution: map agent tools to actual implementations
- [ ] Result collection: capture output, write to SQLite messages
- [ ] Cleanup: remove worktree on completion or abort
- [ ] Abort support via AbortController

### 1.2 Builder Agent (first agent)
- [ ] Builder agent definition (Sonnet, Read/Write/Edit/Bash tools)
- [ ] End-to-end test: receive subtask → create worktree → implement → commit → signal done
- [ ] File change tracking (which files were created/modified/deleted)

### 1.3 Merge Workflow (Tier 1-2)
- [ ] FIFO merge queue (SQLite-backed)
- [ ] Tier 1: fast-forward detection and execution
- [ ] Tier 2: recursive merge with automatic conflict detection
- [ ] Pre-merge detection via `git merge-tree --write-tree`
- [ ] Merge result logging to SQLite
- [ ] Tests for clean merges and conflict detection

### 1.4 Basic CLI
- [ ] `huu run "task description"` — single agent execution
- [ ] `huu status` — show current state
- [ ] Structured console output (not TUI yet, just formatted logs)

**Checkpoint: Midpoint (~50%)** — Can one agent receive a task, implement it in a worktree, and merge back?

---

## Phase 2 — Orchestration (Act 2: Confrontation)

The showrunner comes alive. Multiple agents working in parallel with coordination.

### 2.1 Beat Sheet Engine
- [ ] Beat sheet data model (4 levels: objective → acts → sequences → atomic tasks)
- [ ] Decomposition prompt for planner agent (fractal: precondition → action → postcondition)
- [ ] Checkpoint definitions (Catalyst, Midpoint, All Is Lost, Break Into Three, Final Image)
- [ ] Dependency graph between atomic tasks (which can run in parallel)
- [ ] Beat state persistence in SQLite
- [ ] Visualization of beat sheet as structured text

### 2.2 Orchestrator Loop
- [ ] Main orchestrator loop: decompose → assign → monitor → collect → merge
- [ ] Task assignment: match subtasks to agents by role
- [ ] Parallel execution: spawn multiple agents concurrently
- [ ] Progress monitoring: poll SQLite for task_progress messages
- [ ] Completion handling: trigger merge when task_done received
- [ ] Escalation handling: respond to agent escalations
- [ ] Health check: periodic pings to detect stuck agents
- [ ] Beat sheet advancement: move to next beat/sequence/act

### 2.3 Remaining Agents
- [ ] `planner` — Beat Sheet decomposition
- [ ] `tester` — TDD + test execution
- [ ] `reviewer` — code review (read-only tools)
- [ ] `researcher` — web search + context gathering
- [ ] `merger` — conflict resolution agent
- [ ] `refactorer` — cleanup agent
- [ ] `doc-writer` — documentation sync
- [ ] `debugger` — deep investigation
- [ ] `context-curator` — post-activity memory curation

### 2.4 Merge Workflow (Tier 3-4)
- [ ] Tier 3: `ours`/`theirs` heuristic (last-touch-wins + file ownership tracking)
- [ ] Tier 4: AI Resolver (send conflict to Claude with per-file conflict history)
- [ ] Conflict history tracking in SQLite (which files conflict frequently)
- [ ] Human escalation path (pause queue, notify TUI)

### 2.5 Context-Curator Integration
- [ ] Post-activity hook: curator runs after every agent completes
- [ ] Scratchpad update logic: what changed, what to add/remove from knowledge base
- [ ] Strategic compact at beat sheet checkpoints
- [ ] Retrieval just-in-time: load relevant context per agent, not everything

**Checkpoint: All Is Lost (~75%)** — What's the biggest risk? Likely: context quality degradation over long sessions, or coordination overhead exceeding productivity gains. Measure and adapt.

---

## Phase 3 — TUI (Act 2 → Act 3: Resolution)

The human interface. Everything that was CLI-only becomes visual and interactive.

### 3.1 Kanban Board [depends: (0.2,2.1,2.2)]
- [ ] Ink app shell with tab navigation (K/L/M/C/B)
- [ ] 5-column Kanban: Backlog, Running, Review, Done, Failed
- [ ] Card component: task ID, name, agent icon, model, elapsed time, cost
- [ ] Header: current act, current beat, total cost
- [ ] Keyboard navigation (arrow keys to select cards)
- [ ] Auto-refresh from SQLite polling

### 3.2 Detail View
- [ ] Live log streaming from agent execution
- [ ] Diff preview (files changed by agent)
- [ ] Metrics panel: tokens used, context %, cost, elapsed
- [ ] Context usage bar (visual)
- [ ] ESC to return to Kanban

### 3.3 Human Intervention
- [ ] `[S]teer` — send redirect message to running agent
- [ ] `[F]ollow-up` — queue instruction for after current turn
- [ ] `[A]bort` — cancel agent, discard worktree, move to Failed
- [ ] `[P]romote` — save learning from Done task to instincts

### 3.4 Specialized Views
- [ ] `[L]ogs` tab — aggregated log view from all agents
- [ ] `[M]erge Queue` tab — FIFO queue with tier indicators
- [ ] `[C]ost` tab — breakdown by agent, model, phase
- [ ] `[B]eat Sheet` tab — hierarchical progress view with checkpoints

---

## Phase 4 — Intelligence (Act 3: Resolution)

The system learns and improves with every session.

### 4.1 Anti-Hallucination Pipeline
- [ ] L1: Prompt design templates with "I don't know" permission + source restriction
- [ ] L2: Quote-first implementation for document-heavy tasks
- [ ] L3: Reviewer agent loop (validate output vs requirements, max 3 iterations)
- [ ] L4: Automated test gate (run tests before accepting builder output)
- [ ] CoVe pipeline for critical outputs (4-step verification)
- [ ] `critical: true` flag in beat sheet for high-risk tasks

### 4.2 Memory & Learning
- [ ] Observation logging via tool call hooks (100% coverage)
- [ ] Pattern detection (threshold: 20+ observations → Haiku analysis)
- [ ] Instinct generation with confidence scores (0.3-0.85)
- [ ] Instinct decay when contradicted by evidence
- [ ] Instinct promotion to project-level knowledge
- [ ] Session summary generation on completion
- [ ] Context loading: last 7 days of sessions on startup

### 4.3 Audit System
- [ ] Complete tool call logging (timestamp, agent, tool, params, result)
- [ ] Post-session audit report generation
- [ ] Suspicious action flagging (unusual patterns, unexpected file access)
- [ ] Cost reporting per session, per feature, per agent

### 4.4 MCP Bridge
- [ ] MCP client programmatic setup (`@modelcontextprotocol/sdk`)
- [ ] Bridge: MCP tools → agent custom tools
- [ ] Lazy-start servers (connect on first use, disconnect after idle)
- [ ] Token-efficient proxy pattern (single proxy tool, on-demand discovery)

---

## Phase 5 — Polish (Final Image)

### 5.1 Developer Experience
- [ ] `huu init` — initialize HUU in existing project
- [ ] `huu config` — interactive configuration
- [ ] Error messages with actionable suggestions
- [ ] `--verbose` and `--quiet` modes
- [ ] `--dry-run` for beat sheet preview without execution

### 5.2 Resilience
- [ ] Crash recovery: resume from last SQLite checkpoint
- [ ] Stale worktree detection and cleanup
- [ ] Agent timeout with automatic retry
- [ ] Graceful shutdown (finish current agents, merge completed work)

### 5.3 Performance
- [ ] Agent concurrency cap (configurable, default 5)
- [ ] Coordination overhead metrics visible in TUI
- [ ] SQLite query optimization for large histories
- [ ] Worktree reuse (recycle instead of create/destroy)

### 5.4 Documentation
- [ ] API documentation
- [ ] Contributing guide
- [ ] Examples: common workflows with expected output
- [ ] Video demo

---

## Milestone Summary

| Phase | Name | Checkpoint | Key Deliverable |
|-------|------|-----------|-----------------|
| 0 | Foundation | Catalyst (10%) | SQLite + WorktreeManager + tests |
| 1 | Single Agent | Midpoint (50%) | One agent end-to-end with merge |
| 2 | Orchestration | All Is Lost (75%) | Multi-agent parallel execution |
| 3 | TUI | Break Into Three (77%) | Interactive Kanban interface |
| 4 | Intelligence | Final approach (90%) | Learning + anti-hallucination |
| 5 | Polish | Final Image (100%) | Production-ready |

---

## Non-Goals (for now)

- Cloud/remote deployment (local-first)
- Web UI (terminal-only)
- Support for non-Claude models (Anthropic SDK only)
- Plugin/extension marketplace
- Multi-user collaboration (single operator)

These may become goals in future versions based on demand and evidence.
