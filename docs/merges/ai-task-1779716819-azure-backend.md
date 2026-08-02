# Merge: `ai-task-1779716819` — backend Azure AI Foundry + roteamento de LLM auxiliar

| | |
|---|---|
| **Branch tip** | `c9985f2` (3 commits: `308ec54` feat backend azure → `d968824` fix helper LLM → `c9985f2` docs) |
| **Merge-base com a main** | `e89fb250` (estava 2 commits atrás da `main`) |
| **Merge commit** | `b7793e9` |
| **Conflitos** | nenhum de conteúdo; **1 ajuste manual**: remoção do symlink `node_modules` |
| **Risco** | baixo-médio |

## O que mudou

Adiciona um **terceiro backend de execução de agentes** — Azure AI Foundry — selecionável
por `--backend=azure`, ao lado de `pi` (OpenRouter, default) e `copilot`.

Além do backend em si, a branch corrige um problema sutil de **roteamento das chamadas LLM
auxiliares**: as três features "helper" do huu (Pipeline Assistant, Smart File Select e
Project Recon) cravavam a base URL do OpenRouter no `ChatOpenAI`. Resultado: mesmo com
`--backend=azure` (ou `copilot`), os helpers continuavam batendo no OpenRouter — gerando
cobrança na conta errada. A branch centraliza a construção do cliente para que **todos** os
helpers usem o MESMO backend escolhido para a execução dos agentes.

### Arquivos tocados (principais)

**Novos**

- `src/orchestrator/backends/azure/factory.ts` — factory do backend Azure (registrada no
  dispatch `registry.ts`).
- `src/lib/azure.ts` — utilidades específicas de Azure (endpoint, header `api-key:` em vez
  de `Authorization: Bearer`).
- `src/lib/llm-client-factory.ts` — **abstração central** que monta o `ChatOpenAI`
  conforme o backend. Matriz de roteamento:
  - `pi` → OpenRouter (`https://openrouter.ai/api/v1`, Bearer)
  - `azure` → endpoint Azure AI Foundry v1 (`api-key:` header)
  - `copilot` → OpenRouter (fallback — Copilot não tem API genérica de completion)
  - `stub` → curto-circuito antes da factory
- `docs/azure-backend.md` — documentação (porta do backend + refactor do helper LLM).

**Alterados (seleção)**

- `src/models/catalog.ts` (+142) — entradas de modelos Azure no catálogo.
- `src/lib/assistant-client.ts`, `src/lib/llm-suggest-files.ts`, `src/lib/project-recon.ts`,
  `src/lib/recon-selector.ts`, `src/lib/assistant-check-feasibility.ts` — passam a construir
  o cliente via `llm-client-factory` em vez de cravar OpenRouter.
- `src/lib/api-key-registry.ts`, `src/lib/api-key.ts` — suporte à chave Azure.
- `src/orchestrator/backends/registry.ts` (+ `registry.test.ts`) — dispatch do kind `azure`.
- `src/cli.tsx`, `src/app.tsx` — parsing/propagação da flag `--backend=azure`.
- `src/web/session.ts`, `src/web/handlers/assistant.ts`, `src/web/handlers/recon.ts` —
  paridade no modo web.
- Pequenos ajustes de propagação em componentes de UI (`StepEditor`, `FileMultiSelect`,
  `CheckStepEditor`, `PipelineEditor`, `ProjectRecon`, `PipelineAssistant`).

## Ajuste manual no merge: symlink `node_modules`

A branch havia commitado, por engano, um **symlink** `node_modules` apontando para
`/home/ondokai/Projects/huu/node_modules` (mode `120000`) — um path da máquina de outra
pessoa. Durante o merge o checkout chegou a substituir o `node_modules/` local pelo link
quebrado.

Tratamento aplicado:

1. Merge com `--no-ff --no-commit`.
2. `git rm --cached node_modules` — removeu o symlink do index (o `.gitignore` da `main` já
   cobre `node_modules/`, então o diretório real permanece ignorado).
3. Remoção do link quebrado do disco + `npm install` para restaurar o `node_modules/` real.
4. `git commit` fechando o merge — o HEAD **não** contém `node_modules`.

Verificado: `git ls-tree HEAD node_modules` retorna vazio.

## Impacto no app

- Novo backend disponível: `huu --backend=azure` executa agentes no Azure AI Foundry.
- As features auxiliares (Assistant, Smart Select, Recon) deixam de bater no OpenRouter
  quando outro backend é escolhido — fim da cobrança na conta errada.
- `@langchain/openai` já era dependência da `main` (os helpers já usavam `ChatOpenAI`),
  então o merge **não** exigiu nova dependência. Confirmado por `typecheck` verde.
