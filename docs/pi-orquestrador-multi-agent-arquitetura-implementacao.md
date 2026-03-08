# Construindo um Orquestrador Multi-Agent com Pi: Análise de Arquitetura e Implementação

## Construir um orquestrador multi-agent com Pi é totalmente viável

**Um pipeline baseado em shell que decompõe tarefas, spawna agentes Pi em sessões tmux e git worktrees, e depois faz merge e testa os resultados é não apenas tecnicamente possível — o ecossistema já fornece a maioria dos blocos de construção.** Os quatro modos operacionais do Pi (Interativo, Print/JSON, RPC, SDK) oferecem superfícies de controle progressivamente mais ricas para orquestração externa, sendo o protocolo RPC a escolha ideal para um pipeline controlado via bash. O modelo de git worktree oferece isolamento real de filesystem entre agentes, os canais `wait-for` do tmux permitem sincronização limpa, e pelo menos seis ferramentas da comunidade (workmux, dmux, agtx, pi-messenger, pi-agent-teams, extensão control do mitsuhiko) já comprovaram variações desta arquitetura. Os riscos principais são conflitos de merge por edições sobrepostas, esgotamento da janela de contexto durante a decomposição de tarefas, e acúmulo de espaço em disco por `node_modules` duplicados entre worktrees. A abordagem recomendada: construir um **orquestrador bash que usa o modo RPC do Pi** para controle estruturado dos agentes, janelas tmux para monitoramento visual, git worktrees para isolamento, e um protocolo de tarefas/status baseado em arquivos para coordenação — começando com um pipeline mínimo viável de três estágios (planejar → executar → merge) antes de adicionar agentes de revisão, testes e documentação.

---

## O Pi expõe quatro superfícies de controle, cada uma adequada a diferentes necessidades de orquestração

A arquitetura do Pi oferece uma separação limpa entre seus quatro modos, e entender seus tradeoffs é essencial para escolher a estratégia de integração correta.

**O modo Print** (`pi -p "query"`) é o ponto de entrada mais simples. O processo encerra automaticamente após o agente completar seu trabalho, tornando-o ideal para subtarefas fire-and-forget. Combinar `-p` com `--mode json` gera um stream de eventos JSONL onde cada linha é um objeto JSON tipado — `agent_start`, `turn_start`, `message_update` (com subtipos `text_delta` e `thinking_delta`), `tool_execution_start/end`, e crucialmente **`agent_end`**, que sinaliza a conclusão da tarefa. O comportamento do código de saída segue as convenções padrão: zero em sucesso, não-zero em falha. A flag `--no-session` torna as execuções efêmeras, perfeitas para agentes de subtarefas descartáveis.

**O modo RPC** (`pi --mode rpc`) é o candidato mais forte para orquestração. Ele expõe um protocolo JSON bidirecional via stdin/stdout com **12 tipos de comando**: `prompt`, `steer` (interromper trabalho atual), `follow_up` (enfileirar para após conclusão), `abort`, `bash`, `get_state`, `get_messages`, `get_session_stats`, `set_model`, `set_thinking_level`, `compact` e `new_session`. Os comandos suportam campos `id` opcionais para correlação request-response. O protocolo trata um caso-limite crítico: se o agente já está fazendo streaming quando um novo `prompt` chega, um campo `streamingBehavior` especifica a estratégia de resolução.

```python
# Controle RPC mínimo a partir de qualquer linguagem
proc = subprocess.Popen(["pi", "--mode", "rpc", "--no-session"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def send(cmd):
    proc.stdin.write(json.dumps(cmd) + "\n")
    proc.stdin.flush()

send({"type": "prompt", "message": "Refatorar módulo de autenticação"})
for line in proc.stdout:
    event = json.loads(line)
    if event.get("type") == "agent_end":
        break  # Tarefa completa
```

