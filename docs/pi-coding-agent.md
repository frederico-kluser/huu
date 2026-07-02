# Controle do Pi Coding Agent no `huu`

> Referência técnica **condensada** de como o `huu` instancia e controla
> sessões do `pi-coding-agent`. Para o schema do pipeline JSON veja
> [`pipeline-json-guide.md`](pipeline-json-guide.md); para env vars de
> runtime, Docker, secrets e auto-scaling veja
> [`operations.pt-BR.md`](operations.pt-BR.md); para primeira execução e
> escolha de backend veja [`onboarding.pt-BR.md`](onboarding.pt-BR.md).

---

## 1. Modelo mental: quem fala com quem

```
src/cli.tsx → src/app.tsx → ui/components/RunDashboard.tsx
                                   ▲ subscribe(state)
                                   │
                      src/orchestrator/index.ts  (Orchestrator)
                          worker pool · spawnAndRun(task)
                                   │ AgentFactory(...)  ◀── backends/registry.ts
                                   ▼
                   src/orchestrator/backends/pi/factory.ts
                     createAgentSession({...})    ◀── @mariozechner/pi-coding-agent
                     session.subscribe(translate) ◀── @mariozechner/pi-ai (model registry)
                     session.prompt(message)      ──▶ OpenRouter (HTTPS)
                     session.abort() / dispose()
                                   │ AgentEvent (uniformizado)
                                   ▼
                   Orchestrator.handleAgentEvent
                     ├─▶ AgentStatus (in-memory)
                     ├─▶ logs[] (UI)
                     ├─▶ RunLogger (.huu/<stamp>-…)
                     └─▶ debug-logger NDJSON (.huu/debug-…)
```

Pontos-chave:

- Os backends de agente vivem em `src/orchestrator/backends/` —
  `pi/` (default, OpenRouter), `copilot/` (`@github/copilot-sdk`),
  `stub/` (mock sem LLM), com despacho único `kind → factory` em
  `backends/registry.ts` (`selectBackend('pi' | 'copilot' | 'stub')`).
  O **único** código que fala com a SDK do Pi é `backends/pi/factory.ts`
  (+ `backends/pi/event-mapper.ts`); lógica compartilhada entre backends
  fica em `backends/_shared/`. Tudo acima da factory só conhece o
  `AgentEvent` uniformizado (`src/orchestrator/types.ts`).
- O **orchestrator** roda N agentes em paralelo via worker pool. Cada
  agente roda em seu próprio worktree git. A isolação é
  **git/filesystem/portas**, não de processo — todas as sessões Pi
  rodam no mesmo processo Node.
- O **dashboard** só lê `OrchestratorState` via `subscribe`; nunca toca
  no Pi.
- O processo Node pode estar **dentro de um container Docker** (wrapper
  `huu` no host → `docker run … huu`). Veja a skill `docker-runtime`.
- O **pipeline assistant** e o **project recon** NÃO usam Pi — usam
  LangChain.js + `ChatOpenAI` apontado pra OpenRouter (ver §11).

---

## 2. Dependências

| Pacote                          | Versão    | Papel                                            |
| ------------------------------- | --------- | ------------------------------------------------ |
| `@mariozechner/pi-coding-agent` | `0.73.1` (pin exato) | Sessão de agente: tools read/edit/write/bash |
| `@mariozechner/pi-ai`           | `0.73.1` (pin exato) | Registry de modelos + provider OpenRouter    |
| `@langchain/openai`             | `^1.4.5`  | `ChatOpenAI` (assistant/recon — **não** Pi)      |
| `zod`                           | `^3.23.0` | Schema do pipeline JSON                          |

> Versões verificadas em `package.json`. O pin é EXATO (sem caret) de
> propósito: o runtime hermético (§2.1) depende dos option-names do SDK, e um
> patch-bump silencioso poderia regredi-lo — os testes-canário de
> `hermetic.test.ts` falham alto se isso acontecer.

### 2.1 Runtime hermético (default)

O huu compõe TODA sessão pi (openrouter E azure — os dois factories passam por
`src/orchestrator/backends/pi/hermetic.ts`) de forma **hermética**: a sessão
carrega SÓ o que o huu injeta, nunca o estado do SO. Sem isso, os defaults de
`createAgentSession` leem `~/.pi/agent/settings.json` do host, resolvem a lista
`packages` via `npm root -g` e carregam **extensões `pi-*` globais** dentro dos
agentes headless do huu (foi exatamente assim que um timer solto da extensão
global `pi-animations` derrubou um fleet multi-run inteiro), além de ler
`auth.json`/`models.json` do host e auto-injetar AGENTS.md/CLAUDE.md de todos os
diretórios ancestrais até `/`.

