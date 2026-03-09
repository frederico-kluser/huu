# Análise Atualizada de Custo-Benefício de LLMs para o Orquestrador HUU via OpenRouter — Março 2026

## Resumo Executivo

A análise anterior do tiering do HUU continha **erros de preço significativos** que afetam diretamente as recomendações. O Devstral 2, listado como $0.05/$0.22, custa na verdade **$0.40/$2.00** no OpenRouter — um aumento de 8-9x que o remove do tier ultra-econômico. O Kimi K2.5 subiu de $0.45/$2.25 para **$0.60/$3.00**. O DeepSeek V3.2 ajustou de $0.25/$0.38 para **$0.25/$0.40** — uma diferença menor mas relevante em volume.[1][2][3]

A descoberta mais impactante desta atualização é o **MiniMax M2.5**: com 80.2% no SWE-Bench Verified e 76.8% no BFCL Multi-Turn a $0.30/$1.10 no OpenRouter, oferece performance de flagship a preço de tier intermediário. A 76.8% no BFCL Multi-Turn, supera Claude Opus 4.6 (63.3%) em tool calling sequencial — exatamente a capacidade mais crítica para os 11 agents do HUU.[4][5][6][7]

Outra mudança significativa: **o prompt caching da Anthropic agora funciona via OpenRouter**, com suporte a breakpoints explícitos e automáticos, sticky routing para cache hits, e TTL de 5 min ou 1 hora. Isso reduz substancialmente o risco de custo adicional ao rotear Claude via OpenRouter. Porém, issues documentadas no OpenClaw e SillyTavern indicam que cache misses ainda ocorrem em cenários de multi-sessão.[8][9][10]

O GPT-5.4 chegou em março 2026 a $2.50/$15-20 com 1M de context e reasoning avançado, mas o preço premium e o surcharge de long-context (dobra após 272K) limitam sua viabilidade para o HUU.[11][12]

A proposta de tiering revisada mantém a estrutura de 3 tiers, substitui Devstral 2 por **MiniMax M2.5** como alternativa emergente no tier principal, e adiciona Gemini 3.1 Flash Lite ao tier econômico. O custo estimado por feature ajustado é de **$0.30–$0.50**, com potencial de $0.20–$0.35 se o prompt caching funcionar consistentemente.

***

## O Que Mudou Desde a Análise Anterior

| Área | Documento anterior | Dados atualizados março 2026 | Impacto |
|------|-------------------|------------------------------|---------|
| DeepSeek V3.2 preço | $0.25/$0.38 | $0.25/$0.40 (OR), $0.28/$0.42 (direto)[3][13] | Leve aumento output |
| Devstral 2 preço | $0.05/$0.22 | **$0.40/$2.00** (OR)[2] | ❌ Inviável como alternativa ultra-barata |
| Kimi K2.5 preço | $0.45/$2.25 | $0.60/$3.00 (OR)[1] | Menos competitivo |
| Prompt caching Anthropic via OR | "Não funciona" | **Funciona** com cache_control[8] | ✅ Remove risco principal |
| MiniMax M2.5 | Não analisado | 80.2% SWE-Bench, $0.30/$1.10[7][6] | ✅ Candidato forte |
| GPT-5.4 | Não existia | $2.50/$15-20, 1M context[11][12] | Alternativa premium |
| Gemini 3.1 Flash Lite | Não existia | $0.25/$1.50, 1M context[14] | ✅ Novo tier econômico |
| Grok Code Fast 1 Terminal-Bench | Sem dados | **14.2%** — muito baixo[7] | ❌ Inadequado como fallback de builder |
| SWE-Bench Verified DeepSeek V3.2 Pro | Não analisado | **15.6%** vs 73% Verified[7] | ⚠️ Gap enorme Verified→Pro |

***

## Tabela Atualizada de Modelos — Março 2026

### Tier Premium e Alta Performance

