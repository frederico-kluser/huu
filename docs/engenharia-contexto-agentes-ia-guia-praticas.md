# Engenharia de contexto para agentes de IA: guia definitivo de técnicas e práticas (2024–2026)

## Sumário executivo

**A qualidade do contexto fornecido a um agente de IA é o fator determinante entre um assistente confiável e um gerador de confabulações.** Entre 2024 e março de 2026, o campo evoluiu de "engenharia de prompt" para "engenharia de contexto" — a arte de curar exatamente os tokens certos para cada etapa de inferência do modelo [1]. Este relatório sintetiza as melhores práticas, técnicas anti-alucinação, frameworks de estruturação e anti-padrões documentados por **25 fontes independentes**, incluindo documentação oficial da Anthropic e OpenAI, papers acadêmicos revisados por pares, e experiências da comunidade técnica.

As descobertas principais são: (a) alucinações são uma propriedade estrutural dos LLMs, não um bug eliminável, exigindo defesas em camadas [5, 22]; (b) a arquitetura de contexto em camadas — prompt de sistema → instruções de projeto → base de conhecimento → contexto de sessão → contexto específico da tarefa — é o padrão dominante adotado por Anthropic, OpenAI e frameworks líderes [1, 6]; (c) técnicas como Chain-of-Verification (CoVe), padrão quote-first e RAG estruturado reduzem alucinações em **23–96%** dependendo da configuração [13, 10]; (d) o Model Context Protocol (MCP) emergiu como padrão de facto para memória persistente entre sessões [18]; e (e) os anti-padrões mais destrutivos são complexidade prematura, prompts sobrecarregados e ausência de avaliação sistemática [2, 6]. **Nível de confiança geral: alto** — baseado em convergência entre fontes acadêmicas e práticas industriais.

---

## Por que agentes alucinam e esquecem: as causas técnicas fundamentais

LLMs não "pensam" — eles preveem o próximo token mais provável numa sequência. Essa arquitetura de predição cria um **desalinhamento fundamental de incentivos**: o modelo é otimizado para fluência e plausibilidade, não para veracidade [5]. O paper seminal da OpenAI de setembro de 2025, "Why Language Models Hallucinate" (Kalai, Nachum, Vempala e Zhang), demonstrou que **9 de 10 benchmarks de IA usam avaliação binária** onde "não sei" pontua zero — criando um incentivo perverso para o modelo adivinhar com confiança em vez de expressar incerteza [5].

A pesquisa de interpretabilidade da Anthropic (março de 2025) revelou um mecanismo específico: **o comportamento padrão do Claude é recusar especulação** — alucinações ocorrem quando circuitos neurais de "entidade conhecida" disparam erroneamente, suprimindo a recusa e ativando uma geração confidente sobre informações que o modelo não possui [3]. Xu et al. (2024) provaram formalmente, usando o Teorema da Incompletude de Gödel, que **a eliminação completa de alucinações é matematicamente impossível** — os mesmos mecanismos que permitem criatividade produzem confabulação [22].

As causas raízes técnicas incluem: dados de pré-treinamento com informações desatualizadas ou contraditórias; o fenômeno "lost in the middle" onde modelos prestam menos atenção a informações no centro de contextos longos [10]; RLHF que **piora a factualidade** porque avaliadores humanos preferem respostas longas e detalhadas sobre respostas hedgeadas mas precisas [5, 10]; e **context rot** — degradação gradual da qualidade conforme a janela de contexto se enche de conteúdo de baixo sinal [1, 12]. A degradação ocorre como um gradiente, não um precipício: modelos que alegam 200K tokens tipicamente se tornam não-confiáveis por volta de 130K [1].

---

## Arquitetura ideal de contexto: como organizar as camadas de informação

### O stack de contexto em cinco camadas

A convergência entre Anthropic [1], LangChain [8] e Google ADK [15] produziu uma arquitetura canônica de contexto em camadas:

