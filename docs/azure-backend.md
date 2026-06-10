# Backend Azure AI Foundry no huu

Documento que explica **o que foi feito** para portar o huu do OpenRouter
para o Azure AI Foundry e **como foi feito** — incluindo a auditoria que
plugou um vazamento de cobrança em que features auxiliares da TUI ainda
batiam no OpenRouter mesmo com `--backend=azure` selecionado.

Resumo executivo: agora você pode rodar 100% no Azure. Você coloca sua
key + endpoint da Azure e o huu nunca mais chama OpenRouter por baixo
dos panos — nem nos agentes principais, nem nos helpers de UI.

---

## 1. O que mudou na prática (do ponto de vista do usuário)

### 1.1 Selecionar Azure como backend

```bash
huu --backend=azure
```

Na primeira execução o huu pede:

- `AZURE_OPENAI_API_KEY` — sua chave do recurso Azure OpenAI / AI Foundry
- `AZURE_OPENAI_BASE_URL` — endpoint v1, ex.:
  `https://meurecurso.openai.azure.com/openai/v1/`

Ambos podem ser salvos globalmente (vai para `~/.huu/<spec>.key`) ou
exportados via env var. **Nenhuma key da OpenRouter é necessária** no
modo Azure.

### 1.2 Lista de modelos customizável

Diferente do OpenRouter (catálogo público fixo), os "modelos" do Azure
são na verdade **deployments** que você cria no seu próprio resource.
O huu agora lê seu catálogo na seguinte ordem:

1. `<raiz-do-projeto>/azure-models.json` — por projeto (commitável)
2. `~/.huu/azure-models.json` — global (privado)
3. Fallback embutido (`DEFAULT_AZURE_MODELS`) caso não exista nenhum
   dos dois acima

Schema (mesmo de `recommended-models.json`):

```json
{
  "models": [
    {
      "id": "meu-gpt4o",
      "label": "GPT-4o (deployment do time A)",
      "description": "Caro, mas raciocínio forte",
      "bestFor": ["coding", "reasoning"],
      "tier": "workhorse"
    },
    {
      "id": "meu-gpt4o-mini",
      "label": "GPT-4o-mini (fan-out)",
      "description": "Barato, ótimo para per-file",
      "bestFor": ["cheap", "fast"],
      "tier": "fast"
    }
  ]
}
```

> ⚠️ **O `id` é o nome do deployment**, não o nome do modelo base.
> Se na Azure você criou um deployment chamado `gpt-4o-prod`, o `id`
> aqui precisa ser `gpt-4o-prod`.

O `provider` é forçado para `"azure"` no carregamento, então mesmo que
o arquivo declare outra coisa, ele não vaza para os outros backends.

---

## 2. O que foi feito por baixo dos panos

### 2.1 Backend principal (agentes de pipeline) — já estava limpo

Os agentes que executam cada etapa do pipeline usam o `pi-coding-agent`
da Mario Zechner. O provider `azure-openai-responses` desse SDK constrói
um cliente `AzureOpenAI` (do pacote `openai`) com `baseURL` resolvido
**exclusivamente** de:

1. `options.azureBaseUrl` (que o huu passa)
2. `process.env.AZURE_OPENAI_BASE_URL`
3. `model.baseUrl`

Nenhum desses caminhos toca OpenRouter. O backend `src/orchestrator/
backends/azure/factory.ts` patcha `model.baseUrl = endpoint` antes de
criar a sessão, então 100% do tráfego de agente vai para o Azure.

### 2.2 O vazamento: helpers da TUI usando LangChain → OpenRouter

A auditoria encontrou **quatro features auxiliares** que usavam
`ChatOpenAI` do `@langchain/openai` com `baseURL` hard-coded em
`https://openrouter.ai/api/v1`, independente do `--backend`:

| Feature | Arquivo |
|---|---|
| Pipeline Assistant | `src/lib/assistant-client.ts` |
| Smart File Select | `src/lib/llm-suggest-files.ts` |
| Project Recon | `src/lib/project-recon.ts` + `src/lib/recon-selector.ts` |
| Check Feasibility | `src/lib/assistant-check-feasibility.ts` |

Mesmo com `--backend=azure`, qualquer uso dessas features geraria
cobrança na sua conta OpenRouter. Inaceitável quando a empresa banca
Azure e não OpenRouter.

### 2.3 A correção: fábrica central + plumbing de contexto

**`src/lib/llm-client-factory.ts`** (novo) expõe duas funções:

- `buildChatClient(ctx, opts)` — retorna um `ChatOpenAI` apontando para
  Azure ou OpenRouter conforme `ctx.backend`. Para Azure:
  - `baseURL` = endpoint do usuário (normalizado com `/` no final)
  - `defaultHeaders: { 'api-key': azureApiKey }` (Azure ignora o
    `Authorization: Bearer` do SDK)
- `defaultHelperModel(backend)` — modelo padrão para tarefas auxiliares.
  Azure → `gpt-4o-mini`. Os demais mantêm o comportamento anterior.

Tipo central:

```ts
export interface LlmClientContext {
  backend: AgentBackendKind;
  openrouterApiKey?: string;
  azureApiKey?: string;
  azureEndpoint?: string;
}
```

Esse `llmContext` foi **plumbado por todo o caminho** que pode disparar
um helper:

```
                  app.tsx
                  │ helperLlmContext = useMemo(...)
                  ├──→ PipelineAssistant ──→ ProjectRecon ──→ selectAndRunRecon
                  │                       └──→ createAssistantChat
                  └──→ PipelineEditor    ──→ StepEditor   ──→ FileMultiSelect ──→ suggestFilesForStep
                                          └──→ CheckStepEditor                ──→ analyzeCheckFeasibility
```

Mesmo padrão na camada web:

```
src/web/session.ts
  └─ buildHelperLlmContext()  // resolve Azure key+endpoint via specs
       ├──→ src/web/handlers/assistant.ts → createAssistantChat
       └──→ src/web/handlers/recon.ts     → runProjectRecon
```

Cada helper aceita `llmContext` **opcional**: quando ausente, cai no
caminho legado (OpenRouter), preservando back-compat para quem ainda usa
`--backend=pi`. Quando presente, decide via factory.

### 2.4 Modelo de modelos: `loadAzureModels(projectRoot)`

Em `src/models/catalog.ts`:

```ts
export function loadAzureModels(projectRoot: string): readonly ModelEntry[] {
  const candidates = [
    join(projectRoot, 'azure-models.json'),
    join(homedir(), '.huu', 'azure-models.json'),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const models = RecommendedModelsFileSchema.parse(parsed).models;
      return models.map((m) => ({ ...m, provider: 'azure' as const }));
    } catch {
      // tenta o próximo candidato; cai para os defaults se nada parsear
    }
  }
  return DEFAULT_AZURE_MODELS;
}
```

`loadRecommendedModels()` agora chama essa função em vez de usar
`DEFAULT_AZURE_MODELS` direto, então o seletor de modelos da TUI já
reflete o seu catálogo customizado sem nenhuma mudança de UI.

### 2.5 Validação de credenciais antes de fan-out

O Project Recon fanseia 4+ agentes em paralelo. Antes, se faltasse key
o usuário via 4 stack traces "OpenRouter API key missing". Agora há um
short-circuit no topo de `runProjectRecon()`:

- Se `backend === 'azure'`: exige `azureApiKey` E `azureEndpoint`
- Caso contrário: exige `apiKey` ou `openrouterApiKey`

Quando falta, emite um `error` por item (para o UI conseguir limpar os
spinners) e dá `throw` com mensagem única.

---

## 3. Caveats

### 3.1 Backend `copilot`

O GitHub Copilot CLI não expõe API genérica de chat-completion, então
quando `backend === 'copilot'` os helpers continuam usando OpenRouter
(comportamento pré-existente). Isso está documentado dentro do próprio
`llm-client-factory.ts`. Para evitar OpenRouter completamente, use
`--backend=azure`.

### 3.2 `helperLlmContext` é por-sessão, não por-pipeline

Os helpers seguem o backend ativo no app/web session. Trocar de backend
no meio de uma sessão **não** muda o `llmContext` em árvores de
componentes já montadas — é necessário re-entrar no fluxo. Comportamento
intencional para evitar surpresas de cobrança no meio de um trabalho.

### 3.3 Schema do `azure-models.json`

É o mesmo schema do `recommended-models.json` (Zod
`RecommendedModelsFileSchema`). Se o arquivo for inválido, o huu cai
silenciosamente para o próximo candidato / defaults — não quebra a TUI.
Para diagnosticar, rode `node -e "JSON.parse(require('fs').readFileSync('azure-models.json','utf8'))"`.

---

## 4. Verificação

Executados antes do push:

- `node_modules/.bin/tsc --noEmit` — limpo
- `node_modules/.bin/vitest run` — **610 / 610 passing** (51 suites)

Commits relevantes na branch `ai-task-1779716819`:

- `308ec54` — `feat(backend): add Azure AI Foundry backend (--backend=azure)`
  (implementação inicial do backend + agent path)
- `d968824` — `fix(azure): route ALL helper LLM calls through chosen backend`
  (auditoria + fábrica central + plumbing + catálogo customizável)

---

## 5. Arquivos novos / modificados nesta refatoração

**Novo:**

- `src/lib/llm-client-factory.ts`

**Modificados (LangChain → factory):**

- `src/lib/assistant-client.ts`
- `src/lib/llm-suggest-files.ts`
- `src/lib/recon-selector.ts`
- `src/lib/project-recon.ts`
- `src/lib/assistant-check-feasibility.ts`

**Modificados (plumbing de `llmContext`):**

- `src/app.tsx`
- `src/ui/components/PipelineAssistant.tsx`
- `src/ui/components/PipelineEditor.tsx`
- `src/ui/components/StepEditor.tsx`
- `src/ui/components/FileMultiSelect.tsx`
- `src/ui/components/CheckStepEditor.tsx`
- `src/ui/components/ProjectRecon.tsx`
- `src/web/session.ts`
- `src/web/handlers/assistant.ts`
- `src/web/handlers/recon.ts`

**Catálogo de modelos Azure customizável:**

- `src/models/catalog.ts` (`loadAzureModels(projectRoot)`)

---

## 6. Próximos passos opcionais (não implementados)

- **Descoberta automática de deployments**: chamar
  `GET <endpoint>/openai/v1/models` e cachear o resultado em
  `~/.huu/azure-models.json`. Geraria um catálogo inicial automático,
  que o usuário ainda poderia editar à mão.
- **Editor in-TUI** para `azure-models.json`. Por enquanto: edite à mão,
  o arquivo é só JSON.
- **Métricas/billing**: surface custo agregado por deployment no
  Welcome screen (Azure não devolve preço por chamada como OpenRouter
  faz; precisaria de tabela manual).
