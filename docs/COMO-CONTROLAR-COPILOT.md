# Controle programático do GitHub Copilot CLI: contrato `pi-coding-agent` portado para `@github/copilot` + `@github/copilot-sdk`

## Sumário executivo

A pesquisa confirma que existe um caminho **suportado e estável** para reproduzir praticamente todo o contrato de orquestração do `@mariozechner/pi-coding-agent` em cima do GitHub Copilot CLI, e esse caminho **não é** o que parece à primeira vista (CLI + parsing de stdout). É o `@github/copilot-sdk`, lançado em preview público no início de 2026 e mantido pelo time oficial do GitHub. O SDK é um cliente JSON-RPC que sobe o binário `copilot` em modo *headless* server (`copilot --headless --port N`) e expõe primitivas idênticas ao que o `huu` precisa: `CopilotClient`/`session.createSession`, `session.send`, `session.on(event, handler)`, `session.abort`, `session.disconnect`, eventos granulares `assistant.message_delta`/`tool.execution_start`/`tool.execution_complete`/`session.idle`/`session.error`/`session.shutdown`, tools customizadas via `defineTool` com Zod, `systemMessage` (modos `append`/`replace`/`customize`), `sessionId` para resume, `provider` (BYOK), e contagem de tokens em `assistant.usage` (inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, duration) e em `session.shutdown` (totalPremiumRequests, modelMetrics).

A camada CLI tradicional (`copilot -p "..." --output-format=json --allow-all --no-color`) é o **fallback** — também serve, especialmente em CI minimalista, e desde a versão 1.0.10 emite JSONL machine-readable, mas perde granularidade (sub-agentes do `/fleet` não fazem stream por agente — issue 2265 — e o `session.shutdown.shutdownType` colapsa razões — issue 2852). A recomendação de arquitetura é **um adapter principal sobre `@github/copilot-sdk` (JSON-RPC)** com um *fallback* de CLI prompt mode, mais um stub e um shim de auth + worktree git que permanecem do lado do `huu`. Pontos do contrato que não mapeiam 1-pra-1 (custo por token em USD, sub-agentes streamados, system prompt verdadeiramente arbitrário sem guardrails, native shim libhuu_bind.so) são tratados na seção F com workarounds explícitos.

---

## A. Mecanismos de controle programático do Copilot CLI

A tabela abaixo é a referência rápida. As subseções A.1–A.10 detalham cada uma com código TypeScript, links e maturidade.

| # | Mecanismo | Maturidade | Streaming granular | Headless/Docker | Adequado p/ `huu`? |
|---|-----------|------------|-----------|-----------|---------|
| A.1 | `@github/copilot-sdk` (JSON-RPC) | **Public Preview oficial, v0.2.2 abr/2026** | ✅ todos os eventos | ✅ (Node 18+) | **SIM, principal** |
| A.2 | `copilot --acp --stdio` (Agent Client Protocol) | Public Preview oficial, jan/2026 | ✅ via `sessionUpdate` | ✅ | Alternativa cross-language |
| A.3 | `copilot -p "..." --output-format=json` (prompt mode + JSONL) | GA desde 1.0 (fev/2026) | Parcial (sem streaming de sub-agente) | ✅ | Fallback / smoke tests |
| A.4 | PTY/`node-pty` + parsing ANSI da TUI | Hack | Parcial | ⚠️ frágil | **Não recomendado** |
| A.5 | `child_process.spawn` da TUI interativa sem `-p` | Hack | ❌ | ❌ trava sem TTY | **Não recomendado** |
| A.6 | MCP Server (servir/conectar) | GA | N/A — invertido (Copilot é cliente MCP, não servidor) | ✅ | Tangencial |
| A.7 | Direct API (`api.githubcopilot.com`) — `ericc-ch/copilot-api` | OSS / não oficial | ✅ (chat completions) | ✅ | Alternativa BYOK |
| A.8 | `gh copilot suggest`/`explain` (extensão antiga do `gh`) | Legacy / não-agentico | ❌ | ❌ exige OAuth interativo | **Não usar** — produto diferente |
| A.9 | `--reasoning-effort low\|medium\|high\|xhigh` | GA desde 1.0.11 | N/A (flag) | ✅ | Mapeia thinking levels |
| A.10 | Hooks (`.github/hooks/*.json` + `permissionRequest`) | GA | Eventos de lifecycle locais | ✅ | Auxiliar (logging/preflight) |

### A.1 SDK oficial `@github/copilot-sdk` (recomendado)

Lançado em preview público em 2026 (anúncio “Build an agent into any app with the GitHub Copilot SDK” no GitHub Blog). É um pacote multi-linguagem (`@github/copilot-sdk` no npm, `github-copilot-sdk` no PyPI, `GitHub.Copilot.SDK` no NuGet, `github.com/github/copilot-sdk/go`). Para Node.js a CLI é **bundlada** automaticamente — não precisa instalar `@github/copilot` separadamente, embora `cliPath`/`cliUrl` permitam apontar para um binário externo ou um servidor já rodando.

**Arquitetura interna**: o SDK levanta um processo `copilot --headless [--port N]` por instância de `CopilotClient` e fala JSON-RPC com ele. As mensagens trafegam por stdio do processo filho ou por TCP quando você passa `cliUrl: "localhost:4321"`. Cada `session` é um logical channel multiplexado nesse RPC.

```ts
// adapter/copilot-sdk-agent.ts
import {
  CopilotClient,
  approveAll,
  defineTool,
  type SessionEvent,
  type CopilotSession,
} from "@github/copilot-sdk";
import { z } from "zod";

const client = new CopilotClient({
  // cliPath: "/usr/local/bin/copilot",      // override do binário bundled
  // cliUrl:  "localhost:4321",              // ou conectar em servidor externo
  // cliArgs: ["--allow-all-tools"],         // flags extras prepended
  autoStart: false,
});
await client.start();

const session = await client.createSession({
  sessionId: `huu-${runId}-agent-${idx}`,    // permite resume e dedupe
  model: "claude-sonnet-4.5",
  streaming: true,
  reasoningEffort: "high",                   // off/low/medium/high
  workspacePath: cwdWorktree,                // ★ direciona o cwd da sessão
  onPermissionRequest: approveAll,           // OBRIGATÓRIO
  systemMessage: {
    mode: "append",                          // preserva guardrails do CLI
    content: cardSystemHeader,               // seu systemHeader do huu
  },
  tools: [
    defineTool("huu_emit", {
      description: "Internal hook used by huu to mark progress",
      parameters: z.object({ tag: z.string(), payload: z.any() }),
      handler: async ({ tag, payload }) => ({ ok: true, tag, payload }),
    }),
  ],
});

session.on((ev: SessionEvent) => translateAndDispatch(ev));   // pipe p/ AgentEvent
await session.send({ prompt: cardUserPrompt });               // = pi.prompt(...)
```

`session.on` aceita o overload polimórfico:
- `session.on((e) => …)` — todos os tipos
- `session.on("assistant.message_delta", (e) => process.stdout.write(e.data.deltaContent))`
- `session.on("session.idle", () => done())`

A discriminated union faz inferência automática do shape de `e.data` para cada `e.type` (extremamente importante para o seu mapping para `AgentEvent`).

**Lista completa de eventos** (referência oficial em `docs.github.com/.../streaming-events`):