| Camada | Conteúdo | Persistência | Exemplo prático |
|--------|----------|-------------|----------------|
| **1. Prompt de sistema** | Identidade, papel, restrições comportamentais | Estática por sessão | "Você é um engenheiro sênior que..." |
| **2. Instruções de projeto** | CLAUDE.md, AGENTS.md, regras de diretório | Persistente no repositório | Convenções de código, stack tecnológico |
| **3. Base de conhecimento** | RAG, documentos recuperados, memória procedural | Persistente em vector store | Documentação técnica, APIs internas |
| **4. Contexto de sessão** | Histórico de conversa, estado, scratchpads | Persistente por thread | Decisões arquiteturais desta sessão |
| **5. Contexto específico da tarefa** | Outputs de ferramentas, retrieval just-in-time | Efêmero | Resultado de `grep`, conteúdo de arquivo |

**O princípio fundamental da Anthropic** [1] é: *"Encontrar o menor conjunto possível de tokens de alto sinal que maximize a probabilidade do resultado desejado."* Contexto não é grátis — cada token influencia o comportamento, para melhor ou pior.

### Prompt de sistema: encontrando a altitude certa

A Anthropic identifica uma "zona Goldilocks" para prompts de sistema [1]: **rígido demais** (lógica if-else hardcoded) → frágil e alto custo de manutenção; **vago demais** (orientação de alto nível sem sinais concretos) → o modelo assume contexto compartilhado falso. **O ponto ideal** é específico o suficiente para guiar comportamento, flexível o suficiente para heurísticas robustas.

A estruturação deve usar **tags XML** (`<background_information>`, `<instructions>`, `<tool_guidance>`) ou headers Markdown para delimitar seções claramente [1, 4]. Exemplos canônicos de poucos itens, mas diversos, são mais eficazes que listas exaustivas de edge cases [1].

### Retrieval just-in-time versus RAG pré-computado

A abordagem híbrida recomendada pela Anthropic combina **retrieval pré-inferência** (RAG tradicional com busca por embedding) com **busca agêntica just-in-time**, onde o agente mantém identificadores leves (caminhos de arquivo, queries salvas, links) e carrega dados dinamicamente usando ferramentas [1]. O Claude Code exemplifica isso: o modelo escreve queries direcionadas, usa comandos Bash como `head` e `tail` para analisar datasets grandes sem carregar objetos completos no contexto — espelhando a cognição humana que usa sistemas externos de organização em vez de memorizar corpora inteiros [1].

Os padrões de RAG evoluíram significativamente em 2024–2025, desde o RAG simples até **Agentic RAG** (retrieval e geração interlaçados dinamicamente com planejamento), **Graph RAG** (vector store para busca semântica + knowledge graph para travessia de relacionamentos) e **HyDE** (geração de documento hipotético ideal para guiar a recuperação) [11]. O RAGFlow nota que RAG está evoluindo de "Retrieval-Augmented Generation" para um **"Motor de Contexto"** [14].

---

## Técnicas anti-alucinação comprovadas: catálogo detalhado

### Tabela comparativa de técnicas

| Técnica | Problema que resolve | Quando usar | Redução de alucinação | Nível de evidência |
|---------|---------------------|-------------|----------------------|-------------------|
| **RAG com grounding** | Respostas sem base factual | Sempre que há base de conhecimento disponível | 15–82% (revisão sistemática) [9] | **Alto** |
| **Chain-of-Verification (CoVe)** | Afirmações factuais incorretas | Tarefas que exigem precisão factual | ~23% melhoria F1 [13] | **Alto** (ACL 2024) |
| **Padrão quote-first** | Confabulação sobre documentos | Análise de documentos longos | Substancial (prática) [4] | **Médio-alto** |
| **Self-RAG com tokens de reflexão** | Retrieval irrelevante + geração não fundamentada | Sistemas RAG críticos | Superior ao ChatGPT em QA [23] | **Alto** (ICLR 2024) |
| **Best-of-N com consistência** | Fatos instáveis entre execuções | Verificação de outputs críticos | Boa precisão de detecção [4] | **Médio-alto** |
| **Calibração de incerteza** | Confiança excessiva em informações incorretas | Qualquer sistema voltado ao usuário | Melhoria na calibração [5] | **Médio-alto** |
| **Verificação multi-agente** | Fatos não questionados por falta de segundo olhar | Sistemas agênticos complexos | Forte para tarefas agênticas [9] | **Médio** |
| **Guardrails neurosimbólicos** | Ações incorretas via tool calls | Agentes com ferramentas executáveis | Prevenção hard (não probabilística) [9] | **Médio** |