| Modelo | Input $/MTok | Output $/MTok | Context | SWE-Bench Verified | Tool Calling | Aider Polyglot | Confiança |
|--------|-------------|--------------|---------|-------------------|-------------|----------------|-----------|
| Claude Opus 4.5 | $5.00 | $25.00 | 200K | 80.9%[7] | Excelente | 72.0% ($65.75)[15] | Alta |
| Claude Opus 4.6 | $5.00 | $25.00 | 1M | 80.8%[7] | Excelente | — | Alta |
| Gemini 3.1 Pro | $2.00 | $12.00 | 1.05M | 80.6%[7] | Excelente | — | Alta |
| MiniMax M2.5 | $0.30 | $1.10 (OR) | 197K | 80.2%[7] | Excelente (76.8% BFCL)[4] | — | Média-Alta |
| GPT-5.2 | $1.75 | $14.00 | 400K | 80.0%[7] | Excelente | — | Alta |
| GPT-5.4 | $2.50 | $15-20 | 1M | ~77%[16] | Excelente | — | Média |
| Claude Sonnet 4.6 | $3.00 | $15.00 | 1M | 79.6%[7] | Excelente | — | Alta |
| Claude Sonnet 4.5 | $3.00 | $15.00 | 1M | 77.2%[7] | Excelente | — | Alta |

### Tier Intermediário

| Modelo | Input $/MTok | Output $/MTok | Context | SWE-Bench Verified | Tool Calling | Custo Aider/run | Confiança |
|--------|-------------|--------------|---------|-------------------|-------------|-----------------|-----------|
| Claude Haiku 4.5 | $1.00 | $5.00 | 200K | 73.3%[7] | Excelente | $6.06[15] | Alta |
| DeepSeek V3.2 | $0.25 | $0.40 (OR) | 164K | 73.0%[7] | Bom | $0.88[15] | Média |
| Kimi K2.5 | $0.60 | $3.00 (OR) | 262K | 76.8%[7] | Excelente | $1.24[15] | Média |
| Qwen3-Coder 480B | $0.22 | $1.00 (OR) | 262K | 70.6%[7] | Bom | — | Média-Baixa |
| Grok Code Fast 1 | $0.20 | $1.50 | 256K | 57.6%[7] | Excelente | — | Média-Baixa |

### Tier Econômico

| Modelo | Input $/MTok | Output $/MTok | Context | Nota | Tool Calling | Confiança |
|--------|-------------|--------------|---------|------|-------------|-----------|
| Gemini 2.5 Flash | $0.30 | $2.50 | 1.05M | Melhor custo-benefício geral | Excelente | Alta |
| Gemini 3.1 Flash Lite | $0.25 | $1.50 | 1.05M | Novo, thinking levels[14][17] | Bom | Média |
| Gemini 2.5 Flash Lite | $0.10 | $0.40 | 1.05M | Ultra-barato, 1M context[18] | Bom | Média |
| MiMo-V2-Flash | $0.10 | $0.30 | 256K | Ultra-barato, chinês emergente[19] | Limitado | Baixa |
| GPT-5 Mini | $0.25 | $2.00 | 400K | Substituto moderno do o4-mini | Bom | Média |
| GPT-4.1 Nano | $0.10 | $0.40 | 1.05M | Mais barato GPT com 1M context | Básico | Média |
| Devstral 2 | $0.40 | $2.00 | 256K | Preço corrigido — não é ultra-barato[2] | Bom | Média |

***

## DeepSeek V3.2 — Deep Dive

### Forças Confirmadas

O DeepSeek V3.2 permanece o **melhor custo-benefício absoluto** para tarefas de coding mecânico, confirmado por múltiplas fontes. A $0.88 por run completo no Aider Polyglot com 70.2% de acerto (modo Chat) e $1.30 com 74.2% (modo Reasoner), nenhum modelo se aproxima desta relação preço/performance. O pipeline de treinamento agentic com 1.800+ ambientes e 85.000+ prompts dá ao V3.2 uma capacidade de tool-use que o paper técnico descreve como "integrando reasoning em cenários de tool-use".[15][20][21]

