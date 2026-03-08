# Story breaking encontra task decomposition: um framework unificado para agentes de IA

## Sumário executivo

**A decomposição hierárquica de narrativas — praticada por roteiristas há décadas — oferece um modelo surpreendentemente preciso para a engenharia de tarefas em sistemas de agentes LLM.** Métodos como o beat sheet de Blake Snyder (15 beats), a Jornada do Herói de Campbell/Vogler (12 estágios) e a hierarquia de McKee (beat → cena → sequência → ato → história) compartilham uma estrutura fractal isomórfica às Hierarchical Task Networks da IA clássica. Em paralelo, frameworks de task decomposition para LLMs — Chain-of-Thought [1], Tree of Thoughts [2], DecomP [3], ADaPT [4] e TDAG [5] — evoluíram de cadeias lineares para grafos dinâmicos com backtracking e replanejamento adaptativo. Arquiteturas multi-agente como MetaGPT [7], AutoGen [9] e Agents' Room [10] já operacionalizam essa analogia, replicando papéis de sala de roteiristas (showrunner como orquestrador, assistente como memória compartilhada, bible como knowledge base). Este relatório mapeia sistematicamente os princípios transferíveis entre story breaking e task decomposition, compara frameworks com evidências empíricas, e fornece templates práticos em XML para implementação imediata. O período coberto prioriza desenvolvimentos de 2023–2026, com ênfase em 2025. **Nível de confiança: alto para os paralelos estruturais e frameworks acadêmicos; médio-alto para padrões emergentes de 2025.**

---

## Fundamentos de story breaking: a engenharia narrativa como ciência da decomposição

A decomposição de histórias em unidades estruturais gerenciáveis é o problema central da escrita profissional. Cinco metodologias dominantes codificam essa prática, e todas convergem para um princípio fundamental: **decomposição hierárquica recursiva com mudança de valor em cada nível**.

O **beat sheet Save the Cat** de Blake Snyder [22] divide um roteiro em **15 beats** com posições percentuais fixas: Catalyst (~10%), Midpoint (~50%), All Is Lost (~75%), Break Into Three (~77%). Cada beat funciona como um waypoint obrigatório — um checkpoint de progresso com critérios claros de mudança de estado. Isso é diretamente análogo a marcos de avaliação em arquiteturas Plan-and-Execute de agentes IA.

A **Jornada do Herói** de Campbell/Vogler [25] organiza 12 estágios em três atos (Partida, Iniciação, Retorno), onde cada estágio representa uma transformação irreversível do protagonista. O insight crítico para IA é o conceito de **Ordeal** (Provação): um ponto onde o herói enfrenta seu maior medo e é transformado — mapeável diretamente para o padrão de *failure-driven decomposition* do ADaPT [4], onde a falha na execução dispara replanejamento.

O **Sequence Method** de Frank Daniel [23], codificado por Paul Joseph Gulino, divide o filme em **8 sequências** de 10-15 minutos. Sua inovação fundamental: cada sequência resolve *parcialmente* um conflito, mas essa resolução parcial **abre novos problemas** para as sequências seguintes. Este é o princípio de *interleaved decomposition* — decompor e executar simultaneamente, adaptando-se conforme novos subobjetivos emergem.

Robert McKee [23] formaliza a **hierarquia narrativa mais rigorosa**: beat → cena → sequência → ato → história. Cada nível espelha a estrutura do todo (setup-conflito-resolução), criando uma **estrutura fractal**. McKee insiste que toda cena deve produzir uma *mudança de valor* — se não muda nada, é um "não-evento" que deve ser eliminado. Para IA, isso se traduz na regra: **cada subtarefa deve produzir uma mudança de estado mensurável que avance em direção ao objetivo** [Confiança: alta — princípio universal].

John Truby [24] organiza **22 passos** em torno de 7 estruturas-chave (Necessidade → Desejo → Oponente → Plano → Batalha → Autorrevelação → Novo Equilíbrio), onde cada revelação dispara uma mudança de desejo e motivação. Para agentes IA, o "Plano" do protagonista (passo 10) mapeado contra o "Plano do Oponente" (passo 11) é uma representação precisa de um agente operando contra **restrições ambientais adversárias** — o agente tem um objetivo (desejo), restrições de alinhamento (necessidade, que ele desconhece), e uma estratégia que deve ser ajustada quando encontra resistência.

