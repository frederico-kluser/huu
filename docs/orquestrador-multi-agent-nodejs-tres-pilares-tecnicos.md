# Três pilares técnicos para um orquestrador multi-agent Node.js

**A combinação ideal para um orquestrador multi-agent com Pi e Ink TUI é: simple-git (com fallback `raw()` para worktrees) + modelo híbrido de comunicação inspirado em Overstory/pi-messenger + MCP client programático via `@modelcontextprotocol/sdk`.** Cada pilar apresenta trade-offs significativos que exigem decisões arquiteturais específicas. Este relatório sintetiza a pesquisa de 5 bibliotecas Git, 9 projetos de orquestração multi-agent, e a stack completa do Model Context Protocol para informar essas decisões com dados concretos de 2024–2026.

---

## PILAR 1 — Git programático: simple-git domina, mas worktree exige `raw()`

Nenhuma biblioteca Node.js oferece API tipada nativa para `git worktree`. Essa lacuna é o fator determinante na escolha. Das cinco opções avaliadas — simple-git, isomorphic-git, nodegit, dugite e execa+git CLI — **simple-git oferece o melhor equilíbrio entre ergonomia TypeScript e acesso completo ao Git**, enquanto isomorphic-git e nodegit são eliminados por limitações críticas.

### Tabela comparativa completa

| Critério | simple-git | isomorphic-git | nodegit | dugite | execa + git CLI |
|---|---|---|---|---|---|
| **Tipo** | CLI wrapper | Reimpl. JS pura | Bindings C++ (libgit2) | CLI wrapper (git bundled) | CLI wrapper (git sistema) |
| **Downloads npm/semana** | **6–11M** | 300–600K | 20–70K ↓ | 3–6K | ~100M+ (execa) |
| **Última release estável** | v3.32.3 (Nov 2025) | v1.37.2 (2026) | v0.27.0 (Jul 2020) ⚠️ | v2.7.1 / 3.0.0-rc | execa v9.x |
| **TypeScript** | ⭐⭐⭐⭐ bundled .d.ts | ⭐⭐⭐⭐ bundled | ⭐⭐ @types externo | ⭐⭐⭐⭐ nativo TS | ⭐⭐⭐⭐ excelente |
| **Worktree add/remove/list** | Via `raw()` ✅ | ❌ Sem suporte | Parcial/incerto | ✅ CLI completo | ✅ CLI completo |
| **git diff** | `.diff()` + `.diffSummary()` | ❌ Sem comando | `Diff.treeToTree()` | CLI raw | CLI raw |
| **git merge (estratégias)** | ✅ Todas via options | ⚠️ Apenas diff3 | ✅ `Merge.commits()` | ✅ Todas | ✅ Todas |
| **merge-tree (pré-detecção)** | Via `raw()` ✅ | ❌ | Via Index.hasConflicts() | ✅ | ✅ |
| **Octopus merge** | ✅ | ❌ | Manual | ✅ | ✅ |
| **Parsing de output** | ✅ Objetos estruturados | ✅ Objetos JS | ✅ Objetos libgit2 | ❌ stdout raw | ❌ stdout raw |
| **Concorrência** | Fila serial por instância | ❌ Sem safety | Locks internos libgit2 | git index.lock | git index.lock |
| **Requer git sistema** | Sim | Não | Não | Não (bundled ~50MB) | Sim |

### Eliminações e justificativas

**isomorphic-git** é inadequado para o orquestrador: sem suporte a worktrees, sem comando `diff` nativo, e merge limitado a diff3 (sem octopus, sem `-X theirs/ours`, sem estratégias avançadas). Sua proposta de valor — rodar no browser — é irrelevante para um orquestrador Node.js server-side.

**nodegit** é efetivamente abandonado. O último release estável (v0.27.0) tem **mais de 5 anos**. A própria equipe do Azure SDK recomendou migração. Builds nativos C++ são frágeis em CI/CD e sem binários pré-compilados para Node 18+. Apesar da performance superior do libgit2, o risco operacional é proibitivo.

### Arquitetura recomendada: simple-git + camada de worktree

A estratégia ideal combina o parsing estruturado do simple-git para operações comuns com `raw()` para worktrees:

