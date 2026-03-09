# HUU API Reference

This document provides an overview of the HUU public API. For full generated documentation, run `npm run docs:api` and open `docs/api-site/index.html`.

---

## Modules

### Types (`src/types/`)

Core data contracts shared across the entire system.

| Type | Description |
|------|-------------|
| `Message` | Typed mail system entry (task_assigned, task_done, merge_ready, etc.) |
| `Session` | Session tracking with cost/token aggregates |
| `Entity` / `Relation` | Knowledge graph nodes and edges |
| `Observation` | Tool usage event with 30-day decay |
| `Instinct` | Learned pattern with confidence score (0.3–0.85) |
| `BeatState` | Current beat sheet progress snapshot |
| `AuditLogEntry` | Tool call audit record with hash chain |
| `MergeQueueItem` | FIFO merge queue entry with lease management |
| `MergeResult` | Outcome of a merge attempt (tier, mode, conflicts) |
| `EscalationRecord` | Agent escalation with severity and category |
| `OrchestratorConfig` | Orchestrator tuning (concurrency, timeouts, backpressure) |
| `MergeConflict` / `MergeResolutionAttempt` | Conflict history for Tier 3-4 |
| `ConflictContextBundle` | Full context bundle sent to AI resolver (Tier 4) |

### Database (`src/db/`)

SQLite WAL connection and typed repositories.

```typescript
import { openDatabase, migrate, MessageQueue } from 'huu';

const db = openDatabase('/path/to/project.db');
migrate(db);

const queue = new MessageQueue(db);
queue.enqueue({ project_id: 'p1', message_type: 'task_assigned', ... });
const msg = queue.dequeue('orchestrator', { types: ['task_done'] });
```

**Repositories:**

| Class | Table | Key Operations |
|-------|-------|----------------|
| `MessageQueue` | `messages` | `enqueue`, `dequeue`, `ack`, `nack`, `deadLetter` |
| `SessionRepository` | `sessions` | `create`, `end`, `getRecent` |
| `EntityRepository` | `entities` | `upsert`, `findByType`, `search` |
| `RelationRepository` | `relations` | `upsert`, `findFrom`, `findTo` |
| `ObservationRepository` | `observations` | `create`, `findBySession`, `expireOld` |
| `InstinctRepository` | `instincts` | `create`, `update`, `findActive` |
| `BeatStateRepository` | `beat_state` | `upsert`, `get` |
| `AuditLogRepository` | `audit_log` | `append`, `findBySession`, `verifyChain` |
| `MergeQueueRepository` | `merge_queue` | `enqueue`, `claim`, `complete`, `fail`, `requeue` |
| `MergeResultsRepository` | `merge_results` | `insert`, `findByRequest`, `findByQueue` |

### Git (`src/git/`)

Worktree isolation and progressive merge.

```typescript
import { WorktreeManager, MergeManager } from 'huu';

const wm = new WorktreeManager('/project/root', '/tmp/worktrees');
const info = await wm.create('agent-1', 'main');
const git = wm.getGit('agent-1');

const mm = new MergeManager(mainGit, db);
const result = await mm.processNext('worker-1');
```

| Class | Description |
|-------|-------------|
| `WorktreeManager` | Create/remove/list worktrees with mutex for shared refs |
| `MergeManager` | FIFO queue processing with 4-tier merge (FF → recursive → heuristic → AI) |
| `WorktreeCleanup` | Stale detection, orphan cleanup, configurable policies |

### Agents (`src/agents/`)

Agent definitions, runtime, and tool registry.

```typescript
import { spawnAgent, builderAgent, createDefaultRegistry } from 'huu';

const result = await spawnAgent({
  definition: builderAgent,
  task: 'Implement feature X',
  worktreePath: '/tmp/worktrees/agent-1',
  registry: createDefaultRegistry(),
});
```

**Agent Definitions:** `builderAgent`, `plannerAgent`, `testerAgent`, `reviewerAgent`, `researcherAgent`, `mergerAgent`, `refactorerAgent`, `docWriterAgent`, `debuggerAgent`, `contextCuratorAgent`

**Key exports:**

| Export | Description |
|--------|-------------|
| `spawnAgent(input)` | Spawn an agent: worktree → context → Claude API → result |
| `ToolRegistry` | Register/lookup tool handlers for agent execution |
| `prepareContext(input)` | Build focused prompt from scratchpad + task context |
| `getFileChangesFromCommit(git, sha)` | Track file changes (created/modified/deleted) |

### Orchestrator (`src/orchestrator/`)

Beat Sheet engine, scheduling, monitoring, and state machine.

