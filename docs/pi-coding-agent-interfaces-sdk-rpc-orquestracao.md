# Interfaces programáticas do Pi Coding Agent: SDK, RPC e orquestração

O Pi Coding Agent (`@mariozechner/pi-coding-agent`, v0.56.2) oferece **duas interfaces programáticas completas** para integração: o modo SDK via `createAgentSession` para aplicações Node.js/TypeScript, e o modo RPC via protocolo JSONL sobre stdin/stdout para qualquer linguagem. Ambos compartilham o mesmo catálogo de eventos em três camadas — `pi-ai`, `pi-agent-core` e `pi-coding-agent` — mas diferem fundamentalmente em modelo de processo, type safety e acesso ao estado do agente. A escolha entre eles determina o nível de controle, isolamento e flexibilidade da sua integração. Este guia cobre a superfície completa de ambas as APIs, o sistema de criação de tools, o catálogo de eventos e padrões de orquestração multi-agente utilizados em produção pelo OpenClaw e extensões da comunidade.

## Arquitetura em camadas do monorepo pi-mono

Antes de mergulhar nas interfaces, é essencial compreender a arquitetura em camadas que sustenta tudo. O repositório `badlogic/pi-mono` organiza quatro pacotes npm com dependências ascendentes:

| Camada | Pacote | Responsabilidade |
|--------|--------|-----------------|
| **pi-ai** | `@mariozechner/pi-ai` | API unificada de LLM para **15+ providers** (Anthropic, OpenAI, Google, Azure, Bedrock, Mistral, Groq, xAI, Ollama, etc.), streaming normalizado, definições de tools via TypeBox, tracking de custo e OAuth |
| **pi-agent-core** | `@mariozechner/pi-agent-core` | Loop de agente stateful com execução de tools, sistema de eventos, steering e follow-ups |
| **pi-coding-agent** | `@mariozechner/pi-coding-agent` | Runtime completo com 7 tools built-in, sessions persistentes em JSONL, extensões hot-reloadable, skills e quatro modos operacionais |
| **pi-tui** | `@mariozechner/pi-tui` | UI de terminal com rendering diferencial e markdown |

Cada camada pode ser usada independentemente. Uma aplicação que precisa apenas de streaming multi-provider importa `pi-ai`; uma que precisa do loop de agente com tools customizadas usa `pi-agent-core`; e uma que quer o runtime completo com sessions, compaction e extensões usa `pi-coding-agent`.

## Tutorial SDK: integrando via createAgentSession

A função `createAgentSession` é o ponto de entrada principal do modo SDK. Ela retorna um objeto `{ session, modelFallbackMessage }` onde `session` é uma instância de `AgentSession` com controle total sobre o agente.

### Configuração mínima

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";