### A sala de roteiristas como o primeiro sistema multi-agente

A **sala de roteiristas de TV** é o modelo colaborativo mais sofisticado de story breaking. O showrunner atua como **orquestrador/supervisor**, com autoridade final sobre arco narrativo. Story editors e staff writers funcionam como **agentes de planejamento especializados**. O writers' assistant mantém **memória compartilhada** (notas, continuidade). O script coordinator gerencia **controle de qualidade** (formatação, bible da série). O processo segue fases bem definidas: blue sky (brainstorming divergente) → season breaking → episode breaking → outline → draft → room rewrite (refinamento iterativo).

O paper **Agents' Room** do Google DeepMind [10], publicado na ICLR 2025, implementa explicitamente essa analogia: agentes especializados (conflito, personagem, cenário, enredo) coordenados por um orquestrador central usando um **scratchpad compartilhado** como mecanismo de comunicação. Histórias geradas foram preferidas por avaliadores humanos sobre baselines single-agent em todas as dimensões.

---

## Taxonomia de task decomposition: de cadeias lineares a grafos adaptativos

A evolução dos frameworks de decomposição segue uma trajetória clara: **cadeia linear → árvore com backtracking → grafo arbitrário → decomposição adaptativa dinâmica**. Cada salto adiciona expressividade ao custo de complexidade computacional e de engenharia.

**Chain-of-Thought (CoT)** [1] é o ponto de partida: exemplos few-shot com raciocínio intermediário. Simples, eficaz (+18% em GSM8K com PaLM-540B), mas limitado a raciocínio linear sem backtracking. **Self-Consistency** [26] adiciona paralelismo via amostragem múltipla e votação majoritária (+17.9% em GSM8K), ao custo de 5-40× mais chamadas de inferência. Um estudo da Wharton de 2025 encontrou que CoT oferece ganhos mínimos para modelos de raciocínio modernos (classe o1) — evidência de que modelos mais avançados internalizam a decomposição durante o treinamento.

**Tree of Thoughts (ToT)** [2] (NeurIPS 2023, Oral) generaliza CoT para uma árvore com BFS/DFS e autoavaliação pelo LLM. O resultado no Game of 24 é dramático: **74% vs. 4% do CoT** com GPT-4. O mecanismo permite exploração deliberada, lookahead e backtracking — raciocínio "Sistema 2". Porém, o custo computacional é proporcional a largura × profundidade da árvore. **Graph of Thoughts (GoT)** [6] (AAAI 2024) vai além, permitindo operações de **agregação/merge** impossíveis em árvores, melhorando qualidade de ordenação em 62% vs. ToT com 31% menos custo.

**Decomposed Prompting (DecomP)** [3] (ICLR 2023) introduz modularidade: um "decomposer" gera subquestões delegadas a **handlers especializados** (outros prompts LLM, modelos treinados, ou funções simbólicas como ElasticSearch). Suporta decomposição recursiva e hierárquica — alcançando quase 100% de acurácia em operações de lista mesmo com sequências longas (**invariância de escala**).

**ADaPT** [4] (NAACL 2024 Findings) é o framework mais sofisticado para decisão interativa: o executor tenta a tarefa diretamente; se falha, o **planner decompõe em subtarefas com operadores AND/OR**; cada subtarefa é recursivamente passada de volta ao ADaPT. A decomposição acontece *as-needed* — adaptando-se tanto à complexidade da tarefa quanto à capacidade do modelo. Resultados: **+28.3% em ALFWorld, +27% em WebShop** sobre ReAct e Reflexion.

**TDAG** [5] (Neural Networks, 2025) combina decomposição dinâmica com **geração de agentes custom** por subtarefa: para cada subtarefa, um subagente especializado é criado pelo LLM com documentação de ferramentas aprimorada e acesso a uma biblioteca de habilidades acumulada. Isso reduz ruído de contexto irrelevante e permite aprendizado incremental.

### Tabela comparativa de frameworks de decomposição