Composição hermética (`buildPiSessionEnvironment`):

| Superfície | Hermético (default) | Legacy (`HUU_PI_HERMETIC=0`) |
| --- | --- | --- |
| Auth | `AuthStorage.inMemory()` + key da run | `~/.pi/agent/auth.json` |
| Modelos | `ModelRegistry.inMemory()` | `~/.pi/agent/models.json` |
| Settings | `SettingsManager.inMemory({})` (packages=[]) | settings.json global + do projeto |
| Extensões/skills/prompts/temas | desligados (`no*` flags) | auto-descoberta (`npm root -g`, `~/.pi`, ancestrais) |
| Contexto (AGENTS.md/CLAUDE.md) | SÓ a raiz do repo-alvo (escopado, dedupe por realpath) | todos os ancestrais até `/` + `~/.pi/agent` |
| Agent dir | `~/.huu/pi-agent` (+ `PI_CODING_AGENT_DIR` exportada só-se-unset) | `~/.pi/agent` |

O flip do contexto escopado é o default `includeRepoContext: true` no seam.
Diagnóstico: `huu status` imprime `pi runtime: <versão> · hermetic=on ·
agentDir=… ` e lista os pacotes `pi-*` globais encontrados-e-ignorados.

**Pi >= 0.70 não expõe mais `setSystemPrompt()`.** Por isso o `huu`
embute o "system prompt" como **header do user message** (ver §6). Tudo
que o agente precisa saber (papel, escopo de arquivos, branch, worktree,
portas) vai no primeiro turno como conteúdo da mensagem do usuário.

---

## 3. Comandos CLI essenciais

Definidos em `src/cli.tsx`. Subcomandos + flags globais (referência
completa de flags Docker/status/prune em
[`operations.pt-BR.md`](operations.pt-BR.md)).

| Comando                      | Faz                                                              |
| ---------------------------- | --------------------------------------------------------------- |
| `huu`                        | Abre a TUI no welcome screen                                    |
| `huu run <pipeline.json>`    | Carrega o pipeline e pula pro model picker (`autoStart=true`)   |
| `huu auto <pipeline.json>`   | Pipeline headless one-command (sem TUI)                         |
| `huu init-docker [flags]`    | Scaffold de `compose.huu.yaml`                                  |
| `huu status [flags]`         | Inspeciona o último run via `.huu/debug-*.log` (não toca git)   |
| `huu prune [flags]`          | Lista/mata containers órfãos + cidfiles stale                  |

Flags globais relevantes ao Pi:

- `--backend=<pi|copilot|stub>` — escolhe a factory (default `pi`).
  Aliases aceitos: `real|openrouter` → `pi`, `gh-copilot` → `copilot`,
  `fake|mock` → `stub` (`parseBackendKind`).
- `--stub` — atalho para `--backend=stub` (`stubAgentFactory`: não chama
  LLM; escreve `STUB_*.md`). O backend stub tem
  `conflictResolverFactory: undefined`, então **desabilita** o resolver
  de conflitos LLM (falha loud em conflito).
- `--yolo` / `--no-docker` — pula a re-exec em Docker e roda nativo (== `HUU_NO_DOCKER=1`).
- `--concurrency=N` / `--no-auto-scale` — pinam concorrência manual (o
  auto-scale por memória é o padrão; `--auto-scale` está deprecated).

`huu status` expõe `--json`, `--liveness` (exit 1 se stalled/crashed,
para o Docker HEALTHCHECK) e `--stalled-after <sec>`. Exit codes do
status: `0` running/finished, `1` stalled/crashed, `2` sem log.

---

## 4. Env vars específicas do Pi / OpenRouter

