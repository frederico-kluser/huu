# Controle do Pi Coding Agent no `huu`

> Levantamento exaustivo de **tudo** que o `huu` usa para controlar
> instâncias do `pi-coding-agent` (a SDK da Mario Zechner que envelopa
> modelos LLM com tools de filesystem/bash) — desde como instanciamos
> uma sessão, como passamos prompts, como consumimos eventos, como
> persistimos logs, como detectamos término, até as ações disparadas em
> cada transição de estado.
>
> Escrito a partir de leitura linha-a-linha do código. Onde citamos
> arquivos, usamos `path:linha` para você poder pular direto. Onde houver
> um exemplo de código, ele foi extraído do repositório verbatim ou
> adaptado fielmente.

---

## Sumário

1. [TL;DR — exemplos rápidos](#1-tldr--exemplos-rápidos)
2. [Modelo mental: quem fala com quem](#2-modelo-mental-quem-fala-com-quem)
3. [Dependências e versões](#3-dependências-e-versões)
4. [Comandos CLI — referência completa](#4-comandos-cli--referência-completa)
5. [Variáveis de ambiente — referência completa](#5-variáveis-de-ambiente--referência-completa)
6. [Pipeline JSON: schema Zod + exemplos](#6-pipeline-json-schema-zod--exemplos)
7. [Configuração de entrada (API key, modelo, thinking)](#7-configuração-de-entrada-api-key-modelo-thinking)
8. [Spawn de uma sessão `pi-coding-agent`](#8-spawn-de-uma-sessão-pi-coding-agent)
9. [System prompt enviado ao agente — exemplo completo](#9-system-prompt-enviado-ao-agente--exemplo-completo)
10. [O contrato `AgentFactory` / `SpawnedAgent`](#10-o-contrato-agentfactory--spawnedagent)
11. [Eventos do Pi: assinatura, tradução e schema interno](#11-eventos-do-pi-assinatura-tradução-e-schema-interno)
12. [Captura de logs (cinco caminhos paralelos)](#12-captura-de-logs-cinco-caminhos-paralelos)
13. [Detecção de término (sinais "acabou")](#13-detecção-de-término-sinais-acabou)
14. [Ações disparadas em cada transição](#14-ações-disparadas-em-cada-transição)
15. [Ciclo de vida fim-a-fim de um agente](#15-ciclo-de-vida-fim-a-fim-de-um-agente)
16. [Trace real: walkthrough cronológico de um run](#16-trace-real-walkthrough-cronológico-de-um-run)
17. [GitClient: API e por que `execFile`](#17-gitclient-api-e-por-que-execfile)
18. [Preflight: o que é validado antes do run](#18-preflight-o-que-é-validado-antes-do-run)
19. [Worktree, branch naming e isolamento](#19-worktree-branch-naming-e-isolamento)
20. [Port allocator + `.env.huu` + native shim (`bind()` interceptor)](#20-port-allocator--envhuu--native-shim-bind-interceptor)
21. [Caso especial: integration agent (resolução de conflitos)](#21-caso-especial-integration-agent-resolução-de-conflitos)
22. [Pipeline assistant + project recon (LangChain.js — não é Pi)](#22-pipeline-assistant--project-recon-langchainjs--não-é-pi)
23. [Sinais externos: SIGINT/SIGTERM, abort, dispose](#23-sinais-externos-sigintsigterm-abort-dispose)
24. [Token tracking & cost — caveat importante](#24-token-tracking--cost--caveat-importante)
25. [Inspeção pós-mortem: `huu status`, `.huu/`, sentinel](#25-inspeção-pós-mortem-huu-status-huu-sentinel)
26. [Cleanup orphan (`huu prune`)](#26-cleanup-orphan-huu-prune)
27. [Catálogo de eventos, fases e estados](#27-catálogo-de-eventos-fases-e-estados)
28. [Tests: como exercitar agentes (stub e real)](#28-tests-como-exercitar-agentes-stub-e-real)
29. [Recipes — extensão prática (com código)](#29-recipes--extensão-prática-com-código)
30. [Pontos de extensão e armadilhas](#30-pontos-de-extensão-e-armadilhas)
31. [Apêndice: arquivos-chave em ordem de importância](#apêndice-arquivos-chave-em-ordem-de-importância)

---

## 1. TL;DR — exemplos rápidos

### 1.1 Rodar um pipeline existente

```bash
# Pipeline real (LLM, requer OPENROUTER_API_KEY ou Docker secret)
huu run pipelines/refactor.pipeline.json

# Stub: não chama LLM, escreve STUB_*.md em cada worktree
huu --stub run pipelines/refactor.pipeline.json

# Verificar status do run em curso (lê .huu/debug-*.log)
huu status
huu status --json
huu status --liveness     # exit 1 se stalled/crashed (Docker HEALTHCHECK)

# Limpar containers Docker órfãos
huu prune --list
huu prune
```

### 1.2 Pipeline JSON mínimo

```json
{
  "_format": "huu-pipeline-v1",
  "pipeline": {
    "name": "exemplo",
    "steps": [
      {
        "name": "Stage A",
        "prompt": "Adicione um header JSDoc em $file",
        "files": ["src/cli.tsx", "src/app.tsx"]
      },
      {
        "name": "Stage B",
        "prompt": "Atualize CHANGELOG.md com o trabalho do stage anterior",
        "files": []
      }
    ]
  }
}
```

### 1.3 Snippet 30-segundos do que acontece quando o agente Pi roda

```ts
// src/orchestrator/real-agent.ts (resumido)
import { createAgentSession, SessionManager, AuthStorage,
         ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';

const auth = AuthStorage.create();
auth.setRuntimeApiKey('openrouter', apiKey);

const model = getModel('openrouter', modelId);
const reg   = ModelRegistry.create(auth);
reg.registerProvider('openrouter', { headers: OPENROUTER_HEADERS });

const { session } = await createAgentSession({
  model, thinkingLevel: 'medium',
  sessionManager: SessionManager.inMemory(),
  authStorage: auth, modelRegistry: reg,
  cwd: agentWorktreePath,            // worktree git isolado
});

const unsubscribe = session.subscribe((event) => translateEvent(event, onEvent));
await session.prompt(systemHeader + userPrompt);   // bloqueia até terminal state
unsubscribe();
session.dispose();
```

---

## 2. Modelo mental: quem fala com quem

```
┌────────────────────────────────────────────────────────────────────┐
│   src/cli.tsx  ──▶ src/app.tsx  ──▶ ui/components/RunDashboard.tsx │
│                                                ▲                   │
│                                                │ subscribe(state)  │
│                                                ▼                   │
│                              src/orchestrator/index.ts             │
│                                  (Orchestrator)                    │
│                              ┌────────────────────┐                │
│                              │  worker pool       │                │
│                              │  spawnAndRun(task) │                │
│                              └─────────┬──────────┘                │
│                                        │ AgentFactory(...)         │
│                                        ▼                           │
│                       src/orchestrator/real-agent.ts               │
│                       ┌──────────────────────────────┐             │
│                       │ createAgentSession({...})    │ ◀── @mariozechner/pi-coding-agent
│                       │ session.subscribe(translate) │ ◀── @mariozechner/pi-ai (model registry)
│                       │ session.prompt(message)      │             │
│                       │ session.dispose()            │             │
│                       └──────────────┬───────────────┘             │
│                                      │ AgentEvent (uniformizado)   │
│                                      ▼                             │
│                              Orchestrator.handleAgentEvent         │
│                              ├─▶ AgentStatus  (in-memory)          │
│                              ├─▶ logs[] (orchestrator UI)          │
│                              ├─▶ RunLogger (.huu/<stamp>-…)        │
│                              └─▶ debug-logger NDJSON (.huu/debug-) │
└────────────────────────────────────────────────────────────────────┘
```

Pontos-chave:

- O **único arquivo** que fala diretamente com a SDK do Pi é
  `src/orchestrator/real-agent.ts`. Tudo acima dele só conhece o
  `AgentEvent` uniformizado declarado em
  `src/orchestrator/types.ts:4-9`.
- O **orchestrator** (`src/orchestrator/index.ts`) opera N agentes em
  paralelo via worker pool. Cada agente roda em seu próprio worktree git
  isolado. A "isolação" é **git/filesystem/portas**, não de processo —
  todas as sessões Pi rodam dentro do mesmo processo Node.
- O **dashboard** (`RunDashboard.tsx`) só lê `OrchestratorState` via
  `subscribe`; ele nunca toca em nada do Pi diretamente.
- O processo Node em si pode estar **dentro de um container Docker** se
  for invocado via wrapper (`huu` no host → `docker run … huu` dentro do
  container). Veja a skill `docker-runtime` para o lifecycle do wrapper.

---

## 3. Dependências e versões

Versões pinadas em `package.json:42-50`:

| Pacote                              | Versão     | Papel                                                  |
| ----------------------------------- | ---------- | ------------------------------------------------------ |
| `@mariozechner/pi-coding-agent`     | `^0.70.6`  | Sessão de agente: tools (read/edit/write/bash), loop  |
| `@mariozechner/pi-ai`               | `^0.70.6`  | Registry de modelos + provider OpenRouter             |
| `@langchain/core`                   | `^1.1.42`  | Mensagens (Human/AI/System) — usado **só** no refiner |
| `@langchain/openai`                 | `^1.4.5`   | `ChatOpenAI` apontado pra OpenRouter                  |
| `ink` + `react`                     | `^4.4.1`   | TUI                                                    |
| `model-selector-ink`                | `^3.1.0`   | UI overlay de seleção de modelo                       |
| `nanoid`                            | `^5.0.0`   | runId de 8 chars                                       |
| `zod`                               | `^3.23.0`  | schema do pipeline JSON                               |

**Nota sobre Pi >= 0.70:** a SDK não expõe mais `setSystemPrompt()`. Por
isso o `huu` embute o "system prompt" como **header do user message**
(`real-agent.ts:104-124`). Tudo que o agente precisa saber sobre seu
papel, escopo de arquivos, branch, worktree e portas vai no primeiro
turno como conteúdo da mensagem do usuário.

---

## 4. Comandos CLI — referência completa

Definidos em `src/cli.tsx:67-96`. Quatro subcomandos + flags globais.

### 4.1 Subcomandos

| Comando                       | Faz                                                                  |
| ----------------------------- | -------------------------------------------------------------------- |
| `huu`                         | Abre TUI no welcome screen                                           |
| `huu run <pipeline.json>`     | Carrega o pipeline e pula direto pro model picker (`autoStart=true`) |
| `huu init-docker [...flags]`  | Scaffold de `compose.huu.yaml` no repo atual                         |
| `huu status [...flags]`       | Inspeciona o último run via `.huu/debug-*.log` (não toca em git)    |
| `huu prune [...flags]`        | Lista/mata containers órfãos + cidfiles stale                       |
| `huu --help` / `-h`           | Print do usage                                                       |

### 4.2 Flags globais

| Flag             | Efeito                                                              |
| ---------------- | ------------------------------------------------------------------- |
| `--stub`         | Usa `stubAgentFactory` (não chama LLM). Conflict resolver é desligado. |
| `--yolo`         | Pula a re-exec em Docker e roda nativo (== `HUU_NO_DOCKER=1`). Imprime warning de segurança no stderr. Compõe com tudo: `huu --yolo run x.json`, `huu --yolo --stub`. |
| `--auto-scale`   | Liga, no startup, o `AutoScaler` de concorrência. Mesmo efeito da tecla `A` no dashboard. |
| `--help` / `-h`  | Imprime uso + variáveis de ambiente do registry. |

### 4.3 `huu init-docker` flags

| Flag                       | Efeito                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `--force`                  | Sobrescreve arquivos existentes                                 |
| `--with-wrapper`           | Também escreve `scripts/huu-docker` (bash launcher)             |
| `--with-devcontainer`      | Também escreve `.devcontainer/devcontainer.json`                |
| `--image <ref>`            | Override da imagem (default `ghcr.io/frederico-kluser/huu:latest`) |

### 4.4 `huu status` flags

| Flag                       | Efeito                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `--json`                   | Output machine-readable                                         |
| `--liveness`               | Suprime output; exit 0 se running/finished, 1 se stalled/crashed (HEALTHCHECK) |
| `--stalled-after <sec>`    | Threshold de stall (default 30s)                                |

### 4.5 `huu prune` flags

| Flag           | Efeito                                                          |
| -------------- | --------------------------------------------------------------- |
| `--list`       | Mostra containers + cidfiles stale, exit 0 (sem mutação)        |
| `--dry-run`    | Mostra o que mataria, exit 0                                     |
| `--json`       | Output machine-readable (combina com `--list`/`--dry-run`)      |

### 4.6 npm scripts (durante desenvolvimento) — `package.json:33-41`

```bash
npm run dev          # tsx --watch src/cli.tsx
npm start            # tsx src/cli.tsx
npm run build        # tsc + chmod +x dist/cli.js
npm run build:link   # build + npm link + link pipelines globais
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run test:watch   # vitest
npm run release-notes  # git log desde a última tag
```

---

## 5. Variáveis de ambiente — referência completa

Levantamento exaustivo de **todas** as env vars que o `huu` lê.

### 5.1 Configuração de credencial

A partir do commit `c7de3af`, todas as keys são declaradas em
`src/lib/api-key-registry.ts`. O resolver genérico
(`src/lib/api-key.ts:resolveApiKey`) aplica a mesma precedência pra
todas, e o `ApiKeyPrompt` lê o array pra descobrir o que perguntar.
Adicionar uma key nova é um append na lista, sem outros call-sites.

Registry atual:

| Spec (`name`)         | env var primária              | `_FILE` companion                  | mount no container                                | required |
| --------------------- | ----------------------------- | ---------------------------------- | -------------------------------------------------- | -------- |
| `openrouter`          | `OPENROUTER_API_KEY`          | `OPENROUTER_API_KEY_FILE`          | `/run/secrets/openrouter_api_key`                  | `true`   |
| `artificialAnalysis`  | `ARTIFICIAL_ANALYSIS_API_KEY` | `ARTIFICIAL_ANALYSIS_API_KEY_FILE` | `/run/secrets/artificial_analysis_api_key`         | `true`   |

`openrouter` é usado pelo Pi SDK durante o run, pelo LangChain do
pipeline assistant e pelos 4 agentes de project recon.
`artificialAnalysis` alimenta lookups de capability/preço no model
picker.

Resolução em ordem (primeiro não-vazio vence) — aplica para qualquer
spec do registry:

1. Mount `secretMountPath` (ex.: `/run/secrets/openrouter_api_key`)
2. Arquivo apontado por `<NAME>_FILE` (ex.: `OPENROUTER_API_KEY_FILE`)
3. Var `<NAME>` (ex.: `OPENROUTER_API_KEY`)
4. Store global em `~/.config/huu/config.json` (mode `0600` em diretório
   `0700`), populado quando o usuário aceita "Save globally" no
   `ApiKeyPrompt`. Path muda quando `XDG_CONFIG_HOME` está setado
   (`$XDG_CONFIG_HOME/huu/config.json`).

### 5.2 Modo de execução

| Var                       | Default              | Efeito                                              |
| ------------------------- | -------------------- | --------------------------------------------------- |
| `HUU_IN_CONTAINER`        | unset                | Quando `=1`, gateway de re-exec Docker é skippado    |
| `HUU_NO_DOCKER`           | unset                | Quando `=1`, nunca re-executa em Docker (modo nativo). Equivalente a `--yolo` na CLI. |
| `HUU_IMAGE`               | `ghcr.io/frederico-kluser/huu:latest` | Imagem usada no re-exec |
| `HUU_CHECK_PUSH`          | unset                | Quando `=1`, preflight faz `git push --dry-run`     |
| `HUU_WORKTREE_BASE`       | `<repoRoot>/.huu-worktrees` | Path base alternativo pra worktrees           |
| `HUU_DOCKER_PASS_ENV`     | unset                | Lista de env vars (whitespace-separated) extras pra forwardar pro container |
| `HUU_UID` / `HUU_GID`     | `1000`               | UID/GID usado em `docker compose run` (override em hosts onde o user não é 1000) |
| `XDG_CONFIG_HOME`         | unset                | Quando setado, redireciona o store de keys persistidas pra `$XDG_CONFIG_HOME/huu/config.json` |

### 5.3 Geradas dentro do worktree do agente

Quando port allocation está habilitado, o orchestrator escreve
`<worktree>/.env.huu` com:

```bash
HUU_RUN_ID=<runId>            # ex: "k3l9m2p1"
HUU_AGENT_ID=<agentId>         # ex: "1"
PORT=<http>                    # ex: "55100"
HUU_PORT=<http>
HUU_PORT_HTTP=<http>
HUU_PORT_DB=<db>               # ex: "55101"
HUU_PORT_WS=<ws>               # ex: "55102"
HUU_PORT_EXTRA_1..7=<extras>
DATABASE_URL=postgresql://localhost:<db>/huu_agent_<id>
HUU_DATABASE_URL=<mesmo>
HUU_PORT_REMAP=3000:55100,3001:55102,…,*:55100   # consumido pelo bind() shim
LD_PRELOAD=<path>/libhuu_bind.so                  # Linux
# ou
DYLD_INSERT_LIBRARIES=<path>/libhuu_bind.dylib    # macOS
DYLD_FORCE_FLAT_NAMESPACE=1                       # macOS apenas
```

Lido por:
- **Frameworks com dotenv** (Next, Vite, Nest, Astro): automaticamente.
- **`./.huu-bin/with-ports`** (gerado pelo agent-env): shim que carrega
  `.env.huu` e exec do comando passado.

### 5.4 Forçadas pelo `nonInteractiveGitEnv()` (`git/git-client.ts:43-51`)

Toda invocação git roda com:

```bash
GIT_TERMINAL_PROMPT=0   # core git não pergunta nada
GCM_INTERACTIVE=Never   # Git Credential Manager não abre TUI/GUI
GIT_ASKPASS=true        # askpass = /bin/true → exit 0 sem output
SSH_ASKPASS=true        # mesmo pra SSH
```

Por que: sem isso, helpers de credencial podem abrir `/dev/tty` direto
e **roubar o stdin** do Ink (raw mode), congelando a TUI.

---

## 6. Pipeline JSON: schema Zod + exemplos

Schema em `src/lib/pipeline-io.ts:7-37`:

```ts
const StepScopeSchema = z.enum(['project', 'per-file', 'flexible']);

const PromptStepSchema = z.object({
  name: z.string().min(1),
  prompt: z.string(),                          // pode conter $file
  files: z.array(z.string()).default([]),      // [] = whole-project
  modelId: z.string().min(1).optional(),       // override por step
  scope: StepScopeSchema.optional(),           // restrição na UI editor
});

const PipelineSchema = z.object({
  name: z.string().min(1),
  steps: z.array(PromptStepSchema).min(1),
  cardTimeoutMs: z.number().int().positive().optional(),
  singleFileCardTimeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).max(3).optional(),
});

const FORMAT_TAG = 'huu-pipeline-v1';
const LEGACY_FORMAT_TAG = 'programatic-agent-pipeline-v1';

const PipelineFileSchema = z.union([
  z.object({
    _format: z.union([z.literal(FORMAT_TAG), z.literal(LEGACY_FORMAT_TAG)]),
    exportedAt: z.string().optional(),
    pipeline: PipelineSchema,
  }),
  PipelineSchema,                              // schema "naked" (sem wrapper)
]);
```

### 6.1 Pipeline mínimo válido

```json
{
  "name": "single-step",
  "steps": [
    { "name": "rename foo to bar", "prompt": "Rename foo to bar everywhere" }
  ]
}
```

### 6.2 Pipeline com whole-project + per-file

```json
{
  "_format": "huu-pipeline-v1",
  "pipeline": {
    "name": "refactor-and-document",
    "steps": [
      {
        "name": "Per-file: type strict",
        "prompt": "Habilite strict TypeScript em $file removendo any.",
        "files": ["src/lib/types.ts", "src/lib/api-key.ts"],
        "scope": "per-file"
      },
      {
        "name": "Whole-project: README",
        "prompt": "Atualize README.md refletindo as mudanças do stage anterior.",
        "files": [],
        "scope": "project"
      }
    ]
  }
}
```

### 6.3 Pipeline com timeouts customizados e model override por step

> **Nota histórica:** este lugar antes documentava um campo
> `interactive: true` + `refinementModel`. Esse fluxo (refinement chat
> stage-a-stage) foi revertido em `9647ef6`. A entrada conversacional
> hoje é o pipeline assistant (tecla `A` no welcome — vide §22), que
> opera no nível da pipeline inteira em vez de step a step. O schema
> v1 atual **não aceita** `interactive` nem `refinementModel`; a Zod
> rejeita.

```json
{
  "_format": "huu-pipeline-v1",
  "pipeline": {
    "name": "refactor-com-tuning",
    "cardTimeoutMs": 1200000,
    "singleFileCardTimeoutMs": 600000,
    "maxRetries": 2,
    "steps": [
      {
        "name": "Plan",
        "prompt": "Audite src/lib/auth.ts e escreva PLAN.md com a lista de mudanças.",
        "files": [],
        "scope": "project",
        "modelId": "anthropic/claude-sonnet-4.6"
      },
      {
        "name": "Apply",
        "prompt": "Siga o PLAN.md e aplique as mudanças em $file.",
        "files": ["src/lib/auth.ts"],
        "scope": "per-file",
        "modelId": "anthropic/claude-haiku-4.5"
      }
    ]
  }
}
```

### 6.4 Como rodar

```bash
# Da raiz do repo
huu run example.pipeline.json

# Ou copie pra ~/.huu/pipelines/ (global) ou ./pipelines/ (local) e
# escolha pelo welcome screen (ENTER / 1-9).
```

### 6.5 Importar/exportar programaticamente

```ts
import { importPipeline, exportPipeline } from './lib/pipeline-io.js';

const pipeline = importPipeline('./meu.pipeline.json');
exportPipeline(pipeline, './backup.pipeline.json');
// Em backup.pipeline.json sai o wrapper { _format, exportedAt, pipeline }.
```

---

## 7. Configuração de entrada (API key, modelo, thinking)

### 7.1 API key — `src/lib/api-key.ts`

Já documentada em §5.1. Snippet completo:

```ts
export function resolveOpenRouterApiKey(): string {
  const fromMount = readKeyFile('/run/secrets/openrouter_api_key');
  if (fromMount) return fromMount;

  const fromFileEnv = process.env.OPENROUTER_API_KEY_FILE;
  if (fromFileEnv) {
    const fromFile = readKeyFile(fromFileEnv);
    if (fromFile) return fromFile;
  }

  return (process.env.OPENROUTER_API_KEY ?? '').trim();
}
```

Quando ausente, a TUI abre `<ApiKeyPrompt>` e coleta inline. O
`huu --stub` bypassa tudo isso usando o `stubAgentFactory`.

### 7.2 Modelo (`AppConfig.modelId`)

- Default vem do `<ModelSelectorOverlay>` (UI de catálogo +
  recents/favoritos em `src/models/`).
- Pode ser **override por step** via `PromptStep.modelId`. O orchestrator
  faz `{ ...this.config, modelId: step.modelId }` antes de chamar a
  factory (`orchestrator/index.ts:614-618`).

### 7.3 Thinking level — `real-agent.ts:19-31` + `lib/model-factory.ts`

```ts
async function resolveThinkingLevel(modelId, apiKey): 'medium' | 'off' {
  if (supportsThinking(modelId)) return 'medium';      // heurística por prefix
  const caps = await fetchModelCapabilities(apiKey);    // GET /api/v1/models
  if (modelSupportsReasoning(modelId, caps)) return 'medium';
  return 'off';
}
```

Heurística (prefixos em `lib/model-factory.ts:7-27`):

```ts
const thinkingPrefixes = [
  'anthropic/claude',  'deepseek/deepseek-r1', 'openai/o1',  'openai/o3',
  'openai/o4',          'openai/gpt-5',          'google/gemini-2.5',
  'google/gemini-3',    'minimax/minimax-m2',    'z-ai/glm-4.6',
  'z-ai/glm-4.5',       'x-ai/grok-4',           'xiaomi/mimo',
  'deepseek/deepseek-v3','moonshot/kimi-k2',     'moonshotai/kimi-k2',
  'qwen/qwen3',
];
// Também casa qualquer ID terminando em ":thinking".
```

Quando não casa, faz fetch ao `https://openrouter.ai/api/v1/models` e
checa se `supported_parameters` contém `"reasoning"`. Cache em memória
do response (`lib/openrouter.ts:25-29`).

### 7.4 Headers OpenRouter — `real-agent.ts:14-17`

```ts
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/huu',
  'X-OpenRouter-Title': 'huu',
};
```

Esses cabeçalhos são exigidos pela OpenRouter para identificar o
"app" chamador no leaderboard. Vão tanto na sessão Pi quanto no fetch de
capabilities.

### 7.5 `validateApiKey()` — sanity check opcional

`lib/openrouter.ts:74-85`:

```ts
export async function validateApiKey(apiKey: string): Promise<boolean> {
  const trimmed = apiKey.trim();
  if (!trimmed) return false;
  try {
    const response = await fetch(`${OPENROUTER_API_BASE}/key`, {
      headers: buildAuthHeaders(trimmed),
    });
    return response.ok;
  } catch { return false; }
}
```

Não é chamado no run path (a chamada falha cedo na própria sessão Pi se
a key for inválida); está aí para a tela `<ApiKeyPrompt>` validar
imediatamente o que o usuário digitou.

---

## 8. Spawn de uma sessão `pi-coding-agent`

Tudo acontece em `src/orchestrator/real-agent.ts:126-230`. Sequência completa:

```ts
export const realAgentFactory: AgentFactory = async (
  task, config, _systemPromptHint, cwd, onEvent, runtimeContext,
) => {
  // 1. Validações
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error('OpenRouter API key ausente. Defina OPENROUTER_API_KEY.');
  const modelId = config.modelId.trim();
  if (!modelId) throw new Error('Model ID ausente.');

  // 2. Auth storage runtime — não persiste; só vive enquanto o agente roda
  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey('openrouter', apiKey);

  // 3. Resolve o model object via registry da pi-ai
  const model = getModel('openrouter', modelId as any);
  if (!model) {
    throw new Error(
      `Modelo "${modelId}" nao encontrado no Pi SDK registry para provider "openrouter". ` +
      `Verifique o ID ou a versao instalada de @mariozechner/pi-ai.`,
    );
  }

  // 4. ModelRegistry com headers OpenRouter
  const modelRegistry = ModelRegistry.create(authStorage);
  modelRegistry.registerProvider('openrouter', { headers: OPENROUTER_HEADERS });

  // 5. Decide thinking
  const thinkingLevel = await resolveThinkingLevel(modelId, apiKey);

  // 6. Cria a sessão de agente
  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    sessionManager: SessionManager.inMemory(),  // sem persistência
    authStorage,
    modelRegistry,
    cwd,                                         // === worktree do agente
    // tools omitidas → defaults (read, bash, edit, write)
  });

  // 7. Subscriber de eventos
  const unsubscribe = session.subscribe((event: any) => {
    try { translateEvent(event, onEvent); }
    catch (err) {
      onEvent({ type: 'log', level: 'warn',
        message: `event translate error: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  let disposed = false;

  const spawned: SpawnedAgent = {
    agentId: task.agentId,
    task,
    async prompt(message: string): Promise<void> {
      if (disposed) throw new Error('agent already disposed');
      const fullMessage = buildFullMessage(
        task.agentId, task.files, message, task.branchName, cwd,
        runtimeContext?.ports, runtimeContext?.shimAvailable ?? false,
      );
      try { await session.prompt(fullMessage); }
      catch (err) {
        onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        throw err;
      }
      // Pi SDK swallows streamFn errors; re-extract from state.
      const state = (session as any).state;
      const lastMsg = state?.messages?.[state.messages.length - 1];
      if (lastMsg?.stopReason === 'error' && lastMsg?.errorMessage) {
        onEvent({ type: 'error', message: lastMsg.errorMessage });
        throw new Error(lastMsg.errorMessage);
      }
      onEvent({ type: 'done' });
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try { unsubscribe(); } catch {}
      try { session.dispose(); } catch {}
      const ref = spawned as unknown as { task: unknown };
      ref.task = null;
    },
  };

  return spawned;
};
```

**Importante:** o `cwd` passado é o caminho do worktree git do agente
(criado pelo `WorktreeManager` antes do spawn). A SDK Pi resolve todas as
operações de filesystem **relativas a esse cwd**, então o agente fisica e
logicamente trabalha isolado dentro de `.huu-worktrees/<runId>/agent-<id>/`.

### 8.1 Tools habilitadas

O `tools` é omitido na criação da sessão, então o `pi-coding-agent` usa
os **defaults**: `read`, `bash`, `edit`, `write` (e variantes que a SDK
fornece). O system prompt gerado em `agents-md-generator.ts` instrui o
agente a:

- **NÃO** rodar comandos git (commit/push/branch) — orchestrator cuida.
- Editar somente os arquivos atribuídos (em modo per-file).
- Preservar APIs públicas, manter cobertura de testes.
- Reportar resumo ao final.

Para o **integration agent** (resolução de conflitos), o prompt é
diferente e *permite* git: `agents-md-generator.ts:106-127`.

### 8.2 Por que `SessionManager.inMemory()`

A SDK Pi pode persistir o histórico da sessão (replay). Não usamos
porque:
1. Cada agente é **disposable** — uma sessão por task, sem reuso.
2. O log persistido em `.huu/` é a fonte canônica de auditoria.
3. Persistir adicionaria I/O desnecessário no path crítico.

---

## 9. System prompt enviado ao agente — exemplo completo

Gerado por `generateAgentSystemPrompt` em
`src/orchestrator/agents-md-generator.ts`. Existem **dois templates**:

### 9.1 Template per-file (com `files: ["a.ts"]`)

Para um agente com `agentId=3`, `files=["src/lib/auth.ts"]`,
`branchName="huu/k3l9m2p1/agent-3"`,
`worktreePath=".huu-worktrees/k3l9m2p1/agent-3"`, port bundle ativo,
shim disponível:

```markdown
# Agent 3 — Refactoring Session

## Your Role
You are Agent 3 in a multi-agent refactoring orchestrator. You have been
assigned specific files to refactor. Focus exclusively on your assigned
files.

## Assigned Files
- src/lib/auth.ts

## Refactoring Instructions
<USER PROMPT AQUI, com $file já substituído por src/lib/auth.ts>

## Git Context
- **Branch**: `huu/k3l9m2p1/agent-3`
- **Worktree**: `.huu-worktrees/k3l9m2p1/agent-3`
- You are working in an isolated worktree. Your changes will not affect other agents.
- Do NOT run git commands (commit, push, branch, etc.) — the orchestrator handles all Git operations.
- Focus only on reading and modifying code.

## Port Allocation

**bind() interception is active.** Even if the customer code calls `app.listen(3000)` literally
or hardcodes a port in a config file, the kernel will receive your allocated port instead. You do
NOT need to modify the customer's source to avoid collisions.

Variáveis disponíveis no shell e em `.env.huu` no worktree:
- `PORT` / `HUU_PORT_HTTP` = 55120
- `HUU_PORT_DB` = 55121
- `HUU_PORT_WS` = 55122
- `DATABASE_URL` = postgresql://localhost:55121/huu_agent_3

Regras:
1. NUNCA hardcode portas em código novo (3000, 8080, 5173, 5432). Use as variáveis acima.
2. Frameworks que leem dotenv (Next, Vite, Nest, etc.) carregam `.env.huu` automaticamente.
3. Para binários que ignoram dotenv (python, go, cargo, scripts), prefixe com o shim shell:
   `./.huu-bin/with-ports <comando>`
   Exemplo: `./.huu-bin/with-ports python -m http.server $HUU_PORT_HTTP`
4. Extras disponíveis: `HUU_PORT_EXTRA_1` … `HUU_PORT_EXTRA_7`.

## Rules
1. ONLY modify files from your assigned list above.
2. Do NOT create new files unless absolutely necessary for the refactoring.
3. Do NOT modify files outside your assignment — other agents handle those.
4. Do NOT run git commands — the orchestrator manages all Git operations.
5. Preserve existing public APIs unless the refactoring explicitly requires changes.
6. Maintain or improve test coverage if tests exist.
7. Follow the existing code style and conventions of the project.
8. After completing each file, briefly note what was changed and why.

## Workflow
1. Read each assigned file to understand its current structure.
2. Plan the refactoring approach for each file.
3. Apply changes using the edit tool, one file at a time.
4. Verify each change maintains correctness.
5. Report a summary of all changes when done.

## Completion
When you have finished refactoring all assigned files, provide a clear summary of:
- Which files were modified
- What changes were made to each
- Any issues or concerns found during refactoring
```

### 9.2 Template whole-project (com `files: []`)

```markdown
# Agent 3 — Whole-Project Session

## Your Role
You are Agent 3 in a multi-agent orchestrator. This step has no
file-scope restriction — you may read and modify any file in the project
necessary to complete the task.

## Scope
Entire project. No specific file list was assigned to this step.

## Task Instructions
<USER PROMPT AQUI>

## Git Context
- **Branch**: `huu/k3l9m2p1/agent-3`
…

## Rules
1. Focus on completing the task thoroughly.
2. You may read any file for context and modify any file necessary.
3. Create new files only when the task requires it.
4. Do NOT run git commands — the orchestrator manages all Git operations.
5. Preserve existing public APIs unless the task explicitly requires changes.
6. Maintain or improve test coverage if tests exist.
7. Follow the existing code style and conventions of the project.

## Workflow
1. Read relevant files to understand the current codebase.
2. Plan your approach to complete the task.
3. Apply changes using the edit tool.
4. Verify each change maintains correctness.
5. Report a summary of all changes when done.

## Completion
When finished, provide a summary of:
- Which files were modified or created
- What changes were made
- Any issues or concerns found
```

### 9.3 Template integration agent (resolução de conflitos)

Note a diferença crítica: **autoriza git**.

```markdown
# Agent 9999 — Integration Session

## Your Role
You are the integration agent in a multi-agent refactoring orchestrator.
Your job is to merge agent branches into the integration branch and
resolve any merge conflicts.

## Git Context
- **Integration Branch**: `huu/k3l9m2p1/integration`
- **Worktree**: `.huu-worktrees/k3l9m2p1/integration`
- You are working in the integration worktree.

## Rules
1. Run git commands as instructed (merge, stage, commit).
2. When resolving conflicts, read both versions, understand the intent,
   and combine changes correctly.
3. Do NOT discard changes from any branch — preserve all intended modifications.
4. After resolving conflicts, stage the resolved files and complete the merge.
5. Provide a clear summary of what was merged and how conflicts were resolved.
```

---

## 10. O contrato `AgentFactory` / `SpawnedAgent`

Definidos em `src/orchestrator/types.ts`:

```ts
export type AgentEvent =
  | { type: 'log'; level?: 'info' | 'warn' | 'error'; message: string }
  | { type: 'state_change'; state: 'streaming' | 'tool_running' }
  | { type: 'file_write'; file: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface SpawnedAgent {
  agentId: number;
  task: AgentTask;
  prompt(message: string): Promise<void>;   // resolve em terminal state
  dispose(): Promise<void>;                  // libera sessão + listeners
}

export interface AgentRuntimeContext {
  ports?: AgentPortBundle;          // janela de portas TCP do agente
  shimAvailable?: boolean;          // bind() interceptor LD_PRELOAD ativo?
}

export type AgentFactory = (
  task: AgentTask,
  config: AppConfig,
  systemPromptHint: string,        // ignorado em real-agent (vai no buildFullMessage)
  cwd: string,                     // worktree path
  onEvent: (event: AgentEvent) => void,
  runtimeContext?: AgentRuntimeContext,
) => Promise<SpawnedAgent>;
```

Esse contrato é a **fronteira** entre o orchestrator (que não conhece
nada do Pi) e o `real-agent.ts` (que conhece tudo). O `stubAgentFactory`
implementa o mesmo contrato escrevendo um `STUB_*.md` e emitindo eventos
fake — usado em testes e quando rodamos com `--stub`.

### 10.1 Stub agent — implementação completa

`src/orchestrator/stub-agent.ts:9-65`:

```ts
export const stubAgentFactory: AgentFactory = async (
  task, _config, _systemPromptHint, cwd, onEvent, _runtimeContext,
) => {
  let disposed = false;

  return {
    agentId: task.agentId,
    task,
    async prompt(message: string): Promise<void> {
      onEvent({ type: 'log',
        message: `stub agent #${task.agentId} starting on ${
          task.files.length === 0 ? 'whole project' : task.files[0]}` });
      onEvent({ type: 'state_change', state: 'streaming' });

      const totalDelay = 2000 + Math.floor(Math.random() * 3000);
      const steps = 3;
      const stepDelay = totalDelay / steps;

      for (let i = 0; i < steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
        if (disposed) return;
        onEvent({ type: 'log', message: `stub step ${i + 1}/${steps}: simulating LLM call...` });
      }

      const safeName = task.stageName.replace(/[^a-z0-9-_]/gi, '_');
      const stubFile = `STUB_${safeName}_${task.agentId}.md`;
      const stubPath = join(cwd, stubFile);
      const content = [
        `# Stub run for stage "${task.stageName}", agent ${task.agentId}`,
        '', `Files: ${task.files.length === 0 ? '(whole project)' : task.files.join(', ')}`,
        `Prompt received:`, '', '```', message, '```',
      ].join('\n');

      try {
        writeFileSync(stubPath, content, 'utf8');
        onEvent({ type: 'file_write', file: stubFile });
        onEvent({ type: 'log', message: `wrote ${stubFile}` });
      } catch (err) {
        onEvent({ type: 'error',
          message: `failed to write stub file: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }

      onEvent({ type: 'done' });
    },
    async dispose(): Promise<void> { disposed = true; },
  };
};
```

Use isso como **template** para implementar suas próprias factories de
teste/mock.

### 10.2 Como o orchestrator usa

```ts
// orchestrator/index.ts:614-628
const stepConfig = step.modelId
  ? { ...this.config, modelId: step.modelId }
  : this.config;
agent = await this.agentFactory(
  task,
  stepConfig,
  this.buildSystemPromptHint(step, task),
  wt.worktreePath,
  (event) => this.handleAgentEvent(task.agentId, event),
  portBundle ? { ports: portBundle, shimAvailable: this.nativeShim !== null } : undefined,
);
this.activeAgents.set(task.agentId, agent);
```

Depois faz:

```ts
// orchestrator/index.ts:635
await withTimeout(agent.prompt(renderedPrompt), timeoutMs);
```

Onde `renderedPrompt` substitui `$file` no prompt do step pelo único
arquivo do task quando há um (`renderPrompt` em
`orchestrator/index.ts:957-960`):

```ts
private renderPrompt(step: PromptStep, task: AgentTask): string {
  if (task.files.length === 0) return step.prompt;
  return step.prompt.replaceAll('$file', task.files[0]!);
}
```

### 10.3 Stub vs Real — tabela

| Aspecto                    | `stubAgentFactory`                | `realAgentFactory`               |
| -------------------------- | --------------------------------- | --------------------------------- |
| Chama LLM?                 | ❌ Sleep + writeFileSync          | ✅ Sessão Pi + OpenRouter         |
| Latência                   | 2-5s fixo (random)                | depende do modelo                 |
| Custo $                    | 0                                  | conforme provider                 |
| Resolve conflitos?         | ❌ (factory desabilitada em CLI)  | ✅ (via `conflictResolverFactory`) |
| Output                     | `STUB_<stage>_<id>.md`             | edits reais nos files atribuídos  |
| Honra `runtimeContext`?    | ❌ ignora                          | ✅ injeta no system prompt        |
| Erro de network/auth?      | nunca                              | propagado via `error` event       |
| Quando usar                | testes, smoke, demo de UI         | produção                          |

---

## 11. Eventos do Pi: assinatura, tradução e schema interno

A SDK Pi emite eventos via `session.subscribe(handler)`. Em
`real-agent.ts:165-175`:

```ts
const unsubscribe = session.subscribe((event: any) => {
  try { translateEvent(event, onEvent); }
  catch (err) { onEvent({ type: 'log', level: 'warn',
    message: `event translate error: ${...}` }); }
});
```

A função `translateEvent` (`real-agent.ts:43-98`) é o **único ponto** que
converte o schema da SDK no schema interno `AgentEvent`. Implementação
verbatim:

```ts
function translateEvent(event: any, onEvent: (e: AgentEvent) => void): void {
  if (!event || typeof event !== 'object') return;

  switch (event.type) {
    case 'agent_start':
      onEvent({ type: 'state_change', state: 'streaming' });
      onEvent({ type: 'log', message: 'agent started' });
      break;

    case 'tool_execution_start': {
      const file = extractFileFromArgs(event.args);
      const msg = `tool: ${event.toolName}${file ? ` → ${file}` : ''}`;
      onEvent({ type: 'state_change', state: 'tool_running' });
      onEvent({ type: 'log', message: msg });
      if (file && WRITE_TOOLS.has(String(event.toolName).toLowerCase())) {
        onEvent({ type: 'file_write', file });
      }
      break;
    }

    case 'tool_execution_end':
      onEvent({ type: 'state_change', state: 'streaming' });
      if (event.isError) {
        onEvent({ type: 'log', level: 'error', message: `tool error: ${event.toolName}` });
      } else {
        onEvent({ type: 'log', message: `tool done: ${event.toolName}` });
      }
      break;

    case 'message_end': {
      const usage = event.message?.usage ?? event.usage;
      if (usage) {
        const inp = usage.input ?? usage.inputTokens ?? 0;
        const out = usage.output ?? usage.outputTokens ?? 0;
        const cost = usage.cost?.total ?? 0;
        onEvent({ type: 'log',
          message: `tokens +${inp}in +${out}out${cost > 0 ? ` $${cost.toFixed(6)}` : ''}` });
      }
      break;
    }

    case 'agent_end':
      onEvent({ type: 'log', message: 'agent finished' });
      break;

    case 'auto_compaction_start':
      onEvent({ type: 'log', level: 'warn',
        message: `auto-compaction: ${event.reason ?? ''}` });
      break;

    case 'error':
      onEvent({ type: 'error', message: event.message ?? 'unknown error' });
      break;
  }
}
```

### 11.1 Resumo da tradução

| Pi event              | O que fazemos                                                                  |
| --------------------- | ------------------------------------------------------------------------------ |
| `agent_start`         | `state_change → 'streaming'` + log `'agent started'`                           |
| `tool_execution_start`| `state_change → 'tool_running'` + log `'tool: <name> → <file>'`. Se a tool é write/edit/create/patch e tem path, emite **também** `file_write { file }`. |
| `tool_execution_end`  | `state_change → 'streaming'`. Em erro, log nível `error`. Caso contrário, log `'tool done'`. |
| `message_end`         | Extrai `usage.input/output/cost` e emite log `'tokens +Nin +Mout $X'`.        |
| `agent_end`           | log `'agent finished'` — **NOTA:** *não* dispara `done` (ver §13).             |
| `auto_compaction_start` | log nível `warn` com a razão da compactação                                  |
| `error`               | `error { message }` propagado pra orchestrator                                 |

### 11.2 Schema esperado dos eventos Pi

A SDK não exporta tipos públicos para esses eventos no nível que
consumimos. As assunções (extraídas do `translateEvent`):

```ts
// pi-coding-agent emit shapes (best-effort, baseado no que real-agent.ts lê)
type PiEvent =
  | { type: 'agent_start' }
  | { type: 'tool_execution_start'; toolName: string; args: { path?: string; file_path?: string; filePath?: string } }
  | { type: 'tool_execution_end'; toolName: string; isError?: boolean }
  | { type: 'message_end'; message?: { usage?: PiUsage }; usage?: PiUsage }
  | { type: 'agent_end' }
  | { type: 'auto_compaction_start'; reason?: string }
  | { type: 'error'; message?: string };

interface PiUsage {
  input?: number;       inputTokens?: number;
  output?: number;       outputTokens?: number;
  cost?: { total?: number };
}
```

### 11.3 Detecção de "tool de escrita"

```ts
const WRITE_TOOLS = new Set(['edit', 'write', 'create', 'patch']);
```

Quando a tool tem path **e** é uma dessas, emitimos `file_write`. Isso
alimenta o `AgentStatus.filesModified` (que vira o `n file(s)` no card do
kanban e a lista do modal).

### 11.4 Extração de path do tool args

```ts
function extractFileFromArgs(args: any): string | null {
  if (!args || typeof args !== 'object') return null;
  if (typeof args.path === 'string') return args.path;
  if (typeof args.file_path === 'string') return args.file_path;
  if (typeof args.filePath === 'string') return args.filePath;
  return null;
}
```

As três variantes existem porque modelos diferentes nomeiam o argumento
diferente.

---

## 12. Captura de logs (cinco caminhos paralelos)

Quando uma sessão Pi roda, os logs **fluem por cinco trilhos
diferentes** ao mesmo tempo:

### 12.1 In-memory `AgentStatus.logs[]`

Cada log emitido pelo agente é appendado em `AgentStatus.logs` (cap em
100 últimos — `orchestrator/index.ts:1013-1018`):

```ts
private appendAgentLog(agentId: number, message: string): void {
  const cur = this.agents.get(agentId);
  if (!cur) return;
  const next = { ...cur, logs: [...cur.logs, message].slice(-100) };
  this.agents.set(agentId, next);
}
```

Consumido por:
- O **modal** (`RunModal.tsx`) na seção `Runtime logs (N)`.
- O **kanban** (`RunKanban.tsx`) que mostra apenas o último log no card.

### 12.2 In-memory `OrchestratorState.logs[]` (LogEntry global)

Stream agregado de todos os agentes + orchestrator + integrator. Cap em
1000 entradas (`orchestrator/index.ts:1056-1066`). `agentId = -1` indica
linha do próprio orchestrator; `9999` é o integration agent.

```ts
private log(entry: { level, message, agentId? }): void {
  const logEntry: LogEntry = {
    timestamp: Date.now(),
    agentId: entry.agentId ?? -1,
    level: entry.level,
    message: entry.message,
  };
  this.logs.push(logEntry);
  if (this.logs.length > 1000) this.logs.shift();   // FIFO drop
  this.runLogger?.append(logEntry);                  // mas RunLogger é unbounded
}
```

Consumido por:
- A **sidebar `LogArea`** do dashboard (filtrável por `agentId` com a
  tecla `F`).

### 12.3 RunLogger persistente — `src/lib/run-logger.ts`

Escreve em `<repoRoot>/.huu/<stamp>-execution-<runId>.log` ao final do
run **dois artefatos**:

1. **Arquivo único cronológico**: `<stamp>-execution-<runId>.log` com
   header (runId, status, base, integration, agentes, files modified) e
   stream merged de `LogEntry` + eventos brutos (state_change,
   file_write, done) ordenados por timestamp.

2. **Diretório irmão**: `<stamp>-execution-<runId>/` com um arquivo por
   ator:
   - `orchestrator.log` (agentId < 0)
   - `integrator.log` (agentId === 9999)
   - `agent-<id>.log` para cada agente real

   Cada arquivo carrega header próprio com stage, branch, worktree,
   commit, duração, files modified, tokens, erro.

Exemplo do que fica em `.huu/2026-04-29_12-34-56-execution-k3l9m2p1.log`:

```
# huu Run Log
# Run ID:            k3l9m2p1
# Pipeline:          refactor-and-document
# Status:            done
# Started:           2026-04-29 12:34:56.123
# Finished:          2026-04-29 12:42:13.789
# Duration:          437.67s
# Base:              main@a1b2c3d4
# Integration:       huu/k3l9m2p1/integration
# Stages:            2
# Agents:            3 total — 3 done, 0 errored, 0 no-changes
# Files modified:    4
#   - README.md
#   - src/lib/auth.ts
#   - src/lib/api-key.ts
#   - src/lib/types.ts

=== Logs ===
[2026-04-29 12:34:56.345] [INFO ] [orchestrator ] integration worktree: .huu-worktrees/k3l9m2p1/integration
[2026-04-29 12:34:56.601] [INFO ] [orchestrator ] === stage 1/2: Per-file: type strict
[2026-04-29 12:34:57.012] [EVENT] [agent-1     ] state → streaming
[2026-04-29 12:34:57.013] [INFO ] [agent-1     ] agent started
[2026-04-29 12:34:58.890] [INFO ] [agent-1     ] tool: read → src/lib/types.ts
[2026-04-29 12:34:58.892] [EVENT] [agent-1     ] state → tool_running
[2026-04-29 12:35:01.450] [INFO ] [agent-1     ] tool done: read
[2026-04-29 12:35:01.452] [EVENT] [agent-1     ] state → streaming
[2026-04-29 12:35:04.881] [INFO ] [agent-1     ] tool: edit → src/lib/types.ts
[2026-04-29 12:35:04.881] [EVENT] [agent-1     ] state → tool_running
[2026-04-29 12:35:04.890] [EVENT] [agent-1     ] wrote src/lib/types.ts
[2026-04-29 12:35:05.012] [INFO ] [agent-1     ] tool done: edit
…
[2026-04-29 12:35:30.121] [INFO ] [agent-1     ] tokens +1842in +394out $0.012345
[2026-04-29 12:35:30.123] [INFO ] [agent-1     ] agent finished
[2026-04-29 12:35:30.130] [EVENT] [agent-1     ] done

=== Per-Agent Summary ===
agent-1 — stage 1: "Per-file: type strict"
  state:   done
  phase:   done
  branch:  huu/k3l9m2p1/agent-1
  commit:  9f8e7d6c5b4a…
  files:   src/lib/types.ts
  tokens:  in=0 out=0 cacheR=0 cacheW=0       ← caveat (§24)
…

=== Integration ===
phase:           done
branches merged: 3
  + huu/k3l9m2p1/agent-1
  + huu/k3l9m2p1/agent-2
  + huu/k3l9m2p1/agent-3
final commit:    1a2b3c4d…
```

O `RunLogger` mantém **buffer próprio sem cap** para não perder
entradas que o `OrchestratorState.logs[]` (cap 1000) descartou antes da
escrita. Flush no `finally` do `Orchestrator.start()`
(`orchestrator/index.ts:464-483`).

### 12.4 Debug logger NDJSON — `src/lib/debug-logger.ts`

Escreve em `<repoRoot>/.huu/debug-<ISO>.log` **uma linha NDJSON por
evento**, com `writeSync` direto no fd pra garantir flush em caso de
freeze. Captura:

- `lifecycle.cli_start` no boot
- `lifecycle.exit` na saída
- `signal.SIGINT/SIGTERM/SIGHUP`
- `error.uncaughtException/unhandledRejection`
- `heartbeat.tick` a cada 200ms com `lagMs` do event loop +
  `activeHandles`, `activeRequests`, contadores
- `stdin.data` para cada chunk vindo do teclado (hex + ascii sanitizado)
- `nav.navigate/screen_mount/screen_unmount`
- `mount.RunDashboard/.unmount`
- `input.App.useInput / RunDashboard.useInput`
- `orch.preflight_start/end`
- `orch.integration_worktree_create_start/end`
- `orch.spawn_start { agentId, files, totalAttempts, timeoutMs }`
- `orch.worktree_ready { agentId, attempt, durationMs, path, branch }`
- `orch.attempt_failed { agentId, attempt, kind, timeoutMs, err }`
- `orch.attempt_setup_failed`
- `orch.stage_advance { stageIdx, previousBaseRef, newBaseRef, … }`
- `orch.abort_requested`
- `git.spawn { args, cwd, timeout }` / `git.done { args, durationMs, exitCode, stderrFirst, stdoutBytes }`
- `preflight.git_spawn` / `preflight.git_done`

Exemplo de linhas (`.huu/debug-2026-…Z.log`):

```jsonl
{"t":"2026-04-29T12:34:56.123Z","cat":"lifecycle","ev":"cli_start","cwd":"/repo","argv":["…"],"pid":42,"node":"v22.1.0","platform":"linux","isTTY":true}
{"t":"2026-04-29T12:34:56.323Z","cat":"heartbeat","ev":"tick","lagMs":1,"activeHandles":7,"activeRequests":0,"counters":{}}
{"t":"2026-04-29T12:34:56.345Z","cat":"orch","ev":"preflight_start","cwd":"/repo"}
{"t":"2026-04-29T12:34:56.401Z","cat":"orch","ev":"preflight_end","durationMs":56,"valid":true,"errors":[],"warnings":["Push reachability check skipped (set HUU_CHECK_PUSH=1 to enable)."]}
{"t":"2026-04-29T12:34:56.402Z","cat":"git","ev":"spawn","args":["worktree","add",".huu-worktrees/k3l9m2p1/integration","huu/k3l9m2p1/integration"],"cwd":"/repo","timeout":30000}
{"t":"2026-04-29T12:34:56.501Z","cat":"git","ev":"done","args":[…],"cwd":"/repo","durationMs":99,"exitCode":0,"stderrFirst":"","stdoutBytes":68}
{"t":"2026-04-29T12:34:56.601Z","cat":"orch","ev":"spawn_start","agentId":1,"files":["src/lib/types.ts"],"totalAttempts":2,"timeoutMs":300000}
{"t":"2026-04-29T12:35:30.123Z","cat":"stdin","ev":"data","hex":"71","len":1,"ascii":"q"}
{"t":"2026-04-29T12:35:30.130Z","cat":"orch","ev":"abort_requested","activeAgents":0}
{"t":"2026-04-29T12:35:30.132Z","cat":"signal","ev":"SIGINT"}
{"t":"2026-04-29T12:35:30.135Z","cat":"lifecycle","ev":"exit","code":0}
```

Esse é o log que o `huu status` lê para diagnóstico headless (§25).

### 12.5 RunLogger por evento — `events`

Além das entradas estruturadas, o RunLogger captura **eventos brutos do
agente** via `appendEvent(agentId, event)`
(`run-logger.ts:37-41`). Cada `state_change`, `file_write`, `done` vira
uma linha `[EVENT] state → streaming` no log final. Eventos do tipo
`log` e `error` NÃO são duplicados aqui (já fluem pelo trilho 12.3).

### 12.6 Resumo dos arquivos gerados

```
<repoRoot>/.huu/
├── debug-2026-04-29T12-34-56-789Z.log        # NDJSON heartbeat + lifecycle
├── 2026-04-29_12-34-56-execution-<runId>.log # cronológico (humano)
└── 2026-04-29_12-34-56-execution-<runId>/    # split por ator
    ├── orchestrator.log
    ├── integrator.log
    ├── agent-1.log
    ├── agent-2.log
    └── ...
```

Todos esses caminhos estão no `.gitignore` automaticamente
(`orchestrator/index.ts:269-273`):

```ts
ensureGitignored(this.preflight.repoRoot, '.huu-worktrees/');
ensureGitignored(this.preflight.repoRoot, `${RUN_LOG_DIR}/`);     // .huu/
ensureGitignored(this.preflight.repoRoot, AGENT_ENV_FILE);         // .env.huu
ensureGitignored(this.preflight.repoRoot, `${AGENT_BIN_DIR}/`);    // .huu-bin/
ensureGitignored(this.preflight.repoRoot, '.huu-cache/');
```

---

## 13. Detecção de término (sinais "acabou")

Saber **quando o Pi terminou** é menos óbvio do que parece. Há três
sinais distintos, e o `huu` cruza eles para evitar falso-positivos.

### 13.1 Promise de `session.prompt()` resolvendo

O sinal **principal**. Em `real-agent.ts:194`:

```ts
await session.prompt(fullMessage);
```

Quando essa promise resolve, a SDK Pi entende que o agente alcançou um
estado terminal (texto final, tool last, ou erro tratado). Mas:

> A Pi SDK *engole* erros de stream silenciosamente. Se o LLM provider
> falhou no meio do stream, `await prompt()` **resolve normalmente**.

Por isso temos o passo seguinte:

### 13.2 Re-extração de erro do estado interno

`real-agent.ts:202-208`:

```ts
const state = (session as any).state;
const lastMsg = state?.messages?.[state.messages.length - 1];
if (lastMsg?.stopReason === 'error' && lastMsg?.errorMessage) {
  onEvent({ type: 'error', message: lastMsg.errorMessage });
  throw new Error(lastMsg.errorMessage);
}
onEvent({ type: 'done' });
```

Cavamos a `state.messages` interna, checamos `stopReason === 'error'` e
re-lançamos. Só **depois** disso, se chegamos limpos, emitimos
`{ type: 'done' }`. Esse é o sinal que o orchestrator usa para marcar
`AgentStatus.state = 'done'`.

### 13.3 Timeout externo (orchestrator)

Mesmo se a sessão Pi nunca resolver (LLM travou, rede caiu), o
orchestrator envelopa `agent.prompt()` em um `withTimeout`
(`orchestrator/index.ts:70-80`):

```ts
class TimeoutError extends Error {
  readonly isTimeout = true;
  constructor(message: string) { super(message); this.name = 'TimeoutError'; }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`card timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
```

O timeout é por **card** (não pelo pipeline inteiro):
- `singleFileCardTimeoutMs` para tasks de 1 arquivo (default 5min)
- `cardTimeoutMs` para multi-arquivo / whole-project (default 10min)

Configurável no Pipeline JSON em
`Pipeline.singleFileCardTimeoutMs`/`Pipeline.cardTimeoutMs`. Em timeout,
o orchestrator chama `agent.dispose()` para abortar o stream Pi e tenta
até `maxRetries` vezes (default 1 retry).

Defaults em `lib/types.ts:80-82`:

```ts
export const DEFAULT_CARD_TIMEOUT_MS = 600_000;             // 10min
export const DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS = 300_000;  // 5min
export const DEFAULT_MAX_RETRIES = 1;
```

### 13.4 O evento `agent_end` da SDK NÃO conta

Note em `translateEvent` (`real-agent.ts:86-88`):

```ts
case 'agent_end':
  onEvent({ type: 'log', message: 'agent finished' });
  break;
```

A gente **só loga** que o agente acabou — não dispara `{ type: 'done' }`
aqui. O `done` vem só do caminho `prompt() resolve` (§13.1+13.2). Isso é
intencional: `agent_end` pode disparar várias vezes durante uma sessão
multi-turn, e nem sempre é "trabalho terminou".

### 13.5 Defesa em profundidade no orchestrator

`orchestrator/index.ts:636-640`:

```ts
await withTimeout(agent.prompt(renderedPrompt), timeoutMs);
const status = this.agents.get(task.agentId);
if (status && status.state !== 'done' && status.state !== 'error') {
  this.updateAgentStatus(task.agentId, { state: 'done' });
}
```

Mesmo se a tradução de evento falhou e o `done` nunca foi emitido, se o
`prompt()` resolveu sem throw, marcamos como `done` **defensivamente**.
Garantia de que o card sempre sai do estado "streaming" quando o agente
terminou.

---

## 14. Ações disparadas em cada transição

Esta é a tabela de "evento → ação no resto do sistema". Todos os
caminhos passam por `Orchestrator.handleAgentEvent`
(`orchestrator/index.ts:931-953`):

```ts
private handleAgentEvent(agentId: number, event: AgentEvent): void {
  this.runLogger?.appendEvent(agentId, event);
  switch (event.type) {
    case 'log':
      this.log({ level: event.level ?? 'info', message: event.message, agentId });
      this.appendAgentLog(agentId, event.message);
      break;
    case 'state_change':
      this.updateAgentStatus(agentId, { state: event.state, phase: event.state });
      break;
    case 'file_write':
      this.appendAgentLog(agentId, `wrote ${event.file}`);
      break;
    case 'done':
      this.updateAgentStatus(agentId, { state: 'done' });
      break;
    case 'error':
      this.updateAgentStatus(agentId, { state: 'error', error: event.message });
      this.log({ level: 'error', message: event.message, agentId });
      break;
  }
  this.emit();
}
```

### 14.1 Tabela de side-effects

| AgentEvent emitido          | RunLogger | OrchestratorState.logs | AgentStatus mutation              | Side-effects extras                    |
| --------------------------- | --------- | ---------------------- | --------------------------------- | -------------------------------------- |
| `log { message, level }`    | append    | append                 | `logs[]` append (cap 100)         | nada                                   |
| `state_change { state }`    | appendEv  | —                      | `state` + `phase` ← `state`       | re-render via `emit()`                 |
| `file_write { file }`       | appendEv  | —                      | `logs[]` append `'wrote <file>'`  | `filesModified` populado em `finalize` |
| `done`                      | appendEv  | —                      | `state ← 'done'`                  | dispara `finalizeAgent` no caller      |
| `error { message }`         | append    | append                 | `state ← 'error'`, `error ← msg`  | propagado: `prompt()` re-throw         |

### 14.2 `finalizeAgent` — o que acontece após `done`

`orchestrator/index.ts:778-823`:

```ts
private async finalizeAgent(agentId: number): Promise<void> {
  const status = this.agents.get(agentId);
  if (!status || !status.worktreePath) return;
  const git = this.worktreeManager!.getGitClient();
  let noChanges = false;

  try {
    this.updateAgentStatus(agentId, { phase: 'finalizing' });
    noChanges = !(await git.hasChanges(status.worktreePath));
    if (noChanges) {
      this.updateAgentStatus(agentId, { phase: 'no_changes' });
    } else {
      this.updateAgentStatus(agentId, { phase: 'committing' });
      const changed = await git.getChangedFiles(status.worktreePath);
      await git.stageAll(status.worktreePath);
      const commitMsg = `[${this.pipeline.name}] ${status.stageName} (agent ${agentId})`;
      const commitSha = await git.commitNoVerify(status.worktreePath, commitMsg);
      this.updateAgentStatus(agentId, { commitSha, filesModified: changed });
    }

    this.updateAgentStatus(agentId, { phase: 'cleaning_up' });
    await this.worktreeManager!.removeAgentWorktree(agentId);
    this.updateAgentStatus(agentId, {
      phase: noChanges ? 'no_changes' : 'done',
      state: 'done',
    });
  } catch (err) {
    this.updateAgentStatus(agentId, {
      phase: 'error', state: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    this.portAllocator.release(agentId);
    this.completedTasks++;
    this.appendManifestEntry(agentId);
    this.emit();
  }
}
```

Sequência:
1. `phase ← 'finalizing'`
2. `git.hasChanges`: se não → `phase ← 'no_changes'`, terminal sem
   commit. Se sim → `phase ← 'committing'`, captura `getChangedFiles`,
   `stageAll`, `commitNoVerify` com mensagem
   `[<pipelineName>] <stageName> (agent <id>)`, captura `commitSha`.
3. `phase ← 'cleaning_up'`, `removeAgentWorktree` (mantém branch).
4. `phase ← 'done'` (ou `'no_changes'` — terminal distinto).
5. `portAllocator.release(agentId)`, `completedTasks++`,
   `appendManifestEntry(agentId)`, `emit()`.

Se em vez de `done` veio `error` ou timeout, a action é diferente
(orchestrator/index.ts:641-698):
- O worktree é destruído (`removeAgentWorktree`), o branch é deletado
  (`git.deleteBranch`), o port allocation é liberado.
- Se sobram retries → `continue` no loop, recria worktree com sufixo
  `-retry`.
- Sem retries → `state ← 'error'`, `errorKind ← 'timeout'|'failed'`,
  `completedTasks++`, manifest entry persistido com `cleanupDone: true`.

---

## 15. Ciclo de vida fim-a-fim de um agente

Sequência completa de fases que um agente atravessa, das mais cedo às
terminais. Definidas em `lib/types.ts:128-142` como
`AgentLifecyclePhase`:

```
pending
  └─▶ worktree_creating          (orchestrator cria branch + worktree)
       └─▶ worktree_ready
            └─▶ session_starting  (cria createAgentSession + escreve .env.huu + shim)
                 └─▶ streaming   ◀──┐
                      └─▶ tool_running ──┘ (alterna conforme tool ativa ou não)
                           └─▶ finalizing
                                └─▶ committing  (se houver changes)
                                │    └─▶ cleaning_up
                                │         └─▶ done
                                │
                                └─▶ no_changes  (se git.hasChanges = false)
                                │    └─▶ cleaning_up → no_changes (terminal)
                                │
                                └─▶ error       (qualquer falha terminal)
```

A coluna do kanban (`pickColumn` em `RunKanban.tsx:74-80`) mapeia:

```ts
function pickColumn(s: AgentStatus): 'todo' | 'doing' | 'done' {
  if (s.state === 'error') return 'done';
  if (s.state === 'done' && s.phase === 'done') return 'done';
  if (s.phase === 'no_changes') return 'done';
  if (s.phase === 'pending') return 'todo';
  return 'doing';
}
```

Note que `error` e `no_changes` são "terminais" distintos de `done`
porque carregam informação clinicamente útil. O orchestrator preserva
essa distinção até o manifest final.

### 15.1 Fases declaradas mas não usadas

`validating` e `pushing` estão em `AgentLifecyclePhase` mas **não são
atribuídas em lugar algum** no fluxo atual. Herança de `pi-orq`. Se você
adicionar etapa de validação ou push automático, use os labels
existentes em vez de criar novos.

`killed_by_autoscaler` (também declarada em `AgentLifecyclePhase`) é
**atribuída**, mas só pelo `Orchestrator.destroyAgent()` quando o
`AutoScaler` cruza o threshold de destroy (default RAM/CPU ≥ 95%) — a
task é re-enfileirada e o flag `killedByAutoScaler: true` fica no
`AgentStatus` correspondente até a próxima tentativa.

### 15.2 Tempo de cada fase (rastreável via debug-logger)

Os eventos NDJSON `orch.spawn_start`, `orch.worktree_ready`,
`orch.stage_advance`, `orch.attempt_failed` carregam `durationMs`
explícito. Bata `huu status --json` ou parseie `.huu/debug-*.log` pra ter
um waterfall.

---

## 16. Trace real: walkthrough cronológico de um run

Pegue um pipeline com 2 stages × 2 arquivos cada (4 agents totais), com
concurrency 2. O que acontece no tempo:

```
T=0:     huu run pipeline.json
         cli.tsx → reexecInDocker (se host) → render <App />
         debug-logger init → writeActiveRunSentinel(/tmp/huu/active)
T=0+5:   App auto-navigate (autoStart=true) → <PipelineEditor>
         Usuário aperta ENTER → <ModelSelectorOverlay>
         Usuário pica modelo → (se sem key) <ApiKeyPrompt>, senão <RunDashboard>

T=10:    <RunDashboard> mounted
         new Orchestrator(config, pipeline, cwd, realAgentFactory, opts)
         orch.subscribe(...) ; orch.start()

T=10.1:  Orchestrator.start()
         status='starting' → emit
         runPreflight(cwd):
           git rev-parse --show-toplevel    → repoRoot
           git status --porcelain            → isDirty
           git rev-parse --abbrev-ref HEAD   → baseBranch
           git rev-parse HEAD                → baseCommit
           git remote                         → hasRemote
         (HUU_CHECK_PUSH=0 → skipped)
         valid=true → log warnings

T=10.2:  generateRunId() → "k3l9m2p1"
         new RunLogger({ repoRoot, runId, pipelineName, startedAt })
         ensureGitignored: .huu-worktrees/, .huu/, .env.huu, .huu-bin/, .huu-cache/

T=10.3:  ensureNativeShim(repoRoot) → builda libhuu_bind.so
         (ou cacheia em .huu-cache/native-shim/)

T=10.4:  WorktreeManager.createIntegrationWorktree()
         git branch huu/k3l9m2p1/integration <baseCommit>
         git worktree add .huu-worktrees/k3l9m2p1/integration <branch>
         manifest = { runId, baseBranch, baseCommit, integrationBranch, … }
         status='running' → emit

T=10.5:  Pre-decompose all stages (todas as cards visíveis em TODO)
         Stage 0: decomposeTasks(["a.ts","b.ts"], 1, 0, "stage1") → 2 tasks
         Stage 1: decomposeTasks(["c.ts","d.ts"], 3, 1, "stage2") → 2 tasks
         agents.set(1..4, initialAgentStatus(...))    (phase='pending')

T=10.6:  Stage 1 — executeTaskPool(stageTasks=[1,2], step):
         pendingTasks=[1,2], activeAgents={}, instanceCount=2
         spawn replacements: 2 slots → spawnAndRun(task1), spawnAndRun(task2)

T=10.7:  spawnAndRun(task1, step):  (em paralelo task2)
           updateAgentStatus(1, phase='worktree_creating')
           createAgentWorktree(1, baseCommit, attempt=1):
             git branch huu/k3l9m2p1/agent-1 <baseCommit>
             git worktree add .huu-worktrees/k3l9m2p1/agent-1 <branch>
           (≈100ms)
           updateAgentStatus(1, phase='worktree_ready', branchName, worktreePath)

T=10.8:    portAllocator.allocate(1) → bundle { http:55100, db:55101, ws:55102, ... }
           writeAgentEnvFile(worktreePath, bundle, runId, nativeShim) → .env.huu
           writeAgentBinShim(worktreePath) → .huu-bin/with-ports

T=10.9:    updateAgentStatus(1, phase='session_starting')
           realAgentFactory(task1, config, hint, worktreePath, onEvent, ctx):
             AuthStorage.create() + setRuntimeApiKey('openrouter', key)
             getModel('openrouter', modelId) → model
             ModelRegistry + headers
             resolveThinkingLevel(modelId, key) → 'medium'
             createAgentSession({ model, thinkingLevel, sessionManager: inMemory(),
                                  authStorage, modelRegistry, cwd: worktreePath })
             session.subscribe(translateEvent → onEvent)
             return SpawnedAgent { prompt, dispose, … }

T=11:    activeAgents.set(1, agent), spawningIds.delete(1)
         renderedPrompt = step.prompt.replaceAll('$file', 'a.ts')
         updateAgentStatus(1, state='streaming', phase='streaming')
         agent.prompt(buildFullMessage(...))   ← bloqueia aqui

T=11.1:  Pi SDK fires events (durante stream do LLM):
         { type: 'agent_start' }
           → translateEvent → state_change(streaming) + log('agent started')
         { type: 'tool_execution_start', toolName: 'read', args: { path: 'a.ts' } }
           → state_change(tool_running) + log('tool: read → a.ts')
         { type: 'tool_execution_end', toolName: 'read' }
           → state_change(streaming) + log('tool done: read')
         …mais reads, edits…
         { type: 'tool_execution_start', toolName: 'edit', args: { path: 'a.ts' } }
           → state_change(tool_running) + log + file_write { file: 'a.ts' }
         { type: 'tool_execution_end', toolName: 'edit' }
         { type: 'message_end', message: { usage: { input: 1842, output: 394, cost: { total: 0.012345 }}}}
           → log('tokens +1842in +394out $0.012345')
         { type: 'agent_end' }
           → log('agent finished')        ← NÃO emite done

T=42:    session.prompt() resolve normally
         Re-extração: state.messages[-1].stopReason !== 'error' → ok
         onEvent({ type: 'done' })
         (defesa em profundidade) state.state === 'done' → ok

T=42.1:  finalizingIds.add(1), activeAgents.delete(1)
         agent.dispose() → unsubscribe + session.dispose()
         finalizeAgent(1):
           updateAgentStatus(1, phase='finalizing')
           git.hasChanges → true
           updateAgentStatus(1, phase='committing')
           git.getChangedFiles → ['src/lib/a.ts']
           git.stageAll
           git.commitNoVerify → "[refactor-and-document] stage1 (agent 1)"
                              → commitSha "9f8e7d6c…"
           updateAgentStatus(1, commitSha, filesModified=['src/lib/a.ts'])
           updateAgentStatus(1, phase='cleaning_up')
           git.worktree remove .huu-worktrees/k3l9m2p1/agent-1
           updateAgentStatus(1, phase='done', state='done')
           portAllocator.release(1)
           completedTasks++
           appendManifestEntry(1)

T=43:    poolWakeup → executeTaskPool wakes up
         (task2 finalizou em T=44, similar)

T=45:    pendingTasks=[], activeAgents={}, finalizingIds={} → loop exits
         status='integrating' → emit
         runStageIntegration(stageTasks):
           eligibleEntries = [agent-1, agent-2] (com commitSha)
           runStageIntegrationWithResolver(entries, ctx):
             mergeAgentBranches:
               git merge huu/k3l9m2p1/agent-1 --no-ff -m "Merge huu/k3l9m2p1/agent-1"
                 → success
               git merge huu/k3l9m2p1/agent-2 --no-ff
                 → success
             status.phase='done' → return early (sem precisar de LLM)
         stageBaseRef = git.getHead(integration worktree)  ← novo HEAD
         manifest.stageBaseCommits.push(stageBaseRef)
         status='running' → emit

T=46:    Stage 2 — mesma sequência, mas agora branchando do stageBaseRef
         (que tem o merge do stage 1).

T=110:   Todos stages concluídos.
         worktreeManager.removeIntegrationWorktree (best-effort)
         status='done', manifest.finishedAt, manifest.status='done' → emit

T=110.1: finally: runLogger.flush(manifest, integrationStatus, agents)
           → escreve .huu/<stamp>-execution-<runId>.log
           → escreve .huu/<stamp>-execution-<runId>/{orchestrator,integrator,agent-N}.log
         emit() ← log final

T=110.2: orch.start() promise resolve com OrchestratorResult
         RunDashboard .then → onComplete(result) → navigate({ kind: 'summary', result })

T=110.3: <Summary> mostra runId, integration branch, duration, agents committed,
         files modified, conflicts.

T=120:   Usuário Q → exit() → restoreTerminal → clearActiveRunSentinel
         debug-logger 'lifecycle.exit' → close fd → process.exit(0)
```

---

## 17. GitClient: API e por que `execFile`

`src/git/git-client.ts:116-279`. Métodos disponíveis:

```ts
class GitClient {
  constructor(private cwd: string) {}

  exec(args: string, timeout?: number): Promise<string>;

  // branches
  createBranch(name: string, startPoint: string): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  deleteRemoteBranch(name: string): Promise<boolean>;
  branchExists(name: string): Promise<boolean>;

  // worktrees
  addWorktree(path: string, branch: string): Promise<void>;
  removeWorktree(path: string): Promise<void>;
  pruneWorktrees(): Promise<void>;

  // status / diff
  hasChanges(worktreePath: string): Promise<boolean>;
  getChangedFiles(worktreePath: string): Promise<string[]>;
  getHead(worktreePath: string): Promise<string>;

  // commit / push / merge
  stageAll(worktreePath: string): Promise<void>;
  commitNoVerify(worktreePath: string, message: string): Promise<string>;  // returns sha
  push(branchName: string, retries?: number): Promise<void>;                // exponential backoff
  merge(worktreePath: string, branchName: string):
        Promise<{ success: boolean; conflicts: string[] }>;
  abortMerge(worktreePath: string): Promise<void>;
}
```

### 17.1 `commitNoVerify` — sem hooks

```ts
async commitNoVerify(worktreePath: string, message: string): Promise<string> {
  await runGit(['commit', '--no-verify', '-m', message], { cwd: worktreePath, timeout: 30_000 });
  const result = await runGit(['rev-parse', 'HEAD'], { cwd: worktreePath, timeout: 10_000 });
  return result.stdout.trim();
}
```

`--no-verify` evita pre-commit hooks (linters lentos). O agente não tem
permissão de commit (é o orchestrator que faz), e queremos que essa fase
seja determinística e rápida.

### 17.2 `merge` — captura conflicts

```ts
async merge(worktreePath, branchName): Promise<{ success: boolean; conflicts: string[] }> {
  try {
    await runGit(['merge', branchName, '--no-ff', '-m', `Merge ${branchName}`],
                 { cwd: worktreePath, timeout: 60_000 });
    return { success: true, conflicts: [] };
  } catch (err) {
    try {
      const result = await runGit(['diff', '--name-only', '--diff-filter=U'],
                                  { cwd: worktreePath, timeout: 10_000 });
      const status = result.stdout.trim();
      const conflicts = status ? status.split('\n') : [];
      return { success: false, conflicts };
    } catch {
      return { success: false, conflicts: [errorMessage(err)] };
    }
  }
}
```

`--no-ff` força commit de merge (mantém história visível). `diff
--diff-filter=U` lista só arquivos com unmerged paths.

### 17.3 Por que `execFile` (e não `execSync`)

Comentário em `git-client.ts:60-69`:

> Why async: every git invocation here was `execSync`, which suspends
> the main thread for the full duration of the child process —
> typically 30–500 ms, sometimes seconds for `worktree add` and `merge`.
> While the loop is blocked, Ink cannot drain `process.stdin`, so user
> keypresses (Q, ↑↓←→, +/-, Enter) pile up in the terminal buffer and
> the dashboard appears frozen even though `useInput` is correctly
> attached. Switching to `execFile` lets stdin events interleave with
> git work and keeps the TUI responsive.

### 17.4 Por que `nonInteractiveGitEnv()`

Já documentado em §5.4. Resumo: quando git tenta abrir `/dev/tty` para
prompt de credencial, ele rouba o stdin do Ink (raw mode), congelando a
TUI mesmo após o git terminar. `GIT_TERMINAL_PROMPT=0` +
`GIT_ASKPASS=true` + `SSH_ASKPASS=true` + `GCM_INTERACTIVE=Never`
forçam falha rápida em vez de prompt.

---

## 18. Preflight: o que é validado antes do run

`src/git/preflight.ts:6-119`. Roda no início do
`Orchestrator.start()`. Retorna `PreflightResult`:

```ts
interface PreflightResult {
  valid: boolean;        // false → orchestrator throws
  repoRoot: string;
  baseBranch: string;
  baseCommit: string;
  isDirty: boolean;
  hasRemote: boolean;
  canPush: boolean;
  errors: string[];
  warnings: string[];
}
```

Checks:

| Check                              | Falha → erro            | Detalhes                                  |
| ---------------------------------- | ----------------------- | ----------------------------------------- |
| `git rev-parse --show-toplevel`    | "Not a git repository"  | Aborta antes de qualquer outra coisa     |
| `git status --porcelain`           | só warning              | Working tree sujo é OK (worktree isola)   |
| `git rev-parse --abbrev-ref HEAD`  | erro se "HEAD" (detached) | Precisa estar em uma branch              |
| `git rev-parse HEAD`               | erro se falhar          | Precisamos do baseCommit                  |
| `git remote`                       | só warning              | "Push will be skipped"                    |
| `git push --dry-run origin HEAD`   | só warning + canPush=false | **Skipped por default** — só roda se `HUU_CHECK_PUSH=1` |

A última checagem é gated por env var porque era a maior fonte de
freezes da TUI quando credentials estavam expirados (vide comentário em
`preflight.ts:74-91`).

---

## 19. Worktree, branch naming e isolamento

### 19.1 Convenção de nomes — `src/git/branch-namer.ts`

```ts
const WORKTREE_BASE_DIR = '.huu-worktrees';
const BRANCH_PREFIX = 'huu';

export function agentBranchName(runId: string, agentId: number, attempt = 1): string {
  const suffix = attempt > 1 ? '-retry' : '';
  return `${BRANCH_PREFIX}/${runId}/agent-${agentId}${suffix}`;
}

export function agentWorktreePath(repoRoot, runId, agentId, attempt = 1): string {
  const suffix = attempt > 1 ? '-retry' : '';
  return join(resolveBase(repoRoot), runId, `agent-${agentId}${suffix}`);
}

export function integrationBranchName(runId: string): string {
  return `${BRANCH_PREFIX}/${runId}/integration`;
}

export function integrationWorktreePath(repoRoot, runId): string {
  return join(resolveBase(repoRoot), runId, 'integration');
}
```

Exemplos com `runId = "k3l9m2p1"`:

| Tipo                  | Branch                                | Worktree                                          |
| --------------------- | ------------------------------------- | ------------------------------------------------- |
| Integration           | `huu/k3l9m2p1/integration`             | `.huu-worktrees/k3l9m2p1/integration`             |
| Agent 1, attempt 1    | `huu/k3l9m2p1/agent-1`                 | `.huu-worktrees/k3l9m2p1/agent-1`                 |
| Agent 1, attempt 2    | `huu/k3l9m2p1/agent-1-retry`            | `.huu-worktrees/k3l9m2p1/agent-1-retry`           |

### 19.2 `HUU_WORKTREE_BASE` override

`branch-namer.ts:11-15`:

```ts
function resolveBase(repoRoot: string): string {
  const override = process.env.HUU_WORKTREE_BASE;
  if (!override) return join(repoRoot, WORKTREE_BASE_DIR);
  return isAbsolute(override) ? override : join(repoRoot, override);
}
```

Útil quando o repo está em mount lento (bind mount Docker em macOS, NFS)
e queremos worktrees em volume rápido (`/tmp`, tmpfs).

### 19.3 `WorktreeManager` — API

`src/git/worktree-manager.ts`:

```ts
class WorktreeManager {
  constructor(repoRoot, runId, baseCommit);

  createIntegrationWorktree(): Promise<WorktreeInfo>;
  createAgentWorktree(agentId, startRef?, attempt = 1): Promise<WorktreeInfo>;
  removeAgentWorktree(agentId, attempt = 1): Promise<void>;
  removeIntegrationWorktree(): Promise<void>;
  cleanupAll(): Promise<void>;
  cleanupRunFromManifest(manifest, deleteRemote): Promise<{
    worktreesRemoved: number; localBranchesDeleted: number; remoteBranchesDeleted: number;
  }>;
  getGitClient(): GitClient;
  getBaseDir(): string;
}
```

Importante: `createAgentWorktree(agentId, startRef)` — quando
`startRef` é fornecido (e não é o `baseCommit`), branchamos do
`stageBaseRef` que reflete o HEAD da integration **após o merge do stage
anterior**. Isso garante que stage N+1 vê tudo que stage N produziu.

---

## 20. Port allocator + `.env.huu` + native shim (`bind()` interceptor)

### 20.1 PortAllocator — `src/orchestrator/port-allocator.ts`

Cada agente reserva uma janela contígua de portas TCP. Defaults:

```ts
const DEFAULT_BASE_PORT = 55100;
const DEFAULT_WINDOW_SIZE = 10;
const DEFAULT_MAX_AGENTS = 20;
const SLOTS_PER_BUNDLE = 10;
```

Bundle gerado:

```ts
interface AgentPortBundle {
  agentId: number;
  http: number;       // primeiro slot
  db: number;         // segundo
  ws: number;         // terceiro
  extras: number[];   // 7 slots
  databaseUrl: string;  // postgresql://localhost:<db>/huu_agent_<id>
}
```

Probe TCP (`exclusive: true` em `127.0.0.1`) para garantir que a janela
está realmente livre. Se algum slot está ocupado por processo externo, a
janela inteira desliza pro próximo slot.

### 20.2 `.env.huu` gerado no worktree

`src/orchestrator/agent-env.ts:47-94`. Exemplo real para `agentId=3`,
bundle `{ http: 55120, db: 55121, ws: 55122, extras: [55123..55129] }`:

```bash
# Auto-generated by huu — per-agent port allocation. Do not commit.
HUU_RUN_ID=k3l9m2p1
HUU_AGENT_ID=3

# Primary HTTP port — most frameworks honour PORT.
PORT=55120
HUU_PORT=55120
HUU_PORT_HTTP=55120
HUU_PORT_DB=55121
HUU_PORT_WS=55122
HUU_PORT_EXTRA_1=55123
HUU_PORT_EXTRA_2=55124
HUU_PORT_EXTRA_3=55125
HUU_PORT_EXTRA_4=55126
HUU_PORT_EXTRA_5=55127
HUU_PORT_EXTRA_6=55128
HUU_PORT_EXTRA_7=55129

# Convenience URLs.
DATABASE_URL=postgresql://localhost:55121/huu_agent_3
HUU_DATABASE_URL=postgresql://localhost:55121/huu_agent_3

# bind() rewrite map consumed by the native shim. Even hard-coded
# app.listen(3000) gets remapped to a per-agent port at the syscall
# boundary when the shim is preloaded.
HUU_PORT_REMAP=3000:55120,3001:55122,3002:55121,3003:55123,4000:55124,…,*:55120

# Native bind() interceptor — keeps the customer code untouched while
# guaranteeing each agent binds a unique kernel port.
LD_PRELOAD=/repo/.huu-cache/native-shim/libhuu_bind.so
# (em macOS, em vez do LD_PRELOAD acima:)
# DYLD_INSERT_LIBRARIES=/repo/.huu-cache/native-shim/libhuu_bind.dylib
# DYLD_FORCE_FLAT_NAMESPACE=1
```

### 20.3 `.huu-bin/with-ports` — shim shell

```bash
#!/usr/bin/env bash
# Auto-generated by huu — sources .env.huu (which may contain LD_PRELOAD /
# DYLD_INSERT_LIBRARIES + HUU_PORT_REMAP) and execs the wrapped command so
# agents inherit per-worktree port allocations even when the underlying tool
# ignores dotenv files.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$DIR/.env.huu" ]; then
  set -a
  source "$DIR/.env.huu"
  set +a
fi
exec "$@"
```

Usado pelo agente quando precisa rodar binário que não respeita dotenv:

```bash
./.huu-bin/with-ports python -m http.server $HUU_PORT_HTTP
```

### 20.4 Native shim — `bind()` interceptor (LD_PRELOAD/DYLD)

Compilado on-demand pra `.huu-cache/native-shim/`. Intercepta chamadas
`bind(2)` e remapeia portas conforme `HUU_PORT_REMAP`. Detalhes
completos na skill `port-isolation` (`PORT-SHIM.md` na raiz).

Quando ativo, mesmo `app.listen(3000)` literal cai na porta do agente.
Quando indisponível (ex: container minimal sem gcc), o orchestrator
emite warning e segue sem injection.

---

## 21. Caso especial: integration agent (resolução de conflitos)

Quando merges determinísticos falham, o orchestrator **respawna** uma
nova sessão Pi com role e prompt diferentes para resolver os conflitos.
Tudo em `src/orchestrator/integration-agent.ts`.

### 21.1 Fluxo (`runStageIntegrationWithResolver`)

1. Tenta `mergeAgentBranches` determinístico
   (`git/integration-merge.ts`). Itera as branches do stage por
   `agentId`, faz `git merge` uma a uma, registra conflicts e `abortMerge`
   em caso de falha.
2. Se `phase === 'done'` → retorna sucesso, **integration agent não é
   spawnado**.
3. Se há `branchesPending` mas zero conflicts → falha por outro motivo
   (timeout, hook). Retorna `error` sem chamar Pi (o agente não tem
   nada pra resolver).
4. Se há conflicts → spawna Pi via mesma `resolverFactory`
   (tipicamente `realAgentFactory`):

```ts
agent = await ctx.resolverFactory(
  integrationTask,                      // agentId 9999
  ctx.config,
  generateIntegrationSystemPrompt(...),
  ctx.integrationWorktreePath,           // cwd no worktree de integração
  eventForwarder,                         // forward → ctx.onEvent
);
await agent.prompt(message);              // message: system + buildIntegrationPrompt
```

5. Verificação pós-execução: para cada branch ainda em `branchesPending`,
   tenta `git merge` final. Aceita "Already up to date" como sucesso.
   Falha loud se algum conflict ainda restou.
6. Se há changes não-commitadas no worktree de integração, gera
   commit-sentinela `[huu] Integration merge — <runId>`.
7. Retorna `{ success, status, resolvedConflicts }`.

### 21.2 Diferenças vs. agente normal

- **agentId reservado: 9999** (constante `INTEGRATION_AGENT_ID`).
- **Worktree:** roda no integration worktree, não em um per-agent.
- **System prompt:** explicitamente **autoriza git** (vide §9.3).
- **Prompt:** estruturado em XML (`buildIntegrationPrompt`) com seções
  `<task>`, `<merged>`, `<pending>`, `<conflicts>`, `<resolution-steps>`,
  `<output>` — testado pra dar bom resultado em modelos diversos.
- **Eventos:** mesma tradução, mas roteados via `eventForwarder` que os
  carimba com `agentId = 9999` antes de cair em `Orchestrator.log`.
- **Logs:** acabam no arquivo `integrator.log` por causa do
  `formatAgent` em `run-logger.ts:178-182`.

### 21.3 Exemplo de prompt rendered enviado ao integration agent

Para um stage com `agent-1` e `agent-2` mergeados, `agent-3` com
conflict em `src/lib/foo.ts`:

```xml
<task>
Merge all agent branches into integration branch: huu/k3l9m2p1/integration
</task>

<merged>
- huu/k3l9m2p1/agent-1
- huu/k3l9m2p1/agent-2
</merged>

<pending>
- huu/k3l9m2p1/agent-3
</pending>

<conflicts>
- src/lib/foo.ts (from: huu/k3l9m2p1/agent-3)
</conflicts>

<resolution-steps>
1. For each pending branch, run `git merge <branch-name>` via the bash tool
2. Read conflicting files to understand both sides
3. Edit files to combine changes correctly — preserve all intended modifications
4. Run `git add <file>` on each resolved file
5. Run `git commit -m "..."` to complete each merge
6. Repeat for each pending branch
</resolution-steps>

<output>
Summarize: branches merged, conflicts resolved (and how), any concerns.
</output>
```

Esse texto é precedido pelo system prompt da §9.3, separados por `\n\n---\n\n`.

### 21.4 Quando NÃO usar resolver LLM

`cli.tsx:211`:

```ts
const conflictResolverFactory = useStub ? undefined : realAgentFactory;
```

Stub agents não conseguem resolver merges de verdade. Quando ausente, o
`Orchestrator` usa só o caminho determinístico e trata qualquer conflict
como falha (a menos que `continueOnConflict: true`).

---

## 22. Pipeline assistant + project recon (LangChain.js — não é Pi)

> **Histórico:** uma versão anterior dessa seção descrevia um *refinement
> chat* baseado em `interactive: true` por step. Esse fluxo foi
> revertido em `9647ef6` (commit "Revert feat(pipeline): add interactive
> refinement stages…"). O huu não suporta mais `interactive: true` no
> schema; a porta de entrada conversacional virou o **pipeline
> assistant**, que opera no nível de pipeline inteira em vez de step a
> step. Isto também é a razão pela qual `HUU_LANGCHAIN_STUB` foi
> removido das vars de ambiente — não tem mais um stub langchain.

**Importante:** o pipeline assistant **NÃO usa Pi**. Usa LangChain.js +
`ChatOpenAI` apontando pra OpenRouter (`src/lib/assistant-client.ts`).
Os 4 agentes de project recon usam o mesmo client com schema diferente
(`src/lib/project-recon.ts`).

Por que separar do Pi:

- O Pi é otimizado pra **execução** com tools (read/bash/edit/write) —
  caro e overkill pra um fluxo conversacional.
- O assistant é puramente Q&A com saída structured (Zod schema), pode
  usar modelo barato (default `DEFAULT_ASSISTANT_MODEL`, e recon
  defaulta pra `minimax/minimax-m2.7`).
- LangChain tem suporte testado pra structured output / tool calling
  via `withStructuredOutput(schema)`, e é mais barato de manter aqui
  do que recriar isso na Pi SDK.

### 22.1 Project recon (4 agentes paralelos, single-pass, digest-only)

Disparado quando o usuário entra no estágio `recon` do
`PipelineAssistant`. O fluxo:

1. `lib/project-digest.ts:buildProjectDigest()` monta um snapshot
   estático: file tree truncado + `package.json` + `README.md` +
   `CLAUDE.md` + `AGENTS.md` + `tsconfig.json`. **Sem ferramentas.**
2. `lib/project-recon.ts:runProjectRecon()` cria 4 `ChatOpenAI` em
   paralelo, um por mission do `RECON_AGENTS`:

   - `stack` — só lê `package.json`/`tsconfig.json`, lista linguagem,
     runtime, package manager, scripts.
   - `structure` — só lê o file tree, lista diretórios top-level de
     `src/`.
   - `libraries` — só lê `dependencies` (ignora dev), 4-6 deps com
     papel curto.
   - `conventions` — só lê `README.md`/`CLAUDE.md`/`AGENTS.md`, extrai
     regras explícitas (commit, testes, lint).

3. Cada agente retorna um `ReconBullets` (Zod: 1-5 strings ≤180
   chars). Modo de operação: **PASSO ÚNICO**, sem chain-of-thought,
   sem auto-revisão. Foi endurecido em `c041dd3` justamente porque os
   agentes estavam fazendo loops desnecessários.
4. `aggregateReconBullets()` consolida tudo em um bloco markdown que
   é injetado no system prompt do assistant.

### 22.2 Assistant chat (≤8 turnos)

`lib/assistant-client.ts:createAssistantChat()` retorna um chat
LangChain com `withStructuredOutput(AssistantTurnSchema)`:

```ts
type AssistantTurn =
  | { kind: 'question'; question: string; options: AssistantOption[] }
  | { kind: 'done'; draft: PipelineDraft };
```

Cada turn é uma multiple choice (com a última opção sempre
`isFreeText: true`) ou um `done` com a draft. O ciclo:

1. System prompt = `buildAssistantSystemPrompt({ reconReport, … })`.
2. Initial human message = `buildInitialHumanMessage(intent)` — frase
   única descrita pelo user no estágio `intent`.
3. Para cada resposta, o assistant emite um novo turn. Após
   `MAX_TURNS = 8` perguntas, um `FORCE_DONE_NUDGE` é appendado pra
   forçar `kind: 'done'`.
4. `PipelineDraft` é convertido pra `Pipeline` (cada step ganha
   `files: []` no draft inicial — o usuário escolhe os arquivos no
   editor depois) e o assistant fecha.

### 22.3 O que isso NÃO faz

- Não roda agentes Pi.
- Não toca em arquivos do repo (recon é digest-only; assistant é só
  texto).
- Não persiste nada — a draft viaja em memória até o
  `PipelineEditor`.
- Não fica no caminho de runs existentes: pipelines importadas via
  `huu run x.json` ou via `I` no welcome pulam o assistant
  inteiramente.

Ambas as instruções aparecem dinamicamente no `buildRefinerSystemPrompt`
e no `buildSynthesisRequest`.

---

## 23. Sinais externos: SIGINT/SIGTERM, abort, dispose

### 23.1 Botão `Q` no dashboard

`RunDashboard.tsx:310-318`:

```ts
if (input === 'q' || input === 'Q') {
  if (abortedRef.current) { onAbortRef.current(); return; }
  abortedRef.current = true;
  setAborting(true);
  orch.abort();
}
```

Primeiro `Q` → pede abort gracioso. Segundo `Q` → exit imediato (deixa o
orchestrator finalizar em background).

### 23.2 `Orchestrator.abort()`

`orchestrator/index.ts:217-238`:

```ts
abort(): void {
  if (this.aborted) return;
  this.aborted = true;
  dlog('orch', 'abort_requested', { activeAgents: this.activeAgents.size });
  this.log({ level: 'warn', message: 'abort requested' });
  for (const [agentId, agent] of this.activeAgents) {
    try { void agent.dispose(); } catch {}
    this.activeAgents.delete(agentId);
    this.portAllocator.release(agentId);
  }
  this.portAllocator.releaseAll();
  this.poolWakeup?.();
}
```

Crucial: `agent.dispose()` é chamado **imediatamente** (sem await) em
todos os agentes ativos. Sem isso, o pool poll loop esperava agentes
terminarem naturalmente e a UI parecia travada por segundos.

### 23.3 `SpawnedAgent.dispose()` para Pi real

`real-agent.ts:211-226`:

```ts
async dispose(): Promise<void> {
  if (disposed) return;
  disposed = true;
  try { unsubscribe(); } catch {}
  try { session.dispose(); } catch {}
  const ref = spawned as unknown as { task: unknown };
  ref.task = null;
}
```

Two-step:
1. Remove o subscriber de eventos do Pi (sem isso, eventos chegam num
   handler dead-end e podem causar leaks).
2. `session.dispose()` da SDK — fecha streams, libera tokens em flight,
   cancela qualquer fetch pendente do provider.

### 23.4 Sinais de processo

Em `cli.tsx:136-160` o boot registra:

```ts
process.on('exit',     restoreTerminal);
process.on('SIGINT',   () => { restoreTerminal(); process.exit(130); });
process.on('SIGTERM',  () => { restoreTerminal(); process.exit(143); });
process.on('SIGHUP',   () => { restoreTerminal(); process.exit(129); });
process.on('uncaughtException',  (err)    => { restoreTerminal(); console.error(...); process.exit(1); });
process.on('unhandledRejection', (reason) => { restoreTerminal(); console.error(...); process.exit(1); });
```

`restoreTerminal()` (cli.tsx:108-134):

```ts
function restoreTerminal(): void {
  if (terminalRestored) return;
  terminalRestored = true;
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
  } catch {}
  try {
    if (process.stdout.isTTY) {
      // Show cursor + disable mouse tracking modes
      process.stdout.write('\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l');
    }
  } catch {}
  if (!isNonTui) {
    clearActiveRunSentinel(process.cwd());
  }
}
```

Defesa em profundidade contra Ink não conseguir desmontar limpamente.
Também roda `clearActiveRunSentinel(cwd)` para remover
`/tmp/huu/active`.

O `debug-logger` registra esses sinais antes do exit
(`lib/debug-logger.ts:113-127`), então mesmo após crash temos rastro do
último estado.

### 23.5 Unmount do RunDashboard

`RunDashboard.tsx:150-169`: se o componente desmonta com o orchestrator
ainda rodando (ex: usuário aperta `Q` duas vezes), faz `orch.abort()`
defensivamente e rejeita qualquer `pendingInteractive` pra liberar a
Promise que segura o stage.

---

## 24. Token tracking & cost — caveat importante

> **A UI mostra `tokens 0↓ 0↑` e `cost $0` no modal e no run log
> per-agent**, mesmo quando o LLM consumiu tokens reais. Isso é um
> bug/limitação conhecida — não confiar em `AgentStatus.tokensIn/Out`
> nem nos campos `tokens:` do report.

### 24.1 O que efetivamente acontece

1. A SDK Pi emite `message_end { usage: { input, output, cost: { total }}}`
   ao final de cada turn.
2. `translateEvent` extrai esses valores e emite **um log**:
   `tokens +1842in +394out $0.012345` (real-agent.ts:73-83).
3. Esse log entra em `AgentStatus.logs[]`, `OrchestratorState.logs[]`,
   no RunLogger e no debug log — **mas os campos `tokensIn`,
   `tokensOut`, `cacheReadTokens`, `cacheWriteTokens`, `cost` do
   `AgentStatus` permanecem em 0** (inicializados em
   `orchestrator/index.ts:977-981` e nunca atualizados).

### 24.2 Onde isso aparece (incorretamente)

- **RunModal**: `agent.tokensIn ↓ agent.tokensOut ↑` (sempre `0↓ 0↑`).
- **`OrchestratorState.totalCost`**: anotado como `// M5 will populate`
  em `orchestrator/index.ts:189` — fica em 0.
- **Run log per-agent header**: `# Tokens: in=0 out=0 cacheR=0
  cacheW=0`.
- **Run log Per-Agent Summary**: `tokens: in=0 out=0 cacheR=0 cacheW=0`.

### 24.3 Onde sai certo

- **Linha de log**: `[INFO] [agent-N] tokens +1842in +394out $0.012345`
  — essa string TEM os valores reais. Pra somar custo, faça grep no
  `.huu/<stamp>-execution-<runId>.log`:

```bash
grep -E 'tokens \+[0-9]+in' .huu/*-execution-*.log | \
  awk -F'tokens \\+' '{print $2}' | \
  awk '{ in_t += $1; out_t += $2; gsub("\\$","",$3); cost += $3 }
       END { print "in:", in_t, "out:", out_t, "cost: $", cost }'
```

### 24.4 Como corrigir (TODO)

Adicionar caso `'message_end'` em `Orchestrator.handleAgentEvent` que
parseie a string ou (melhor) propagar `usage` como evento estruturado:

```ts
// Sugestão: adicionar ao AgentEvent
| { type: 'usage'; input: number; output: number; cost: number;
    cacheRead?: number; cacheWrite?: number };

// translateEvent (real-agent.ts):
case 'message_end': {
  const usage = event.message?.usage ?? event.usage;
  if (usage) {
    onEvent({ type: 'usage',
      input: usage.input ?? usage.inputTokens ?? 0,
      output: usage.output ?? usage.outputTokens ?? 0,
      cost: usage.cost?.total ?? 0,
      cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens });
  }
  break;
}

// Orchestrator.handleAgentEvent:
case 'usage':
  this.updateAgentStatus(agentId, {
    tokensIn:  cur.tokensIn  + event.input,
    tokensOut: cur.tokensOut + event.output,
    cost:      cur.cost      + event.cost,
    cacheReadTokens: cur.cacheReadTokens + (event.cacheRead ?? 0),
    cacheWriteTokens: cur.cacheWriteTokens + (event.cacheWrite ?? 0),
  });
  break;
```

(Não aplicado ainda — requer também atualizar `OrchestratorState.totalCost`.)

---

## 25. Inspeção pós-mortem: `huu status`, `.huu/`, sentinel

### 25.1 `huu status [--json] [--liveness] [--stalled-after <s>]`

Implementado em `src/lib/status.ts`. Não toca em git nem em Pi — só
**parseia** o NDJSON em `<cwd>/.huu/debug-*.log` e responde:

- **phase**: `running` | `finished` | `stalled` | `crashed` | `unknown`
- `lastEventAt`, `lastHeartbeatAt`, `lastHeartbeatLagMs`
- `lastActivity` (último evento não-heartbeat com `cat.ev`)
- `exit { code, t }` se houver
- `crash { reason, t }` se houver
- `counters`: `stagesAdvanced`, `spawns`, `errors`
- `startedAt`

Redução de phase em `status.ts:213-222`:

```ts
if (report.exit)            → exit.code === 0 ? 'finished' : 'crashed';
else if (report.crash)       → 'crashed';
else if (lastEventAt)        → idleMs > stalledAfterMs ? 'stalled' : 'running';
else                          → 'unknown';
```

**Exit codes do CLI:**
- `0` running ou finished cleanly
- `1` stalled ou crashed
- `2` no log found

**`--liveness`** suprime output, exit 0 a menos que stalled/crashed.
Mapeia em Docker `HEALTHCHECK`: a pergunta é "está ATIVAMENTE quebrado?"
— idle/sem run/finished limpo todos contam como saudável.

### 25.2 Saída de `huu status --json`

```json
{
  "logPath": "/repo/.huu/debug-2026-04-29T12-34-56-789Z.log",
  "logSizeBytes": 47128,
  "logMtime": 1713345600123,
  "phase": "running",
  "lastEventAt": 1713345599456,
  "lastHeartbeatAt": 1713345599267,
  "lastHeartbeatLagMs": 2,
  "lastActivity": { "cat": "orch", "ev": "spawn_start", "t": 1713345599456 },
  "exit": null,
  "crash": null,
  "counters": { "stagesAdvanced": 1, "spawns": 4, "errors": 0 },
  "startedAt": 1713345590000
}
```

### 25.3 Saída de `huu status` (texto)

```
huu status — /repo
  log:           /repo/.huu/debug-…log (47.1 KiB)
  status:        running
  started:       2m 30s ago
  last event:    1.5s ago
  last activity: 1.5s ago (orch.spawn_start)
  heartbeat:     200ms ago, lag=2ms
  counters:      stages=1 spawns=4 errors=0
```

### 25.4 Tail eficiente

Para ler apenas a cauda do log (logs podem ter centenas de MB), o reader
usa `tailFile(path, 256 KiB)` e descarta a primeira linha (provável
fragmento). Constante `DEFAULT_TAIL_BYTES` em `status.ts:22`.

### 25.5 Sentinel `/tmp/huu/active` — `lib/active-run-sentinel.ts`

Resolve o problema do Docker HEALTHCHECK: o probe roda como processo
fresh começando em `/`, não no `WORKDIR`. Sem o sentinel, ele não acharia
`<repo>/.huu/debug-*.log`.

- Escrito por `cli.tsx:63` no boot da TUI: `writeActiveRunSentinel(cwd)`.
- Apagado por `restoreTerminal()` no exit.
- Conteúdo: uma linha de texto com o cwd absoluto.
- Local: `/tmp/huu/active` (tmpfs em containers, world-writable via
  sticky bit, fora do repo).
- Best-effort em todos os cantos — falha de write não impede o run.

Como a HEALTHCHECK glue usa:

```bash
#!/bin/sh
# Em algum entrypoint Docker:
[ -f /tmp/huu/active ] && cd "$(cat /tmp/huu/active)" || exit 0
exec huu status --liveness
```

---

## 26. Cleanup orphan (`huu prune`)

Implementado em `src/lib/prune.ts`. Não fala com Pi diretamente — opera
em containers Docker e cidfiles.

### 26.1 O que ele rastreia

- **Containers** com label `huu.orphan=true` (aplicado pelo
  `docker-reexec` quando ele fica órfão), via `docker ps --all --filter
  label=huu.orphan`. Lê `huu.parent-pid` do label e checa se o PID está
  vivo via `process.kill(pid, 0)` (truque do EPERM).
- **Cidfiles stale** em `CIDFILE_DIR` (`/tmp/huu/cidfiles/cid-<pid>-<id>`),
  cujo PID parente está morto.

### 26.2 Modos

- `huu prune --list` → mostra, não muta. Exit 0.
- `huu prune --dry-run` → mostra o que mataria. Exit 0.
- `huu prune` → SIGTERM nos containers, `unlinkSync` nos cidfiles.
- `--json` combina com `--list`/`--dry-run`.

### 26.3 Saída JSON exemplo

```json
{
  "containers": [
    { "id": "abc123…", "image": "ghcr.io/frederico-kluser/huu:latest",
      "parentPid": 12345, "parentAlive": false,
      "createdAt": "2026-04-29 10:00:00 +0000",
      "status": "Up 2 hours" }
  ],
  "staleCidfiles": [
    { "path": "/tmp/huu/cidfiles/cid-12345-x", "pid": 12345, "cid": "abc123…" }
  ]
}
```

### 26.4 Probe de PID (truque EPERM)

```ts
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);   // signal 0 não envia nada, só checa
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';  // existe mas sem permissão
  }
}
```

`ESRCH` = processo gone; `EPERM` = existe mas dono diferente (ainda vivo).

---

## 27. Catálogo de eventos, fases e estados

### 27.1 `AgentEvent` (interno) — `orchestrator/types.ts:4-9`

| type           | shape extra                                       | quem emite |
| -------------- | ------------------------------------------------- | ---------- |
| `log`          | `level?: 'info'\|'warn'\|'error'`, `message`      | translateEvent (Pi `tool_*`, `message_end`, `agent_*`, `auto_compaction_start`); stub agent |
| `state_change` | `state: 'streaming' \| 'tool_running'`            | translateEvent (Pi `agent_start`, `tool_execution_*`); stub |
| `file_write`   | `file: string`                                    | translateEvent (Pi `tool_execution_start` com WRITE_TOOLS); stub |
| `done`         | —                                                 | real-agent.ts:209 (após `prompt()` resolver limpo) |
| `error`        | `message: string`                                 | translateEvent (Pi `error`); real-agent.ts:198 e 206 |

### 27.2 Pi events que `huu` reconhece — `real-agent.ts:43-98`

`agent_start`, `tool_execution_start`, `tool_execution_end`,
`message_end`, `agent_end`, `auto_compaction_start`, `error`. Outros
tipos vindos da SDK são silenciosamente ignorados (default case ausente
no switch).

### 27.3 `AgentLifecyclePhase` — `lib/types.ts:128-142`

`pending` | `worktree_creating` | `worktree_ready` |
`session_starting` | `streaming` | `tool_running` | `finalizing` |
`validating` | `committing` | `pushing` | `cleaning_up` | `done` |
`no_changes` | `error`

(`validating` e `pushing` estão declarados mas sem fluxo atual — herança
de pi-orq.)

### 27.4 `AgentStatus.state` — `lib/types.ts:159`

`'idle' | 'streaming' | 'tool_running' | 'done' | 'error'` —
mais grosso que `phase`, controla cor e coluna do kanban.

### 27.5 `OrchestratorState.status` — `lib/types.ts:185`

`'idle' | 'starting' | 'running' | 'integrating' | 'done' | 'error'` —
estado do run inteiro.

### 27.6 `IntegrationStatus.phase` — `lib/types.ts:201`

`'pending' | 'merging' | 'conflict_resolving' | 'done' | 'error'`

### 27.7 `RunStatus` (manifest) — `lib/types.ts:109`

`'preflight' | 'running' | 'integrating' | 'done' | 'error'`

### 27.8 Defaults numéricos importantes

| Constante                              | Valor          | Onde                                  |
| -------------------------------------- | -------------- | ------------------------------------- |
| `DEFAULT_CONCURRENCY`                  | `10`           | `orchestrator/index.ts:57`            |
| `MAX_INSTANCES`                        | `20`           | `orchestrator/index.ts:58`            |
| `MIN_INSTANCES`                        | `1`            | `orchestrator/index.ts:59`            |
| `POLL_INTERVAL_MS`                     | `500`          | `orchestrator/index.ts:60`            |
| `STATE_FLUSH_INTERVAL_MS`              | `125` (8 Hz)   | `RunDashboard.tsx:35`                 |
| `DEFAULT_CARD_TIMEOUT_MS`              | `600_000` (10min) | `lib/types.ts:80`                  |
| `DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS`  | `300_000` (5min) | `lib/types.ts:81`                  |
| `DEFAULT_MAX_RETRIES`                  | `1`            | `lib/types.ts:82`                     |
| `DEFAULT_BASE_PORT`                    | `55100`        | `port-allocator.ts:19`                |
| `DEFAULT_WINDOW_SIZE`                  | `10`           | `port-allocator.ts:20`                |
| `INTEGRATION_AGENT_ID`                 | `9999`         | `integration-agent.ts:12`             |
| `RUN_LOG_DIR`                          | `'.huu'`       | `lib/run-logger.ts:11`                |
| `HEARTBEAT_MS` (debug logger)          | `200`          | `lib/debug-logger.ts:22`              |
| `DEFAULT_TAIL_BYTES` (status reader)   | `262_144` (256 KiB) | `lib/status.ts:22`                |
| `LOG_SIDEBAR_WIDTH`                    | `42`           | `RunDashboard.tsx:22`                 |
| `LOG_SIDEBAR_MIN_TERMINAL_COLS`        | `100`          | `RunDashboard.tsx:23`                 |

> **Nota:** a skill `pipeline-agents/SKILL.md` lista `default = 2` para
> concurrency. Está stale — o código diz `DEFAULT_CONCURRENCY = 10`.

---

## 28. Tests: como exercitar agentes (stub e real)

### 28.1 Pattern: factory inline pra teste

`src/orchestrator/orchestrator.test.ts:11-23` mostra como criar um
factory deterministic sem depender da SDK Pi:

```ts
const okFactory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
  agentId: task.agentId,
  task,
  async prompt(_message: string): Promise<void> {
    onEvent({ type: 'state_change', state: 'streaming' });
    await new Promise((r) => setTimeout(r, 10));
    const fileName = `s${task.stageIndex}_a${task.agentId}.txt`;
    writeFileSync(join(cwd, fileName), `content\n`, 'utf8');
    onEvent({ type: 'file_write', file: fileName });
    onEvent({ type: 'done' });
  },
  async dispose(): Promise<void> {},
});
```

Esse padrão é o que você usa para testar o orchestrator: factory que
emite eventos previsíveis e escreve um arquivo determinístico.

### 28.2 Setup de repo git temp pra teste

```ts
function setupRepo(dir: string): void {
  execSync('git init --initial-branch=main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"',
           { cwd: dir, shell: '/bin/bash' });
  writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.huu-worktrees/\n', 'utf8');
  execSync('git add -A && git commit -m init', { cwd: dir, encoding: 'utf8' });
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pa-test-'));
  setupRepo(scratch);
});

afterEach(() => {
  try { execSync(`rm -rf "${scratch}"`, { encoding: 'utf8' }); }
  catch {}
});
```

### 28.3 Test fim-a-fim

```ts
it('merges all agent branches across multiple stages', async () => {
  const pipeline: Pipeline = {
    name: 'multi-stage',
    steps: [
      { name: 'stage1', prompt: 's1', files: [] },
      { name: 'stage2', prompt: 's2', files: [] },
    ],
  };

  const orch = new Orchestrator(
    { apiKey: 'stub', modelId: 'stub-model' },
    pipeline, scratch, okFactory,
    { initialConcurrency: 2 },
  );

  const result = await orch.start();

  expect(result.manifest.status).toBe('done');
  expect(result.agents).toHaveLength(2);
  expect(result.agents.filter((a) => a.commitSha)).toHaveLength(2);
  expect(result.integration.branchesMerged).toHaveLength(2);

  // Verifica artefatos persistidos:
  const huuDir = join(scratch, '.huu');
  const huuFiles = readdirSync(huuDir);
  const chronoFile = huuFiles.find((f) => f.endsWith('.log'));
  expect(chronoFile).toBeDefined();
  const splitDirName = chronoFile!.replace(/\.log$/, '');
  expect(huuFiles).toContain(splitDirName);
});
```

### 28.4 Test que injeta falha de merge

`orchestrator.test.ts:114-148` mostra como mockar `GitClient.merge` para
forçar falha:

```ts
it('fails the run when a merge fails for a non-conflict reason', async () => {
  const originalMerge = GitClient.prototype.merge;
  let callCount = 0;
  GitClient.prototype.merge = async function (worktreePath, branchName) {
    callCount++;
    if (callCount === 1) return { success: false, conflicts: [] };
    return originalMerge.call(this, worktreePath, branchName);
  };

  // …roda orchestrator…

  expect(result.manifest.status).toBe('error');
  expect(result.integration.phase).toBe('error');

  GitClient.prototype.merge = originalMerge;   // restore
});
```

### 28.5 Smoke pipeline — `scripts/smoke-pipeline.sh`

End-to-end **real** (mas com `--stub`) que valida:

```bash
docker build -t huu:local .
./scripts/smoke-pipeline.sh
```

Cria repo git temp + 2 arquivos + fixture pipeline JSON, roda
`huu --stub run pipeline.json` no container, asserta:

- exit code 0
- `huu/<runId>/integration` foi criada
- `≥2 huu/<runId>/agent-*` branches
- `.huu/debug-*.log` existe e tem `cli_start` + `wait_until_exit_resolved`
- working tree limpo

Bom para detectar regressões no path de spawn/merge sem queimar custo de
LLM.

---

## 29. Recipes — extensão prática (com código)

### 29.1 Wrap o `realAgentFactory` (logging extra, métricas)

```ts
import { realAgentFactory } from './orchestrator/real-agent.js';
import type { AgentFactory } from './orchestrator/types.js';

const meteredFactory: AgentFactory = async (task, config, hint, cwd, onEvent, ctx) => {
  const startedAt = Date.now();
  let toolCalls = 0;

  const wrappedOnEvent = (event) => {
    if (event.type === 'state_change' && event.state === 'tool_running') toolCalls++;
    if (event.type === 'done') {
      const elapsed = Date.now() - startedAt;
      console.log(`[metrics] agent ${task.agentId}: ${elapsed}ms, ${toolCalls} tools`);
    }
    onEvent(event);
  };

  return realAgentFactory(task, config, hint, cwd, wrappedOnEvent, ctx);
};

// Use no orchestrator:
const orch = new Orchestrator(config, pipeline, cwd, meteredFactory, opts);
```

### 29.2 Custom factory pra outro provider (não-OpenRouter)

Se você quer rodar Anthropic/Bedrock/local direto sem OpenRouter:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { AgentFactory } from './orchestrator/types.js';

const anthropicFactory: AgentFactory = async (task, config, _hint, cwd, onEvent) => {
  const client = new Anthropic({ apiKey: config.apiKey });
  let disposed = false;

  return {
    agentId: task.agentId,
    task,
    async prompt(message: string) {
      onEvent({ type: 'state_change', state: 'streaming' });
      try {
        const stream = client.messages.stream({
          model: config.modelId,
          max_tokens: 8000,
          messages: [{ role: 'user', content: message }],
          tools: [/* read/write/bash tool defs */],
        });
        for await (const event of stream) {
          if (disposed) break;
          // mapeie events Anthropic → AgentEvent (similar a translateEvent)
          // …
        }
        onEvent({ type: 'done' });
      } catch (err) {
        onEvent({ type: 'error', message: String(err) });
        throw err;
      }
    },
    async dispose() { disposed = true; /* abort stream */ },
  };
};
```

Observação: você perde os tools default da SDK Pi
(read/edit/write/bash). Precisa implementar do zero ou wrap algo
existente.

### 29.3 Consumir state externamente (sem render TUI)

```ts
import { Orchestrator } from './orchestrator/index.js';
import { realAgentFactory } from './orchestrator/real-agent.js';

const orch = new Orchestrator(config, pipeline, cwd, realAgentFactory, {
  conflictResolverFactory: realAgentFactory,
});

// Subscribe — recebe state inteiro a cada emit
const unsub = orch.subscribe((state) => {
  if (state.status === 'integrating') {
    console.log('Integrando... merged:', state.integrationStatus.branchesMerged.length);
  }
  for (const agent of state.agents) {
    if (agent.state === 'tool_running') {
      process.stdout.write(`[A${agent.agentId}] ${agent.logs.at(-1)}\r`);
    }
  }
});

// Adjust concurrency dinamicamente
setInterval(() => {
  const free = require('os').freemem();
  if (free < 1e9) orch.decreaseConcurrency();
  else orch.increaseConcurrency();
}, 30_000);

const result = await orch.start();
unsub();
console.log('done:', result.runId, 'duration:', result.duration);
```

### 29.4 Adicionar uma nova tool de escrita ao tracking

Se a SDK Pi adicionar `multi_edit`, basta:

```ts
// real-agent.ts
const WRITE_TOOLS = new Set(['edit', 'write', 'create', 'patch', 'multi_edit']);
```

Se a tool tem múltiplos paths em `args.changes[]` em vez de
`args.path`, expanda `extractFileFromArgs` e emita um `file_write` por
path:

```ts
case 'tool_execution_start': {
  if (event.toolName === 'multi_edit' && Array.isArray(event.args?.changes)) {
    onEvent({ type: 'state_change', state: 'tool_running' });
    onEvent({ type: 'log', message: `tool: multi_edit (${event.args.changes.length} files)` });
    for (const change of event.args.changes) {
      const f = extractFileFromArgs(change);
      if (f) onEvent({ type: 'file_write', file: f });
    }
    break;
  }
  // …caso default existente…
}
```

### 29.5 Hook que externaliza eventos pra observabilidade (Datadog, OTel)

```ts
import { realAgentFactory } from './orchestrator/real-agent.js';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('huu');

const tracedFactory: AgentFactory = async (task, config, hint, cwd, onEvent, ctx) => {
  const span = tracer.startSpan(`agent-${task.agentId}`, {
    attributes: { 'huu.agent_id': task.agentId,
                  'huu.stage': task.stageName,
                  'huu.files': task.files.join(',') },
  });

  const wrappedOnEvent = (event) => {
    span.addEvent(event.type, { ...event });
    if (event.type === 'done') span.end();
    if (event.type === 'error') {
      span.recordException(new Error(event.message));
      span.end();
    }
    onEvent(event);
  };

  return realAgentFactory(task, config, hint, cwd, wrappedOnEvent, ctx);
};
```

### 29.6 Programatic run sem TUI (CI/script)

```ts
#!/usr/bin/env tsx
import { Orchestrator } from './src/orchestrator/index.js';
import { realAgentFactory } from './src/orchestrator/real-agent.js';
import { importPipeline } from './src/lib/pipeline-io.js';
import { resolveOpenRouterApiKey } from './src/lib/api-key.js';

const apiKey = resolveOpenRouterApiKey();
if (!apiKey) { console.error('no api key'); process.exit(1); }

const pipeline = importPipeline(process.argv[2]);
const orch = new Orchestrator(
  { apiKey, modelId: 'anthropic/claude-sonnet-4.6' },
  pipeline, process.cwd(), realAgentFactory,
  { conflictResolverFactory: realAgentFactory, initialConcurrency: 4 },
);

orch.subscribe((s) => {
  if (s.status === 'done' || s.status === 'error') {
    console.log(`[${s.status}] stage ${s.currentStage}/${s.totalStages}`);
  }
});

try {
  const result = await orch.start();
  console.log(`run ${result.runId}: ${result.agents.filter(a => a.commitSha).length}/${result.agents.length} committed`);
  process.exit(result.manifest.status === 'done' ? 0 : 1);
} catch (err) {
  console.error('failed:', err);
  process.exit(1);
}
```

---

## 30. Pontos de extensão e armadilhas

### 30.1 Adicionar um novo evento Pi

Editar `translateEvent` em `real-agent.ts:43-98`. Se for um evento
**novo** que precisa de uma reação no orchestrator (e não dá pra
representar como `log`/`state_change`), adicionar o tipo em
`AgentEvent` (`orchestrator/types.ts`) e tratar em
`Orchestrator.handleAgentEvent`. O RunLogger pega automaticamente via
`describeEvent` (`run-logger.ts:140-153`) — mas verifique se o tipo novo
deve aparecer no log split e atualize a função.

### 30.2 Trocar de SDK (Pi → outra)

A interface é estreita. Você reescreve **só** `real-agent.ts`
respeitando o contrato `AgentFactory`. O orchestrator e a UI não
precisam mudar. Cuide das peculiaridades:
- A SDK precisa expor stream de eventos com tipos análogos a tool/message/agent start-end.
- Se ela engolir erros, replique o truque da §13.2 de cavar `state` interno.
- `cwd` precisa ser respeitado pra escrita de arquivos.

### 30.3 `agent_end` não dispara `done`

Já documentado, mas vale repisar: NÃO faça `agent_end → emit done` —
isso quebra agentes multi-turn e causa double-finalize. O `done` só
deve sair quando `session.prompt()` resolver limpo.

### 30.4 Cuidado com `setSystemPrompt` em Pi >= 0.70

Não existe mais. Se você adicionar instruções de role/safety, embuta
no header da mensagem (`buildFullMessage` em `real-agent.ts:104-124`).

### 30.5 Tools de write podem mudar de nome no futuro

A constante `WRITE_TOOLS = new Set(['edit', 'write', 'create', 'patch'])`
é uma heurística. Se o Pi adicionar `replace`, `apply_patch`,
`multi_edit`, etc., atualize ali — caso contrário `filesModified` fica
incorreto e os logs do tipo `wrote <file>` somem. Ver Recipe §29.4.

### 30.6 O `state` interno do Pi é não-tipado

`(session as any).state` em `real-agent.ts:203`. É um cast de fé. Se a
SDK mudar a forma interna, o re-throw de erro silencioso para de
funcionar e o agente vai parecer ter terminado com sucesso quando na
verdade falhou. Vale uma camada de defesa: validar shape e logar warn se
não bate.

### 30.7 Timeouts são **por card**, não por pipeline

Não existe um "timeout total". Um pipeline com 50 stages e
`cardTimeoutMs: 600_000` pode rodar por **horas**. Se quiser cap
absoluto, adicione no orchestrator (`start()` envelopado em outro
`withTimeout`).

### 30.8 Concurrency mexe na vazão de eventos

A 8 Hz que `RunDashboard` aplica em `STATE_FLUSH_INTERVAL_MS = 125ms`
foi calibrada pra concurrency 10. Se você subir muito acima de 20
(MAX_INSTANCES), reavalie — Ink pode não conseguir drenar stdin no
ritmo certo e teclas (`Ctrl+C`!) começam a sumir.

### 30.9 Logs do agente podem sumir do `OrchestratorState.logs`

Cap em 1000 entradas. Pra audit completo, sempre vá ao
`.huu/<stamp>-execution-<runId>.log` (RunLogger não tem cap). O dashboard
é uma view, não a fonte de verdade.

### 30.10 Agente integrator tem agentId fixo 9999

Constante `INTEGRATION_AGENT_ID` em `integration-agent.ts:12`. Se você
spawnar um agente normal com esse ID, vai colidir com a labelização nos
logs (`integrator.log`) e na UI (`A99` vs `INT`). Mantenha
`MAX_INSTANCES = 20` longe disso.

### 30.11 `dispose()` é idempotente; `prompt()` não

Pode chamar `dispose` várias vezes (guard em `disposed` flag). Mas
`prompt()` falha com `'agent already disposed'` se tentar reusar a
sessão depois de dispose (`real-agent.ts:182-184`). Spawne nova.

### 30.12 `--stub` desabilita resolver de conflitos

Por design (`cli.tsx:211`). Se você precisa testar conflict resolution
fim-a-fim sem queimar tokens, tem que rodar com modelo real. Não tem
"stub conflict resolver".

### 30.13 Tokens/cost no AgentStatus ficam zerados

Já documentado em §24. Pra somar custo, parseie o log line `tokens
+Nin +Mout $X` no `.huu/<stamp>-execution-<runId>.log`.

### 30.14 Concurrency default é 10, NÃO 2

A skill `pipeline-agents` lista `default = 2` mas o código está em 10
(`DEFAULT_CONCURRENCY` em `orchestrator/index.ts:57`). Confiar no
código.

### 30.15 `commitNoVerify` ignora pre-commit hooks

Ver §17.1. Se seu projeto depende de hooks de format/lint para garantir
que commits são limpos, adicione um stage extra que rode o linter
explicitamente (não dependa do hook, que será skipped).

### 30.16 `ensureGitignored` modifica `.gitignore` no run

Sem opt-out. Roda em `orchestrator/index.ts:269-273` no início do
`start()`. Adiciona linhas para `.huu-worktrees/`, `.huu/`, `.env.huu`,
`.huu-bin/`, `.huu-cache/`. Se você quer que essas paths fiquem
visíveis no git, edite manualmente após o run (vai ser sobrescrito de
novo no próximo).

### 30.17 `HUU_NO_DOCKER=1` expõe credenciais host ao agente

Quando rodando nativo (sem Docker), o agente Pi tem acesso ao filesystem
inteiro do usuário. Se o agente decidir ler `~/.ssh/`, `~/.aws/`,
`.env`, etc., ele consegue. Use `HUU_NO_DOCKER` apenas em ambientes
dev/CI controlados.

### 30.18 Pipeline JSON sem `_format` é aceito (legacy)

`pipeline-io.ts:30-37` usa `z.union([wrapped, naked])`. Pipelines sem o
wrapper `{ _format, exportedAt, pipeline }` ainda carregam (formato
naked). Isso facilita import de fixtures simples mas pode mascarar
arquivos malformados — se o user passa um JSON aleatório que casualmente
tem `name`+`steps`, pode passar.

---

## Apêndice: arquivos-chave em ordem de importância

| Arquivo                                          | O que tem                                                |
| ------------------------------------------------ | -------------------------------------------------------- |
| `src/orchestrator/real-agent.ts`                 | **Único** ponto de contato com a SDK Pi                  |
| `src/orchestrator/types.ts`                      | Contrato `AgentFactory` + `AgentEvent` interno           |
| `src/orchestrator/index.ts`                      | Orchestrator (worker pool, lifecycle, finalize, retry)   |
| `src/orchestrator/integration-agent.ts`          | Spawn especial pro merge resolver                        |
| `src/orchestrator/agents-md-generator.ts`        | System prompts (agente normal + integrator)              |
| `src/orchestrator/stub-agent.ts`                 | Implementação fake do mesmo contrato                     |
| `src/orchestrator/task-decomposer.ts`            | Steps → AgentTask[]                                      |
| `src/orchestrator/agent-env.ts`                  | `.env.huu` + `.huu-bin/with-ports` + port guidance       |
| `src/orchestrator/port-allocator.ts`             | Janela TCP por agente (probe + reserve)                  |
| `src/orchestrator/native-shim.ts`                | Compila libhuu_bind.{so,dylib}                           |
| `src/lib/types.ts`                               | TODOS os tipos de domínio                                |
| `src/lib/pipeline-io.ts`                         | Schema Zod + import/export pipeline                      |
| `src/lib/run-logger.ts`                          | Persistência humana em `.huu/<stamp>-…`                  |
| `src/lib/debug-logger.ts`                        | NDJSON de heartbeat + lifecycle                          |
| `src/lib/status.ts`                              | `huu status` CLI headless                                |
| `src/lib/active-run-sentinel.ts`                 | `/tmp/huu/active` para Docker HEALTHCHECK                |
| `src/lib/api-key.ts`                             | Resolução secret → file → env                            |
| `src/lib/openrouter.ts`                          | Fetch capabilities + key validation                      |
| `src/lib/model-factory.ts`                       | Heurística de thinking-supports                          |
| `src/lib/langchain-client.ts`                    | Refiner (LangChain.js, **não Pi**)                       |
| `src/lib/refinement-prompts.ts`                  | System prompt + sintese do refiner                       |
| `src/lib/prune.ts`                               | `huu prune` (cleanup orphan containers/cidfiles)         |
| `src/lib/run-id.ts`                              | nanoid 8-char alphanumeric                                |
| `src/ui/components/RunDashboard.tsx`             | Subscriber/render do OrchestratorState                   |
| `src/ui/components/RunKanban.tsx`                | Renderer dos cards (TODO/DOING/DONE)                     |
| `src/ui/components/RunModal.tsx`                 | Detalhe do agente focado (timeline, git, logs)           |
| `src/ui/components/LogArea.tsx`                  | Sidebar de logs (filtrável por agentId)                  |
| `src/ui/components/InteractiveStep.tsx`          | UI do refinement chat                                    |
| `src/ui/components/PipelineEditor.tsx`           | Editor de pipeline (steps, files, scope)                  |
| `src/git/git-client.ts`                          | Wrapper async sobre git (execFile)                        |
| `src/git/worktree-manager.ts`                    | create/remove worktree per-agent + integration           |
| `src/git/integration-merge.ts`                   | Merge determinístico stage-by-stage                      |
| `src/git/branch-namer.ts`                        | Convenção `huu/<runId>/agent-<N>[-retry]`                |
| `src/git/preflight.ts`                           | Validações git antes do run                               |
| `src/prompts/integration-task.ts`                | XML prompt do integration agent                           |
| `src/cli.tsx`                                    | Entry, signal handlers, route não-TUI vs TUI             |
| `src/app.tsx`                                    | Screen router (welcome → editor → model → run → summary) |
| `scripts/smoke-pipeline.sh`                      | Smoke E2E em container (`huu --stub run`)                 |
| `scripts/smoke-image.sh`                         | Sanity da imagem Docker                                   |

---

**Última auditoria:** 2026-04-29, contra o branch `ai-task-1777465282`
no commit `50553d9`.

**Versões:** `@mariozechner/pi-coding-agent ^0.70.6` ·
`@mariozechner/pi-ai ^0.70.6` · `@langchain/openai ^1.4.5` ·
`huu-pipe 0.3.0`.