| Categoria | Tipo | Ephemeral? | Campos chave |
|-----------|------|-----------|--------------|
| Assistente | `assistant.turn_start` | não | `turnId`, `interactionId` |
|  | `assistant.intent` | sim | `intent` |
|  | `assistant.reasoning_delta` | sim | `reasoningId`, `deltaContent` |
|  | `assistant.reasoning` | não | `reasoningId`, `content` |
|  | `assistant.message_delta` | sim | `messageId`, `deltaContent`, `parentToolCallId` |
|  | `assistant.message` | não | `messageId`, `content`, `toolRequests[]`, `outputTokens`, `phase` |
|  | `assistant.turn_end` | não | `turnId` |
|  | `assistant.usage` | sim | `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `cost`, `duration`, `quotaSnapshots` |
|  | `assistant.streaming_delta` | sim | `totalResponseSizeBytes` |
| Tools | `tool.execution_start` | não | `toolCallId`, `toolName`, `arguments`, `mcpServerName` |
|  | `tool.execution_partial_result` | sim | `toolCallId`, `partialOutput` |
|  | `tool.execution_progress` | sim | `toolCallId`, `progressMessage` |
|  | `tool.execution_complete` | não | `toolCallId`, `success`, `result.content`, `result.detailedContent`, `error` |
|  | `tool.user_requested` | não | `toolCallId`, `toolName` |
| Sessão | `session.idle` | sim | `backgroundTasks` |
|  | `session.error` | não | `errorType`, `message`, `statusCode`, `providerCallId` |
|  | `session.context_changed` | não | `cwd`, `gitRoot`, `repository`, `branch` |
|  | `session.usage_info` | sim | `tokenLimit`, `currentTokens`, `messagesLength` |
|  | `session.task_complete` | não | `summary` |
|  | `session.shutdown` | não | `shutdownType: "routine"\|"error"`, `errorReason`, `totalPremiumRequests`, `totalApiDurationMs`, `codeChanges{linesAdded,linesRemoved,filesModified}`, `modelMetrics{...}` |
|  | `session.compaction_start/complete` | não | `success`, `tokensRemoved`, `summaryContent`, `checkpointPath` |
| Permissões | `permission.requested` | sim | `requestId`, `permissionRequest{ kind: shell\|write\|read\|mcp\|url\|memory\|custom-tool, ... }` |
|  | `permission.completed` | sim | `requestId`, `result.kind` |
| Sub-agente | `subagent.started/completed/failed/selected/deselected` | não | `toolCallId`, `agentName`, `agentDisplayName`, `tools` |
| Skill | `skill.invoked` | não | `name`, `path`, `content`, `allowedTools` |
| Controle | `abort` | não | `reason` |
| User/System | `user.message`, `system.message` | não | `content`, `role`, `attachments`, `agentMode` |

**Maturidade**: Public Preview (v0.2.2 em 2026‑04‑10, ~38 releases). Breaking changes existem entre versões — por exemplo o tipo de `event.data` no Go SDK virou union (issue tracking) e o nome `local`/`remote` de MCP virou `stdio`/`http`. O time mantém um arquivo `sdk-protocol-version.json` para sincronização CLI↔SDK.

**Prós**: cobre 100 % do contrato `pi`; tipado em TS (discriminated unions); permite tools customizadas em-process (sem subir MCP server); `systemMessage` com `mode: "customize"` permite remover seções como `safety` ou `tool_instructions`; suporta multi-sessão na mesma `CopilotClient`; `cliUrl` desacopla do ciclo de vida do processo.

**Contras**: ainda em preview (mudanças de wire); `resumeSession()` tem bug aberto (issue 540) — sessões retomadas disparam `session.idle` mas não emitem novos `message_delta`; eventos de sub-agente do `/fleet` não streamam progressivamente (issue 2265); `session.shutdown` colapsa razões em `routine`/`error` perdendo a granularidade `complete`/`abort`/`timeout`/`user_exit` que o runtime tem internamente (issue 2852).

### A.2 Agent Client Protocol (`copilot --acp`)

Anunciado no Changelog do GitHub em 2026‑01‑28 ("ACP support in Copilot CLI is now in public preview"). É um padrão aberto vindo do Zed (zed-industries/agent-client-protocol). Roda como NDJSON sobre stdio (`copilot --acp --stdio`) ou TCP (`copilot --acp --port 8080`). O cliente registra `requestPermission` e `sessionUpdate` callbacks.

```ts
import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

const proc = spawn("copilot", ["--acp", "--stdio"], { stdio: ["pipe","pipe","inherit"] });
const stream = acp.ndJsonStream(
  Writable.toWeb(proc.stdin!),
  Readable.toWeb(proc.stdout!),
);
const conn = new acp.ClientSideConnection(() => ({
  requestPermission: async () => ({ outcome: { outcome: "allowed" } }),
  sessionUpdate: async ({ update }) => {
    if (update.sessionUpdate === "agent_message_chunk")
      process.stdout.write(update.content.text);
  },
}), stream);
await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION });
```

**Por que considerar**: padronizado, mesmo cliente serve para Claude Code, Codex, Gemini, OpenClaw etc.; bom se o `huu` quiser mais tarde plugar Claude/Gemini sem reescrever. **Contras**: granularidade menor que JSON-RPC do SDK; modos como `--yolo` *não* funcionam por ACP (community discussion 185860); `configOptions` de modelo só agora têm metadata. Se você só quer Copilot, prefira A.1.

### A.3 Prompt mode + `--output-format=json` (JSONL)

Adicionado na 1.0.10 (changelog 2026‑03‑20). É o caminho clássico de "rodar como subcomando, parsear stdout".

```bash
copilot -p "$(cat prompt.md)" \
  --output-format=json \
  --silent \
  --allow-all-tools \
  --model claude-sonnet-4.5 \
  --reasoning-effort high \
  --no-ask-user
```

Saída é uma sequência NDJSON com objetos análogos aos eventos do SDK. Cada linha é um event-envelope. **Limitação relevante**: o flag `-p` não muda cwd — issue 457 abriu o request, ainda sem implementação. Você precisa `cd` ou usar `child_process.spawn(..., { cwd })`. E em prompt mode `repo hooks` e `workspace MCP` ficam atrás de `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=1` e `GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP=1` (release 1.0.40‑0 — secure-by-default).

```ts
import { spawn } from "node:child_process";
import readline from "node:readline";

