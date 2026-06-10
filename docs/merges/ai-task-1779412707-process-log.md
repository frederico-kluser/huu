# Merge: `ai-task-1779412707` — bridge de logs para a TUI

| | |
|---|---|
| **Branch tip** | `ccc7dfb` (`fix(tui): route stray console + node warnings to LogArea, not above kanban`) |
| **Merge-base com a main** | `e89fb250` (estava 2 commits atrás da `main`) |
| **Merge commit** | `9ad0922` |
| **Conflitos** | nenhum (auto-merge) |
| **Risco** | baixíssimo — feature isolada |

## O que mudou

Antes, `console.log/warn/error` e os eventos `process.on('warning')` do Node escreviam
direto em `stdout`/`stderr`. Numa TUI Ink isso é destrutivo: o texto vaza **por cima** do
frame React renderizado e corrompe o kanban (linhas duplicadas, layout quebrado).

Esta branch introduz um **bridge process-wide** que captura essas saídas e as redireciona
para o painel "Logs (all)" da própria TUI.

### Arquivos tocados

**Novos**

- `src/lib/process-log-bridge.ts` — buffer em memória (máx. 500 entradas) + conjunto de
  sinks. Produtores chamam `enqueueProcessLog()`; consumidores se inscrevem via
  `attachProcessLogSink()` (drena o backlog de forma síncrona e depois encaminha cada nova
  entrada). Detach é idempotente.
- `src/lib/process-log-bridge.test.ts` — cobertura do buffer/sinks/drain.

**Alterados**

- `src/cli.tsx` — no bootstrap, `installLogCaptures()` faz patch dos métodos `console.*` e
  registra `process.on('warning')`, encaminhando tudo para `enqueueProcessLog()`.
- `src/orchestrator/index.ts` — ao iniciar um run, o orchestrator faz `attachProcessLogSink()`
  e guarda o handle de detach (`processLogUnsubscribe`), liberado no bloco `finally` para
  não vazar o sink entre runs.
- `package-lock.json` — ajuste trivial.

## Impacto no app

- A renderização da TUI deixa de ser corrompida por logs avulsos do Node ou de
  dependências — eles agora aparecem ordenados no painel de logs.
- Comportamento puramente de apresentação/estabilidade; **não altera** a lógica do
  pipeline, do orchestrator ou dos merges.
- O backlog em memória é re-drenado a cada novo run dentro da mesma sessão (intencional:
  o usuário revê os mesmos warnings pré-run).

## Observação de integração

O handle `processLogUnsubscribe` adicionado aqui foi o ponto de um conflito (aditivo,
trivial) ao mergear a `pensive-darwin` depois — resolvido mantendo este campo lado a lado
com o `stageIntegrations` daquela branch. Ver
[pensive-darwin](./pensive-darwin-merge-cards-knowledge.md).
