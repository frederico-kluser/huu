# Everything Claude Code: material didático completo sobre o sistema de otimização de agentes IA

**O repositório everything-claude-code transformou a forma como desenvolvedores profissionais utilizam o Claude Code, evoluindo de uma coleção de configurações para um sistema completo de orquestração de agentes IA.** Com mais de 52 mil stars no GitHub, 16 agentes especializados, 65+ skills e 40+ slash commands, o projeto criado por Affaan Mustafa representa hoje o mais abrangente framework de otimização para desenvolvimento assistido por IA. Este material cobre exaustivamente todos os componentes, sistemas e filosofias que sustentam o ECC — desde a arquitetura de agentes até o sistema de aprendizado contínuo baseado em instintos, passando por segurança com AgentShield e estratégias de otimização de tokens.

---

## 1. Sumário executivo

O Everything Claude Code (ECC) é um sistema de otimização de desempenho para harnesses de agentes IA — Claude Code, Cursor, OpenCode e Codex CLI. Criado por Affaan Mustafa após vencer o hackathon Anthropic × Forum Ventures em setembro de 2025, o repositório acumula **mais de 52 mil stars** e foi refinado ao longo de mais de 10 meses de uso intensivo diário [1][2].

A premissa central é direta: **Claude Code não é uma ferramenta de chat — é uma plataforma de orquestração de agentes IA profundamente customizável** [1]. O ECC implementa essa visão através de uma arquitetura em cinco camadas: Rules (restrições determinísticas), Skills (conhecimento reutilizável), Agents (especialistas delegados), Commands (gatilhos do usuário) e Hooks (automações por eventos). O sistema inclui aprendizado contínuo que evolui automaticamente com cada sessão, persistência de memória entre sessões, verificação em loops e segurança como constraint de primeira classe [3].

O projeto passou de "coleção de configs" para "agent harness performance optimization system" — uma reframagem deliberada que reflete a maturidade do ecossistema [1]. Com suporte a TypeScript, Python, Go, Java, C++ e Swift, compatibilidade cross-platform (Windows, macOS, Linux) e um sistema de plugins para marketplace, o ECC atende desde desenvolvedores individuais até equipes enterprise.

---

## 2. Quem é Affaan Mustafa e a história por trás do projeto

Affaan Mustafa (@affaanmustafa) é um desenvolvedor baseado em San Francisco que completou **três graduações antes dos 20 anos**: B.S. em Math-CS e B.S. em Business Economics pela UCSD, além de um AA pelo Bellevue College. Passou pelo programa de MS/PhD em Matemática Aplicada e Computacional na University of Washington antes de se dedicar integralmente a startups e pesquisa aplicada. Possui certificação profissional em Applied Data Science pelo MIT [4].

Seu histórico profissional inclui co-fundar a Itô (prediction markets com exposição estruturada de equity), liderar produto na PMX Trade ($250K+ MRR), contribuir para o framework elizaOS/eliza (17K+ stars no ecossistema Web3) e criar o StoicTradingAI, um bot autônomo de trading na Solana com $2M+ em transações [4]. Possui pesquisas publicadas incluindo HyperMamba, um framework de meta-learning para sistemas de trading autônomos.

**O hackathon que originou tudo** ocorreu em setembro de 2025 na cidade de Nova York, organizado pelo Forum Ventures e Anthropic sob o tema "Agentic AI for Zero-to-One Company Building". Com 75 participantes curados, Affaan e seu parceiro **@DRodriguezFX construíram o zenith.chat em apenas 8 horas** utilizando exclusivamente o Claude Code. Venceram o primeiro lugar entre mais de 100 participantes, recebendo **$15.000 em créditos de API da Anthropic** [4][5]. A "arma secreta" foi exatamente o conjunto de configurações refinadas ao longo de 10+ meses que se tornaria o everything-claude-code.

---

## 3. Cronologia do repositório: de experimental a 50K+ stars

A história do ECC acompanha a própria evolução do Claude Code. Affaan começou a utilizar o Claude Code desde seu **rollout experimental em fevereiro de 2025**, iterando diariamente sobre configurações de agentes, skills e hooks [1].

A cronologia dos marcos principais segue esta sequência. Em **setembro de 2025**, as configurações provaram seu valor no hackathon Anthropic × Forum Ventures. Em **janeiro de 2026**, o repositório foi aberto ao público com a release **v1.0.0** (22 de janeiro): 9 agentes, 11 skills, 11 commands, 10 hooks e 6 rules. Quatro dias depois, a **v1.1.0** trouxe suporte cross-platform e correções da comunidade [1]. O Shorthand Guide, postado no X/Twitter, alcançou **7.4K likes e 2.7M de visualizações**, impulsionando o repositório de zero para 16K+ stars em poucas semanas [4].

Em **fevereiro de 2026**, o AgentShield foi construído no hackathon Cerebral Valley × Anthropic. O repositório ultrapassou 50K stars, recebeu 30+ PRs comunitários de 30 contribuidores em 6 idiomas, e a descrição evoluiu oficialmente de "config collection" para **"agent harness performance optimization system"** [1][4]. Em **março de 2026**, o ECC conta com ~52-58K stars, 6.4K+ forks, 74+ commits, 16 contribuidores e suporte completo para quatro harnesses de IA [1][6].

