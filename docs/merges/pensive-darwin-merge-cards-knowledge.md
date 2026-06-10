# Merge: `claude/pensive-darwin-ueg9mf` — merge cards no kanban + `integrationModelId` + knowledge protocol

| | |
|---|---|
| **Branch tip** | `39745a4` (6 commits) |
| **Merge-base com a main** | `349e47f2` (estava em cima da `main` atual) |
| **Merge commit** | `55edae8` |
| **Conflitos** | 1 arquivo: `src/orchestrator/index.ts` (aditivo) |
| **Risco** | médio — principal foco de conflitos da rodada |

## O que mudou

Branch grande, escolhida entre as duas `claude/*` rivais (ver
[README de merges](./README.md)). Cinco eixos:

### 1. Override do modelo de integração — `Pipeline.integrationModelId`

Permite que o agente de merge/integração (o resolvedor de conflitos que roda entre stages)
use um modelo diferente do dos workers. Cai de volta no modelo global do run se não setado.
Editável no editor de pipeline da TUI (`T` → "Integration agent model") e no editor web;
documentado em `docs/pipeline-json-guide.md`.

### 2. Merge cards no kanban — `StageIntegration`

Cada visita a um stage cria uma entrada `StageIntegration` em `OrchestratorState`
(persistida em `manifest.stageIntegrations`), que os dois dashboards renderizam como um
card display-only fluindo TODO → DOING → DONE
(`pending → merging → conflict_resolving → done/error/skipped`), com último log,
contagem de branches/conflitos, tempo decorrido e o modelo de integração efetivo. A UI
deixa de **parecer travada** durante `status === 'integrating'`.

- TUI: `src/ui/components/RunKanban.tsx`.
- Web: nova molecule `webui/src/molecules/IntegrationPill.tsx` em `KanbanBoard`.
- O estado `conflict_resolving` usa o token de cor da IA (`theme.ai`, magenta); o merge
  determinístico fica ciano — coerente com a convenção visual do `CLAUDE.md`.

### 3. Progressive knowledge protocol nos 6 pipelines default

Novo `src/lib/default-pipelines/knowledge-protocol.ts`: passos de escopo de projeto que
antes agiam "às cegas" passam a **ler o JSON de findings do run antes de agir e dar append
depois** (re-read + dedupe, append-only). Findings ganham campos opcionais
`priority`/`fixability` usados pelas etapas de consolidação para ordenar recomendações.
Os 6 audits default foram reescritos sobre esse protocolo.

### 4. Novo pipeline default — `huu Agent Knowledge`

Estuda o projeto progressivamente (recon → estudo por arquivo → síntese por tópico,
acumulando em `.huu/knowledge/atlas.md` + `findings.json`) e **compila o conhecimento em
Agent Skills** sob `.agents/skills/`, seguindo a spec do agentskills.io: uma skill por
tópico + uma skill roteadora `project-knowledge`. Um check step valida frontmatter/naming/
cobertura do roteador e dá loop de volta no `rework` (máx. 3 runs). Pipeline de setup —
muta o repo por design. Registrado em `registry.ts`.

### 5. Manifesto + fixes

- `MANIFESTO.md` + `MANIFESTO.en.md` (bilíngue), linkados nos dois READMEs.
- Fix: conflito add/add garantido em `.env.huu` em repos novos — os runtime-only paths
  passam a ser escritos em `.git/info/exclude` (compartilhado por todos os worktrees, sem
  tocar arquivos versionados) em vez de gerarem commits conflitantes por agente.
- Fix: `scripts/smoke-dashboard.tsx` (quebrado desde o refactor do backend registry).
- Fix: `portAllocation` deixava de fazer round-trip no schema Zod (era silenciosamente
  removido no import/export).

### Áreas tocadas

`src/orchestrator/` (`index.ts`, `integration-agent.ts`), `src/lib/types.ts`,
`src/lib/pipeline-io.ts`, `src/lib/default-pipelines/*`, `src/ui/components/`
(`RunKanban.tsx`, `PipelineEditor.tsx`, `RunDashboard.tsx`), `webui/src/`
(`IntegrationPill`, `KanbanBoard`, `PipelineEditorPage`, `RunPage`), docs e CHANGELOG.

## Conflito resolvido

**`src/orchestrator/index.ts`** — ambos os lados inseriram uma declaração de campo privado
logo após `executionTrace`:

- `HEAD` (do merge anterior, process-log): `private processLogUnsubscribe`.
- `pensive-darwin`: `private stageIntegrations: StageIntegration[]`.

Os dois são independentes e necessários (o `getState()` desta branch já referencia
`stageIntegrations`). **Resolução: manter os dois lado a lado** (aditivo, sem escolha
either/or). Nenhum outro hunk conflitou.

## Impacto no app

- O dashboard (TUI **e** web) passa a mostrar o trabalho de merge/integração como cards
  vivos, em vez de congelar a coluna DOING durante a integração.
- Pipelines podem fixar um modelo dedicado para o agente de merge.
- Os pipelines default ficam resistentes a conflitos de merge "por construção" (protocolo
  de knowledge append-only com dedupe) e geram recomendações priorizadas.
- Novo fluxo de setup `huu Agent Knowledge` materializa skills reutilizáveis sob
  `.agents/skills/`.
- Runs em repos novos não falham mais por conflito add/add em `.env.huu`.

## Verificação

`npm run typecheck` verde; `npm test` com 618 testes passando (3 skipped). A suíte inclui
os testes novos de orchestrator desta branch.
