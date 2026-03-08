# Guia definitivo de configuração avançada do Pi Coding Agent

**O Pi é o agente de codificação terminal mais minimalista e extensível disponível hoje — e esse minimalismo é exatamente o que o torna poderoso.** Com apenas 4 ferramentas nativas, um system prompt abaixo de 1.000 tokens e extensibilidade total via TypeScript, o Pi entrega o que agentes maiores prometem sem o peso que eles carregam. Criado por Mario Zechner (@badlogic, criador do libGDX), o Pi é o motor por trás do OpenClaw (145K+ stars no GitHub) e a escolha de devs como Armin Ronacher (criador do Flask/Sentry). Este guia cobre tudo que um power user precisa: de configuração de providers até orquestração multi-agent, extensões customizadas e context engineering avançado.

---

## 1. Por que power users escolhem o Pi

O Pi nasceu de uma frustração concreta. Mario Zechner usava o Claude Code desde abril de 2025, mas ao longo dos meses o tool "virou uma nave espacial com 80% de funcionalidade que eu não uso". O system prompt e as ferramentas mudavam a cada release, quebrando workflows. A resposta foi construir algo radicalmente diferente.

O Pi opera com **4 ferramentas** (read, write, edit, bash), um system prompt de **~1.000 tokens** (contra ~12.000 do Claude Code), e uma filosofia YOLO — zero popups de permissão. Como Mario argumenta: "medidas de segurança em outros agentes são teatro de segurança; assim que o agente pode escrever e executar código, game over." O nome "Pi" foi escolhido para ser "completamente não-googlável, para que nunca tenha usuários" — uma piada que não envelheceu bem, dado os **15.8K+ stars** no GitHub.

A arquitetura é um monorepo com 4 pacotes principais que formam uma stack limpa:

```
┌─────────────────────────────────────────┐
│  Sua Aplicação (OpenClaw, bot, CLI)     │
├────────────────────┬────────────────────┤
│  pi-coding-agent   │  pi-tui            │
│  Sessions, tools,  │  Terminal UI,      │
│  extensões         │  markdown, editor  │
├────────────────────┴────────────────────┤
│  pi-agent-core                          │
│  Agent loop, tool execution, eventos    │
├─────────────────────────────────────────┤
│  pi-ai                                  │
│  Streaming, models, multi-provider LLM  │
└─────────────────────────────────────────┘
```

O Pi suporta **15+ providers** (Anthropic, OpenAI, Google, Azure, Bedrock, Mistral, Groq, Cerebras, xAI, Hugging Face, Kimi, MiniMax, OpenRouter, Ollama, e qualquer endpoint OpenAI-compatível), com **troca de modelo mid-session** sem perder contexto — algo que o Claude Code simplesmente não faz.

---

## 2. Quick Start para quem vem do Claude Code

Se você já usa Claude Code, esta tabela traduz os conceitos mentais:

| Claude Code | Pi | Como fazer no Pi |
|---|---|---|
| `CLAUDE.md` | `AGENTS.md` | Mesmo conceito, mesma hierarquia. Pi também carrega `CLAUDE.md` |
| System prompt fixo ~12K tokens | System prompt ~1K tokens | Substituível via `SYSTEM.md` ou `--system-prompt` |
| Permission prompts (allow/deny) | YOLO (sem prompts) | Adicione gate via extensão `permission-gate.ts` |
| MCP servers nativos | Sem MCP nativo | Use CLI tools + Skills, ou `mcporter` para converter MCPs |
| Sub-agents (Agent Teams) | Sem sub-agents nativos | tmux + `pi -p`, extensões, ou pacotes como `pi-messenger` |
| Plan mode nativo | Sem plan mode nativo | Escreva em `PLAN.md`, ou instale extensão `plan-mode` |
| Background bash | Sem background bash | Use tmux — observabilidade total |
| `/compact` automático | `/compact` customizável | Compactação via extensões com controle total |
| Modelo fixo (Anthropic only) | 15+ providers, troca mid-session | `Ctrl+L` ou `Ctrl+P` para trocar on-the-fly |
| Hooks via shell (14 eventos) | Extensões TypeScript (20+ eventos) | In-process, sem overhead de processo externo |
| `claude -p` | `pi -p` | Mesmo conceito, mesma flag |

**Instalação rápida:**

```bash
# Via npm (recomendado)
npm install -g @mariozechner/pi-coding-agent

# Ou binário standalone (macOS Apple Silicon)
curl -L https://github.com/badlogic/pi-mono/releases/latest/download/pi-darwin-arm64.tar.gz | tar xz
xattr -c ./pi  # fix para binário não-assinado no macOS

# Verificar instalação
pi --version
```

**Primeira execução:**

```bash
# Interativo (TUI completa)
pi

# Com prompt inicial
pi "Liste todos os arquivos .ts neste projeto"

# Print mode (não-interativo, ideal para scripts)
pi -p "Resuma este codebase"

# Continuar última sessão
pi -c

# Navegar sessões anteriores
pi -r
```

> ⚠️ **Gotcha**: O Pi NÃO carrega `.env` automaticamente. Suas API keys precisam estar disponíveis no shell antes de executar `pi`. Use `export ANTHROPIC_API_KEY=sk-ant-...` ou configure `~/.pi/agent/auth.json`.

---

## 3. Configuração de providers e modelos

### Autenticação via auth.json (recomendado)

O arquivo `~/.pi/agent/auth.json` centraliza todas as credenciais:

```json
{
  "anthropic": "sk-ant-api03-...",
  "openai": "sk-proj-...",
  "google": "AIzaSy...",
  "groq": "gsk_...",
  "xai": "xai-...",
  "openrouter": "sk-or-v1-..."
}
```

**Formatos aceitos para cada valor:**
- String literal: `"sk-ant-..."`
- Nome de variável de ambiente: `"ANTHROPIC_API_KEY"`
- Comando shell (prefixo `!`): `"!op read 'op://vault/openai/key'"` (integração com 1Password, etc.)

**Prioridade de resolução:** CLI `--api-key` > `auth.json` > variáveis de ambiente.

