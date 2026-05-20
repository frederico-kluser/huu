# huu — descrição do produto

> Data: 2026-04-30 · Versão: 0.3.x
> O que é a ferramenta e como ela funciona.
>
> **Nota:** este documento foi originalmente escrito quando o projeto se
> chamava `programatic-agent` — todos os nomes foram normalizados para
> `huu` no commit 43b43a2 e adiante. Os branches efetivamente criados
> são `huu/<runId>/integration` e `huu/<runId>/agent-<id>`; os worktrees
> ficam em `.huu-worktrees/<runId>/...`.

---

## 1. Em uma frase

CLI TUI em Ink que executa **pipelines declarativas de prompts** contra um **worker pool de agentes Pi SDK / OpenRouter**, cada um isolado em seu próprio **git worktree**, com **merge determinístico stage-a-stage** e fallback de **resolução de conflitos via LLM**.

---

## 2. A ideia central: tasks atômicas

A unidade de trabalho do huu é a **task atômica**: um agente, um arquivo, um prompt, um contexto limpo, um worktree.

O usuário escreve uma **pipeline** dividida em **stages**. Cada stage tem um prompt e uma lista de arquivos. No início da run, o orchestrator **pré-decompõe** todas as stages em tasks: uma task por arquivo (`$file` é interpolado no prompt). Stages com `files: []` viram uma única task escopada ao projeto inteiro.

Cada task vira um **agente** com:
- Um **id incremental** (`agentId`) e um **branch dedicado** (`huu/<runId>/agent-<id>`).
- Um **worktree próprio** em `.huu-worktrees/<runId>/agent-<id>`, partindo do HEAD da integração da stage anterior.
- Um **system prompt mínimo**: papel + escopo de arquivo + instruções de saída. Sem repo-map, sem histórico de outras tasks.
- Um **conjunto fixo de tools**: `read`, `bash`, `edit`, `write` (defaults do Pi SDK).

Tasks da mesma stage rodam em **paralelo** sob o worker pool; stages são **sequenciais** (a próxima stage só inicia após a integração da anterior). O resultado é uma cadeia de mudanças pequenas, isoladas e auditáveis pelo histórico do git.

---

## 3. Como ela funciona (fluxo de uma run)

```
cli.tsx (entry — gate de docker re-exec antes de qualquer import pesado)
  └─ App (screen router)
       welcome ─┬─ pipeline-assistant (A) ─ project-recon ─ pipeline-editor
                ├─ pipeline-import (I) ───── pipeline-editor
                └─ N (editor vazio) ──────── pipeline-editor
                                                  ↓
                                            model-selector
                                                  ↓
                                       (api-key prompt se faltar)
                                                  ↓
                                             RunDashboard
                                                  ↓
                                          Orchestrator.start()
                                                  │
            ┌─────────────────────────────────────┤
            │                                     │
            ▼                                     ▼
       runPreflight()              createIntegrationWorktree()
            │                                     │
            └────────────► para cada stage ◄──────┘
                              │
                  ┌───────────┴────────────┐
                  ▼                        ▼
            executeTaskPool        runStageIntegration
            (paralelo até          (merge serial das
             concurrency,           branches no integration)
             modulado pelo                  │
             auto-scaler)                   ▼
                  │               LLM resolver se
                  ▼               houver conflito
           agentes em                      │
           worktrees                       ▼
           próprios            stageBaseRef = HEAD
                                   (próxima stage parte daqui)
```

### Etapas detalhadas