### Técnicas em detalhamento

**Chain-of-Verification (CoVe)** [13]: Pipeline de quatro etapas publicado pela Meta na ACL 2024 — (1) gerar rascunho, (2) criar perguntas de verificação para cada afirmação factual, (3) responder as perguntas de verificação **independentemente** do rascunho original para evitar viés, (4) revisar o rascunho incorporando as verificações. A variante **Factor+Revise** é a mais eficaz: o modelo cruza fatos contra verificações independentes, descarta inconsistências e regenera. CoVe com Llama superou InstructGPT, ChatGPT e PerplexityAI em geração de formato longo [13]. **Descoberta crítica**: instruction-tuning e Chain-of-Thought sozinhos **não reduzem** alucinações — CoVe é especificamente necessário.

**Padrão quote-first** [4]: A documentação oficial da Anthropic recomenda que, para tarefas envolvendo documentos longos (>20K tokens), o modelo extraia **citações verbatim** antes de realizar qualquer análise. Isso ancora o raciocínio subsequente em texto real, não em memória paramétrica. Implementação prática:

```
Primeiro, encontre citações diretas do documento relevantes para esta pergunta.
Depois, baseando-se APENAS nessas citações, forneça sua resposta.
Se não encontrar uma citação relevante, diga "Não encontrei esta informação no documento fornecido."
```

**Self-RAG** [23]: Publicado no ICLR 2024, treina o modelo com quatro tipos de **tokens de reflexão** — RET (decide se retrieval é necessário), REL (avalia relevância da passagem recuperada), SUP (verifica se a geração é suportada pela passagem) e USE (avalia utilidade geral). O modelo gera **apenas 2%** de predições corretas fora das passagens fornecidas, contra 20% no Alpaca 30B [23].

**Defesa em camadas recomendada** (do menos ao mais custoso): (1) design de prompt permitindo "não sei" + restrição a conhecimento fornecido + exigência de citações; (2) padrão quote-first para tarefas documentais; (3) pipeline CoVe para afirmações factuais; (4) RAG com grounding para base de conhecimento verificada; (5) verificação multi-pass com Best-of-N; (6) validação de tool calls com guardrails; (7) human-in-the-loop para outputs de alto risco [4, 9].

---

## Gerenciamento de janela de contexto: estratégias práticas para projetos grandes

A Anthropic identifica três técnicas fundamentais para tarefas de horizonte longo [1]:

**Compactação (sumarização)**: O Claude Code implementa auto-compactação quando atinge **~95% de uso do contexto** — passa o histórico de mensagens para sumarizar, **preservando** decisões arquiteturais e bugs não resolvidos enquanto **descarta** outputs redundantes de ferramentas. A melhor prática para prompts de compactação é: primeiro maximizar **recall** (capturar toda informação relevante), depois iterar para melhorar **precisão** (eliminar conteúdo supérfluo) [1]. Risco: compactação agressiva demais pode perder contexto sutil cuja importância só se manifesta posteriormente.

**Note-taking estruturado (scratchpads)**: Agentes mantêm notas estruturadas externas à janela de contexto. Lance Martin (LangChain) documenta quatro estratégias de engenharia de contexto: **Write** (salvar informação fora da janela — scratchpads para dentro da sessão, memórias como CLAUDE.md para entre sessões), **Select** (puxar informação relevante para dentro da janela), **Compress** (reter apenas tokens necessários) e **Isolate** (usar janelas de contexto separadas via sub-agentes) [8].