const child = spawn("copilot", [
  "-p", `${systemHeader}\n\n${userPrompt}`,
  "--output-format=json", "--silent",
  "--allow-all-tools", "--no-ask-user",
  "--model", "claude-sonnet-4.5",
  "--reasoning-effort", thinkingLevel,
], {
  cwd: worktreePath,
  env: {
    ...process.env,
    NO_COLOR: "1",
    COPILOT_GITHUB_TOKEN: token,
    COPILOT_HOME: `${process.cwd()}/.huu/copilot-state`, // isola SQLite
    GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "1",
  },
});
const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  const ev = JSON.parse(line);              // mesmo envelope { id, type, data }
  dispatchAgentEvent(translate(ev));
});
child.on("exit", (code, sig) => onTerminated({ code, sig }));
```

Implementação OSS de referência: o adapter `copilot_local` proposto em `paperclipai/paperclip` issue 2092 (`feat: Add GitHub Copilot CLI adapter`) e o setup `copilot_here` (gordonbeeming/copilot_here). O time do `gh-aw` da própria GitHub usa esse modo em produção via `--no-ask-user` com pin de versão `CopilotNoAskUserMinVersion >= 1.0.19`.

**Quando usar**: smoke tests de CI, escudo se o JSON-RPC do SDK for versionado quebrado, cargas onde latência de cold-start não importa.

### A.4 PTY / `node-pty`

Possível, mas a TUI flicker (cli/cli issue 12747) e usa Ink internamente. O texto é repintado constantemente, e o que sai inclui ANSI rich (boxes, mascote, frames). Construir parser sobre isso é frágil e **explicitamente não recomendado** quando A.1 e A.3 existem.

### A.5 `child_process.spawn` da TUI sem `-p`

Trava esperando TTY. Sem TTY, abre `inquirer`-like prompts em loop infinito. Não usar.

### A.6 MCP

`copilot` é **cliente** MCP, não servidor. Você configura servidores em `~/.copilot/mcp-config.json` ou `--additional-mcp-config @file.json`. Não há um “Copilot MCP endpoint” a ser consumido externamente. Isso só ajuda o `huu` se você quiser **expor utilidades do `huu` para o Copilot** (e.g. um MCP server que reporta status de outros agentes paralelos).

### A.7 Direct API + community wrappers

`ericc-ch/copilot-api` faz tunneling do token de Copilot subscription como API OpenAI/Anthropic-compatible em `localhost:4141`. Você poderia, em teoria, plugar isso como `COPILOT_PROVIDER_BASE_URL` (BYOK) — efetivamente fechando um loop. Existe também `copilot-cli-go` e `OpenCode`/`opencode.ai` que tem "GitHub Copilot" como provider. **Não oficial e sujeito a TOS**: GitHub bloqueia certos padrões de uso programático fora dos produtos Copilot.

### A.8 `gh copilot` (extensão antiga)

A extensão `github/gh-copilot` em cima do GitHub CLI **só implementa `suggest` e `explain`** — não tem agente, não tem `prompt mode`, não tem JSON output, não tem MCP, não tem custom tools. Authentication ainda exige OAuth via `gh auth login` no flow web — não funciona com PAT (community discussion 167158). Em abril/2026 essa extensão é tratada como “produto separado” e não-agentico. **Não use para o `huu`.**

### A.9 Reasoning effort

`--reasoning-effort low|medium|high|xhigh` (1.0.11) ou `reasoningEffort: "high"` em `createSession` é exatamente o que o `pi-coding-agent` chama de `thinkingLevel`. Mapeamento direto:

```ts
const thinkingLevelToEffort = {
  off: "low",
  low: "low",
  medium: "medium",
  high: "high",
} as const;
```

`xhigh` só existe no Copilot e o SDK aceita `"high"` para a maioria dos casos.

### A.10 Hooks

`.github/hooks/*.json` (no repo) ou per-session via SDK config permite executar shell/HTTP/prompt em `sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `sessionEnd`, `notification`, `permissionRequest`. Útil para o `huu` plugar:

- `sessionStart` → escrever sentinel `/tmp/huu/active`
- `postToolUse` → flush para `RunLogger`
- `permissionRequest` → sempre `allow` em modo headless (substitui o `approveAll`)

```jsonc
// .huu-cache/hooks.json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "type": "command", "bash": "huu hook session-start" }],
    "postToolUse":  [{ "type": "command", "bash": "huu hook tool-result" }],
    "permissionRequest": [{
      "type": "command",
      "bash": "echo '{\"behavior\":\"allow\"}'"
    }]
  }
}
```

---

## B. Mapeamento um-pra-um dos 25 pontos do contrato `huu`

Premissa: **mecanismo principal = `@github/copilot-sdk` (A.1)**; fallback = prompt mode JSONL (A.3).

### B.1 Spawn programático de sessão
```ts
const session = await client.createSession({
  sessionId: `huu-${runId}-agent-${idx}`,
  model, streaming: true, reasoningEffort,
  workspacePath: worktreeCwd,           // = cwd
  onPermissionRequest: approveAll,
  systemMessage: { mode: "append", content: systemHeader },
});
// session expõe send/sendAndWait/on/abort/disconnect/getMessages/workspacePath
```
**Substitui**: `createAgentSession({ model, thinkingLevel, sessionManager, authStorage, modelRegistry, cwd })`.

### B.2 System prompt + user prompt customizado
- **System** vai em `systemMessage` (modos `append`/`replace`/`customize`).
- **User** vai em `session.send({ prompt })`.
- Para **prompts realmente bem isolados** (estilo XML do *integration agent*), use `mode: "replace"` para apagar a persona Copilot:
```ts
systemMessage: { mode: "replace", content: integrationAgentPromptXml }
```
- Para customizar seções específicas sem perder guardrails:
```ts
systemMessage: {
  mode: "customize",
  sections: {
    code_change_rules: { action: "remove" },
    guidelines:        { action: "append", content: "* Use huu_emit() para sinais" },
    safety:            { action: "replace", content: "Worktree é isolado." }
  },
  content: cardSystemHeader,
}
```
Se quiser concatenar como o `pi` faz, basta `prompt = systemHeader + "\n\n" + userPrompt`. Não é tão limpo, mas funciona em prompt-mode também.

### B.3 Stream de eventos → `AgentEvent`
Tabela de tradução:

| `pi` (`AgentEvent`) | Copilot SDK |
|---|---|
| `assistant_message` | `assistant.message` (`event.data.content`) |
| `thinking` | `assistant.reasoning` ou `assistant.reasoning_delta` |
| `tool_use(read)` | `tool.execution_start` com `toolName ∈ {view, read_file, view_directory}` |
| `tool_use(edit)` | `tool.execution_start` com `toolName ∈ {edit_file, str_replace}` |
| `tool_use(write)` | `tool.execution_start` com `toolName === "write"` |
| `tool_use(create)` | `tool.execution_start` com `toolName === "create_file"` |
| `tool_use(patch)` | `tool.execution_start` com `toolName === "apply_patch"` |
| `tool_use(bash)` | `tool.execution_start` com `toolName === "bash"` |
| `tool_result` | `tool.execution_complete` (`success`, `result.content`, `error`) |
| `token_usage` | `assistant.usage` (`inputTokens`, `outputTokens`, `cost`) |
| `error` | `session.error` |
| `done` | `session.idle` (turn fim, ainda vivo) ou `session.shutdown` (real fim) |

Mapeador esqueleto:
```ts
function translate(ev: SessionEvent): AgentEvent | null {
  switch (ev.type) {
    case "assistant.message":          return { kind: "assistant_message", text: ev.data.content };
    case "assistant.reasoning":        return { kind: "thinking", text: ev.data.content };
    case "tool.execution_start":       return { kind: "tool_use", tool: classify(ev.data.toolName), args: ev.data.arguments, id: ev.data.toolCallId };
    case "tool.execution_complete":    return { kind: "tool_result", id: ev.data.toolCallId, ok: ev.data.success, content: ev.data.result?.content, error: ev.data.error?.message };
    case "assistant.usage":            return { kind: "token_usage", inTok: ev.data.inputTokens ?? 0, outTok: ev.data.outputTokens ?? 0, cost: ev.data.cost ?? 0 };
    case "session.error":              return { kind: "error", text: ev.data.message, code: ev.data.statusCode };
    case "session.idle":               return { kind: "turn_end" };           // pi.done = só no shutdown
    case "session.shutdown":           return { kind: "done", reason: ev.data.shutdownType, codeChanges: ev.data.codeChanges, totalPremiumRequests: ev.data.totalPremiumRequests };
    default:                           return null;
  }
}
const WRITE_TOOLS = new Set(["edit","write","create","patch","edit_file","str_replace","create_file","write_file","apply_patch"]);
function classify(name: string): "read"|"edit"|"write"|"create"|"patch"|"bash"|"other" {
  if (name === "bash" || name === "shell") return "bash";
  if (/^(view|read_file|view_directory|grep|glob)$/.test(name)) return "read";
  if (/^(edit|edit_file|str_replace)$/.test(name)) return "edit";
  if (/^(write|write_file)$/.test(name)) return "write";
  if (/^(create|create_file)$/.test(name)) return "create";
  if (/^(patch|apply_patch)$/.test(name)) return "patch";
  return "other";
}
```

> **Nota importante**: o nome interno das tools muda entre versões. O CLI 1.0+ padroniza camelCase em config, mas tool names ainda variam (`read_file` vs `view`). Mantenha `WRITE_TOOLS` como `Set` configurável e teste contra o changelog de cada release minor.

### B.4 Captura de logs em 5 caminhos paralelos
- **RunLogger** (`.huu/<stamp>-execution-<runId>.log`): subscreva todos os eventos com um único `session.on(ev => runLogger.write(JSON.stringify(ev)))`.
- **DebugLogger NDJSON heartbeat**: emita uma linha a cada `session.usage_info` (recebido a cada turno) ou via timer com `session.getMessages()` snapshot.
- **OrchestratorState.logs (cap 1000)**: ring-buffer no Orchestrator do `huu`, alimentado pelo mapper.
- **Sentinel `/tmp/huu/active`**: escreva no `sessionStart` hook (mecanismo A.10) ou imediatamente após `createSession` resolver.
- **Ink dashboard**: continua igual; debounce de eventos ainda controlado pelo `huu` (8 Hz, B.25).

Adicionalmente, o próprio Copilot CLI já persiste tudo em `~/.copilot/session-state/<sessionId>/events.jsonl` + `session-store.db` (SQLite com FTS5, descoberta por jonmagic.com). **Sugestão**: aponte `COPILOT_HOME=$PWD/.huu/copilot-state` para isolar o estado dentro do projeto e facilitar limpeza.

### B.5 Detecção de término
| Sinal `huu` | Como detectar |
|---|---|
| `done` event | `session.shutdown` (com `shutdownType`) **ou** `session.idle` se considerar “turno fim” como done |
| `error` event | `session.error` |
| Processo morto | `client.processExited` callback (SDK emite) ou `child.on("exit")` no prompt mode |
| Timeout (`cardTimeoutMs=600s`) | `setTimeout(() => session.abort(), 600_000)` + cleanup |

⚠️ **Issue 2852**: `session.shutdown.shutdownType` colapsa `complete`/`abort`/`timeout`/`user_exit` em `"routine"`. Para diferenciar, **rastreie você mesmo** se um `abort()` foi chamado ou se o timeout disparou primeiro:

```ts
class TerminationTracker {
  private reason: "complete"|"abort"|"timeout"|"error"|null = null;
  markAbort()   { this.reason ??= "abort"; }
  markTimeout() { this.reason ??= "timeout"; }
  markError(e: Error)  { this.reason ??= "error"; }
  finalize(shutdownEv: any) {
    return this.reason ?? (shutdownEv.shutdownType === "error" ? "error" : "complete");
  }
}
```

### B.6 Worktree git isolado por agente
Continua sendo responsabilidade do `huu` — Copilot CLI **não cria worktree**. O VS Code wrapper cria, mas é feature do VS Code, não da CLI standalone. Você passa o worktree existente em `workspacePath`/`cwd`:

```ts
// no Orchestrator
await execFile("git", ["worktree","add","--detach", wt, branchName], { cwd: repoRoot });
const session = await client.createSession({
  sessionId: `huu-${runId}-agent-${idx}`,
  workspacePath: wt,
  // ...
});
```

⚠️ **Armadilha real (issue copilot-cli/1725)**: `git stash` é global ao repositório (`refs/stash`), não ao worktree. Se Copilot decidir fazer `git stash` em dois agentes paralelos, eles vão pisar nos *stashes* um do outro. **Workaround**: instrua via `systemMessage` (`mode: "customize"`, secção `code_change_rules`) algo como “Never use `git stash`. Use `git commit --no-verify` to a temporary branch instead.” E adicione `--deny-tool="shell(git stash:*)"` se tiver permissões via flag.

### B.7 Integration agent (merge resolver, `agentId=9999`)
Funciona via uma `createSession` separada com:
```ts
const integration = await client.createSession({
  sessionId: `huu-${runId}-integration-9999`,
  workspacePath: integrationWorktree,
  systemMessage: { mode: "replace", content: integrationXmlPrompt },
  reasoningEffort: "high",
  model: "claude-opus-4.7",          // ou outro de capacidade alta
  onPermissionRequest: approveAll,
});
```
Use `mode: "replace"` para o prompt XML ficar puro sem prefixo da persona Copilot. Submeta os conflitos em `prompt`. Iterar stage-by-stage com `session.send({...mode:"enqueue"})`.

### B.8 Port allocator + `.env.huu` + `libhuu_bind.so/dylib`
**Permanece 100 % do lado do `huu`.** Copilot CLI não tem nada a ver com bind de sockets — o que rodar dentro do agente herda o env do processo pai. Ou seja, `LD_PRELOAD=libhuu_bind.so HUU_BIND_PORT_RANGE=10500-10519 copilot --headless` continua valendo. O SDK também: passe `cliArgs: []` e injete `env` no spawn:

```ts
const client = new CopilotClient({
  cliArgs: [],
  env: {
    ...process.env,
    LD_PRELOAD: process.env.HUU_NO_DOCKER === "1" ? "" : "/.huu-bin/libhuu_bind.so",
    HUU_BIND_PORT_RANGE: `${portStart}-${portEnd}`,
  },
});
```
> Atenção: o option `env` não está nos docs públicos do `@github/copilot-sdk` (a doc cita `cliPath`, `cliArgs`, `cliUrl`, `autoStart`, `telemetry`). Se não existir, faça `cliPath: "./scripts/copilot-with-shim.sh"` que é um wrapper bash que injeta `LD_PRELOAD` antes do binário real. Reportar como feature request.

### B.9 Stub mode
Trivial — implementa a mesma interface `SpawnedAgent`:
```ts
class StubCopilotAgent implements SpawnedAgent {
  async send({ prompt }: { prompt: string }) {
    await fs.writeFile(`${this.cwd}/STUB_${Date.now()}.md`, prompt);
    queueMicrotask(() => this.dispatch({ kind: "assistant_message", text: "stub ok" }));
    queueMicrotask(() => this.dispatch({ kind: "done", reason: "complete" }));
  }
  /* on, abort, dispose idempotente */
}
```
A `AgentFactory` retorna `StubCopilotAgent` quando `process.env.HUU_STUB === "1"` ou via flag `--stub`.

### B.10 Token tracking & cost
**Mudança conceitual importante**: Copilot é **subscription-based com premium request multipliers**, não por token. Ainda assim, `assistant.usage` traz `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `cost` (multiplicador do modelo, não USD), e `quotaSnapshots`. `session.shutdown` traz `totalPremiumRequests`.

