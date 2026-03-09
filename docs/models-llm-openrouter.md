# Modelos LLM para o orquestrador HUU via OpenRouter em 2026

O **Claude Sonnet 4.5/4.6 continua sendo o melhor custo-benefício** para agents de código, mas a migração do HUU para OpenRouter abre oportunidades reais de otimização: substituir Opus por Sonnet 4.6 com thinking nos agents críticos, adotar Gemini 2.5 Flash e DeepSeek V3.2 no tier econômico, e potencialmente reduzir o custo por feature de $0.60–$0.80 para **$0.35–$0.55** sem sacrificar qualidade. A ressalva principal é a **perda de prompt caching da Anthropic** ao rotear via OpenRouter, o que pode anular parte da economia para agents com contexto repetitivo. O pi-ai já suporta OpenRouter nativamente como provider built-in via protocolo `openai-completions`, tornando a migração tecnicamente viável com ajustes mínimos em `models.json`.

---

## Catálogo de modelos OpenRouter relevantes para coding agents

A tabela abaixo consolida os modelos mais relevantes disponíveis no OpenRouter em março de 2026, com foco em tool calling robusto, reasoning e geração de código. Preços são por milhão de tokens (MTok) em USD.

### Modelos premium e de alta performance

| Modelo | Provider | Input $/MTok | Output $/MTok | Context | Reasoning | Tool Calling | SWE-Bench Verified |
|--------|----------|-------------|--------------|---------|-----------|-------------|-------------------|
| Claude Opus 4.6 | Anthropic | $5.00 | $25.00 | 1M | Extended thinking | Excelente | 80.8% |
| Claude Opus 4.5 | Anthropic | $5.00 | $25.00 | 200K | Extended thinking | Excelente | 80.9% |
| Claude Sonnet 4.6 | Anthropic | $3.00 | $15.00 | 1M | Sim | Excelente | 79.6% |
| Claude Sonnet 4.5 | Anthropic | $3.00 | $15.00 | 1M | Extended thinking | Excelente | 77.2% |
| GPT-5.2 | OpenAI | $1.75 | $14.00 | 400K | Adaptativo | Excelente | 80.0% |
| GPT-5.2 Codex | OpenAI | $1.75 | $14.00 | 400K | Ajustável | Excelente | ~80% |
| GPT-5 | OpenAI | $1.25 | $10.00 | 400K | Sim | Excelente | ~75% |
| Gemini 3.1 Pro | Google | $2.00 | $12.00 | 1.05M | Sim | Excelente | 80.6% |
| Gemini 3 Flash | Google | $0.50 | $3.00 | 1.05M | Thinking levels | Excelente | 78.0% |
| o3 | OpenAI | $2.00 | $8.00 | 200K | Chain-of-thought | Excelente | — |
| Kimi K2.5 | Moonshot AI | $0.45 | $2.25 | 262K | Sim | Excelente | 76.8% |

### Modelos intermediários (Sonnet-tier)

| Modelo | Provider | Input $/MTok | Output $/MTok | Context | Reasoning | Tool Calling | SWE-Bench |
|--------|----------|-------------|--------------|---------|-----------|-------------|-----------|
| Claude Haiku 4.5 | Anthropic | $1.00 | $5.00 | 200K | Extended thinking | Excelente | 73.3% |
| Gemini 2.5 Pro | Google | $1.25 | $10.00 | 1.05M | Thinking | Excelente | 63.8% |
| GPT-4.1 | OpenAI | $2.00 | $8.00 | 1.05M | Não | Excelente | 54.6% |
| o4-mini | OpenAI | $1.10 | $4.40 | 200K | Sim | Bom | — |
| Grok Code Fast 1 | xAI | $0.20 | $1.50 | 256K | Reasoning traces | Excelente | — |
| Mistral Medium 3.1 | Mistral | $0.40 | $2.00 | 131K | Não | Bom | — |
| MiniMax M2.1 | MiniMax | $0.27 | $0.95 | 197K | Sim | Bom | 72.5% |

### Modelos econômicos (Haiku-tier e abaixo)