**O modo SDK** oferece o controle mais profundo para orquestradores Node.js. O factory `createAgentSession()` aceita opções de `model`, `thinkingLevel`, `tools` (sobrescrever defaults), `customTools` (estender defaults), `sessionManager` e `resourceLoader`. O objeto de sessão expõe `prompt()`, `steer()`, `followUp()` e `subscribe()` para streaming de eventos, além de `agent.waitForIdle()` para detecção síncrona de conclusão. O factory `SessionManager.inMemory()` cria sessões efêmeras com zero I/O em disco. Extensões inline podem ser injetadas via `extensionFactories` no `ResourceLoader`, permitindo customização de comportamento por agente sem arquivos separados.

```typescript
const { session } = await createAgentSession({
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  thinkingLevel: "off",
  sessionManager: SessionManager.inMemory(),
  tools: createCodingTools("/caminho/para/worktree"),  // Escopo no worktree
});
await session.prompt("Implementar o módulo de auth conforme ROADMAP.md");
```

**A hierarquia de override de configuração** é importante para setups multi-agent. O Pi concatena arquivos `AGENTS.md` de `~/.pi/agent/AGENTS.md` → diretórios pais → `<cwd>/AGENTS.md`, o que significa que cada worktree pode ter suas próprias instruções de projeto enquanto herda convenções globais. O `SYSTEM.md` em `<cwd>/.pi/SYSTEM.md` substitui completamente o system prompt padrão, enquanto o `APPEND_SYSTEM.md` o estende. Para orquestração, colocar um `AGENTS.md` específico do worktree no diretório de trabalho de cada agente permite **especialização de papel por agente** sem mudanças de código.

**O ciclo de vida das extensões** fornece 15+ eventos hookeáveis em um fluxo bem definido: `session_start` → `input` → `before_agent_start` → `agent_start` → (`turn_start` → `context` → `tool_call` → `tool_execution_*` → `tool_result` → `turn_end`)* → `agent_end`. O hook `context` é particularmente poderoso — ele pode modificar mensagens antes de cada turno do LLM, permitindo injeção de RAG, gerenciamento de memória ou compartilhamento de contexto entre agentes. O hook `tool_call` pode bloquear operações (retornando `{ block: true, reason }`) para gates de segurança, e `tool_result` pode transformar outputs antes que o LLM os veja.

---

## O tmux oferece controle programático robusto de sessões com sincronização integrada

A API de scripting do tmux cobre todos os requisitos para orquestração multi-agent. Sessões, janelas e painéis são criados com `tmux new-session -d -s nome`, `tmux new-window -t sessao -n nome -c /diretorio/trabalho` e `tmux split-window`. Comandos são enviados via `tmux send-keys -t sessao:janela.painel "comando" Enter`. A sintaxe de alvo `sessao:janela.painel` permite roteamento preciso para o terminal de qualquer agente.

**O mecanismo de canais `wait-for` é a espinha dorsal da sincronização.** Ele implementa canais nomeados que bloqueiam o shell chamador até serem sinalizados:

```bash
# Fan-out: lançar 4 agentes em paralelo
for i in 1 2 3 4; do
    tmux new-window -t pipeline -n "agent-$i" -c "$WORKTREE/$i"
    tmux send-keys -t "pipeline:agent-$i" \
        "pi -p 'Executar tarefa $i conforme ROADMAP.md' --no-session; tmux wait-for -S agent-${i}-done" Enter
done

# Fan-in: bloquear até todos completarem
for i in 1 2 3 4; do
    tmux wait-for "agent-${i}-done"
    echo "Agente $i finalizado"
done
```

A captura de output usa duas abordagens complementares. **`tmux capture-pane -t alvo -p -S -`** despeja todo o histórico de scrollback para stdout — útil para análise post-hoc. **`tmux pipe-pane -t alvo -o 'cat >> /tmp/agent.log'`** faz streaming do output para um arquivo em tempo real — essencial para monitoramento ao vivo. Para dados estruturados, prefira o output `--mode json` do Pi canalizado para um arquivo em vez de fazer scraping do conteúdo do painel tmux.