const authStorage = AuthStorage.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry: new ModelRegistry(authStorage),
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("Quais arquivos existem no diretório atual?");
session.dispose();
```

### Parâmetros completos de createAgentSession

O objeto de configuração aceita os seguintes campos:

**Modelo e thinking:** `model` (objeto retornado por `getModel`), `thinkingLevel` (`"off"` | `"minimal"` | `"low"` | `"medium"` | `"high"` | `"xhigh"`), `scopedModels` (array de `{ model, thinkingLevel }` para cycling). **Session:** `sessionManager` (controla persistência). **Auth:** `authStorage` (gerencia API keys, default `~/.pi/agent/auth.json`), `modelRegistry` (resolve modelos disponíveis). **Tools:** `tools` (substitui o toolset padrão), `customTools` (adiciona tools além dos defaults). **Recursos:** `cwd` (diretório de trabalho), `agentDir` (diretório global de config), `resourceLoader` (instância customizada de `DefaultResourceLoader`), `settingsManager` (configurações two-tier).

### Métodos da session e do agent

A `session` expõe os métodos `prompt(message)`, `dispose()` e `subscribe(callback)`. O acesso ao `Agent` subjacente via `session.agent` desbloqueia controle granular:

O **`session.agent.steer(message)`** interrompe o processamento atual — a mensagem é entregue após a tool em execução, pulando tools restantes na fila. Já o **`session.agent.followUp(message)`** enfileira uma mensagem para entrega após o agente completar naturalmente. Ambos recebem objetos `{ role: "user", content: string, timestamp: number }`.

Para mutações de estado em runtime: `agent.setModel(getModel("openai", "gpt-4o"))` troca o provider mid-session, `agent.setThinkingLevel("high")` ajusta reasoning, `agent.setSystemPrompt("Novas instruções")` altera o system prompt, `agent.setTools([...newTools])` substitui o toolset, e `agent.replaceMessages(trimmedMessages)` reescreve o histórico de conversação. A compaction manual é feita via `session.compact("Preserve todos os file paths")`.

### SessionManager: in-memory vs file-based

O `SessionManager` oferece quatro factory methods: **`SessionManager.inMemory()`** cria sessions efêmeras que desaparecem com o processo — ideal para bots e testes. **`SessionManager.create(cwd)`** cria uma nova session persistente em JSONL. **`SessionManager.open(path)`** abre um arquivo de session específico. **`SessionManager.continueRecent(cwd)`** retoma a session mais recente do diretório.

Sessions persistentes usam um formato JSONL com estrutura de árvore — cada entry possui `id` e `parentId`, habilitando **branching sem criar novos arquivos**. A instância expõe `getTree()`, `getPath()`, `branch(entryId)`, `branchWithSummary(id, "Resumo")`, `getChildren(id)`, `appendMessage(message)` e `buildSessionContext()` que retorna `{ messages, thinkingLevel, model }` para reconstruir o estado.

**`SettingsManager.create(globalPath, projectPath)`** implementa configuração two-tier com deep merge — settings globais em `~/.pi/agent/settings.json` são sobrepostas por settings do projeto. **`AuthStorage`** gerencia API keys com suporte a `setRuntimeApiKey(provider, key)` para overrides em runtime sem persistência. **`ModelRegistry`** aceita um caminho opcional para `models.json` com definições de providers customizados.

### streamSimple e middleware de streaming

A função `streamSimple` de `pi-ai` é o mecanismo padrão de streaming. Ela aceita um model, contexto (systemPrompt + messages) e options (reasoning level, apiKey override). Retorna um async iterable de eventos normalizados e um método `result()` que resolve com a `AssistantMessage` final.

Para interceptar ou modificar o streaming, substitua `session.agent.streamFn`:

```typescript
session.agent.streamFn = (model, context, options) => {
  // Injetar headers customizados, logging, rate limiting
  return streamSimple(model, context, { ...options, apiKey: rotateKey() });
};
```

A função `completeSimple` oferece a alternativa não-streaming, retornando a `AssistantMessage` completa diretamente.

## Tutorial RPC: protocolo JSONL sobre stdin/stdout

O modo RPC transforma o Pi em um servidor de protocolo line-delimited JSON, permitindo integração com **qualquer linguagem de programação**. O agente lê comandos JSON de stdin (uma linha por comando) e escreve respostas e eventos em stdout.

### Inicialização

Via CLI: `pi --mode rpc --no-session`. Via SDK com `runRpcMode`:

```typescript
import { createAgentSession, runRpcMode } from "@mariozechner/pi-coding-agent";
const { session } = await createAgentSession({ /* config */ });
await runRpcMode(session); // Handshake: emite { "type": "ready" }
```

### Comandos suportados via stdin

Todos os comandos possuem um campo `type` obrigatório e `id` opcional para correlação request/response. A tabela a seguir cobre a superfície completa:

| Comando | Campos adicionais | Descrição |
|---------|-------------------|-----------|
| `prompt` | `message`, `images?`, `streamingBehavior?` | Envia mensagem do usuário |
| `steer` | `message` | Interrupção — entregue após tool atual |
| `follow_up` | `message` | Enfileirada para após término natural |
| `abort` | — | Cancela operação em andamento |
| `new_session` | — | Inicia nova session |
| `switch_session` | `path` | Muda para arquivo de session específico |
| `fork` | `entryId` | Fork a partir de mensagem anterior |
| `set_model` | `provider`, `model` | Troca modelo |
| `cycle_model` | — | Cicla entre modelos favoritos |
| `set_thinking_level` | `level` | Ajusta reasoning level |
| `set_steering_mode` | `mode` | `"all"` ou `"one-at-a-time"` |
| `set_follow_up_mode` | `mode` | `"all"` ou `"one-at-a-time"` |
| `compact` | `instructions?` | Compaction manual |
| `set_auto_compaction` | `enabled` | Liga/desliga auto-compaction |
| `set_auto_retry` | `enabled` | Liga/desliga auto-retry |
| `bash` | `command` | Executa comando bash direto |
| `get_state` | — | Retorna `RpcSessionState` completo |
| `get_session_stats` | — | Contadores de mensagens, tokens, custo |
| `get_messages` | — | Retorna `AgentMessage[]` |
| `get_available_models` | — | Lista todos os modelos |
| `extension_ui_response` | `id`, `value`/`cancelled` | Resposta a dialogs de extensão |

### Formato de resposta

Respostas de sucesso: `{ "id": "req-1", "type": "response", "command": "prompt", "success": true, "data": { ... } }`. Erros: campo `success: false` com `error: "mensagem"`. Eventos de streaming chegam como objetos JSON separados, um por linha, com os mesmos tipos do catálogo de eventos descrito abaixo.

### Exemplo prático em Python

```python
import subprocess, json