```typescript
import simpleGit, { SimpleGit } from 'simple-git';

// Instância principal — opera no repo raiz
const mainGit: SimpleGit = simpleGit('/repo');

// Criar worktree isolado para um agent
await mainGit.raw(['worktree', 'add', '-b', 'agent-alpha', '../wt-alpha']);

// Instância separada POR worktree = isolamento natural de index.lock
const agentGit: SimpleGit = simpleGit('../wt-alpha');
await agentGit.add('.');
await agentGit.commit('feat: implement auth module');

// Diff entre branches — parsing estruturado
const diffSummary = await mainGit.diffSummary(['main..agent-alpha']);
console.log(`${diffSummary.files.length} arquivos alterados`);

// Pré-detecção de conflitos via merge-tree (Git 2.38+)
const mergeTree = await mainGit.raw([
  'merge-tree', '--write-tree', '--no-messages', 'HEAD', 'agent-alpha'
]);
const hasConflicts = mergeTree.includes('CONFLICT');

// Merge com estratégia explícita
if (!hasConflicts) {
  await mainGit.merge(['--no-ff', '-X', 'theirs', 'agent-alpha']);
}

// Cleanup
await mainGit.raw(['worktree', 'remove', '../wt-alpha']);
```

### Padrões de segurança para concorrência entre worktrees

**index.lock é automaticamente isolado por worktree** — cada worktree tem seu próprio diretório de trabalho e index, então operações concorrentes em worktrees diferentes **não competem** por locks. O perigo real está nas **refs compartilhadas**: todas as worktrees de um repositório compartilham o mesmo `.git/refs/`. Operações simultâneas de push, merge em `main`, ou manipulação de tags requerem coordenação explícita.

Padrão seguro para o orquestrador:

- **Pré-criar branches** antes de criar worktrees (`git branch agent-X base-commit`)
- **Uma instância SimpleGit por worktree** — a fila serial interna previne race conditions
- **Merge sequencial no main** — usar um mutex/semáforo para serializar merges na branch principal
- **Nunca executar `git gc` ou `git prune`** enquanto worktrees estão ativas
- **Monitorar `index.lock`** — retry com backoff exponencial se detectar lock em refs compartilhados

A alternativa **dugite** ou **execa** é viável quando o parsing estruturado não é necessário (ex: merge-tree output é simples o suficiente para regex). Para um orquestrador que precisa tanto de operações de alto nível (diff summary, merge result parsing) quanto worktree management, **a combinação simple-git + raw() é a escolha mais pragmática**.

---

## PILAR 2 — Nove filosofias de orquestração e o que aprender de cada uma

O ecossistema de orquestração multi-agent para coding explodiu entre 2025–2026, com abordagens radicalmente diferentes. Dois padrões fundamentais emergem: **orquestração de infraestrutura** (workmux, dmux, agtx — gerenciam tmux/worktrees, agents não se comunicam) versus **coordenação no nível do agente** (pi-messenger, pi-agent-teams, agent-stuff, Overstory — agents trocam mensagens e negociam trabalho).

### Panorama dos 9 projetos

| Projeto | ⭐ Stars | Linguagem | Modelo | Comunicação | Merge | Isolamento |
|---|---|---|---|---|---|---|
| **workmux** | 871 | Rust | Worktree-per-window + /coordinator | Coordinator commands (send/capture/wait) | Merge/rebase/squash built-in | Git worktrees + sandbox |
| **dmux** | 68 | TypeScript | Worktree-per-pane | Nenhuma | Auto-commit + merge one-click | Git worktrees |
| **agtx** | 3 | Rust | TUI Kanban 5 colunas | Nenhuma | PR workflow built-in | Git worktrees |
| **pi-messenger** | 12 | TypeScript | Crew (planner→workers→reviewer) | File-based messaging + presence | Manual | File reservations (soft locks) |
| **pi-agent-teams** | 10 | TypeScript | Leader-member teams | File-based mailboxes + steer RPC | Manual | Worktrees opcionais |
| **agent-stuff** | 1.400 | TypeScript | Toolkit pessoal + session control | **Unix domain sockets** (JSON-RPC) | Manual | tmux sessions + sockets |
| **claude-swarm** | 3 | Python | Wave-based decomposition | Orquestrador centralizado | Orchestrator combina | File locking pessimista |
| **Overstory** | 400+ | TypeScript/Bun | Hierárquico (Coordinator→Supervisor→Workers) | **SQLite mail** (WAL, 8 tipos, broadcast) | **FIFO queue + 4-tier resolution** | Git worktrees |
| **claude_code_agent_farm** | 680 | Python | Farm massiva (20-50+ agents) | **Prompt-driven file locks** | Git commits auto | Shared codebase + locks |