Além do `wait-for`, existem quatro outros métodos de detecção de conclusão: polling do conteúdo do painel procurando padrões de prompt do shell (frágil mas universal), arquivos marcadores (`touch /tmp/done` após o comando), monitoramento de `pane_pid` para saída de processo, e `remain-on-exit` combinado com hooks do tmux. A abordagem `wait-for` é **fortemente recomendada** para orquestração porque não usa polling, é livre de condições de corrida e composável.

**O gerenciamento de layout** suporta visualizações em grade para monitorar muitos agentes simultaneamente. Após criar N painéis, `tmux select-layout tiled` distribui-os uniformemente. O layout `main-vertical` fornece um painel grande do orquestrador à esquerda com painéis menores de agentes empilhados à direita — ideal para monitoramento estilo dashboard.

---

## Git worktrees fornecem isolamento genuíno, mas o merge requer estratégia cuidadosa

Cada `git worktree add` cria um diretório de trabalho independente com seu próprio index (staging area), HEAD e estado de arquivos, enquanto **compartilha o banco de objetos e refs** através de um único diretório `.git`. Isso significa que múltiplos agentes Pi podem executar `git add` e `git commit` concorrentemente sem conflitos de lock no index — cada worktree bloqueia seu próprio arquivo de index em `.git/worktrees/<n>/index.lock`.

**O limite crítico de segurança:** operações que modificam refs compartilhados (criação de branches, `git push`, `git fetch`) usam arquivos de lock por ref e podem falhar sob concorrência. O padrão seguro é pré-criar todas as branches antes de lançar os agentes, restringir agentes a commitar apenas na sua própria branch, e realizar todos os merges sequencialmente a partir de um único processo orquestrador.

```bash
BASE=$(git rev-parse main)
git worktree add .worktrees/auth -b agent/auth $BASE
git worktree add .worktrees/api  -b agent/api  $BASE
git worktree add .worktrees/ui   -b agent/ui   $BASE
```

**A seleção de estratégia de merge depende da sobreposição de arquivos.** Para agentes trabalhando em arquivos estritamente não-sobrepostos (o caso ideal), **octopus merge** combina todas as branches simultaneamente mas aborta se houver qualquer conflito — um aviso antecipado útil. Para modificações sobrepostas, **merges sequenciais com `--no-ff`** permitem detecção e resolução de conflitos em cada etapa. Um merge de teste (`git merge --no-commit --no-ff branch; git merge --abort`) pode pré-detectar conflitos antes de commitar.

Para resolução de conflitos, três estratégias automatizadas existem: `git merge -X theirs` (favorecer mudanças do agente), `git merge -X ours` (favorecer o main), ou **resolução assistida por IA** onde arquivos conflitantes são passados para um agente Pi de merge dedicado. A feature `git rerere` (Reuse Recorded Resolution) pode cachear e reproduzir resoluções manuais para conflitos recorrentes.

**Preocupações práticas com worktrees** centram-se em espaço em disco e dependências. Cada worktree duplica a árvore de trabalho, e `node_modules` sozinho pode consumir gigabytes por worktree. O projeto workmux resolve isso com configuração `files.symlink: [node_modules]` e `files.copy: [.env]` para arquivos de ambiente. Usar `pnpm` (store compartilhado endereçável por conteúdo) reduz dramaticamente a duplicação. Hooks pós-criação devem rodar instalação de dependências: `post_create: ["pnpm install"]`.

---

## O pipeline deve fluir por sete estágios orquestrados

A arquitetura proposta usa um **padrão plan-then-execute** com paralelismo baseado em ondas:

```
Prompt do Usuário
    │
    ▼
┌───────────────────┐
│ 1. AGENTE CONTEXTO│  Escaneia estrutura do codebase, lê AGENTS.md,
│   (Pi RPC)        │  produz CONTEXT.md com mapa de arquivos + convenções
└────────┬──────────┘
         ▼
┌───────────────────────┐
│ 2. AGENTE PLANEJADOR  │  Decompõe tarefa em subtarefas, identifica
│   (Pi RPC)            │  dependências, gera ROADMAP.md com
│                       │  hints de paralelização e atribuição de arquivos
└────────┬──────────────┘
         ▼
┌───────────────────────────────────────────────┐
│ 3. AGENTES WORKERS PARALELOS (Pi print)       │
│                                               │
│  tmux:agent-1 ──► worktree/auth               │
│  tmux:agent-2 ──► worktree/api                │  Onda 1 (independentes)
│  tmux:agent-3 ──► worktree/ui                 │
│                                               │
│  tmux:agent-4 ──► worktree/integracao         │  Onda 2 (depende de 1-3)
└────────┬──────────────────────────────────────┘
         ▼
┌───────────────────┐
│ 4. AGENTE MERGE   │  Merge sequencial com detecção de conflitos;
│   (Pi RPC)        │  resolução assistida por IA para conflitos
└────────┬──────────┘
         ▼
┌───────────────────┐
│ 5. AGENTE TESTES  │  Roda suíte de testes, linter, type checker;
│   (Pi print)      │  se falhar, spawna agentes de correção
└────────┬──────────┘
         ▼
┌───────────────────┐
│ 6. AGENTE REVISÃO │  Avalia código mergado contra o prompt
│   (Pi RPC)        │  original; verifica completude
└────────┬──────────┘
         ▼
┌───────────────────┐
│ 7. AGENTE DOCS    │  Atualiza README, CHANGELOG, docs inline
│   (Pi print)      │  baseado nas mudanças reais feitas
└───────────────────┘
```

**Estágios 1-2 são sequenciais** (cada um depende do output anterior). **Estágio 3 usa paralelismo baseado em ondas** — o ROADMAP.md do planejador especifica quais tarefas são independentes (Onda 1) e quais dependem dos outputs da Onda 1 (Onda 2). **Estágios 4-7 são sequenciais** mas podem curto-circuitar (se os testes passam, pula agentes de correção).

A comunicação entre agentes usa um **protocolo baseado em arquivos** em um diretório compartilhado `.pipeline/`:

```
.pipeline/
├── CONTEXT.md          # Output do estágio 1
├── ROADMAP.md          # Output do estágio 2 (lista de tarefas com atribuições)
├── status/
│   ├── agent-1.json    # {"status": "complete", "files_modified": [...]}
│   ├── agent-2.json
│   └── agent-3.json
├── merge-report.md     # Output do estágio 4
└── test-results.json   # Output do estágio 5
```

Cada agente worker recebe sua subtarefa via o arquivo `AGENTS.md` colocado em seu worktree, que referencia o `ROADMAP.md` compartilhado e seu ID de tarefa específico. Isso explora o carregamento natural de configuração do Pi — sem extensões customizadas necessárias para orquestração básica.

---

## Um plano de construção em três fases vai do protótipo à produção

**Fase 1 — Pipeline mínimo viável (1-2 semanas).** Construir um único script bash (`orchestrate.sh`) que lida com detecção de dependências, criação de worktrees, setup de sessão tmux e execução sequencial de agentes usando `pi -p`. Pular a decomposição de tarefas — exigir que o usuário forneça um `ROADMAP.md` com subtarefas predefinidas. Usar `tmux wait-for` para sincronização e `git merge --no-ff` sequencial para integração. Isso prova que o encanamento funciona.

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR=$(pwd)
SESSION="pi-pipeline-$$"
BASE=$(git rev-parse HEAD)

# Parsear ROADMAP.md para tarefas (grep simples)
mapfile -t TASKS < <(grep '^## Tarefa:' ROADMAP.md | sed 's/## Tarefa: //')