---

## 4. Filosofia central: orquestração, não chat

A filosofia do ECC se sustenta em cinco pilares. **Agent-First**: trabalho complexo é decomposto e distribuído a especialistas, não tratado monoliticamente. **Test-Driven**: testes são escritos antes do código, com cobertura mínima de 80%. **Security-First**: segurança é constraint de primeira classe, não afterthought. **Immutability**: preferência por objetos imutáveis e arquivos pequenos (200-400 linhas, máximo 800). **Plan Before Execute**: planejamento estruturado precede qualquer implementação [1][3].

A evolução filosófica mais significativa foi a passagem de "config pack" para "agent harness performance system". Isso não foi cosmético — refletiu a adição de sistemas de aprendizado contínuo, persistência de memória, loops de verificação e scanning de segurança. Como Affaan descreve: "Não são apenas configs. É um sistema completo: skills, instincts, memory optimization, continuous learning, security scanning e research-first development" [1].

A filosofia de segurança merece destaque especial. Após o **incidente OpenClaw** — onde Affaan descobriu uma prompt injection escondida em um skill aparentemente inofensivo durante uma semana de testes — a segurança se tornou central ao projeto. "A conveniência é visível e imediata. O risco é invisível até se materializar", escreve no OpenClaw Guide [5]. Isso levou diretamente à criação do AgentShield e à integração de security scanning como componente nativo do ECC.

---

## 5. Arquitetura completa de componentes

O ECC utiliza uma **arquitetura em cinco camadas** identificada pela análise DeepWiki [6]:

| Camada | Componente | Função | Confiabilidade |
|--------|-----------|--------|----------------|
| Intelligence | Continuous Learning V1/V2 | Extrai padrões e evolui skills automaticamente | Probabilística (V1 ~50-80%) / Determinística (V2 hooks 100%) |
| Infrastructure | Scripts cross-platform, utils, package-manager | Utilitários para sessões, detecção de pacotes, persistência | Determinística |
| Knowledge Base | Skills, Rules, Commands, Contexts | Workflows, restrições, ações rápidas, templates | Mista |
| Storage | Sessions, instincts, configs | Estado persistente entre sessões | Determinística |
| Component | Agents, Hooks, MCPs | Execução ativa — especialistas, automações, bridges | Mista |

A estrutura de diretórios do repositório organiza esses componentes:

```
everything-claude-code/
├── agents/          # 16 agentes especializados (Markdown + YAML)
├── skills/          # 65+ skills (diretórios com SKILL.md)
├── commands/        # 40+ slash commands (Markdown)
├── rules/           # Restrições por linguagem (common/ + typescript/ + python/ + golang/ + swift/)
├── hooks/           # hooks.json + memory-persistence/
├── scripts/hooks/   # Implementações Node.js dos hooks
├── contexts/        # dev.md, review.md, research.md
├── mcp-configs/     # Configurações de MCP servers
├── .claude-plugin/  # plugin.json + marketplace.json
├── examples/        # CLAUDE.md e user-CLAUDE.md de exemplo
├── tests/           # Suite de testes (992+ testes)
└── docs/            # Documentação multilíngue
```

A relação entre componentes segue o padrão **Commands → Agents → Skills**: comandos invocam agentes, agentes carregam skills e executam tools, e skills fornecem conhecimento de domínio. Rules são sempre ativas e não-negociáveis. Hooks são event-driven e 100% confiáveis [6].

---

## 6. Os 16 agentes em detalhe

Cada agente é um arquivo Markdown com **YAML frontmatter** que define nome, descrição, tools permitidas, modelo de LLM e skills acessíveis. O frontmatter controla o sandboxing — um agente de review que só precisa ler código recebe apenas `Read, Grep, Glob`, enquanto um agente de implementação recebe `Read, Grep, Glob, Bash, Write, Edit` [2][6].

**Formato padrão de um agente:**
```yaml
---
name: code-reviewer
description: Reviews code for quality, security, and maintainability
tools: Read, Grep, Glob, Bash
model: opus
---
You are a senior code reviewer focused on quality, security, and maintainability...
```

Os 16 agentes organizados por domínio funcional são:

**Planejamento e Arquitetura:** O **planner** (Sonnet) cria blueprints de implementação com fases, dependências e riscos. O **architect** (Sonnet) gera Architecture Decision Records (ADRs) e diagramas de sistema. O **chief-of-staff** coordena comunicação e triagem em workflows complexos [1][2][7].

**Qualidade e Segurança:** O **code-reviewer** (Opus) produz tabelas de severidade (CRITICAL/HIGH/MEDIUM/LOW). O **security-reviewer** (Opus, read-only, sem MCPs para evitar exfiltração) audita OWASP Top 10. O **go-reviewer** e **python-reviewer** fazem reviews específicos por linguagem. O **database-reviewer** analisa schemas Supabase e queries [2][6].

**Implementação e Testes:** O **tdd-guide** (Sonnet) impõe o ciclo red-green-refactor. O **build-error-resolver** resolve erros com diffs mínimos, sem mudanças arquiteturais. O **e2e-runner** gera e executa testes Playwright [1][2].

**Manutenção:** O **refactor-cleaner** detecta e remove dead code com segurança. O **doc-updater** sincroniza documentação e gera codemaps [1].