**Arquiteturas multi-agente**: Sub-agentes especializados recebem janelas de contexto limpas e focadas em vez de um único agente manter estado sobre um projeto inteiro. A pesquisa da Anthropic mostrou que sub-agentes com contextos isolados superaram sistemas de agente único [1], embora com **até 15x mais tokens totais** consumidos.

O estudo empírico da JetBrains Research (NeurIPS 2025) comparou **observation masking** (ocultar outputs de ferramentas de turnos antigos, mantendo raciocínio e ações visíveis) versus **sumarização por LLM** (outro modelo gera resumos compactos de turnos antigos). A descoberta-chave: **contexto gerado pelo agente rapidamente se torna ruído** em vez de informação útil, e a abordagem **híbrida** combinando ambos métodos alcançou a melhor relação custo/desempenho [7].

Para contextos longos de 200K+ tokens, a documentação da Anthropic recomenda: colocar dados longos (>20K tokens) **no topo** do prompt, acima de queries e instruções; usar tags XML para estruturar e delimitar seções; e manter regras de diretório específicas (ex.: `frontend/CLAUDE.md` carregado apenas ao trabalhar em tarefas de frontend) [1, 16].

---

## Decomposição de tarefas e memória persistente

### Arquiteturas de planejamento

O LangChain/LangGraph disponibilizou três arquiteturas prototípicas [8]: **Plan-and-Execute** (planejador gera plano multi-etapa → executores completam cada etapa → re-planejamento decide se termina ou gera follow-up); **ReWOO** (Reasoning Without Observations — planejador gera linhas intercaladas de "Plan" e variáveis `E#`, executor substitui variáveis por resultados, solver integra); e **LLMCompiler** (planejador gera um **DAG de tarefas** com dependências → unidade de scheduling executa tarefas assim que dependências são satisfeitas, permitindo **paralelismo com 3.6x de melhoria de velocidade**) [8].

O CrewAI implementa três padrões de orquestração: **sequencial** (output de uma tarefa alimenta a próxima), **hierárquico** (agente gerente delega e pode criar tarefas dinamicamente) e **flows** (workflows event-driven com branches condicionais e processamento paralelo) [17]. O AutoGen/AG2 da Microsoft usa um paradigma conversacional multi-agente onde um agente planejador decompõe tarefas em 3–5 sub-tarefas, encapsulado como ferramenta que outros agentes podem invocar [19].

**Validação de checkpoint**: O LangGraph implementa checkpointers que salvam o estado do grafo após cada execução de nó, habilitando: persistência de estado (retomar de qualquer checkpoint), human-in-the-loop (interromper para validação humana), time travel debugging e recuperação de erros [8].

### Memória persistente e MCP

O **Model Context Protocol (MCP)** [18], introduzido pela Anthropic em novembro de 2024, tornou-se o padrão aberto para integração LLM ↔ ferramentas/dados externos. Adotado pela OpenAI (março 2025), Google DeepMind e Microsoft, foi doado à Agentic AI Foundation sob a Linux Foundation em dezembro de 2025. O MCP Memory Server oficial implementa um **knowledge graph** baseado em JSONL com entidades, relações e observações, permitindo memória persistente entre sessões [18].

A taxonomia de memória para agentes (baseada no paper CoALA) [8] distingue: **memória procedural** (como realizar tarefas — pesos do LLM + código do agente + CLAUDE.md), **memória semântica** (fatos e preferências do usuário — extraída de conversas via LLM, armazenada externamente) e **memória episódica** (recoleção de eventos específicos — implementada como few-shot dinâmico). Padrões de atualização incluem "no hot path" (agente decide memorizar antes de responder, como ChatGPT Memory) e "em background" (processo assíncrono sem impacto de latência) [8].