1. **Preflight** (`src/git/preflight.ts`): valida repo limpo, baseBranch, baseCommit, remote/push (warnings).
2. **Worktree de integração**: cria `.huu-worktrees/<runId>/integration` em branch `huu/<runId>/integration`.
3. **Pré-decomposição**: percorre `pipeline.steps`, para cada stage chama `decomposeTasks(step.files, ...)` (`src/orchestrator/task-decomposer.ts`). Todas as cards aparecem em **TODO** desde o primeiro frame.
4. **Loop de stages** (linear). Para cada stage:
   - **Worker pool** (`executeTaskPool` em `src/orchestrator/index.ts`): mantém até `instanceCount` agentes ativos simultaneamente (default `10`, ajustável live com `+`/`-` na TUI ou pelo `AutoScaler` quando `--auto-scale` / tecla `A` está ativo). A cada slot livre, spawna um agente; loop polla a cada tick ou acorda no `poolWakeup`. O auto-scaler pode também **destruir** o agente mais novo (`destroyAgent`, fase `killed_by_autoscaler`) e re-enfileirar a task quando CPU/RAM cruza o threshold de destroy (default 95%).
   - **Spawn do agente** (`spawnAndRun`): cria worktree, cria `AgentSession` via `createAgentSession` do Pi SDK, registra subscriber para traduzir eventos (`tool_execution_start`, `message_end`, `agent_start/end`, `error`) em `AgentEvent`s do orchestrator.
   - **Execução do prompt**: `agent.prompt(renderedPrompt)` chama o LLM via OpenRouter; o agente usa as tools default para ler/escrever no próprio worktree.
   - **Finalize** (`finalizeAgent`): se houve mudanças, faz `git add -A` + commit (`[<pipelineName>] <stageName> (agent <id>)`); senão, marca `no_changes`. Limpa o worktree do agente (a branch fica preservada).
5. **Integração da stage** (`runStageIntegration`):
   - Filtra agentes elegíveis (state=done com commitSha).
   - Roda `mergeAgentBranches` (`src/git/integration-merge.ts`): `git merge <branch> --no-ff` para cada branch, em série.
   - Se há conflitos e existe `conflictResolverFactory`, dispara `runStageIntegrationWithResolver` que spawna um **integration agent** (id 9999, prompt `buildIntegrationPrompt`) dentro do worktree de integração com tools `bash`/`edit`/`write`. O agente edita os arquivos, roda `git add` + commit, fecha o merge.
   - Se ainda restar conflito e `continueOnConflict=false`, a run aborta.
6. **Avanço de base**: `stageBaseRef = HEAD do integration worktree`. A próxima stage parte desse commit, o que dá a propriedade de **stages encadeadas determinísticamente**.
7. **Cleanup**: remove o worktree de integração; mantém todas as branches (artefatos da run).
8. **Resultado** (`OrchestratorResult`): runId, manifest com agentEntries, logs, filesModified agregados, conflicts, duração.

---

## 4. Schema da pipeline

Tipo em `src/lib/types.ts`:

```ts
type Pipeline = {
  name: string;
  steps: PromptStep[];
};

type PromptStep = {
  name: string;     // ex: "2. Testes unitarios para $file"
  prompt: string;   // texto do prompt; "$file" é interpolado
  files: string[];  // [] = projeto inteiro; ["a.ts","b.ts"] = uma task por arquivo
  modelId?: string; // override de modelo por etapa
  scope?: 'project' | 'per-file' | 'flexible'; // intent do editor (default flexible)
};

type Pipeline = {
  name: string;
  steps: PromptStep[];
  cardTimeoutMs?: number;            // default 600_000 (10min) — multi-file/projeto
  singleFileCardTimeoutMs?: number;  // default 300_000 (5min)
  maxRetries?: number;               // default 1
  portAllocation?: PortAllocationConfig;  // ver docs/ARCHITECTURE.md
};
```

Pipelines são **JSON** em `pipelines/*.pipeline.json`, validadas com Zod. Exemplo real (`pipelines/testes-seguranca.pipeline.json`):

| Stage | Files | Comportamento |
|---|---|---|
| 1. Bootstrap test infra + TESTES.md | `[]` | 1 task (projeto inteiro) — instala framework de teste, escreve TESTES.md |
| 2. Testes unitários para `$file` | `[]` | 1 task (cobre projeto) — gera testes |
| 3. Auditoria de segurança de `$file` | `[]` | 1 task (cobre projeto) — escreve `*-security-gaps.md` |
| 4. Consolidar SECURITY-REPORT.md | `[]` | 1 task — agrega gaps + limpa parciais |

A interpolação `$file` substitui pela primeira entrada da lista da task. Quando `files` lista vários arquivos explicitamente, cada arquivo vira sua própria task com seu próprio agente.

---

## 5. O agente (Pi SDK + OpenRouter)

Implementação em `src/orchestrator/real-agent.ts` (factory `realAgentFactory`):