Em experiências reais, usuários reportam que o `deepseek-chat` (V3.2 modo Chat) "funciona excepcionalmente bem com native tool calling ativado" no Roo Code. Um desenvolvedor criou um framework de coding agent e reportou que "a capacidade de invocar tools é particularmente efetiva, especialmente para exploração de codebases". O preço de cache automático no DeepSeek (0.1x do preço de input para cache reads) funciona sem configuração via OpenRouter, o que beneficia agents com contexto repetitivo.[22][23][8]

### Fraquezas Críticas Documentadas

A lacuna mais grave é a **discrepância SWE-Bench Verified vs Pro**: o V3.2 faz 73% no Verified mas apenas **15.6% no SWE-Bench Pro** (vs 45.9% do Opus 4.5). O SWE-Bench Pro usa scaffolding padronizado e issues mais complexas — essa queda indica que o V3.2 depende fortemente de scaffolding favorável para performar bem. Para o HUU, onde os agents fornecem o scaffold, o impacto depende da qualidade do prompt engineering por agent.[7]

O paper técnico documenta explicitamente um problema de **redundant self-verification**: "DeepSeek-V3.2 frequently engages in redundant self-verification, generating excessively long trajectories. This tendency often causes the context length to exceed the 128K limit, particularly in tasks such as MCP-Mark GitHub and Playwright evaluation.". Em um orquestrador com 15+ tool calls como o HUU, isso pode causar context overflow silencioso.[24]

Usuários no Reddit confirmam a verbosidade: "outputs tend to be overly verbose, explaining every detail of the code response... This is especially frustrating in agentic loops where I just need straightforward fixes". A velocidade de inferência também é criticada: "waiting over 30 seconds for each response" em setups locais, embora via API a latência seja menor.[25]

O context window de 164K tokens é nominal — o paper confirma que problemas de verificação redundante já causam overflow em 128K. Para agents do HUU que acumulam contexto de conversação (orchestrator, builder), o limite prático é mais próximo de **100-120K tokens**.[24]

### Recomendação por Agent do HUU

| Agent | DeepSeek V3.2 adequado? | Justificativa |
|-------|------------------------|---------------|
| Refactorer | ✅ Sim | Transformação mecânica com padrões claros; verbosidade controlável via system prompt |
| Context-curator | ✅ Sim | Filtrar e resumir contexto é task ideal para modelo econômico |
| Doc-writer | ⚠️ Parcial | Pode ser verboso demais; GPT-5 Mini é melhor para prosa limpa |
| Researcher | ⚠️ Parcial | Funciona para busca, mas pode exceder context em pesquisas extensas |
| Builder | ❌ Não | SWE-Bench Pro de 15.6% é inaceitável para geração de código primário |
| Tester | ❌ Não | Geração de testes requer precisão que V3.2 não demonstra consistentemente |
| Reviewer | ❌ Não | Low hallucination é crítico; V3.2 tem tendência à auto-verificação redundante |
| Orchestrator | ❌ Não | Decisões estratégicas requerem reasoning confiável |

***

## Alternativas Emergentes

### MiniMax M2.5 — O Candidato Mais Subestimado

O MiniMax M2.5 é a **surpresa desta atualização**. A $0.30/$1.10 no OpenRouter (ou $0.15/$1.20 direto), entrega 80.2% no SWE-Bench Verified — empatando com GPT-5.2 e superando Claude Sonnet 4.6. Mas o número mais relevante para o HUU é o BFCL Multi-Turn: **76.8% contra 63.3% do Claude Opus 4.6**, uma vantagem de 13.5 pontos em tool calling sequencial.[5][26][4][7]

