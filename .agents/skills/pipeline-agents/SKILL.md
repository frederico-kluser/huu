---
name: pipeline-agents
description: >-
  Define pipeline creation, task decomposition, and AgentFactory usage (stub vs
  real). Use when adding pipeline features, modifying agent behavior, or testing
  the orchestrator. Do not use for git worktree operations or UI component work.
paths: "src/orchestrator/**/*.ts"
---
# Pipeline & Agents

## Goal

Documenta como pipelines são definidas, decompostas em tasks, e como os
agentes (stub e real) são criados e executados pelo orchestrator.

## Boundaries

**Fazer:**
- Seguir o schema Zod da pipeline: `{ _format, exportedAt, pipeline: { name, steps: [{ name, prompt, files }] } }`
- Usar `decomposeTasks()` para converter steps em `AgentTask[]` — 1 task por arquivo, ou 1 whole-project
- Implementar novos agentes como `AgentFactory` seguindo a interface em `orchestrator/types.ts`
- Passar `$file` no prompt quando `files` não está vazio
- Usar `files: []` para rodada livre (whole-project, single task)

**Nao fazer:**
- Acessar Pi SDK diretamente do orchestrator — sempre via `AgentFactory`
- Modificar `lib/types.ts` sem considerar impacto em todos os consumidores
- Permitir que stubs resolvam conflitos — isso é controlado por `conflictResolverFactory`
- Hardcodar paths de worktree — use `branch-namer.ts`

## Workflow

### Criar Pipeline
1. Definir `Pipeline { name, steps: PromptStep[] }`
2. Cada `PromptStep`: `name`, `prompt` (aceita `$file`), `files` (array de paths relativos)
3. `files: []` → single free run; `files: ["a.ts"]` → uma task por arquivo

### Decomposição
- `task-decomposer.ts`: atribui `agentId` sequencial
- O número total de tasks determina o tamanho do worker pool

### AgentFactory
```typescript
export type AgentFactory = (
  task: AgentTask,
  config: AppConfig,
  systemPromptHint: string,
  cwd: string,
  onEvent: (event: AgentEvent) => void,
) => Promise<SpawnedAgent>;
```

### Implementações
- **real-agent.ts**: usa `@mariozechner/pi-coding-agent`, traduz eventos Pi → `AgentEvent`
- **stub-agent.ts**: fake LLM, dorme 2-5s, escreve `STUB_*.md`, útil para testes visuais

### Ciclo de Vida do Agente
`pending → worktree_creating → worktree_ready → session_starting → streaming → tool_running → finalizing → validating → committing → pushing → cleaning_up → done`

## Gotchas

- O `Orchestrator` é stateful e usa Observer pattern (`subscribe`/`emit`).
- Concorrência é ajustável em tempo de execução (`+`/`-` no dashboard).
- `MIN_INSTANCES = 1`, `MAX_INSTANCES = 20`, default = 2.
- System prompts são gerados por `agents-md-generator.ts` e incluem regras strict (não rodar git, preservar APIs, seguir convenções).
- O integration agent tem permissão para rodar git commands — agents normais não.
