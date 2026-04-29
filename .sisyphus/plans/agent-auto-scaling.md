# Agent Auto-Scaling

## TL;DR

> **Quick Summary**: Add a resource-aware auto-scaling mode to the huu orchestrator that dynamically adjusts agent concurrency based on CPU/RAM thresholds — creates agents aggressively when tasks are queued, stops at 90% resource usage, destroys the newest agent at 95%, with 30s cooldown and 5s destruction re-evaluation. Activated via `--auto-scale` CLI flag + `A` TUI toggle.

> **Deliverables**:
> - `src/lib/resource-monitor.ts` — container-aware CPU/RAM reading with cgroup fallbacks
> - `src/orchestrator/auto-scaler.ts` — threshold state machine with cooldown
> - `src/orchestrator/auto-scaler.test.ts` — TDD test suite
> - Extended `src/lib/types.ts` + `src/orchestrator/types.ts` — new fields for auto-scale
> - Modified `src/orchestrator/index.ts` — `destroyAgent()`, auto-scaler hooks
> - Modified `src/cli.tsx` — `--auto-scale` flag propagation
> - Modified `src/ui/components/RunDashboard.tsx` — `A` key toggle + status display

> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Resource monitor → Auto-scaler → Orchestrator integration → CLI/TUI

---

## Context

### Original Request
Auto-scaling mode for agent execution where:
- `maxConcurrency` is ignored when auto-scaling mode is activated
- If tasks are queued, more agents are created to handle them (1 per pending task)
- CPU or RAM > 90% → stop creating new agents
- CPU or RAM > 95% → destroy newest agent + worktree, re-queue its task
- Re-evaluate every 5 seconds if RAM doesn't improve after regression
- Initial kickstart: `Math.floor(availableRAM / 250MB per agent)`
- 30-second cooldown after destruction before allowing new scale-up
- No auto-scale-down when idle
- No maximum agent limit (resource-bound only)
- Manual activation via CLI flag + TUI toggle

### Interview Summary
**Key Discussions**:
- **Activation**: `--auto-scale` CLI flag enables by default, `A` key in TUI toggles at runtime. NOT stored in pipeline JSON.
- **Scale-up**: Aggressive — 1 agent per pending task immediately, not waiting for cycle
- **Threshold logic**: OR logic — either CPU or RAM hitting 90% triggers stop, either hitting 95% triggers destruction
- **Destruction**: Re-queue task, dispose session, remove worktree, delete branch, release ports
- **Memory source**: Container limit via `process.constrainedMemory()` + cgroup file fallback → host `os.totalmem()`
- **CPU source**: Average across all cores via `os.cpus()` delta
- **Test strategy**: TDD with vitest (same framework as existing 102 test assertions)
- **Cooldown**: 30 seconds after destruction, cooldown resets on each new destruction
- **Manual override**: Pressing `+`/`-` while auto-scale is active DISABLES auto-scale and locks concurrency to the manual value
- **No scale-down when idle**: Agents persist until pipeline completion
- **Re-evaluation**: Every 5 seconds after destruction. If RAM still ≥ 95%, destroy next agent. Repeat until improvement.

### Metis Review
**Identified Gaps** (addressed):
- **MAX_INSTANCES/PortAllocator cap conflict**: When auto-scale is active, `MAX_INSTANCES` no longer constrains `instanceCount`. `PortAllocator.maxAgents` raised to 200 to match.
- **Fire-and-forget retry races**: Added `killedByAutoScaler` flag to `AgentStatus`. When set, `spawnAndRun()` catch block skips retry — auto-scaler handles re-queueing.
- **No `spawnedAt` timestamp**: Added `createdAt` to `AgentStatus` to identify "newest agent" unambiguously (agent IDs can repeat with retries).
- **No queue depth in state**: Added `pendingTaskCount` and `activeAgentCount` to `OrchestratorState`.
- **Container RAM metrics**: Full cgroup v2/v1 fallback chain implemented in resource monitor.
- **Pool loop preservation**: `executeTaskPool()` structure unchanged — only `poolWakeup()` integration added.
- **Manual +/- override**: Pressing `+`/`-` during auto-scale disables auto-scale entirely and locks concurrency. Must re-enable via `A` key.

---

## Work Objectives

### Core Objective
Enable resource-bound dynamic agent concurrency that maximizes throughput under available CPU/RAM, with automatic backpressure at 90% usage and defensive agent destruction at 95% usage.

### Concrete Deliverables
- `src/lib/resource-monitor.ts` — synchronous metrics provider with cgroup-aware fallback chain
- `src/orchestrator/auto-scaler.ts` — reactive scaling controller with 5 states (NORMAL, SCALING_UP, SCALING_DOWN, BACKING_OFF, COOLDOWN)
- `src/orchestrator/auto-scaler.test.ts` — TDD test suite covering all threshold transitions
- Extended type definitions in `src/lib/types.ts` and `src/orchestrator/types.ts`
- Orchestrator modifications: `destroyAgent()`, auto-scaler lifecycle integration
- CLI flag `--auto-scale` propagation from `cli.tsx` through `App` to `Orchestrator`
- TUI `A` key toggle + auto-scale status bar in `RunDashboard`