O OpenAI Agents SDK implementa engenharia de contexto para personalização com `RunContextWrapper` fornecendo estado estruturado persistente: `global_memory` (fatos cross-sessão), `session_memory` (staging da sessão atual), e dados de domínio — com **padrão de consolidação** onde memórias de sessão são promovidas para memória global ao encerrar [6].

---

## Frameworks e templates: os melhores modelos adotados pela comunidade

### CO-STAR: o framework mais validado

Desenvolvido pela divisão de Data Science e IA do GovTech Singapore e vencedor da primeira competição de Prompt Engineering GPT-4 de Singapura [20], o CO-STAR estrutura prompts em seis componentes: **Context** (informação de background), **Objective** (tarefa claramente definida), **Style** (estilo de escrita desejado), **Tone** (caráter emocional), **Audience** (público-alvo) e **Response** (formato de saída). Validado academicamente pelo paper COSTAR-A (arXiv:2510.12637, outubro 2025) [20]. Excelente para geração de conteúdo e tarefas voltadas ao cliente.

### CRISP e variantes

Existem múltiplas variantes: a versão do Prompt Engineering Institute (Conceptualize → Reflect → Index → Stress-test → Present) [21] foca em scaffolding de raciocínio crítico; a versão Bertelsmann (Context → Role → Intent → Specifics → Polish) [21] otimizada para relatórios de negócios; e o CRISPE estendido (Context → Role → Instruction → Specification → Performance → Example) [21].

### Arquitetura de instruções para agentes (produção real)

Para agentes em produção, os frameworks de acrônimos são **menos diretamente aplicáveis** que as arquiteturas de contexto em camadas [20]. A análise de prompts de sistema reais extraídos de Claude Code, Manus, Vercel v0, Cursor e Devin [24] revela padrões convergentes:

```xml
<background_information>
Você é um engenheiro de software sênior especializado em [domínio].
Seu objetivo é [objetivo principal] seguindo as melhores práticas do projeto.
</background_information>

<instructions>
## Comportamento geral
- Analise completamente antes de agir. Crie um plano antes de implementar.
- Para cada etapa, valide o resultado antes de prosseguir.
- Se encontrar ambiguidade, pergunte — NUNCA assuma.

## Restrições
- Use APENAS informações dos documentos fornecidos e ferramentas disponíveis.
- Se não tiver certeza, declare explicitamente: "Não tenho informação suficiente para..."
- Mantenha soluções mínimas — não over-engineer.

## Formato de saída
- Comece com um resumo de 2-3 frases do que será feito.
- Use markdown estruturado com headers claros.
- Cite fontes específicas para cada afirmação factual.
</instructions>

<tool_guidance>
## Ferramentas disponíveis
- `search_docs`: Use PRIMEIRO para encontrar informação relevante antes de responder.
- `execute_code`: Use para validar implementações. Sempre teste antes de entregar.
- `write_file`: Use apenas após validação. Nunca sobrescreva sem backup.

## Quando NÃO usar ferramentas
- Não use `search_docs` para perguntas que você pode responder com certeza.
- Não execute código destrutivo sem confirmação explícita do usuário.
</tool_guidance>

<output_description>
Forneça resposta estruturada com: (1) plano de ação, (2) implementação,
(3) validação, (4) próximos passos recomendados.
</output_description>
```

### Convenção AGENTS.md / CLAUDE.md

Tanto a Anthropic (CLAUDE.md) quanto a OpenAI (AGENTS.md) convergiram no padrão de **arquivos markdown a nível de projeto** que fornecem contexto persistente para agentes de código [25, 1]. Funcionam como um README para agentes de IA: convenções de código, stack tecnológico, decisões arquiteturais e restrições do projeto, carregados automaticamente no início de cada sessão.

O Cursor implementa sistema hierárquico de regras em `.cursor/rules/*.mdc` com **regras de projeto** (versionadas no repositório), **regras de equipe**, **regras de usuário** e **regras globais**, carregadas no início do contexto para cada conversa [25]. A prática recomendada é adicionar regras **apenas quando o agente comete o mesmo erro repetidamente** [25].