Para preencher `AgentStatus.tokens`:
```ts
session.on("assistant.usage", (ev) => {
  status.tokensIn  += ev.data.inputTokens  ?? 0;
  status.tokensOut += ev.data.outputTokens ?? 0;
  status.premiumRequestsEstimate += ev.data.cost ?? 0;  // = N x multiplier
});
session.on("session.shutdown", (ev) => {
  status.premiumRequestsTotal = ev.data.totalPremiumRequests;
  status.codeChanges = ev.data.codeChanges; // {linesAdded, linesRemoved, filesModified}
});
```
Não há `$X` em USD por turno — é por **premium request consumido**, e o preço de premium request varia por plano (Pro $10/mês com 300, Pro+ ~5x mais, overage $0.04/req conforme docs). Para reportar custo equivalente do log line `tokens +Nin +Mout $X`, **substitua $X por “N PR (~$Y at plan rate)”** ou pegue `cost` direto. Issue 1152 (More Verbose Token Information) ainda está aberto pedindo cache_read/cache_write breakdown — **eles já existem em `assistant.usage` do SDK**, só não no comando `/usage` da TUI.

### B.11 Abort/SIGINT/SIGTERM
```ts
session.on("abort", (ev) => log("abort:", ev.data.reason));
process.on("SIGINT", async () => {
  await session.abort();             // injeta abort event
  await session.disconnect();        // libera RPC
  await client.stop();               // mata o processo copilot
  process.exit(130);
});
```
- `session.abort()` é idempotente e cancela o turno em curso.
- `session.disconnect()` libera memória, **mantém** state em disco (~/.copilot/session-state/<id>/).
- `client.deleteSession(id)` remove tudo de disco.
- `client.forceStop()` para quando `stop()` não responde a tempo.

Padrão para “prompt() não reusável após dispose”:
```ts
class CopilotAgent {
  #disposed = false;
  async prompt(p: string) { if (this.#disposed) throw new Error("disposed"); /* … */ }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    try { await session.abort(); } catch {}
    await session.disconnect();
  }
}
```

### B.12 Preflight validations
Permanece no `huu`. Adicione checagens específicas Copilot:
```ts
async function preflightCopilot() {
  const v = await execFile("copilot", ["--version"]);
  if (semverLt(parseVersion(v), "1.0.19")) throw new Error("--no-ask-user requires 1.0.19+");
  if (!process.env.COPILOT_GITHUB_TOKEN && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    if (!process.env.COPILOT_PROVIDER_API_KEY) throw new Error("Need token or BYOK");
  }
  // checa quota
  const q = await execFile("copilot", ["--check-usage"]).catch(()=>null);
  if (q && /weekly limit/i.test(q.stdout)) warn("near weekly limit");
}
```

### B.13 Pipeline JSON (Zod schema)
Inalterado. O contrato é interno ao `huu`. O backend do agente só consome `step.prompt` + `step.files` por card.

### B.14 Refiner (LangChain.js)
Inalterado — o refiner não é um agente Pi/Copilot, é um chain LangChain separado. Pode opcionalmente apontar para `api.githubcopilot.com` via `copilot-api` (A.7) se quiser unificar billing.

### B.15 `huu status`
Inalterado. Continua lendo `.huu/debug-*.log`. Adicione:
```ts
// huu status --liveness
const sessionStateDir = path.join(process.env.COPILOT_HOME ?? `${homedir()}/.copilot`, "session-state");
const dirs = await fs.readdir(sessionStateDir).catch(()=>[]);
const alive = dirs.filter(d => d.startsWith(`huu-${runId}-`));
return { alive: alive.length, sessions: alive };
```
Ou consulte `~/.copilot/session-store.db` (SQLite) — ele tem FTS5 e summaries automáticos.

### B.16 `huu prune`
Inalterado para Docker. Adicione `copilot prune-sessions`:
```ts
for (const dir of await fs.readdir(sessionStateDir)) {
  if (dir.startsWith(`huu-${runIdToDelete}-`)) {
    await fs.rm(path.join(sessionStateDir, dir), { recursive: true });
  }
}
// Equivalente ao session.deleteSession via SDK, sem precisar subir client.
```

### B.17 Tools de write detection
Já tratado em B.3. A diferença é que **MCP tools custom** também aparecem com `mcpServerName` e `mcpToolName` — você pode mapear `mcp:filesystem:write_file` para `write` se relevante:

```ts
const isWrite = ev.data.mcpToolName
  ? WRITE_TOOLS.has(ev.data.mcpToolName)
  : WRITE_TOOLS.has(ev.data.toolName);
```

### B.18 Concurrency
SDK suporta múltiplas sessões na mesma `CopilotClient` (docs/scaling.md). Estratégia recomendada para ≤20 agentes paralelos:

- **Pool single-CLI multi-session** (1 processo `copilot --headless`, N sessões): mais leve, suficiente até ~10–15 sessões;
- **Pool 1 CLI por agente** (N processos): isolamento total, recomendado quando você usa `LD_PRELOAD` por agente, env vars distintos, ou worktree com BYOK distinto.

Para o `huu` rodando native shim por porta, o **modo 1 CLI por agente** é o correto:

```ts
class CLIPool {
  private clients = new Map<string, CopilotClient>();
  async forAgent(agentId: number, env: NodeJS.ProcessEnv): Promise<CopilotClient> {
    if (this.clients.has(`a${agentId}`)) return this.clients.get(`a${agentId}`)!;
    const port = 4321 + agentId;
    const c = new CopilotClient({
      cliPath: `${process.cwd()}/.huu-bin/copilot-with-shim.sh`,
      cliArgs: ["--headless", "--port", String(port)],
      cliUrl: `localhost:${port}`,
    });
    await c.start();
    this.clients.set(`a${agentId}`, c);
    return c;
  }
  async destroyAll() { for (const c of this.clients.values()) await c.stop(); }
}
```

