# Pi Coding Agent — Guia Completo de Uso Avançado
*Baseado no vídeo "The Pi Coding Agent: The ONLY REAL Claude Code COMPETITOR" (fev/2026) + documentação técnica oficial* [lucumr.pocoo](https://lucumr.pocoo.org/2026/1/31/pi/)

## O Problema: Por Que Migrar do Claude Code?
Claude Code foi o primeiro agente de codificação viável e ainda é o líder do mercado. Mas todo produto bem-sucedido tende a se expandir para servir a massa ao invés de seu nicho original — no caso, engenheiros mid-senior. Com crescimento vem complexidade, opinião baked-in, lock-in de modelo, e impossibilidade de reverter mudanças que você não quer. Pi foi criado exatamente como contraataque a isso: open-source, sem opinião imposta, totalmente customizável. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)

## A Filosofia em Uma Frase
> *"There are many coding agents, but this one is mine."*
Esta é a tagline oficial do Pi. A ideia central é que o tool se adapta a você — não o contrário. Enquanto Claude Code maximiza a experiência padrão, Pi maximiza o controle que o engenheiro tem sobre cada aspecto do harness. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)

## Os Dois Pilares Centrais
| Pilar | O que significa na prática |
|---|---|
| **Open-source (MIT)** | Você pode fazer pin de versão, forkar, reverter qualquer mudança e nunca ser surpreendido por um update que quebra seu workflow [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt) |
| **Customizável ao core** | Desde a cor do texto no terminal até orquestração de múltiplos agents — tudo é modificável via extensões TypeScript [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt) |

## As 14 Versões de Pi — Progressão Incremental
O criador do vídeo demonstra 14 instâncias únicas do Pi, cada uma com um propósito específico, construídas de forma incremental. Essa progressão é o melhor guia prático para entender o que Pi permite. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)

### Pi v0 — Default Pi (Base)
O ponto de partida. Basta digitar `pi` no terminal: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```bash
pi
```
- Abre a TUI com o agent loop padrão
- Thinking sempre exposto na tela
- Footer com modelo atual (ex: `claude sonnet 4.6`) e tokens de contexto
- Comandos slash disponíveis: `/fork`, `/tree`, `/login`, `/compact`, `/resume`, etc.
- 4 ferramentas nativas: `read`, `write`, `edit`, `bash`

### Pi v1 — Pure Focus Pi (Foco Total)
Remove **toda** a informação da tela exceto o input e a resposta. Para engenheiros que querem entrar em flow state total: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```bash
pi -e pure-focus-extension
```
- Nenhuma UI além do terminal limpo
- Modelo, contexto, tokens — irrelevante
- Apenas você e o agente

### Pi v2 — Minimal Pi (Footer Customizado)
Adiciona de volta apenas o essencial — modelo e janela de contexto — via stack de extensões: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```bash
pi -e pure-focus-extension -e custom-footer-extension
```
- Footer customizado com modelo e % de contexto restante
- Demonstra o conceito de **stacking de extensões** — combinação livre de capabilities

### Pi v3 — Cross-Agent Pi (Carregamento Multi-Localização)
Demonstra como configurar o Pi para carregar **skills, commands e agents de múltiplos diretórios** simultaneamente: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
- Carrega 41+ skills globais customizadas
- Carrega agents do diretório local do projeto
- Carrega commands específicos do projeto (ex: `/classicprime`)
- Estrutura de referência: **Skills → Commands → Agents**

### Pi v4 — Purpose Gate Pi (Widget de Propósito)
Ao iniciar, o agente **pergunta qual é o propósito da sessão** antes de fazer qualquer coisa: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```
What is the purpose of this agent? > explore and discover this codebase
```
- O propósito é appendado ao system prompt de ~200 tokens
- Um **widget** persiste o propósito visível durante toda a sessão
- Garante que o agente nunca "perca o fio" da intenção original
- Aumenta a steerability global sem tocar no prompt base
**Como funciona o Widget:** Um widget é um componente de UI que persiste na tela durante toda a sessão terminal. Diferente de um status bar, pode exibir qualquer informação arbitrária e se atualiza via eventos do lifecycle. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)

### Pi v5 — Tool Counter Pi (Rastreamento de Ferramentas)
Adiciona um footer que rastreia em tempo real **quais ferramentas o agente está usando**: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
- `Waiting for tools` → estado de espera
- Após chamar `/prime`: lista todas as tool calls executadas
- Exibe tokens in/out por turno
- Footer customizado: `[claude-sonnet-4.6] [codebase:branch] [tools: read(3) bash(7)]`

