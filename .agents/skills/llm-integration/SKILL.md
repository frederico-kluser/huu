---
name: llm-integration
description: >-
  Define OpenRouter model selection, Pi SDK usage, thinking/reasoning detection,
  and API key handling. Use when adding model support, debugging agent sessions,
  or modifying LLM integration. Do not use for pipeline structure or git
  operations.
paths: "src/models/**/*.ts, src/orchestrator/real-agent.ts, src/lib/openrouter.ts, src/lib/model-factory.ts, src/contracts/models.ts, recommended-models.json"
---
# LLM Integration

## Goal

Documenta a integração com LLMs via OpenRouter e Pi SDK, incluindo seleção de
modelos, detecção de thinking/reasoning, e gestão de API keys.

## Boundaries

**Fazer:**
- Usar `AgentFactory` como porta abstrata — orchestrator não conhece Pi SDK
- Configurar OpenRouter via `OPENROUTER_API_KEY` (env var) ou input na TUI
- Selecionar modelo via `ModelSelectorOverlay` (quick-pick + tabela lazy-loaded)
- Detectar thinking/reasoning via `supportsThinking(modelId)` em `model-factory.ts`
- Usar `recommended-models.json` como catálogo padrão (fallback se arquivo ausente)

**Nao fazer:**
- Hardcodar model IDs fora de `recommended-models.json` ou `model-factory.ts`
- Acessar Pi SDK fora de `real-agent.ts`
- Armazenar API key em disco — deve viver apenas em memória de processo
- Assumir que todo modelo suporta thinking — verificar via heurística

## Workflow

### Seleção de Modelo
1. `models/catalog.ts` carrega `recommended-models.json` (ou fallback hardcoded)
2. `models/recents.ts` persiste recents/favorites em `~/.programatic-agent/recents.json`
3. `ModelSelectorOverlay` oferece quick-pick (recents + favorites + recommended)
4. Tabela completa lazy-loaded via `model-selector-ink` ("More models...")

### Real Agent Factory (`real-agent.ts`)
1. Valida `apiKey` e `modelId`
2. Resolve thinking level via `supportsThinking()`
3. Cria sessão Pi SDK: `createAgentSession({ auth, model, thinking })`
4. Traduz eventos Pi → `AgentEvent` (log, state_change, file_write, done, error)
5. Chama `session.prompt(message)` e aguarda terminal state

### Stub Agent Factory (`stub-agent.ts`)
- Para testes sem LLM real (`--stub`)
- Dorme 2-5s, escreve `STUB_*.md`, emite eventos de log
- Útil para validar fluxo visualmente

### Detecção de Thinking (`model-factory.ts`)
Heurística baseada em prefixos de modelId:
- Claude: `anthropic/claude`
- DeepSeek: `deepseek/deepseek-r1`, `deepseek-v3`
- OpenAI: `openai/o1`, `openai/o3`, `openai/o4`
- Gemini: `google/gemini-2.5`, `google/gemini-3`
- GLM: `z-ai/glm-z1`

## Gotchas

- `@mariozechner/pi-coding-agent` e `@mariozechner/pi-ai` usam versão `latest`.
- O seletor de modelos é global (recents em `~/.programatic-agent/recents.json`).
- A API key pode ser omitida se usar `--stub`; caso contrário, a TUI solicita.
- Não há override de modelo por etapa — um único modelo por run inteira.
- O integration agent (resolução de conflitos) usa o MESMO modelo da run.
- `openrouter.ts` faz cache de capabilities de modelo e validação de API key.