⚠️ **Limite real**: o time GitHub não publica MAX_INSTANCES. Há issues abertas (2132) sobre crash/OOM em sessões longas com sub-agentes paralelos. Mantenha `MAX_INSTANCES=20` mas inclua circuit-breaker em `session.error` com `errorType="rate_limit"` ou `"quota"`.

### B.19 Thinking levels
`reasoningEffort: "low"|"medium"|"high"` em createSession, ou `--reasoning-effort` no CLI. Mapeamento na A.9.

### B.20 AuthStorage + ModelRegistry + OPENROUTER_API_KEY / Docker secret
**Resolução de credentials** continua sua. O Copilot CLI apenas lê env vars na ordem `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`, ou usa OAuth do `gh`/keychain. Para Docker secrets:

```ts
async function resolveCopilotCreds(): Promise<{ env: NodeJS.ProcessEnv }> {
  // 1. Docker secret
  const sec = "/run/secrets/copilot_token";
  if (existsSync(sec))            return { env: { COPILOT_GITHUB_TOKEN: (await fs.readFile(sec, "utf8")).trim() } };
  // 2. Arquivo
  const f = path.join(homedir(), ".huu", "copilot.token");
  if (existsSync(f))              return { env: { COPILOT_GITHUB_TOKEN: (await fs.readFile(f, "utf8")).trim() } };
  // 3. ENV
  if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN) return { env: process.env };
  // 4. BYOK (OpenRouter como provider OpenAI-compatible)
  if (process.env.OPENROUTER_API_KEY) return { env: {
    COPILOT_PROVIDER_BASE_URL: "https://openrouter.ai/api/v1",
    COPILOT_PROVIDER_API_KEY:  process.env.OPENROUTER_API_KEY,
    COPILOT_PROVIDER_TYPE:     "openai",
    COPILOT_MODEL:             process.env.HUU_MODEL ?? "anthropic/claude-sonnet-4.5",
    COPILOT_PROVIDER_WIRE_API: "completions",
  }};
  throw new Error("No Copilot credentials");
}
```

⚠️ **Pegadinha**: o `gh copilot` *legacy* não aceita PAT (community 167158); o **standalone** `copilot` (que é o objeto da nossa pesquisa) **aceita** via env var. Não confunda.

⚠️ Para PATs via env var, é **fine-grained PAT (v2)** com permission **"Copilot Requests"**. Classic PATs (`ghp_*`) não funcionam.

⚠️ No **Pro plan post-abril/2026** novos signups estão pausados (changelog “Changes to GitHub Copilot Individual plans”). Empresas devem usar Business/Enterprise.

### B.21 Retry com branch suffix `-retry`
Inalterado. Pelo lado do Copilot SDK, basta:
```ts
const retrySession = await client.createSession({
  sessionId: `huu-${runId}-agent-${idx}-retry`,
  workspacePath: retryWorktree,
  // ...
});
```

### B.22 `ensureGitignored`
Adicione: `.copilot-state/`, `.huu/copilot-state/`. Se você definiu `COPILOT_HOME` no projeto (recomendado), ele vai aparecer no diretório.

### B.23 `HUU_NO_DOCKER=1`
Sem mudanças de design. O Copilot CLI roda nativo em macOS/Linux/Windows; no Docker é só base `node:22-slim` ou `node:22-alpine` + `npm i -g @github/copilot`. Standalone executables existem (download direto do release), úteis se você quer eliminar Node do container — embora a issue copilot-cli/55 mostre que ainda **não há imagem oficial Docker** (apr/2026). Há community: `gordonbeeming/copilot_here`, Docker Sandbox suporta Copilot CLI nativamente (docker.com/ai/sandboxes/agents/copilot/). Em Alpine, certifique-se de instalar `libstdc++` e `gcompat` — node-sqlite (usado pelo SDK) precisa.

### B.24 Test stub agent
Idêntico a B.9. Para CI sem queimar tokens use `BYOK` com Ollama local:
```bash
export COPILOT_PROVIDER_BASE_URL=http://localhost:11434/v1
export COPILOT_MODEL=qwen3.5
export COPILOT_PROVIDER_WIRE_API=responses
export COPILOT_OFFLINE=true
```

### B.25 Throttling de eventos para UI (8 Hz)
Sem mudança. `STATE_FLUSH_INTERVAL_MS = 125ms` continua no Orchestrator. A taxa de `assistant.message_delta` do Copilot é alta (chunks de 5-30 chars), então o debounce é essencial.

```ts
const flushDebounced = debounce(() => ink.render(<Dashboard state={state} />), 125, { leading: true, trailing: true });
session.on(() => flushDebounced());
```

---

## C. Restrições e limitações conhecidas

### C.1 Auth
- **OAuth device flow** (interativo, exige browser) é o default.
- **Env vars headless**: `COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN`. Aceita fine-grained PAT v2 com **"Copilot Requests"**, OAuth tokens do Copilot CLI app, OAuth do gh CLI app. **Não aceita** classic PAT `ghp_*`.
- **Token storage**: OS keychain (libsecret/Keychain.app/Wincred). Em Linux headless sem libsecret, fallback para `~/.copilot/settings.json` em plain text (warning).
- Em **Docker headless**: pré-popule `~/.copilot/settings.json` ou monte o token via env var. Docker Sandbox exige re-login interativo (não puxa do host).
- **Enterprise**: `COPILOT_GH_HOST` override de `GH_HOST`.
- **Business/Enterprise** funciona normalmente; admin precisa habilitar Copilot CLI a nível de org.
- **Free tier** do Copilot suporta CLI mas com quota baixíssima.

### C.2 Rate limits
- **Premium request quota** mensal: Pro 300/mo, Pro+ 1500+/mo, Business e Enterprise por seat. Pricing $0.04/PR overage.
- **Multipliers por modelo**: Haiku 4.5 = 0.33×, Sonnet 4.6 = 1×, Opus 4.6 = 3×. GPT-4.1/GPT-4o/GPT-5-mini = 0× (incluídos sem quota).
- **Session limits** (curto prazo) e **weekly limits** (7 dias) — disparam erros `errorType="rate_limit"`. CLI 1.0.34 mudou mensagem para `"session rate limit"` vs `"global rate limit"`.
- **GHE Cloud com data residency / FedRAMP**: +10 % multiplier.
- **Auto model selection**: 10 % discount no multiplier no VS Code (provavelmente também no CLI).
- A partir de **2026-06-01**, GitHub vai migrar para *usage-based billing* (GitHub AI Credits) — verifique antes de produção.

### C.3 Modelos disponíveis
Em abril/2026 o `--model` aceita: `claude-sonnet-4.5` (default), `claude-sonnet-4.6`, `claude-opus-4.5`, `claude-opus-4.6`, `claude-opus-4.7`, `claude-haiku-4.5`, `gpt-5`, `gpt-5.2-codex`, `gpt-5.3-codex`, `gpt-5.5`, `gemini-3-pro`, etc. Lista evolui semanalmente. `client.listModels()` retorna o array atualizado em runtime. `--model auto` para Auto Model Selection.

### C.4 TTY requirements
- **Modo interativo** (`copilot` puro): exige TTY.
- **Modo prompt** (`copilot -p`): **não exige TTY**. Funciona em pipes, Docker, CI.
- **Modo headless server** (`copilot --headless`): não exige TTY.
- **ACP** (`copilot --acp --stdio`): não exige TTY.
- Workarounds com `script -q`, `unbuffer`, `node-pty` **não são necessários** com -p ou --headless.

### C.5 Plataforma
Linux (x64, arm64), macOS (Intel, Apple Silicon), Windows. **Alpine** funciona com `gcompat` + `libstdc++`. Standalone executables compilados publicados nos releases com SHA256SUMS.

### C.6 Network endpoints
- `api.githubcopilot.com` (chat/agent endpoints)
- `api.github.com` (auth, MCP server interno)
- `npm.pkg.github.com` (auto-update, opt-out via `COPILOT_NO_AUTO_UPDATE`)
- BYOK: provider-defined.
- `COPILOT_OFFLINE=true` desativa todo network exceto BYOK provider local.
- Proxy: variáveis `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` honradas.

### C.7 Filesystem
- `~/.copilot/` ou `$COPILOT_HOME/`:
  - `settings.json` (user-level, modelos, themes, trusted folders)
  - `config.json` (internal state)
  - `mcp-config.json` (MCP servers)
  - `session-state/<sessionId>/{events.jsonl, workspace.yaml, checkpoints/*.json}`
  - `session-store.db` (SQLite + FTS5)
  - `agents/` (custom agents)
  - `skills/` (custom skills)
