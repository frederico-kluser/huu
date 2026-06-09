---
name: pipeline-agents
description: >-
  Define pipeline creation, task decomposition, and AgentFactory usage (stub vs
  real). Use when adding pipeline features, modifying agent behavior, or testing
  the orchestrator. Do not use for git worktree operations or UI component work.
---
# Pipeline & Agents

## Goal

Documents how pipelines are defined, decomposed into tasks, and how agents
(stub and real) are created and executed by the orchestrator.

## Boundaries

**Do:**
- Follow the pipeline's Zod schema (v2): `{ _format: "huu-pipeline-v2", exportedAt, pipeline: { name, steps: PipelineStep[], maxNodeExecutions?, portAllocation?, integrationModelId? } }`. v1 (`{ name, prompt, files, scope?, modelId? }` only, no `type`) is still accepted — `type` defaults to `'work'`.
- `Pipeline.integrationModelId` pins the merge/integration agent's model (falls back to `AppConfig.modelId`). The orchestrator computes the effective config; `integration-agent.ts` stays pipeline-agnostic.
- `PipelineStep` is a discriminated union: `WorkStep` (`type: 'work'` or omitted) | `CheckStep` (`type: 'check'`). Narrow with `isWorkStep` / `isCheckStep` from `lib/types.ts`.
- Use `decomposeTasks()` to convert **work** steps into `AgentTask[]` — 1 task per file, or 1 whole-project. Check steps do NOT decompose into worker pool tasks; they spawn a single judge agent via `check-evaluator.ts` (reserved `agentId 9998`).
- Implement new agents as `AgentFactory` following the interface in `orchestrator/types.ts`
- Pass `$file` in the prompt when `files` is not empty
- Use `files: []` for free-form round (whole-project, single task)
- Treat `scope` as **editor-side intent** that constrains how the user can shape `files`. The orchestrator still decomposes purely from `files.length` (0 → one whole-project task; N → N per-file tasks). Don't add scope-based branching to `task-decomposer.ts` — keep the runtime contract single-source.
- When iterating a `WorkStep` (revisit via check loop, `runs > 1`), allocate **fresh** `agentId`s — branch names derive from agentId, reusing IDs collides on existing commits.

**Don't:**
- Access Pi SDK directly from the orchestrator — always via `AgentFactory`
- Modify `lib/types.ts` without considering impact on all consumers
- Allow stubs to resolve conflicts — this is controlled by `conflictResolverFactory`
- Hardcode worktree paths — use `branch-namer.ts`
- Rewind the integration worktree on check-loop backjumps. Loops always re-execute on top of the current HEAD; the worktree accumulates commits monotonically.

## Workflow

### Create Pipeline
1. Define `Pipeline { name, steps: PipelineStep[], maxNodeExecutions? }`
2. **WorkStep** (`type: 'work'` or omitted): `name` (unique!), `prompt` (accepts `$file`), `files`, optional `scope`, `modelId`, `next` (override linear progression).
3. **CheckStep** (`type: 'check'`): `name` (unique!), `condition` (NL, supports `$runs` 1-based counter), `outcomes` (≥1, exactly one must have `default: true`, each `nextStepName` must reference an existing step), optional `maxRuns` (default 5), `instructionDraft`, `modelId`.
4. `files: []` → single free run; `files: ["a.ts"]` → one task per file.
5. `scope` (optional, defaults to `flexible`):
   - `project` — pin the step to whole-project. Editor locks Files to `[]`.
   - `per-file` — require explicit file selection.
   - `flexible` — legacy free-form (`F` to pick, `W` for whole-project).

### Decomposition
- `task-decomposer.ts`: assigns sequential `agentId` for WorkSteps only
- Tasks are pre-decomposed and keyed by step `name` in a `Map<string, AgentTask[]>` (not array index — cursor visits don't follow array order)
- The total number of tasks across all WorkSteps determines the worker pool size

### Graph cursor (orchestrator/index.ts)
The runtime is a cursor walking a directed graph:
- Track `currentStepName`, increment per-step `runs`, honor `Pipeline.maxNodeExecutions` global cap.
- On `CheckStep` visit: respect `maxRuns`, call `evaluateCheckStep()`, jump to outcome's `nextStepName`.
- On `WorkStep` revisit (`runs > 1`): allocate fresh agent IDs.
- Honor `WorkStep.next` override; otherwise fall through to `steps[idx+1]`; `null` = end.
- Persist `executionTrace` into `manifest.executionTrace`.
- Per WorkStep visit, push a `StageIntegration` entry (`stageIntegrations`) and advance its phase `pending → merging → conflict_resolving? → done|error|skipped` — both dashboards render it as the merge card. New terminal paths in the orchestrator MUST sweep non-terminal entries to `error` (see the end-of-run sweep in `start()`), or cards hang in DOING forever.

### AgentFactory
```typescript
export type AgentFactory = (
  task: AgentTask,
  config: AppConfig,
  systemPromptHint: string,
  cwd: string,
  onEvent: (event: AgentEvent) => void,
  runtimeContext?: AgentRuntimeContext,  // ports + shimAvailable
) => Promise<SpawnedAgent>;

interface AgentRuntimeContext {
  ports?: AgentPortBundle;     // per-agent TCP port window
  shimAvailable?: boolean;     // bind() interceptor active?
}
```

`runtimeContext` is optional for source compatibility — stub factories
can ignore it. Real factories should thread `ports` into the system
prompt so the agent knows which ports it owns; see the
[`port-isolation`](../port-isolation/SKILL.md) skill for the full
contract.

### Implementations
- **real-agent.ts**: uses `@mariozechner/pi-coding-agent`, translates Pi events → `AgentEvent`. Receives `runtimeContext` and forwards `ports` + `shimAvailable` to `generateAgentSystemPrompt()`.
- **stub-agent.ts**: fake LLM, sleeps 2-5s, writes `STUB_*.md`, useful for visual tests. Accepts and ignores `runtimeContext`.

### Agent Lifecycle
`pending → worktree_creating → worktree_ready → session_starting → streaming → tool_running → finalizing → validating → committing → pushing → cleaning_up → done`

## Gotchas

- The `Orchestrator` is stateful and uses the Observer pattern (`subscribe`/`emit`).
- Concurrency is adjustable at runtime (`+`/`-` on the dashboard).
- `MIN_INSTANCES = 1`, `MAX_INSTANCES = 20`, default = 2.
- System prompts are generated by `agents-md-generator.ts` and include strict rules (don't run git, preserve APIs, follow conventions).
- The integration agent has permission to run git commands — normal agents do not.
- The **check judge agent** (`agentId 9998`, distinct from integration agent `9999`) runs IN the integration worktree with shell access but MUST NOT commit, modify code, or push. Output contract: a JSON block `{ "label": "<one-of-outcomes>", "reason": "..." }`. Parsing failures or unknown labels → fall back to the outcome marked `default: true`. See `orchestrator/check-evaluator.ts` and `extractVerdict()`.
- Setup-time feasibility analysis lives in `lib/assistant-check-feasibility.ts` — calls LangChain `ChatOpenAI` with `withStructuredOutput(FeasibilitySchema)` to produce `{feasible, reason, instructionDraft, warnings}`. Stub mode via `HUU_LANGCHAIN_STUB=1` or `apiKey==='stub'`.