| Framework | Topologia | Granularidade | Seq/Paralelo | Estático/Dinâmico | Trade-off principal |
|-----------|-----------|---------------|--------------|-------------------|-------------------|
| **CoT** [1] | Cadeia linear | Fina (passo) | Sequencial | Estático | Simples, mas limitado a raciocínio linear |
| **Self-Consistency** [26] | Cadeias paralelas | Fina | Paralelo | Seleção dinâmica | +17% acurácia, mas ≥5× custo |
| **ToT** [2] | Árvore | Média (pensamento) | Paralelo (branching) | Dinâmico (busca) | 74% vs 4% no Game of 24, mas custo muito alto |
| **GoT** [6] | Grafo arbitrário | Adaptativa | Paralelo (operações) | Blueprint estático, execução dinâmica | Mais expressivo, mas maior complexidade de engenharia |
| **DecomP** [3] | DAG/recursivo | Média-fina | Sequencial c/ branching | Semi-dinâmico | Modular e invariante em escala, mas exige design de handlers |
| **ADaPT** [4] | Árvore recursiva | Adaptativa (grosso→fino) | Sequencial (recursivo) | Dinâmico (por falha) | Adapta à complexidade, mas requer ambiente interativo |
| **TDAG** [5] | DAG dinâmico | Grosso-média | Sequencial c/ replanejamento | Dinâmico | Agentes custom por subtarefa, mas alto overhead de geração |
| **HuggingGPT** [18] | DAG | Grossa (modelo) | Paralelo (DAG) | Semi-estático | Orquestração multimodal, mas alta latência |

---

## Arquiteturas multi-agente para tarefas complexas

A paisagem de frameworks multi-agente consolidou-se significativamente em 2025, com cinco arquiteturas dominantes, cada uma com uma filosofia distinta de decomposição.

**MetaGPT** [7] (ICLR 2024 Oral) codifica **Standard Operating Procedures** de empresas de software em fluxos multi-agente. Agentes com papéis definidos (Product Manager, Architect, Engineer, QA) produzem artefatos estruturados (PRDs, diagramas UML, specs de API) que alimentam o próximo estágio via um **message pool com publish-subscribe**. Resultado: **85.9% Pass@1 no HumanEval**, 100% taxa de conclusão em projetos complexos.

**ChatDev** [8] (ACL 2024) simula uma empresa virtual de software com um modelo waterfall dividido em fases (design, coding, testing, documenting). Cada fase se decompõe em **Atomic Chats** — diálogos dual-agent (instructor-assistant) via inception prompting até consenso. A inovação-chave é a **dehallucination comunicativa**: agentes proativamente solicitam detalhes específicos antes de responder, reduzindo alucinações.

**AutoGen** [9] (COLM 2024, Microsoft) trata **conversas como primitiva universal** para workflows de agentes. A versão 0.4 (janeiro 2025) trouxe redesign completo com **modelo Actor**, arquitetura em camadas (Core → AgentChat → Extensions), e o Magentic-One como sistema multi-agente generalista. Em 2025-2026, AutoGen está sendo sucedido pelo **Microsoft Agent Framework** com suporte multi-linguagem e integração Azure.

**Agents' Room** [10] (ICLR 2025, Google DeepMind) decompõe a escrita narrativa em subtarefas **inspiradas na teoria narrativa**, usando agentes especializados em conflito, personagem, cenário e enredo, coordenados por um orquestrador central com **scratchpad compartilhado**. O **StoryWriter** [11] (CIKM 2025) vai além com uma estratégia de **Narração Não-Linear** que otimiza a alocação de eventos em capítulos para proximidade causal e recorrência de personagens.

**CrewAI** [17] oferece a abstração mais pragmática: Agents (com role, goal, backstory) + Tasks (com description, expected_output, dependencies) + Crews (com process type) + Flows (orquestração event-driven). Suporta processos sequenciais, hierárquicos (com manager agent automático) e paralelos, com **quatro tipos de memória** (curta, longa, de entidade, contextual). Em 2025, atende 60% das Fortune 500 com 100.000+ desenvolvedores certificados.

### Descrição do diagrama conceitual: fluxo de decomposição unificado

Imagine um fluxo em cinco camadas descendentes, análogo à hierarquia de McKee:

```
┌─────────────────────────────────────────────┐
│  NÍVEL 1: HISTÓRIA / OBJETIVO GLOBAL        │
│  (Arco narrativo completo / Meta do agente) │
└──────────────────┬──────────────────────────┘
                   │ Decomposição em atos
┌──────────┬───────┴───────┬──────────┐
│  ATO 1   │    ATO 2      │  ATO 3   │
│ (Setup)  │ (Confronto)   │(Resolução)│
└────┬─────┘───────┬───────┘────┬─────┘
     │             │             │ Decomposição em sequências
┌────┴────┐  ┌─────┴─────┐  ┌──┴──────┐
│ Seq 1-2 │  │ Seq 3-6   │  │ Seq 7-8 │
│(Subtask │  │(Subtask   │  │(Subtask │
│ groups) │  │ groups)   │  │ groups) │
└────┬────┘  └─────┬─────┘  └────┬────┘
     │             │              │ Decomposição em cenas/tarefas atômicas
  ┌──┴──┐    ┌─────┴─────┐   ┌──┴──┐
  │Cenas│    │   Cenas    │   │Cenas│
  │(Tasks│   │  (Tasks)   │   │(Tasks│
  │atômicas)│ │            │   │atômicas)│
  └──┬──┘    └─────┬─────┘   └──┬──┘
     │             │              │ Execução: beats/ações atômicas
  [beats]       [beats]       [beats]
  
  ← Scratchpad compartilhado (memória entre estágios) →
  ← Checkpoints de avaliação em cada mudança de nível →
```

Cada nível espelha a estrutura do todo: **precondição → ação → pós-condição** (analogia com setup → conflito → resolução). Subtarefas paralelas existem dentro de cada nível (como subplots que avançam simultaneamente). Checkpoints de avaliação correspondem aos turning points narrativos (Catalyst, Midpoint, All Is Lost).

---

## O framework unificado: story breaking como task engineering

A convergência entre story breaking e task decomposition não é metafórica — é **estruturalmente isomórfica**. Cinco princípios universais emergem de ambos os domínios.

**Princípio 1 — Decomposição fractal recursiva.** Cada nível da hierarquia espelha a estrutura do todo. Um beat tem setup-conflito-resolução, assim como uma cena, uma sequência, um ato e a história inteira. Em IA, cada subtarefa deve ter precondição-ação-pós-condição [Confiança: alta — evidência convergente de McKee [23], Tomov et al. [27], e frameworks de HTN].

**Princípio 2 — Mudança de estado obrigatória.** McKee insiste: cena sem mudança de valor = não-evento. A Anthropic [13] e a Amazon Science [28] ecoam: subtarefas sem output verificável são overhead puro. **Cada subtarefa deve produzir uma mudança de estado mensurável.**

**Princípio 3 — Checkpoints e reversões.** Beat sheets prescrevem waypoints obrigatórios (Midpoint, All Is Lost, Break Into Three). ADaPT [4] implementa isso algoritmicamente: auto-avaliação após execução, com decomposição recursiva acionada por falha. O "Gap" de McKee — distância entre expectativa e resultado — mapeia diretamente para error handling e replanning.

**Princípio 4 — Escalação progressiva.** Todas as metodologias narrativas exigem stakes crescentes. Amazon Science [28] formalizou: complexidade O(n) para tarefa única; O(n/k) + O(1) overhead por decomposição em k subtarefas. A recomendação é front-load tarefas simples e escalar complexidade.

**Princípio 5 — Separação de planejamento e execução.** A sala de roteiristas separa blue sky → season breaking → episode breaking → outline → draft → rewrite. Este é o padrão **Plan-and-Execute** da Anthropic [13], onde planejamento (decomposição) é separado de execução, com loops de feedback iterativos. LangChain [21] benchmarkeia que este padrão é mais rápido e barato que ReAct porque o LLM planejador não é consultado após cada ação.

---

## Guia prático: templates XML e exemplos concretos

### Template XML para decomposição estilo beat sheet