---

## Checklist de validação: auditando se o contexto do seu agente é completo

- [ ] **Prompt de sistema** define identidade, papel, restrições e formato de saída claramente
- [ ] **Zona Goldilocks**: prompt é específico o suficiente para guiar mas flexível o suficiente para heurísticas (confiança: alta [1])
- [ ] **Permissão explícita** para dizer "não sei" quando informação é insuficiente (confiança: alta [4, 5])
- [ ] **Restrição de conhecimento**: instrução explícita para usar apenas informações fornecidas, não conhecimento geral (confiança: alta [4])
- [ ] **Tags XML ou headers Markdown** estruturam seções distintas do prompt (confiança: alta [1, 4])
- [ ] **Ferramentas documentadas** com descrições claras de quando usar, quando NÃO usar, e formato de parâmetros (confiança: alta [2, 6])
- [ ] **Exemplos few-shot** incluídos — diversos e canônicos, não lista exaustiva de edge cases (confiança: alta [1])
- [ ] **Padrão quote-first** implementado para tarefas envolvendo documentos longos (confiança: média-alta [4])
- [ ] **Estratégia de compactação** definida para quando contexto se aproxima do limite (confiança: alta [1, 7])
- [ ] **Scratchpad ou note-taking** configurado para informações que precisam persistir além da janela (confiança: alta [1, 8])
- [ ] **CLAUDE.md / AGENTS.md** no repositório com convenções do projeto (confiança: alta [1, 25])
- [ ] **Validação de checkpoint** entre etapas de tarefas complexas (confiança: alta [8])
- [ ] **Ferramenta de terminação explícita** — agente invoca `complete_task` em vez de "parar de falar" (confiança: média-alta [26])
- [ ] **Circuit breakers** configurados contra loops infinitos de exploração (confiança: média-alta [26])
- [ ] **Guardrails em camadas**: classificador de relevância + filtro de segurança + validação de output (confiança: alta [2, 6])
- [ ] **Avaliação sistemática** com 20–50 tarefas baseadas em falhas reais, não "vibe-checking" (confiança: alta [2])
- [ ] **Memória persistente** configurada via MCP, knowledge files ou store externo para estado entre sessões (confiança: média-alta [18])

---

## Erros comuns e como evitá-los

### Anti-padrão 1: complexidade prematura

**Descrição**: Pular diretamente para frameworks multi-agente complexos quando o problema não exige. A Anthropic relata que suas implementações **mais bem-sucedidas** usaram padrões simples e composáveis, não frameworks sofisticados [2]. A OpenAI converge: "Comece com o modelo mais capaz para cada tarefa, estabeleça um baseline de performance, depois otimize" [6].

**Prevenção**: Comece com chamada única de LLM + retrieval + exemplos in-context. Só adicione complexidade quando os pontos de dor da abordagem simples ficarem claros e mensuráveis.

### Anti-padrão 2: prompt "pia de cozinha"

**Descrição**: Empacotar muitas tarefas distintas numa única requisição. Pedir ao modelo para extrair múltiplas informações não-relacionadas ou realizar vários julgamentos simultaneamente leva a alucinação, tarefas esquecidas e baixa qualidade conforme a atenção se divide [26, 6].

**Prevenção**: Dividir problemas em peças atômicas. Usar vários prompts menores e focados (que podem rodar em paralelo). Em vez de "encontre todas as alucinações", iterar por cada fato e perguntar: "Esta afirmação é suportada pela fonte? Verdadeiro ou Falso" [26].

### Anti-padrão 3: context drift (desvio de contexto)