- `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` no repo.
- `.github/hooks/*.json` no repo.

### C.8 Telemetry
- `COPILOT_OTEL_ENABLED=true` (opt-in OpenTelemetry).
- `COPILOT_OTEL_FILE_EXPORTER_PATH=./traces.jsonl`.
- `OTEL_EXPORTER_OTLP_ENDPOINT=...`.
- Off por default, zero overhead.

### C.9 Concorrência / múltiplas sessões
- **Sem lock global** entre processos `copilot`.
- Múltiplas sessões na mesma `CopilotClient`: suportado (docs scaling.md).
- ⚠️ **Stash colision** entre worktrees (issue 1725).
- ⚠️ **Long sessions OOM** (issue 2132).
- ⚠️ **events.jsonl mutex** em sessions enormes (issue 2609).

### C.10 Versão / breaking changes
Cadência semanal de minor/patch. Histórico:
- 2025-09-25: Public Preview (`@github/copilot` 0.0.x)
- 2025-12: GPT-5.2 support (0.0.369), break: settings.json split do config.json
- 2026-01-29: `/allow-all` e `/yolo` slash commands (0.0.399)
- 2026-02-25: GA, salto para 1.0
- 2026-03-20: 1.0.10, `--effort/--reasoning-effort`, `COPILOT_OFFLINE`
- 2026-04-07: BYOK suportado oficialmente (1.0.21+)
- 2026-04-25: 1.0.36, sub-agentes via custom registry MCP allowlists
- 2026-04-28: 1.0.39, `/compact`/`/context`/`/usage`/`/env` slashes, ACP allow-all toggle
- 2026-04-29: 1.0.40-0 prerelease — **prompt-mode gate de hooks repo e MCP workspace** (`GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS`, `GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP`)

**Pin de versão**: `npm i -g @github/copilot@1.0.36` ou `VERSION=v0.0.369 ./install.sh`. Mantenha um `CopilotMinVersion` constant (espelhando o que `gh-aw` faz).

### C.11 `gh copilot` vs `copilot` standalone
`gh copilot suggest`/`explain` é a extensão antiga, baseada no GitHub CLI, **somente para sugestão de comando**, sem agente, sem -p, sem MCP. `@github/copilot` é o produto novo agentico, GA em fev/2026. **Use só o standalone.** Para sub-agente skills, `copilot agent`/`copilot skill` (sub-comandos do standalone) ou `gh ext install` *não* substituem.

### C.12 Imagens Docker
- **Não há imagem oficial** (issue 55 ainda aberta).
- Comunidade: `gordonbeeming/copilot_here`, Docker Sandbox.
- Receita base segura: `node:22-slim` + `npm i -g @github/copilot@<pinned>` + entrypoint que monta o token.

### C.13 Limites de contexto
Depende do modelo. Sonnet 4.5 = 200k. CLI mostra em `session.usage_info` (`tokenLimit`, `currentTokens`). Auto-compaction ativa em ~95 % do limit (configurável via `infiniteSessions.backgroundCompactionThreshold`).

### C.14 Suporte a tools/agentic loops
**Sim, total.** Tools first-party do Copilot CLI:
- `bash` / `shell` (executar comandos)
- `view` / `read_file` / `view_directory`
- `edit_file` / `str_replace`
- `create_file` / `write_file`
- `apply_patch`
- `grep` / `glob`
- `web_fetch`
- `delegate` (aciona Copilot cloud agent — só se autenticado no GitHub)
- LSP-backed tools quando `~/.copilot/lsp-config.json` configurado
- C++ code intelligence em preview (changelog)

Mais MCP servers configuráveis (GitHub MCP server padrão).

---

## D. Soluções OSS / comunidade que validam essa arquitetura

| Projeto | O que faz | Link |
|---------|-----------|------|
| `github/copilot-sdk` | SDK oficial; **fonte primária** | github.com/github/copilot-sdk |
| `github/copilot-cli` | CLI; mantenedor publica issues e changelog | github.com/github/copilot-cli |
| `github/copilot-cli-for-beginners` | Tutorial oficial com exemplos de fleet, agents, MCP | github.com/github/copilot-cli-for-beginners |
| `github/awesome-copilot` | Skills / agents / instructions community (templates) | github.com/github/awesome-copilot |
| `paperclipai/paperclip` issue 2092 | Template de adapter `copilot_local` para orquestrador genérico (3 layers: server/UI/CLI) — **referência de design para o `huu`** | github.com/paperclipai/paperclip/issues/2092 |
| `ericc-ch/copilot-api` | Tunnel do Copilot subscription como OpenAI/Anthropic API | github.com/ericc-ch/copilot-api |
| `jonmagic.com/posts/github-copilot-session-search-and-resume-cli` | Reverse-engineering da `session-store.db` (SQLite + FTS5) e `events.jsonl` | jonmagic.com |
| `htek.dev/articles/github-copilot-cli-extensions-complete-guide` | Sistema de extensões (`.github/extensions/`) que roda como child Node.js | htek.dev |
| `gordonbeeming/copilot_here` | Receita Docker para Copilot CLI sandbox | github.com/GordonBeeming/copilot_here |
| `agentpatterns.ai/tools/copilot/copilot-cli-byok-local-models` | Blog detalhado sobre BYOK env vars | agentpatterns.ai |
| `priyankavergadia.substack.com/p/github-copilot-cli-developer-cheatsheet` | Cheat sheet completa de flags | substack.com |
| `kenmuse.com/blog/workspace-vs-worktree-isolation-in-copilot-cli` | Análise de worktree no VS Code wrapper | kenmuse.com |
| `aws.github.io/copilot-cli` | **Não confundir** — produto AWS distinto | aws.github.io/copilot-cli (excluir das buscas) |
| Issues relevantes | 52 (JSON output), 55 (Docker), 222 (ACP), 457 (cwd flag), 540 (resumeSession bug), 1115/1127/555 (output verbosity), 1152 (token verbose), 1635 (cross-env resume), 1725 (stash collision), 1945 (theme), 2132 (OOM), 2209 (large session corruption), 2265 (fleet sub-agent streaming), 2609 (events.jsonl mutex), 2852 (shutdown reason loss) | github.com/github/copilot-cli/issues |
| Discussion 159876 (community) | Auth headless e workarounds | github.com/orgs/community/discussions/159876 |
| Discussion 167158 (community) | gh copilot extensão **não** aceita PAT | github.com/orgs/community/discussions/167158 |
| Discussion 177480 (community) | Output em batch mode | github.com/orgs/community/discussions/177480 |
| Discussion 185860 (community) | ACP em CLI, limitações de yolo | github.com/orgs/community/discussions/185860 |
| Microsoft Learn (Azure MCP, Copilot SDK) | Patterns de integração SDK | learn.microsoft.com |

**Não há solução validada conhecida** para:
- Streaming verdadeiramente granular do output de cada sub-agente do `/fleet` (issue 2265 aberta).
- Resume cross-host de sessões (issue 1635 aberta).
- Custo em USD por turno determinístico — só multiplier × premium request.

---

## E. Arquitetura recomendada para o adapter

### E.1 Camada de adapter (TS)

```ts
// huu/src/adapters/copilot/factory.ts
import {
  CopilotClient, approveAll, defineTool,
  type SessionEvent, type CopilotSession,
} from "@github/copilot-sdk";
import type { AgentFactory, SpawnedAgent, AgentEvent } from "../../types.js";
import { translate, classifyTool, WRITE_TOOLS } from "./mapper.js";

export const copilotFactory: AgentFactory = {
  name: "copilot",

  async create({ runId, agentIdx, model, thinkingLevel, cwd, systemHeader, env }) {
    const port = 4321 + (agentIdx % 1000);
    const client = new CopilotClient({
      cliPath: env.HUU_NO_DOCKER === "1"
        ? "copilot"
        : `${process.cwd()}/.huu-bin/copilot-with-shim.sh`,
      cliArgs: ["--headless", "--port", String(port)],
      cliUrl:  `localhost:${port}`,
      autoStart: false,
    });
    await client.start();

    const session = await client.createSession({
      sessionId: `huu-${runId}-agent-${agentIdx}`,
      model: model ?? "claude-sonnet-4.5",
      streaming: true,
      reasoningEffort: thinkingLevelToEffort(thinkingLevel),
      workspacePath: cwd,
      onPermissionRequest: approveAll,
      systemMessage: { mode: "append", content: systemHeader },
      tools: [
        defineTool("huu_emit", {
          description: "Internal hook for huu orchestrator signals",
          parameters: { type: "object", properties: { tag: { type: "string" }, payload: {} }, required: ["tag"] },
          handler: async (args) => ({ ok: true, ...args }),
        }),
      ],
    });

    return new CopilotAgent(client, session, { runId, agentIdx, cwd });
  },
};

// huu/src/adapters/copilot/agent.ts
class CopilotAgent implements SpawnedAgent {
  private subs: Set<(e: AgentEvent) => void> = new Set();
  private disposed = false;
  private termReason: string | null = null;
  private timeout?: NodeJS.Timeout;

  constructor(
    private client: CopilotClient,
    private session: CopilotSession,
    private ctx: { runId: string; agentIdx: number; cwd: string },
  ) {
    session.on((ev: SessionEvent) => {
      const ag = translate(ev);
      if (!ag) return;
      for (const cb of this.subs) cb(ag);
    });
  }

  subscribe(cb: (e: AgentEvent) => void): () => void {
    if (this.disposed) throw new Error("disposed");
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  async prompt(p: string, { timeoutMs = 600_000 } = {}) {
    if (this.disposed) throw new Error("disposed");
    this.timeout = setTimeout(() => { this.termReason = "timeout"; this.session.abort(); }, timeoutMs);
    try {
      await this.session.send({ prompt: p });
      await this.waitIdle();
    } finally {
      clearTimeout(this.timeout);
    }
  }

  private async waitIdle() {
    await new Promise<void>((resolve) => {
      const off = this.session.on("session.idle", () => { off(); resolve(); });
    });
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { await this.session.abort(); } catch {}
    try { await this.session.disconnect(); } catch {}
    try { await this.client.stop(); } catch { await this.client.forceStop(); }
  }
}
```