```typescript
import { OrchestratorLoop, DEFAULT_CONFIG } from 'huu';

const loop = new OrchestratorLoop(deps, { ...DEFAULT_CONFIG, projectId: 'myproject' });
loop.on('state_change', (e) => console.log(e.from, '->', e.to));
await loop.start(beatSheet);
```

**Beat Sheet:**

| Export | Description |
|--------|-------------|
| `validateBeatSheet(bs)` | Validate structure and dependency graph |
| `topologicalSort(bs)` | Sort tasks respecting dependencies |
| `computeWaves(bs)` | Group tasks into parallel execution waves |
| `computeReadySet(bs)` | Identify tasks ready for assignment |
| `buildDecompositionPrompt(input)` | Generate planner prompt for decomposition |

**Orchestrator Loop:**

| Export | Description |
|--------|-------------|
| `OrchestratorLoop` | Main loop: DECOMPOSE → ASSIGN → MONITOR → COLLECT → MERGE → ADVANCE_BEAT |
| `schedule(ctx)` | Match ready tasks to available agent slots |
| `OrchestratorMonitor` | Poll SQLite for task progress and completions |
| `HealthChecker` | Periodic pings, stale detection, backpressure |
| `EscalationManager` | Classify and respond to agent escalations |

**Resilience:**

| Export | Description |
|--------|-------------|
| `RunStateMachine` | Orchestrator state machine with transition validation |
| `RecoveryEngine` | Crash recovery via event log replay |
| `ShutdownManager` | Graceful shutdown (drain → save → cleanup) |
| `checkTimeout(config, phase, elapsed)` | Configurable timeout policies |

### Memory (`src/memory/`)

Closed learning loop: observe → analyze → instinct → promote.

```typescript
import { Observer, Analyzer, InstinctManager } from 'huu';

const observer = new Observer(db, config);
observer.pre({ tool: 'bash', params: { cmd: 'npm test' }, agent: 'tester', session: 's1' });
observer.post({ tool: 'bash', result: 'ok', success: true, latencyMs: 1200, ... });

const analyzer = new Analyzer(db, config);
const candidates = await analyzer.analyze();

const im = new InstinctManager(db, config);
im.reinforce(instinctId);
im.decay(instinctId);
```

| Export | Description |
|--------|-------------|
| `Observer` | Log tool calls with PII sanitization and batching |
| `Analyzer` | Detect patterns from 20+ observations → instinct candidates |
| `InstinctManager` | CRUD + reinforce/decay with confidence bounds |
| `PromotionPipeline` | Promote instincts to project-level knowledge |
| `SessionSummarizer` | Generate session summaries on completion |
| `ContextLoader` | Load last 7 days of sessions + ranked context on startup |

### MCP Bridge (`src/mcp/`)

Model Context Protocol integration with lazy lifecycle.

```typescript
import { initMcpBridge, ToolRegistry } from 'huu';

const registry = new ToolRegistry();
const { manager, bridge, cache } = await initMcpBridge(registry, '/project');
```

| Export | Description |
|--------|-------------|
| `initMcpBridge(registry, root)` | Factory: load config, connect servers, register tools |
| `McpClientManager` | Manage server connections with lazy/eager lifecycle |
| `McpBridge` | Bridge MCP tools to agent tool definitions |
| `McpToolCache` | Cache tool metadata to reduce discovery overhead |
| `createMcpProxyTool(mgr, bridge, cache)` | Single proxy tool for on-demand discovery |

### Audit (`src/audit/`)

Complete tool call logging, risk detection, and cost reporting.

```typescript
import { AuditLogger, generateAndSaveReport } from 'huu';

const logger = new AuditLogger(db, { projectId: 'p1' });
logger.log({ agent: 'builder', tool: 'bash', params: { cmd: 'rm -rf /' }, ... });

await generateAndSaveReport(db, 'session-123', './reports/');
```

| Export | Description |
|--------|-------------|
| `AuditLogger` | Append audit events with hash chain integrity |
| `evaluateRiskRules(event)` | Flag suspicious actions (unusual patterns, file access) |
| `calculateEventCost(event)` | Compute cost per event based on model pricing |
| `generateReport(db, sessionId)` | Generate post-session audit report |
| `getSessionTimeline(db, id)` | Query timeline of events for a session |

---

## Generating Full API Docs

```bash
# Generate HTML documentation
npm run docs:api

# Check documentation coverage
npm run docs:api:check
```

Output is written to `docs/api-site/`. Open `docs/api-site/index.html` in a browser.

---

## See Also

- [ARCHITECTURE.md](../ARCHITECTURE.md) — 12 architectural decisions
- [ROADMAP.md](../ROADMAP.md) — Implementation phases
- [CONTRIBUTING.md](../CONTRIBUTING.md) — How to contribute