**Descrição**: Agentes gradualmente se desviam da tarefa original. A IBM documenta três tipos [27]: desvio de objetivo (muda a meta durante execução), desvio de contexto (ambiente mudou mas visão do agente não acompanhou) e desvio de raciocínio (lógica se afasta dos princípios originais). Sintoma clássico: "O agente começa confiantemente, toma uma ou duas ações, depois estagna. Re-planeja, pede ao LLM para clarificar, toma outro passo, pausa novamente, e eventualmente espirala em loops repetitivos" [26].

**Prevenção**: Circuit breakers com thresholds de alerta e hard limits; ferramentas de terminação explícitas que o agente deve invocar; especificação de tarefa central como "fonte única de verdade"; gerenciamento inteligente de janela de contexto via sumarização automatizada; e monitoramento contínuo com alertas em tempo real [26, 27].

### Anti-padrão 4: confiar na auto-avaliação do agente

**Descrição**: Permitir que o agente decida quando "terminou" via linguagem natural, ou confiar em contagem de tokens como proxy de progresso. "O agente parou de falar, então deve ter terminado" é receita para trabalho incompleto [26].

**Prevenção**: Ferramentas de terminação explícitas que o agente deve invocar. Criar pontos de completude auditáveis com critérios de aceitação definidos.

### Anti-padrão 5: frameworks sem compreensão

**Descrição**: A Anthropic alerta explicitamente: "Frameworks frequentemente criam camadas extras de abstração que obscurecem os prompts e respostas subjacentes, tornando-os difíceis de debugar. Suposições incorretas sobre o que está por baixo são uma fonte comum de erros" [2].

**Prevenção**: Comece usando APIs de LLM diretamente. Se usar um framework, entenda o código subjacente. Construa componentes essenciais você mesmo inicialmente.

### Anti-padrão 6: RAG naive para todas as tarefas

**Descrição**: Usar chunk-embed-retrieve simples para tarefas que requerem sumarização completa ou comparação cross-documento. RAG simples **não garante** que toda informação relevante será recuperada [28].

**Prevenção**: Construir RAG que se adapta ao tipo de query. Usar estratégias de retrieval diferentes para diferentes casos de uso. Considerar Graph RAG para queries que exigem travessia de relacionamentos [11].

---

## Conclusão: a engenharia de contexto como disciplina central

A pesquisa revela uma mudança paradigmática entre 2024 e 2026: de "como escrever um bom prompt" para **"como curar a informação certa para o modelo em cada etapa"**. As descobertas convergem em três insights centrais que transcendem qualquer framework específico.

Primeiro, **a defesa contra alucinações deve ser sistêmica, não pontual**. Nenhuma técnica isolada elimina confabulações — a combinação de RAG + CoVe + quote-first + guardrails + calibração de incerteza cria sistemas robustos. A métrica mais útil não é "zero alucinações" (matematicamente impossível), mas **transparência sobre incerteza**.

Segundo, **contexto é um recurso finito com retornos decrescentes**. A tentação de "jogar tudo no prompt" é o anti-padrão mais destruidor. A engenharia de contexto eficaz é um exercício de **curadoria implacável** — encontrar o menor conjunto de tokens de alto sinal para cada inferência, usando compactação, scratchpads e multi-agentes para escalar.

Terceiro, **simplicidade é a estratégia dominante**. Tanto a Anthropic quanto a OpenAI convergem: comece com o sistema mais simples possível, meça, e adicione complexidade apenas onde demonstravelmente necessário. A arquitetura de camadas, a validação de checkpoint e o design cuidadoso de ferramentas não são overhead — são os fundamentos que permitem construir agentes que executam tarefas complexas sem alucinam, perder informação crítica ou desviar do escopo definido.

---

## Fontes e referências

[1] Anthropic Engineering. "Effective Context Engineering for AI Agents." Setembro 2025. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

[2] Schluntz, E.; Zhang, B. "Building Effective Agents." Anthropic, Dezembro 2024. https://www.anthropic.com/engineering/building-effective-agents

[3] Anthropic Research. "Tracing the Thoughts of a Large Language Model." Março 2025. https://www.anthropic.com/research/tracing-thoughts-language-model