```xml
<story_task_decomposition>
  <role>Você é um especialista em decomposição de tarefas 
  que aplica princípios de story breaking narrativo.</role>
  
  <methodology>
    Decomponha a tarefa seguindo a estrutura de 3 atos:
    - ATO 1 (Setup ~25%): Compreensão, coleta de requisitos, preparação
    - ATO 2 (Confronto ~50%): Execução principal, resolução de problemas
    - ATO 3 (Resolução ~25%): Síntese, validação, entrega
  </methodology>
  
  <task>{{TAREFA_COMPLEXA}}</task>
  
  <beat_sheet>
    <beat id="1" name="opening_image">Estado inicial do sistema/contexto</beat>
    <beat id="2" name="catalyst">Evento que inicia a tarefa</beat>
    <beat id="3" name="debate">Análise de abordagens possíveis</beat>
    <beat id="4" name="break_into_two">Decisão da estratégia principal</beat>
    <beat id="5" name="fun_and_games">Execução principal — promise of the premise</beat>
    <beat id="6" name="midpoint">Checkpoint: avaliar progresso, ajustar se necessário</beat>
    <beat id="7" name="bad_guys_close_in">Lidar com complicações e edge cases</beat>
    <beat id="8" name="all_is_lost">Identificar o maior risco/bloqueio restante</beat>
    <beat id="9" name="break_into_three">Nova abordagem baseada no aprendizado</beat>
    <beat id="10" name="finale">Resolução final e entrega</beat>
    <beat id="11" name="final_image">Estado final — validação contra requisitos</beat>
  </beat_sheet>
  
  <output_format>
    <execution_plan>
      <phase id="1" name="" act="1|2|3">
        <subtask id="1.1">
          <description></description>
          <agent_role></agent_role>
          <inputs></inputs>
          <expected_output></expected_output>
          <dependencies>[]</dependencies>
          <verification></verification>
        </subtask>
      </phase>
    </execution_plan>
  </output_format>
</story_task_decomposition>
```

### Template de perfil de agente baseado em papel (estilo CrewAI/sala de roteiristas)

```python
# Mapeamento sala de roteiristas → sistema multi-agente
from crewai import Agent, Task, Crew, Process

# Showrunner = Orquestrador
showrunner = Agent(
    role='Showrunner / Orquestrador de Projeto',
    goal='Garantir que o projeto mantém coerência narrativa/lógica global',
    backstory="""Você é o responsável pela visão geral. Decompõe objetivos 
    em subtarefas, avalia resultados de cada agente, e mantém alinhamento 
    com o arco narrativo/objetivo principal.""",
    allow_delegation=True
)

# Staff Writer = Agente Especializado
researcher = Agent(
    role='Staff Writer / Pesquisador Especializado',
    goal='Investigar profundamente um aspecto específico do projeto',
    backstory="""Você é especialista em pesquisa aprofundada. Recebe um 
    tópico específico e retorna análise detalhada com evidências.""",
    tools=[search_tool, fetch_tool]
)

# Writers' Assistant = Memória Compartilhada
memory_agent = Agent(
    role='Writers Assistant / Gestor de Memória',
    goal='Manter continuidade e coerência entre todos os estágios',
    backstory="""Você mantém a "bible" do projeto — rastreando decisões 
    tomadas, fatos estabelecidos, e garantindo consistência."""
)
```

### Exemplo concreto: ADaPT aplicado a story breaking

```
Tarefa: "Escrever artigo técnico sobre quantum computing"
Executor tenta tarefa completa → FALHA (artigo incoerente, falta pesquisa)
Planner decompõe: [Pesquisar fundamentos AND Pesquisar aplicações AND Estruturar outline]
  ADaPT("Pesquisar fundamentos") → Executor sucesso ✓
  ADaPT("Pesquisar aplicações") → Executor FALHA
    Planner re-decompõe: [Buscar papers recentes OR Buscar case studies industriais]
    ADaPT("Buscar papers recentes") → Executor sucesso ✓
  ADaPT("Estruturar outline") → Executor sucesso (usa resultados anteriores) ✓
Planner próximo nível: [Escrever draft AND Revisar coerência]
  ADaPT("Escrever draft") → Executor sucesso ✓
  ADaPT("Revisar coerência") → Evaluator-Optimizer loop → TAREFA COMPLETA
```

### Meta-prompting para auto-decomposição

O framework de Meta-Prompting de Suzgun & Kalai [12] transforma um único LLM em **condutor** que delega para "especialistas" (instâncias do mesmo LLM com instruções específicas):

```xml
<meta_decomposition>
  <conductor_instructions>
    Você é um Meta-Modelo orquestrador. Para a tarefa abaixo:
    1. Analise qual tipo de expertise é necessário
    2. Formule consultas específicas para cada especialista
    3. Sintetize as respostas em um resultado final verificado
    
    Para cada consulta a especialista, use o formato:
    <expert type="[tipo]">
      <query>[Pergunta específica]</query>
    </expert>
  </conductor_instructions>
  
  <task>{{TAREFA}}</task>
  
  <synthesis_rules>
    Após receber respostas dos especialistas:
    - Verifique consistência entre respostas
    - Identifique lacunas ou contradições
    - Produza resposta final integrada com reasoning explícito
  </synthesis_rules>
</meta_decomposition>
```