**Operações Avançadas:** O **go-build-resolver** resolve erros de build Go. O **harness-optimizer** e **loop-operator** foram adicionados em releases recentes para otimização de harness e operação de loops autônomos [7]. [CONFIANÇA: MÉDIA para harness-optimizer e loop-operator — mencionados em apenas uma fonte]

O padrão de delegação hierárquica segue **Orchestrator → Specialist**: o Claude principal (orchestrator) delega via ferramenta Task, que spawna processos isolados de agentes. O orchestrator vê apenas o resumo (~500 tokens), não o contexto completo de trabalho do agente. Múltiplas invocações de Task permitem execução paralela [6].

---

## 7. As 65+ skills em detalhe

Skills são **definições de workflow** armazenadas em diretórios com um arquivo `SKILL.md` contendo YAML frontmatter e corpo em Markdown. Diferem fundamentalmente de Rules: "Rules dizem o que fazer; Skills dizem como fazer" [1][3].

**Formato SKILL.md:**
```yaml
---
name: tdd-workflow
description: Test-driven development workflow methodology
context: fork
agent: Explore
allowed-tools: Bash(npm test *)
---
## When to Use
When implementing new features or fixing bugs...

## Steps
1. Write failing test...
2. Implement minimal code...
3. Refactor with confidence...
```

As skills se organizam nas seguintes categorias principais:

**Padrões de Codificação e Linguagem:** coding-standards, golang-patterns, golang-testing, python-patterns, cpp-coding-standards, cpp-testing, swift-actor-persistence, swift-concurrency-6-2, springboot-patterns, springboot-security, springboot-tdd, springboot-verification, java-coding-standards, django-patterns, django-security, django-tdd, django-verification [1][2][6].

**Backend e Infraestrutura:** backend-patterns (API, database, caching), database-migrations, clickhouse-patterns, postgres-patterns, docker-patterns, deployment-patterns, cost-aware-llm-pipeline, content-hash-cache-pattern [1][2].

**Frontend:** frontend-patterns (React, Next.js), frontend-slides [1].

**Qualidade e Testes:** tdd-workflow, e2e-testing, eval-harness, verification-loop, plankton-code-quality, security-review, security-scan [1][2].

**Aprendizado e Evolução:** continuous-learning (V1), continuous-learning-v2 (Instinct-based), iterative-retrieval, strategic-compact, search-first, skill-stocktake [1][2].

**Negócios e Conteúdo:** investor-materials, investor-outreach, market-research, article-writing, content-engine [1].

**Operações de Agentes:** enterprise-agent-ops, nanoclaw-repl, autonomous-loops [2][6].

**Plataformas Específicas:** foundation-models-on-device, liquid-glass (design system Apple) [6].

O campo `context: fork` no frontmatter indica que a skill roda em um subagente isolado. O campo `allowed-tools` especifica permissões granulares — por exemplo, `Bash(gh *)` permite apenas comandos GitHub CLI. Skills também suportam **comandos preprocessor** com `!` para executar comandos antes de enviar ao Claude: `!`gh pr diff`` injeta o diff do PR automaticamente [7].

A distinção entre skills probabilísticas (~50-80% auto-invocação) e hooks determinísticos (100%) é crucial para o design do sistema. Skills dependem do Claude decidir quando invocá-las; hooks disparam sempre em eventos específicos [6][7].

---

## 8. Os 40+ slash commands categorizados

Commands são arquivos Markdown únicos em `commands/` que criam slash commands invocáveis pelo usuário. Organizados por categoria:

**Desenvolvimento Core:** `/plan` (planner → blueprint de implementação), `/tdd` (tdd-guide → ciclo red-green-refactor), `/build-fix` (build-error-resolver → correção de erros), `/code-review` (code-reviewer → análise de qualidade), `/refactor-clean` (refactor-cleaner → remoção de dead code), `/e2e` (e2e-runner → testes Playwright) [1][2].

**Go-Specific:** `/go-review` (go-reviewer → review de código Go), `/go-test` (TDD workflow para Go), `/go-build` (go-build-resolver → erros de build Go) [1].

**Aprendizado e Instintos:** `/learn` (extrai padrões mid-session), `/instinct-status` (visualiza instintos aprendidos com confiança), `/instinct-import` (importa instintos), `/instinct-export` (exporta instintos para compartilhamento), `/evolve` (cluster instintos em skills), `/learn-eval` (avaliação de aprendizado) [1][2].

**Verificação e Avaliação:** `/checkpoint` (salva estado de verificação), `/verify` (roda verification loop), `/eval` (executa avaliações), `/harness-audit` (audita configuração do harness) [2].

**Segurança:** `/security-scan` (security-reviewer → auditoria OWASP Top 10 via AgentShield) [1][5].

**Multi-Agent e Orquestração:** `/pm2` (gerenciamento de processos PM2), `/multi-plan` (planejamento multi-agente), `/multi-execute` (execução multi-agente), `/multi-backend`, `/multi-frontend`, `/multi-workflow` [1][2].

**Sistema e Gerenciamento:** `/setup-pm` (configuração de package manager), `/codex-setup` (gera codex.md para compatibilidade com OpenAI Codex CLI), `/statusline` (linha de status customizada com git branch, contexto %, modelo, tempo), `/update-docs` (atualização de documentação), `/gh-pr` (criação de PR via GitHub CLI), `/sessions` (gerenciamento de histórico de sessões), `/skill-create` (geração de skills a partir de histórico git), `/claw` (workflow customizado NanoClaw) [1][2][7].