[4] Anthropic Documentation. "Reduce Hallucinations." https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips

[5] Kalai, A.; Nachum, O.; Vempala, S.; Zhang, R. "Why Language Models Hallucinate." OpenAI/arXiv:2509.04664, Setembro 2025. https://openai.com/index/why-language-models-hallucinate/

[6] OpenAI. "A Practical Guide to Building Agents." Abril 2025. https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf

[7] Fraser, K. "Cutting Through the Noise: Smarter Context Management for LLM-Powered Agents." JetBrains Research, Dezembro 2025. https://blog.jetbrains.com/research/2025/12/efficient-context-management/

[8] Martin, L. "Context Engineering for Agents." LangChain, Junho 2025. https://rlancemartin.github.io/2025/06/23/context_engineering/

[9] "Mitigating Hallucination in LLMs: Survey on RAG, Reasoning, and Agentic Systems." arXiv:2510.24476. https://arxiv.org/html/2510.24476v1

[10] Weng, L. "Extrinsic Hallucinations in LLMs." Julho 2024. https://lilianweng.github.io/posts/2024-07-07-hallucination/

[11] Humanloop. "8 Retrieval Augmented Generation (RAG) Architectures." 2025. https://humanloop.com/blog/rag-architectures

[12] Willison, S. Posts sobre context engineering. 2024–2026. https://simonwillison.net/tags/context-engineering/

[13] Dhuliawala, S. et al. "Chain-of-Verification Reduces Hallucination in Large Language Models." ACL Findings, 2024. https://aclanthology.org/2024.findings-acl.212/

[14] RAGFlow. "From RAG to Context: A 2025 year-end review." https://ragflow.io/blog/rag-review-2025-from-rag-to-context

[15] Lin, H. "Architecting efficient context-aware multi-agent framework for production." Google Developers Blog, Dezembro 2025. https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/

[16] 16x Eval. "LLM Context Management Guide." 2025. https://eval.16x.engineer/blog/llm-context-management-guide

[17] CrewAI. Documentação oficial. https://docs.crewai.com/en/guides/flows/first-flow

[18] Model Context Protocol. Especificação oficial. https://modelcontextprotocol.io/specification/2025-11-25

[19] Microsoft AutoGen/AG2. Documentação oficial. https://microsoft.github.io/autogen/0.2/docs/topics/task_decomposition/

[20] GovTech Singapore. "Mastering the Art of Prompt Engineering — CO-STAR." https://www.tech.gov.sg/technews/mastering-the-art-of-prompt-engineering-with-empower/

[21] Bertelsmann Tech. "Mastering ChatGPT: A Practical Guide to Prompting and Frameworks." Abril 2025. https://tech.bertelsmann.com/en/blog/articles/mastering-chatgpt-a-practical-guide-to-prompting-and-frameworks

[22] Xu, Z. et al. "LLMs Will Always Hallucinate, and We Need to Live With This." arXiv:2409.05746, 2024. https://arxiv.org/html/2409.05746v1

[23] Asai, A. et al. "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection." ICLR 2024. https://arxiv.org/abs/2310.11511

[24] GitHub. awesome-ai-system-prompts. https://github.com/dontriskit/awesome-ai-system-prompts

[25] Cursor. "Best Practices for Coding with Agents." https://cursor.com/blog/agent-best-practices

[26] Tacnode. "Your AI Agents Are Spinning Their Wheels." 2025. https://tacnode.io/post/your-ai-agents-are-spinning-their-wheels

[27] IBM. "Agentic Drift: The Hidden Risk That Degrades AI Agent Performance." 2025. https://www.ibm.com/think/insights/agentic-drift-hidden-risk-degrades-ai-agent-performance

[28] Lehtimäki, M. "Building Robust LLM Solutions — 3 Patterns to Avoid." Softlandia, Dezembro 2025. https://softlandia.com/articles/building-robust-llm-solutions-3-patterns-to-avoid