### OAuth para planos com subscription

O Pi suporta login OAuth para usar modelos sem API key separada:

```bash
pi  # entre no modo interativo
/login  # abre seletor de providers OAuth
```

| Provider | Modelos disponíveis | Custo |
|---|---|---|
| Anthropic (Claude Pro/Max) | Claude 4 Opus, Sonnet, Haiku | Subscription existente |
| GitHub Copilot | GPT-4o, Claude, Gemini | Subscription existente |
| Google Gemini CLI | Gemini 2.0/2.5 | Gratuito (rate-limited) |
| Google Antigravity | Gemini 3, Claude, GPT-OSS | Gratuito (rate-limited) |

### Configuração de modelos customizados via models.json

Crie `~/.pi/agent/models.json` para adicionar providers locais ou customizados:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        {
          "id": "qwen2.5-coder:32b",
          "name": "Qwen 2.5 Coder 32B (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "lm-studio": {
      "baseUrl": "http://localhost:1234/v1",
      "api": "openai-completions",
      "apiKey": "lm-studio",
      "models": [
        { "id": "deepseek-coder-v2", "name": "DeepSeek Coder V2" }
      ]
    },
    "custom-corporate": {
      "baseUrl": "https://api.internal.company.com/v1",
      "api": "openai-completions",
      "apiKey": "CORPORATE_LLM_KEY",
      "compat": {
        "supportsDeveloperRole": false
      },
      "models": [
        {
          "id": "internal-codegen",
          "name": "Corporate CodeGen",
          "reasoning": true,
          "input": ["text"],
          "cost": { "input": 0.15, "output": 0.6 },
          "contextWindow": 128000,
          "maxTokens": 4096
        }
      ]
    }
  }
}
```

**Campos importantes do `api`:** `"openai-completions"` (maioria dos providers), `"anthropic"` (API nativa Anthropic), `"google"` (API nativa Google). O campo `compat` resolve quirks de providers — use `"supportsDeveloperRole": false` para providers que não suportam system messages no formato developer role.

O arquivo recarrega automaticamente ao abrir `/model` — edite durante a sessão sem reiniciar.

### Seleção de modelo via CLI

```bash
# Especificar provider e modelo
pi --provider openai --model gpt-4o "Analise este código"

# Shorthand com prefixo
pi --model openai/gpt-4o "Analise este código"

# Com thinking level
pi --model sonnet:high "Resolva este problema complexo"

# Limitar cycling a modelos específicos
pi --models "claude-4*,gpt-5*"

# Listar todos os modelos disponíveis
pi --list-models

# Busca fuzzy
pi --list-models sonnet
```

**No modo interativo:** `Ctrl+L` abre o seletor de modelos, `Ctrl+P` cicla entre favoritos, `Shift+Ctrl+P` cicla ao contrário, `Shift+Tab` cicla thinking levels (**off, minimal, low, medium, high, xhigh** — unificados across todos os providers).

> ⚠️ **Gotcha**: Ao trocar de provider mid-session (ex: Anthropic → OpenAI), thinking traces são convertidos para tags `<thinking></thinking>`. Funciona, mas providers inserem blobs assinados que precisam ser replayed — se a conversão falhar silenciosamente, tente iniciar sessão nova.

---

## 4. Masterclass em AGENTS.md

AGENTS.md são instruções de projeto carregadas no startup e injetadas no system prompt. São o mecanismo primário de context engineering no Pi.

### Hierarquia de carregamento (todos concatenados)

```
~/.pi/agent/AGENTS.md          ← Global (suas preferências pessoais)
~/projects/AGENTS.md            ← Monorepo raiz
~/projects/apps/web/AGENTS.md   ← Subprojeto específico
.pi/AGENTS.md                   ← Variante dentro de .pi/
```

Todos os arquivos encontrados da raiz até o cwd são **concatenados** e adicionados ao final do system prompt. Isso permite instruções em camadas.

### AGENTS.md global — suas preferências pessoais

```markdown
<!-- ~/.pi/agent/AGENTS.md -->
# Preferências Globais

## Estilo de Código
- Use TypeScript strict mode sempre
- Prefira composição sobre herança
- Funções puras quando possível
- Nomes de variáveis em inglês, comentários em português quando relevante

## Convenções de Git
- Commits em formato conventional: feat(scope): description
- NUNCA use `git add -A` ou `git add .`
- SEMPRE use `git add <caminhos-específicos>`
- Rode `git status` antes de cada commit

## Comportamento do Agente
- Seja conciso nas respostas
- Leia arquivos existentes antes de editar
- Rode testes após alterações significativas
- Ao criar novos arquivos, siga patterns dos arquivos existentes
```

### AGENTS.md para monorepo full-stack

```markdown
<!-- ~/project/AGENTS.md -->
# Monorepo MyApp

## Estrutura
- `apps/web/` — Frontend Next.js 15 (App Router)
- `apps/api/` — Backend Fastify + Drizzle ORM
- `packages/shared/` — Types e utils compartilhados
- `packages/ui/` — Design system com Radix + Tailwind

## Comandos
- `pnpm dev` — Inicia todos os serviços
- `pnpm test` — Roda todos os testes (vitest)
- `pnpm lint` — ESLint + Prettier check
- `pnpm db:migrate` — Roda migrações do banco

## Regras Importantes
- Alterações em `packages/shared/` exigem rebuild: `pnpm -F shared build`
- Nunca edite `pnpm-lock.yaml` manualmente
- Variáveis de ambiente ficam em `.env.local` (nunca commitadas)
- Todas as queries de banco via Drizzle ORM — sem SQL raw

## Multi-Agent Rules
Quando trabalhando em paralelo com outros agentes (git worktrees):
1. Rode `git status` antes de qualquer commit
2. Use APENAS `git add <caminhos-específicos-dos-seus-arquivos>`
3. Nunca modifique arquivos que outro agente está editando
4. Prefixe branches com `agent/<nome-do-agente>/`
```

### AGENTS.md para projeto frontend React

```markdown
<!-- ~/project/apps/web/AGENTS.md -->
# Frontend Web