### workmux: o mais completo em infraestrutura de worktrees

O projeto de Raine Virta é o mais maduro para gerenciamento de worktrees. Três níveis de sofisticação — solo (um agent por worktree), delegated (agent spawna subtasks via `/worktree` skill), e coordinated (`/coordinator` skill monitora e orquestra). A configuração via `.workmux.yaml` define hooks `post_create`, symlinks (ex: `node_modules`), e layout de panes. **Status icons no tmux** (🤖 working, 💬 waiting, ✅ done) resolvem o problema de monitoramento visual. O merge workflow é completo: `workmux merge` faz merge/rebase/squash, deleta worktree, fecha window, e remove branch local.

A lição para o orquestrador Ink: **a UX de status tracking precisa ser instantânea e visual**. Os ícones do workmux são eficientes porque comunicam estado em um glyph.

### pi-messenger: file-based messaging sem infraestrutura

A abordagem de Nico Bailon é elegante na simplicidade — **zero infraestrutura**. Toda coordenação vive em `.pi/messenger/` como arquivos JSON/Markdown no filesystem. O sistema de reserva de arquivos (`reserve`/`release`) é particularmente relevante: agents reclamam paths atômicamente, e outros agents recebem mensagem clara sobre quem é o "dono" daquele código. O **Crew model** (planner → workers → reviewer) com model tiering (Haiku para workers baratos, Sonnet/Opus para planner/reviewer) é economicamente inteligente.

```javascript
// API concisa do pi-messenger
pi_messenger({ action: "reserve", paths: ["src/auth/"], reason: "Refactoring" })
pi_messenger({ action: "send", to: "GoldFalcon", message: "auth is done" })
pi_messenger({ action: "release" })
```

### agent-stuff (Armin Ronacher): Unix sockets e semântica steer/follow_up

A inovação mais elegante de IPC veio de Armin Ronacher. Cada sessão Pi cria um **Unix domain socket** em `~/.pi/session-control/<session-id>.sock`. A distinção entre **`steer`** (redirecionar uma conversa em andamento) e **`follow_up`** (enfileirar prompt após o turno atual) resolve um problema fundamental de coordenação multi-agent: quando interromper vs. quando esperar.

```bash
# Steer: redireciona o agent AGORA
pi --send-session-message "Pare, há conflito no auth.ts" --send-session-mode steer

# Follow-up: enfileira para DEPOIS do turno atual
pi --send-session-message "Agora implemente testes" --send-session-mode follow_up
```

Essa semântica bidirecional é **essencial** para o orquestrador — um agent reviewer precisa poder interromper um builder (steer) ou agendar próximo passo (follow_up).

### Overstory: a abordagem mais robusta de sistemas distribuídos

Com **434 commits**, 2.026 testes, e zero dependências runtime, Overstory trata orquestração multi-agent como um problema legítimo de sistemas distribuídos. O **SQLite mail system** (WAL mode, ~1-5ms por query) com 8 tipos de mensagem tipados (`worker_done`, `merge_ready`, `escalation`, `health_check`, etc.) é mais robusto que file-based messaging. O **merge workflow de 4 camadas** é único no ecossistema:

- **Tier 1-3**: Resolução mecânica progressiva (fast-forward → recursive → ours/theirs)
- **Tier 4**: AI resolver com histórico de conflitos por arquivo

O **watchdog de 3 tiers** (mecânico → AI-assistido → agent monitor) e o sistema de **checkpoints** para recuperação de crashes são funcionalidades que nenhum outro projeto implementa. O **STEELMAN.md** do projeto alerta honestamente sobre os riscos: erros compostos, "coordination theater" (agents gastam mais tempo coordenando que trabalhando), e retornos decrescentes acima de 20 agents.

### claude_code_agent_farm: coordenação via prompt é possível

A descoberta mais provocativa: Jeff Emanuel demonstrou que **LLMs (especialmente Opus 4) conseguem implementar protocolos de file-locking autonomamente via prompt**, sem nenhum código de enforcement. Agents geram IDs únicos, checam registry JSON, criam lock files, e detectam locks stale (>2h). Isso funciona com **20-50+ agents simultâneos** em produção.

