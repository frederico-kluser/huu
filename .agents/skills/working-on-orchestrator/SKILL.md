---
name: working-on-orchestrator
description: Explains huu's run lifecycle and its invariants — stage loop, task decomposition, worker pool, AutoScaler memory math, the memory-guard kill/requeue path with its consumable killedAgentIds Set, CheckStep judge execution (reserved agentId 9998) and checkRuns kanban state. Use when changing anything in src/orchestrator/ — scheduling, concurrency, requeue, check execution, run state — or when debugging why agents are killed, requeued or misrouted.
metadata:
  version: 0.1.0
  type: knowledge
---

# Working on the Orchestrator

## When to use

Changes or investigations in `src/orchestrator/` (index, auto-scaler, port-allocator, check execution) and bugs whose symptoms are: agents killed/requeued, wrong concurrency, judge verdicts misrouted, kanban state out of sync.

## Injected knowledge

### Run lifecycle

1. Preflight (git checks) → stage loop over pipeline steps.
2. Each WorkStep decomposes via `task-decomposer.ts`: one task per file in `files[]`, or one whole-project task when `files: []`.
3. Worker pool runs each task in its own worktree/branch; stage ends with a deterministic merge into the integration worktree (see orchestrating-git-worktrees).
4. The cursor then follows `next` / CheckStep outcomes through the step graph, bounded by `maxNodeExecutions` (default 50).

### Reserved agent IDs — and why

- `9998` = CheckStep judge, `9999` = stage-integration agent. Branch names derive from agentId, so reserved IDs keep judge/integration branches recognizable and out of the per-task ID space.
- A WorkStep revisited via a check loop allocates FRESH agent IDs — reusing one would collide branch names from the earlier visit.

### CheckStep execution

- The judge runs with shell access in the integration worktree; its verdict is parsed from the last JSON block of its output. `condition` supports the `$runs` token (visit count).
- Routing: verdict label → matching `outcomes[].nextStepName`. On judge failure, unknown label, or `maxRuns` cap (default 5): the single `default: true` outcome fires. Every run appends one entry to `OrchestratorState.checkRuns`, persisted to `RunManifest.checkRuns` — that slice feeds the judge cards in TUI and web; if you add state, wire it into both.

### AutoScaler (`auto-scaler.ts`) — default ON

- Target concurrency = memory headroom ÷ observed per-agent footprint.
  - headroom = available RAM − margin, margin = max(total × safetyMarginPercent, 512 MiB) (`auto-scaler.ts:43,146`).
  - footprint = EMA, α = 0.2, seeded 250 MiB, clamped [128, 2048] MiB (`auto-scaler.ts:32,41,15-17`). The EMA sample is (used − baseline) / activeAgents.
- `--concurrency=N` or `--no-auto-scale` pins `manual` mode. The MEMORY GUARD runs in BOTH modes.

### Memory guard & requeue — the load-bearing invariant

At ≥95% RAM/CPU the guard kills the NEWEST agent (picked by `startedAt` — least work lost), resets its card to `pending` with a `requeues` counter (TODO column, `↻N` badge), and requeues the task at the FRONT of the queue.

The marker for "this failure was a guard kill, not a real error" is the consumable Set `killedAgentIds` in `orchestrator/index.ts:231` — `.add()` at kill time (`:414`), `.delete()` when the rejection is processed (`:1187`). It is deliberately NOT a status flag on the task: the agent's promise may reject long after the kill, and a lingering flag would misclassify a later, genuine error of the requeued attempt. `requeue.test.ts` pins this race — keep it green and don't "simplify" the Set into a boolean.

### Other invariants

- State persistence: `RunManifest` is written incrementally during the run (status: preflight → running → integrating → done/error); UI surfaces read coalesced snapshots, so never mutate state objects in place — emit new ones.
- Per-agent ports come from `port-allocator.ts` before launch (see isolating-agent-ports).
- Backends are resolved once via `backends/registry.ts` (see integrating-llm-backends).

## References

- `src/orchestrator/index.ts`, `src/orchestrator/auto-scaler.ts`, `src/orchestrator/requeue.test.ts` (the race spec)
- Related skills: orchestrating-git-worktrees, isolating-agent-ports, writing-tests

> Facts verified against source on 2026-06-12 (line refs included above).