A tabela completa de env vars de runtime/Docker está em
[`operations.pt-BR.md`](operations.pt-BR.md#variáveis-de-ambiente).
Abaixo só as que tocam diretamente o controle do Pi.

### 4.1 Credencial OpenRouter

A key `openrouter` é resolvida por `src/lib/api-key.ts:resolveApiKey`
na ordem (primeiro não-vazio vence):

1. Mount `/run/secrets/openrouter_api_key` (Docker secret).
2. Arquivo apontado por `OPENROUTER_API_KEY_FILE`.
3. Var `OPENROUTER_API_KEY`.
4. Store global `~/.config/huu/config.json` (`0600`), ou
   `$XDG_CONFIG_HOME/huu/config.json` se `XDG_CONFIG_HOME` setado.

A mesma key serve a três consumidores: a sessão Pi do run, o LangChain
do pipeline assistant e os 4 agentes de project recon. Quando ausente, a
TUI abre `<ApiKeyPrompt>`. `huu --stub` bypassa tudo via
`stubAgentFactory`.

Há também `ARTIFICIAL_ANALYSIS_API_KEY` (lookups de preço/capability no
model picker — não é usada pela sessão Pi). Specs em
`src/lib/api-key-registry.ts`; adicionar uma key nova é um append na lista.

### 4.2 Geradas no worktree do agente (`.env.huu`)

Quando port allocation está ativo, o orchestrator escreve
`<worktree>/.env.huu` (ver §9): `PORT`, `HUU_PORT_HTTP/DB/WS`,
`HUU_PORT_EXTRA_1..7`, `DATABASE_URL`, `HUU_PORT_REMAP` e
`LD_PRELOAD` / `DYLD_INSERT_LIBRARIES` (+ `DYLD_FORCE_FLAT_NAMESPACE=1`
no macOS) para o bind() shim.

### 4.3 Forçadas em toda invocação git (`git/git-client.ts`)

`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=Never`, `GIT_ASKPASS=true`,
`SSH_ASKPASS=true`. Sem isso, helpers de credencial podem abrir
`/dev/tty` e roubar o stdin do Ink (raw mode), congelando a TUI.

---

## 5. Spawn de uma sessão `pi-coding-agent`

Tudo em `src/orchestrator/backends/pi/factory.ts` (`piAgentFactory`).
Sequência:

```ts
import { createAgentSession, SessionManager, AuthStorage,
         ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/huu',   // exigidos pela OpenRouter
  'X-OpenRouter-Title': 'huu',                 // pra identificar o app caller
};

// 1. valida apiKey + modelId (throw se ausentes)
// 2. auth runtime — não persiste; só vive enquanto o agente roda
const authStorage = AuthStorage.create();
authStorage.setRuntimeApiKey('openrouter', apiKey);

// 3. resolve o model object via registry da pi-ai (throw se id inexistente)
const model = getModel('openrouter', modelId as never);

// 4. ModelRegistry com headers OpenRouter
const modelRegistry = ModelRegistry.create(authStorage);
modelRegistry.registerProvider('openrouter', { headers: OPENROUTER_HEADERS });

// 5. decide thinking ('medium' | 'off') — ver §5.1
const thinkingLevel = await resolveThinkingLevel(modelId, apiKey, onEvent);

// 6. cria a sessão — tools omitidas → defaults (read, bash, edit, write)
const { session } = await createAgentSession({
  model, thinkingLevel,
  sessionManager: SessionManager.inMemory(),   // sem persistência
  authStorage, modelRegistry,
  cwd,                                          // === worktree git do agente
});

// 7. subscriber traduz eventos Pi → AgentEvent (ver §7)
const unsubscribe = session.subscribe((e) => translatePiEvent(e, onEvent));
```

O `SpawnedAgent` retornado expõe `abort()`, `prompt(message)` e
`dispose()` (contrato em `types.ts`; cleanup compartilhado via
`createDisposableState` em `backends/_shared/lifecycle.ts`):

- `prompt()` monta a mensagem completa via
  `buildAgentMessageHeader(task, message, cwd, ports, shimAvailable)`
  (em `backends/_shared/build-message.ts`, que chama
  `generateAgentSystemPrompt`) e chama `await session.prompt(fullMessage)`
  — bloqueia até estado terminal. Em seguida checa erro do estado
  (ver §8) e emite `done`.
- `abort()` — cancela cooperativo: `await session.abort()` (best-effort)
  para parar o turno em voo (Q-to-abort, kill do autoscaler).
- `dispose()` é idempotente: `unsubscribe()` + `session.dispose()`.

Notas:

- **`cwd` é o worktree git** (`.huu-worktrees/<runId>/agent-<id>/`),
  criado pelo `WorktreeManager` antes do spawn. A SDK resolve todo I/O de
  filesystem relativo a esse cwd.
- **`SessionManager.inMemory()`**: cada agente é disposable (uma sessão
  por task, sem reuso); a fonte canônica de auditoria é o log em `.huu/`.
- **Tools default**: `read`, `bash`, `edit`, `write`. O system prompt
  instrui o agente a NÃO rodar git (o orchestrator cuida) — exceto o
  integration agent, cujo prompt autoriza git (ver §6 e §10).

### 5.1 Thinking level

`resolveThinkingLevel` (`backends/pi/factory.ts` + `lib/model-factory.ts`):
retorna `'medium'` se o `modelId` casa uma heurística de prefixos
(`anthropic/claude`, `openai/o1|o3|o4|gpt-5`, `google/gemini-2.5|3`,
`deepseek/deepseek-r1`, `x-ai/grok-4`, `qwen/qwen3`, … ou qualquer id
terminando em `:thinking` — via `supportsThinking`); caso contrário faz
`GET https://openrouter.ai/api/v1/models` (`fetchModelCapabilities`) e
checa `supported_parameters` por `"reasoning"`; senão `'off'`. Se o probe
de capabilities falhar (rede/5xx/rate limit), emite log `warn` e cai pra
`'off'` (em vez de silenciosamente pagar por thinking sem recebê-lo).
Response cacheado em memória (`lib/openrouter.ts`).

---

## 6. System prompt enviado ao agente (exemplo)

Gerado por `generateAgentSystemPrompt`
(`src/orchestrator/agents-md-generator.ts`). Existem três templates:
**per-file**, **whole-project** e **integration**. Como Pi >= 0.70 não
tem `setSystemPrompt`, este texto vai como **header do primeiro user
message**, seguido do prompt do usuário.

Exemplo per-file (agentId 3, `files=["src/lib/auth.ts"]`, branch
`huu/k3l9m2p1/agent-3`, port bundle + shim ativos):

```markdown
# Agent 3 — Refactoring Session

## Your Role
You are Agent 3 in a multi-agent refactoring orchestrator. You have been
assigned specific files to refactor. Focus exclusively on your assigned files.

## Assigned Files
- src/lib/auth.ts

## Refactoring Instructions
<PROMPT DO USUÁRIO, com $file já substituído por src/lib/auth.ts>

## Git Context
- **Branch**: `huu/k3l9m2p1/agent-3`
- **Worktree**: `.huu-worktrees/k3l9m2p1/agent-3`
- You are working in an isolated worktree.
- Do NOT run git commands — the orchestrator handles all Git operations.

## Port Allocation
**bind() interception is active.** Even if the code calls `app.listen(3000)`
literally, the kernel receives your allocated port instead.
- `PORT` / `HUU_PORT_HTTP` = 55120 · `HUU_PORT_DB` = 55121 · `HUU_PORT_WS` = 55122
- `DATABASE_URL` = postgresql://localhost:55121/huu_agent_3
Regras: nunca hardcode portas; frameworks dotenv carregam `.env.huu`
automaticamente; para binários que ignoram dotenv use
`./.huu-bin/with-ports <comando>`.

## Rules
1. ONLY modify files from your assigned list above.
2. Do NOT create new files unless absolutely necessary.
3. Do NOT modify files outside your assignment.
4. Do NOT run git commands.
5. Preserve existing public APIs unless the refactoring requires changes.
6. Maintain or improve test coverage if tests exist.
7. Follow the existing code style.
8. After each file, note what changed and why.

## Workflow
Read → plan → apply via edit tool (one file at a time) → verify → report summary.

## Completion
Summarize: which files were modified, what changed, and any concerns.
```

Diferenças dos outros templates:

- **whole-project** (`files: []`): "no file-scope restriction — you may
  read and modify any file"; mesmas regras de git/APIs/coverage.
- **integration** (agentId 9999): inverte a regra crítica — **autoriza
  git** ("Run git commands as instructed (merge, stage, commit)"; "do
  NOT discard changes from any branch"). Ver §10.

---

## 7. Eventos do Pi: tradução

A SDK emite eventos via `session.subscribe(handler)`. `translatePiEvent`
(`backends/pi/event-mapper.ts`) é o **único ponto** que converte o schema
da SDK no `AgentEvent` interno (lido defensivamente — a SDK não exporta
tipos runtime-estáveis e minor versions já remodelaram os payloads):

| Pi event                | Tradução                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `agent_start`           | `state_change → 'streaming'` + log `agent started`                   |
| `tool_execution_start`  | `state_change → 'tool_running'` + log `tool: <name> → <file>`. Se tool ∈ `WRITE_TOOLS` e tem path → emite **também** `file_write { file }`. |
| `tool_execution_end`    | `state_change → 'streaming'`; em erro, log nível `error`             |
| `message_end`           | extrai `usage` da `AssistantMessage` → emite `usage {…}` estruturado **e** log `tokens +Nin +Mout [+cr +cw] $X` (ver §8.1) |
| `agent_end`             | log `agent finished` — **NÃO** dispara `done` (ver §8)               |
| `auto_compaction_start` | log nível `warn` com a razão                                        |
| `auto_retry_start/end`  | log `warn` `pi auto-retry N/M` / recovered ou exhausted             |
| `error`                 | `error { message }` propagado pro orchestrator                       |

Tipos não reconhecidos são silenciosamente ignorados (sem default no
switch).

`AgentEvent` interno (`orchestrator/types.ts`):

```ts
type AgentEvent =
  | { type: 'log'; level?: 'info'|'warn'|'error'; message: string }
  | { type: 'state_change'; state: 'streaming' | 'tool_running' }
  | { type: 'file_write'; file: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number;
      cacheReadTokens?: number; cacheWriteTokens?: number;
      cost?: number; model?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

Detecção de write (`backends/_shared/write-tools.ts`, compartilhada com
Copilot via `isWriteTool`, case-insensitive):
`WRITE_TOOLS = { edit, write, create, patch,  edit_file, str_replace,
create_file, write_file, apply_patch }`. Path extraído de
`args.path | args.file_path | args.filePath` (`extractFileFromArgs` —
SDKs/modelos nomeiam o argumento diferente). `file_write` alimenta
`AgentStatus.filesModified`.

O contrato `AgentFactory` (assinatura `(task, config, systemPromptHint,
cwd, onEvent, runtimeContext?) => Promise<SpawnedAgent>`) é a fronteira
entre o orchestrator (que não conhece o Pi) e a factory do backend. O
`stubAgentFactory` (`backends/stub/factory.ts`) implementa o mesmo
contrato com sleep + `writeFileSync` de `STUB_<stage>_<id>.md`.

---

## 8. Detecção de término (sinais "acabou")

O `done` só é emitido quando **`session.prompt()` resolve limpo** — NÃO
no evento `agent_end` da SDK (isso quebraria agentes multi-turn e
causaria double-finalize).

No pi 0.73.x a maioria dos erros de provider já chega via **rejection do
`prompt()`** (o fix 0.71 para truncamento de SSE da Anthropic), mas o
getter público `AgentState.errorMessage` ainda é setado em turnos
aborted/error. Por isso, após a resolução, o `huu` lê esse getter
público (sem cast) e re-lança se houver:

```ts
try {
  await session.prompt(fullMessage);
} catch (err) {
  onEvent({ type: 'error', message: String(err) });
  throw err;
}
const stateErr = session.state.errorMessage;   // getter público
if (stateErr) {
  onEvent({ type: 'error', message: stateErr });
  throw new Error(stateErr);
}
onEvent({ type: 'done' });
```

> O doc original cavava `(session as any).state.messages[-1].stopReason`
> — desatualizado: a versão atual lê o getter público
> `session.state.errorMessage`.

Em cima disso, o orchestrator aplica um **timeout por card** via
`withTimeout(agent.prompt(...), timeoutMs)`; em timeout chama
`agent.abort()` (cancel cooperativo). Não há "timeout total" de pipeline
(ver Armadilhas).

### 8.1 Tokens & custo

`message_end` extrai `usage` da `AssistantMessage` e emite **dois**
eventos: um `usage {…}` estruturado (input/output/cacheRead/cacheWrite/
cost/model) que o orchestrator acumula em `AgentStatus`, e um `log`
humano `tokens +Nin +Mout [+Ncr +Ncw] $X`.

> O doc original dizia que esses campos "ficam zerados" e que só existia a
> linha de log — **desatualizado**: o evento `usage` agora existe
> (`types.ts`) e é acumulado. Ainda assim, a linha de log é a forma mais
> fácil de somar custo a posteriori:

```bash
grep -E 'tokens \+[0-9]+in' .huu/*-execution-*.log
```

---

## 9. Captura de logs e port allocation (resumo)

### 9.1 Cinco trilhos de log paralelos

1. `AgentStatus.logs[]` (cap 100) — card do kanban + modal.
2. `OrchestratorState.logs[]` (cap 1000, FIFO) — sidebar `LogArea`.
   `agentId = -1` é o orchestrator; `9999` é o integrator.
3. **RunLogger** (`src/lib/run-logger.ts`) — escreve em
   `.huu/<stamp>-execution-<runId>.log` (cronológico, header + stream
   merged, **sem cap**) + diretório irmão com `orchestrator.log`,
   `integrator.log`, `agent-<id>.log`.
4. **debug-logger NDJSON** (`src/lib/debug-logger.ts`) — heartbeat (200ms)
   + lifecycle em `.huu/debug-*.log`; é o que `huu status` parseia.
5. Eventos brutos (`state_change`, `file_write`, `done`) intercalados no
   RunLogger.

> Para auditoria completa vá sempre ao
> `.huu/<stamp>-execution-<runId>.log` — o dashboard é uma view, não a
> fonte de verdade.

### 9.2 Port allocator + `.env.huu` + bind() shim

`src/orchestrator/port-allocator.ts` reserva uma janela contígua de
portas TCP por agente (defaults: base `55100`, window `10`, `SLOTS_PER_BUNDLE
10`, max 20 agentes). Probe TCP exclusivo em `127.0.0.1`; se um slot está
ocupado, a janela inteira desliza.

`src/orchestrator/agent-env.ts` materializa no worktree:

- **`.env.huu`** — `PORT`, `HUU_PORT_HTTP/DB/WS`, `HUU_PORT_EXTRA_1..7`,
  `DATABASE_URL`, `HUU_PORT_REMAP` (mapa consumido pelo shim) e
  `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES`.
- **`.huu-bin/with-ports`** — shell shim que dá `source .env.huu` e
  `exec "$@"`, para binários que ignoram dotenv.

O **native shim** (`native-shim.ts`) compila `libhuu_bind.{so,dylib}`
on-demand em `.huu-cache/native-shim/`, intercepta `bind(2)` e remapeia
portas conforme `HUU_PORT_REMAP` — assim até `app.listen(3000)` literal
cai na porta do agente. Quando indisponível (ex: container sem gcc), o
orchestrator emite warning e segue sem injection. Detalhes na skill
`port-isolation`; visão geral do usuário em
[`operations.pt-BR.md`](operations.pt-BR.md#isolamento-de-portas-visão-geral).

---

## 10. Integration agent (resolução de conflitos)

Quando merges determinísticos (`git/integration-merge.ts`) falham por
**conflito**, o orchestrator respawna uma sessão Pi com role/prompt
diferentes (`src/orchestrator/integration-agent.ts`,
`runStageIntegrationWithResolver`):

1. Tenta merge determinístico branch a branch (por `agentId`), registra
   conflicts e dá `abortMerge` em falha.
2. Se `done` → sucesso, agente Pi **não é spawnado**.
3. `branchesPending` sem conflicts → falha por outro motivo (timeout,
   hook) → retorna `error` sem chamar Pi.
4. Com conflicts → spawna Pi via a `conflictResolverFactory` do backend
   (`backends/registry.ts`; para `pi`/`copilot` é a própria factory do
   backend), `agentId = 9999` (`INTEGRATION_AGENT_ID`), `cwd` no
   integration worktree.
5. Pós-execução: re-tenta `git merge` final por branch pendente (aceita
   "Already up to date"); falha loud se restou conflito.
6. Gera commit-sentinela `[huu] Integration merge — <runId>` se houver
   changes não-commitadas.

Diferenças vs. agente normal: roda no integration worktree, system
prompt **autoriza git** (§6), prompt estruturado em XML
(`buildIntegrationPrompt` / `src/prompts/integration-task.ts`: `<task>`,
`<merged>`, `<pending>`, `<conflicts>`, `<resolution-steps>`,
`<output>`), eventos carimbados com `agentId 9999` → `integrator.log`.

O backend `stub` desabilita esse caminho
(`conflictResolverFactory: undefined` em `registry.ts`): stub agents não
resolvem merges reais, então o orchestrator falha loud no conflito.

---

## 11. Assistant + recon (LangChain, NÃO Pi)

> O pipeline assistant e o project recon **não** usam Pi. Usam
> LangChain.js + `ChatOpenAI` apontando pra OpenRouter
> (`src/lib/assistant-client.ts`, `src/lib/project-recon.ts`). O fluxo
> antigo `interactive: true` + `refinementModel` por step foi revertido
> (commit `9647ef6`); o schema v1 atual **não** aceita esses campos.

- **Project recon**: `buildProjectDigest()` monta um snapshot estático
  (file tree + `package.json` + `README`/`CLAUDE`/`AGENTS.md` +
  `tsconfig`), e 4 `ChatOpenAI` em paralelo (`stack`, `structure`,
  `libraries`, `conventions`) retornam `ReconBullets` (Zod). Modo
  **passo único**, sem chain-of-thought (endurecido em `c041dd3`).
  Digest-only: não toca arquivos.
- **Assistant chat** (≤8 turnos): `createAssistantChat()` com
  `withStructuredOutput(AssistantTurnSchema)` — cada turn é uma pergunta
  multiple-choice ou um `done` com `PipelineDraft`. Após `MAX_TURNS=8` um
  nudge força `done`. A draft vira `Pipeline` (steps com `files: []`) em
  memória até o `PipelineEditor`.

Por que separar do Pi: o Pi é otimizado para **execução com tools** —
caro/overkill para Q&A puro com saída structured.

---

## 12. Sinais externos: abort / dispose

- **`Q` no dashboard** (`RunDashboard.tsx`): primeiro `Q` → abort
  gracioso (`orch.abort()`); segundo → exit imediato.
- **`Orchestrator.abort()`**: dispara cancel/dispose nos agentes ativos,
  libera portas, acorda o pool.
- **`SpawnedAgent.abort()`** (Pi): `await session.abort()` — cancel
  cooperativo do turno em voo (best-effort; o `dispose()` ainda roda
  depois).
- **`SpawnedAgent.dispose()`** (Pi): via `createDisposableState` —
  `unsubscribe()` (remove o subscriber do Pi) + `session.dispose()`
  (fecha streams, cancela fetch pendente). Idempotente (flag `disposed`
  centralizada, cleanups com erros engolidos); `prompt()` após dispose
  lança `'agent already disposed'` (`assertLive`).
- **Sinais de processo** (`cli.tsx`): SIGINT/SIGTERM/SIGHUP +
  `uncaughtException`/`unhandledRejection` chamam `restoreTerminal()`
  (raw mode off, mostra cursor, desliga mouse tracking) e
  `clearActiveRunSentinel()`. O debug-logger registra o sinal antes do
  exit, deixando rastro pós-crash.

---

## 13. Inspeção pós-mortem

- **`huu status`** (`src/lib/status.ts`): parseia o NDJSON de
  `.huu/debug-*.log` (não toca git/Pi). Reduz a fase para
  `running | finished | stalled | crashed | unknown` e expõe contadores
  (`stagesAdvanced`, `spawns`, `errors`), heartbeat lag, exit/crash.
  Lê só a cauda do arquivo (`tailFile`, 256 KiB).
- **Sentinel `/tmp/huu/active`** (`lib/active-run-sentinel.ts`): grava o
  cwd absoluto no boot, removido no exit. Resolve o Docker HEALTHCHECK
  (o probe começa em `/`, não no WORKDIR):
  `[ -f /tmp/huu/active ] && cd "$(cat /tmp/huu/active)"; exec huu status --liveness`.
- **`huu prune`** (`src/lib/prune.ts`): mata containers com label
  `huu.orphan=true` cujo `huu.parent-pid` está morto, e cidfiles stale em
  `/tmp/huu/cidfiles/`. Probe de PID via `process.kill(pid, 0)` (`ESRCH`
  = gone, `EPERM` = vivo). Modos `--list`/`--dry-run`/`--json`.

---

## 14. Defaults numéricos

| Constante                         | Valor             | Onde                       |
| --------------------------------- | ----------------- | -------------------------- |
| `DEFAULT_CONCURRENCY`             | `10`              | `orchestrator/index.ts`    |
| `MAX_INSTANCES` / `MIN_INSTANCES` | `20` / `1`        | `orchestrator/index.ts`    |
| `DEFAULT_RAM_PERCENT`             | `85` (dial de budget; clamp 10–95)         | `lib/budget.ts`               |
| `DEFAULT_AGENT_MEMORY_ESTIMATE_MB` | `1536` (seed pessimista; clamp 128–2048)  | `orchestrator/auto-scaler.ts` |
| `DEFAULT_ADMIT_PSI`               | `0.5` (freio de admissão PSI some-avg10 %) | `orchestrator/auto-scaler.ts` |
| `DEFAULT_OOM_SCORE_ADJ`           | `-100` (conservador)                       | `lib/oom-score.ts`            |
| `POLL_INTERVAL_MS`                | `500`             | `orchestrator/index.ts`    |
| `STATE_FLUSH_INTERVAL_MS`         | `125` (8 Hz)      | `RunDashboard.tsx`         |
| `DEFAULT_CARD_TIMEOUT_MS`         | `600_000` (10min) | `lib/types.ts`             |
| `DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS` | `300_000` (5min) | `lib/types.ts`         |
| `DEFAULT_MAX_RETRIES`             | `1`               | `lib/types.ts`             |
| `DEFAULT_BASE_PORT` / window      | `55100` / `10`    | `port-allocator.ts`        |
| `INTEGRATION_AGENT_ID`            | `9999`            | `integration-agent.ts`     |
| `HEARTBEAT_MS`                    | `200`             | `lib/debug-logger.ts`      |

> **Nota (stale na skill):** `pipeline-agents/SKILL.md` lista
> concurrency `default = 2`; o código está em `10`
> (`DEFAULT_CONCURRENCY`). Confiar no código.

---

## 15. Armadilhas

- **`agent_end` não dispara `done`** — só `session.prompt()` resolvendo
  limpo dispara. Não mude isso (quebra multi-turn).
- **`setSystemPrompt` não existe** em Pi >= 0.70 — embuta no header da
  mensagem (`buildAgentMessageHeader` em `backends/_shared/`).
- **`WRITE_TOOLS` é heurística** — se o Pi/Copilot adicionar `replace`,
  `multi_edit`, etc., atualize o Set em `backends/_shared/write-tools.ts`
  ou `filesModified` fica incorreto.
- **`session.state.errorMessage` é o canal de erro pós-resolução** — se a
  SDK parar de setar esse getter público, o re-throw para de funcionar e
  o agente parece ter sucesso quando falhou. (O cast não-tipado
  `(session as any).state` do código antigo foi removido.)
- **Timeouts são por card**, não por pipeline — 50 stages podem rodar por
  horas.
- **Tokens/cost dependem do evento `usage`** (`message_end`) — se a SDK
  parar de expor `usage`, `AgentStatus` volta a zerar (ver §8.1).
- **`commitNoVerify`** ignora pre-commit hooks — rode lint num stage
  explícito se depende deles.
- **`ensureGitignored`** edita `.gitignore` no `start()` sem opt-out
  (`.huu-worktrees/`, `.huu/`, `.env.huu`, `.huu-bin/`, `.huu-cache/`).
- **`HUU_NO_DOCKER=1` expõe credenciais host** ao agente Pi
  (acesso ao filesystem inteiro: `~/.ssh`, `~/.aws`, `.env`). Use só em
  dev/CI controlado.

---

## Apêndice: arquivos-chave

| Arquivo                                    | O que tem                                   |
| ------------------------------------------ | ------------------------------------------- |
| `src/orchestrator/backends/pi/factory.ts`  | **Único** ponto de contato com a SDK Pi     |
| `src/orchestrator/backends/pi/event-mapper.ts` | `translatePiEvent` (Pi event → AgentEvent) |
| `src/orchestrator/backends/registry.ts`    | Despacho `kind → factory` (pi/copilot/stub) |
| `src/orchestrator/backends/_shared/`       | `build-message`, `lifecycle`, `write-tools` |
| `src/orchestrator/backends/stub/factory.ts`| Implementação fake do mesmo contrato        |
| `src/orchestrator/backends/copilot/`       | Backend GitHub Copilot (`@github/copilot-sdk`) |
| `src/orchestrator/types.ts`                | Contrato `AgentFactory` + `AgentEvent`      |
| `src/orchestrator/index.ts`                | Orchestrator (pool, lifecycle, finalize)    |
| `src/orchestrator/integration-agent.ts`    | Spawn especial do merge resolver            |
| `src/orchestrator/agents-md-generator.ts`  | System prompts (normal + integrator)        |
| `src/orchestrator/agent-env.ts`            | `.env.huu` + `.huu-bin/with-ports`          |
| `src/orchestrator/port-allocator.ts`       | Janela TCP por agente                       |
| `src/orchestrator/native-shim.ts`          | Compila `libhuu_bind.{so,dylib}`            |
| `src/lib/api-key.ts` / `api-key-registry.ts` | Resolução secret → file → env             |
| `src/lib/model-factory.ts` / `openrouter.ts` | Thinking + capabilities/key validation    |
| `src/lib/run-logger.ts` / `debug-logger.ts` | Persistência humana + NDJSON heartbeat     |
| `src/lib/status.ts` / `active-run-sentinel.ts` | `huu status` + sentinel HEALTHCHECK      |
| `src/lib/assistant-client.ts` / `project-recon.ts` | LangChain (assistant/recon — não Pi)  |
| `src/prompts/integration-task.ts`          | XML prompt do integration agent             |

---

**Versões auditadas** (`package.json`):
`@mariozechner/pi-coding-agent ^0.73.1` ·
`@mariozechner/pi-ai ^0.73.1` · `@langchain/openai ^1.4.5`.
