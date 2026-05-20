# Plano: Steps condicionais (LLM-judged) com navegação livre entre etapas

## Problema

Hoje `Pipeline.steps[]` é uma lista estritamente linear executada em
`src/orchestrator/index.ts` no laço `for stageIdx of totalStages`
(linhas 459–515). Cada stage decompõe em workers paralelos, faz merge
determinístico, e o pointer avança fixo para `stageIdx+1`.

Queremos transformar a pipeline em **grafo dirigido com nós de decisão
LLM-julgados**, mantendo:

- Worktree de integração **nunca dá rewind** — loops apenas re-executam
  o nó sobre o HEAD atual da integração.
- Possibilidade de **pular adiante** ou **voltar atrás** para qualquer
  nó já declarado na pipeline.
- Variável `$runs` injetada na condição (1-based, conta execuções do
  nó de checagem na run corrente) — usuário usa pra evitar loop
  infinito (`$runs >= 3 ⇒ siga adiante`).

## Abordagem

### 1. Modelo de dados: novo tipo de nó (`CheckStep`) e arestas explícitas

Em `src/lib/types.ts`, transformar `PromptStep` numa **discriminated union**
`PipelineStep = WorkStep | CheckStep`, mantendo back-compat (step sem
campo `type` é tratado como `WorkStep`).

```ts
interface WorkStep {           // <- equivalente ao PromptStep atual
  type?: 'work';               // omitido nos pipelines legados
  name: string;                // identificador único na pipeline
  prompt: string;
  files: string[];
  modelId?: string;
  scope?: StepScope;
  next?: string;               // nome do próximo nó; default = próximo do array
}

interface CheckStep {
  type: 'check';
  name: string;                // identificador único
  condition: string;           // texto NL, pode conter $runs
  instructionDraft?: string;   // gerado no setup pelo assistant
  outcomes: Array<{            // ≥2; uma delas deve ser `default: true`
    label: string;             // ex: "coverage_low", "ok"
    nextStepName: string;      // nome de outro step (work OU check)
    default?: boolean;         // fallback se o juiz não casar com nenhuma label
  }>;
  maxRuns?: number;            // hard cap por nó (safety net adicional ao $runs)
  modelId?: string;            // modelo do juiz; default = AppConfig.modelId
}
```

Regra: `WorkStep.next` e `CheckStep.outcomes[].nextStepName` devem
referenciar **steps que já existem** na pipeline. Validado por Zod
e por uma checagem de topologia em `pipeline-io.ts` (DAG-permitindo-loops,
mas todo nó atingível e todo destino válido).

### 2. Schema/IO: `src/lib/pipeline-io.ts`

- Substituir `PromptStepSchema` por `z.discriminatedUnion('type', [WorkStepSchema, CheckStepSchema])`.
- Pre-parse: se `type` ausente, injetar `'work'` (back-compat com pipelines v0.x).
- Validação de integridade: nomes únicos; destinos existem; cada `outcomes`
  tem exatamente um `default: true`.
- Bump do `_format` para `huu-pipeline-v2` (manter leitura de `v1` e
  `programatic-agent-pipeline-v1`).

### 3. Orquestrador: cursor de grafo em vez de loop linear

Em `src/orchestrator/index.ts`:

- Substituir `for (stageIdx)` por **state machine** com `currentStepName`
  e `runsByStep: Map<string, number>`.
- Pré-decomposição (linhas 440–451) passa a ser **lazy por nó**: workers/
  worktrees só são alocados quando o nó é alcançado (porque um WorkStep
  pode rodar N vezes via loops e cada execução vira uma "instância"
  com agentIds novos).
- Cada execução de WorkStep cria nova leva de `AgentTask`s com agentIds
  frescos e branch names sufixados com a iteração (ex: `…-s2r3-a17`)
  pra evitar colisão.
- Após `runStageIntegration` decidir o próximo nó:
  - **WorkStep**: `next` ou `stepsArray[idx+1]` ou `null` (fim).
  - **CheckStep**: chama `evaluateCheckStep(...)` (ver §4) → recebe
    label vencedor → seleciona `outcomes[label].nextStepName`.
- `manifest.stageBaseCommits` vira **trace de execução** (lista ordenada
  `{stepName, runs, commitAfter, outcomeLabel?}`).
- Safety global: hard cap de execuções totais por run (config
  `Pipeline.maxNodeExecutions`, default 50) para impedir runaway mesmo
  se o usuário esquecer `$runs`.

### 4. Avaliador de CheckStep: `src/orchestrator/check-evaluator.ts` (novo)

Análogo a `integration-agent.ts`:

- Roda no **worktree de integração** (HEAD atual, sem rewind).
- Spawna um agente via `AgentFactory` (mesmo backend Pi/Copilot/Stub) com:
  - System prompt curto que descreve a tarefa: "leia o repo, execute
    comandos que precisar, retorne um veredito JSON com `{label, reason}`
    casando uma de: [labels declaradas]".
  - User prompt = `condition` com `$runs` substituído pelo contador
    atual + `instructionDraft` (se houver) como dica.
- Restringe saída via **schema check**: a última mensagem do agente deve
  conter um bloco JSON validável; caso contrário, retry 1x; se falhar
  de novo, usa o `outcome` marcado como `default: true`.
- Eventos `AgentEvent` propagados pro dashboard (mesma plumbing do
  integration agent — apareceria como card especial no Kanban).