Em produção real, a Verdent AI reporta que "M2.5 is reliable in tool-calling loops when you give it explicit structure. The BFCL lead isn't theoretical — you feel it in the reduced re-prompt rate on long sessions". O modelo reduz o número de rounds de tool calling por ~20% comparado ao M2.1, traduzindo-se em menor latência e menor consumo de tokens.[4][5]

O "Architect Mode" do M2.5 faz planejamento estrutural antes de implementação — comportamento natural para agents como planner e orchestrator. O MiniMax também lançou uma plataforma de agents com "experts" pré-configurados para coding, o que sugere investimento contínuo no use case agentic.[27][28][4]

**Limitações**: context window de 197K no OpenRouter (1M apenas via API direta MiniMax), sem resultados publicados no Terminal-Bench, e comunidade de usuários menor que Claude/GPT. A confiança é **Média-Alta** — os benchmarks são fortes mas faltam experiências extensivas em frameworks como Aider ou Roo Code.[6][29]

**Recomendação**: candidato sério para **builder** (fallback), **tester** e **planner** do HUU. A relação 80.2% SWE-Bench por $0.30/$1.10 é a melhor do mercado para agents que fazem tool calling intensivo.

### GPT-5.4 — Premium Desnecessário para o HUU

O GPT-5.4 chegou em março 2026 com 1M de context e reasoning "Thinking", a $2.50/$15-20 via OpenRouter. A score no SWE-Bench Verified é ~77% pela LM Council (com alta variância) — similar ao Sonnet 4.5 mas mais caro. O **long-context surcharge** que dobra o preço de input após 272K tokens é particularmente problemático para agents que acumulam contexto.[12][16][11]

Não justifica inclusão no tiering do HUU quando o Sonnet 4.6 a $3/$15 faz 79.6% SWE-Bench e 1M de context sem surcharge.[7]

### Gemini 3.1 Flash Lite — Novo Tier Ultra-Econômico

Lançado em março 2026, o Gemini 3.1 Flash Lite custa $0.25/$1.50 com 1.05M de context e suporte a thinking levels (minimal/low/medium/high). A Google posiciona como "metade do custo do Gemini 3 Flash" com qualidade que "supera o Gemini 2.5 Flash Lite e se aproxima do Gemini 2.5 Flash".[30][14][17]

Para o HUU, substitui o Gemini 2.5 Flash Lite no tier econômico com melhor qualidade pelo mesmo budget. Ideal para context-curator e doc-writer por combinar custo baixo com context massivo.

### Grok Code Fast 1 — Fallback Comprometido

O documento anterior listava Grok Code Fast 1 como fallback do builder a $0.20/$1.50. O Terminal-Bench 2.0 revela apenas **14.2%** — catastroficamente baixo. Embora o modelo seja "designed for agentic coding tasks" com 256K de context e tool calling funcional, a performance real em tarefas de terminal/DevOps é inadequada. Comunidade reporta velocidade impressionante ("faster replies under 2 seconds") mas sem validação de qualidade agentic.[31][7]

**Recomendação**: remover como fallback do builder. Manter apenas como fallback ultra-econômico para tarefas simples que não envolvem DevOps (doc-writer, context-curator).

### MiMo-V2-Flash e Step 3.5 Flash — Ultra-Baratos mas Prematuros

O MiMo-V2-Flash a $0.10/$0.30 é atraente, mas com dados insuficientes de tool calling e coding agent em produção. O Step 3.5 Flash tem preço similar mas zero presença em frameworks ocidentais. Ambos são viáveis apenas para experimentação até que haja evidências de tool calling confiável em pipelines multi-agent. **Confiança: Baixa**.[19]

***

## Estado do OpenRouter em Março 2026

### Prompt Caching — Agora Funciona

A mudança mais importante desde a análise anterior: **o prompt caching da Anthropic agora funciona via OpenRouter** com duas modalidades:[8]