| Modelo | Provider | Input $/MTok | Output $/MTok | Context | Reasoning | Tool Calling | Nota |
|--------|----------|-------------|--------------|---------|-----------|-------------|------|
| Gemini 2.5 Flash | Google | $0.30 | $2.50 | 1.05M | Configurável | Excelente | Melhor custo-benefício geral |
| DeepSeek V3.2 | DeepSeek | $0.25 | $0.38 | 164K | Controlável | Bom | 73% SWE-Bench, absurdamente barato |
| GPT-5 Mini | OpenAI | $0.25 | $2.00 | 400K | Lite | Bom | Substituto moderno do o4-mini |
| Gemini 2.5 Flash Lite | Google | $0.10 | $0.40 | 1.05M | Opcional | Bom | Ultra-barato, 1M context |
| GPT-4.1 Mini | OpenAI | $0.40 | $1.60 | 1.05M | Não | Bom | 1M context, bom para diffs |
| GPT-4.1 Nano | OpenAI | $0.10 | $0.40 | 1.05M | Não | Básico | Mais barato da série 4.1 |
| Claude 3.5 Haiku | Anthropic | $0.80 | $4.00 | 200K | Não | Bom | Modelo atual do HUU |
| Devstral 2 | Mistral | $0.05 | $0.22 | 256K | Sim | Bom | 123B, coding specialist |
| Mistral Small 3.1 | Mistral | $0.05 | $0.08 | 33K | Não | Bom | Ultra-barato |
| gpt-oss-120b | OpenAI | $0.039 | $0.19 | 131K | Configurável | Bom | Open-weight, Apache 2.0 |
| GPT-5 Nano | OpenAI | $0.05 | $0.40 | 400K | Limitado | Bom | Mais rápido e barato GPT-5 |

### Modelos gratuitos no OpenRouter

| Modelo | Context | Reasoning | Tool Calling | Viabilidade |
|--------|---------|-----------|-------------|-------------|
| Qwen3-Coder 480B :free | 262K | Sim | Bom | Melhor free para coding |
| Devstral 2 :free | 256K | Sim | Bom | Bom para multi-file |
| gpt-oss-120b :free | 131K | Sim | Bom | Tool use funcional |
| DeepSeek R1 0528 :free | 164K | Sim | Limitado | Reasoning forte, tool calling fraco |
| Llama 4 Maverick :free | 1.05M | Não | Bom | 1M context grátis |
| Llama 4 Scout :free | 512K | Não | Bom | Leve e funcional |

**Limitações dos modelos free**: rate limit de **20 req/min e 50–1.000 req/dia**, insuficiente para um orquestrador multi-agent em produção. O sufixo `:free` pode causar falhas de tool calling em alguns clients. Viáveis apenas para desenvolvimento, testes e prototipagem.

---

## Compatibilidade com pi-ai e o caminho de migração

O pi-ai (pacote `@mariozechner/pi-ai` do monorepo pi-mono) já inclui OpenRouter como **provider built-in** utilizando o protocolo `openai-completions`. A integração é direta: basta configurar a variável de ambiente `OPENROUTER_API_KEY` e chamar `getModel('openrouter', 'anthropic/claude-sonnet-4.5')`. O catálogo auto-gerado do pi-ai já contém centenas de modelos OpenRouter com metadados de custo, context window e capabilities.

**Compatibilidade nativa sem configuração especial**: todos os modelos do catálogo OpenRouter que suportam tool calling funcionam via `openai-completions`. Isso inclui Claude, GPT, Gemini, DeepSeek, Grok, Mistral e Qwen. Para modelos que não constam no catálogo built-in, o arquivo `~/.pi/agent/models.json` permite adicionar providers customizados com hot-reload — editar e salvar aplica as mudanças sem reiniciar o agent.

