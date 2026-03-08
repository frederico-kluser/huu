# Controlando o Pi Coding Agent via Node.js: guia completo para orquestradores de pipelines

O **Pi Coding Agent** (`@mariozechner/pi-coding-agent`) expõe três interfaces programáticas — SDK direto, RPC via stdin/stdout e event stream JSONL — que permitem construir orquestradores de pipelines com múltiplos agentes em paralelo, controlados inteiramente via código TypeScript. Este tutorial cobre cada interface em profundidade, compara as bibliotecas TUI disponíveis para o dashboard em tempo real e entrega um exemplo funcional completo de orquestrador com interface terminal.

O Pi é um toolkit modular com **quatro camadas empilháveis**: `pi-ai` (LLM multi-provider), `pi-agent-core` (agent loop + eventos), `pi-coding-agent` (sessões, tools, extensões) e `pi-tui` (interface terminal).  Cada camada pode ser usada independentemente.  Com **1.7M+ downloads semanais** no npm  e adoção pelo OpenClaw (160K+ stars),  o ecossistema é maduro e ativamente mantido pelo Mario Zechner (criador do libGDX). 

-----

## 1. Arquitetura de pacotes e setup inicial

Antes de mergulhar no código, é essencial entender a **stack de 4 camadas** que o Pi expõe:

```
┌─────────────────────────────────────────┐
│  Sua Aplicação (orquestrador, bot, CLI) │
├────────────────────┬────────────────────┤
│  pi-coding-agent   │  pi-tui            │
│  Sessões, tools,   │  Terminal UI,      │
│  extensões         │  markdown, editor  │
├────────────────────┴────────────────────┤
│  pi-agent-core                          │
│  Agent loop, tool execution, eventos    │
├─────────────────────────────────────────┤
│  pi-ai                                  │
│  Streaming, modelos, LLM multi-provider │
└─────────────────────────────────────────┘
```

**`@mariozechner/pi-ai`** abstrai providers (Anthropic, OpenAI, Google, Bedrock, Mistral, Groq, xAI, OpenRouter, Ollama e qualquer endpoint compatível com OpenAI) numa API unificada   com **2000+ modelos** no catálogo built-in.  **`@mariozechner/pi-agent-core`** adiciona o agent loop com execução de tools, fila de mensagens e event stream.  **`@mariozechner/pi-coding-agent`** é a camada completa com sessões persistentes em JSONL, ferramentas built-in (read, write, edit, bash, grep, find, ls), sistema de extensões e compactação automática de contexto.  **`@mariozechner/pi-tui`** é a biblioteca de terminal com rendering diferencial. 

Para configurar o projeto:

```bash
mkdir pi-orchestrator && cd pi-orchestrator
npm init -y
npm install @mariozechner/pi-ai @mariozechner/pi-agent-core \
            @mariozechner/pi-coding-agent
npm install -D typescript @types/node tsx
```

O `tsconfig.json` mínimo:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist"
  }
}
```

Execute scripts com `npx tsx seu-script.ts`. Exporte a API key do provider desejado como variável de ambiente (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)  ou configure programaticamente conforme veremos adiante.

-----

## 2. SDK Mode: controlando agentes programaticamente

O modo SDK é a forma mais poderosa de integração.  Você importa `createAgentSession` e tem controle total sobre o agente dentro do mesmo processo Node.js,  com **type safety** completo em TypeScript.

### A função central: `createAgentSession()`

Esta factory function cria uma sessão de agente completa com todas as configurações:  

```typescript
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  allBuiltInTools,
  codingTools,
  readOnlyTools,
  estimateTokens,
} from "@mariozechner/pi-coding-agent";
import { getModel, streamSimple } from "@mariozechner/pi-ai";

// Obter modelo do catálogo built-in
const model = getModel("anthropic", "claude-sonnet-4-20250514");

// Criar sessão com configuração completa
const { session } = await createAgentSession({
  // Modelo e nível de raciocínio
  model,
  thinkingLevel: "medium", // "off"|"minimal"|"low"|"medium"|"high"|"xhigh"

  // Sessão em memória (sem persistir no disco)
  sessionManager: SessionManager.inMemory(),

  // Diretório de trabalho do agente
  cwd: process.cwd(),

  // Tools: escolher preset ou tools individuais
  tools: [
    allBuiltInTools.read,
    allBuiltInTools.bash,
    allBuiltInTools.edit,
    allBuiltInTools.write,
  ],

  // Tools customizadas adicionais
  customTools: [],
});

