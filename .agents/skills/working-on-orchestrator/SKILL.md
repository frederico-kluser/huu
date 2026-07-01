---
name: working-on-orchestrator
description: Explains huu's run lifecycle and its invariants — stage loop, task decomposition, worker pool, AutoScaler memory math, the memory-guard kill/requeue path with its consumable killedAgentIds Set, the interactive-retry hold (awaiting_retry + retryTask/finish), CheckStep judge execution (reserved agentId 9998) and checkRuns kanban state. Use when changing anything in src/orchestrator/ — scheduling, concurrency, requeue, retry, check execution, run state — or when debugging why agents are killed, requeued or misrouted.
metadata:
  version: 0.6.0
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
- Routing: verdict label → matching `outcomes[].nextStepName`. On judge failure, unknown label, or `maxRuns` cap (default 5): the single `default: true` outcome fires. Every run appends one entry to `OrchestratorState.checkRuns`, persisted to `RunManifest.checkRuns` — that slice feeds the judge cards in the TUI; if you add state, wire it into that snapshot.

### AutoScaler (`auto-scaler.ts`) — default ON

- Target concurrency = **RAM BUDGET** ÷ observed per-agent footprint (the budget is the admission invariant — replaced the old `available − margin` headroom).
  - budget = `ramBudgetBytes(ramTotalBytes, budgetPercent)` (`lib/budget.ts`: % of TOTAL, floored at `total − 512 MiB` for the OS); admittable = `budget − ramUsedBytes`; additional = `floor(admittable / observedAgentBytes)` — `auto-scaler.ts` private `budgetAdditional()` (used by both `targetConcurrency()` and `headroomCapacity()`). The dial `budgetPercent` is MACHINE-GLOBAL (`HUU_RAM_PERCENT` / `--ram-percent` / web Setting; default 85, clamp 10–95; `OrchestratorOptions.budgetPercent` single-run, `GlobalScheduler.setBudgetPercent()` multi-run; one shared budget AutoScaler).
  - footprint = EMA, α = 0.2, seeded **PESSIMISTIC 1536 MiB** (`DEFAULT_AGENT_MEMORY_ESTIMATE_MB`; was 250 — the over-admission that OOM-killed the process), clamped [128, 2048] MiB. Sample = (used − baseline) / activeAgents → corrects DOWN, so a cold start under-admits then opens up.
  - **PSI front brake**: `shouldSpawn()` freezes admission (auto + greedy, NOT manual) when `SystemMetrics.memPressureSome10 ≥ admitPsiThreshold` (0.5%) — pressure rises BEFORE RAM%. PSI = `some avg10` from cgroup `memory.pressure` → `/proc/pressure/memory` (pure `parseMemoryPressureSome10` in `resource-monitor.ts`); `null` (macOS / no CONFIG_PSI) ⇒ falls back to the RAM `stopThreshold` gate (degrade-never-block).
  - **Fast-ramp**: `executeTaskPool` caps NEW spawns/tick to `max(1, ceil(busy·0.5))` (`ramping = scheduler!=null || mode!=='manual'`) — geometric, no single-tick burst.
  - `shouldDestroy()` stays RAM/CPU ≥ 95% (PSI-destroy is Fase 2). Process-level `oom_score_adj` is set best-effort at boot (`lib/oom-score.ts`, `HUU_OOM_SCORE_ADJ`, conservative default).
- `--concurrency=N` or `--no-auto-scale` pins `manual` mode. The MEMORY GUARD runs in EVERY mode.
- Third mode `greedy` (UI label **MAX**, `M` hotkey): `targetConcurrency()` early-returns `min(active+pending, maxAgents)` — one agent per queued task — and the guard is the sole backstop, so concurrency settles at the destroy threshold. Two non-obvious wiring spots beyond the AutoScaler: `enableGreedyMode()` MUST raise the port cap (`portAllocator.setMaxAgents(AUTO_SCALE_MAX_INSTANCES)`) like `enableAutoScale()`, and the per-tick recompute in `executeTaskPool` must gate on `getMode() === 'auto' || 'greedy'` — miss either and concurrency silently freezes at its seed/manual window. `AutoScaleStatus.enabled` is `enabled && mode === 'auto'` ("auto is DRIVING the target", NOT "scaler on") — branch UI/logic on `mode`, not `enabled`, now that a third mode exists.