## Stack
Next.js 15, React 19, TypeScript 5.7, Tailwind CSS 4, Radix Primitives

## Patterns
- Server Components por padrão, 'use client' apenas quando necessário
- Data fetching via Server Actions em `app/actions/`
- Estado global com Zustand (stores em `lib/stores/`)
- Formulários com react-hook-form + zod

## Testes
- Componentes: Vitest + Testing Library
- E2E: Playwright em `e2e/`
- Rodar antes de commit: `pnpm -F web test`

## Não Fazer
- Não use useEffect para data fetching
- Não crie componentes com mais de 150 linhas
- Não use any — prefira unknown + type guards
```

### Anti-patterns comuns em AGENTS.md

- **Instruções vagas**: "Escreva código bom" não ajuda — seja específico sobre patterns e convenções
- **Excesso de contexto**: AGENTS.md muito longo come tokens do seu prompt cache. Mantenha abaixo de **2.000 tokens por arquivo**
- **Contradições entre níveis**: Se o global diz "use semicolons" e o local diz "no semicolons", o modelo vai se confundir. Revise a hierarquia
- **Instruções de runtime**: AGENTS.md é carregado uma vez no startup. Não coloque instruções que dependem de estado dinâmico

> ⚠️ **Gotcha**: O Pi também carrega `CLAUDE.md` por compatibilidade. Se você tem ambos `AGENTS.md` e `CLAUDE.md` no mesmo diretório, ambos serão concatenados — cuidado com duplicação.

---

## 5. SYSTEM.md e customização de prompt

### Quando substituir vs quando adicionar

O **SYSTEM.md** substitui completamente o system prompt padrão do Pi. O **APPEND_SYSTEM.md** adiciona conteúdo ao final sem substituir. Na maioria dos casos, **APPEND_SYSTEM.md é o que você quer**.

**Auto-discovery (sem flags no CLI):**

| Arquivo | Local do projeto | Global | Efeito |
|---|---|---|---|
| `SYSTEM.md` | `.pi/SYSTEM.md` | `~/.pi/agent/SYSTEM.md` | **Substitui** system prompt |
| `APPEND_SYSTEM.md` | `.pi/APPEND_SYSTEM.md` | `~/.pi/agent/APPEND_SYSTEM.md` | **Adiciona** ao system prompt |

Projeto-local tem prioridade sobre global.

### Exemplo de APPEND_SYSTEM.md para projetos específicos

```markdown
<!-- .pi/APPEND_SYSTEM.md -->
## Contexto adicional deste projeto

Este projeto usa uma API proprietária documentada em `docs/api-spec.md`.
Sempre leia esse arquivo antes de implementar integrações.

Quando o usuário pedir "deploy", execute:
1. `pnpm build`
2. `pnpm test`
3. `./scripts/deploy.sh staging`

Nunca faça deploy para production sem confirmação explícita.
```

### Exemplo de SYSTEM.md completo (substituição total)

```markdown
<!-- .pi/SYSTEM.md — USE COM CAUTELA -->
Você é um assistente de código especializado em Rust e sistemas embarcados.

Ferramentas disponíveis:
- read: Ler conteúdo de arquivos
- bash: Executar comandos no terminal
- edit: Edições cirúrgicas em arquivos
- write: Criar ou sobrescrever arquivos

Diretrizes:
- Sempre verifique compilação com `cargo check` após edições
- Use `unsafe` apenas quando absolutamente necessário e documente o motivo
- Prefira zero-copy e lifetime annotations explícitas
- Respostas em português brasileiro
```

**Via CLI (override temporário):**

```bash
# Substituir system prompt
pi --system-prompt "Você é um reviewer de código focado em segurança."

# Ou apontar para arquivo
pi --system-prompt ./custom-prompt.md

# Adicionar ao prompt padrão
pi --append-system-prompt "Sempre responda em português."
```

> ⚠️ **Gotcha**: Se você substituir o system prompt e não incluir as instruções sobre as ferramentas (read, write, edit, bash), o modelo pode não saber como usá-las corretamente. O system prompt padrão do Pi já referencia documentação interna via URLs `pi-internal://` — ao substituir, você perde esse self-help.

---

## 6. Git worktree + Pi: workflow paralelo

Git worktrees permitem múltiplos checkouts do mesmo repo, cada um em um diretório separado. Combinado com múltiplas instâncias do Pi, você pode paralelizar trabalho em features, bugs e reviews simultaneamente.

### Setup passo-a-passo

```bash
# 1. Crie a estrutura de worktrees
cd ~/projects/myapp
git worktree add ../myapp-feature-auth feature/auth
git worktree add ../myapp-fix-perf fix/performance
git worktree add ../myapp-review-pr review/pr-42

# 2. Copie arquivos não-trackeados (worktrees não herdam .env, node_modules)
cp .env ../myapp-feature-auth/.env
cp .env ../myapp-fix-perf/.env

# 3. Instale dependências em cada worktree
cd ../myapp-feature-auth && pnpm install
cd ../myapp-fix-perf && pnpm install

# 4. Inicie instâncias do Pi em cada worktree
# Terminal 1:
cd ~/projects/myapp-feature-auth && pi
# Terminal 2:
cd ~/projects/myapp-fix-perf && pi
# Terminal 3:
cd ~/projects/myapp-review-pr && pi --tools read,grep,find,ls -p "Review completo deste PR"
```

### Automação com tmux

```bash
#!/bin/bash
# worktree-agents.sh — Inicia múltiplos agentes Pi em paralelo

PROJECT="myapp"
BASE_DIR="$HOME/projects"

# Cria sessão tmux
tmux new-session -d -s pi-agents -x 200 -y 50

# Painel 1: Feature
tmux send-keys -t pi-agents "cd $BASE_DIR/$PROJECT-feature-auth && pi" Enter

# Painel 2: Bug fix
tmux split-window -h -t pi-agents
tmux send-keys -t pi-agents "cd $BASE_DIR/$PROJECT-fix-perf && pi" Enter

# Painel 3: Review (read-only)
tmux split-window -v -t pi-agents
tmux send-keys -t pi-agents "cd $BASE_DIR/$PROJECT-review-pr && pi --tools read,grep,find,ls" Enter

# Conecta à sessão
tmux attach -t pi-agents
```