- Crucial: o juiz tem acesso a shell (pi-coding-agent já dá isso por
  padrão); ele decide se roda `npm test`, lê arquivos, etc.

### 5. Setup-time: análise de viabilidade no editor

Quando o usuário cria/edita um CheckStep no `PipelineEditor.tsx`:

- Botão "Analisar viabilidade" chama uma rotina nova em
  `src/lib/assistant-client.ts` (ou um arquivo dedicado
  `assistant-check-feasibility.ts`) que:
  - Usa Project Recon (`project-recon.ts`) já existente como contexto
    do repo.
  - Pede ao LLM um JSON `{feasible: boolean, reason: string,
    instructionDraft: string, warnings: string[]}`.
  - Persiste `instructionDraft` no step.
  - Mostra warnings na UI antes de salvar (ex: "tests command not
    found in package.json — runtime evaluation may fail").
- Validação topológica (destinos existem, sem nós inacessíveis) também
  roda aqui e bloqueia save com erro claro.

### 6. UI/UX (Ink)

- **PipelineEditor**: novo atalho "Add check step" no menu da lista de
  steps. Sub-form `CheckStepEditor.tsx` (irmão de `StepEditor.tsx`)
  com campos: name, condition (textarea), maxRuns, outcomes (lista
  editável com label + dropdown de destino), botão "Analisar viabilidade".
- **RunDashboard / RunKanban**: cards de check renderizados com cor
  `theme.ai` (magenta — já é a convenção pra UI dirigida por IA);
  mostram contador de iterações e label vencedor. Setas/arestas entre
  cards podem ser uma fase 2 — fase 1 só anota "→ próximo: X" no
  rodapé do card.
- **RunModal**: trace de execução (lista cronológica de nós visitados
  + outcome) substitui a barra linear `stage X/Y`.

### 7. Testes

- `pipeline-io.test.ts`: round-trip de pipelines v2; validação de
  destinos inexistentes; back-compat de v1; substituição de `$runs`.
- `orchestrator.test.ts`: novo grupo "graph navigation" — loops
  (back-edge), skip-forward, hard cap, default outcome quando o juiz
  retorna label inválido.
- `check-evaluator.test.ts` (novo): usa `--stub` backend com saída
  determinística pra cobrir os caminhos de outcome.
- `pipeline-integration.test.ts`: cenário end-to-end com 1 CheckStep
  voltando 1x e depois seguindo adiante.

## Notas e considerações

- **Back-compat**: pipelines v1 existentes (incluindo `example.pipeline.json`)
  precisam carregar sem mudança. O orquestrador deve detectar "todos
  WorkSteps sem `next`" e cair no caminho linear antigo — não há
  regressão de comportamento.
- **Worktree naming**: `agentWorktreePath` hoje deriva só do `agentId`.
  Como agentIds são únicos globalmente na run, basta deixar
  `nextAgentId` continuar incrementando entre iterações — sem mudança
  estrutural no naming. Já há a inferência de "stageIndex" no
  `AgentTask`; precisa virar livre (`iteration` + `stepName`) e o
  campo legado `stageIndex` pode ser computado como ordem de visita
  pro relatório.
- **`$runs`**: substituição puramente textual no `condition` antes de
  mandar pro juiz. Suportar também `$runs >= N` como sintaxe sugerida
  no instructionDraft (mas o LLM ainda julga — não há parser
  determinístico). Documentar isso claramente.
- **Determinismo do juiz**: temperatura baixa + retries de parsing.
  Para auditoria, gravar prompt+resposta do juiz no `run-logger`.
- **Custo**: cada CheckStep gasta tokens. Adicionar ao `totalCost`
  já agregado em `OrchestratorState`.
- **Fora de escopo nesta entrega**: branches paralelos (fan-out
  condicional) — o usuário pediu navegação sequencial, não fork.
  Se vier no futuro, o modelo de outcomes já permite (basta o
  orchestrator visitar múltiplos destinos), mas isso traria
  complicação de merge entre ramos divergentes — deixar pra ADR
  separada.

## Arquivos impactados

| Arquivo | Mudança |
|---|---|
| `src/lib/types.ts` | Discriminated union `PipelineStep`, novos campos `next`/`outcomes`/`maxRuns`/`instructionDraft` |
| `src/lib/pipeline-io.ts` | Schema v2, validação topológica, retrocompat de v1 |
| `src/orchestrator/index.ts` | State machine de grafo substitui laço linear; runsByStep counter; hard cap |
| `src/orchestrator/check-evaluator.ts` | **NOVO** — spawna juiz e parseia veredito |
| `src/orchestrator/types.ts` | Possível novo `AgentEvent` `{type:'check_verdict'}` |
| `src/lib/assistant-check-feasibility.ts` | **NOVO** — análise de viabilidade no setup |
| `src/ui/components/CheckStepEditor.tsx` | **NOVO** — subform do editor |
| `src/ui/components/PipelineEditor.tsx` | Atalho "Add check step", roteamento pro novo editor |
| `src/ui/components/RunKanban.tsx`, `RunModal.tsx` | Renderização especial de check nodes + trace |
| `src/orchestrator/*.test.ts`, `src/lib/pipeline-io.test.ts` | Cobertura nova |
| `README.md` / `README.pt-BR.md` | Documentar o tipo `check` e `$runs` |
| `example.pipeline.json` ou novo `example.conditional.pipeline.json` | Exemplo com loop e skip |
