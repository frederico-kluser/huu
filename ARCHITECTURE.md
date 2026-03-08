# HUU — Manifesto Arquitetural do Orquestrador Multi-Agent

> Documento gerado a partir de 12 decisões arquiteturais tomadas interativamente.
> Cada decisão é fundamentada nos docs de pesquisa do projeto.

---

## Visão Geral

**HUU** é um orquestrador multi-agent para desenvolvimento de software que segue o modelo de uma **sala de roteiristas (Showrunner Model)**. Um orquestrador central decompõe tarefas usando uma **estrutura narrativa fractal (Beat Sheet)**, delega a **11 agents especializados** com papéis fixos, e integra o trabalho via **merge progressivo em 4 tiers**. A comunicação entre agents e a memória persistente vivem em um **SQLite WAL unificado**. A interface humana é uma **TUI Kanban com Detail View** construída em React Ink. O runtime é **Node.js + TypeScript**.

---

## As 12 Decisões

### 1. Modelo Mental: Sala de Roteiristas (Showrunner Model)

Um orquestrador central (showrunner) decompõe tarefas e delega a agents especializados com papéis fixos. Cada agent tem expertise definida. O showrunner mantém a visão do "arco narrativo" do projeto — coerência global sobre autonomia individual.

**Por que**: Padrão mais validado (MetaGPT 85.9% Pass@1, ECC 16 agents, Agents' Room ICLR 2025). Hierarquia clara, model tiering natural, extensível para modelos mais complexos.

**Princípio Anthropic**: *"Comece com o sistema mais simples possível, meça, e adicione complexidade apenas onde demonstravelmente necessário."*

---

### 2. Isolamento: Git Worktrees (1 worktree por agent)

Cada agent recebe um worktree isolado com sua própria branch. O `index.lock` é automaticamente separado por worktree. Merge sequencial no main ao final.

**Por que**: Isolamento real do filesystem; 9/9 projetos de referência usam ou recomendam worktrees. `simple-git` + `raw()` suporta nativamente.

**Regras de segurança**:
- Pré-criar branches antes de criar worktrees
- Uma instância SimpleGit por worktree
- Merge sequencial no main (mutex/semáforo)
- Nunca executar `git gc`/`prune` com worktrees ativas

---

### 3. Comunicação: SQLite WAL (mail system tipado)

Banco SQLite local em WAL mode como sistema de mensagens. Mensagens tipadas (8+ tipos). Cada agent faz INSERT, orquestrador faz SELECT + polling. ~1-5ms por query.

**Tipos de mensagem**:
- `task_assigned` — orquestrador → agent
- `task_progress` — agent → orquestrador (heartbeat)
- `task_done` — agent → orquestrador
- `merge_ready` — agent → merger
- `merge_result` — merger → orquestrador
- `escalation` — agent → orquestrador (problema)
- `health_check` — orquestrador → agent (ping)
- `broadcast` — orquestrador → todos

**Por que**: Mais robusto que file-based, mais simples que sockets, persiste entre crashes, debugável com qualquer SQL client.

---

### 4. Merge Workflow: FIFO Queue + Resolution Progressiva (4 Tiers)

Merge requests entram numa fila FIFO. Resolução em 4 camadas progressivas:

| Tier | Estratégia | Quando |
|------|-----------|--------|
| **1** | Fast-forward | Sem divergência |
| **2** | Recursive merge automático | Sem conflitos |
| **3** | `ours`/`theirs` com heurística | Conflitos mecânicos |
| **4** | AI Resolver com histórico por arquivo | Conflitos semânticos |

Se todos os tiers falham → escalation para humano na TUI.

**Por que**: Resolve 90%+ dos merges sem intervenção. AI resolver só é chamado quando necessário (custo controlado).

---

### 5. Roster: Extended Squad (11 agents)

| Agent | Modelo | Papel | Tools principais |
|-------|--------|-------|-----------------|
| `orchestrator` | Opus | Showrunner — decompõe, delega, mantém coerência | Todas |
| `planner` | Sonnet | Decomposição em beat sheet hierárquico | Read, Grep, Glob |
| `builder` | Sonnet | Implementação de código | Read, Write, Edit, Bash |
| `tester` | Sonnet | TDD + validação de testes | Read, Bash(test) |
| `reviewer` | Opus | Code review + verificação de qualidade | Read, Grep, Glob |
| `researcher` | Haiku | Busca + coleta de contexto | Read, Grep, WebSearch |
| `merger` | Sonnet | Resolve conflitos + executa merge | Read, Bash(git), Grep |
| `refactorer` | Haiku | Cleanup + remoção de dead code | Read, Write, Edit |
| `doc-writer` | Haiku | Sincronização de documentação | Read, Write(docs/) |
| `debugger` | Opus | Investigação profunda de bugs | Read, Bash, Grep |
| `context-curator` | Haiku | Curadoria de memória pós-atividade | Read, Grep, SQLite |

**Model tiering** (custo):
- Opus ($15/MTok): orchestrator, reviewer, debugger — decisões críticas
- Sonnet ($3/MTok): planner, builder, tester, merger — 90% do trabalho
- Haiku ($0.80/MTok): researcher, refactorer, doc-writer, context-curator — tarefas mecânicas

**Custo estimado por feature**: ~$0.60-0.80

---

### 6. Decomposição: Hierarchical Beat Sheet (Fractal)

Decomposição em 4 níveis espelhando a hierarquia de McKee:

```
Nível 1: OBJETIVO GLOBAL (arco completo)
  └─ Nível 2: ATOS (3) — Setup, Confronto, Resolução
       └─ Nível 3: SEQUÊNCIAS — grupos de subtarefas
            └─ Nível 4: TAREFAS ATÔMICAS — ação + verificação
```

**Cada nível tem**: precondição → ação → pós-condição (setup → conflito → resolução).

**Checkpoints obrigatórios**:
- Catalyst (~10%): tarefa realmente entendida e viável?
- Midpoint (~50%): progresso real? Replanejamento necessário?
- All Is Lost (~75%): maior risco/bloqueio identificado?
- Break Into Three (~77%): nova abordagem se necessário
- Final Image (100%): validação contra requisitos originais

**Princípio McKee**: *"Cena sem mudança de valor = não-evento que deve ser eliminado."* Cada subtarefa deve produzir mudança de estado mensurável.

---

### 7. Memória: SQLite Unified + Context-Curator Agent

Toda memória vive no SQLite (mesmo banco da comunicação):

| Tabela | Conteúdo | Lifecycle |
|--------|----------|-----------|
| `entities` | Fatos do projeto (arquivos, decisões, patterns) | Persistente |
| `relations` | Relações entre entidades | Persistente |
| `observations` | Eventos de uso de tools (hooks) | 30 dias decay |
| `sessions` | Resumos de sessões anteriores | 7 dias carregados |
| `instincts` | Padrões aprendidos (confiança 0.3-0.85) | Decay se contradito |
| `beat_state` | Estado atual do beat sheet | Por projeto |

**Context-Curator Agent** (Haiku): roda ao final de cada atividade de cada agent. Verifica o que foi feito, decide o que atualizar no knowledge base central. Curadoria humana automatizada — o conhecimento não se acumula cegamente.

**Princípio**: retrieval just-in-time (carregar sob demanda, não tudo upfront).

---

### 8. Anti-Alucinação: Defesa em 4 Camadas + CoVe Seletivo

**Caminho normal** (~$0.03/verificação):
1. **L1 — Prompt design**: permite "não sei" + restrição a fontes fornecidas
2. **L2 — Quote-first**: extrai citações antes de analisar (tarefas documentais)
3. **L3 — Reviewer agent**: valida output contra requisitos (loop max 3x)
4. **L4 — Testes automatizados**: tests pass como gate final

**Caminho crítico** (+$0.12/verificação):
- Chain-of-Verification (CoVe) ativado para outputs marcados `critical: true`
- Pipeline: gerar rascunho → perguntas de verificação → respostas independentes → revisão

**Outputs críticos**: decisões arquiteturais, código de segurança, merges Tier 4, configs de deploy.

---

### 9. Context Window: Tríade (Isoladas + Scratchpad + Strategic Compact)

1. **Janelas isoladas**: cada agent recebe context limpa e focada — apenas o necessário para sua subtarefa
2. **Scratchpad central** (SQLite): fonte única de verdade do estado do projeto
3. **Strategic compact**: compactação nos checkpoints do beat sheet (entre atos), não por threshold automático

**Fluxo**: scratchpad → snapshot para agent → agent executa → output → context-curator atualiza scratchpad → compactação no checkpoint.

**Agents são stateless workers**: recebem snapshot, executam, devolvem resultado. O scratchpad é a memória real.

---

### 10. Interface: Kanban TUI + Detail View (React Ink)

**Tela principal** — Kanban com 5 colunas: `Backlog → Running → Review → Done → Failed`

Cada card mostra: task ID, nome, agent icon, modelo, tempo, custo. Header: ato atual, beat atual, custo total.

**Detail View** (ENTER no card): log em tempo real, diff preview, métricas, context usage bar.

**Ações humanas**:
- `[S]teer`: redireciona agent agora
- `[F]ollow-up`: enfileira instrução para depois
- `[A]bort`: cancela agent, descarta worktree
- `[P]romote`: promove aprendizado para instinct

**Tabs**: `[K]anban · [L]ogs · [M]erge Queue · [C]ost · [B]eat Sheet`

---

### 11. Stack Tecnológico: Node.js + TypeScript

| Componente | Tecnologia | Versão |
|-----------|------------|--------|
| **Runtime** | Node.js LTS | v22+ |
| **Linguagem** | TypeScript (via tsx) | v5.x |
| **Git** | simple-git + `raw()` para worktrees | v3.x |
| **Database** | better-sqlite3 (WAL mode) | v11.x |
| **TUI** | React Ink | v5.x |
| **AI SDK** | @anthropic-ai/sdk | latest |
| **MCP** | @modelcontextprotocol/sdk | v1.x |
| **Testes** | vitest | v3.x |

**Dependências estimadas**: ~15-25 packages.

---

### 12. Segurança: Trust but Verify

Agents rodam com acesso amplo. Toda ação é logada no SQLite. Auditoria pós-sessão revisa logs e flagga ações suspeitas.

**Filosofia**: máxima produtividade dos agents, zero bloqueios falsos, auditoria completa.

**Log de auditoria** (SQLite): cada tool call registrada com timestamp, agent, tool, params, resultado.

**Evolução planejada**: se o orquestrador for usado em ambientes menos controlados, adicionar allowlists de tools por agent (baixo custo, zero latência).

---

## Dependências entre Decisões

```
1. Showrunner ──────→ 5. Extended Squad (papéis do showrunner)
                  ├──→ 6. Beat Sheet (narrativa do showrunner)
                  └──→ 10. Kanban TUI (interface do showrunner)

2. Worktrees ───────→ 4. FIFO 4-Tier (merge entre worktrees)
                  └──→ 11. simple-git (implementação)

3. SQLite WAL ──────→ 7. SQLite Unified (mesmo banco)
                  ├──→ 9. Scratchpad Central (vive no SQLite)
                  └──→ 12. Audit Log (vive no SQLite)

6. Beat Sheet ──────→ 8. CoVe seletivo (checkpoints = pontos de verificação)
                  └──→ 9. Strategic Compact (compacta nos checkpoints)

7. Context-Curator ─→ 9. Tríade (curador alimenta scratchpad)
```

---

## Princípios Guia (extraídos das decisões)

1. **Decomposição fractal**: cada nível espelha setup-conflito-resolução
2. **Mudança de estado obrigatória**: subtarefa sem output verificável = overhead
3. **Agents stateless, scratchpad stateful**: agents recebem snapshot, executam, devolvem
4. **SQLite para tudo**: comunicação, memória, auditoria — um banco, zero infraestrutura
5. **Curadoria > acumulação**: context-curator decide o que persiste, não acumula cegamente
6. **Model tiering**: Opus para decisões, Sonnet para trabalho, Haiku para mecânica
7. **Verificação proporcional ao risco**: defesa leve no caminho feliz, pesada no crítico
8. **Human-in-the-loop sob demanda**: steer/follow_up/abort sempre disponíveis na TUI
9. **Simplicidade primeiro**: começar simples, medir, escalar com evidência

---

## Próximos Passos

1. Inicializar projeto Node.js + TypeScript com dependências core
2. Implementar schema SQLite (mensagens + memória + auditoria)
3. Scaffolding da TUI Ink (Kanban básico)
4. WorktreeManager (wrapper simple-git para worktrees)
5. Orchestrator loop básico (recebe tarefa → decompõe → delega → coleta)
6. Primeiro agent funcional (builder com worktree isolado)
7. Merge workflow (começar com Tier 1-2, adicionar 3-4 depois)
8. Beat sheet engine (decomposição hierárquica)
9. Context-curator agent
10. Verificação (L1-L4 + CoVe seletivo)