### Regras críticas para multi-agent em worktrees

**Estas regras devem estar no AGENTS.md de cada worktree:**

```markdown
## Multi-Agent Git Safety Rules
- NUNCA use `git add -A` ou `git add .` — isso captura mudanças de outros agentes
- SEMPRE use `git add <caminhos-específicos-do-arquivo>`
- Rode `git status` ANTES de cada commit para verificar o staging area
- Prefixe commits: `feat(auth): ...` para rastreabilidade
- Se houver conflitos, NÃO resolva automaticamente — peça instrução ao usuário
```

**Ferramentas da comunidade para orquestração:**
- **PiSwarm** — Processamento paralelo de issues/PRs com Pi + git worktrees
- **workmux** — Auto-detecção de agentes, cópia de `.env`, gerenciamento de tmux windows
- **dmux** — Multiplexador de agentes dev com A/B launches e merge inteligente
- **agtx** — TUI estilo Kanban com isolamento por worktree

### Cleanup

```bash
# Remover worktrees quando terminar
git worktree remove ../myapp-feature-auth
git worktree remove ../myapp-fix-perf
git worktree remove ../myapp-review-pr

# Ou listar e limpar órfãos
git worktree list
git worktree prune
```

> ⚠️ **Gotcha**: Worktrees são checkouts limpos — arquivos gitignored como `.env`, `node_modules/`, `.next/` NÃO são copiados. Use `pnpm` para economizar disco com node_modules via symlinks. Worktrees com nomes como `feature/api/v2` (barras no nome) podem causar problemas — use hífens.

---

## 7. Multi-agent orchestration

O Pi deliberadamente não inclui sub-agents nativos. A razão: "Quando Claude Code spawna um sub-agent, você tem zero visibilidade do que ele faz. É uma caixa preta dentro de uma caixa preta." Em vez disso, o Pi oferece primitivas para você construir a orquestração que precisa.

### Pattern 1: pi --print para scripting

```bash
# Code review automatizado
review=$(pi -p @src/auth.ts "Revise este código para bugs, segurança e performance. Seja conciso.")
echo "$review" > review-report.md

# Pipeline: análise → refactor → testes
analysis=$(pi -p "Analise a arquitetura de src/ e identifique 3 melhorias prioritárias")
refactor=$(pi -p "Dado esta análise: $analysis — implemente a melhoria #1")
tests=$(pi -p "Escreva testes para as mudanças recentes em src/")
```

### Pattern 2: tmux com múltiplos agentes

```bash
# Agente de testes em paralelo com agente de implementação
tmux new-session -d -s dev-agents

# Painel principal: implementação
tmux send-keys -t dev-agents "pi" Enter

# Painel lateral: agente de testes (watch mode)
tmux split-window -h -t dev-agents
tmux send-keys -t dev-agents "pi -p 'Monitore src/ e rode pnpm test a cada mudança. Reporte falhas.'" Enter
```

### Pattern 3: extensão de sub-agent (programático)

O Pi tem exemplos de extensões de sub-agent em `packages/coding-agent/examples/extensions/subagent/`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("review", {
    description: "Spawn review agent in background",
    handler: async (args, ctx) => {
      // Executa pi -p como sub-processo
      const result = await pi.exec(
        `pi -p --model anthropic/claude-sonnet-4 @${args} "Review este arquivo para bugs e segurança"`,
        { timeout: 120000 }
      );
      ctx.ui.notify("Review completo!", "success");
      // Injeta resultado na conversa
      await pi.sendUserMessage(`Resultado do review:\n${result.stdout}`);
    },
  });
}
```

### Pattern 4: pi-messenger (multi-agent completo)

O pacote `pi-messenger` implementa comunicação multi-agent com roles:

```bash
pi install npm:pi-messenger
```

O sistema implementa Crew (planner → workers paralelos → reviewer), living presence com status indicators, e coordenação baseada em arquivos. Configurável para usar modelos baratos para workers e modelos potentes para planner/reviewer.

### Pattern 5: extensão /control (Armin Ronacher)

Uma abordagem simples onde um Pi envia prompts para outro Pi:

```bash
# Instalar extensões do Armin
pi install git:github.com/mitsuhiko/agent-stuff
# Uso: /control envia instruções para outra instância Pi
```

---

## 8. Sistema de extensões: do zero ao avançado

Extensões são módulos TypeScript carregados via `jiti` (sem compilação necessária). Elas são o mecanismo primário de customização do Pi — **tudo** que o Pi não faz nativamente pode ser construído como extensão.

### Anatomia de uma extensão

```
~/.pi/agent/extensions/
└── minha-extensao/
    ├── index.ts        # Entry point (exporta default function)
    ├── package.json    # Opcional: dependências npm
    └── utils.ts        # Módulos auxiliares
```

**Template mínimo:**

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Tudo é registrado aqui
}
```