### Pi v6 — Tool Counter Widget + Theme Cycler
Combina o tool counter com um **tema visual customizável** via `Ctrl+X`: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
- Widget de tools persiste na tela (não só no footer)
- 13 temas customizados, incluindo o favorito do autor: *SynthWave 84*
- Cicla entre temas com atalho de teclado registrado via extensão
- Claude Code tem ~4 temas padrão; Pi tem temas ilimitados por design

### Pi v7 — Subagent Widget Pi (Sub-Agents Manuais)
Pi não tem sub-agent support nativo. Então você **constrói o seu**: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```
/sub → spawna um sub-agent com aquele prompt
/sub remove → remove um sub-agent específico
/sub clear → limpa todos os sub-agents
```
- Cada sub-agent roda em paralelo e retorna resultado ao agente primário
- O widget persiste o status de cada sub-agent na tela
- Usa lifecycle hooks para atualizar a UI quando sub-agents terminam
- Você tem **controle total sobre o sistema de sub-agents** — nada é opaco [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
**Comparação direta:** Claude Code tem sub-agents via `task tool` nativos, mas o processo de análise ocorre em um sub-agent completamente opaco. Em Pi, você vê tudo. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)

### Pi v8 — TillDone Pi (Agente Orientado a Tasks)
Este é o mais sofisticado da primeira tier. Implementa um sistema de **task management obrigatório** — o agente **não pode executar nenhuma ação sem antes criar e gerenciar uma task list**: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```
create tree.mmd that maps all files in this codebase
```
Fluxo obrigatório imposto via hooks:
1. Agente quer rodar `ls` → **bloqueado**
2. Agente deve criar uma task list com `/tilldone create`
3. Adicionar item à lista antes de qualquer ação
4. Executar a task
5. Marcar como `done`
6. Se uma task não for concluída → agente é re-promtado para continuar
**Por que isso é poderoso:** [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
- Adiciona **determinismo** ao loop do agente via código, não só via prompt
- Funciona mesmo com modelos fracos (testado com Claude Haiku)
- Permite usar modelos baratos para trabalho repetitivo com garantia de completude
- Footer atualiza automaticamente com o estado da lista
**Implementação real — `tilldone.ts` tem ~700 linhas:** [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```typescript
// Estrutura da extensão TillDone
pi.registerCommand("tilldone", { ... }) // Comando slash
pi.registerTool("task_management", { ... }) // Ferramenta para o LLM
pi.on("on_input", async (event) => { ... }) // Hook que bloqueia ações sem task
pi.on("agent_end", async () => { ... }) // Hook que re-prompta tasks incompletas
pi.on("tool_call", async (event) => { ... }) // Hook de interceptação de tools
pi.on("session", async () => { ... }) // Hook de persistência de estado
```

## Tier 2: Orquestração Multi-Agent

### Pi v9 — Agent Team Pi
Demonstra uma **equipe de agents especializados** disponíveis para o orchestrator: [github](https://github.com/nicobailon/pi-subagents)
**Agents built-in disponíveis:**
- `scout` — Exploração e descoberta de informações no codebase
- `planner` — Planejamento de tarefas e arquitetura
- `builder` — Implementação de código
- `reviewer` — Revisão e validação do que foi construído
- `documenter` — Geração de documentação
- `red_team` — Análise adversarial e busca de vulnerabilidades
- `context_builder` — Construção de contexto para outros agents
**Como funciona na prática:**
```
scout find all TS files
→ Primary agent não executa nada
→ Despacha scout agent
→ Scout retorna resultado ao primary
→ Primary delega ao builder para modificações
```
**Times configuráveis via YAML:** [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```yaml
teams:
- name: plan-build-review
agents:
- planner
- builder
- reviewer
- name: full-pipeline
agents:
- scout
- planner
- builder
- reviewer
- documenter
```
Você seleciona o time com `/agent-team` → lista de times → seleciona → ativo.

### Pi v10 — System Select Pi
Permite **trocar o system prompt completo do agente em runtime**, transformando-o em qualquer agente especializado: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```
/system → lista de agents disponíveis → selecionar "browser-agent"
go to pi.dev and summarize the value proposition
→ Agent dispara Playwright CLI automaticamente
→ Navega, extrai, sumariza
```
- O agente primário se torna um **browser agent** sem reiniciar
- Volta a ser coding agent com outro `/system`
- Combina com stacking de extensões: você pode ter browser + tool-counter + theme-cycler ativos simultaneamente

### Pi v11 — Damage Control Pi (Hooks de Segurança)
Implementa **proteção via hooks** contra comandos perigosos: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```bash
rm -rf .claude
→ Bloqueado pelo damage control hook
```
- Qualquer comando bash pode ser interceptado e bloqueado
- Você define as regras no TypeScript
- Demonstra que "segurança" em Pi não é ausente — é *sua* responsabilidade construir

### Pi v12 — Agent Chain Pi (Pipelines de Agents)
Agents encadeados sequencialmente onde a **saída de um vira input do próximo**: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```
/chain scout-workflow
→ Scout 1: encontra arquivos
→ Scout 2: analisa os arquivos encontrados
→ Scout 3: valida e sumariza análise do Scout 2
```
**Agent Chain vs Agent Team:**
| | Agent Team | Agent Chain |
|---|---|---|
| **Execução** | Paralela (quando possível) | Sequencial obrigatória |
| **Dependência** | Independentes | Output do anterior é input do próximo |
| **Use case** | Trabalho paralelo (scout + builder) | Pipelines (planejar → construir → revisar) |
| **No Claude Code** | Suportado nativamente | ❌ Não existe |
Um pipeline completo ficaria: `orchestrator → planner → builder → reviewer` — cada um lendo o output do anterior. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)

## Tier 3: Meta-Agents

### Pi v13/v14 — Meta Pi (Agents que Criam Agents)
O nível mais avançado: um **agente que sabe criar outros agentes Pi para uma finalidade específica**: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
**Estrutura:**
- 8 "agents especialistas" — cada um expert em um aspecto específico do Pi:
- Expert em hooks
- Expert em extensões de TUI
- Expert em tools
- Expert em system prompts
- Expert em agent orchestration
- etc.
- O orchestrator agent **consulta os experts em paralelo**, agrega as respostas, e usa isso para **gerar novos agents Pi on-demand**
**Fluxo:**
```
"Build me a new agent that does X"
→ Orchestrator consulta os 8 experts em paralelo
→ Cada expert retorna as especificações da sua área
→ Orchestrator agrega e escreve o novo .ts de extensão
→ Novo agent Pi criado e pronto para uso
```
**Por que isso importa:** Você para de criar agents manualmente. O meta-agent acelera a criação de novos agents especializados. A capacidade de construção cresce de forma não-linear. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)

## O Sistema de Extensões — Guia Técnico Completo
### Estrutura de uma Extensão
```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export default function (pi: ExtensionAPI) {
// 1. Registrar ferramentas para o LLM chamar
pi.registerTool({
name: "my_tool",
description: "Descrição clara para o LLM",
async run(args) {
return { output: "resultado" };
},
});
// 2. Registrar comandos slash
pi.registerCommand("meu-cmd", {
description: "Descrição do comando",
handler: async (_args, ctx) => {
ctx.ui.notify("Executado!", "info");
},
});
// 3. Lifecycle hooks
pi.on("agent_start", async () => { /* ... */ });
pi.on("tool_call", async (event, ctx) => { /* bloquear ou modificar */ });
pi.on("agent_end", async () => { /* pós-processamento */ });
// 4. Atalhos de teclado
pi.registerKeybinding("ctrl+x", () => { /* cyclar tema */ });
}
```
### Os 25+ Hooks Disponíveis
| Categoria | Hooks |
|---|---|
| **Agent lifecycle** | `agent_start`, `agent_end`, `agent_error` |
| **Tool hooks** | `tool_call` (antes), `tool_result` (depois), `tool_error` |
| **Input/Output** | `on_input`, `on_output`, `before_prompt`, `after_prompt` |
| **Session** | `session_start`, `session_end`, `session_restore` |
| **UI** | `render`, `theme_change`, `resize` |
| **Bash spawn** | `spawn` (intercepta e reescreve comandos shell) |
[instagit](https://instagit.com/badlogic/pi-mono/how-to-create-custom-extensions-for-pi-coding-agent/)
### Onde Colocar as Extensões
| Local | Path | Escopo |
|---|---|---|
| **Global** | `~/.pi/extensions/` | Disponível em todos os projetos |
| **Por projeto** | `./.pi/extensions/` | Só no projeto atual |
| **npm package** | `pi install npm:@user/pacote` | Instalado globalmente via npm |
| **Git repo** | `pi install git:github.com/user/repo` | Instalado de qualquer repo git |
| **Efêmero** | `pi -e git:github.com/user/repo` | Só para a sessão atual |
[aiengineerguide](https://aiengineerguide.com/blog/pi-coding-agent-packages/)
### Stacking de Extensões
A capacidade mais poderosa: extensões são **compositáveis**. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```bash
# Combinar 4 extensões em uma única invocação
pi -e pure-focus -e custom-footer -e subagent-widget -e theme-cycler
```
Cada extensão adiciona sua camada sem interferir nas outras. Você monta o agente exato que precisa para cada contexto.

## Context Engineering no Pi
### Hierarquia de Carregamento
```
~/.pi/agents/AGENTS.md (global — sempre carregado)
↓
/projeto-pai/AGENTS.md (pai — se existir)
↓
/projeto-atual/AGENTS.md (local — sobrescreve/adiciona)
↓
SYSTEM.md (substitui system prompt inteiro se presente)
```
### Skills vs Commands vs Agents
| Tipo | O que é | Quando usar |
|---|---|---|
| **Skill** | Arquivo Markdown com instruções detalhadas para o LLM | Capacidades reutilizáveis (ex: browser automation, git workflow) |
| **Command** | Template de prompt com `/nome` | Tarefas repetíveis como `/prime`, `/review`, `/deploy` |
| **Agent** | Arquivo Markdown com system prompt especializado | Persona ou especialização completa (scout, builder, reviewer) |
Skills são carregadas **sob demanda** para não inflar o prompt cache desnecessariamente. O Pi tem 200+ packages no npm com skills prontas. [aiengineerguide](https://aiengineerguide.com/blog/pi-coding-agent-packages/)

## Comparativo Técnico: Hooks Pi vs Claude Code
| Capacidade | Pi | Claude Code |
|---|---|---|
| Hooks de lifecycle | 25+ | ~10 essenciais |
| Interceptar tool calls antes | ✅ | ❌ |
| Bloquear bash commands | ✅ | ❌ |
| Reescrever spawn de comandos | ✅ | ❌ |
| UI Components customizados | ✅ | ❌ |
| Register tools em modo inloop | ✅ | ❌ (só via MCP/skill) |
| Key bindings customizados | ✅ | ❌ |
| System prompt 100% substituível | ✅ | Parcial |
| Pin de versão | ✅ (open-source) | ❌ |
| Fork + patch | ✅ | ❌ |
[ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)

## Pi como Motor de Outras Ferramentas
Um detalhe revelado no vídeo e confirmado por Armin Ronacher (criador do Flask): **OpenClaw é construído em cima do Pi**. Antes chamado de MaltBot e ClawBot, o OpenClaw usa o Pi como seu harness de agent. Isso confirma que o Pi é production-grade suficiente para ser o alicerce de ferramentas que competem diretamente com o Claude Code. [youtube](https://www.youtube.com/watch?v=AEmHcFH1UgQ&list=WL&index=3)

## Estratégia Recomendada pelo Criador do Vídeo
A abordagem não é "ou/ou" — é **"e"**: [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/80157464/16db1a43-54d2-4b74-b43c-b73788f9f1c3/paste.txt)
```
80% Claude Code → Uso diário, tarefas padrão, out-of-the-box
20% Pi → Workflows customizados, multi-agent, experimentação
```
**Use Pi quando:**
- Você quer controle total sobre o harness (system prompt, tools, event loop)
- Precisa de orquestração multi-agent com observabilidade
- Quer usar qualquer modelo (Gemini Flash, DeepSeek, Ollama local)
- Precisa fazer pin de versão para ambientes estáveis
- Está construindo um produto com agent embutido (SDK mode)
- Quer experimentar com agent chains/pipelines sem suporte nativo
**Use Claude Code quando:**
- Time grande ou contexto enterprise (permissões, compliance, suporte)
- Quer a melhor experiência padrão sem customização
- Precisa de MCP servers out-of-the-box
- Não quer gerenciar API keys diretamente

## Instalação e Primeiros Passos
```bash
# Instalar globalmente
npm install -g @mariozechner/pi-coding-agent
# Iniciar com modelo padrão
pi
# Iniciar com extensão específica
pi -e ~/.pi/extensions/minha-extensao.ts
# Iniciar com modelo específico
pi --provider anthropic --model claude-sonnet-4-5
# Iniciar com modelo local (Ollama)
pi --provider ollama --model llama3.1:8b
# Modo programático (retorna JSON stream)
pi --print "resuma este codebase"
# Instalar pacote da comunidade
pi install npm:@mariozechner/pi-subagents
```
**Links essenciais:**
- Site: [pi.dev](https://pi.dev/)
- Pacotes: [pi.dev/packages](https://shittycodingagent.ai/packages) [shittycodingagent](https://shittycodingagent.ai/packages)
- GitHub: [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono) [lucumr.pocoo](https://lucumr.pocoo.org/2026/1/31/pi/)
- Awesome Pi: [github.com/qualisero/awesome-pi-agent](https://github.com/qualisero/awesome-pi-agent) [github](https://github.com/qualisero/awesome-pi-agent)
- 200+ pacotes npm: keyword `pi-package` no npm [aiengineerguide](https://aiengineerguide.com/blog/pi-coding-agent-packages/)