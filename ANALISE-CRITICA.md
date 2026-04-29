# programatic-agent — descrição do produto

> Data: 2026-04-27 · Versão: 0.1.0
> O que é a ferramenta e como ela funciona.

---

## 1. Em uma frase

CLI TUI em Ink que executa **pipelines declarativas de prompts** contra um **worker pool de agentes Pi SDK / OpenRouter**, cada um isolado em seu próprio **git worktree**, com **merge determinístico stage-a-stage** e fallback de **resolução de conflitos via LLM**.

---

## 2. A ideia central: tasks atômicas

A unidade de trabalho do programatic-agent é a **task atômica**: um agente, um arquivo, um prompt, um contexto limpo, um worktree.

O usuário escreve uma **pipeline** dividida em **stages**. Cada stage tem um prompt e uma lista de arquivos. No início da run, o orchestrator **pré-decompõe** todas as stages em tasks: uma task por arquivo (`$file` é interpolado no prompt). Stages com `files: []` viram uma única task escopada ao projeto inteiro.

Cada task vira um **agente** com:
- Um **id incremental** (`agentId`) e um **branch dedicado** (`programatic-agent/<runId>/agent-<id>`).
- Um **worktree próprio** em `.programatic-agent-worktrees/<runId>/agent-<id>`, partindo do HEAD da integração da stage anterior.
- Um **system prompt mínimo**: papel + escopo de arquivo + instruções de saída. Sem repo-map, sem histórico de outras tasks.
- Um **conjunto fixo de tools**: `read`, `bash`, `edit`, `write` (defaults do Pi SDK).

Tasks da mesma stage rodam em **paralelo** sob o worker pool; stages são **sequenciais** (a próxima stage só inicia após a integração da anterior). O resultado é uma cadeia de mudanças pequenas, isoladas e auditáveis pelo histórico do git.

---

## 3. Como ela funciona (fluxo de uma run)

```
cli.tsx (entry)
  └─ App (screen router)
       welcome → pipeline-editor → model-selector → run
                                                     │
                                                     ▼
                                             RunDashboard
                                                     │
                                                     ▼
                                              Orchestrator.start()
                                                     │
            ┌────────────────────────────────────────┤
            │                                        │
            ▼                                        ▼
       runPreflight()                   createIntegrationWorktree()
            │                                        │
            └────────────► para cada stage ◄─────────┘
                              │
                  ┌───────────┴────────────┐
                  ▼                        ▼
            executeTaskPool        runStageIntegration
            (paralelo até          (merge serial das
             concurrency)           branches no integration)
                  │                        │
                  ▼                        ▼
           agentes em                LLM resolver se
           worktrees                 houver conflito
           próprios                        │
                  │                        ▼
                  └────────────────►  stageBaseRef = HEAD
                                     (próxima stage parte daqui)
```

### Etapas detalhadas

1. **Preflight** (`src/git/preflight.ts`): valida repo limpo, baseBranch, baseCommit, remote/push (warnings).
2. **Worktree de integração**: cria `.programatic-agent-worktrees/<runId>/integration` em branch `programatic-agent/<runId>/integration`.
3. **Pré-decomposição**: percorre `pipeline.steps`, para cada stage chama `decomposeTasks(step.files, ...)` (`src/orchestrator/task-decomposer.ts`). Todas as cards aparecem em **TODO** desde o primeiro frame.
4. **Loop de stages** (linear). Para cada stage:
   - **Worker pool** (`executeTaskPool`, `src/orchestrator/index.ts:298-331`): mantém até `instanceCount` agentes ativos simultaneamente (default 2, ajustável 1–20 com `+`/`-` na TUI). A cada slot livre, spawna um agente; loop polla a 500 ms ou acorda no `poolWakeup`.
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
  - integration: `programatic-agent/<runId>/integration`
  - agente: `programatic-agent/<runId>/agent-<id>`
  - worktrees em `.programatic-agent-worktrees/<runId>/{integration,agent-<id>}` (path adicionado ao `.gitignore` automaticamente).
- **WorktreeManager** (`worktree-manager.ts`): wrap de `git worktree add/remove`, com cleanup best-effort.
- **GitClient** (`git-client.ts`): wrappers `execSync` para `status`, `add`, `commit --no-verify`, `merge --no-ff`, `merge --abort`, `getHead`, `getChangedFiles`, detecção de conflito via `git diff --name-only --diff-filter=U`.
- **Preflight** (`preflight.ts`): repo válido, working tree limpo, baseBranch/baseCommit, remote/push.
- **Integration merge** (`integration-merge.ts`): merge serial das branches elegíveis na branch de integração; reporta `branchesMerged`, `branchesPending`, `conflicts`.
- **Integration agent** (`src/orchestrator/integration-agent.ts`): quando há conflito, instancia um agente especial (id 9999) no worktree de integração para resolvê-lo via LLM.

A propriedade emergente é simples: cada stage termina com **um único commit consolidado** no integration; a stage seguinte parte desse commit. A run inteira deixa um histórico linear no integration + N branches por agente preservadas como artefato.

---

## 7. A TUI (Ink)

Hierarquia em `src/ui/components/`:

- **App** (`src/app.tsx`) — screen router: welcome → pipeline-editor → pipeline-import → model-selector → api-key → run → summary.
- **PipelineEditor** — lista de steps com `↑↓` navegar, `Shift+↑↓` reordenar, `N` novo, `D` deletar, `R` renomear pipeline, `I` importar, `S` exportar, `G` rodar, `Enter` editar step.
- **StepEditor** — edita name/prompt/files de um step. `FileMultiSelect` permite escolher arquivos do repo respeitando `.gitignore`.
- **ModelSelectorOverlay** — modo "quick" (recents/favorites/recommended) ou tabela completa via `model-selector-ink`.
- **ApiKeyPrompt** — input mascarado da OPENROUTER_API_KEY.
- **RunDashboard** — componente principal durante a execução:
  - Header: `stage X/Y · concurrency N · elapsed mm:ss · M/N done · status`.
  - **Kanban** (`ink-kanban-board`) com 3 colunas: **TODO / DOING / DONE**. Cards são agentes com título (`#id stageName`), subtítulo (arquivo atual), status colorido, metadata (modelo, branch curto, files modificados), última linha de log.
  - Atalhos: `+`/`-` ajusta concurrency, `q` aborta, `↑↓←→` navega entre cards, `Enter` abre modal de detalhe.
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

programatic-agent                                  # TUI no welcome
programatic-agent run <pipeline.json>              # autoStart até model picker
programatic-agent --stub                           # força stub (sem API key)
```

Variáveis de ambiente: `OPENROUTER_API_KEY` (ou input na TUI).

Stack: TypeScript 5.5, React 18, Ink 4.4, Zod 3.23, Vitest 1, `@mariozechner/pi-coding-agent` (latest), `ink-kanban-board` 1.1.9, `model-selector-ink` 2.

---

## 9. O loop em uma frase

Pipeline declarativa → pré-decomposição em tasks atômicas (uma por arquivo) → worker pool spawna agentes em worktrees isolados → cada agente roda com contexto mínimo no Pi SDK/OpenRouter → ao fim da stage, branches são mergeadas determinísticamente; conflitos sobem para um agente LLM dedicado → o HEAD da integração vira a base da próxima stage → no fim, o usuário recebe um histórico git auditável e um RunManifest com a trilha completa.