### Registrando ferramentas (tools)

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "deploy",
    label: "Deploy",
    description: "Deploy para staging ou production",
    parameters: Type.Object({
      environment: Type.String({
        description: "Ambiente: staging ou production",
        enum: ["staging", "production"]  // StringEnum para compatibilidade Google
      }),
      version: Type.Optional(Type.String({ description: "Tag de versão" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Feedback de progresso
      onUpdate?.({ content: [{ type: "text", text: `Deploying to ${params.environment}...` }] });

      const cmd = params.environment === "production"
        ? `./scripts/deploy.sh prod ${params.version || "latest"}`
        : `./scripts/deploy.sh staging`;

      const result = await pi.exec(cmd, { timeout: 300000 });

      return {
        content: [{ type: "text", text: result.stdout }],
        details: { exitCode: result.exitCode },
      };
    },
  });
}
```

### Registrando comandos slash

```typescript
pi.registerCommand("stats", {
  description: "Mostra estatísticas do projeto",
  handler: async (args, ctx) => {
    const result = await pi.exec("tokei --output json .");
    const stats = JSON.parse(result.stdout);
    ctx.ui.notify(`Total: ${stats.Total.code} linhas de código`, "info");
  },
});
```

### Registrando atalhos de teclado

```typescript
pi.registerShortcut("ctrl+d", {
  description: "Quick deploy staging",
  handler: async (ctx) => {
    const ok = await ctx.ui.confirm("Deploy", "Deploy para staging?");
    if (ok) {
      await pi.exec("./scripts/deploy.sh staging");
      ctx.ui.notify("Deploy concluído!", "success");
    }
  },
});
```

### Registrando flags CLI

```typescript
pi.registerFlag("plan", {
  description: "Iniciar em plan mode",
  type: "boolean",
  default: false,
});

// Uso posterior
if (pi.getFlag("--plan")) {
  // Ativar lógica de plan mode
}
```

### Lifecycle hooks completo

O Pi expõe **20+ eventos** que extensões podem interceptar:

```
session_start → user envia prompt
  → input (interceptar/transformar input do usuário)
  → before_agent_start (injetar contexto, modificar prompt)
  → agent_start
    → turn_start
      → context (modificar mensagens antes do LLM — NÃO persiste)
      → [LLM responde, pode usar tools:]
        → tool_call (bloquear/aprovar tools)
        → tool_execution_start
        → tool_execution_update
        → tool_execution_end
        → tool_result (modificar resultado)
    → turn_end
  → agent_end
session_before_compact → session_compact
session_before_fork → session_fork
session_before_switch → session_switch
session_before_tree → session_tree
session_shutdown
terminal_input (input raw do terminal)
```

### Exemplo prático: permission gate

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const dangerousPatterns = [
    /rm\s+(-rf?|--recursive)\s/,
    /git\s+(reset|push\s+--force)/,
    /DROP\s+(TABLE|DATABASE)/i,
    /curl.*\|\s*bash/,
  ];

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const cmd = event.input?.command || "";
      const isDangerous = dangerousPatterns.some(p => p.test(cmd));

      if (isDangerous) {
        const ok = await ctx.ui.confirm(
          "⚠️ Comando Perigoso",
          `Executar: ${cmd}?`
        );
        if (!ok) {
          return { block: true, reason: "Comando bloqueado pelo usuário" };
        }
      }
    }
  });
}
```

### Exemplo prático: injeção de contexto dinâmico

```typescript
export default function (pi: ExtensionAPI) {
  // Injeta contexto antes de cada chamada ao LLM
  pi.on("context", (event, ctx) => {
    // Adiciona informações sobre arquivos alterados recentemente
    const recentFiles = execSync("git diff --name-only HEAD~5").toString();
    event.messages.push({
      role: "user",
      content: `[Contexto automático] Arquivos alterados recentemente:\n${recentFiles}`,
    });
  });
}
```

### TUI customizada

```typescript
// Status bar customizada
ctx.ui.setStatus("deploy", "🚀 Último deploy: staging @ 14:32");

// Widget acima/abaixo do editor
ctx.ui.setWidget("metrics", [
  "Tokens: 45,231 | Cache: 89% | Custo: $0.42",
  "Modelo: claude-4-sonnet | Thinking: high",
]);

// Editor de texto multi-linha
const code = await ctx.ui.editor("Cole o código para review");

// Notificação
ctx.ui.notify("Build concluído com sucesso!", "success");

// Confirmação
const proceed = await ctx.ui.confirm("Continuar?", "Isso vai alterar 15 arquivos.");
```

### Discovery e hot reload

Extensões são descobertas automaticamente em:
- `~/.pi/agent/extensions/` (global)
- `.pi/extensions/` (projeto)
- Via `settings.json` (packages e paths customizados)

O **hot reload** permite que o próprio agente escreva extensões, recarregue e teste em loop:

```typescript
await ctx.reload(); // Recarrega extensões, skills, prompts, temas
```

Como Armin Ronacher coloca: "A ideia central do Pi é que se você quer que o agente faça algo, peça ao agente para se estender."

> ⚠️ **Gotcha**: Extensões com dependências npm precisam de um `package.json` local. Use `"*"` range para peer dependencies do Pi (`@mariozechner/pi-coding-agent`, `@sinclair/typebox`) — não faça bundle delas.

---

## 9. Skills e context engineering

Skills implementam o padrão Agent Skills — pacotes de capacidade carregados sob demanda. A diferença crítica para MCP: **skills usam progressive disclosure**, mantendo apenas descrições no contexto e carregando instruções completas quando invocadas.

### Comparação de custo em tokens

| Abordagem | Tokens no contexto | Quando |
|---|---|---|
| MCP Playwright | ~13.700 tokens (21 tools) | **Sempre** (7-9% do context window) |
| MCP Chrome DevTools | ~18.000 tokens (26 tools) | **Sempre** |
| Skill equivalente | ~50 tokens (descrição) | Instruções completas **só quando invocada** |

### Estrutura de uma skill

```
~/.pi/agent/skills/
└── web-search/
    ├── SKILL.md            # Obrigatório: frontmatter + instruções
    ├── scripts/
    │   └── search.js       # CLI tool invocável via bash
    ├── references/
    │   └── api-docs.md     # Docs detalhadas carregadas on-demand
    └── package.json        # Dependências se necessário
```

### SKILL.md formato

```markdown
---
name: web-search
description: Busca na web via Brave Search API. Use para documentação, fatos ou conteúdo web.
---
# Web Search

## Setup
```bash
export BRAVE_API_KEY=your-key
cd ~/.pi/agent/skills/web-search && npm install
```

## Uso
```bash
./scripts/search.js "query"              # Busca básica
./scripts/search.js "query" --content    # Inclui conteúdo das páginas
./scripts/search.js "query" --count 20   # Mais resultados
```

## Notas
- Rate limit: 1 req/segundo no plano free
- Resultados truncados a 5000 chars por página com --content
```

### Discovery de skills

```
~/.pi/agent/skills/          ← Global
~/.agents/skills/            ← Global (formato novo)
.pi/skills/                  ← Projeto
.agents/skills/              ← Projeto (busca até git root)
Packages instalados          ← Via pi install
```

**Compatibilidade cross-agent**: Skills do Pi são compatíveis com Claude Code (`~/.claude/skills`) e Codex CLI (`~/.codex/skills`).

### Invocação

```bash
/skill:web-search             # Carrega e executa
/skill:pdf-tools extract      # Com argumentos
```

### Skills oficiais (github.com/badlogic/pi-skills)

O repositório oficial inclui: `brave-search`, `browser-tools`, `gccli` (Google Calendar), `gdcli` (Google Drive), `gmcli` (Gmail), `transcribe` (Groq Whisper), `vscode`, `youtube-transcript`.

### Compactação customizada

Quando o contexto se aproxima do limite, o Pi auto-sumariza mensagens antigas. Via extensões, você controla completamente este processo:

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  // Compactação customizada preservando caminhos de arquivo e mudanças de código
  event.customInstructions = `
    Ao sumarizar, preserve:
    1. Todos os caminhos de arquivo mencionados
    2. Decisões arquiteturais tomadas
    3. Erros encontrados e suas resoluções
    4. Estado atual do que está implementado vs pendente

    Descarte: conversas sobre formatação, tentativas falhas já corrigidas.
  `;
});
```

### RAG via extensões

```typescript
// Exemplo: busca semântica no codebase antes de cada turn
pi.on("before_agent_start", async (event, ctx) => {
  const query = event.userMessage;
  // Use qualquer embedding service/vector DB
  const relevantFiles = await searchCodebase(query);
  event.injectedContext = relevantFiles
    .map(f => `[Arquivo relevante: ${f.path}]\n${f.snippet}`)
    .join("\n\n");
});
```

---

## 10. Session management e branching

Sessões no Pi são **árvores**, não listas lineares. Cada entrada tem um `id` e `parentId`, formando uma estrutura que permite branching, navegação e side-quests sem perder contexto.

### Armazenamento

Sessões são arquivos JSONL em `~/.pi/agent/sessions/<encoded-cwd>/`. Cada branch vive no mesmo arquivo — o branching apenas move o ponteiro da folha.

### Comandos de sessão

| Comando | Atalho | Descrição |
|---|---|---|
| `/new` | — | Nova sessão limpa |
| `/resume` | `pi -r` | Navegar e selecionar entre sessões passadas |
| `/tree` | — | Visualizar e navegar a árvore da sessão |
| `/fork` | — | Fork da sessão no ponto atual |
| `/export` | — | Exportar sessão para HTML |
| `/share` | — | Upload para GitHub Gist, retorna URL compartilhável |
| `/compact` | — | Forçar compactação manual |
| `pi -c` | CLI | Continuar sessão mais recente |
| `pi --no-session` | CLI | Modo efêmero (sem persistência) |

### Workflow com tree branching

```
Sessão principal: implementando feature
├── Turn 1: Planejamento
├── Turn 2: Implementação do modelo
├── Turn 3: Implementação da API
│   └── [/fork] Branch: "Investigar bug no middleware"
│       ├── Turn 3a: Debug do middleware
│       ├── Turn 3b: Fix aplicado
│       └── [volta ao ponto 3, Pi sumariza o branch]
├── Turn 4: Continua com o fix incorporado
└── Turn 5: Testes
```

Armin Ronacher descreve isso como "side-quests para corrigir ferramentas quebradas sem desperdiçar o contexto da sessão principal — depois de corrigir, rebobina e o Pi sumariza o outro branch."

### Mensagens durante streaming

Enquanto o agente está trabalhando:
- **Enter** → envia steering message (interrompe após o tool atual, reorienta o agente)
- **Alt+Enter** → envia follow-up (espera o agente terminar, depois processa)
- **Escape** → aborta a execução atual

### CLI para sessões específicas

```bash
# Usar arquivo de sessão específico
pi --session ./my-session.jsonl