Há três limitações importantes ao rotear via OpenRouter em vez de usar APIs diretas dos provedores. Primeiro, **prompt caching da Anthropic não funciona** quando Claude é acessado via OpenRouter (Issue #583 do pi-mono), pois os marcadores `cache_control: { type: "ephemeral" }` só são aplicados no provider Anthropic nativo. Isso significa custos potencialmente **30–50% maiores** para agents com contexto repetitivo. Segundo, pode haver **conflitos no parâmetro de reasoning** entre o formato flat do OpenAI (`reasoning_effort`) e o formato nested do OpenRouter (`reasoning: { effort }`), exigindo cuidado na configuração dos modelos de thinking. Terceiro, **interleaved thinking** nativo do Claude se perde ao passar pelo endpoint OpenAI-compatible, sendo convertido para o campo genérico de reasoning.

A configuração de routing do OpenRouter pode ser controlada via campo `compat` no `models.json`:

```json
{
  "compat": {
    "openRouterRouting": { "order": ["anthropic"], "fallbacks": ["amazon-bedrock"] },
    "supportsReasoningEffort": true
  }
}
```

Para o HUU, a **estratégia recomendada** é uma migração híbrida: manter a API direta da Anthropic para o orchestrator e reviewer (que se beneficiam de prompt caching e extended thinking nativo), e usar OpenRouter para os demais agents que ganham com diversidade de modelos e fallback automático.

---

## Benchmarks de coding determinam os melhores modelos por tarefa

Os benchmarks de março de 2026 revelam um cenário onde **a diferença entre Opus e Sonnet diminuiu drasticamente**, e modelos econômicos como DeepSeek V3.2 e Claude Haiku 4.5 entregam performance que seria frontier há 12 meses.

No **SWE-Bench Verified**, que mede resolução de issues reais do GitHub, Claude Opus 4.5 lidera com **80.9%**, seguido de perto por GPT-5.2 (**80.0%**) e Claude Sonnet 4.6 (**79.6%**). A diferença de apenas 1.3 pontos percentuais entre Opus e Sonnet 4.6 é crucial para o HUU: o Sonnet custa **5x menos** em output ($15 vs $25/MTok) e oferece **1M de context** contra 200K do Opus 4.5. O Claude Haiku 4.5, a $1/$5 por MTok, alcança **73.3%** — desempenho superior ao Claude Sonnet 4 (72.7%) por um terço do preço.

No **Terminal-Bench 2.0**, que avalia operações de terminal, DevOps e CLI, o Gemini 3.1 Pro lidera com **78.4%**, superando GPT-5.3 Codex (77.3%) e Claude Opus 4.6 (74.7%). Isso indica que para agents que executam comandos bash e git, os modelos do Google podem ser uma alternativa superior.

No **Aider Polyglot**, que testa edição de código em 6 linguagens, Claude Opus 4.5 lidera com **89.4%** e GPT-5 segue com **88.0%**. O DeepSeek V3.2-Exp entrega **74.2%** a um custo de apenas $1.30 por run completo — o melhor custo-benefício absoluto.

Para **tool calling** especificamente, o Berkeley Function Calling Leaderboard V4 mostra que modelos Claude e GLM dominam em cenários multi-turn e agentic, com Claude Opus 4.1 a **70.36%** e Claude Sonnet 4 a **70.29%**. O GPT-5 surpreendentemente ficou mais baixo (**59.22%**) devido a fraquezas em multi-turn e memória de contexto. Para o HUU, onde todos os 11 agents dependem intensamente de tool calling, **Claude e Gemini são as escolhas mais seguras**.

Uma observação crítica: **o scaffold/agent design importa mais que o modelo bruto**. O Refact.ai Agent atingiu 93.3% no Aider Polyglot com Claude 3.7 Sonnet — um modelo que sozinho faz ~60%. O Droid da Factory.ai com Opus 4.1 alcançou 58.8% no Terminal-Bench contra 43.2% do Claude Code com o mesmo modelo. Isso sugere que a arquitetura do HUU com 11 agents especializados pode extrair performance significativamente superior dos modelos.

---

## Proposta de tiering ótimo para os 11 agents do HUU

A proposta abaixo maximiza a relação qualidade/custo para cada agent, considerando benchmarks, custo, context window, qualidade de tool calling e reasoning.

### Tier crítico — Decisões estratégicas e análise profunda

| Agent | Modelo primário | Custo (in/out) | Fallback | Justificativa |
|-------|----------------|----------------|----------|--------------|
| **Orchestrator** | Claude Sonnet 4.5 (thinking) | $3/$15 | Gemini 3 Flash | Extended thinking nativo, 77.2% SWE-Bench, 1M context. Opus custa 5x mais por apenas +3pp. O orchestrator não gera código — precisa de reasoning, não de raw coding power. |
| **Reviewer** | Claude Opus 4.6 | $5/$25 | Claude Sonnet 4.6 | O reviewer é onde low hallucination importa mais. Opus 4.6 com 1M context permite revisar codebases inteiras. Único agent onde o premium se justifica plenamente. |
| **Debugger** | Gemini 3.1 Pro | $2/$12 | Claude Sonnet 4.5 (thinking) | Lidera Terminal-Bench (78.4%), forte em operações bash/git, 1M context para analisar logs extensos. Custo 50% menor que Sonnet em output. |

A mudança mais significativa em relação ao tiering atual é o **rebaixamento do orchestrator de Opus para Sonnet com thinking**. O orchestrator toma decisões de roteamento e planejamento — não gera código diretamente — e o Sonnet 4.5 com extended thinking oferece reasoning comparável ao Opus por um quinto do custo de output. Para o debugger, o Gemini 3.1 Pro é uma alternativa superior ao Claude Opus em tarefas de terminal e debugging, custando $2/$12 contra $5/$25.

### Tier principal — 90% do trabalho de desenvolvimento

| Agent | Modelo primário | Custo (in/out) | Fallback | Justificativa |
|-------|----------------|----------------|----------|--------------|
| **Planner** | Claude Sonnet 4.5 (thinking) | $3/$15 | GPT-5 | Extended thinking para decomposição de tarefas. Mesmo modelo do orchestrator — simplifica cache de contexto e handoffs. |
| **Builder** | Claude Sonnet 4.6 | $3/$15 | Grok Code Fast 1 ($0.20/$1.50) | **79.6% SWE-Bench**, 1M context para codebases grandes. Melhor code generation disponível no tier Sonnet. Fallback Grok é 10x mais barato com boa qualidade. |
| **Tester** | GPT-5 | $1.25/$10 | Claude Haiku 4.5 | Forte em test generation (88% Aider), **58% mais barato** que Sonnet em input. 400K context suficiente para testes. |
| **Merger** | GPT-4.1 | $2/$8 | Claude Sonnet 4.5 | **1.05M context**, otimizado para diffs precisos e agent reliability. Não precisa de reasoning — precisa de atenção a detalhes em patches. 54.6% SWE-Bench é adequado para merge, que é mecanicamente mais simples. |

O **builder** é o agent mais importante em volume — é onde a qualidade de code generation define o resultado final. Claude Sonnet 4.6 com 79.6% no SWE-Bench e 1M de context é a escolha ideal. O fallback Grok Code Fast 1 a $0.20/$1.50 permite redução drástica de custo quando features são simples. Para o **tester**, GPT-5 a $1.25/$10 é significativamente mais barato que qualquer Sonnet, com performance de Aider Polyglot de 88%. O **merger** se beneficia do GPT-4.1 por seu context de 1.05M e otimização para diffs code — é um modelo não-reasoning projetado especificamente para seguir instruções de edição com precisão.

### Tier econômico — Tarefas mecânicas e alto volume

| Agent | Modelo primário | Custo (in/out) | Fallback | Justificativa |
|-------|----------------|----------------|----------|--------------|
| **Researcher** | Gemini 2.5 Flash | $0.30/$2.50 | DeepSeek V3.2 | **1.05M context** para analisar documentação extensa, thinking configurável, tool calling excelente. 10x mais barato que Claude Haiku 4.5 em input. |
| **Refactorer** | DeepSeek V3.2 | $0.25/$0.38 | Devstral 2 ($0.05/$0.22) | **73% SWE-Bench a 1/60 do custo** de Sonnet. Refactoring é transformação mecânica — V3.2 é mais que suficiente. Output a $0.38/MTok é o melhor preço do catálogo para um modelo frontier. |
| **Doc-writer** | GPT-5 Mini | $0.25/$2.00 | Gemini 2.5 Flash Lite | Escrita de documentação não exige reasoning avançado. GPT-5 Mini entrega prose limpa e bem estruturada a custo mínimo. 400K context cobre qualquer codebase. |
| **Context-curator** | Gemini 2.5 Flash Lite | $0.10/$0.40 | GPT-4.1 Nano ($0.10/$0.40) | O mais barato com **1.05M de context**. Curadoria de contexto é fundamentalmente filtrar e resumir — tarefa ideal para um modelo ultra-rápido e barato. |

A economia no tier Haiku é onde a migração para OpenRouter gera o maior impacto. O Claude 3.5 Haiku atual a $0.80/$4.00 é substituído por modelos como **DeepSeek V3.2** ($0.25/$0.38 — **10x mais barato** em output) e **Gemini 2.5 Flash Lite** ($0.10/$0.40 — **10x mais barato** em input). O DeepSeek V3.2 com 73% no SWE-Bench supera até o Claude Sonnet 4 (72.7%) a uma fração do custo.

---

## Estimativa de custo por feature com o novo tiering

Para estimar o custo, considero a distribuição típica de tokens por feature no HUU: os agents do tier econômico consomem ~40% dos tokens totais (pesquisa, refactoring, documentação, curadoria), o tier principal consome ~45% (planning, building, testing, merging), e o tier crítico consome ~15% (orchestration, review, debugging).

| Tier | Custo médio input/output (atual) | Custo médio input/output (proposto) | Redução |
|------|----------------------------------|-------------------------------------|---------|
| Crítico (15% tokens) | $15.00/$75.00 (Opus) | $3.30/$17.30 (média ponderada) | **~77%** |
| Principal (45% tokens) | $3.00/$15.00 (Sonnet) | $2.30/$11.75 (média ponderada) | **~22%** |
| Econômico (40% tokens) | $0.80/$4.00 (Haiku) | $0.22/$0.90 (média ponderada) | **~77%** |

**Custo estimado por feature**: assumindo que o custo atual de $0.60–$0.80 reflete a distribuição acima com preços Anthropic, o novo tiering reduz para aproximadamente **$0.25–$0.45 por feature** — uma economia de **40–55%**. Mesmo considerando a perda de prompt caching da Anthropic via OpenRouter (que pode adicionar 20–30% ao custo dos modelos Claude roteados), o custo ficaria em **$0.35–$0.55 por feature**.

Se a prioridade for **qualidade máxima** e o orçamento permitir até $1.50/feature, uma configuração premium — com Opus 4.6 no reviewer e orchestrator, Sonnet 4.6 em todo o tier principal, e Haiku 4.5 no tier econômico — custaria aproximadamente **$0.80–$1.10 por feature** com ganho significativo de qualidade em todos os agents.

---

## Riscos de usar OpenRouter como intermediário e como mitigá-los

O maior risco operacional é a **latência composta**. Medições independentes mostram **50–70ms de overhead por request** via OpenRouter. Em um agent que faz 15 tool calls sequenciais, isso adiciona 750ms–1s de latência por step. Em um pipeline multi-agent com 4–5 agents encadeados, o overhead total pode chegar a **3–5 segundos por feature**. A mitigação é usar BYOK (Bring Your Own Key) para prioridade de routing, o sufixo `:nitro` para throughput, e considerar API direta para os agents mais intensivos em tool calling.

A **confiabilidade** é uma preocupação real: o StatusGator registrou **46+ outages desde fevereiro de 2025**, incluindo dois incidentes em fevereiro de 2026 onde 80–90% dos requests falharam por 25–30 minutos. Pior, os erros retornaram código 401 em vez de 503, levando usuários a debugar suas próprias API keys. O OpenRouter implementou circuit breakers e códigos de erro corretos, mas permanece como **single point of failure**. A mitigação é implementar circuit breakers no nível do HUU e manter API keys diretas como fallback para o orchestrator e builder.

O **tool calling via OpenRouter pode falhar silenciosamente**. O caso mais grave foi documentado no Roo Code (Issue #11419, março 2026): tool calls foram silenciosamente descartadas após migração para o provider SDK do OpenRouter, gerando retry loops com inflação de custo. O HUU deve implementar validação client-side de tool calls e usar `require_parameters: true` nas preferências de provider para garantir que o endpoint suporta todas as features necessárias.

Para **privacidade**, o OpenRouter tem política de Zero Data Retention por padrão — prompts não são retidos a menos que o usuário ative prompt logging. Porém, com logging ativo, os termos concedem "direito irrevogável de uso comercial" dos dados. Manter logging desabilitado e usar `data_collection: "deny"` mitiga este risco.

Três estratégias de mitigação são essenciais para produção:

- **Abordagem híbrida**: usar API direta da Anthropic para orchestrator e reviewer (que se beneficiam de prompt caching e extended thinking nativo) e OpenRouter para os demais agents. O pi-ai suporta múltiplos providers simultâneos, tornando esta configuração trivial.
- **Fallback em cascata**: configurar `models` array no OpenRouter com cadeia de fallback por agent (ex: builder → Claude Sonnet 4.6, fallback → Grok Code Fast 1, fallback → DeepSeek V3.2). Usar `allow_fallbacks: false` apenas nos paths críticos onde comportamento determinístico é necessário.
- **Monitoramento de saldo**: o RPS dinâmico do OpenRouter ($1 = 1 RPS) significa que saldo baixo reduz concorrência. Para 11 agents paralelos, manter saldo mínimo de $50–100 para garantir throughput adequado.

---

## Modelos economy e free viabilizam desenvolvimento e testes

Os modelos gratuitos do OpenRouter são **surpreendentemente capazes** para tarefas mecânicas em 2026. O **Qwen3-Coder 480B :free** é o destaque — modelo especializado em coding com 262K de context, tool calling funcional e reasoning. O **Devstral 2 :free** (123B parâmetros, MIT modificado) foi projetado para orquestração multi-arquivo e recuperação de falhas. O **gpt-oss-120b :free** oferece tool calling e reasoning configurável em um modelo open-weight.

Porém, as limitações de rate são severas: **20 requests/minuto** e **50–1.000 requests/dia** tornam modelos free inviáveis para produção do HUU. Um único ciclo de building + testing pode consumir 30–50 tool calls. A recomendação é usar modelos free exclusivamente para: ambiente de desenvolvimento local, CI de integração com smoke tests, e prototipagem de novos agents.

Para um tier "economy" em produção, os melhores candidatos são **Devstral 2** ($0.05/$0.22), **Mistral Small 3.1** ($0.05/$0.08) e **gpt-oss-120b** ($0.039/$0.19). Estes modelos custam **10–20x menos** que o Claude 3.5 Haiku atual e oferecem tool calling funcional. O trade-off é menor confiabilidade em edge cases — recomendável apenas para context-curator, doc-writer e tarefas de grep/glob simples, com fallback automático para modelos pagos em caso de falha de tool calling.

---

## Conclusão e recomendações prioritárias

A migração do HUU para OpenRouter via pi-ai é **tecnicamente viável e economicamente vantajosa**, mas deve ser feita de forma híbrida. A descoberta mais impactante desta pesquisa é que **Claude Sonnet 4.6 com 79.6% no SWE-Bench virtualmente elimina a necessidade de Opus** para a maioria dos agents — a diferença de 1.3 pontos percentuais não justifica o custo 5x maior. O segundo insight é que **DeepSeek V3.2 a $0.25/$0.38 entrega 73% no SWE-Bench**, superando modelos que custavam $15/MTok há 12 meses, o que permite um tier econômico radicalmente mais barato.

A configuração ótima combina: API direta Anthropic para o reviewer (prompt caching + extended thinking nativo), OpenRouter para os demais 10 agents, Claude Sonnet 4.5/4.6 como backbone do tier principal, e uma mistura de Gemini Flash + DeepSeek V3.2 no tier econômico. O custo estimado cai para **$0.35–$0.55 por feature** mantendo qualidade equivalente ou superior ao setup atual.

A principal ação imediata é configurar o `models.json` do pi-ai com os 11 modelos recomendados, implementar circuit breakers com fallback por agent, e rodar um benchmark A/B comparando a configuração atual (Anthropic exclusivo) contra o novo tiering multi-provider em 10 features reais do HUU. Os dados desse benchmark determinarão se a economia teórica se confirma na prática e se a perda de prompt caching é compensada pelos preços menores dos modelos alternativos.