# Criar worktrees e lançar agentes
tmux new-session -d -s "$SESSION" -n orchestrator
for i in "${!TASKS[@]}"; do
    task="${TASKS[$i]}"
    slug=$(echo "$task" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
    git worktree add ".worktrees/$slug" -b "agent/$slug" "$BASE"
    
    # Copiar contexto compartilhado no worktree
    cp .pipeline/CONTEXT.md ".worktrees/$slug/.pipeline/"
    cp .pipeline/ROADMAP.md ".worktrees/$slug/.pipeline/"
    
    tmux new-window -t "$SESSION" -n "$slug" -c "$PROJECT_DIR/.worktrees/$slug"
    tmux send-keys -t "$SESSION:$slug" \
        "pi -p 'Você é o agente $((i+1)). Execute a tarefa: $task. Veja ROADMAP.md para contexto completo.' \
        --no-session 2>&1 | tee /tmp/pi-$slug.log; \
        tmux wait-for -S ${slug}-done" Enter
done

# Aguardar todos os agentes
for i in "${!TASKS[@]}"; do
    task="${TASKS[$i]}"
    slug=$(echo "$task" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
    tmux wait-for "${slug}-done"
    echo "✓ $slug completo"
done

# Merge sequencial
for i in "${!TASKS[@]}"; do
    slug=$(echo "${TASKS[$i]}" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
    git merge --no-ff "agent/$slug" -m "Merge agent/$slug" || {
        echo "⚠ Conflito no merge de $slug — resolução manual necessária"
        exit 1
    }
done
```

**Fase 2 — Planejamento com IA e controle RPC (2-3 semanas).** Substituir o ROADMAP.md manual por um agente planejador que analisa o codebase e decompõe a tarefa do usuário. Trocar agentes workers do modo print para modo RPC para monitoramento estruturado de eventos. Adicionar um agente de merge que trata conflitos via IA. Implementar execução baseada em ondas onde o planejador especifica dependências entre tarefas.

**Fase 3 — Pipeline completo com revisão, testes e docs (2-3 semanas).** Adicionar o agente executor de testes (roda suíte de testes, reporta falhas), agente de revisão (avalia completude contra o prompt original), agente de documentação, e um loop de retry para testes falhados. Construir um dashboard TUI interativo mostrando status dos agentes por janela tmux, usando ícones de status (🤖 trabalhando, 💬 aguardando, ✅ concluído) emprestados do padrão do workmux.

---

## Sete riscos que podem quebrar o pipeline

**Conflitos de merge por edições sobrepostas** são o modo de falha de maior probabilidade. Mesmo com atribuição de arquivos por tarefa no ROADMAP, agentes frequentemente tocam arquivos compartilhados como `package.json`, barrel exports em `index.ts`, ou módulos CSS. Mitigação: o agente planejador deve explicitamente atribuir propriedade de arquivos, e o agente de merge deve usar `git diff --name-only main..agent/branch` para pré-detectar sobreposição antes de tentar merges.

**Esgotamento da janela de contexto durante o planejamento** ocorre quando o codebase é grande. Um projeto de 100 arquivos produz um mapa de arquivos de milhares de tokens que, combinado com o prompt do usuário e convenções, pode consumir contexto significativo. Mitigação: o agente de contexto deve produzir um resumo **comprimido** — nomes de arquivos e descrições de uma linha, não conteúdos completos — e o planejador deve usar a ferramenta `read` do Pi seletivamente em vez de receber todo o codebase de antemão.

**Multiplicação de espaço em disco** de worktrees com `node_modules` é um bloqueio prático. Cinco worktrees de um projeto de 500MB com dependências podem facilmente consumir **5-10GB**. Mitigação: usar `pnpm` para armazenamento compartilhado de dependências, criar symlinks de `node_modules` onde seguro, e implementar limpeza agressiva após o merge.

**Condições de corrida em refs git compartilhados** podem causar erros de `index.lock` se agentes tentam criar branches, fetch ou push concorrentemente. Mitigação: pré-criar todas as branches no orquestrador antes de lançar agentes, e restringir operações git dos agentes ao index do seu próprio worktree.

**Agentes Pi saindo do trilho** é inerente à execução baseada em LLM. Um agente designado para "implementar auth" pode refatorar código não-relacionado, criando conflitos de merge inesperados. Mitigação: usar `--tools read,bash,edit,write` (os defaults já são mínimos), colocar restrições explícitas de escopo no `AGENTS.md` de cada worktree, e implementar um agente de revisão que verifica o diff de cada agente contra sua tarefa atribuída.

**Escalonamento de custo de tokens** é não-trivial. Sete estágios do pipeline cada um consumindo **50k-200k tokens** significa que uma única execução do pipeline pode custar **$5-30** dependendo do modelo e complexidade da tarefa. Mitigação: usar modelos mais baratos (Haiku/GPT-4o-mini) para estágios de coleta de contexto e testes, reservando Sonnet/Opus para planejamento e implementação complexa.

**Portabilidade cross-platform** introduz bugs sutis. O `sed -i` do BSD no macOS requer um argumento de string vazia (`sed -i ''`), `flock` não existe no macOS (usar `mkdir` para locking portável), e aritmética de `date` difere completamente. Mitigação: usar uma biblioteca utilitária portável com wrappers de detecção de plataforma e preferir `printf` sobre `echo -e`.

---

## Um ecossistema rico de trabalhos anteriores fornece componentes reutilizáveis

O panorama de ferramentas existentes divide-se em três camadas de relevância:

**Infraestrutura diretamente reutilizável** inclui **workmux** (Rust, por Raine Virta), que mapeia worktrees para janelas tmux com auto-detecção de agentes, cópia de `.env`, symlinks de `node_modules`, ícones de status e merge com um comando. Seu padrão de configuração `.workmux.yaml` e hooks `post_create` são diretamente adotáveis. **dmux** (standardagents) oferece uma alternativa mais leve com lançamentos A/B de agentes no mesmo prompt e seleção multi-agent por tarefa. **agtx** adiciona uma TUI estilo Kanban com transições de estado `Backlog → Planning → Running → Review → Done`.

**Ferramentas de integração profunda com Pi** incluem **pi-messenger** (nicobailon), que implementa comunicação em malha entre agentes Pi via passagem de mensagens baseada em arquivos, reserva de arquivos para prevenir conflitos de escrita (hook `tool_call` bloqueia edições em caminhos reservados), e um **sistema Crew** com papéis de Planner/Worker/Reviewer definidos como arquivos markdown. **pi-agent-teams** (tmustier) implementa um modelo líder-membros-da-equipe com listas de tarefas compartilhadas, rastreamento de dependências, auto-claim para agentes ociosos, e isolamento por git worktree por membro da equipe. Ambos demonstram que o sistema de extensões do Pi é expressivo o suficiente para coordenação multi-agent sofisticada.

**A extensão control de Armin Ronacher** (mitsuhiko/agent-stuff) adota uma abordagem diferente: comunicação inter-sessão baseada em Unix domain sockets. Cada sessão Pi expõe um socket, habilitando mensagens cross-sessão com modos de entrega `steer` (interromper) e `follow_up` (após conclusão). O parâmetro `wait` suporta bloqueio até `turn_end` ou `message_processed`, tornando-o adequado para orquestração síncrona. Sua skill de tmux também demonstra isolamento de socket privado (`SOCKET_DIR=${TMPDIR}/claude-tmux-sockets`) para manter sessões tmux de agentes separadas.

**Ferramentas do ecossistema Claude Code** fornecem padrões arquiteturais transferíveis mesmo que tenham como alvo um agente diferente. O **claude_code_agent_farm** (Dicklesworthstone) roda 20-50+ agentes em paralelo via tmux com coordenação baseada em locks e timeout adaptativo de inatividade. **Overstory** (jayminwest) implementa um coordenador persistente com daemon watchdog mecânico, resolução de conflitos em camadas, e salvamento/restauração de checkpoints para sobrevivência à compactação. **claude-swarm** (affaan-m) demonstra execução baseada em ondas com um gate de qualidade classe Opus entre fases.

A percepção arquitetural chave entre todas essas ferramentas: **o padrão worktree-por-agente convergiu como o padrão**, comunicação baseada em arquivos domina sobre abordagens baseadas em sockets pela simplicidade, e os orquestradores mais bem-sucedidos usam execução baseada em ondas com grafos de dependência explícitos em vez de colaboração totalmente autônoma entre agentes. O orquestrador que você construir deve se apoiar nessa fundação — usando os padrões de infraestrutura do workmux, o protocolo de comunicação do pi-messenger, e o modelo de execução baseado em ondas do claude-swarm — em vez de reinventar esses problemas já resolvidos.