- **Automatic caching**: adicionar `cache_control` no nível top do request — o sistema aplica breakpoints automaticamente ao último bloco cacheável. Funciona apenas via provider Anthropic direto (não Bedrock/Vertex).[8]
- **Explicit breakpoints**: colocar `cache_control` em blocos individuais — funciona com todos os providers Anthropic (incluindo Bedrock/Vertex).[8]

O TTL pode ser 5 minutos (1.25x write, 0.1x read) ou 1 hora (2x write, 0.1x read). O **sticky routing** garante que requests subsequentes vão para o mesmo provider endpoint, maximizando cache hits.[8]

**Limitações reais documentadas**: o OpenClaw reportou um bug onde `cache_control ttl` não era aplicado corretamente via OpenRouter. Uma feature request no OpenClaw (#17112) propõe controle per-agent de cache, dado que agents de baixo tráfego desperdiçam dinheiro com cache writes que expiram antes de serem lidos — com Haiku 4.5, cache write custa $1.25/MTok vs $1.00/MTok sem cache. Usuários do SillyTavern relatam cache misses persistentes quando lorebooks dinâmicos alteram o contexto.[32][10][33]

**Para o HUU**: o caching funcionará bem para o orchestrator (que recebe toda mensagem) e builder (contexto de codebase estável), mas pode não beneficiar agents de baixa frequência como reviewer (1-2 chamadas por feature).

### Latência e Overhead

O OpenRouter documenta "~25ms na edge" e "~40ms em condições típicas". Medições independentes mostram overhead real de **50-120ms** dependendo do provider e região. Para uma pipeline com 15 tool calls sequenciais, o overhead total é de 750ms-1.8s — significativo mas não bloqueante para workflows batch do HUU.[34][35][36][37][38]

O impacto é maior quando o credit balance é baixo (verificações de billing adicionais) e em cold starts regionais. **Mitigação**: manter saldo mínimo de $50+ e usar BYOK para prioridade.[36]

### Confiabilidade Recente

StatusGator registrou outages em **17 de fevereiro** (30 minutos) e **19 de fevereiro** (34 minutos) de 2026. Além disso, incidents não-reconhecidos de "slow performance and timeout errors" (7 min) e "service unavailable" (57 min) foram detectados. A frequência está em **~2-3 incidents/mês** — aceitável com circuit breakers, mas inaceitável sem fallback configurado.[39]

### Tool Calling via OpenRouter

O bug do Roo Code (#5927, #9385) com tool calls falhando via OpenRouter foi **parcialmente resolvido**. A versão 3.34.7 do Roo Code corrigiu handling de tool calls quando usando OpenRouter provider. A versão 3.36.9 tornou native tool calling o padrão para múltiplos providers. O Roo Code 3.40.x corrigiu issues de LiteLLM com parâmetros de tool calling não suportados.[40][41][42]

No entanto, o DeepSeek R1 via OpenRouter continua com "constant tool call failures on multiple models" segundo relatos recentes. O DeepSeek V3.2 (modo chat, não reasoner) com native tool calling funciona "excepcionalmente" segundo múltiplos usuários.[23][43][22]

***

## Proposta de Tiering Atualizada — Março 2026

### Tier Crítico — Decisões Estratégicas

| Agent | Modelo primário | Custo (in/out) | Fallback | Justificativa atualizada |
|-------|----------------|----------------|----------|--------------------------|
| **Orchestrator** | Claude Sonnet 4.5 (thinking) via API Anthropic | $3/$15 | Gemini 3 Flash | Manter API direta para prompt caching nativo (saves ~80% em input recorrente). Extended thinking para reasoning complexo.[7] |
| **Reviewer** | Claude Opus 4.6 via API Anthropic | $5/$25 | Claude Sonnet 4.6 | 1M context para revisar codebases inteiras. Low hallucination crítico aqui. API direta para caching.[7] |
| **Debugger** | Gemini 3.1 Pro via OpenRouter | $2/$12 | Claude Sonnet 4.5 (thinking) | Lidera Terminal-Bench 2.0 com 78.4%[7]. 1M context para logs. |

### Tier Principal — Motor de Desenvolvimento

| Agent | Modelo primário | Custo (in/out) | Fallback | Justificativa atualizada |
|-------|----------------|----------------|----------|--------------------------|
| **Planner** | Claude Sonnet 4.5 (thinking) via OR | $3/$15 | MiniMax M2.5 ($0.30/$1.10) | Thinking para decomposição. Fallback M2.5 com "Architect Mode" para planejamento.[4] |
| **Builder** | Claude Sonnet 4.6 via OR | $3/$15 | MiniMax M2.5 ($0.30/$1.10) | 79.6% SWE-Bench[7]. Fallback M2.5 (80.2% SWE-Bench!) quando features são simples — custo 13x menor em output.[26] |
| **Tester** | MiniMax M2.5 via OR | $0.30/$1.10 | GPT-5 ($1.25/$10) | M2.5 supera Opus em BFCL Multi-Turn (76.8% vs 63.3%)[4]. Test generation depende de tool calling robusto. GPT-5 como fallback premium. |
| **Merger** | GPT-4.1 via OR | $2/$8 | Claude Sonnet 4.5 | 1.05M context para diffs. Otimizado para precisão em patches.[15] |

A mudança principal aqui é a **promoção do MiniMax M2.5** para tester (primário) e builder/planner (fallback). O BFCL Multi-Turn de 76.8% e a redução de 20% em rounds de tool calling traduzem-se em menor custo e maior confiabilidade em loops agentic. O Grok Code Fast 1 é removido como fallback do builder dado os 14.2% no Terminal-Bench.[5][7]

### Tier Econômico — Alto Volume

| Agent | Modelo primário | Custo (in/out) | Fallback | Justificativa atualizada |
|-------|----------------|----------------|----------|--------------------------|
| **Researcher** | Gemini 2.5 Flash via OR | $0.30/$2.50 | Kimi K2.5 ($0.60/$3.00) | 1.05M context para documentação extensa. Implicit caching automático.[18] |
| **Refactorer** | DeepSeek V3.2 via OR | $0.25/$0.40 | Gemini 2.5 Flash Lite ($0.10/$0.40) | 73% SWE-Bench a custo mínimo[7]. Refactoring mecânico é onde V3.2 brilha. Caching automático 0.1x.[3] |
| **Doc-writer** | Gemini 3.1 Flash Lite | $0.25/$1.50 | GPT-5 Mini ($0.25/$2.00) | Novo modelo com thinking levels e 1M context[14]. Melhor que GPT-5 Mini para prosa estruturada. |
| **Context-curator** | Gemini 2.5 Flash Lite via OR | $0.10/$0.40 | GPT-4.1 Nano ($0.10/$0.40) | Ultra-barato com 1.05M context[18]. Curadoria é filtrar e resumir. |

A substituição do Devstral 2 é necessária: a $0.40/$2.00, não é mais "ultra-barato". O DeepSeek V3.2 permanece a escolha ideal para refactorer a $0.25/$0.40, e o Gemini 2.5 Flash Lite mantém a posição de ultra-econômico. O Gemini 3.1 Flash Lite entra como upgrade do doc-writer com melhor qualidade de output.[2]

***

## Estimativa de Custo por Feature Revisada

| Cenário | Custo por feature | Premissas |
|---------|-------------------|-----------|
| **Conservador (sem caching)** | $0.35–$0.55 | Todos via OpenRouter, sem prompt caching |
| **Otimista (com caching)** | $0.20–$0.35 | Orchestrator+reviewer via API Anthropic com caching, demais via OR |
| **Premium** | $0.70–$1.00 | Sonnet em todo tier principal, Opus no reviewer |
| **Doc anterior** | $0.35–$0.55 | Baseado em preços incorretos de Devstral/Kimi |

A diferença principal em relação à estimativa anterior é que o **cenário otimista melhorou** de $0.35–$0.55 para $0.20–$0.35, graças ao prompt caching funcional via OpenRouter e à entrada do MiniMax M2.5 como alternativa de custo-benefício no tier principal. A troca do tester de GPT-5 ($1.25/$10) para M2.5 ($0.30/$1.10) sozinha reduz ~15% do custo total da pipeline, dado que o tester é um dos agents de maior volume.

Distribuição de custo típica por feature (cenário otimista):

| Tier | % tokens | Custo médio ponderado (in/out) | Custo parcial |
|------|----------|-------------------------------|---------------|
| Crítico (15%) | ~50K tokens | $3.50/$17.00 | ~$0.06 |
| Principal (45%) | ~150K tokens | $1.65/$6.80 | ~$0.15 |
| Econômico (40%) | ~130K tokens | $0.22/$0.85 | ~$0.05 |
| **Total** | ~330K tokens | — | **~$0.26** |

***

## Riscos e Recomendações Atualizadas

### Riscos que Diminuíram

- **Prompt caching**: agora funcional via OpenRouter, com sticky routing. O risco de "30-50% a mais" identificado anteriormente é mitigável com configuração adequada de `cache_control`.[8]
- **Tool calling OpenRouter**: bugs do Roo Code corrigidos em v3.34.7+ e v3.36.9+ com native tools por padrão.[41][42]

### Riscos que Aumentaram

- **DeepSeek V3.2 self-verification loop**: documentado no paper oficial, pode causar context overflow em agents com muitas tool calls. Mitigação: limitar `max_tokens` e implementar circuit breaker de tamanho de context.[24]
- **MiniMax M2.5 contexto limitado**: 197K no OpenRouter vs 1M na API direta. Para agents que precisam de >200K, usar Gemini Flash ou Sonnet.[6]
- **OpenRouter outages**: 2-3 incidents/mês com 30-57 minutos de duração. Mitigação: manter API keys diretas da Anthropic e Google como fallback para orchestrator e builder.[39]
- **Devstral 2 preço real**: o erro de preço no documento anterior ($0.05 vs $0.40 real) reforça a necessidade de validar preços diretamente no OpenRouter antes de configurar agents.[2]

### Ações Imediatas Recomendadas

1. **Validar prompt caching**: configurar o orchestrator com `cache_control: { type: "ephemeral" }` via OpenRouter e monitorar `cache_discount` nos responses por 24-48h
2. **Testar MiniMax M2.5**: rodar 5-10 features com M2.5 no tester, comparar taxa de sucesso e custo vs GPT-5
3. **Implementar circuit breakers**: timeout de 30s por tool call, fallback após 3 failures consecutivas, e monitoramento de context size para DeepSeek V3.2
4. **Atualizar `models.json`**: corrigir preços de Devstral 2, Kimi K2.5, e DeepSeek V3.2; adicionar MiniMax M2.5 e Gemini 3.1 Flash Lite
5. **Benchmark A/B**: 10 features comparando configuração atual (Anthropic exclusivo) vs tiering proposto, medindo custo real, tempo de conclusão e taxa de sucesso

### Lacunas de Informação

- ❓ MiniMax M2.5 não tem scores publicados no Terminal-Bench 2.0 ou Aider Polyglot
- ❓ Gemini 3.1 Flash Lite é preview — pricing e disponibilidade podem mudar
- ❓ Nenhum benchmark independente confirma a performance do DeepSeek V3.2 em tool calling multi-turn com >15 calls sequenciais
- ❓ O SWE-Bench Pro score de 15.6% do DeepSeek V3.2 pode indicar problemas mais profundos que não aparecem no Verified[7]
- ❓ O GPT-5.4 SWE-Bench score varia de 76.9% (LM Council) a 77.2% (fontes iniciais) — necessita confirmação[16]