// Definir a função de streaming (obrigatório)
session.agent.streamFn = streamSimple;
```

### Inscrevendo-se nos eventos do agente

O método `session.subscribe()` retorna uma função de unsubscribe e recebe todos os eventos em tempo real: 

```typescript
const unsubscribe = session.subscribe((event) => {
  switch (event.type) {
    case "agent_start":
      console.log("🚀 Agente iniciou processamento");
      break;

    case "turn_start":
      console.log("↻ Novo turno de conversação");
      break;

    case "message_start":
      console.log("💬 LLM começou a responder");
      break;

    case "message_update":
      // Eventos de streaming do LLM
      const streamEvent = event.assistantMessageEvent;
      if (streamEvent.type === "text_delta") {
        process.stdout.write(streamEvent.delta);
      }
      if (streamEvent.type === "thinking_delta") {
        // Bloco de raciocínio (quando thinkingLevel != "off")
      }
      if (streamEvent.type === "toolcall_start") {
        console.log(`\n🔧 Tool call: ${streamEvent.name}`);
      }
      break;

    case "message_end":
      console.log("\n✅ LLM terminou resposta");
      break;

    case "tool_execution_start":
      console.log(`⚙️ Executando: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;

    case "tool_execution_update":
      // Atualizações intermediárias da tool
      break;

    case "tool_execution_end":
      console.log(`📋 Tool ${event.isError ? "ERRO" : "OK"}`);
      break;

    case "turn_end":
      console.log("↻ Turno finalizado");
      break;

    case "agent_end":
      console.log("🏁 Agente finalizou");
      break;

    // Eventos específicos do pi-coding-agent
    case "auto_compaction_start":
      console.log(`📦 Compactação automática: ${event.reason}`);
      break;
    case "auto_compaction_end":
      break;
    case "auto_retry_start":
      console.log("🔄 Auto-retry iniciado");
      break;
    case "auto_retry_end":
      break;
  }
});
```

### Enviando prompts e controlando o fluxo

```typescript
// Enviar prompt e aguardar conclusão
await session.prompt("Liste todos os arquivos TypeScript neste diretório");

// Interromper o agente atual (entrega após tool corrente)
session.agent.steer({
  role: "user",
  content: "Pare, foque apenas nos arquivos .ts na pasta src/",
  timestamp: Date.now(),
});

// Enfileirar follow-up (executa após agente terminar naturalmente)
session.agent.followUp({
  role: "user",
  content: "Agora resuma o que encontrou",
  timestamp: Date.now(),
});

// Abortar execução
session.agent.abort();

// Compactar contexto manualmente
await session.compact("Preserve todos os caminhos de arquivo e mudanças de código.");

// Verificar tamanho do contexto
const totalTokens = session.messages.reduce(
  (sum, msg) => sum + estimateTokens(msg), 0
);
console.log(`Tokens no contexto: ${totalTokens}`);

// Trocar modelo em runtime
session.agent.setModel(getModel("openai", "gpt-4o"));
session.agent.setThinkingLevel("high");
session.agent.setSystemPrompt("Você é um revisor de código exigente.");

// Limpar filas
session.agent.clearAllQueues();

// Encerrar sessão
session.dispose();
```

### Criando tools customizadas

Cada tool usa TypeBox para definição de schema dos parâmetros: 

```typescript
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const deployParams = Type.Object({
  environment: Type.String({ description: "Ambiente: staging ou production" }),
  version: Type.String({ description: "Tag de versão para deploy" }),
});

const deployTool: AgentTool<typeof deployParams> = {
  name: "deploy",
  label: "Deploy",
  description: "Faz deploy da aplicação no ambiente especificado",
  parameters: deployParams,
  execute: async (toolCallId, params, signal, onUpdate) => {
    // onUpdate() para enviar atualizações intermediárias
    onUpdate({ status: "iniciando deploy..." });

    // Lógica de deploy aqui
    const result = await executeDeploy(params.environment, params.version);

    return {
      content: [{ type: "text", text: `Deploy v${params.version} em ${params.environment}: OK` }],
      details: { deployId: result.id }, // Apenas para UI, não enviado ao LLM
    };
  },
};
```

### Tool factories com workspace scoped

O Pi permite criar tools vinculadas a um diretório específico, útil quando cada agente opera em workspace diferente:

```typescript
import {
  createCodingTools,
  createReadOnlyTools,
  createBashTool,
  createReadTool,
} from "@mariozechner/pi-coding-agent";

// Tools restritas a um diretório
const workspaceTools = createCodingTools("/home/user/projeto-a");
const explorationTools = createReadOnlyTools("/home/user/projeto-b");

// Tool com operações customizadas (sandbox, Docker, etc.)
const sandboxBash = createBashTool("/workspace", {
  operations: {
    exec: async (command, cwd, opts) => runInDockerContainer(command, cwd, opts),
  },
});

// Read tool remoto
const remoteRead = createReadTool("/workspace", {
  operations: {
    readFile: async (path) => fetchFileFromRemoteServer(path),
    access: async (path) => checkRemoteFileExists(path),
  },
});
```

-----

## 3. RPC via stdin/stdout: o protocolo JSON line-delimited

O modo RPC transforma o Pi num **servidor headless** que aceita comandos JSON via stdin e emite eventos/respostas via stdout.  Ideal para integração com processos externos, linguagens diferentes de Node.js, ou quando se deseja **isolamento de processo** entre o orquestrador e os agentes. 

### Iniciando o processo RPC

```typescript
import { spawn, ChildProcess } from "child_process";

function spawnPiRpc(options: {
  provider?: string;
  model?: string;
  noSession?: boolean;
  cwd?: string;
}): ChildProcess {
  const args = ["--mode", "rpc"];

  if (options.provider) args.push("--provider", options.provider);
  if (options.model) args.push("--model", options.model);
  if (options.noSession) args.push("--no-session");

  return spawn("pi", args, {
    cwd: options.cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    },
  });
}

const piProcess = spawnPiRpc({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  noSession: true,
});
```

### Protocolo: formato exato das mensagens

O protocolo é **line-delimited JSON** (JSONL). Cada linha é um objeto JSON auto-contido.   Na inicialização, o Pi emite `{ "type": "ready" }`.

**Enviando comandos (stdin):**

```typescript
function sendCommand(proc: ChildProcess, command: Record<string, unknown>) {
  proc.stdin!.write(JSON.stringify(command) + "\n");
}

// Prompt básico
sendCommand(piProcess, {
  id: "req-001",
  type: "prompt",
  message: "Analise os arquivos neste diretório",
});

// Prompt com imagens
sendCommand(piProcess, {
  type: "prompt",
  message: "O que esta imagem mostra?",
  images: [{ type: "image", data: "<base64>", mimeType: "image/png" }],
});

// Steer (interromper e redirecionar)
sendCommand(piProcess, {
  type: "steer",
  message: "Foque apenas nos erros de TypeScript",
});

// Follow-up (enfileirar próximo prompt)
sendCommand(piProcess, {
  type: "follow_up",
  message: "Agora corrija os erros encontrados",
});

// Abortar execução corrente
sendCommand(piProcess, { type: "abort" });

// Trocar modelo
sendCommand(piProcess, {
  type: "set_model",
  provider: "openai",
  model: "gpt-4o",
});

// Configurar nível de raciocínio
sendCommand(piProcess, {
  type: "set_thinking_level",
  level: "high",
});

// Obter estado completo
sendCommand(piProcess, { id: "state-1", type: "get_state" });

// Compactar contexto
sendCommand(piProcess, { type: "compact" });

// Sessões
sendCommand(piProcess, { type: "new_session" });
sendCommand(piProcess, { type: "get_session_stats" });
sendCommand(piProcess, { type: "get_messages" });

// Executar bash diretamente
sendCommand(piProcess, { type: "bash", command: "ls -la" });

// Configurar modos de fila
sendCommand(piProcess, { type: "set_steering_mode", mode: "all" });
sendCommand(piProcess, { type: "set_follow_up_mode", mode: "one-at-a-time" });

// Auto-compactação e retry
sendCommand(piProcess, { type: "set_auto_compaction", enabled: true });
sendCommand(piProcess, { type: "set_auto_retry", enabled: true });
```

**Recebendo respostas e eventos (stdout):**

```typescript
import * as readline from "readline";

const rl = readline.createInterface({ input: piProcess.stdout! });

rl.on("line", (line) => {
  const event = JSON.parse(line);

  switch (event.type) {
    case "ready":
      console.log("Pi RPC pronto!");
      break;

    case "response":
      // Resposta a um comando específico
      if (event.success) {
        console.log(`Comando ${event.command} OK:`, event.data);
      } else {
        console.error(`Comando ${event.command} ERRO:`, event.error);
      }
      break;

    // Eventos do agent loop (mesmos do SDK)
    case "agent_start":
    case "agent_end":
    case "turn_start":
    case "turn_end":
    case "message_start":
    case "message_update":
    case "message_end":
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      handleAgentEvent(event);
      break;

    // Eventos de extensão UI
    case "extension_ui_request":
      handleExtensionUiRequest(event);
      break;
  }
});

// Tratar pedidos de UI de extensões
function handleExtensionUiRequest(req: any) {
  switch (req.method) {
    case "confirm":
      // Responder com true/false
      sendCommand(piProcess, {
        type: "extension_ui_response",
        id: req.id,
        value: true,
      });
      break;
    case "select":
      sendCommand(piProcess, {
        type: "extension_ui_response",
        id: req.id,
        value: req.items[0], // Selecionar primeiro item
      });
      break;
    case "notify":
      console.log(`[Notificação] ${req.message}`);
      break;
    case "setStatus":
      console.log(`[Status ${req.key}] ${req.text}`);
      break;
  }
}
```

**Formato da resposta `get_state`:**

```json
{
  "id": "state-1",
  "type": "response",
  "command": "get_state",
  "success": true,
  "data": {
    "model": "claude-sonnet-4-20250514",
    "thinkingLevel": "medium",
    "isStreaming": false,
    "isCompacting": false,
    "steeringMode": "one-at-a-time",
    "followUpMode": "one-at-a-time",
    "sessionFile": null,
    "sessionId": "abc123",
    "sessionName": null,
    "autoCompactionEnabled": true,
    "messageCount": 4,
    "pendingMessageCount": 0
  }
}
```

### RPC programático (sem CLI)

Você pode também iniciar o modo RPC programaticamente, usando o SDK internamente: 

```typescript
import { createAgentSession, runRpcMode, SessionManager } from "@mariozechner/pi-coding-agent";
import { getModel, streamSimple } from "@mariozechner/pi-ai";

const { session } = await createAgentSession({
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  sessionManager: SessionManager.inMemory(),
  thinkingLevel: "off",
});
session.agent.streamFn = streamSimple;

// Inicia leitura de stdin e escrita em stdout no protocolo RPC
await runRpcMode(session);
```

-----

## 4. Event stream: catálogo completo de eventos

O Pi emite eventos numa hierarquia bem definida.  Aqui está o **catálogo completo** com o formato exato de cada evento:

### Eventos da camada `pi-ai` (streaming do LLM)

Estes eventos chegam dentro de `message_update.assistantMessageEvent`:

|Evento          |Campos                                            |Descrição                    |
|----------------|--------------------------------------------------|-----------------------------|
|`start`         |—                                                 |Stream iniciou               |
|`text_start`    |—                                                 |Bloco de texto começou       |
|`text_delta`    |`delta: string`                                   |Fragmento de texto           |
|`text_end`      |—                                                 |Bloco de texto terminou      |
|`thinking_start`|—                                                 |Raciocínio começou           |
|`thinking_delta`|`delta: string`                                   |Fragmento de raciocínio      |
|`thinking_end`  |—                                                 |Raciocínio terminou          |
|`toolcall_start`|`name: string, id: string`                        |Tool call iniciou            |
|`toolcall_delta`|`delta: string`                                   |JSON parcial dos argumentos  |
|`toolcall_end`  |—                                                 |Tool call completa           |
|`done`          |`message: AssistantMessage`                       |Stream finalizado com sucesso|
|`error`         |`error: { errorMessage, statusCode?, retryable? }`|Erro no stream               |

### Eventos da camada `pi-agent-core` (agent loop)

|Evento                 |Campos-chave                |Descrição                   |
|-----------------------|----------------------------|----------------------------|
|`agent_start`          |—                           |Agente começou a processar  |
|`agent_end`            |—                           |Agente parou completamente  |
|`turn_start`           |—                           |Novo turno LLM → tools → LLM|
|`turn_end`             |—                           |Turno finalizado            |
|`message_start`        |—                           |LLM começou a gerar resposta|
|`message_update`       |`assistantMessageEvent`     |Evento de streaming do LLM  |
|`message_end`          |`message: AssistantMessage` |Resposta completa do LLM    |
|`tool_execution_start` |`toolName, args, toolCallId`|Tool começou a executar     |
|`tool_execution_update`|`toolName, update`          |Atualização intermediária   |
|`tool_execution_end`   |`toolName, result, isError` |Tool terminou               |

### Eventos exclusivos do `pi-coding-agent`

|Evento                 |Campos                            |Descrição                     |
|-----------------------|----------------------------------|------------------------------|
|`auto_compaction_start`|`reason: "threshold" | "overflow"`|Compactação automática iniciou|
|`auto_compaction_end`  |—                                 |Compactação terminou          |
|`auto_retry_start`     |—                                 |Retry automático após erro    |
|`auto_retry_end`       |—                                 |Retry terminou                |

### Parseando o JSONL stream

```typescript
import { createInterface } from "readline";
import { Readable } from "stream";

interface PiEvent {
  type: string;
  [key: string]: unknown;
}

function parseJsonlStream(stream: Readable): AsyncIterable<PiEvent> {
  const rl = createInterface({ input: stream });

  return {
    [Symbol.asyncIterator]() {
      const buffer: PiEvent[] = [];
      let resolve: ((value: IteratorResult<PiEvent>) => void) | null = null;
      let done = false;

      rl.on("line", (line) => {
        try {
          const event = JSON.parse(line) as PiEvent;
          if (resolve) {
            const r = resolve;
            resolve = null;
            r({ value: event, done: false });
          } else {
            buffer.push(event);
          }
        } catch { /* ignorar linhas inválidas */ }
      });

      rl.on("close", () => {
        done = true;
        if (resolve) {
          resolve({ value: undefined as any, done: true });
        }
      });

      return {
        next() {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined as any, done: true });
          }
          return new Promise((r) => { resolve = r; });
        },
      };
    },
  };
}

// Uso
const events = parseJsonlStream(piProcess.stdout!);
for await (const event of events) {
  console.log(`[${event.type}]`, event);
}
```

-----

## 5. Comparativo de bibliotecas TUI para dashboards multi-agente

Para construir um dashboard com múltiplos painéis, logs em tempo real, status de agentes, progress bars e input de comandos simultâneo, a escolha da biblioteca TUI é crítica.

### Ink: React para o terminal — a escolha recomendada

**Ink** (v6.8.0, **2.2M downloads/semana**, 34K+ stars)  aplica o modelo React ao terminal usando Flexbox via Yoga.  Cada componente é uma função React que re-renderiza automaticamente quando o estado muda.  Para um orquestrador de agentes, cada agente vira naturalmente um componente com seu próprio estado (logs, progresso, status), e `useState` + `useEffect` lidam com streaming de forma idiomática.

**Pontos fortes**: TypeScript nativo, ecossistema rico (`@inkjs/ui` com Spinner, ProgressBar, TextInput, Badge, StatusMessage), layout Flexbox declarativo, testável com `ink-testing-library`, usado em produção por Shopify CLI, GitHub Copilot CLI e Prisma.  O `fullscreen-ink` permite modo tela cheia com alternate screen buffer.  A manutenção é ativa com releases regulares em 2026.

**Limitações**: scrolling não é nativo (requer lógica custom de slice no array de logs), não tem conceito de janelas sobrepostas ou z-index, e o overhead do React runtime + Yoga WASM pode adicionar latência mínima comparado a blessed.

### Blessed / neo-blessed: poderoso mas abandonado

**Blessed** (11.5K stars, 1.5M downloads/semana por dependências legadas)  é a biblioteca TUI mais feature-complete para Node.js,  com **grid layout nativo**, widgets de log, gauges, charts via blessed-contrib, mouse support e double-buffered rendering.  O `blessed-contrib` oferece  `grid.set(row, col, rowSpan, colSpan, widget)` — exatamente o que um dashboard precisa. 

**O problema fatal**: o repositório original `chjj/blessed` está **abandonado desde ~2015**. Neo-blessed e outros forks também estagnaram.  Sem TypeScript nativo, sem patches de segurança, sem compatibilidade garantida com Node.js futuro. **Não recomendado para projetos novos em produção**.

### Terminal-kit: muito baixo nível

Terminal-kit (v3.1.2, ~100-200K downloads) oferece controle direto de screen buffers e escape sequences.  Rápido e eficiente, mas **não tem sistema de layout**, componentes, ou widgets de dashboard. Construir um dashboard multi-painel exigiria implementar todo o sistema de layout, scrolling e gerenciamento de foco manualmente. Inadequado para este caso de uso.

### Alternativas modernas ao Bubbletea no ecossistema Node.js

Não existe um equivalente direto ao Bubbletea (Go) no ecossistema Node.js com a mesma maturidade. O **charsm** porta Lipgloss via WASM para estilização,  mas é apenas uma biblioteca de styling sem layout ou widgets. O **react-blessed** (renderizador React para blessed) está abandonado. O **oclif** é framework de CLI (parsing de argumentos, comandos) e não TUI.   Na prática, **Ink preenche o nicho** que Bubbletea ocupa em Go: framework declarativo, composável e moderno para TUI. 

### Veredicto: Ink é a melhor escolha

|Critério           |Ink             |Blessed     |Terminal-kit |
|-------------------|----------------|------------|-------------|
|Manutenção ativa   |✅ 2026          |❌ ~2015     |⚠️ Baixa      |
|TypeScript         |✅ Nativo        |❌           |❌            |
|Layout multi-painel|✅ Flexbox       |✅ Grid      |❌ Manual     |
|Streaming/logs     |✅ State + Static|✅ Log widget|❌ Manual     |
|Progress bars      |✅ @inkjs/ui     |✅ Contrib   |✅ Built-in   |
|Input simultâneo   |✅ Hooks         |✅ TextBox   |✅ InputField |
|Risco em produção  |✅ Baixo         |❌ Alto      |⚠️ Médio      |
|DX (React devs)    |✅ Excelente     |⚠️ Íngreme   |⚠️ Baixo nível|

**Ink é a escolha recomendada** pela combinação de manutenção ativa, TypeScript, modelo declarativo React e ecossistema rico.  As limitações de scrolling são contornáveis com slice de arrays e estado de offset.

-----

## 6. Configuração programática: sem arquivos de config

Para controlar modelo, provider e API key inteiramente via código, sem depender de `auth.json`, `models.json` ou `settings.json`:

### Configurando API key programaticamente

```typescript
import { AuthStorage, ModelRegistry, createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import { getModel, streamSimple } from "@mariozechner/pi-ai";

// Opção 1: Via variável de ambiente (mais simples)
process.env.ANTHROPIC_API_KEY = "sk-ant-xxxxx";
const model = getModel("anthropic", "claude-sonnet-4-20250514");
model.apiKey = process.env.ANTHROPIC_API_KEY;

// Opção 2: Via AuthStorage programático
const authStorage = AuthStorage.create(); // Lê de ~/.pi/agent/auth.json por padrão
// Ou criar com path customizado:
// const authStorage = AuthStorage.create("/caminho/custom/auth.json");

// Opção 3: Definir modelo completamente custom (sem catálogo)
import type { Model } from "@mariozechner/pi-ai";

const customModel: Model<"openai-completions"> = {
  id: "llama-3.1-70b",
  name: "Llama 3.1 70B",
  api: "openai-completions",
  provider: "ollama",
  baseUrl: "http://localhost:11434/v1",
  apiKey: "ollama", // Ollama não precisa de key real
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
};
```

### SettingsManager para configuração em memória

```typescript
import { SettingsManager } from "@mariozechner/pi-coding-agent";

// Criar settings em memória com overrides (sem arquivo)
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: true },
  retry: { enabled: true, maxRetries: 5 },
  steeringMode: "all",
  followUpMode: "one-at-a-time",
});
```

### ModelRegistry para modelos customizados

```typescript
const modelRegistry = new ModelRegistry(authStorage);

// Buscar modelo do registro
const registeredModel = modelRegistry.find("ollama", "llama3.1:8b");

// Listar modelos disponíveis (com keys configuradas)
const available = await modelRegistry.getAvailable();
```

### Stream middleware para headers customizados

```typescript
import type { StreamFn } from "@mariozechner/pi-agent-core";

const wrappedStreamFn: StreamFn = (model, context, options) => {
  const extraHeaders: Record<string, string> = {};
  if (model.provider === "openrouter") {
    extraHeaders["X-Title"] = "Meu Orquestrador";
    extraHeaders["HTTP-Referer"] = "https://meuapp.com";
  }
  return streamSimple(model, context, {
    ...options,
    headers: { ...options?.headers, ...extraHeaders },
    cacheRetention: model.provider === "anthropic" ? "long" : "none",
  });
};

session.agent.streamFn = wrappedStreamFn;
```

### Contexto: AGENTS.md e system prompts

```typescript
// System prompt customizado por agente
session.agent.setSystemPrompt(`
Você é o agente "Scout". Sua tarefa é explorar o codebase e mapear a estrutura.
Regras:
- Use apenas as tools read, grep e find
- Não modifique nenhum arquivo
- Retorne um mapa completo da estrutura do projeto
`);

// O AGENTS.md é carregado automaticamente do cwd e diretórios pai
// Para customizar, use o ResourceLoader ou simplesmente crie
// o arquivo .pi/AGENTS.md no diretório do projeto
```

-----

## 7. Exemplo prático completo: orquestrador de pipelines com TUI

Este exemplo implementa um orquestrador que define um pipeline de agentes (scout → planner → builder → reviewer), controla cada um via SDK, exibe progresso em tempo real com Ink, e passa output entre agentes.

### Instalação das dependências

```bash
npm install @mariozechner/pi-ai @mariozechner/pi-agent-core \
            @mariozechner/pi-coding-agent \
            ink @inkjs/ui react
npm install -D typescript @types/node @types/react tsx
```

### Arquivo: `pipeline-types.ts`

```typescript
export type AgentRole = "scout" | "planner" | "builder" | "reviewer";

export type AgentStatus = "idle" | "running" | "done" | "error";

export interface PipelineStage {
  role: AgentRole;
  systemPrompt: string;
  promptTemplate: (previousOutput: string) => string;
  tools: string[]; // "read" | "bash" | "edit" | "write" | "grep" | "find"
}

export interface AgentState {
  role: AgentRole;
  status: AgentStatus;
  logs: string[];
  output: string;
  progress: number; // 0-1
  tokensUsed: number;
  currentTool: string | null;
  error: string | null;
}
```

### Arquivo: `pipeline-config.ts`

```typescript
import { PipelineStage } from "./pipeline-types.js";

export const DEFAULT_PIPELINE: PipelineStage[] = [
  {
    role: "scout",
    systemPrompt: `Você é o Scout. Explore o codebase e mapeie a estrutura completa.
Identifique: linguagens, frameworks, padrões de arquitetura, dependências principais.
Retorne um relatório estruturado no final.`,
    promptTemplate: (prev) =>
      `Explore este projeto e mapeie sua estrutura completa. Retorne um relatório detalhado.`,
    tools: ["read", "grep", "find"],
  },
  {
    role: "planner",
    systemPrompt: `Você é o Planner. Receba o mapa do Scout e crie um plano de implementação.
Defina tarefas específicas, ordem de execução e critérios de aceitação.`,
    promptTemplate: (prev) =>
      `Com base neste relatório do Scout, crie um plano de implementação detalhado:\n\n${prev}`,
    tools: ["read"],
  },
  {
    role: "builder",
    systemPrompt: `Você é o Builder. Execute o plano do Planner modificando o código.
Siga cada tarefa na ordem definida. Use edit para mudanças cirúrgicas, write para arquivos novos.`,
    promptTemplate: (prev) =>
      `Execute este plano de implementação, modificando o código conforme especificado:\n\n${prev}`,
    tools: ["read", "bash", "edit", "write"],
  },
  {
    role: "reviewer",
    systemPrompt: `Você é o Reviewer. Revise todas as mudanças feitas pelo Builder.
Verifique qualidade, bugs, segurança, aderência ao plano. Liste problemas encontrados.`,
    promptTemplate: (prev) =>
      `Revise as mudanças implementadas pelo Builder. Output do builder:\n\n${prev}\n\nVerifique qualidade, bugs e aderência ao plano.`,
    tools: ["read", "bash", "grep"],
  },
];
```

### Arquivo: `agent-runner.ts` — controle do agente via SDK

```typescript
import {
  createAgentSession,
  SessionManager,
  allBuiltInTools,
} from "@mariozechner/pi-coding-agent";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import type { AgentState, PipelineStage, AgentRole } from "./pipeline-types.js";

type AgentEventCallback = (role: AgentRole, state: Partial<AgentState>) => void;

export async function runAgent(
  stage: PipelineStage,
  previousOutput: string,
  config: {
    provider: string;
    modelId: string;
    apiKey?: string;
    thinkingLevel?: string;
    cwd?: string;
  },
  onUpdate: AgentEventCallback
): Promise<string> {
  const model = getModel(
    config.provider as any,
    config.modelId
  );
  if (config.apiKey) {
    (model as any).apiKey = config.apiKey;
  }

  // Mapear nomes de tools para objetos de tool
  const toolMap: Record<string, any> = {
    read: allBuiltInTools.read,
    bash: allBuiltInTools.bash,
    edit: allBuiltInTools.edit,
    write: allBuiltInTools.write,
    grep: allBuiltInTools.grep,
    find: allBuiltInTools.find,
    ls: allBuiltInTools.ls,
  };

  const tools = stage.tools
    .map((name) => toolMap[name])
    .filter(Boolean);

  const { session } = await createAgentSession({
    model,
    thinkingLevel: (config.thinkingLevel as any) || "off",
    sessionManager: SessionManager.inMemory(),
    tools,
    cwd: config.cwd || process.cwd(),
  });

  session.agent.streamFn = streamSimple;
  session.agent.setSystemPrompt(stage.systemPrompt);

  let fullOutput = "";
  let tokensUsed = 0;

  // Inscrever nos eventos
  session.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        onUpdate(stage.role, { status: "running", progress: 0.1 });
        break;

      case "message_update": {
        const streamEvt = event.assistantMessageEvent;
        if (streamEvt.type === "text_delta") {
          fullOutput += streamEvt.delta;
          onUpdate(stage.role, {
            logs: [`${streamEvt.delta}`],
            output: fullOutput,
          });
        }
        if (streamEvt.type === "toolcall_start") {
          onUpdate(stage.role, {
            currentTool: streamEvt.name,
            logs: [`🔧 Chamando tool: ${streamEvt.name}`],
          });
        }
        break;
      }

      case "message_end":
        if (event.message?.usage) {
          tokensUsed += event.message.usage.totalTokens || 0;
          onUpdate(stage.role, { tokensUsed, progress: 0.5 });
        }
        break;

      case "tool_execution_start":
        onUpdate(stage.role, {
          currentTool: event.toolName,
          logs: [`⚙️ Executando: ${event.toolName}(${truncate(JSON.stringify(event.args), 80)})`],
        });
        break;

      case "tool_execution_end":
        onUpdate(stage.role, {
          currentTool: null,
          logs: [
            event.isError
              ? `❌ Tool ${event.toolName} falhou`
              : `✅ Tool ${event.toolName} OK`,
          ],
          progress: 0.7,
        });
        break;

      case "agent_end":
        onUpdate(stage.role, {
          status: "done",
          progress: 1.0,
          currentTool: null,
          output: fullOutput,
          tokensUsed,
        });
        break;
    }
  });

  // Executar prompt
  const prompt = stage.promptTemplate(previousOutput);
  try {
    await session.prompt(prompt);
  } catch (err: any) {
    onUpdate(stage.role, {
      status: "error",
      error: err.message,
      logs: [`💥 Erro: ${err.message}`],
    });
    throw err;
  } finally {
    session.dispose();
  }

  return fullOutput;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}
```

### Arquivo: `tui-dashboard.tsx` — interface TUI com Ink

```tsx
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import type { AgentRole, AgentState, PipelineStage } from "./pipeline-types.js";
import { runAgent } from "./agent-runner.js";
import { DEFAULT_PIPELINE } from "./pipeline-config.js";

// Estado inicial de cada agente
function createInitialState(role: AgentRole): AgentState {
  return {
    role,
    status: "idle",
    logs: [],
    output: "",
    progress: 0,
    tokensUsed: 0,
    currentTool: null,
    error: null,
  };
}

// Componente de painel individual de agente
function AgentPanel({ state, width }: { state: AgentState; width: string }) {
  const statusIcon: Record<string, string> = {
    idle: "⏸️",
    running: "▶️",
    done: "✅",
    error: "❌",
  };

  const borderColor =
    state.status === "running"
      ? "cyan"
      : state.status === "done"
      ? "green"
      : state.status === "error"
      ? "red"
      : "gray";

  // Mostrar últimas N linhas de log
  const MAX_LOG_LINES = 12;
  const visibleLogs = state.logs.slice(-MAX_LOG_LINES);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      {/* Header do painel */}
      <Box justifyContent="space-between">
        <Text bold color={borderColor}>
          {statusIcon[state.status]} {state.role.toUpperCase()}
        </Text>
        <Text dimColor>
          {Math.round(state.progress * 100)}% | {state.tokensUsed} tok
        </Text>
      </Box>

      {/* Barra de progresso simples */}
      <Box marginY={0}>
        <Text>
          {"█".repeat(Math.round(state.progress * 20))}
          {"░".repeat(20 - Math.round(state.progress * 20))}
        </Text>
      </Box>

      {/* Tool atual */}
      {state.currentTool && (
        <Box>
          <Spinner label={` ${state.currentTool}`} />
        </Box>
      )}

      {/* Logs */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleLogs.map((log, i) => (
          <Text key={i} wrap="truncate" dimColor={i < visibleLogs.length - 3}>
            {log.replace(/\n/g, " ").slice(0, 80)}
          </Text>
        ))}
      </Box>

      {/* Erro */}
      {state.error && (
        <Text color="red" bold>
          ERRO: {state.error}
        </Text>
      )}
    </Box>
  );
}

// Componente principal do dashboard
function Dashboard({
  pipeline,
  config,
}: {
  pipeline: PipelineStage[];
  config: {
    provider: string;
    modelId: string;
    apiKey?: string;
    thinkingLevel?: string;
    cwd?: string;
  };
}) {
  const { exit } = useApp();
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>(
    () => {
      const initial: Record<string, AgentState> = {};
      for (const stage of pipeline) {
        initial[stage.role] = createInitialState(stage.role);
      }
      return initial as Record<AgentRole, AgentState>;
    }
  );
  const [currentStage, setCurrentStage] = useState(0);
  const [pipelineStatus, setPipelineStatus] = useState<
    "running" | "done" | "error"
  >("running");

  // Callback para atualizações de agente
  const handleAgentUpdate = useCallback(
    (role: AgentRole, update: Partial<AgentState>) => {
      setAgents((prev) => {
        const current = prev[role];
        return {
          ...prev,
          [role]: {
            ...current,
            ...update,
            // Append logs em vez de substituir
            logs: update.logs
              ? [...current.logs, ...update.logs]
              : current.logs,
          },
        };
      });
    },
    []
  );

  // Executar pipeline sequencialmente
  useEffect(() => {
    let cancelled = false;

    async function executePipeline() {
      let previousOutput = "";

      for (let i = 0; i < pipeline.length; i++) {
        if (cancelled) break;

        const stage = pipeline[i];
        setCurrentStage(i);
        handleAgentUpdate(stage.role, {
          status: "running",
          logs: [`🚀 Iniciando ${stage.role}...`],
        });

        try {
          previousOutput = await runAgent(
            stage,
            previousOutput,
            config,
            handleAgentUpdate
          );
        } catch (err: any) {
          setPipelineStatus("error");
          return;
        }
      }

      if (!cancelled) {
        setPipelineStatus("done");
      }
    }

    executePipeline();
    return () => { cancelled = true; };
  }, []);

  // Atalho para sair
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
    }
  });

  const panelWidth = `${Math.floor(100 / pipeline.length)}%`;

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <Box
        borderStyle="double"
        borderColor="cyan"
        justifyContent="space-between"
        paddingX={2}
      >
        <Text bold color="cyan">
          🔗 Pipeline Orchestrator
        </Text>
        <Text>
          Stage {currentStage + 1}/{pipeline.length} |{" "}
          {pipelineStatus === "running" ? "▶️ Executando" : ""}
          {pipelineStatus === "done" ? "✅ Concluído" : ""}
          {pipelineStatus === "error" ? "❌ Erro" : ""}
        </Text>
        <Text dimColor>Pressione 'q' para sair</Text>
      </Box>

      {/* Painéis dos agentes */}
      <Box flexDirection="row" flexGrow={1}>
        {pipeline.map((stage) => (
          <AgentPanel
            key={stage.role}
            state={agents[stage.role]}
            width={panelWidth}
          />
        ))}
      </Box>

      {/* Footer com resumo */}
      <Box borderStyle="single" borderColor="gray" paddingX={2}>
        <Text>
          Tokens totais:{" "}
          <Text bold>
            {Object.values(agents).reduce((sum, a) => sum + a.tokensUsed, 0)}
          </Text>
          {" | "}
          Pipeline:{" "}
          {pipeline.map((s) => (
            <Text
              key={s.role}
              color={
                agents[s.role].status === "done"
                  ? "green"
                  : agents[s.role].status === "running"
                  ? "cyan"
                  : agents[s.role].status === "error"
                  ? "red"
                  : "gray"
              }
            >
              {s.role}
              {" → "}
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  );
}

// Entry point
export function startDashboard(config: {
  provider: string;
  modelId: string;
  apiKey?: string;
  thinkingLevel?: string;
  cwd?: string;
  pipeline?: PipelineStage[];
}) {
  const pipeline = config.pipeline || DEFAULT_PIPELINE;

  render(
    <Dashboard pipeline={pipeline} config={config} />
  );
}
```

### Arquivo: `main.ts` — ponto de entrada

```typescript
import { startDashboard } from "./tui-dashboard.js";

// Configuração via argumentos ou variáveis de ambiente
const config = {
  provider: process.env.PI_PROVIDER || "anthropic",
  modelId: process.env.PI_MODEL || "claude-sonnet-4-20250514",
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
  thinkingLevel: process.env.PI_THINKING || "off",
  cwd: process.cwd(),
};

startDashboard(config);
```

Executar com:

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx npx tsx main.ts
```

### Variante: pipeline com passagem de output como arquivo

Para pipelines mais robustos onde o output é grande demais para inline no prompt, escreva o resultado intermediário em arquivo:

```typescript
import { writeFile, readFile } from "fs/promises";
import { join } from "path";

async function runPipelineWithFiles(stages: PipelineStage[], config: any) {
  const outputDir = join(config.cwd, ".pi-pipeline");
  await mkdir(outputDir, { recursive: true });

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    let previousOutput = "";

    if (i > 0) {
      const prevFile = join(outputDir, `${stages[i - 1].role}-output.md`);
      previousOutput = await readFile(prevFile, "utf-8");
    }

    const output = await runAgent(stage, previousOutput, config, onUpdate);

    // Salvar output para próximo estágio
    const outputFile = join(outputDir, `${stage.role}-output.md`);
    await writeFile(outputFile, output, "utf-8");
  }
}
```

-----

## Padrões avançados: stream proxy e middleware

Para cenários onde o orquestrador roda num servidor e os agentes precisam acessar LLMs via proxy, o Pi oferece `streamProxy`:

```typescript
import { Agent, streamProxy } from "@mariozechner/pi-agent-core";

const agent = new Agent({
  initialState: {
    systemPrompt: "Você é um agente de código.",
    model: getModel("anthropic", "claude-sonnet-4-20250514"),
    tools: [],
    thinkingLevel: "off",
  },
  streamFn: (model, context, options) =>
    streamProxy(model, context, {
      ...options,
      authToken: "bearer-token-aqui",
      proxyUrl: "https://seu-proxy.com/api/stream",
    }),
});
```

Também é possível usar **declaração de tipos customizados** para mensagens de pipeline entre agentes:

```typescript
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    pipeline_handoff: {
      role: "pipeline_handoff";
      fromAgent: string;
      toAgent: string;
      payload: string;
      timestamp: number;
    };
  }
}

// Agora AgentMessage aceita o tipo pipeline_handoff
const handoff: AgentMessage = {
  role: "pipeline_handoff",
  fromAgent: "scout",
  toAgent: "planner",
  payload: scoutOutput,
  timestamp: Date.now(),
};
```

### Compactação inteligente para pipelines longos

Quando um agente numa pipeline acumula contexto demais, a compactação automática preserva informações críticas:

```typescript
import { estimateTokens } from "@mariozechner/pi-coding-agent";

// Monitorar tokens e compactar proativamente
session.subscribe((event) => {
  if (event.type === "turn_end") {
    const totalTokens = session.messages.reduce(
      (sum, msg) => sum + estimateTokens(msg), 0
    );
    if (totalTokens > 80_000) {
      session.compact(
        "Preserve: todos os caminhos de arquivo, mudanças de código, e decisões de arquitetura."
      );
    }
  }
});
```

-----

## Conclusão

O Pi Coding Agent oferece um modelo de integração excepcionalmente bem projetado em três camadas de abstração. O **modo SDK** (via `createAgentSession`) é a interface mais poderosa para orquestradores — type-safe, com acesso direto a estado, eventos granulares e controle total sobre tools e configuração. O **modo RPC** serve para isolamento de processo ou integração cross-language, com protocolo JSONL simples mas completo. O **event stream** unificado (`agent_start` → `turn_start` → `message_update` → `tool_execution_*` → `agent_end`) torna observabilidade trivial.

Para a camada visual, **Ink** é a escolha clara em 2026: manutenção ativa, TypeScript nativo, modelo React declarativo que mapeia naturalmente para estado de agentes, e ecossistema rico. A principal armadilha a evitar é blessed — apesar dos widgets superiores para dashboards, a biblioteca está abandonada há uma década.

O padrão mais eficaz para pipelines é combinar `createAgentSession` com `SessionManager.inMemory()` para cada estágio, encadear outputs via prompt templates e monitorar eventos para atualizar a TUI. Cada agente deve ter workspace-scoped tools (via `createCodingTools`), system prompt especializado e lifecycle independente. Isso produz pipelines robustos onde cada estágio é isolado, observável e substituível.