```
/coordination/
├── active_work_registry.json     # Registry central
├── completed_work_log.json       # Log de trabalho completado
├── agent_locks/                  # Lock files individuais
│   └── {agent_id}_{timestamp}.lock
└── planned_work_queue.json       # Fila de trabalho planejado
```

A implicação: para tarefas de bulk (bug fixing, best practices sweep), **coordenação por prompt pode ser suficiente** sem infraestrutura complexa.

### Síntese: padrões extraídos para o orquestrador

Cinco padrões recorrentes devem informar a arquitetura:

- **Git worktrees são universais** como mecanismo de isolamento — todos os 9 projetos usam ou recomendam worktrees (exceto pi-messenger que usa soft locks)
- **Comunicação file-based é pragmática** mas limitada — funciona para <10 agents, mas SQLite (Overstory) escala melhor
- **Model tiering é economicamente necessário** — planner/reviewer usam modelo caro, workers usam modelo barato
- **Merge sequencial no main** é a abordagem dominante — nenhum projeto tenta merge paralelo em branch compartilhada
- **Status tracking visual é essencial** — todo projeto maduro implementa algum sistema de ícones/estados visíveis

---

## PILAR 3 — MCP programático: do protocolo ao bridge com Pi SDK

O Model Context Protocol transformou a integração de ferramentas externas em um problema resolvido. **Um MCP client programático em Node.js requer ~50 linhas de código** usando o SDK oficial, e o padrão proxy do pi-mcp-adapter resolve o problema de consumo excessivo de tokens.

### Arquitetura do protocolo em três camadas

O MCP opera com **JSON-RPC 2.0** sobre três camadas: Host → Client → Server. O **Host** é a aplicação AI (o orquestrador). Cada **Client** mantém conexão 1:1 com um **Server**. O lifecycle segue handshake estrito: `initialize` → capabilities exchange → `notifications/initialized` → operação normal.

Dois transports ativos em 2026:

| Transport | Mecanismo | Caso de uso |
|---|---|---|
| **stdio** | Child process, stdin/stdout | Servers locais, CLI tools, máxima performance |
| **Streamable HTTP** | POST + SSE opcional | Servers remotos, multi-tenant, cloud |

O SSE standalone foi **depreciado** em favor do Streamable HTTP que suporta upgrade opcional para streaming.

### SDK oficial: v1.x estável, v2 em transição

O `@modelcontextprotocol/sdk` v1.25.3 (11.6k ⭐ no GitHub) é a versão estável amplamente adotada. O v2 (branch main) split em packages separados (`@modelcontextprotocol/server` + `@modelcontextprotocol/client`) com middleware para Express/Hono/Node e migração para Zod v4.

Criar um client MCP programático que se conecta a qualquer server:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsResultSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

// 1. Spawna server como child process
const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
});

// 2. Client com handshake automático
const client = new Client(
  { name: "orchestrator-mcp", version: "1.0.0" },
  { capabilities: {} }
);
await client.connect(transport); // initialize + capabilities exchange

// 3. Descoberta de tools
const { tools } = await client.request(
  { method: "tools/list" },
  ListToolsResultSchema
);
// tools: [{ name: "read_text_file", description: "...", inputSchema: {...} }, ...]