### E.2 Tradução de eventos

```ts
// huu/src/adapters/copilot/mapper.ts
export function translate(ev: SessionEvent): AgentEvent | null {
  switch (ev.type) {
    case "assistant.message_delta":   return { kind: "stream_chunk", text: ev.data.deltaContent };
    case "assistant.message":         return { kind: "assistant_message", text: ev.data.content };
    case "assistant.reasoning_delta": return { kind: "thinking_chunk", text: ev.data.deltaContent };
    case "assistant.reasoning":       return { kind: "thinking", text: ev.data.content };
    case "assistant.usage":           return { kind: "token_usage", inTok: ev.data.inputTokens ?? 0, outTok: ev.data.outputTokens ?? 0, cost: ev.data.cost ?? 0, cacheRead: ev.data.cacheReadTokens, cacheWrite: ev.data.cacheWriteTokens };
    case "tool.execution_start":      return { kind: "tool_use", id: ev.data.toolCallId, tool: classifyTool(ev.data.toolName, ev.data.mcpToolName), args: ev.data.arguments };
    case "tool.execution_complete":   return { kind: "tool_result", id: ev.data.toolCallId, ok: ev.data.success, content: ev.data.result?.content, error: ev.data.error?.message };
    case "tool.execution_partial_result": return { kind: "tool_partial", id: ev.data.toolCallId, chunk: ev.data.partialOutput };
    case "permission.requested":      return { kind: "permission", reqId: ev.data.requestId, kindOfReq: ev.data.permissionRequest.kind };
    case "session.error":             return { kind: "error", text: ev.data.message, code: ev.data.statusCode, errorType: ev.data.errorType };
    case "session.context_changed":   return { kind: "ctx_changed", cwd: ev.data.cwd, branch: ev.data.branch };
    case "session.idle":              return { kind: "turn_end" };
    case "session.shutdown":          return { kind: "done", reason: ev.data.shutdownType, totalPremiumRequests: ev.data.totalPremiumRequests, codeChanges: ev.data.codeChanges };
    case "abort":                     return { kind: "aborted", reason: ev.data.reason };
    case "subagent.started":          return { kind: "subagent_start", name: ev.data.agentName };
    case "subagent.completed":        return { kind: "subagent_end", name: ev.data.agentName };
    default: return null;
  }
}
```

### E.3 Limitações que o usuário precisa aceitar

1. **`pi.token_usage` em USD vira premium request count + multiplier**. Linha de log atualizada: `tokens +Nin +Mout (cost ~Xpr)`.
2. **Sub-agentes do `/fleet` não streamam por agente** — agregam no fim. Se você precisar acompanhar parallel sub-tarefas em real-time, **não use `/fleet`**; orquestre N `createSession` separados (que é o que o `huu` já faz com worktrees, então perfeito).
3. **`session.shutdown.shutdownType` perde granularidade** (issue 2852) — rastreie `abort`/`timeout`/`error` no adapter (B.5).
4. **resumeSession está com bug** (issue 540) — para “retomar a partir de onde parei”, comece sessão nova com `getMessages()` injetado como prefixo do prompt.
5. **System prompt não é totalmente livre em `mode:"append"`** — guardrails do Copilot persistem. Para contrato XML rígido, use `mode:"replace"` (perde safety; documente).
6. **Tool names variam por versão** — mantenha `WRITE_TOOLS` configurável.
7. **`gh stash` colision em worktrees paralelos** (issue 1725) — proíba `git stash` no system prompt.
8. **Worktree não criado pelo CLI** — `huu` continua dono.
9. **Sem flag `--cwd`** (issue 457) — passe via `cwd:` em spawn ou via `workspacePath:` em createSession.

### E.4 Estratégia de testes

Três camadas:

```ts
// 1. Unit tests do mapper — sem CLI, sem rede
test("translate maps tool.execution_start to tool_use", () => {
  expect(translate({ type: "tool.execution_start", data: { toolCallId: "x", toolName: "edit_file", arguments: { path: "a" } } } as any))
    .toEqual({ kind: "tool_use", id: "x", tool: "edit", args: { path: "a" } });
});

// 2. Integration tests com StubCopilotAgent — 0 tokens
const agent = await stubCopilotFactory.create({ /* ... */ });
agent.subscribe(spy);
await agent.prompt("hello");
expect(spy).toHaveBeenCalledWith({ kind: "assistant_message", text: "stub ok" });

// 3. E2E com BYOK Ollama local — gratuito, lento
process.env.COPILOT_PROVIDER_BASE_URL = "http://localhost:11434/v1";
process.env.COPILOT_MODEL = "qwen3.5";
const agent = await copilotFactory.create({ /* ... */ });
```

Para CI sem Docker, use o stub. Para CI com hardware, suba Ollama em sidecar e use BYOK. Reserve E2E real (BYOK = OpenRouter ou Copilot subscription) para manual / nightly.

### E.5 Configuração

```bash
# .env.huu
HUU_AGENT_BACKEND=copilot                 # vs "pi" vs "stub"
HUU_MODEL=claude-sonnet-4.5
HUU_THINKING=high
COPILOT_GITHUB_TOKEN=<...>                # ou GH_TOKEN
COPILOT_HOME=$PWD/.huu/copilot-state      # isola state
GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=1   # se usar -p
GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP=1
NO_COLOR=1
COPILOT_OTEL_ENABLED=true
COPILOT_OTEL_FILE_EXPORTER_PATH=$PWD/.huu/copilot-otel.jsonl
# BYOK opcional
# COPILOT_PROVIDER_BASE_URL=https://openrouter.ai/api/v1
# COPILOT_PROVIDER_API_KEY=$OPENROUTER_API_KEY
# COPILOT_PROVIDER_TYPE=openai
```

```jsonc
// .huu-cache/copilot-instructions.md
// Carregado automaticamente como custom instructions
- Worktree é isolado, não use `git stash`.
- Use `huu_emit` tool para sinalizar progresso de cards.
- Não modifique arquivos fora do worktree atual.
```

```jsonc
// $COPILOT_HOME/agents/huu-card.agent.md
---
name: huu-card
description: Specialized agent for huu card execution
model: claude-sonnet-4.5
tools: [bash, edit_file, create_file, view, grep, glob, huu_emit]
---
You are running inside a huu worktree...
```

### E.6 Diagrama de componentes

```mermaid
flowchart TB
  subgraph huu[huu-pipe Orchestrator (Node.js)]
    O[Orchestrator] -->|spawn N| AF{AgentFactory}
    AF -->|backend=copilot| CA[CopilotAgent adapter]
    AF -->|backend=pi| PA[RealAgent (pi-coding-agent)]
    AF -->|backend=stub| SA[StubAgent]
    O --> RL[RunLogger]
    O --> DL[DebugLogger NDJSON]
    O --> Ink[Ink TUI Dashboard]
    O --> St[OrchestratorState]
    O --> Sn[Sentinel /tmp/huu/active]
  end

  subgraph copa[Per-agent CopilotAgent]
    CA --> CC[CopilotClient @github/copilot-sdk]
    CC -- JSON-RPC stdio/TCP --> CLI[(copilot --headless --port N)]
    CLI -- spawn --> Shim[copilot-with-shim.sh<br/>LD_PRELOAD libhuu_bind.so]
    Shim --> Bin[copilot binary]
  end

  Bin -->|HTTPS| API[(api.githubcopilot.com)]
  Bin -.->|BYOK opcional| BY[(OpenRouter / Ollama / Azure)]

  CC -->|events| Map[Event Mapper]
  Map -->|AgentEvent| O

  CLI --> FS[(~/.copilot or<br/>$COPILOT_HOME/<br/>session-state/<sid>/<br/>events.jsonl + db)]

  Worktree[(Git worktree<br/>.huu-worktrees/<sid>)] -.cwd.-> CC

  style CA fill:#cfe,stroke:#393
  style CLI fill:#fec,stroke:#963
  style Bin fill:#fec,stroke:#963
```