---

## 9. Rules, hooks, contexts e MCP configs

### Rules

Rules são restrições **sempre ativas e não-negociáveis**, organizadas hierarquicamente em `rules/common/` (linguagem-agnóstico, sempre instalado) mais diretórios específicos: `typescript/`, `python/`, `golang/`, `swift/` [1][3].

As 6 rules core em `common/` são: **security.md** (nunca hardcode secrets, valide inputs, redija logs), **coding-style.md** (imutabilidade, sem emojis em código, arquivos de 200-400 linhas, máximo 800), **testing.md** (TDD obrigatório, 80%+ cobertura), **git-workflow.md** (conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`), **agents.md** (quando delegar a subagentes), **performance.md** (seleção de modelo, gerenciamento de contexto) [1][3]. Regras adicionais incluem patterns.md, hooks.md e development-workflow.md [7].

Rules consomem context window a cada início de sessão, por isso a modularidade é crítica — cada rule deve ter **200-500 palavras** [3]. Rules específicas por linguagem podem sobrescrever rules comuns (ex: Go idiomático permite mutação, sobrescrevendo o padrão de imutabilidade) [7].

### Hooks

O sistema de hooks é **event-driven e determinístico** (100% confiável), definido em `hooks/hooks.json` com implementações Node.js em `scripts/hooks/`. Os **8 tipos de evento** são [3][6][7]:

| Evento | Quando dispara | Uso principal |
|--------|---------------|---------------|
| **PreToolUse** | Antes da execução de uma tool | Validação, bloqueio (exit code 2), lembretes |
| **PostToolUse** | Após execução de uma tool | Formatação, linting, observação (CL V2) |
| **Stop** | Quando a sessão termina | Cleanup, persistência, avaliação |
| **SessionStart** | Nova sessão inicia | Carregamento de contexto, injeção de estado |
| **SessionEnd** | Sessão encerra | Limpeza, logging |
| **PreCompact** | Antes da compactação de contexto | Salvar estado crítico |
| **UserPromptSubmit** | A cada mensagem do usuário | Validação/enriquecimento (evitar para ops pesadas — adiciona latência) |
| **Notification** | Notificação de sistema | Alertas desktop |

Hooks específicos implementados incluem: **tmux enforcement** (bloqueia `npm run dev` fora do tmux), **long-running command reminder** (lembra de usar tmux para pytest, cargo build, etc.), **git push review reminder**, **markdown file creation blocker** (whitelist: README.md, CLAUDE.md, AGENTS.md), **manual compaction suggestion** (sugere `/compact` após 50-100 operações), **observe** (continuous learning V2), **post-edit format** (auto-formata após edições), **post-edit console-warn** (alerta sobre console.log), **check-console-log** (Stop phase), **session-end** (salva resumo), **evaluate-session** (extrai padrões), **cost-tracker** (rastreia custos de tokens) [7].

O **sistema de profiles** (`ECC_HOOK_PROFILE=minimal|standard|strict`) permite gating em runtime sem editar arquivos. Hooks específicos podem ser desabilitados via `ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"` [1][7].

Um bug importante documentado: Claude Code v2.1+ carrega automaticamente `hooks/hooks.json` de plugins instalados. **Não declare hooks no plugin.json** — isso causa erro de "Duplicate hooks file detected", um problema recorrente (issues #29, #52, #103, #106) agora enforçado por teste de regressão [7].

### Contexts

Três arquivos de contexto dinâmico em `contexts/` são injetados via system prompt:

```bash
alias claude-dev='claude --system-prompt "$(cat ~/.claude/contexts/dev.md)"'
alias claude-review='claude --system-prompt "$(cat ~/.claude/contexts/review.md)"'
alias claude-research='claude --system-prompt "$(cat ~/.claude/contexts/research.md)"'
```

A hierarquia de autoridade segue: system prompt > user messages > tool results [2][3].

### MCP Configs

Configurações em `mcp-configs/mcp-servers.json` incluem servidores para **GitHub, Supabase, Vercel, Railway, ClickHouse, Memory, Firecrawl, Sequential-Thinking, Cloudflare, Ableton, Magic** e outros [1][6]. A filosofia é crítica: **"Tenha 20-30 MCPs configurados globalmente, mantenha menos de 10 habilitados por projeto, e menos de 80 tools ativas"** [3].

O impacto na context window é severo [6]:

| Configuração | Contexto Disponível | Impacto |
|-------------|--------------------|---------| 
| 0 MCPs | ~200k tokens | 100% disponível |
| 5-10 MCPs (razoável) | ~150k tokens | 75% restante |
| 20+ MCPs (excessivo) | ~70k tokens | 35% — degradação severa |
| 30+ MCPs (crítico) | ~50k tokens | 25% — inutilizável |

A recomendação é substituir MCPs por skills + commands que usam CLI diretamente. Exemplo: substituir o GitHub MCP por `/gh-pr` que wrapa `gh pr create`, economizando tokens significativos [2][3].

---

## 10. Continuous Learning V1: extração de padrões por Stop hook

O sistema V1, localizado em `skills/continuous-learning/`, resolve o problema de **tokens desperdiçados, contexto desperdiçado e tempo desperdiçado** por prompts repetitivos que esbarram nos mesmos problemas [2].

Quando o Claude descobre algo não-trivial — uma técnica de debugging, um workaround, um padrão específico do projeto — ele salva esse conhecimento como um novo skill em `~/.claude/skills/learned/`. Na próxima vez que um problema similar surgir, o skill carrega automaticamente [2].

A decisão de design crucial: usa um **Stop hook** (não UserPromptSubmit). UserPromptSubmit roda em cada mensagem, adicionando latência perceptível. O Stop hook roda **uma vez ao final da sessão** — leve e não-intrusivo. A cobertura estimada é de **~50-80%**, pois depende do Claude decidir quando invocar a skill de aprendizado [2][7].

---

## 11. Continuous Learning V2: o sistema de instintos

O V2, localizado em `skills/continuous-learning-v2/`, representa uma evolução fundamental. A premissa: "V1 dependia de skills para observar. Skills são probabilísticas — disparam ~50-80% do tempo. V2 usa hooks para observação (100% confiável) e instincts como unidade atômica de comportamento aprendido" [7].

A arquitetura segue **quatro fases**:

**Fase 1 — Observação:** O script `observe.sh` captura eventos de uso de tools em arquivos `observations.jsonl` com escopo por projeto, disparado por hooks PreToolUse e PostToolUse. A cobertura é **100%** por ser baseada em hooks determinísticos, não skills probabilísticas [3][6].

**Fase 2 — Análise:** Um daemon background (`start-observer.sh`) usa **Claude Haiku** para detectar padrões quando o threshold de **20+ observações** é atingido. A escolha de Haiku é deliberada — análise de padrões é tarefa de baixo custo que não justifica Sonnet ou Opus [3][6].

**Fase 3 — Codificação:** Gera **instinct files** com YAML frontmatter contendo scores de confiança entre **0.3 e 0.85**, tags de domínio (code-style, testing, git, debugging) e conteúdo em Markdown. Instintos possuem decay de confiança — perdem confiança se contraditos por evidência posterior. A partir da versão 2.1, instintos são **project-scoped** por padrão [3][6].

**Fase 4 — Evolução:** O comando `/evolve` clusteriza instintos relacionados em skills completas. `/promote` move instintos de escopo projeto para escopo global. Isso cria **efeitos compostos de aprendizado** onde cada sessão melhora sessões futuras [3][6].

A inspiração filosófica vem do conceito de **homúnculo** — pequenas entidades de conhecimento que operam semi-autonomamente dentro do sistema maior. Cada instinto é uma "micro-intuição" codificada que influencia o comportamento do agente sem requerer invocação explícita [3].

O sistema de privacidade garante que observações e instintos permaneçam locais — nada é enviado para servidores externos. O modelo de dados é: observações → análise local → instintos locais → skills locais [3][6].

Um bug significativo foi corrigido pela comunidade: `parse_instinct_file()` silenciosamente descartava todo conteúdo após o frontmatter YAML, corrigido pelo contribuidor @ericcai0814 (issues #148, #161) [3].

---

## 12. Memory Persistence: continuidade entre sessões

O sistema de persistência de memória resolve o problema de **context rot** — o Claude esquecendo decisões anteriores em sessões longas. Opera através de três hooks principais [2][6]:

O **SessionStart hook** (`session-start.js`) carrega contexto de sessões anteriores. Verifica `~/.claude/sessions/` por arquivos `.tmp` dos últimos 7 dias e reporta skills aprendidos de `~/.claude/skills/learned/`. Inclui fallback para root quando executado fora de diretórios de projeto [6][7].

O **Stop hook** (`session-end.js`) ao final de cada sessão persiste: o que funcionou (com evidência), quais abordagens foram tentadas mas falharam, e o que resta fazer. Cria arquivos com formato `YYYY-MM-DD-shortid-session.tmp` onde shortid é alfanumérico de 8+ caracteres [6].

O **PreCompact hook** (`pre-compact.js`) salva estado crítico antes da compactação de contexto, prevenindo perda de informação durante compaction emergencial [2][7].

**Formato do arquivo de sessão:**
```markdown
# Session Title
**Date:** 2026-02-01
**Started:** 10:30
**Last Updated:** 14:45

### Completed
- [x] Task 1 - Implementação de auth

### In Progress
- [ ] Task 3 - Testes de integração

### Notes for Next Session
Lembrar de testar edge case de timeout

### Context to Load
src/main.ts
lib/auth.ts
```

O Session Manager API oferece operações completas: `getSessionsDir()`, `writeSessionContent()`, `appendSessionContent()`, `parseSessionFilename()`, `parseSessionMetadata()`, `getSessionStats()`, `getAllSessions()`. Um sistema de aliases (`session-aliases.json`) mapeia nomes legíveis para paths de arquivo [6].

---

## 13. Verification Loops e Eval Harness

O sistema de verificação opera em dois modos. **Checkpoint-Based Evals** definem checkpoints explícitos, verificam contra critérios e corrigem antes de prosseguir. **Continuous Evals** rodam a cada N minutos ou após mudanças significativas, executando suíte completa de testes + lint [2].

As métricas fundamentais são:

```
pass@k: Pelo menos UMA de k tentativas tem sucesso
         k=1: 70%  k=3: 91%  k=5: 97%

pass^k: TODAS as k tentativas devem ter sucesso
         k=1: 70%  k=3: 34%  k=5: 17%
```

Use **pass@k** quando apenas precisa funcionar (prototipagem, exploração). Use **pass^k** quando consistência é essencial (produção, segurança) [2].

O **Eval Harness** (skill `eval-harness/`) estrutura avaliações formais com graders que classificam outputs. O workflow de benchmarking recomendado: fork a conversa, inicie um novo worktree sem o skill sendo avaliado, compare outputs no diff final [2].

---

## 14. Otimização de tokens e seleção de modelo

A diferença de custo entre modelos é **18.75x** entre Haiku ($0.80/MTok) e Opus ($15.00/MTok), com Sonnet ($3.00/MTok) no meio [2][6]. A estratégia de roteamento é:

| Tipo de Tarefa | Modelo | Justificativa |
|---------------|--------|---------------|
| Exploração/busca | Haiku | Rápido, barato, suficiente para encontrar arquivos |
| Edições simples | Haiku | Mudanças em arquivo único, instruções claras |
| Implementação multi-arquivo | Sonnet | Melhor equilíbrio para codificação |
| Arquitetura complexa | Opus | Raciocínio profundo necessário |
| PR reviews | Sonnet | Entende contexto, captura nuance |
| Análise de segurança | Opus | Não pode perder vulnerabilidades |
| Documentação | Haiku | Estrutura simples |
| Debugging complexo | Opus | Precisa manter sistema inteiro em mente |

O padrão é **Sonnet para 90% das tarefas**. Upgrade para Opus quando: primeira tentativa falhou, tarefa envolve 5+ arquivos, decisões arquiteturais, ou código security-critical [2].

**Exemplo de custo por feature** [6]:
- Exploração (Haiku): $0.006
- Planejamento (Sonnet): $0.036
- Implementação (Sonnet): $0.255
- Testes (Sonnet): $0.054
- Review (Opus): $0.180
- Overhead de compactação: $0.060
- **Total: $0.59 por feature**

Otimizações adicionais incluem: substituir grep por **mgrep** (~50% redução de tokens), manter codebase modular (arquivo de 2000 linhas custa 50x mais tokens que cinco arquivos de 200 linhas), substituir MCPs por CLI + skills, e usar `MAX_THINKING_TOKENS` e `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` para controle granular [2][3].

---

## 15. Paralelização e orquestração multi-agente

O princípio guia é: **"Quanto você consegue fazer com a mínima paralelização viável?"** Adicionar terminais deve vir de necessidade real, não de otimismo [2].

**Git Worktrees** são o mecanismo preferido para instâncias paralelas sem conflitos:
```bash
git worktree add ../project-feature-a feature-a
git worktree add ../project-feature-b feature-b
cd ../project-feature-a && claude
```

O **Cascade Method** organiza tarefas em tabs da esquerda para direita: novas tasks abrem à direita, sweep da esquerda para direita (mais velhas para mais novas), foco em no máximo 3-4 tasks simultaneamente. Usar `/rename <name>` para nomear todos os chats [2].

O **Two-Instance Kickoff Pattern** divide o início de um projeto: Instância 1 (Scaffolding Agent) cria estrutura, configs e CLAUDE.md; Instância 2 (Deep Research Agent) faz web search, cria PRD, diagramas e compila referências com clips reais de documentação [2].

**Agent Teams** (experimental) são habilitados via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. PM2 com orquestração multi-agente é suportado pelos comandos `/pm2`, `/multi-plan`, `/multi-execute`, `/multi-backend`, `/multi-frontend` e `/multi-workflow` [1][2].

O **padrão de orquestração sequencial** segue fases:
```
Fase 1: RESEARCH (agente Explore) → research-summary.md
Fase 2: PLAN (agente planner) → plan.md  
Fase 3: IMPLEMENT (agente tdd-guide) → código
Fase 4: REVIEW (agente code-reviewer) → review-comments.md
Fase 5: VERIFY (build-error-resolver se necessário) → done ou loop back
```

Regras críticas: cada agente recebe UMA entrada clara e produz UMA saída clara; outputs viram inputs da próxima fase; usar `/clear` entre agentes para liberar contexto [2].

O **problema de contexto do subagente** é endereçado pelo **Iterative Retrieval Pattern**: o orchestrator avalia cada retorno do subagente, faz perguntas de follow-up antes de aceitar, o subagente volta à fonte e retorna. Loop máximo de 3 ciclos [2][3].

---

## 16. Segurança: AgentShield e o incidente OpenClaw

### O incidente OpenClaw

No terceiro dia testando o OpenClaw — um layer de orquestração que conecta agentes IA a Telegram, Discord, WhatsApp, Email e Browser — Affaan **acidentalmente sofreu uma prompt injection**. Um skill do ClawdHub, recomendado por outros usuários, continha **doze linhas abaixo da porção visível** uma instrução oculta em um bloco de comentários que redirecionava o comportamento do agente [5].

A descoberta revelou problemas sistêmicos: blast radius máximo (se um canal é comprometido, todos os outros conectados são afetados), ausência de sandboxing, marketplace sem vetting de segurança, e o CVE-2026-25253 (RCE com um clique, corrigido na versão 2026.1.29). Kaspersky publicou subsequentemente "New OpenClaw AI Agent Found Unsafe for Use" validando as preocupações [5].

A posição de Affaan é clara: **"Múltiplos pontos de acesso é um bug, não uma feature"**. Toda a funcionalidade do OpenClaw pode ser replicada com skills e harness tools sem a superfície de ataque expandida [5].

### AgentShield

Construído no hackathon Cerebral Valley × Anthropic (fevereiro 2026), o AgentShield é um scanner de segurança para configurações de agentes IA. Especificações: **102 regras estáticas, 1.282 testes, 98% de cobertura** [4][5].

**5 categorias de scan:** detecção de secrets (14 padrões), auditoria de permissões, análise de hook injection, profiling de risco de MCP servers, e review de configurações de agentes [1][4].

O modo `--opus` ativa o **pipeline Red Team/Blue Team/Auditor** com três agentes Opus 4.6 trabalhando em conjunto: Red Team (atacante) encontra cadeias de exploit, Blue Team (defensor) avalia proteções, e Auditor sintetiza ambos em uma avaliação de risco priorizada. "Raciocínio adversarial, não apenas pattern matching" [4].

```bash
npx ecc-agentshield scan              # Scan rápido
npx ecc-agentshield scan --fix        # Auto-fix de issues seguras
npx ecc-agentshield scan --opus --stream  # Análise profunda com 3 agentes
npx ecc-agentshield init              # Gerar baseline segura
```

Integração via `/security-scan` roda AgentShield diretamente de dentro do Claude Code [1][5].

---

## 17. Plankton Code Quality: qualidade em tempo de escrita

O Plankton, criado por @alxfazio, é o companion recomendado para enforcement de qualidade em tempo de escrita via PostToolUse hooks. Suporta Python, TypeScript, Shell, YAML, JSON, TOML, Markdown e Dockerfile [2][3].

A **arquitetura de três fases** opera sequencialmente:

**Fase 1 — Auto-format silencioso:** Formatadores rodam automaticamente, resolvendo 40-50% dos issues sem intervenção. **Fase 2 — Coleta de violações:** 20+ linters executam e coletam violações restantes como JSON estruturado. **Fase 3 — Delegação de fixes:** Subprocessos Claude são spawned com roteamento por complexidade: **Haiku** para violações simples, **Sonnet** para issues moderados, **Opus** para violações complexas [3].

**Config protection hooks** previnem que agentes modifiquem configurações de linters para passar nos testes em vez de corrigir o código — um pattern de "gaming" observado em agentes autônomos [3].

---

## 18. Instalação e workflow diário

### Métodos de instalação

**Plugin Install (recomendado):**
```bash
/plugin marketplace add affaan-m/everything-claude-code
/plugin install everything-claude-code@everything-claude-code
```

**Manual Install:**
```bash
git clone https://github.com/affaan-m/everything-claude-code.git
cp everything-claude-code/agents/*.md ~/.claude/agents/
cp -r everything-claude-code/rules/common/* ~/.claude/rules/
cp everything-claude-code/commands/*.md ~/.claude/commands/
cp -r everything-claude-code/skills/* ~/.claude/skills/
```

**Installer Script (com target de harness):**
```bash
./install.sh typescript              # Common + TypeScript rules
./install.sh --target cursor typescript  # Para Cursor IDE
./install.sh --target antigravity typescript  # Para OpenCode
```

**Limitação crítica:** O sistema de plugins do Claude Code **não distribui rules** — devem ser instaladas manualmente após a instalação do plugin [1][3][7].

### Detecção de package manager

O ECC implementa uma **cascata de prioridade de 6 níveis**: variável de ambiente (`CLAUDE_PACKAGE_MANAGER`) → config do projeto → package.json → lock file → config global → fallback para npm [1].

### Compatibilidade cross-harness

Todos os scripts foram reescritos em Node.js para suporte cross-platform (Windows, macOS, Linux). O installer adapta per target: Claude Code (nativo), Cursor IDE, OpenCode (12 agents, 24 commands, 16 skills, 20+ event types via plugin system), Codex CLI [1][6].

### Hook runtime controls

```json
// settings.json recomendado
{
  "extraKnownMarketplaces": {
    "everything-claude-code": {
      "source": { "source": "github", "repo": "affaan-m/everything-claude-code" }
    }
  },
  "enabledPlugins": {
    "everything-claude-code@everything-claude-code": true
  }
}
```

### Workflow diário recomendado

O ciclo diário segue: **`/plan` → `/tdd` → `/code-review` → commit → `/verify`**. Comece cada feature com `/plan` para criar o blueprint. Use `/tdd` para implementação test-first. Rode `/code-review` antes de commitar. Feche com `/verify` para o verification loop. Use `/learn` periodicamente para extrair padrões mid-session, e `/checkpoint` para salvar estado em marcos lógicos [1][2].

Para sessões longas, monitore o contexto com `/cost` e compacte estrategicamente com `/compact` em intervalos lógicos — nunca espere o contexto atingir 95%+ (compaction emergencial com perda potencial de estado) [2][6].

---

## 19. Dicas práticas e atalhos produtivos

**Terminal e navegação:** `Ctrl+U` deleta a linha inteira (mais rápido que backspace), `/fork` bifurca conversas para tasks paralelas não-sobrepostas, `/rename <name>` nomeia chats para organização no Cascade Method [2][3].

**Injeção de contexto dinâmica:** Em vez de colocar tudo no CLAUDE.md, use `claude --system-prompt "$(cat memory.md)"` para injetar contexto relevante por sessão [2].

**llms.txt:** Procure `/llms.txt` em sites de documentação para obter docs otimizados para LLMs — formato limpo que economiza tokens significativos [2].

**Voice transcription:** superwhisper e MacWhisper no macOS permitem ditar comandos. Mesmo com erros de transcrição, o Claude entende a intenção [2].

**Plugins complementares recomendados:** mgrep (busca eficiente), typescript-lsp (inteligência TS), pyright-lsp (tipos Python), hookify (criação de hooks conversacional), code-simplifier, ralph-wiggum (automação de loops), context7 (documentação ao vivo) [3].

**Strategic Compact avançado:** Desabilite auto-compact, compacte em intervalos lógicos, limpe contexto de exploração antes da fase de execução, use `/clear` entre fases de agentes. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` ajusta o threshold para 50% [2].

---

## 20. Glossário de termos essenciais

| Termo | Definição |
|-------|-----------|
| **Agent** | Subprocesso especializado com tools e modelo específicos, definido por Markdown + YAML frontmatter |
| **Skill** | Definição de workflow reutilizável em SKILL.md, invocada por comandos ou agentes |
| **Rule** | Restrição always-on carregada em toda sessão, não-negociável |
| **Hook** | Automação event-driven (8 tipos de evento), 100% confiável, definida em hooks.json |
| **Instinct** | Unidade atômica de comportamento aprendido pelo CL V2, com score de confiança (0.3-0.85) |
| **MCP** | Model Context Protocol — bridge para serviços externos via natural language |
| **Context Window** | Janela de tokens disponível (~200k base, degradada por MCPs e tools) |
| **Orchestrator** | Claude principal que delega a agentes especialistas via Task tool |
| **Strategic Compact** | Compactação manual em intervalos lógicos vs auto-compact emergencial |
| **Harness** | Plataforma que executa o agente IA (Claude Code, Cursor, OpenCode, Codex) |
| **Pass@k / Pass^k** | Métricas de verificação: qualquer sucesso em k tentativas vs todos os k devem suceder |
| **Blast Radius** | Extensão do dano se um componente é comprometido (conceito de segurança do OpenClaw Guide) |
| **Homunculus** | Inspiração filosófica para instintos: micro-entidades de conhecimento semi-autônomas |
| **NanoClaw** | Subsistema com model routing, skill hot-load, session branch/search/export/compact/metrics |
| **ECC** | Everything Claude Code — o sistema completo de otimização de harness de agentes |

---

## Conclusão: o que o ECC revela sobre o futuro do desenvolvimento assistido por IA

O Everything Claude Code demonstra que o gap entre "usar um assistente de IA" e "orquestrar uma equipe de agentes especializados" é enorme — e preenchê-lo requer engenharia de sistemas real. A contribuição mais original de Affaan Mustafa não é nenhum componente individual, mas a **arquitetura de cinco camadas que torna a complexidade gerenciável**: rules determinísticas na base, skills probabilísticas no meio, agentes sandboxed como executores, commands como interface, e hooks como garantia.

O sistema de Continuous Learning V2 baseado em instintos representa uma mudança de paradigma: **o agente não apenas executa, ele aprende e evolui com cada sessão**. A migração de skills probabilísticas (50-80%) para hooks determinísticos (100%) na fase de observação resolve elegantemente o problema de confiabilidade que limita sistemas de aprendizado in-context.

A filosofia de segurança — cristalizada pelo incidente OpenClaw e materializada no AgentShield — posiciona o ECC como um dos poucos projetos que trata segurança como constraint estrutural e não como checklist. "A indústria está construindo o encanamento para IA autônoma. Se errarmos a segurança na camada de fundação, pagaremos por isso por décadas" [5].

Com mais de 52K stars em menos de três meses, o ECC prova que a comunidade de desenvolvedores está pronta para ir além do prompt-and-pray. O futuro do desenvolvimento assistido por IA não é sobre modelos melhores — é sobre **harnesses melhores**.

---

**Fontes consultadas:**

[1] GitHub Repository: github.com/affaan-m/everything-claude-code — README.md, releases, contributors

[2] The Longform Guide: the-longform-guide.md (token optimization, memory persistence, parallelization)

[3] The Shortform Guide: the-shortform-guide.md (setup, foundations, philosophy)

[4] Pesquisa de background: perfis de Affaan Mustafa (GitHub, X/Twitter, LinkedIn), cobertura em Medium (Joe Njenga), Dev Genius (JP Caparas), Apiyi.com

[5] The OpenClaw Guide: the-openclaw-guide.md (security philosophy, OpenClaw incident, AgentShield)

[6] DeepWiki Analysis: deepwiki.com/affaan-m/everything-claude-code (architectural analysis, component relationships)

[7] Análise de source code: agents/*.md, hooks/hooks.json, scripts/hooks/*.js, skills/*/SKILL.md, rules/common/*.md, commands/*.md