### Definition of Done
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test` (vitest) passes with all auto-scaler tests green
- [ ] `huu --stub --auto-scale run example.pipeline.json` completes without crash
- [ ] Auto-scaler stops spawning at 90% simulated CPU/RAM
- [ ] Auto-scaler destroys newest agent at 95% simulated CPU/RAM
- [ ] Destroyed agent's task is re-queued and eventually completed
- [ ] Cooldown timer prevents re-scale-up for 30s after destruction
- [ ] Manual `+`/`-` disables auto-scale and locks concurrency
- [ ] `A` key toggles auto-scale on/off mid-run
- [ ] TUI shows auto-scale status, resource %, and cooldown remaining

### Must Have
- Resource monitor with cgroup-aware container memory reading
- Auto-scaler state machine (NORMAL/SCALING_UP/BACKING_OFF/COOLDOWN)
- 90% stop threshold (OR logic for CPU or RAM)
- 95% destroy threshold (OR logic)
- Full agent cleanup on forced destruction (dispose, worktree, branch, ports)
- Task re-queue on agent destruction
- 5-second re-evaluation after destruction
- 30-second cooldown after any destruction
- Kickstart calculation: `Math.floor(availableRAM / 250MB)`
- CLI flag `--auto-scale` + TUI `A` key toggle
- Agent `createdAt` timestamp for "newest agent" identification

### Must NOT Have (Guardrails)
- **Do NOT modify the poll loop structure** in `executeTaskPool()` beyond `poolWakeup()` integration
- **Do NOT refactor `spawnAndRun()`** — only add `killedByAutoScaler` flag check
- **Do NOT change Docker wrapper** (`docker-reexec.ts`) — no `--memory`/`--cpus` flags
- **Do NOT replace `useSystemMetrics.ts`** — keep it as a React wrapper around the new `resource-monitor.ts`
- **Do NOT modify existing `+`/`-` key handlers** — add override logic, don't remove them
- **Do NOT add predictive/proactive scaling** — pure threshold reaction only
- **Do NOT add integration-stage scaling** — auto-scaler monitors within-stage agents only
- **Do NOT persist auto-scale preference** — no config file, env var, or pipeline JSON storage
- **Do NOT add network/disk monitoring**
- **Do NOT modify pipeline JSON schema** — auto-scaling is runtime-only

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES — vitest, 102 test assertions across 4 orchestrator test files
- **Automated tests**: TDD — tests written before implementation (RED → GREEN → REFACTOR)
- **Framework**: vitest (existing project standard)
- **TDD workflow**: Each task begins with failing tests, then minimal implementation to pass

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **API/Backend**: Use Bash (curl/bun/node REPL) — verify orchestrator state, resource metrics
- **CLI**: Use Bash — verify `--auto-scale` flag, `--stub` compatibility
- **TUI**: Use tmux via interactive_bash — verify key presses, status display

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation + types + tests RED):
├── Task 1: Type extensions + state exposure [quick]
├── Task 2: Resource monitor module (TDD: RED first) [quick]
├── Task 3: Orchestrator queue metrics in OrchestratorState [quick]

Wave 2 (After Wave 1 — core scaling logic, MAX PARALLEL):
├── Task 4: Auto-scaler module + tests (TDD) [deep]
├── Task 5: Orchestrator destroyAgent() + killedByAutoScaler handling [deep]
├── Task 6: Auto-scaler hook into executeTaskPool + lifecycle [unspecified-high]
├── Task 7: PortAllocator dynamic maxAgents + MAX_INSTANCES decoupling [quick]

Wave 3 (After Wave 2 — CLI + TUI integration):
├── Task 8: CLI flag --auto-scale propagation [quick]
├── Task 9: TUI A-key toggle + auto-scale status display [visual-engineering]
├── Task 10: Manual +/- override disables auto-scale [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

---

## TODOs

- [ ] 1. **Type extensions + state exposure**

  **What to do**:
  - Add `createdAt?: number` (epoch ms) to `AgentStatus` in `src/lib/types.ts:157-180` — timestamp set when agent first spawns (not on retry), used to identify "newest agent" for destruction
  - Add `killedByAutoScaler?: boolean` to `AgentStatus` — flag set by auto-scaler BEFORE disposing agent, checked by `spawnAndRun()` catch block to skip retry and let auto-scaler handle re-queueing
  - Add `pendingTaskCount: number` to `OrchestratorState` in `src/lib/types.ts:184-198` — current `pendingTasks.length`, for TUI display
  - Add `activeAgentCount: number` to `OrchestratorState` — current `activeAgents.size`, for TUI display
  - Add `autoScale?: AutoScaleStatus` to `OrchestratorState` — new interface: `{ enabled: boolean; state: 'NORMAL' | 'SCALING_UP' | 'BACKING_OFF' | 'COOLDOWN'; cooldownRemainingMs: number; cpuPercent: number; ramPercent: number }`
  - Add `initialConcurrency` to `OrchestratorOptions` (already exists at line 90, verify it's functional if never passed — default fallback is `DEFAULT_CONCURRENCY=10`)
  - Populate `pendingTaskCount` and `activeAgentCount` in `Orchestrator.getState()` at `src/orchestrator/index.ts:182-198`
  - Set `createdAt` in `initialAgentStatus()` at `src/orchestrator/index.ts:970-989` using `Date.now()`
  - Write vitest tests for: type validations, state defaults, createdAt set on initialization

  **Must NOT do**:
  - Do NOT modify pipeline JSON schema (no `autoScaling` field in Pipeline type)
  - Do NOT change existing field types or nullability
  
  **Dependency Note**: The `AutoScaleStatus` interface definition should be provisional — finalize in Task 4

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Type definitions and state plumbing — mechanical, low complexity
  - **Skills**: [`architecture-conventions`]
    - `architecture-conventions`: Must follow layered architecture import rules when extending types in `lib/` referenced from `orchestrator/`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5, 6, 9
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/lib/types.ts:157-180` — AgentStatus interface definition (extend with new fields)
  - `src/lib/types.ts:184-198` — OrchestratorState interface (add pendingTaskCount, activeAgentCount, autoScale)
  - `src/orchestrator/index.ts:182-198` — getState() method (populate new fields)
  - `src/orchestrator/index.ts:970-989` — initialAgentStatus() (set createdAt)
  - `src/orchestrator/index.ts:89-113` — OrchestratorOptions interface (verify initialConcurrency)

  **Acceptance Criteria**:
  - [ ] `import { OrchestratorState } from '../lib/types.js'` includes `pendingTaskCount: number`, `activeAgentCount: number`, `autoScale?: AutoScaleStatus`
  - [ ] `import { AgentStatus } from '../lib/types.js'` includes `createdAt?: number`, `killedByAutoScaler?: boolean`
  - [ ] vitest: `new Orchestrator(...).getState().pendingTaskCount === 0`
  - [ ] vitest: `initialAgentStatus(task).createdAt` is non-null number (Date.now())

  **QA Scenarios**:

  ```
  Scenario: Type extensions compile and have correct defaults
    Tool: Bash (bun REPL)
    Preconditions: TypeScript compilation enabled
    Steps:
      1. Run: npm run typecheck
      2. Assert: exit code 0, no errors
    Expected Result: TypeScript compilation passes with no errors related to new types
    Failure Indicators: Type errors mentioning AutoScaleStatus, pendingTaskCount, activeAgentCount, createdAt, killedByAutoScaler
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: Orchestrator state includes new metrics after pre-decomposition
    Tool: Bash (node REPL)
    Preconditions: Fresh orchestrator instance after pre-decomposition (stage loop not started)
    Steps:
      1. Create orchestrator with 3-task pipeline
      2. Call orchestrator.getState()
      3. Assert: state.pendingTaskCount === 3 (or total tasks across stages)
      4. Assert: state.activeAgentCount === 0 (before pool started)
      5. Assert: state.autoScale === undefined
    Expected Result: pendingTaskCount reflects pre-decomposed tasks, activeAgentCount is 0 before pool runs
    Evidence: .sisyphus/evidence/task-1-state-exposure.txt

  Scenario: createdAt is set when agent status is initialized
    Tool: Bash (node REPL)
    Preconditions: Orchestrator with pre-decomposed tasks
    Steps:
      1. Call orchestrator.getState()
      2. For each agent in state.agents: assert agent.createdAt is a positive number
      3. Assert agent.createdAt is within last 10 seconds (just initialized)
    Expected Result: Every agent's createdAt is a recent timestamp
    Evidence: .sisyphus/evidence/task-1-created-at.txt
  ```

  **Commit**: YES (groups with Task 2, 3 or separate)
  - Message: `feat(types): add auto-scale state fields and agent tracking fields`
  - Files: `src/lib/types.ts`, `src/orchestrator/index.ts` (getState + initialAgentStatus)
  - Pre-commit: `npm run typecheck`