---

## F. Riscos e armadilhas

### F.1 Mudanças não-anunciadas no formato de output
- O changelog é detalhado mas a cadência é semanal. Pin `@github/copilot@1.0.36` ou similar.
- A wire format JSON-RPC do SDK tem versão em `sdk-protocol-version.json`. Verifique compatibilidade.
- `event.type` é estável; campos opcionais novos podem aparecer (forward-compatible).
- **Mitigação**: versão pinada + smoke test em CI que dispara um prompt trivial e valida shape de `assistant.message`/`session.idle`.

### F.2 Auth expiration silenciosa
- Token OAuth expira (depende de policy do org).
- PAT fine-grained com expiração curta (recomendado por GitHub) vai falhar com `errorType="authentication"`.
- **Mitigação**: handle `session.error` com `errorType="authentication"` → renova token via Docker secret reload + retry uma vez. Implementar warning explícito quando `<24h` para expiry (parse via header `x-github-request-id` correlation).

### F.3 Comportamento diferente em CI vs local
- Em `-p` mode: hooks repo desabilitados por default desde 1.0.40-0 (precisa env opt-in).
- TTY-detection pode habilitar Ink alt-screen mesmo em prompt mode em algumas shells; force `NO_COLOR=1` e `CI=1`.
- Trusted folder prompt: aparece na primeira execução. Pre-popule `~/.copilot/settings.json` com `trusted_folders: [cwd]` ou use `--allow-all-paths`.
- **Mitigação**: padronize um wrapper script que injeta `NO_COLOR`, `CI`, `trusted_folders` e flags de auto-approve.

### F.4 Diferenças entre versões do Copilot CLI
Mudanças que você verá:
- Tool names (`view` ↔ `read_file`, etc.)
- Slash commands renomeados
- Settings keys (`launch_messages` → `companyAnnouncements`, snake_case → camelCase)
- Modelos descontinuados (gpt-5.1-codex-* removido em release recente — quebra `--model` se hardcoded).
- ACP `session config` mudou em 1.0.39/1.0.40

**Mitigação**: `client.listModels()` em runtime e fallback para `claude-sonnet-4.5` (default estável).

### F.5 Locking entre múltiplas instâncias
- `events.jsonl` mutex pode falhar (issue 2609) — `SIGTERM` deixa `inuse.*.lock` órfão.
- `git stash` global colisão entre worktrees (issue 1725).
- SQLite `session-store.db` é compartilhado se `COPILOT_HOME` é o mesmo — race em writes.

**Mitigação**: 1 `COPILOT_HOME` por agente (`$PWD/.huu/copilot-state-${idx}`). Limpe `inuse.*.lock` no startup. Bloquear `git stash` no system prompt.

### F.6 Limites de subscription excedidos
- Session rate limit: aguarde reset (mensagem CLI 1.0.34).
- Weekly limit: cai para Auto Model. Se sua orquestração exige Sonnet/Opus, vai falhar.
- Quota: Pro 300 PR/mês não dura para 20 agentes paralelos rodando Opus 3×.

**Mitigação**: assinatura **Business ou Enterprise** para o `huu` em produção. Em dev/CI use BYOK para evitar drain de quota. Implemente `assistant.usage.cost` running total e desligue agentes preemptivamente quando `costAcc > QUOTA_BUDGET`.

### F.7 Riscos específicos `huu`
- **Native shim libhuu_bind.so**: o `copilot` faz `web_fetch` e `bash` — qualquer sub-process do bash herda `LD_PRELOAD`, intercepta seus `bind()`. Isso é desejado, mas se o agente Copilot rodar `npm install` que sobe servidores, pode ficar confuso. Documente os ranges esperados.
- **Worktree global stash** já mencionado.
- **Telemetria**: `COPILOT_OTEL_ENABLED=true` envia traces — se você não quer dados saindo, deixe `false` e use apenas `COPILOT_OTEL_FILE_EXPORTER_PATH`.
- **Auto-update do CLI**: tente pinar versão via npm (`@github/copilot@1.0.36`) e desabilite update via `~/.copilot/settings.json` `"autoUpdate": false`. Senão, agentes paralelos podem detectar update no meio do run e divergir.

---

## Próximos passos acionáveis

1. **Adicionar `@github/copilot-sdk` como dependency opcional**
   ```bash
   npm i -D @github/copilot-sdk@^0.2.2
   ```
   E criar `huu/src/adapters/copilot/` com `factory.ts`, `agent.ts`, `mapper.ts`, `stub.ts` conforme E.1–E.4.

2. **Definir `AgentFactory` interface formal** que tanto `RealAgent`(pi) quanto `CopilotAgent` quanto `StubAgent` implementam. Hoje é implícita; explicitar facilita o switch via `HUU_AGENT_BACKEND`.

3. **Escrever wrapper bash `copilot-with-shim.sh`** em `.huu-bin/`:
   ```bash
   #!/usr/bin/env bash
   export LD_PRELOAD="${HUU_BIN_DIR:-$PWD/.huu-bin}/libhuu_bind.so${LD_PRELOAD:+:$LD_PRELOAD}"
   exec node "$(npm root -g)/@github/copilot/dist/copilot.js" "$@"
   ```
   E garantir `chmod +x` e `ensureGitignored('.huu-bin/')`.

4. **Adicionar resolução de credentials** em `huu/src/auth/copilot.ts` conforme B.20 (Docker secret → file → ENV → BYOK).

5. **Custom instructions automáticas**: gerar `$COPILOT_HOME/copilot-instructions.md` no startup com `Worktree é isolado. Não use git stash. Use huu_emit para sinais.`

6. **Pin de versão + smoke test em CI**:
   ```yaml
   - run: npm i -g @github/copilot@1.0.36
   - run: COPILOT_GITHUB_TOKEN=$TOKEN copilot -p "echo ok" --output-format=json --silent --allow-all-tools
   - run: npm test -- adapters/copilot/mapper.test.ts
   ```

7. **Atualizar `huu prune`** para também limpar `${COPILOT_HOME}/session-state/huu-${runId}-*`.

8. **Dashboard Ink**: adicionar coluna `PR` (premium requests) ao lado de `Tokens`, e colorir por `errorType` quando `session.error` aparece.

9. **Documentar trade-offs** no README do `huu`:
   - quando preferir backend `pi` (custo por token, controle total)
   - quando preferir `copilot` (subscription, modelos top de linha, Auto Mode)
   - quando preferir `copilot+BYOK Ollama` (offline, dev, gratuito)

10. **Issues a acompanhar** (subscribe / +1):
    - copilot-cli/457 (cwd flag)
    - copilot-cli/1725 (stash collision)
    - copilot-cli/2265 (fleet streaming)
    - copilot-cli/2852 (shutdown reason)
    - copilot-sdk/540 (resumeSession bug)
    - copilot-cli/55 (Docker official image)

11. **Criar contract test** que sobe `RealAgent`, `CopilotAgent` e `StubAgent` com o mesmo prompt simples e valida que o `AgentEvent` stream tem os mesmos `kind`s nas mesmas posições temporais. Isso protege contra divergência futura.

12. **Avaliar `HUU_NO_DOCKER=1` + Copilot CLI nativo**: dado que o Copilot é Node, e o `huu` é Node, eles compartilham o ambiente; se você tirar Docker, perde isolation mas ganha latência. Bom para dev local.

13. **Considerar ACP como segundo backend** se a longo prazo o `huu` quiser suportar Claude/Gemini/Codex unificadamente — escrevendo um `acp-agent.ts` ao lado do `copilot-agent.ts`. Mesma camada `AgentFactory`, traduções diferentes.

14. **Monitorar mudança 2026-06-01 para usage-based billing** (GitHub AI Credits) — pode mudar como `cost` aparece em `assistant.usage`, possivelmente passando a USD direto. Adapt-friendly: já capture `cost` como número opaco e renderize "X premium req" hoje, "Y USD" amanhã.

A migração do contrato `pi-coding-agent` para Copilot CLI é viável, robusta com SDK oficial, e o trabalho concentra-se em (i) escrever o adapter de ~400 linhas TS conforme E.1–E.2, (ii) garantir auth headless, (iii) preservar worktree/port-allocator do lado do `huu`, e (iv) absorver as 9 limitações documentadas em E.3.