// 4. Chamada de tool
const result = await client.request(
  { method: "tools/call", params: { name: "list_directory", arguments: { path: "/tmp" } } },
  CallToolResultSchema
);
```

### Cinco MCP servers essenciais para o orquestrador

| Server | Package | Env/Config | Tools principais |
|---|---|---|---|
| **Brave Search** | `@brave/brave-search-mcp-server` | `BRAVE_API_KEY` | `brave_web_search`, `brave_local_search`, `brave_news_search` |
| **Filesystem** | `@modelcontextprotocol/server-filesystem` | Dirs permitidos como args CLI | `read_text_file`, `write_file`, `edit_file`, `search_files` (12 tools) |
| **GitHub** | `@modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` | `search_repositories`, `create_pull_request`, `push_files` (20+ tools) |
| **PostgreSQL** | `@modelcontextprotocol/server-postgres` | Connection string como arg | `query` (read-only SQL) + schema via resources |
| **Puppeteer** | `@modelcontextprotocol/server-puppeteer` | Nenhum | `puppeteer_navigate`, `puppeteer_screenshot`, `puppeteer_click` (7 tools) |

**Nota importante**: o package original `@modelcontextprotocol/server-brave-search` (v0.6.2) foi **arquivado**. O server oficial agora é mantido pela Brave em `@brave/brave-search-mcp-server`.

### Padrão proxy do pi-mcp-adapter: economia de tokens

Registrar todos os tools de todos os MCP servers diretamente consome **10k+ tokens** de contexto. O `pi-mcp-adapter` (nicobailon) resolve isso com um **único tool proxy** (~200 tokens) que faz descoberta on-demand:

```json
// ~/.pi/agent/mcp.json ou .pi/mcp.json (projeto)
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "directTools": ["search_repositories", "get_file_contents"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "directTools": true
    }
  }
}
```

O campo `directTools` promove tools específicos como first-class no agent (~150-300 tokens cada). Servers sem `directTools` ficam acessíveis via proxy com zero custo de contexto até serem usados. **Servers lazy-start** na primeira chamada e **desconectam após 10 minutos** de inatividade.

### Bridge MCP → Pi customTools para o orquestrador

O padrão para expor tools MCP no Pi Agent SDK:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResultSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

interface PiCustomTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (id: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
}

async function bridgeMCPtoPi(
  command: string, args: string[], env?: Record<string, string>
): Promise<{ tools: PiCustomTool[]; cleanup: () => Promise<void> }> {

  const transport = new StdioClientTransport({
    command, args,
    env: env ? { ...process.env, ...env } : undefined,
  });
  const client = new Client({ name: "pi-bridge", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.request({ method: "tools/list" }, ListToolsResultSchema);

  const piTools: PiCustomTool[] = tools.map(tool => ({
    name: `mcp_${tool.name}`,
    description: tool.description || tool.name,
    inputSchema: tool.inputSchema as Record<string, unknown>,
    execute: async (_id, params, _signal) => {
      const result = await client.request(
        { method: "tools/call", params: { name: tool.name, arguments: params } },
        CallToolResultSchema
      );
      return result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map(c => c.text)
        .join("\n");
    },
  }));

  return { tools: piTools, cleanup: () => client.close() };
}

// Uso no orquestrador
const github = await bridgeMCPtoPi("npx", ["-y", "@modelcontextprotocol/server-github"], {
  GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN!,
});
// github.tools → array de PiCustomTool[] prontos para registrar no Pi SDK
```

---

## Conclusão: decisões arquiteturais derivadas da pesquisa

A investigação dos três pilares converge em recomendações concretas. Para **Git programático**, simple-git com `raw()` para worktrees é a escolha pragmática — a alternativa seria execa puro, mas perde-se o parsing estruturado de diff/merge que economiza código no orquestrador. A lacuna de API tipada para worktrees sugere criar um wrapper fino (`WorktreeManager`) que encapsula os `raw()` calls com tipos.

Para **orquestração**, o modelo mais adequado para um orquestrador Ink TUI com Pi combina elementos de três projetos: o **Kanban visual do agtx** (Backlog→Running→Review→Done mapeado a componentes Ink), o **SQLite mail do Overstory** (mais robusto que file-based para >5 agents), e a **semântica steer/follow_up do agent-stuff** (essencial para coordenação entre agents Pi). O modelo de **model tiering** do pi-messenger (workers baratos, planner/reviewer caros) deve ser default. A coordenação prompt-driven do claude_code_agent_farm é uma opção viável para workloads de bulk que não justificam infraestrutura complexa.

Para **MCP**, o SDK v1.x (`@modelcontextprotocol/sdk` v1.25.3) é estável e amplamente adotado. O padrão proxy do pi-mcp-adapter é a abordagem correta para eficiência de tokens — registrar tools on-demand em vez de todos upfront. O transport stdio é ideal para servers locais no orquestrador; Streamable HTTP serve para cenários de servers remotos compartilhados entre múltiplos agents.

A insight não-óbvia desta pesquisa: **o gargalo real de um orquestrador multi-agent não é técnico, é de coordenação**. O STEELMAN.md do Overstory documenta honestamente que acima de ~20 agents, o custo de coordenação supera o ganho de paralelismo. O orquestrador deve ser projetado com um **cap configurável de concorrência** e métricas de "coordination overhead" visíveis na TUI Ink.