# Diretório customizado de sessões
pi --session-dir ./project-sessions/

# Modo efêmero (nada persiste)
pi --no-session
```

---

## 11. Prompt templates

Templates de prompt são arquivos Markdown reutilizáveis que expandem ao digitar `/nome` no editor.

### Localização

```
~/.pi/agent/prompts/     ← Global
.pi/prompts/             ← Projeto
Packages instalados      ← Via pi install
```

Subdiretórios criam namespaces: `.pi/prompts/frontend/component.md` → `/component` (project:frontend).

### Template para code review

```markdown
<!-- ~/.pi/agent/prompts/review.md -->
Faça um code review completo dos arquivos alterados recentemente.

Analise:
1. **Bugs**: Condições de corrida, null references, edge cases não tratados
2. **Segurança**: Injeção, XSS, exposição de dados, auth bypass
3. **Performance**: N+1 queries, loops desnecessários, memory leaks
4. **Manutenibilidade**: Código duplicado, abstrações ruins, nomes confusos

Para cada issue encontrada, forneça:
- Arquivo e linha
- Severidade (🔴 crítica, 🟡 média, 🟢 sugestão)
- Código problemático
- Correção sugerida

Rode: `git diff --name-only HEAD~3` para identificar os arquivos alterados.
```

### Template para testes

```markdown
<!-- ~/.pi/agent/prompts/test.md -->
Escreva testes abrangentes para os arquivos alterados recentemente.

1. Rode `git diff --name-only HEAD~1` para identificar mudanças
2. Para cada arquivo alterado:
   - Leia o arquivo e entenda a lógica
   - Crie testes unitários cobrindo happy path e edge cases
   - Use o framework de testes existente no projeto (vitest/jest/pytest)
3. Rode os testes: identifique o comando no package.json
4. Corrija falhas até todos passarem
```

### Template para documentação

```markdown
<!-- ~/.pi/agent/prompts/docs.md -->
Atualize a documentação para refletir mudanças recentes.

1. Identifique mudanças: `git log --oneline -10`
2. Leia o README.md existente
3. Atualize seções relevantes:
   - Novas features → adicione descrição e exemplos
   - APIs alteradas → atualize assinaturas e exemplos
   - Breaking changes → documente migração