- **SDK**: `@mariozechner/pi-coding-agent` via `@mariozechner/pi-ai` (`createAgentSession`, `SessionManager`, `AuthStorage`, `ModelRegistry`).
- **Provider**: OpenRouter, com headers de atribuição (`HTTP-Referer`, `X-OpenRouter-Title`).
- **API key**: `OPENROUTER_API_KEY` (ou input na TUI quando ausente).
- **Modelo**: selecionado na TUI via `ModelSelectorOverlay`/`model-selector-ink` — recents, favoritos, catálogo recomendado, ou tabela completa do OpenRouter.
- **Thinking/reasoning**: `resolveThinkingLevel` checa `supportsThinking(modelId)` e/ou consulta capabilities do OpenRouter; retorna `'medium'` ou `'off'`.
- **System prompt**: `generateAgentSystemPrompt` monta papel + escopo (`Work only on these files: ...` ou full project) + branch/worktree info + regras (não rodar `git`).
- **Tools**: defaults do Pi SDK (`read`, `bash`, `edit`, `write`).
- **Eventos**: o subscriber traduz eventos do Pi (`tool_execution_start/end`, `message_end` com tokens/cost, `agent_start/end`, `error`) em `AgentEvent`s consumidos pelo orchestrator e pela TUI.

Existe também um **stub agent** (`src/orchestrator/stub-agent.ts`) ativado por `--stub`: dorme um tempo aleatório, escreve um `STUB_<stageName>_<id>.md` no worktree, emite eventos fake. Permite rodar o pipeline inteiro sem API key, útil para validar o orquestrador e a TUI.

---

## 6. Git workflow

Implementado em `src/git/`:

- **Naming** (`branch-namer.ts`):
  - integration: `huu/<runId>/integration`
  - agente: `huu/<runId>/agent-<id>`
  - worktrees em `.huu-worktrees/<runId>/{integration,agent-<id>}` (path adicionado ao `.gitignore` automaticamente).
- **WorktreeManager** (`worktree-manager.ts`): wrap de `git worktree add/remove`, com cleanup best-effort.
- **GitClient** (`git-client.ts`): wrappers `execSync` para `status`, `add`, `commit --no-verify`, `merge --no-ff`, `merge --abort`, `getHead`, `getChangedFiles`, detecção de conflito via `git diff --name-only --diff-filter=U`.
- **Preflight** (`preflight.ts`): repo válido, working tree limpo, baseBranch/baseCommit, remote/push.
- **Integration merge** (`integration-merge.ts`): merge serial das branches elegíveis na branch de integração; reporta `branchesMerged`, `branchesPending`, `conflicts`.
- **Integration agent** (`src/orchestrator/integration-agent.ts`): quando há conflito, instancia um agente especial (id 9999) no worktree de integração para resolvê-lo via LLM.

A propriedade emergente é simples: cada stage termina com **um único commit consolidado** no integration; a stage seguinte parte desse commit. A run inteira deixa um histórico linear no integration + N branches por agente preservadas como artefato.

---

## 7. A TUI (Ink)

Hierarquia em `src/ui/components/`:

- **App** (`src/app.tsx`) — screen router: welcome → (pipeline-assistant | pipeline-import | pipeline-editor) → model-selector → api-key (se faltar key) → run → summary.
- **PipelineAssistant** (`src/ui/components/PipelineAssistant.tsx`) — fluxo conversacional pra autoria. Estágios: `pick-model` → `intent` (texto livre) → `recon` (4 agentes paralelos via LangChain/OpenRouter, single-pass, digest-only) → `asking` ↔ `answering` (≤8 turnos, multipla escolha + escape em texto livre). Saída: um `PipelineDraft` validado por Zod (`src/lib/assistant-schema.ts`) convertido pra `Pipeline` e injetado no editor.
- **ProjectRecon** (`src/ui/components/ProjectRecon.tsx`) — UI dos 4 agentes de recon (`stack`, `structure`, `libraries`, `conventions`). Cada um recebe o digest de `src/lib/project-digest.ts` e cospe ≤5 bullets via schema `ReconBulletsSchema`.
- **PipelineEditor** — lista de steps com `↑↓` navegar, `Shift+↑↓` reordenar, `N` novo, `D` deletar, `R` renomear pipeline, `I` importar, `S` exportar, `G` rodar, `Enter` editar step.
- **StepEditor** — edita name/prompt/scope/files/model de um step. A row Scope (acima de Files) trava o comportamento de `F`/`W`/`ENTER` na row de Files: `project` = whole-project travado, `per-file` = exige seleção e habilita `ENTER` pra abrir o picker, `flexible` = comportamento legado. `FileMultiSelect` permite escolher arquivos do repo respeitando `.gitignore`.
- **ModelSelectorOverlay** — modo "quick" (recents/favorites/recommended) ou tabela completa via `model-selector-ink`.
- **ApiKeyPrompt** — input mascarado da OPENROUTER_API_KEY.
- **RunDashboard** — componente principal durante a execução:
  - Header: `stage X/Y · concurrency N · elapsed mm:ss · M/N done · status`. Quando o auto-scaler está ativo, aparece `AUTO <NORMAL|SCALING_UP|BACKING_OFF|COOLDOWN|DESTROYING>` + `CPU% RAM%`.
  - **Kanban** (`ink-kanban-board`) com 3 colunas: **TODO / DOING / DONE**. Cards são agentes com título (`#id stageName`), subtítulo (arquivo atual), status colorido, metadata (modelo, branch curto, files modificados), última linha de log.
  - Atalhos: `+`/`-` ajusta concurrency (e desliga auto-scale se estava ligado), `A` toggle do auto-scaler, `F` filtra logs por agente focado, `q` aborta (`q` de novo força saída), `↑↓←→` navega entre cards, `Enter` abre modal de detalhe.
  - **AgentDetailModal** — logs ao vivo, timeline (Created → Running → Done/Failed), prompt do step, info de git (branch/worktree/commit/stage), arquivos modificados, mensagem de erro se houver.
- **SystemMetricsBar** — sempre visível: CPU%, RAM%, RSS do processo, load average. Cor muda em 60% (amarelo) e 85% (vermelho) — orientação visual para `+`/`-` concurrency.

A TUI é o painel de controle e a observabilidade. Cada update emitido pelo orchestrator (state_change, log, file_write, done, error, integration progress) re-renderiza o dashboard em tempo real.

---

## 8. Build e execução

```bash
npm install
npm run dev                                       # tsx watch mode
npm start                                          # tsx, sem watch
npm run build && npm run build:link                # tsc + npm link + symlink dos pipelines
npm test                                           # vitest

huu                                  # TUI no welcome (re-exec automática em Docker)
huu run <pipeline.json>              # autoStart até model picker
huu --stub                           # força stub (sem API key)
huu --yolo                           # pula re-exec em Docker (== HUU_NO_DOCKER=1)
huu --auto-scale run <p.json>        # liga auto-scaler de concorrência no startup
huu init-docker                      # scaffolda compose.huu.yaml no projeto atual
huu status [--json|--liveness]       # parser do .huu/debug-*.log (HEALTHCHECK)
huu prune [--list|--dry-run]         # limpa containers Docker órfãos
```

API keys (resolvidas via `src/lib/api-key-registry.ts`, com a precedência docker secret → `_FILE` → env → `~/.config/huu/config.json`):

- `OPENROUTER_API_KEY` (`required: true`) — usada pelo Pi SDK no run + LangChain no assistant + recon.
- `ARTIFICIAL_ANALYSIS_API_KEY` (`required: true`) — usada nas lookups de capability/preço do model picker.

Stack: TypeScript 5.x, React 18, Ink 4.x, Zod 3.x, Vitest, `@mariozechner/pi-coding-agent` (run agents), `@langchain/openai` + `@langchain/core` (assistant + recon), `ink-kanban-board`, `model-selector-ink`.

---

## 9. O loop em uma frase

Pipeline declarativa → pré-decomposição em tasks atômicas (uma por arquivo) → worker pool spawna agentes em worktrees isolados → cada agente roda com contexto mínimo no Pi SDK/OpenRouter → ao fim da stage, branches são mergeadas determinísticamente; conflitos sobem para um agente LLM dedicado → o HEAD da integração vira a base da próxima stage → no fim, o usuário recebe um histórico git auditável e um RunManifest com a trilha completa.