- [ ] 2. **Resource monitor module (TDD: RED first)**

  **What to do**:
  - Create `src/lib/resource-monitor.ts` with `getSystemMetrics(): SystemMetrics` (synchronous, no async needed for Node.js os module + fs sync reads)
  - `SystemMetrics` interface (same shape as existing `useSystemMetrics.ts:7-14` but with additions):
    - `cpuPercent: number` — average across all cores via `os.cpus()` delta (keep existing logic)
    - `ramPercent: number` — container-aware: `process.constrainedMemory()` if valid, else cgroup file read, else host `os.totalmem()`. Divide by current usage: `(os.totalmem() - os.freemem())` relative to detected limit
    - `ramUsedBytes: number` — current usage
    - `ramTotalBytes: number` — detected limit (container or host)
    - `processRssBytes: number` — `process.memoryUsage().rss`
    - `loadAvg1: number` — `os.loadavg()[0]`
    - `containerAware: boolean` — true if reading from cgroup, false if host fallback
  - Container memory detection (cgroup-aware fallback chain):
    1. `process.constrainedMemory()` — if > 0 and < Number.MAX_SAFE_INTEGER, use it
    2. cgroup v2: read `/sys/fs/cgroup/memory.max` (if not "max") and `/sys/fs/cgroup/memory.current`
    3. cgroup v1: read `/sys/fs/cgroup/memory/memory.limit_in_bytes` and `memory.usage_in_bytes`
    4. Host fallback: `os.totalmem()` and `os.totalmem() - os.freemem()`
  - Keep existing `useSystemMetrics.ts` as a React wrapper that calls `getSystemMetrics()` on interval — do NOT break the SystemMetricsBar
  - Write vitest tests FIRST (RED):
    - Mock `os.totalmem()`, `os.freemem()`, `process.constrainedMemory()`, `process.memoryUsage()`
    - Test container limit detection: mock `process.constrainedMemory()` returns 8GB → ramPercent = usage/8GB
    - Test cgroup v2 fallback: mock constrainedMemory returns MAX_SAFE_INTEGER, mock `/sys/fs/cgroup/memory.max` contains "8589934592"
    - Test host fallback: mock all container paths to fail, use os.totalmem()
    - Test CPU delta calculation: two consecutive reads with known deltas
    - Test edge: constrainedMemory returns 0 (container without limit set) → host fallback
    - Test edge: constrainedMemory returns MAX_SAFE_INTEGER (sentinel value) → cgroup fallback

  **Must NOT do**:
  - Do NOT import React or Ink in `resource-monitor.ts`
  - Do NOT use async I/O for metric reading (keep synchronous for clean orchestrator integration)
  - Do NOT break `useSystemMetrics.ts` or `SystemMetricsBar.tsx`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Self-contained module with clear spec and external research — straightforward implementation
  - **Skills**: [`docker-runtime`]
    - `docker-runtime`: Must understand container cgroup filesystem paths and how `process.constrainedMemory()` behaves inside Docker

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 4, Task 6
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/ui/hooks/useSystemMetrics.ts:1-84` — existing resource monitoring pattern (CPU delta, interval) — extract logic, keep React wrapper
  - `src/ui/components/SystemMetricsBar.tsx:1-56` — consumer of SystemMetrics — must continue working unmodified
  - External: `process.constrainedMemory()` API (Node.js 19.6+) — returns container memory limit or uint64_max sentinel
  - External: cgroup v2 `/sys/fs/cgroup/memory.max` and `/sys/fs/cgroup/memory.current` — container memory files
  - External: cgroup v1 `/sys/fs/cgroup/memory/memory.limit_in_bytes` — legacy container memory file
  - `n8n` reference implementation: `process.constrainedMemory() > 0 && < MAX_SAFE_INTEGER` sanity check (from research findings)

  **Acceptance Criteria**:
  - [ ] `import { getSystemMetrics } from '../lib/resource-monitor.js'` works in Node REPL
  - [ ] vitest: mocked `process.constrainedMemory()` returns 8589934592 (8GB) → `ramPercent` calculated correctly against 8GB
  - [ ] vitest: mocked `process.constrainedMemory()` returns MAX_SAFE_INTEGER → falls back to cgroup v2 path
  - [ ] vitest: all container paths fail → falls back to host `os.totalmem()`
  - [ ] vitest: `cpuPercent` between 0 and 100 inclusive
  - [ ] vitest: `ramPercent` between 0 and 100 inclusive
  - [ ] vitest: `containerAware: true` when reading from cgroup, `false` when using host fallback
  - [ ] Existing vitest suite still passes: `npm test` no regressions

  **QA Scenarios**:
  ```
  Scenario: Resource monitor returns valid metrics range
    Tool: Bash (node REPL)
    Preconditions: Running inside Docker or native (any environment)
    Steps:
      1. Run: node -e "const { getSystemMetrics } = require('./dist/lib/resource-monitor.js'); const m = getSystemMetrics(); console.log(JSON.stringify(m));"
      2. Assert: m.cpuPercent is a number between 0 and 100
      3. Assert: m.ramPercent is a number between 0 and 100
      4. Assert: m.ramTotalBytes > 0
      5. Assert: m.containerAware is boolean
    Expected Result: All metrics within expected ranges, containerAware is true in Docker and false on native
    Failure Indicators: cpuPercent outside [0, 100], ramPercent NaN, ramTotalBytes <= 0
    Evidence: .sisyphus/evidence/task-2-metrics-valid.txt

  Scenario: useSystemMetrics hook still works after extraction
    Tool: Bash
    Preconditions: Build complete
    Steps:
      1. Run: npm test -- src/ui/
      2. Assert: no test failures related to SystemMetricsBar or useSystemMetrics
    Expected Result: Existing UI tests pass unchanged
    Failure Indicators: Test failure, import error for getSystemMetrics, missing exports
    Evidence: .sisyphus/evidence/task-2-ui-compat.txt

  Scenario: Container-aware fallback chain works in Docker
    Tool: Bash
    Preconditions: Running via Docker (default huu mode)
    Steps:
      1. Run: huu --stub --auto-scale run example.pipeline.json & (or just build and check metrics)
      2. Or: Run: node -e "const { getSystemMetrics } = require('./dist/lib/resource-monitor.js'); console.log(getSystemMetrics().containerAware);"
      3. Assert: containerAware is true inside Docker
    Expected Result: Container limit detected correctly
    Evidence: .sisyphus/evidence/task-2-docker-aware.txt
  ```

  **Commit**: YES (groups with Task 3)
  - Message: `feat(lib): add container-aware resource monitor with cgroup fallbacks`
  - Files: `src/lib/resource-monitor.ts`, `src/lib/resource-monitor.test.ts`, `src/ui/hooks/useSystemMetrics.ts` (refactor to use new module)
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 3. **Orchestrator queue metrics in OrchestratorState**

  **What to do**:
  - In `src/orchestrator/index.ts`, `getState()` method (line 182-198): populate the new `pendingTaskCount` and `activeAgentCount` fields
  - `pendingTaskCount` = `this.pendingTasks.length`
  - `activeAgentCount` = `this.activeAgents.size`
  - Add a new private method or inline logic to expose queue depth — this is needed for the TUI (Task 9) to show "Queue: N / Active: M"
  - Write vitest tests:
    - Test that `getState().pendingTaskCount` reflects the number of undequeued tasks after `executeTaskPool` starts
    - Test that `getState().activeAgentCount` reflects spawned agents
    - Test that both are 0 before pool starts and reset between stages

  **Must NOT do**:
  - Do NOT modify `executeTaskPool()` loop logic — just add metric population
  - Do NOT add new class fields for these — derive from existing `pendingTasks` and `activeAgents`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two-line change + tests — trivial plumbing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 9
  - **Blocked By**: Task 1 (for type definitions)

  **References**:
  - `src/orchestrator/index.ts:182-198` — getState() method to modify
  - `src/orchestrator/index.ts:127` — `pendingTasks: AgentTask[]` field
  - `src/orchestrator/index.ts:124` — `activeAgents: Map<number, SpawnedAgent>` field
  - `src/orchestrator/orchestrator.test.ts:1-60` — existing test patterns and factory setup

  **Acceptance Criteria**:
  - [ ] `getState().pendingTaskCount` returns `this.pendingTasks.length`
  - [ ] `getState().activeAgentCount` returns `this.activeAgents.size`
  - [ ] vitest: both fields increment/decrement correctly during pool execution

  **QA Scenarios**:

  ```
  Scenario: Queue metrics reflect actual pool state
    Tool: vitest
    Preconditions: Orchestrator with multi-task pipeline, stub factory
    Steps:
      1. Create orchestrator with 5 tasks in stage
      2. Subscribe to state changes
      3. Start orchestrator (non-awaited)
      4. Assert: after first emission, pendingTaskCount + activeAgentCount <= expected (tasks not all spawned instantly)
      5. Wait for all tasks complete
      6. Assert: final state has pendingTaskCount === 0, all completedTasks === totalTasks
    Expected Result: Metrics accurately track queue and active agents throughout execution
    Failure Indicators: pendingTaskCount negative, activeAgentCount > instanceCount
    Evidence: .sisyphus/evidence/task-3-queue-metrics.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(orch): expose pendingTaskCount and activeAgentCount in orchestrator state`
  - Files: `src/orchestrator/index.ts`
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 4. **Auto-scaler module + TDD tests**

  **What to do**:
  - Create `src/orchestrator/auto-scaler.ts` — a class `AutoScaler` with the following API:
    - `constructor(config: AutoScalerConfig)` — config includes: `resourceMonitor: () => SystemMetrics`, `agentMemoryEstimateMb: number` (default 250), `stopThresholdPercent: number` (default 90), `destroyThresholdPercent: number` (default 95), `cooldownMs: number` (default 30000), `reEvaluationMs: number` (default 5000), `maxAgents: number` (from PortAllocator capacity)
    - `start(): void` — begins monitoring loop (setInterval at 1s for metrics, separate decision cycle)
    - `stop(): void` — clears intervals, resets state
    - `getStatus(): AutoScaleStatus` — returns current state, cooldown remaining, resource percentages
    - `notifyTaskQueued(pendingCount: number): void` — called when tasks are added to queue, triggers immediate scale-up check
    - `notifyAgentDestroyed(): void` — called after forced destruction, starts cooldown
    - `notifyAgentCompleted(): void` — called when agent finishes (for tracking active count)
    - `shouldSpawn(): boolean` — called by pool loop before spawning; returns false when in BACKING_OFF/COOLDOWN or resources exceed threshold
    - `shouldDestroy(): boolean` — called every 5s; returns true when resources exceed 95%
    - `targetConcurrency(): number` — returns target concurrency based on pending tasks and resource headroom
  - **State machine** (private internal state):
    - `NORMAL`: resources ≤ 90%, cooldown inactive → full scale-up allowed
    - `SCALING_UP`: actively increasing agents (transitional, during pool wakeup)
    - `BACKING_OFF`: resources > 90% → stop spawning new agents, let running ones finish
    - `COOLDOWN`: after agent destruction → 30s cooldown, resource recovery monitoring
    - `DESTROYING`: resources > 95% → destroying agents, re-evaluating every 5s
  - **Kickstart calculation**: `targetConcurrency()` on initial call = `Math.floor(getSystemMetrics().ramTotalBytes / (agentMemoryEstimateMb * 1024 * 1024))`, clamped to `[1, pendingTasks.length]` and `[1, maxAgents]`
  - **Scale-up logic in `shouldSpawn()`**: Returns false if `cpuPercent >= 90 OR ramPercent >= 90` (BACKING_OFF state). Returns false if in COOLDOWN state (within 30s of last destruction). Otherwise returns true.
  - **Destroy logic in `shouldDestroy()`**: Returns true if `cpuPercent >= 95 OR ramPercent >= 95` AND there are active agents. Enters DESTROYING state. After returning true and agent is destroyed (`notifyAgentDestroyed()`), enters COOLDOWN state. After 5s re-evaluation (`reEvaluationMs`), if resources still ≥ 95%, exits COOLDOWN early (reset cooldown timer) and returns true again. If resources drop below 90%, transitions to NORMAL.
  - **Cooldown timer**: Started on `notifyAgentDestroyed()`. While active, `shouldSpawn()` returns false. Expires after `cooldownMs` (30s). Resets on each destruction.
  - Accept `maxAgents` parameter from orchestrator — this is the PortAllocator capacity (initially 200 for auto-scale, not 20)
  
  - Write vitest tests FIRST (RED — tests that fail before implementation):
    - **Happy path**: metrics at 50% CPU/RAM, 5 pending tasks → targetConcurrency = 5, shouldSpawn = true, shouldDestroy = false
    - **Stop threshold**: metrics at cpu=92, ram=80 → shouldSpawn = false, state = BACKING_OFF
    - **Stop threshold OR**: metrics at cpu=80, ram=92 → shouldSpawn = false (OR logic)
    - **Destroy threshold**: metrics at cpu=96, ram=80 → shouldDestroy = true, state = DESTROYING
    - **Destroy threshold OR**: metrics at cpu=80, ram=96 → shouldDestroy = true
    - **Cooldown active**: after notifyAgentDestroyed, within 30s → shouldSpawn = false, state = COOLDOWN
    - **Cooldown expired**: 31s after notifyAgentDestroyed, metrics at 50% → shouldSpawn = true, state = NORMAL
    - **Cooldown reset**: destroy → cooldown → 5s later still 95% → destroy again → cooldown resets
    - **Recovery**: destroy → 5s later metrics drop to 80% → 30s cooldown → after cooldown, shouldSpawn = true
    - **Kickstart**: available RAM = 8GB, estimate = 250MB → targetConcurrency initially = 32, but clamped to [1, maxAgents]
    - **Min bound**: pendingTasks = 0 → targetConcurrency = 1 (minimum 1 agent for potential retries)
    - **Max bound**: pendingTasks = 200, maxAgents = 200 → targetConcurrency = 200
    - **No oscillation**: within 30s cooldown window, even if metrics drop to 10%, shouldSpawn stays false

  **Must NOT do**:
  - Do NOT import orchestrator internals — auto-scaler is pure logic, receives metrics via callback
  - Do NOT start/stop intervals that can't be cleaned up (use clearInterval in stop())
  - Do NOT use `any` types or `@ts-ignore`

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: State machine with 5 states, cooldown logic, threshold transitions, re-evaluation cycles — requires careful edge case handling
  - **Skills**: [`docker-runtime`, `pipeline-agents`]
    - `docker-runtime`: Understanding of cgroup resource semantics
    - `pipeline-agents`: Understanding of orchestrator pool lifecycle and agent spawning patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7)
  - **Blocks**: Task 6, Task 9
  - **Blocked By**: Task 2 (resource monitor interface)

  **References**:
  - `src/lib/resource-monitor.ts` (from Task 2) — `getSystemMetrics()` return type `SystemMetrics`
  - `src/orchestrator/index.ts:208-215` — `setConcurrency()` API for adjusting instanceCount
  - `src/orchestrator/index.ts:488-533` — `executeTaskPool()` loop structure
  - `src/orchestrator/index.ts:57-59` — `DEFAULT_CONCURRENCY`, `MAX_INSTANCES`, `MIN_INSTANCES` constants
  - External: Kubernetes HPA state machine (from research — NORMAL, SCALING_UP, SCALING_DOWN, COOLDOWN)
  - External: KEDA fallback pattern (from research — on errors, scale to safe minimum rather than 0)

  **Acceptance Criteria**:
  - [ ] vitest: `new AutoScaler({...}).targetConcurrency()` returns kickstart value based on RAM/250MB
  - [ ] vitest: at cpu=50,ram=50 → `shouldSpawn() === true`, `shouldDestroy() === false`, `getStatus().state === 'NORMAL'`
  - [ ] vitest: at cpu=92,ram=80 → `shouldSpawn() === false`, `getStatus().state === 'BACKING_OFF'`
  - [ ] vitest: at cpu=80,ram=92 → `shouldSpawn() === false` (OR logic confirmed)
  - [ ] vitest: at cpu=96,ram=80 → `shouldDestroy() === true`
  - [ ] vitest: after `notifyAgentDestroyed()`, within 30s → `shouldSpawn() === false`, `getStatus().state === 'COOLDOWN'`
  - [ ] vitest: 31s after `notifyAgentDestroyed()`, at cpu=50 → `shouldSpawn() === true`
  - [ ] vitest: destroy → 5s still 95% → destroy again → cooldown resets (timer restarted)
  - [ ] vitest: `targetConcurrency()` clamped to `[1, maxAgents]`

  **QA Scenarios**:

  ```
  Scenario: Full state machine transition: NORMAL → BACKING_OFF → DESTROYING → COOLDOWN → NORMAL
    Tool: vitest
    Preconditions: AutoScaler created with mock resource monitor returning controllable values
    Steps:
      1. Start at cpu=50 → assert state NORMAL, shouldSpawn true
      2. Change to cpu=92 → assert state BACKING_OFF, shouldSpawn false, shouldDestroy false
      3. Change to cpu=96 → assert shouldDestroy true
      4. Call notifyAgentDestroyed() → assert state COOLDOWN, shouldSpawn false
      5. Advance timer 31 seconds → assert state returns to NORMAL
      6. Change to cpu=50 → assert shouldSpawn true
    Expected Result: All states transition correctly with OR threshold logic
    Failure Indicators: Stuck in wrong state, shouldSpawn returns wrong value during cooldown
    Evidence: .sisyphus/evidence/task-4-state-machine.txt

  Scenario: Cooldown does not prevent re-destruction at sustained 95%
    Tool: vitest
    Preconditions: AutoScaler with cpu=96 sustained, 3 active agents
    Steps:
      1. shouldDestroy() returns true (first agent destroyed)
      2. Advance 5 seconds, cpu still 96 → shouldDestroy() returns true (second agent destroyed)
      3. Advance 5 seconds, cpu still 96 → shouldDestroy() returns true (third agent destroyed)
      4. Advance 5 seconds, cpu still 96, but activeAgents=0 → shouldDestroy() returns false (nothing to destroy)
    Expected Result: Each 5s cycle at 95%+ triggers destruction of next agent until none remain
    Failure Indicators: Cooldown prevents re-destruction (bug — cooldown should only block scale-up, not continued destruction at 95%+)
    Evidence: .sisyphus/evidence/task-4-repeated-destruction.txt

  Scenario: Recovery after destruction — resources drop below 90%
    Tool: vitest
    Preconditions: AutoScaler after agent destruction
    Steps:
      1. After notifyAgentDestroyed(), set cpu=80 (recovered)
      2. Advance 5s → assert shouldDestroy() returns false (resources below 95%)
      3. Assert shouldSpawn() returns false (still in cooldown)
      4. Advance 31s total → assert shouldSpawn() returns true (cooldown expired)
    Expected Result: Cooldown respects 30s window even after recovery, then allows scale-up
    Evidence: .sisyphus/evidence/task-4-recovery-cooldown.txt

  Scenario: Kickstart calculation based on available RAM
    Tool: vitest
    Preconditions: Mock resource monitor returns 8GB RAM
    Steps:
      1. Create AutoScaler with agentMemoryEstimateMb=250
      2. Assert targetConcurrency() initially = Math.floor(8192 / 250) = 32
      3. Clamp to maxAgents if maxAgents < 32
    Expected Result: Initial concurrency estimate proportional to RAM
    Evidence: .sisyphus/evidence/task-4-kickstart.txt
  ```

  **Commit**: YES
  - Message: `feat(orch): add auto-scaler module with threshold state machine`
  - Files: `src/orchestrator/auto-scaler.ts`, `src/orchestrator/auto-scaler.test.ts`
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 5. **Orchestrator `destroyAgent()` + `killedByAutoScaler` handling**

  **What to do**:
  - Add public method `async destroyAgent(agentId: number): Promise<void>` to `Orchestrator` class in `src/orchestrator/index.ts`
  - The method must execute the FULL cleanup sequence IN ORDER:
    1. Get the `SpawnedAgent` from `this.activeAgents.get(agentId)`. If not found, return (agent already done/destroyed).
    2. Set `killedByAutoScaler = true` on the `AgentStatus`
    3. Call `agent.dispose()` — causes `agent.prompt()` to reject in `spawnAndRun()`
    4. Remove from `this.activeAgents.delete(agentId)` and `this.spawningIds.delete(agentId)`
    5. Call `this.worktreeManager!.removeAgentWorktree(agentId)` (best-effort, catch errors)
    6. Call `git.deleteBranch(branchName)` (best-effort, catch errors)
    7. Call `this.portAllocator.release(agentId)`
    8. Update agent status: state='error', phase='killed_by_autoscaler', error='Auto-scaler: resources exceeded 95%'
    9. Re-queue the task: `this.pendingTasks.unshift(task)` — put at FRONT so it's picked next
    10. Call `this.poolWakeup?.()` to re-evaluate pool
  - In `spawnAndRun()`, catch block (line 641): add a check BEFORE the retry logic:
    ```typescript
    const status = this.agents.get(task.agentId);
    if (status?.killedByAutoScaler) {
      // Auto-scaler handles re-queueing and cleanup
      this.spawningIds.delete(task.agentId);
      return; // do NOT retry, do NOT mark as error
    }
    ```
  - This prevents the race condition identified by Metis where the auto-scaler re-queues the task AND `spawnAndRun()` retries it independently
  - Add `phase` variant to `AgentLifecyclePhase` in `src/lib/types.ts:128-142`: add `'killed_by_autoscaler'` to the union
  - Write vitest tests:
    - Test: `destroyAgent(1)` disposes agent, removes worktree, releases ports, re-queues task
    - Test: `destroyAgent(1)` on already-completed agent returns silently (idempotent)
    - Test: `destroyAgent(1)` sets `killedByAutoScaler=true`, catch block skips retry
    - Test: after destruction, task is first in pending queue (`pendingTasks[0]`)
    - Test: multiple consecutive destructions (3 agents) all re-queue tasks correctly

  **Must NOT do**:
  - Do NOT remove the agent entry from `this.agents` Map — keep it for manifest/audit trail
  - Do NOT skip port release or worktree removal — full cleanup always
  - Do NOT modify `spawnAndRun()` retry logic beyond the `killedByAutoScaler` early return

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Cross-cutting change touching agent lifecycle disposal, retry logic, and cleanup — requires understanding of all 4 cleanup paths
  - **Skills**: [`pipeline-agents`, `git-workflow-orchestration`]
    - `pipeline-agents`: Understanding of SpawnedAgent lifecycle and how dispose() interacts with prompt()
    - `git-workflow-orchestration`: Understanding of worktree removal and branch deletion semantics

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6, 7)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1 (type extensions)

  **References**:
  - `src/orchestrator/index.ts:535-775` — `spawnAndRun()` full method, especially catch block at line 641
  - `src/orchestrator/index.ts:217-238` — `abort()` method — similar disposal pattern to follow
  - `src/orchestrator/index.ts:778-823` — `finalizeAgent()` — cleanup sequence reference
  - `src/orchestrator/types.ts:15-22` — `SpawnedAgent` interface (dispose method)
  - `src/git/worktree-manager.ts:54-58` — `removeAgentWorktree()` method
  - `src/orchestrator/port-allocator.ts:release()` — port release method

  **Acceptance Criteria**:
  - [ ] `orchestrator.destroyAgent(1)` exists as public async method
  - [ ] vitest: after `destroyAgent(1)`, agent 1's worktree is removed, ports released, task re-queued at `pendingTasks[0]`
  - [ ] vitest: `destroyAgent(1)` on non-existent agent returns without error
  - [ ] vitest: `killedByAutoScaler=true` appears on the AgentStatus after destruction
  - [ ] vitest: `spawnAndRun()` catch block with killedByAutoScaler=true skips retry and returns early
  - [ ] vitest: `destroyAgent` properly disposes the SpawnedAgent session

  **QA Scenarios**:
  ```
  Scenario: Full agent destruction cycle preserves task integrity
    Tool: vitest
    Preconditions: Orchestrator with 1 active agent (agent 1 processing task T)
    Steps:
      1. Call orch.destroyAgent(1)
      2. Assert agent 1 status: phase === 'killed_by_autoscaler', killedByAutoScaler === true
      3. Assert orch.pendingTasks[0] is the re-queued task T
      4. Assert orch.activeAgents does NOT contain agent 1
      5. Assert port was released (check portAllocator state)
    Expected Result: Agent destroyed, task re-queued, all resources released, ready for re-spawn
    Failure Indicators: Task lost, dangling worktree, port leak, agent still in activeAgents
    Evidence: .sisyphus/evidence/task-5-destroy-cycle.txt

  Scenario: spawnAndRun does NOT retry killed agents
    Tool: vitest
    Preconditions: Agent mid-prompt, auto-scaler destroys it
    Steps:
      1. Spawn agent that will be mid-prompt (mock)
      2. Call destroyAgent(agentId)
      3. Assert the spawnAndRun catch path returns early (no retry attempt)
      4. Assert the task is re-queued EXACTLY ONCE (not duplicated)
    Expected Result: No double-processing of the same task
    Evidence: .sisyphus/evidence/task-5-no-double-retry.txt
  ```

  **Commit**: YES
  - Message: `feat(orch): add destroyAgent method with full cleanup and killedByAutoScaler flag`
  - Files: `src/orchestrator/index.ts`, `src/lib/types.ts` (add killed_by_autoscaler phase)
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 6. **Auto-scaler hook into `executeTaskPool` + lifecycle**

  **What to do**:
  - In `Orchestrator.start()` method at `src/orchestrator/index.ts`:
    - Accept auto-scale config via `OrchestratorOptions.autoScale?: boolean` (new optional field)
    - If `autoScale === true`: create `AutoScaler` instance, store as `this.autoScaler`
    - Pass `getSystemMetrics` as the resource monitor callback
    - Start auto-scaler monitoring loop after pre-decomposition (before stage loop)
    - Stop auto-scaler in `finally` block (line 464-483) before run logger flush
  - In `executeTaskPool()` method (line 488):
    - If auto-scaler is active: BEFORE spawning each task, call `autoScaler.shouldSpawn()`. If returns false, skip spawn but keep task in queue (already dequeued? No — only dequeue if spawning).
    - More precisely: wrap the spawn loop (lines 498-521) with an auto-scale gate:
    ```typescript
    for (let i = 0; i < slotsAvailable && this.pendingTasks.length > 0; i++) {
      // Auto-scale gate: check resource thresholds before dequeueing
      if (this.autoScaler && !this.autoScaler.shouldSpawn()) {
        break; // stop spawning this cycle
      }
      const task = this.pendingTasks.shift()!;
      // ... rest unchanged
    }
    ```
    - Also override the target concurrency: if auto-scaler is active, `instanceCount` is driven by `autoScaler.targetConcurrency()`, not the fixed `DEFAULT_CONCURRENCY` or manual +/-. Call `this.instanceCount = this.autoScaler.targetConcurrency()` at the start of each poll cycle.
  - In `spawnAndRun()` (line 535): after agent creation success, call `autoScaler.notifyTaskQueued(this.pendingTasks.length)` to update scaling state
  - In `finalizeAgent()` (line 778): after agent completes (success or no_changes), call `autoScaler.notifyAgentCompleted()`
  - In the destruction re-evaluation cycle: After `destroyAgent()`, call `autoScaler.notifyAgentDestroyed()`. Then wait 5 seconds, call `shouldDestroy()` again. If true, destroy next agent (loop until `shouldDestroy()` returns false or no agents left).
  - Start the 5-second re-evaluation loop in `executeTaskPool()` or as a separate interval alongside the auto-scaler
  - Write vitest tests:
    - Test: auto-scale enabled → `instanceCount` driven by `autoScaler.targetConcurrency()`
    - Test: `shouldSpawn()` returns false → pool skips spawn, pendingTasks preserves tasks
    - Test: `shouldSpawn()` returns true → pool spawns normally
    - Test: auto-scale disabled → `instanceCount` stays at `DEFAULT_CONCURRENCY`
    - Test: integration: 5 pending tasks, resources at 50% → 5 agents spawned, pipeline completes

  **Must NOT do**:
  - Do NOT refactor `executeTaskPool()` loop structure — only add the auto-scale gate
  - Do NOT change existing poll interval or wakeup mechanism
  - Do NOT create a separate pool loop — reuse existing 500ms cycle
  - Do NOT stop auto-scaler on abort unless abort() already runs finally block cleanup

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration of new module into existing battle-tested pool loop — requires careful threading without breaking existing invariants
  - **Skills**: [`pipeline-agents`]
    - `pipeline-agents`: Deep understanding of orchestrator pool lifecycle, the four tracking collections, and wakeup semantics

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 4 auto-scaler and Task 5 destroyAgent)
  - **Parallel Group**: Wave 2 sequential (starts after Tasks 4, 5, 7)
  - **Blocks**: Task 9 (TUI display)
  - **Blocked By**: Tasks 4, 5

  **References**:
  - `src/orchestrator/index.ts:488-533` — `executeTaskPool()` — the loop being modified
  - `src/orchestrator/index.ts:240-484` — `start()` — constructor and init
  - `src/orchestrator/index.ts:89-113` — `OrchestratorOptions` — extend with autoScale boolean
  - `src/orchestrator/auto-scaler.ts` (from Task 4) — AutoScaler API
  - `src/orchestrator/index.ts:164` — constructor line where instanceCount is initialized

  **Acceptance Criteria**:
  - [ ] `new Orchestrator(..., { autoScale: true })` creates AutoScaler instance
  - [ ] vitest: auto-scale on, targetConcurrency=5 → instanceCount = 5
  - [ ] vitest: auto-scale on, shouldSpawn=false → no new agents spawned this cycle
  - [ ] vitest: auto-scale off → instanceCount = DEFAULT_CONCURRENCY (10), behaves as before
  - [ ] vitest: existing orchestrator tests still pass (no regressions)

  **QA Scenarios**:

  ```
  Scenario: Auto-scale gate prevents spawning under resource pressure
    Tool: vitest
    Preconditions: Auto-scale enabled, mock resource monitor at cpu=92, 10 pending tasks
    Steps:
      1. Start pool loop
      2. Assert autoScaler.shouldSpawn() returns false
      3. Assert no agents are spawned (activeAgents.size === 0)
      4. Assert all 10 tasks remain in pendingTasks
    Expected Result: Queue preserved, no agents spawned under high resource pressure
    Failure Indicators: Agents spawned despite 92% CPU, tasks lost from queue
    Evidence: .sisyphus/evidence/task-6-gate-prevents-spawn.txt

  Scenario: Auto-scale drives concurrency dynamically
    Tool: vitest
    Preconditions: Auto-scale enabled, targetConcurrency returns 5
    Steps:
      1. Start orchestrator with auto-scale
      2. During poll loop, assert instanceCount === 5
      3. Change mock to targetConcurrency returns 3
      4. Next poll cycle, assert instanceCount === 3
    Expected Result: instanceCount follows targetConcurrency dynamically
    Failure Indicators: instanceCount stuck at default, autoScaler ignored
    Evidence: .sisyphus/evidence/task-6-dynamic-concurrency.txt

  Scenario: Full pipeline completes with auto-scale (integration)
    Tool: vitest
    Preconditions: Mock resource monitor returns cpu=50/ram=50 throughout, 3-task pipeline
    Steps:
      1. Create orchestrator with autoScale: true
      2. Start orchestrator
      3. Wait for completion
      4. Assert all 3 tasks completed successfully
    Expected Result: Pipeline completes with auto-scale enabled, no hangs or early exits
    Failure Indicators: Pipeline hangs, pool exits early, tasks incomplete
    Evidence: .sisyphus/evidence/task-6-full-pipeline.txt
  ```

  **Commit**: YES
  - Message: `feat(orch): integrate auto-scaler into executeTaskPool with resource-gated spawning`
  - Files: `src/orchestrator/index.ts`
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 7. **PortAllocator dynamic maxAgents + MAX_INSTANCES decoupling**

  **What to do**:
  - In `src/orchestrator/port-allocator.ts`:
    - Add method `setMaxAgents(n: number): void` to update the max agent count at runtime
    - Remove hard coupling to `MAX_INSTANCES` — accept maxAgents as configurable parameter
    - In `allocate()` method: use the dynamic `this.maxAgents` instead of constructor-fixed value
    - Ensure sliding window still works with higher maxAgents (e.g., 200 agents)
    - Validate that probe range scales: `maxAgents * 4` slot scans (line 65-66) with 200 agents = 800 slots scanned — still fast (local TCP probe, <1ms each)
  - In `src/orchestrator/index.ts`:
    - Change `MAX_INSTANCES` to `200` (was 20) when auto-scale is enabled — this is the new ceiling. Actually, change the approach: don't modify MAX_INSTANCES constant; instead, when auto-scale is active, `setConcurrency()` must NOT clamp to MAX_INSTANCES. Or better: make `AUTO_SCALE_MAX_INSTANCES = 200` and use it as the clamp for auto-scale mode.
    - In `setConcurrency()` (line 208-215): accept an optional `bypassCap?: boolean` parameter. When true and auto-scale is active, use `AUTO_SCALE_MAX_INSTANCES = 200` instead of `MAX_INSTANCES = 20`.
    - Pass `maxAgents: 200` to `PortAllocator` constructor when auto-scale is active
  - Write vitest tests:
    - Test: `portAllocator.setMaxAgents(200)` allows allocating up to 200 agents
    - Test: `portAllocator.allocate(201)` with maxAgents=200 fails (exceeds capacity)
    - Test: port allocator with maxAgents=200 still probes correctly (no false collisions)
    - Test: setConcurrency with bypassCap=true allows values > 20

  **Must NOT do**:
  - Do NOT change `MAX_INSTANCES` constant from 20 — it's the manual mode cap. Auto-scale gets its own cap.
  - Do NOT break existing port allocator tests (they use default maxAgents=20)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Parameterization of existing cap — mechanical change with clear scope
  - **Skills**: [`port-isolation`]
    - `port-isolation`: Understanding of PortAllocator internals, TCP probe semantics, sliding window algorithm

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 6)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1 (type understanding)

  **References**:
  - `src/orchestrator/port-allocator.ts:1-161` — PortAllocator class, maxAgents field, allocate(), probe()
  - `src/orchestrator/port-allocator.ts:65-66` — slot scanning range (maxAgents * 4)
  - `src/orchestrator/index.ts:57-59` — DEFAULT_CONCURRENCY, MAX_INSTANCES, MIN_INSTANCES
  - `src/orchestrator/index.ts:168-173` — PortAllocator construction with maxAgents: MAX_INSTANCES
  - `src/orchestrator/index.ts:208-215` — setConcurrency() with clamping

  **Acceptance Criteria**:
  - [ ] `PortAllocator.setMaxAgents(200)` exists and updates internal maxAgents
  - [ ] vitest: `allocate()` works for agents up to new maxAgents
  - [ ] vitest: `allocate()` fails for agent above maxAgents
  - [ ] vitest: `setConcurrency(100, { bypassCap: true })` sets instanceCount to 100 (not clamped to 20)
  - [ ] vitest: `setConcurrency(100, { bypassCap: false })` clamps to 20
  - [ ] vitest: existing port allocator tests still pass

  **QA Scenarios**:

  ```
  Scenario: Port allocator supports 200 agents with auto-scale
    Tool: vitest
    Preconditions: PortAllocator with maxAgents=200
    Steps:
      1. Allocate ports for agent 199
      2. Assert allocation succeeds
      3. Allocate ports for agent 200
      4. Assert allocation succeeds
      5. Allocate ports for agent 201
      6. Assert allocation fails / throws
    Expected Result: Up to 200 agents allocated, 201st fails
    Failure Indicators: Allocation fails below 200, succeeds beyond 200
    Evidence: .sisyphus/evidence/task-7-port-capacity.txt

  Scenario: Manual concurrency still clamped to 20
    Tool: vitest
    Preconditions: Auto-scale disabled
    Steps:
      1. Call orch.setConcurrency(50)
      2. Assert orch.instanceCount === 20 (clamped)
    Expected Result: Manual mode respects 20 cap
    Failure Indicators: Manual setConcurrency bypasses cap
    Evidence: .sisyphus/evidence/task-7-manual-cap.txt
  ```

  **Commit**: YES
  - Message: `feat(orch): dynamic PortAllocator maxAgents and auto-scale concurrency cap`
  - Files: `src/orchestrator/port-allocator.ts`, `src/orchestrator/index.ts`
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 8. **CLI flag `--auto-scale` propagation**

  **What to do**:
  - In `src/cli.tsx`:
    - Add `--auto-scale` to the parsed flags alongside `--stub` and `--yolo` (line 164-169)
    - Filter it from `filtered` args like other flags
    - Add to printUsage() output (line 66-98)
    - Pass `autoScale` boolean through to `App` component via `AppProps`
  - In `src/app.tsx`:
    - Add `autoScale?: boolean` to `AppProps` interface (lines 20-29)
    - Thread through to `RunDashboard` component props
  - In `src/ui/components/RunDashboard.tsx`:
    - Accept `autoScale?: boolean` as a prop
    - Pass to `OrchestratorOptions` when constructing `Orchestrator` (line 68-77)
    - Add `autoScale` to `OrchestratorOptions` interface in `src/orchestrator/index.ts:89-113`
  - Write vitest test:
    - Test that `--auto-scale` flag is parsed correctly from argv
    - Test that Orchestrator receives `autoScale: true` in options when flag is present
    - Test that Orchestrator with `autoScale: false` behaves as before

  **Must NOT do**:
  - Do NOT add `--auto-scale` to pipeline JSON schema
  - Do NOT persist the flag anywhere (no env var, no config file)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Flag threading through 4 files — purely mechanical
  - **Skills**: [`ui-tui-ink`]
    - `ui-tui-ink`: Understanding of App→RunDashboard component prop flow

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs Task 6 orchestrator integration)
  - **Parallel Group**: Wave 3 (with Tasks 9, 10)
  - **Blocks**: None (leaf task)
  - **Blocked By**: Task 6

  **References**:
  - `src/cli.tsx:164-169` — existing flag parsing (--stub, --yolo)
  - `src/cli.tsx:228-237` — App component rendering with props
  - `src/app.tsx:20-29` — AppProps interface
  - `src/ui/components/RunDashboard.tsx:68-77` — Orchestrator construction
  - `src/orchestrator/index.ts:89-113` — OrchestratorOptions interface

  **Acceptance Criteria**:
  - [ ] `huu --help` shows `--auto-scale` in usage output
  - [ ] `huu --auto-scale run pipeline.json` propagates to OrchestratorOptions.autoScale = true
  - [ ] Without `--auto-scale` flag, autoScale is undefined/false
  - [ ] TypeScript compilation: no errors in AppProps or RunDashboard props

  **QA Scenarios**:

  ```
  Scenario: --auto-scale flag enables auto-scaling in orchestrator
    Tool: Bash
    Preconditions: Build complete, stub mode
    Steps:
      1. Run: huu --stub --auto-scale run example.pipeline.json
      2. Check debug log: .huu/debug-*.log should contain orch event with autoScale enabled
      3. Assert run completes without crash
    Expected Result: Pipeline completes with auto-scaling active
    Failure Indicators: Crash on startup, autoScale not passed through, type error
    Evidence: .sisyphus/evidence/task-8-flag-works.txt

  Scenario: Missing --auto-scale flag keeps default behavior
    Tool: Bash
    Preconditions: Build complete
    Steps:
      1. Run: huu --stub run example.pipeline.json
      2. Assert: debug log shows autoScale: false or undefined
      3. Assert: concurrency stays at DEFAULT_CONCURRENCY=10 (manual mode)
    Expected Result: No auto-scaling without flag
    Failure Indicators: Auto-scale activates without flag (silent regression)
    Evidence: .sisyphus/evidence/task-8-default-behavior.txt
  ```

  **Commit**: YES
  - Message: `feat(cli): add --auto-scale flag propagation through orchestrator options`
  - Files: `src/cli.tsx`, `src/app.tsx`, `src/ui/components/RunDashboard.tsx`, `src/orchestrator/index.ts`
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 9. **TUI `A`-key toggle + auto-scale status display**

  **What to do**:
  - In `src/ui/components/RunDashboard.tsx`:
    - Add `A` key handler in the `useInput` block (lines 282-341): when `A` is pressed, toggle auto-scale: if enabled → disable; if disabled → re-enable (restore auto-scaler)
    - When auto-scale is disabled via `A`, call `orchestrator.setConcurrency(orchestrator.instanceCount)` to lock current concurrency
    - When auto-scale is re-enabled via `A`, recreate/re-enable the auto-scaler (call `orchestrator.enableAutoScale()` or equivalent)
    - Update footer key hints (lines 466-470): add `A toggle auto-scale` to the legend
  - Add auto-scale status display to the dashboard header (lines 419-439):
    - Read `autoScale` from `OrchestratorState.getState()`
    - If autoScale is enabled, show: `AUTO [state] | CPU XX% RAM XX% | target: N | cooldown: Xs`
    - If autoScale is disabled, show nothing (or `MANUAL` if was previously auto)
    - Use color coding: NORMAL=green, BACKING_OFF=yellow, COOLDOWN=orange, DESTROYING=red
  - In `src/orchestrator/index.ts`:
    - Add `enableAutoScale(): void` — creates/starts auto-scaler if not active
    - Add `disableAutoScale(): void` — stops auto-scaler, locks current instanceCount
    - Expose auto-scale status in `getState()`
  - Write vitest test (for orchestrator only — TUI rendering tested via QA scenarios):
    - Test: `enableAutoScale()` starts auto-scaler, state reflects it
    - Test: `disableAutoScale()` stops auto-scaler, instanceCount frozen

  **Must NOT do**:
  - Do NOT test Ink rendering with vitest — use tmux QA scenarios for visual verification
  - Do NOT modify the existing `+`/`-` key handlers (Task 10 handles override behavior)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: TUI display changes with Ink component rendering, color coding, and keyboard handling
  - **Skills**: [`ui-tui-ink`]
    - `ui-tui-ink`: Ink component patterns, useInput hook, terminal color handling, responsive layout

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs Task 6 for orchestrator state, Task 8 for flag propagation)
  - **Parallel Group**: Wave 3 (with Tasks 8, 10)
  - **Blocks**: None (leaf task)
  - **Blocked By**: Tasks 6, 8

  **References**:
  - `src/ui/components/RunDashboard.tsx:282-341` — useInput key handlers
  - `src/ui/components/RunDashboard.tsx:466-470` — footer key hints
  - `src/ui/components/RunDashboard.tsx:419-439` — dashboard header
  - `src/ui/components/SystemMetricsBar.tsx:1-56` — existing resource display (color-coded percentages)
  - `src/orchestrator/index.ts:176-180` — subscribe() pattern for state updates
  - `src/lib/types.ts:184-198` — OrchestratorState (autoScale field from Task 1)

  **Acceptance Criteria**:
  - [ ] `A` key toggles auto-scale on/off during run
  - [ ] Dashboard header shows auto-scale status when enabled
  - [ ] Auto-scale status color-coded by state
  - [ ] Footer key legend includes `A toggle auto-scale`
  - [ ] vitest: orchestrator.enableAutoScale() / disableAutoScale() work correctly

  **QA Scenarios**:

  ```
  Scenario: A key toggles auto-scale mode on/off mid-run
    Tool: interactive_bash (tmux)
    Preconditions: huu running with --auto-scale, pipeline with multiple tasks
    Steps:
      1. Launch: huu --stub --auto-scale run example.pipeline.json
      2. Wait for dashboard to appear
      3. Observe header shows AUTO with state and resource percentages
      4. Press A key
      5. Assert: header changes to show MANUAL, auto-scale disabled
      6. Press A key again
      7. Assert: header returns to AUTO, auto-scale re-enabled
    Expected Result: A key toggles mode, header updates immediately
    Failure Indicators: No visible change, crash on toggle, state not reflected
    Evidence: .sisyphus/evidence/task-9-a-key-toggle.txt (tmux capture)

  Scenario: Auto-scale status shows correct state during resource pressure
    Tool: interactive_bash (tmux)
    Preconditions: huu with auto-scale and resource monitor at high CPU (simulate via test)
    Steps:
      1. Start run with auto-scale
      2. Observe header: AUTO NORMAL | CPU XX% RAM XX%
      3. (in test: mock resource monitor at 92%)
      4. Observe header changes to: AUTO BACKING_OFF (yellow)
      5. (in test: mock resource monitor at 96%)
      6. Observe header changes to: AUTO DESTROYING (red)
    Expected Result: State label and color change in response to resource thresholds
    Failure Indicators: Stale display, wrong state label, no color change
    Evidence: .sisyphus/evidence/task-9-status-display.txt (tmux capture)
  ```

  **Commit**: YES
  - Message: `feat(tui): add auto-scale A-key toggle and status display in dashboard`
  - Files: `src/ui/components/RunDashboard.tsx`, `src/orchestrator/index.ts`
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 10. **Manual `+`/`-` override disables auto-scale**

  **What to do**:
  - In `src/ui/components/RunDashboard.tsx`:
    - Modify `+` key handler (line 303): when auto-scale is active and user presses `+`, call `orchestrator.disableAutoScale()` first, THEN call `orchestrator.increaseConcurrency()` (manual override now in effect)
    - Modify `-` key handler (line 307): same pattern — disable auto-scale, then decrease
    - Show a brief status message (1-2s): `Auto-scale disabled — manual concurrency`
  - In `src/orchestrator/index.ts`:
    - If `disableAutoScale()` is called, set a flag `autoScaleDisabledByUser = true`
    - Only allow re-enabling via `A` key toggle (not by auto-scaler itself)
    - When auto-scale re-enabled via `A`, clear the flag
  - Write vitest test:
    - Test: auto-scale enabled, call `disableAutoScale()` → autoScaler stopped, instanceCount frozen
    - Test: auto-scale disabled via user, auto-scaler cannot self-re-enable
    - Test: `A` key re-enables after user disabled

  **Must NOT do**:
  - Do NOT remove the `+`/`-` handlers — they must keep working
  - Do NOT auto-re-enable after manual override — must require explicit `A` key press

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Override logic is simple — auto-scale disable before manual adjustment
  - **Skills**: [`ui-tui-ink`]
    - `ui-tui-ink`: Understanding of RunDashboard key handler patterns

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs Task 9 for A key toggle context)
  - **Parallel Group**: Wave 3 (with Tasks 8, 9)
  - **Blocks**: None
  - **Blocked By**: Task 9

  **References**:
  - `src/ui/components/RunDashboard.tsx:302-309` — existing +/- key handlers
  - `src/orchestrator/index.ts:200-215` — setConcurrency, increaseConcurrency, decreaseConcurrency
  - `src/orchestrator/index.ts` — disableAutoScale method location (from Task 9)

  **Acceptance Criteria**:
  - [ ] Pressing `+` during auto-scale disables auto-scale and increases concurrency by 1
  - [ ] Pressing `-` during auto-scale disables auto-scale and decreases concurrency by 1
  - [ ] After manual override, auto-scaler does NOT re-enable itself
  - [ ] After manual override, pressing `A` re-enables auto-scale
  - [ ] vitest: `disableAutoScale()` followed by resource drop does NOT re-enable auto-scaler

  **QA Scenarios**:

  ```
  Scenario: + key during auto-scale disables auto-scale and increases manually
    Tool: interactive_bash (tmux)
    Preconditions: huu running with --auto-scale, auto-scale active
    Steps:
      1. Observe header: AUTO NORMAL | concurrency N
      2. Press + key
      3. Assert: header changes to MANUAL
      4. Assert: concurrency is N+1
      5. Wait 10s (enough for auto-scaler cycles)
      6. Assert: header still shows MANUAL (auto-scale did NOT re-enable)
    Expected Result: Manual override persists until explicit re-enable
    Failure Indicators: Auto-scale silently re-enables, concurrency reverts
    Evidence: .sisyphus/evidence/task-10-manual-override.txt (tmux capture)

  Scenario: A key re-enables auto-scale after manual override
    Tool: interactive_bash (tmux)
    Preconditions: After manual override from previous scenario
    Steps:
      1. Press A key
      2. Assert: header changes to AUTO [state]
      3. Assert: concurrency returns to auto-scaler target
    Expected Result: A key restores auto-scaling
    Failure Indicators: A key does nothing after manual override
    Evidence: .sisyphus/evidence/task-10-re-enable.txt (tmux capture)
  ```

  **Commit**: YES
  - Message: `feat(tui): manual +/- override disables auto-scale until A-key re-enable`
  - Files: `src/ui/components/RunDashboard.tsx`, `src/orchestrator/index.ts`
  - Pre-commit: `npm run typecheck && npm test`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `vitest run`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty queue with auto-scale, resource recovery after destruction, manual +/- override during auto-scale. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Commit groups**: One commit per task after implementation + tests pass
- **Pre-commit**: `npm run typecheck && npm test` before each commit
- **Conventional Commits**: `feat(orch):`, `feat(cli):`, `feat(tui):`, `test(orch):`

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck  # Expected: exit 0
npm test           # Expected: all tests pass, 0 failures
huu --stub --auto-scale run example.pipeline.json  # Expected: completes without crash
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All vitest tests pass
- [ ] TypeScript compilation clean
- [ ] `--auto-scale` flag works with `--stub`
- [ ] `A` key toggles auto-scale mid-run
- [ ] Threshold logic verified by tests
- [ ] Agent destruction + re-queue verified by tests
- [ ] Cooldown behavior verified by tests