proc = subprocess.Popen(
    ["pi", "--mode", "rpc", "--no-session"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
)

def send(cmd):
    proc.stdin.write(json.dumps(cmd) + "\n")
    proc.stdin.flush()

send({"type": "prompt", "message": "Analise o arquivo main.py", "id": "req-1"})
for line in proc.stdout:
    event = json.loads(line)
    if event.get("type") == "message_update":
        delta = event.get("assistantMessageEvent", {})
        if delta.get("type") == "text_delta":
            print(delta["delta"], end="", flush=True)
    if event.get("type") == "agent_end":
        break
```

O `RpcClient` exportado pelo pacote encapsula esse protocolo em TypeScript com métodos tipados: `client.prompt()`, `client.abort()`, `client.getState()`, `client.on("message_update", callback)`, e `client.close()`.

## Catálogo de eventos em três camadas

O sistema de eventos do Pi é **hierárquico** — cada camada emite eventos específicos, e a camada superior propaga os eventos das camadas inferiores.

### Camada 1: pi-ai (streaming normalizado)

Estes eventos aparecem dentro do campo `assistantMessageEvent` dos eventos `message_update`:

**`start`** marca o início do stream. **`text_start`** e **`text_end`** delimitam blocos de texto, com **`text_delta`** carregando chunks individuais no campo `.delta`. **`thinking_start`**, **`thinking_delta`** e **`thinking_end`** seguem o mesmo padrão para reasoning (quando `thinkingLevel` ≠ `"off"`). **`toolcall_start`**, **`toolcall_delta`** e **`toolcall_end`** streamam a construção de chamadas de tools — o campo `.toolCall` no `toolcall_end` contém a chamada completa. **`done`** sinaliza fim do stream com a `AssistantMessage` completa no campo `.message`. **`error`** indica falha com `.error.errorMessage`.

### Camada 2: pi-agent-core (loop do agente)

**`agent_start`** e **`agent_end`** delimitam todo o ciclo de processamento. Dentro deles, **`turn_start`** e **`turn_end`** marcam cada turno de inferência LLM. **`message_start`**, **`message_update`** e **`message_end`** encapsulam mensagens individuais — o `message_update` carrega os sub-eventos da camada pi-ai. **`tool_execution_start`** (com campos `toolName` e `args`), **`tool_execution_update`** e **`tool_execution_end`** (com campo `isError`) rastreiam a execução de tools.

### Camada 3: pi-coding-agent (runtime)

**`auto_compaction_start`** (com campo `reason`: `"threshold"` ou `"overflow"`) e **`auto_compaction_end`** notificam quando o contexto é automaticamente compactado. **`auto_retry_start`** e **`auto_retry_end`** indicam retentativas automáticas em erros transientes.

### Event hooks de extensões

Extensões registram handlers via `pi.on()` para eventos adicionais: `session_start`, `session_shutdown`, `session_switch`, `tool_call` (pode retornar `{ block: true }` para vetar), `tool_result`, `context` (reescreve mensagens antes do LLM), `session_before_compact`, `before_agent_start` e `input` (transforma entrada do usuário).

## API de criação de tools com TypeBox

O `AgentTool` interface de `pi-agent-core` define tools com schema validation via TypeBox:

```typescript
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const params = Type.Object({
  city: Type.String({ description: "Nome da cidade" }),
  format: Type.Optional(Type.String({ description: "Formato de saída" })),
});

const weatherTool: AgentTool<typeof params> = {
  name: "get_weather",
  label: "Weather",
  description: "Obtém o clima atual de uma cidade",
  parameters: params,
  execute: async (toolCallId, params, signal, onUpdate) => {
    onUpdate?.({ content: [{ type: "text", text: "Consultando..." }], details: {} });
    return {
      content: [{ type: "text", text: `${params.city}: 25°C, parcialmente nublado` }],
      details: { temp: 25, city: params.city },
    };
  },
};
```

A assinatura do `execute` recebe **cinco parâmetros**: `toolCallId` (string única), `params` (tipado pelo schema), `signal` (`AbortSignal` para cancelamento), `onUpdate` (callback para resultados parciais) e opcionalmente `ctx` (contexto da extensão). O retorno inclui `content` (array de blocos enviados ao LLM) e `details` (dados apenas para UI, não enviados ao modelo).

O `pi-coding-agent` estende isso com `ToolDefinition`, adicionando campos opcionais `promptSnippet`, `promptGuidelines[]`, `renderCall()` e `renderResult()` para customização de exibição no TUI.

### Tool factories com workspace scoping

As factory functions **`createCodingTools(workspace)`**, **`createReadOnlyTools(workspace)`**, **`createReadTool(workspace)`**, **`createBashTool(workspace, options)`** e **`createGrepTool(workspace)`** criam instâncias de tools com operações de I/O restritas ao diretório especificado. O `createBashTool` aceita um objeto `operations` que permite substituir a execução subjacente — ideal para rodar comandos dentro de **Docker containers, SSH remoto ou filesystem virtual**:

```typescript
const sandboxedBash = createBashTool("/workspace", {
  operations: { exec: async (cmd, cwd, opts) => runInDockerContainer(cmd, cwd, opts) },
});
```

Os presets built-in: **`codingTools`** = `[read, bash, edit, write]` (default), **`readOnlyTools`** = `[read, grep, find, ls]`, **`allBuiltInTools`** expõe cada tool individualmente (`.read`, `.bash`, `.edit`, `.write`, `.grep`, `.find`, `.ls`).

## Tabela comparativa: SDK vs RPC

| Critério | SDK Mode | RPC Mode |
|----------|----------|----------|
| **Type safety** | Total via TypeScript | Apenas JSON |
| **Modelo de processo** | Mesmo processo Node.js | Subprocesso isolado |
| **Acesso direto ao estado** | `session.agent.*` methods | Apenas via `get_state` |
| **Customização de tools** | Programática, em runtime | Limitada a CLI flags |
| **Linguagem** | Node.js/TypeScript exclusivo | Qualquer linguagem |
| **Isolamento de processo** | Compartilhado | Total |
| **Latência** | Mínima (in-process) | Overhead de IPC |
| **Middleware de streaming** | `streamFn` substituível | Não disponível |
| **Extensões programáticas** | Via `customTools` e `resourceLoader` | Via filesystem apenas |
| **Ideal para** | Aplicações Node.js, bots, plataformas | IDEs, frontends em Python/Rust/Go, Emacs |

## Padrões de orquestração multi-agente

### Padrão 1: SDK embedding direto (OpenClaw)

O **OpenClaw** (160K+ stars no GitHub) utiliza Pi como SDK embarcado — chama `createAgentSession` diretamente, injeta tools customizadas por canal (Discord, Telegram, Slack), gerencia sessions por usuário e implementa compaction customizada. O pattern central é criar um `DefaultResourceLoader` com paths de extensão adicionais, chamar `resourceLoader.reload()`, e então passar tudo para `createAgentSession`. Workspace scoping é feito via tool factories: `createReadTool(workspace)`, `createWriteTool(workspace)`, `createEditTool(workspace)`.

### Padrão 2: subagentes via extensão (pi-subagents)

A extensão **pi-subagents** de Nico Bailon implementa delegação assíncrona com **6 agentes built-in** (scout, planner, worker, reviewer, context-builder, researcher). Agentes customizados são definidos em Markdown com YAML frontmatter especificando modelo, thinking level, tools e skills. Suporta **chains** (`/chain scout "scan codebase" -> planner "create plan"`) e **execução paralela** (`/parallel scanner "find issues" -> reviewer "check"`). Um depth guard configurável via `PI_SUBAGENT_MAX_DEPTH` (default 2) previne recursão descontrolada.

### Padrão 3: coordenação via filesystem (pi-messenger)

O **pi-messenger** implementa coordenação multi-agente onde agentes se registram, reivindicam tasks e reservam arquivos via filesystem compartilhado. O hook `tool_call` enforça reservas de arquivo retornando `{ block: true }` em operações de write/edit em arquivos reservados por outros agentes. Workers são spawned como subprocessos `pi --mode json` com system prompts, modelos e restrições de tools específicos por agente.

### Padrão 4: RPC multiplexado

Para integrações em linguagens que não são Node.js, o pattern é spawnar múltiplos processos `pi --mode rpc --no-session`, cada um com um workspace scoped, e multiplexar comandos via correlação de `id`. O frontend Emacs (`dnouri/pi-coding-agent`) implementa exatamente isso — uma interface de duas janelas (chat markdown + composição de prompt) comunicando via JSON-over-stdio.

## Árvore de decisão para escolha de interface

A escolha entre SDK e RPC depende de três fatores principais. Se a aplicação **é Node.js/TypeScript e precisa de controle granular** sobre tools, streaming middleware ou estado do agente, use **SDK mode** — é o caminho do OpenClaw, pi-mom e qualquer bot que precise injetar tools customizadas por contexto. Se a integração **é em outra linguagem** (Python, Rust, Go, Emacs Lisp) ou precisa de **isolamento de processo** para segurança, use **RPC mode** — o protocolo JSONL é trivial de implementar em qualquer linguagem com subprocess e JSON parsing.

Para **orquestração multi-agente**, considere: se os agentes compartilham o mesmo processo Node.js, múltiplas instâncias de `createAgentSession` com `SessionManager.inMemory()` são mais eficientes. Se precisam de isolamento (sandboxing, diferentes modelos por agente, crash isolation), spawne processos RPC separados. Se a coordenação é assíncrona e task-based, extensões como pi-messenger ou pi-subagents abstraem a complexidade.

### Mudanças recentes em versões 0.50+

A evolução de **v0.50.x a v0.56.x** trouxe várias correções e refinamentos. A v0.51.3 introduziu uma **breaking change** no RPC renomeando `SlashCommandSource` de `"template"` para `"prompt"` — afetando o frontend Emacs. Correções notáveis incluem: resolução correta de modelo padrão no SDK (fallback para Claude Opus 4.5 com provider Anthropic), respeito à variável `PI_CODING_AGENT_DIR` em mensagens de erro, exibição de erros de carregamento de extensões (antes silenciados), e `ctx.model` tornado getter para extensões de footer receberem mudanças de modelo. O ritmo de publicação permanece intenso — **271+ versões** publicadas no npm, com a v0.56.2 lançada em março de 2026.

## Conclusão: um runtime de agente genuinamente composável

O Pi Coding Agent se distingue por sua **composabilidade em camadas** — cada pacote resolve um problema específico e pode ser usado independentemente. A filosofia de **"se não preciso, não construo"** resulta em apenas 4 tools padrão e um system prompt menor que 1k tokens, mas a arquitetura de extensões hot-reloadable e a API de tools com TypeBox schemas transformam essa simplicidade em flexibilidade real. O insight mais valioso para integradores: o Pi não é apenas uma CLI de coding agent, mas um **runtime de agente programável** onde o modo SDK oferece controle total in-process e o modo RPC oferece integração universal. A existência de 207+ projetos dependentes no npm e integrações de produção como OpenClaw validam que ambas as interfaces são maduras o suficiente para uso em larga escala.