---

## Anti-padrões e mitigações

### O problema da sobre-decomposição destrói mais do que constrói

A Amazon Science [28] formalizou o risco: decomposição excessiva "pode aumentar complexidade e overhead de coordenação ao ponto de retornos decrescentes" e "sacrifica a novidade e riqueza contextual que LLMs podem fornecer ao capturar relações ocultas no contexto completo da tarefa original." A Galileo AI [29] confirma que **"decomposição imprópria, onde o planejador fatia o trabalho em fragmentos inutilizáveis"** é um dos modos de falha mais comuns em produção. A recomendação convergente da Anthropic [13] e OpenAI [15] é direta: **comece com a solução mais simples possível e adicione complexidade apenas quando necessário.** "Isso pode significar não construir sistemas agentic de forma alguma" [Confiança: alta].

### Fragmentação de contexto e a engenharia de contexto como solução

Lilian Weng [16] identifica o limite fundamental: "Comprimento finito de contexto limita a inclusão de informação histórica, instruções detalhadas, contexto de chamadas de API e respostas." A Anthropic [14] cunhou o termo **"engenharia de contexto"** em 2025 para descrever a curadoria cuidadosa do estado disponível ao LLM: contexto é um "recurso precioso e finito." Pesquisa sobre Active Context Compression [30] mostra que compressões estruturadas agressivas a cada 10-15 chamadas de ferramenta reduzem tokens em **22.7% sem perda de acurácia** em SWE-bench. Abordagens de memória hierárquica como MemGPT [19] gerenciam isso com paginação entre "contexto principal" (RAM) e "contexto externo" (disco), onde o LLM administra sua própria memória via function calls.

### Perda de coerência inter-agente demanda scratchpads estruturados