4. Mantenha o tom e formato existentes
5. Verifique links internos
```

### Template para refactoring

```markdown
<!-- ~/.pi/agent/prompts/refactor.md -->
Refatore o código especificado seguindo estas prioridades:

1. **Elimine duplicação**: Identifique código repetido e extraia abstrações
2. **Simplifique complexidade**: Funções com complexidade ciclomática > 10
3. **Melhore nomes**: Variáveis, funções e classes com nomes ambíguos
4. **Separe responsabilidades**: Funções fazendo mais de uma coisa
5. **Adicione tipos**: Substitua any/unknown por tipos específicos

Regras:
- Mantenha comportamento externo idêntico
- Rode testes antes E depois do refactoring
- Commit incremental (uma mudança por commit)
```

---

## 12. Ecossistema de pacotes

O Pi tem um ecossistema de **200+ pacotes** no npm, descobertos pela keyword `pi-package`. O site pi.dev/packages oferece uma galeria curada com filtros.

### Instalação e gerenciamento

```bash
# Instalar de npm
pi install npm:@foo/pi-tools
pi install npm:@foo/pi-tools@1.2.3    # Versão fixada (não atualiza com pi update)

# Instalar de git
pi install git:github.com/mitsuhiko/agent-stuff
pi install git:github.com/user/repo@v1    # Tag ou commit

# Instalar de URL ou path local
pi install https://github.com/user/repo
pi install ./meu-pacote-local

# Escopo projeto (compartilhado com time, auto-instala em startup)
pi install npm:@foo/pi-tools -l

# Testar sem instalar
pi -e git:github.com/user/repo     # Carrega temporariamente

# Gerenciamento
pi list                 # Listar pacotes instalados
pi update               # Atualizar não-fixados
pi remove npm:@foo/bar  # Remover
pi config               # Habilitar/desabilitar recursos de pacotes
```

### Pacotes notáveis da comunidade

| Pacote | Autor | Descrição |
|---|---|---|
| `agent-stuff` | Armin Ronacher | /answer, /todos, /review, /control, /files, skills para CDP, git, Sentry |
| `shitty-extensions` | hjanuschka | memory-mode, plan-mode, oracle (second opinion), cost-tracker, usage-bar |
| `pi-messenger` | nicobailon | Multi-agent com Crew system (planner/worker/reviewer) |
| `pi-web-access` | nicobailon | Web search, fetch URLs, GitHub clone, PDF, YouTube |
| `pi-rewind-hook` | nicobailon | Checkpoints baseados em git + branching de conversas |
| `pi-hooks` | prateekmedia | Checkpoint (git), LSP, permission (4 níveis) |
| `pi-ralph` | — | Técnica Ralph Wiggum para dev iterativo autônomo |
| `gondolin` | — | Sandbox micro-VM Linux |
| `pi-ssh-remote` | — | Redireciona operações para host remoto via SSH |
| `oh-my-pi` | can1357 | Setup one-click, LSP, Python tool, browser tool, 6 subagents, 65+ temas |

### Criando seu próprio pacote

```json
{
  "name": "@meuuser/pi-meu-pacote",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

Se o campo `pi` não estiver presente, o Pi auto-descobre a partir de diretórios convencionais (`extensions/`, `skills/`, `prompts/`, `themes/`).

**Peer dependencies (use `"*"` range, não faça bundle):**

```json
{
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-agent-core": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

Publique no npm com `npm publish` e o pacote aparecerá em buscas por `pi-package`.

---

## 13. Segurança e sandboxing

O Pi opera em **modo YOLO por padrão**: acesso irrestrito ao filesystem, execução de qualquer comando sem prompts de permissão. A posição do criador é clara: "todos estão rodando em YOLO mode pra conseguir ser produtivos, então por que não fazer disso o padrão e única opção?"

### Se você precisa de guardrails, construa-os

**Opção 1: Extensão de proteção de paths**

```typescript
// .pi/extensions/protected-paths.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const BLOCKED_PATHS = [
  /\.env$/,
  /\.ssh\//,
  /\.aws\//,
  /\.kube\/config/,
  /\.pem$/,
  /\.key$/,
];

const READ_ONLY_PATHS = [
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /\.git\//,
  /Dockerfile$/,
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const path = event.input?.path || event.input?.filePath || "";

    if (BLOCKED_PATHS.some(p => p.test(path))) {
      return { block: true, reason: `Acesso bloqueado: ${path} é um arquivo protegido` };
    }

    if (["write", "edit"].includes(event.toolName) && READ_ONLY_PATHS.some(p => p.test(path))) {
      return { block: true, reason: `${path} é read-only` };
    }
  });
}
```

**Opção 2: Confirmation flow para comandos perigosos**

Use a extensão `permission-gate.ts` incluída nos exemplos do Pi, ou o pacote `pi-hooks` com 4 níveis de permissão (off, low, medium, high).

**Opção 3: Containerização**

```bash
# Docker isolado
docker run -it --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  node:22 bash -c "npm i -g @mariozechner/pi-coding-agent && pi"

