# Pi Coding Agent — Documentação Completa
**Pi** é um harness de agente de codificação terminal minimalista e extensível, criado por **Mario Zechner** ([@badlogic](https://github.com/badlogic)), como alternativa filosófica ao Claude Code. A premissa central é: *adapte o Pi ao seu workflow, não o contrário*. [youtube](https://www.youtube.com/watch?v=f8cfH5XX-XU)

## Instalação
```bash
npm install -g @mariozechner/pi-coding-agent
```
A versão mais recente no npm é `0.54.0`, publicada há poucos dias. Pi roda em **Windows, Linux e macOS** — qualquer sistema com Node.js e um terminal. [npmjs](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)

## Filosofia de Design
Pi foi construído como reação direta ao inchaço de ferramentas como Claude Code, que ao longo do tempo acumulou sub-agentes, plan mode, permission popups e um system prompt de 12.000 tokens. O criador enumera os princípios: [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- **Core mínimo**: system prompt + definições de ferramentas somam menos de 1.000 tokens no total [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- **YOLO por padrão**: sem prompts de permissão, sem rails de segurança — acesso total ao filesystem [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- **Extensibilidade total**: features que outros tools "bake in" você constrói via extensões ou instala como pacote
- **Observabilidade completa**: você vê exatamente o que vai para o context window, sem injeções ocultas [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)

## Ferramentas Nativas (Core Tools)
Pi usa apenas **4 ferramentas**, suficientes para qualquer tarefa de codificação. [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
| Ferramenta | Descrição |
|---|---|
| `read` | Lê conteúdo de arquivos (texto e imagens). Suporte a `offset`/`limit` para arquivos grandes |
| `write` | Cria ou sobrescreve arquivos, criando diretórios pai automaticamente |
| `edit` | Edição cirúrgica por substituição exata de texto (`oldText` → `newText`) |
| `bash` | Executa comandos bash no diretório atual; retorna stdout e stderr |
Ferramentas read-only adicionais (`grep`, `find`, `ls`) podem ser habilitadas com `--tools read,grep,find,ls` para um modo de exploração sem modificações. Compare isso com os 20+ tools do Claude Code, cada um com descrições detalhadas que se referenciam entre si. [reddit](https://www.reddit.com/r/ClaudeAI/comments/1p92gdn/claude_code_is_the_best_coding_agent_in_the/)

## System Prompt
O system prompt completo de Pi é: [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
```
You are an expert coding assistant. You help users with coding tasks by reading
files, executing commands, editing code, and writing new files.
Available tools:
- read: Read file contents
- bash: Execute bash commands
- edit: Make surgical edits to files
- write: Create or overwrite files
Guidelines:
- Use bash for file operations like ls, grep, find
- Use read to examine files before editing
- Use edit for precise changes (old text must match exactly)
- Use write only for new files or complete rewrites
- Be concise in your responses
- Show file paths clearly when working with files
```
A única injeção automática é o conteúdo do arquivo `AGENTS.md` do projeto e do global. Isso contrasta fortemente com o prompt de 12.000 tokens do Claude Code. [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)

## Provedores Suportados
Pi suporta nativa ou via OpenAI-compat os seguintes provedores:
- **Cloud**: Anthropic (Claude), OpenAI, Google (Gemini), Azure, AWS Bedrock, Mistral, Groq, Cerebras, xAI (Grok), Hugging Face, Kimi for Coding, MiniMax
- **Roteadores**: OpenRouter
- **Self-hosted**: Ollama, llama.cpp, vLLM, LM Studio (qualquer endpoint OpenAI-compatible)
Você pode **trocar de modelo no meio da sessão** com `/model` ou `Ctrl+L`, e ciclar pelos seus favoritos com `Ctrl+P`. Provedores e modelos customizados são adicionados via `models.json` ou extensões.

## Modos de Operação
Pi possui 4 modos de operação:
| Modo | Como usar | Para quê |
|---|---|---|
| **Interactive** | `pi` | TUI completa no terminal |
| **Print/JSON** | `pi -p "query"` ou `--mode json` | Scripts e automações, retorna event stream |
| **RPC** | JSON protocol via stdin/stdout | Integrações com linguagens não-Node |
| **SDK** | `import` programático | Embutir Pi em outras aplicações |

## Gerenciamento de Sessões
Sessões são armazenadas como **árvores**, não como arquivos lineares. Isso permite:
- `/tree` — Navegar para qualquer ponto anterior e continuar a partir dali
- **Branching**: todas as branches vivem em um único arquivo
- Filtragem por tipo de mensagem
- **Bookmarks**: marque entradas importantes com labels
- `/export` — Exportar sessão como HTML
- `/share` — Upload para GitHub Gist e obter URL compartilhável

## Context Engineering
Esta é a área onde Pi se diferencia mais fortemente de outros agents. [reddit](https://www.reddit.com/r/ClaudeCode/comments/1qslht2/pi_vs_claude_code_open_minimalistic_vs_closed_and/)
### Arquivos de Contexto
- **`AGENTS.md`**: Instruções de projeto carregadas hierarquicamente (global `~/.pi/agent/`, diretórios pai, diretório atual)
- **`SYSTEM.md`**: Substitui ou adiciona ao system prompt padrão por projeto
### Compactação
Auto-sumariza mensagens antigas quando se aproxima do limite de contexto. Totalmente customizável via extensões: você pode implementar compactação baseada em tópicos, sumários cientes de código, ou usar modelos diferentes para summarização.
### Skills
Pacotes de capacidades com instruções e ferramentas, carregados **sob demanda**. Isso evita inflar o prompt cache logo de início — progressive disclosure sem quebrar o cache.
### Contexto Dinâmico
Extensões podem injetar mensagens antes de cada turno, filtrar o histórico de mensagens, implementar RAG, ou construir memória de longo prazo.

## Sistema de Extensões
As extensões são **módulos TypeScript** com acesso completo à API do Pi. Elas podem: [github](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- Registrar ferramentas customizadas chamáveis pelo LLM
- Adicionar comandos slash (`/meu-comando`)
- Criar atalhos de teclado
- Subscrever a eventos de ciclo de vida (hooks)
- Criar componentes de TUI customizados (status bars, overlays, etc.)
- Modificar ferramentas nativas (rewriting de comandos bash via spawn hooks)
Exemplo de imports para uma extensão: [skills](https://skills.lc/aliou/pi-extensions/aliou-pi-extensions-pi-skills-pi-extension-skill-md)
```typescript
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-coding-agent";
import type { Component, Theme } from "@mariozechner/pi-tui";
import { Text, Box, Container, SelectList } from "@mariozechner/pi-tui";
```
Há mais de **50 exemplos** de extensões na documentação oficial. Casos de uso possíveis: sub-agents, plan mode, permission gates, path protection, SSH execution, sandboxing, integração MCP, editores customizados, status bars. E sim — [Doom roda no Pi](https://github.com/badlogic/pi-doom).

## Sistema de Pacotes
Pi tem seu próprio ecossistema de pacotes instaláveis via npm ou git:
```bash
# Instalar do npm
pi install npm:@foo/pi-tools
# Instalar do git
pi install git:github.com/badlogic/pi-doom
# Testar sem instalar
pi -e git:github.com/user/repo
# Gerenciar
pi update # Atualizar todos
pi list # Listar instalados
pi config # Configurar
```
Pacotes usam o keyword `pi-package` no npm para serem descobertos. Você pode fixar versões com `@1.2.3` ou `@tag`.

## Arquitetura Interna (Monorepo)
Pi é um monorepo TypeScript composto por pacotes que se empilham: [libraries](https://libraries.io/npm/@mariozechner%2Fcoding-agent)
| Pacote | Função |
|---|---|
| `@mariozechner/pi-ai` | API LLM unificada multi-provider (OpenAI, Anthropic, Google, etc.) com streaming, tool calling via TypeBox, thinking/reasoning, cross-provider context handoff e tracking de tokens/custos |
| `@mariozechner/pi-agent-core` | Agent loop com execução de ferramentas, validação, state management, message queuing e transport abstraction |
| `@mariozechner/pi-tui` | Framework de TUI com differential rendering, synchronized output e componentes como editor com autocomplete e markdown rendering |
| `@mariozechner/pi-coding-agent` | CLI principal que conecta tudo — session management, extensões, temas, context files |
O **differential rendering** do `pi-tui` compara as linhas renderizadas anteriormente com as novas e re-desenha apenas o que mudou, usando synchronized output escape sequences (`CSI ?2026h/l`) para rendering atômico sem flickering. [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)

## Prompt Templates (Templates de Prompt)
Templates são arquivos Markdown reutilizáveis. Você os invoca com `/nome-do-template` e eles suportam argumentos via `$@`. Exemplo de template para code review: [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
```markdown
---
description: Run a code review sub-agent
---
Spawn yourself as a sub-agent via bash to do a code review: $@
Use `pi --print` with appropriate arguments. If the user specifies a model,
use `--provider` and `--model` accordingly.
```

## O Que Pi Intencionalmente NÃO Tem
Esta é a seção mais reveladora da filosofia do Pi. Cada ausência é uma decisão deliberada:
| Feature ausente | Alternativa proposta | Razão |
|---|---|---|
| **MCP** | CLI tools com READMEs (Skills) | MCP servers como Playwright (21 tools, 13.7k tokens) consomem 7-9% do context window antes de você começar |
| **Sub-agents nativos** | `pi --print` via bash, tmux sessions | Falta de observabilidade, transferência de contexto pobre entre agents |
| **Permission popups** | Rode em container; segurança é teatro | Uma vez que o agent escreve e executa código, não há como conter exfiltração real |
| **Plan mode** | Arquivo `PLAN.md` editável colaborativamente | Plan mode do Claude Code tem zero observabilidade sobre o sub-agent que faz a análise |
| **To-dos nativos** | Arquivo `TODO.md` com checkboxes | Listas de tarefas tendem a confundir modelos mais do que ajudar |
| **Background bash** | tmux com visibilidade completa | Gerenciamento de processos em background adiciona complexidade opaca |

## Pi vs. Claude Code
[youtube](https://www.youtube.com/watch?v=f8cfH5XX-XU)
| Dimensão | Pi | Claude Code |
|---|---|---|
| **Filosofia** | Minimalista, extensível, YOLO | Feature-rich, out-of-the-box |
| **System prompt** | ~1.000 tokens | ~12.000 tokens |
| **Ferramentas nativas** | 4 (read, write, edit, bash) | 20+ tools com descrições cruzadas |
| **Modelos suportados** | Qualquer provider | Principalmente Anthropic (Bedrock/Vertex para outros) |
| **Extensibilidade** | TypeScript total: tools, TUI, hooks, shortcuts | Hooks limitados |
| **Sub-agents** | Manual via bash/tmux (total observabilidade) | Nativo, mas opaco |
| **Código fonte** | MIT, open-source | Fechado |
| **MCP** | Não (por design) | Sim |
| **Permission gates** | Não (YOLO) | Sim |
| **Customização de TUI** | Total (temas, overlays, widgets) | Limitada |
| **Session branching** | Sim (árvores) | Não |
| **Público-alvo** | Engenheiro avançado que quer controle total | Desenvolvedor que quer melhor experiência default |
A estratégia sugerida pela comunidade é: **80% Claude Code para uso default, 20% Pi para workflows customizados, multi-agent e experimentação** — pensar em "e", não "ou". [youtube](https://www.youtube.com/watch?v=f8cfH5XX-XU)

## Licença e Links
- **Licença**: MIT
- **Site**: [pi.dev](https://pi.dev/)
- **GitHub**: [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- **npm**: [@mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) [npmjs](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
- **Discord**: Comunidade para discussão e compartilhamento de pacotes
- **Criador**: Mario Zechner ([mariozechner.at](https://mariozechner.at)) [mariozechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)