### Memory guard & requeue — the load-bearing invariant

At ≥95% RAM/CPU the guard kills the NEWEST agent (picked by `startedAt` — least work lost), resets its card to `pending` with a `requeues` counter (TODO column, `↻N` badge), and requeues the task at the FRONT of the queue.

The marker for "this failure was a guard kill, not a real error" is the consumable Set `killedAgentIds` in `orchestrator/index.ts:231` — `.add()` at kill time (`:414`), `.delete()` when the rejection is processed (`:1187`). It is deliberately NOT a status flag on the task: the agent's promise may reject long after the kill, and a lingering flag would misclassify a later, genuine error of the requeued attempt. `requeue.test.ts` pins this race — keep it green and don't "simplify" the Set into a boolean.

### Interactive retry (`awaiting_retry`) — USER-triggered, holds the run open

The integration worktree is torn down in `start()`'s `finally`, so a retry that must MERGE its result has to run while the run is alive. Mechanism: a new `OrchestratorState.status` value `awaiting_retry`, gated by `OrchestratorOptions.interactiveRetry` (default false → headless/`run-many`/smoke/sim/tests are byte-identical; `start()` resolves immediately). After the step-walk loop and BEFORE the terminal status logic, if `interactiveRetry && !aborted && status!=='error' && hasFailedCards()`, set `awaiting_retry`, emit, and `await new Promise(r => this.finishResolve = r)` — INSIDE the try, so teardown only runs after the gate resolves. `finish()` (idempotent; bails while `retryingIds.size>0` so teardown can't race a merge) and `abort()` both resolve the gate.

`retryTask(agentId, {timeoutMs?})` reuses ALL existing machinery: reconstruct the task from a `tasksById` map (the CARD lacks `files[]`/`hint` — populate the map at the TOP of `spawnAndRun`, the single choke point every task passes through), reset the card to `pending` (clear error/`errorKind`, bump `AgentStatus.manualRetries`, kanban `⟳N`), `executeTaskPool([task])` (re-runs off `stageBaseRef` = current integration HEAD, with per-attempt auto-retry), then on `state==='done' && commitSha` push a synthetic StageIntegration card (`visitIndex = RETRY_MERGE_VISIT_BASE` 1e6 + seq, never collides with walk visitIndexes ≤ `maxNodeExecutions`) and `runStageIntegration([task], visitIndex)` to merge just that branch, advancing `stageBaseRef` so retries stack. A timed-out card retries with a longer per-task timeout via a `retryTimeoutOverrides` `Map<agentId,ms>` consumed in spawnAndRun (`override ?? computeCardTimeoutMs(...)`). THREE traps: (1) flip `status` OUT of `awaiting_retry` (→ `running`) BEFORE the reset-emit, else a subscriber keyed on `awaiting_retry` sees the card already cleared and prematurely finishes mid-retry; (2) DECREMENT `completedTasks` before re-running (the failure already counted it; the re-run re-counts once → net zero); (3) make `appendManifestEntry` REPLACE an existing same-agentId entry (a retry reuses the id → else a duplicate). `errorKind` (`'timeout'|'failed'`) was ALREADY set on final-fail — only the UI/retry surface was new. Pinned by `retry-task.test.ts`.

### Multi-run scheduling (`global-scheduler.ts`) — subordinate mode

A `GlobalScheduler` runs N runs in ONE process under a single shared budget. It owns the ONLY machine read (one `SystemMetricsSampler` + one budget `AutoScaler`); per-run AutoScalers go dormant. An `Orchestrator` turns subordinate via `OrchestratorOptions.scheduler`:

- `executeTaskPool` reads `scheduler.grantFor(runId)` instead of its own `targetConcurrency()`, and the in-pool memory guard is OFF (the scheduler owns kills). When `scheduler` is ABSENT every path is the legacy single-run path — keep it byte-identical; that is the whole de-globalization contract.
- Concurrency is the pure `distributeBudget(demands, B)`: top-down by registration order (= priority). Backfill, cascade, strict priority and auto-yield all fall out of it. `B` is demand-capped, so the admission signal is `headroomCapacity − demand` (`GlobalScheduler.remaining`), NOT `B − Σgrants` (≈0 always).
- Cross-run kill: `selectGlobalVictim()` picks the LOWEST-priority run's newest agent and calls that run's existing `destroyAgent` (so `killedAgentIds`/requeue are reused unchanged). Invariant — never kill a higher-priority agent while a lower-priority run has a live one — pinned by `multi-run-priority.test.ts`. Routine reclaim is DRAIN (grant < busy → the pool stops spawning); kill only under RAM pressure.
- `src/lib/run-many.ts` is the headless driver (lazy, monotonic admission; it always `scheduler.start()`s — idempotent — because an unstarted budget silently disables BOTH the RAM spawn-gate and the OOM guard). Supporting wiring: `SystemMetricsSampler` class in `resource-monitor.ts` (two samplers no longer corrupt the CPU delta); the Orchestrator logs through `this.dlog = scopedDebugLog(runId)` (so concurrent runs' lines carry a runId); the scheduler tick pushes its single metrics read into each run's dormant scaler (`driver.acceptMetrics`, else per-run RAM%/CPU% and the guard-kill log freeze at run-start); `sharedReservedPorts` + claim-before-probe in `port-allocator.ts` (+ a `releaseAll()` backstop in the run's finally for the now-shared, long-lived set); and `repo-lock.ts` wired via `new WorktreeManager(..., serializeGitOps = this.scheduler != null)` — serializes worktree-add/branch/remove per repo so two SAME-repo runs don't race on `.git` admin names/locks, but NOT merges (long, distinct runId refs). Browser project selector (shown when >1 run) still pending — see building-web-ui.

### Other invariants

- State persistence: `RunManifest` is written incrementally during the run (status: preflight → running → integrating → done/error); UI surfaces read coalesced snapshots, so never mutate state objects in place — emit new ones.
- Per-agent ports come from `port-allocator.ts` before launch (see isolating-agent-ports).
- Backends are resolved once via `backends/registry.ts` (see integrating-llm-backends).

### Synthetic simulation driver (`simulation/`)

`src/orchestrator/simulation/` (`SimulationEngine`) is a no-side-effect stand-in for the Orchestrator, used by the web `/simulation` demo: it emits the SAME `OrchestratorState` snapshots + `agent-stream` firehose through the SAME `subscribe` / `subscribeAgentOutput` / `start` contract, but with NO worktrees, LLM, key or filesystem writes. Consequence for orchestrator changes: if you ADD a field to `OrchestratorState`, change how cards/columns are derived, or touch `checkRuns`/`stageIntegrations`/`requeues`/`actionCounts`, mirror it in the engine (and `engine.test.ts`) or the demo silently diverges from real runs. Progression is a logical-tick state machine (public `advance()`, driven by `start()`'s `setInterval`) seeded by a mulberry32 PRNG — deterministic and timer-free in tests; it lives under `orchestrator/` but depends only on `lib/` types (never on git/ui/web).

## References

- `src/orchestrator/index.ts`, `src/orchestrator/auto-scaler.ts`, `src/orchestrator/requeue.test.ts` (the race spec)
- Related skills: orchestrating-git-worktrees, isolating-agent-ports, writing-tests

> Facts verified against source on 2026-06-12 (line refs included above); greedy/MAX auto-scaling mode verified against source on 2026-06-25; `simulation/` SimulationEngine demo driver added 2026-06-26; multi-run `GlobalScheduler` + subordinate mode added 2026-06-26; interactive-retry hold (`awaiting_retry`/`retryTask`/`finish`, `interactiveRetry` option) added + promoted from `[task:timeout-error-retry]` 2026-06-29; **RAM-budget % dial + PSI front-brake + pessimistic 1536 MiB seed + fast-ramp** (resource-control Fase 1) added + promoted from `[task:fase1-ram-budget-psi-admission]` 2026-06-30 (remaining Fases 2/3 in repo-root `ROADMAP.md`).