# gondolin: micro-VM Linux dedicada
pi install git:github.com/gondolin/gondolin
```

**Opção 4: Filtro de output (redação de segredos)**

O pacote `filter-output` de michalvavra reduz API keys, tokens e senhas dos resultados de tools antes que o LLM os veja — útil para prevenir exfiltração acidental de credenciais via prompt injection.

> ⚠️ **Aviso de segurança oficial**: "Pi packages rodam com acesso total ao sistema. Extensões executam código arbitrário, e skills podem instruir o modelo a realizar qualquer ação. Revise o código-fonte antes de instalar pacotes de terceiros."

---

## 14. Troubleshooting e dicas da comunidade

### Problemas comuns e soluções

**"Command not found" após instalar via npm**
```bash
# Verifique se o global bin está no PATH
npm config get prefix
# Adicione ao .bashrc/.zshrc se necessário:
export PATH="$(npm config get prefix)/bin:$PATH"
```

**macOS bloqueia binário standalone**
```bash
xattr -c ./pi
```

**Windows: "bash not found"**

O Pi requer bash. Prioridade de busca:
1. `shellPath` em `~/.pi/agent/settings.json`
2. Git Bash em `C:\Program Files\Git\bin\bash.exe`
3. `bash.exe` no PATH (Cygwin, MSYS2, WSL)

```json
// ~/.pi/agent/settings.json
{
  "shellPath": "C:\\Program Files\\Git\\bin\\bash.exe"
}
```

**API key não reconhecida**

O Pi NÃO carrega `.env` automaticamente. Verifique:
```bash
echo $ANTHROPIC_API_KEY  # Deve retornar a chave
# Se vazio, adicione ao shell:
echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.zshrc
source ~/.zshrc
```

Ou use `~/.pi/agent/auth.json` (recomendado).

**Contexto esgotando rápido**
- Use `/compact` manualmente ou habilite auto-compact via `/settings`
- Reduza o AGENTS.md (manter abaixo de 2K tokens)
- Use skills ao invés de MCP (progressive disclosure)
- Fork sessões longas com `/fork` para começar fresco mantendo o histórico
- Customize compactação via extensão para preservar informações críticas

**Extensão não carrega**
```bash
# Verifique se jiti consegue resolver
pi --verbose
# Verifique a estrutura — deve exportar default function
# Verifique peer dependencies — use "*" range
# Hot reload: /reload ou ctx.reload() de dentro da extensão
```

**Modelo customizado não aparece**
- Edite `~/.pi/agent/models.json` e reabra `/model` (recarrega automaticamente)
- Verifique se o `api` está correto: `"openai-completions"`, `"anthropic"`, ou `"google"`
- Verifique se `baseUrl` está acessível: `curl http://localhost:11434/v1/models`

### Dicas de otimização

**Troca de modelo estratégica mid-session**: Comece com Claude Opus para exploração e planejamento, troque para GPT para segunda opinião, use Gemini para contextos largos. Use `Ctrl+P` para ciclar rapidamente.

**Read-only mode para exploração**:
```bash
pi --tools read,grep,find,ls -p "Analise a arquitetura deste codebase"
```

**Deixe o Pi se auto-estender**: Aponte o agente para uma extensão existente e peça: "Construa uma extensão similar a esta, mas que faça X". O Pi lê a documentação, escreve a extensão, recarrega e testa.

**Context gathering primeiro**: Faça a coleta de contexto em uma sessão separada, crie um artefato (markdown, JSON), e use esse artefato em uma sessão nova. Isso é mais eficiente que misturar exploração e implementação.

**Planos persistentes**: Em vez de plan mode efêmero, escreva planos em `PLAN.md` e tarefas em `TODO.md` com checkboxes — persistem entre sessões e podem ser versionados.

**CLI tools com README ao invés de MCP**: Construa ferramentas como CLIs com um README explicativo. O agente lê o README quando precisa, paga o custo em tokens apenas quando necessário, e usa bash para invocar.

---

## 15. Referência rápida de atalhos e comandos

### Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Ctrl+L` | Seletor de modelos |
| `Ctrl+P` / `Shift+Ctrl+P` | Ciclar modelos favoritos |
| `Shift+Tab` | Ciclar thinking levels |
| `Enter` (durante streaming) | Steering message (interrompe) |
| `Alt+Enter` | Follow-up (espera terminar) |
| `Escape` | Abortar |
| `Ctrl+V` | Colar (incluindo imagens do clipboard) |
| `Ctrl+K` / `Ctrl+Y` / `Alt+Y` | Kill ring (estilo Emacs) |
| `Ctrl+Z` | Desfazer |
| `/hotkeys` | Mostrar todos os atalhos |

### Flags CLI essenciais

```bash
pi                           # Interativo
pi -p "query"                # Print mode
pi -c                        # Continuar última sessão
pi -r                        # Navegar sessões
pi --no-session              # Efêmero
pi --model provider/model    # Modelo específico
pi --thinking high           # Nível de thinking
pi --tools read,grep,find,ls # Read-only
pi -ne                       # Sem extensões
pi -ns                       # Sem skills
pi -np                       # Sem prompt templates
pi --verbose                 # Output detalhado
pi @file.ts "Explique"       # Input com arquivo
pi --export session.jsonl     # Exportar HTML
```

### Recursos essenciais

O repositório oficial contém **50+ extensões de exemplo** em `packages/coding-agent/examples/extensions/`, incluindo: `subagent/`, `plan-mode/`, `permission-gate.ts`, `protected-paths.ts`, `ssh.ts`, `sandbox/`, `doom-overlay/`, `custom-compaction.ts`, `snake.ts`.

A documentação técnica completa vive em `packages/coding-agent/docs/` no GitHub com arquivos dedicados para: extensions, models, packages, skills, sdk, rpc, settings, session, compaction, keybindings, themes, providers, custom-provider, tui, e development.

---

## Conclusão: o Pi como plataforma

O Pi representa uma aposta filosófica forte: **menos é mais quando o "mais" é extensível**. O system prompt de 1.000 tokens funciona porque os modelos frontier já sabem o que um coding agent faz. As 4 ferramentas bastam porque bash pode invocar qualquer coisa. E a ausência de features built-in não é um defeito — é espaço para extensões que fazem exatamente o que você precisa.

A lição mais prática que emerge da comunidade é a abordagem de **auto-extensão**: peça ao Pi para construir suas próprias extensões. Armin Ronacher resume: "Nenhuma das minhas extensões foi escrita por mim — foram criadas pelo agente conforme minhas especificações." Esse loop de extensão-via-agente é o que transforma o Pi de um tool minimalista em uma plataforma que se molda ao seu workflow específico.

Para power users, o caminho é claro: comece com AGENTS.md bem estruturado, adicione skills conforme necessidade (não MCPs), construa extensões iterativamente com o próprio agente, e use worktrees + tmux para paralelizar. O ecossistema de 200+ pacotes já resolve a maioria dos casos comuns — e quando não resolve, a extensão que falta está a um prompt de distância.