A Galileo [29] reporta que "desalinhamento inter-agente representa a maior porcentagem de todas as quebras observadas" em sistemas de produção. Três mitigações provadas funcionam: **scratchpads compartilhados** (padrão Agents' Room [10]), onde um orquestrador consolida contribuições de cada agente e agentes subsequentes lêem o scratchpad; **contexto estruturado em seções dedicadas** [14] (arquivos modificados, decisões tomadas, tarefas pendentes, estado atual), forçando que resumos não descartem silenciosamente dados críticos; e **loops evaluator-optimizer** (padrão Anthropic [13]), onde um LLM separado avalia coerência do output contra o objetivo original. Self-Refine [20] (NeurIPS 2023) demonstra ~20% de melhoria absoluta em 7 tarefas via loop generate → feedback → refine, mas com a ressalva importante: **feedback guiado supera dramaticamente auto-refinamento** (+80% vs +1.8% em RefineBench) [Confiança: alta].

### O anti-padrão do "estagiário esquecido e ansioso"

Sistemas multi-agente usam ~15× mais tokens que interações simples de chat, conforme medido pela Anthropic [13]. Cada agente adicional é overhead. A LangChain [21] mediu: "Handoffs, Skills e Router são mais eficientes para tarefas únicas (3 chamadas cada). Subagents adiciona uma chamada extra. Padrões stateful economizam 40-50% das chamadas em requisições repetidas." A decisão de quando usar multi-agente vs. single-agent segue critérios claros: se subtarefas são independentes e parallelizáveis, multi-agente ganha; se coerência e consistência são críticas, single-agent com prompt chaining é preferível.

---

## Referências

[1] Wei, J., Wang, X., Schuurmans, D., et al. "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models." *NeurIPS 2022*. https://arxiv.org/abs/2201.11903

[2] Yao, S., Yu, D., Zhao, J., et al. "Tree of Thoughts: Deliberate Problem Solving with Large Language Models." *NeurIPS 2023 (Oral)*. https://arxiv.org/abs/2305.10601

[3] Khot, T., Trivedi, H., Finlayson, M., et al. "Decomposed Prompting: A Modular Approach for Solving Complex Tasks." *ICLR 2023*. https://arxiv.org/abs/2210.02406

[4] Prasad, A., Koller, A., Hartmann, M., et al. "ADaPT: As-Needed Decomposition and Planning with Language Models." *Findings of NAACL 2024*. https://arxiv.org/abs/2311.05772

[5] Wang, Y., Wu, S., Yang, L. & He, X. "TDAG: A Multi-Agent Framework based on Dynamic Task Decomposition and Agent Generation." *Neural Networks*, Vol. 185, 2025. https://arxiv.org/abs/2402.10178

[6] Besta, M., Blach, N., Kubicek, A., et al. "Graph of Thoughts: Solving Elaborate Problems with Large Language Models." *AAAI 2024*. https://arxiv.org/abs/2308.09687

[7] Hong, S., et al. "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework." *ICLR 2024*. https://arxiv.org/abs/2308.00352 | GitHub: https://github.com/geekan/MetaGPT

[8] Qian, C., et al. "ChatDev: Communicative Agents for Software Development." *ACL 2024*. https://arxiv.org/abs/2307.07924 | GitHub: https://github.com/OpenBMB/ChatDev

[9] Wu, Q., et al. "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation." *COLM 2024*. https://arxiv.org/abs/2308.08155 | GitHub: https://github.com/microsoft/autogen

[10] Huot, F., et al. "Agents' Room: Narrative Generation through Multi-step Collaboration." *ICLR 2025*. https://arxiv.org/abs/2410.02603

[11] Xia, Y., et al. "StoryWriter: A Multi-Agent Framework for Long Story Generation." *CIKM 2025*. https://arxiv.org/abs/2506.16445

[12] Suzgun, M. & Kalai, A.T. "Meta-Prompting: Enhancing Language Models with Task-Agnostic Scaffolding." 2024. https://arxiv.org/abs/2401.12954

[13] Anthropic. "Building Effective Agents." Dezembro 2024. https://www.anthropic.com/research/building-effective-agents

[14] Anthropic. "Effective Context Engineering for AI Agents." 2025. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

[15] OpenAI. "A Practical Guide to Building AI Agents." 2025. https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/

[16] Weng, L. "LLM-Powered Autonomous Agents." Junho 2023. https://lilianweng.github.io/posts/2023-06-23-agent/

[17] CrewAI. Documentação oficial. https://docs.crewai.com/ | GitHub: https://github.com/crewAIInc/crewAI

[18] Shen, Y., Song, K., Tan, X., et al. "HuggingGPT: Solving AI Tasks with ChatGPT and its Friends in HuggingFace." *NeurIPS 2023*. https://arxiv.org/abs/2303.17580

[19] Packer, C., et al. "MemGPT: Towards LLMs as Operating Systems." 2023. https://arxiv.org/abs/2310.08560

[20] Madaan, A., et al. "Self-Refine: Iterative Refinement with Self-Feedback." *NeurIPS 2023*. https://arxiv.org/abs/2303.17651

[21] LangChain. "Planning Agents." Blog. https://blog.langchain.com/planning-agents/ | "Choosing the Right Multi-Agent Architecture." https://blog.langchain.com/choosing-the-right-multi-agent-architecture/

[22] Snyder, B. *Save the Cat! The Last Book on Screenwriting You'll Ever Need.* M. Wiese Productions, 2005.

[23] McKee, R. *Story: Substance, Structure, Style and the Principles of Screenwriting.* HarperCollins, 1997.

[24] Truby, J. *The Anatomy of Story: 22 Steps to Becoming a Master Storyteller.* Farrar, Straus and Giroux, 2007.

[25] Campbell, J. *The Hero with a Thousand Faces.* 1949. Vogler, C. *The Writer's Journey: Mythic Structure for Writers.* 2007.

[26] Wang, X., Wei, J., et al. "Self-Consistency Improves Chain of Thought Reasoning in Language Models." *ICLR 2023*. https://arxiv.org/abs/2203.11171

[27] Tomov, M.S., et al. "Discovery of hierarchical representations for efficient planning." *PLOS Computational Biology*, 2020. https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1007594

[28] Amazon Science. "How task decomposition and smaller LLMs can make AI more affordable." 2025. https://www.amazon.science/blog/how-task-decomposition-and-smaller-llms-can-make-ai-more-affordable

[29] Galileo AI. "Why Multi-Agent LLM Systems Fail." 2025. https://galileo.ai/blog/multi-agent-llm-systems-fail

[30] Active Context Compression. 2025. https://arxiv.org/abs/2601.07190

[31] SagaLLM: Validation for Multi-Agent Workflows. *VLDB 2025*. https://www.vldb.org/pvldb/vol18/p4874-chang.pdf

[32] Han & Zhang. "Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture." 2025. https://arxiv.org/abs/2510.01285