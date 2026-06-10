# Registro de merges — branches da `origin`

Este diretório documenta a rodada de merges seletivos das branches que existiam na
`origin` divergindo da `main`. Cada arquivo descreve **o que** mudou, **quais** arquivos
foram tocados e **o impacto** no comportamento do app.

## Contexto

A `origin` tinha 5 branches com código divergente. Uma análise dos diffs (cada um contra
o seu ponto de conexão com a `main`) mostrou **sobreposição pesada**: três branches
resolviam o MESMO problema (mostrar o trabalho de merge/integração no kanban em vez de a
coluna DOING ficar vazia) de formas concorrentes, e as duas branches `claude/*` eram
~80% implementações **rivais** das mesmas features (manifesto, merge cards, override do
modelo de merge, protocolo de "progressive knowledge", reescrita dos pipelines default).

Mergear as cinco cegamente teria criado dois `MANIFESTO.md` no mesmo path, dois protocolos
de knowledge duplicados e duas implementações brigando em `orchestrator/index.ts` e
`RunKanban.tsx`. Por isso a rodada foi **seletiva**.

## Decisão

| Branch (tip) | Decisão | Merge commit |
|---|---|---|
| `ai-task-1779412707` (`ccc7dfb`) | **Mergeada** | `9ad0922` |
| `ai-task-1779716819` (`c9985f2`) | **Mergeada** (sem o symlink `node_modules`) | `b7793e9` |
| `claude/pensive-darwin-ueg9mf` (`39745a4`) | **Mergeada** | `55edae8` |
| `ai-task-1779412564` (`c62fce8`) | **Descartada** — superseída | — |
| `claude/modest-gates-dzymjq` (`a969fab`) | **Descartada** — rival não escolhida | — |

Ordem dos merges: do mais isolado para o mais invasivo (process-log → Azure → pensive),
para que os conflitos do merge grande caíssem sobre uma base já estável. Cada branch
entrou como merge commit `--no-ff`, preservando a proveniência.

## Detalhes por merge

- [ai-task-1779412707 — process-log bridge](./ai-task-1779412707-process-log.md)
- [ai-task-1779716819 — backend Azure AI Foundry](./ai-task-1779716819-azure-backend.md)
- [pensive-darwin — merge cards + knowledge protocol](./pensive-darwin-merge-cards-knowledge.md)

## Branches descartadas (e o que se perdeu)

### `ai-task-1779412564` — card sintético de integração (superseída)

Commit único (`c62fce8`) que adicionava um **card sintético efêmero** ao kanban durante
`status === 'integrating'` (montado on-the-fly em `getState()` via `INTEGRATION_AGENT_ID`),
para a coluna DOING não ficar vazia enquanto o merge/resolução de conflito acontecia.

**Por que descartar:** a `pensive-darwin` resolve o mesmíssimo problema de forma mais
rica e duradoura — entradas `StageIntegration` persistidas no manifest, com last-log,
contagem de branches/conflitos, tempo decorrido, modelo efetivo e card também no web
(`IntegrationPill`). Mergear o card sintético junto só geraria conflito redundante em
`orchestrator/index.ts` e `RunKanban.tsx` sem ganho. **Nada de valor único se perdeu.**

### `claude/modest-gates-dzymjq` — implementação rival (não escolhida)

Branch grande (`a969fab`) que concorria com a `pensive-darwin` nas mesmas features. Optou-se
por manter **apenas uma** das duas, e a escolha foi a `pensive-darwin` (mais alinhada ao
repo: paridade web, MANIFESTO bilíngue pt+en, fix `.git/info/exclude`, pipeline Agent
Knowledge sob a convenção `.agents/skills/`).

**O que se perdeu ao descartar a `modest-gates`:**

- **3 pipelines default** exclusivos: `huu Bug Hunt` (varredura de defeitos lógicos CWE
  por arquivo + verificação por repro + check-node loop), `huu Onboarding Guide` (guia de
  dia-1 com modelo mental + tour guiado + playbook de primeira contribuição) e
  `huu Release Notes` (mineração do histórico git desde o último release → draft
  Keep-a-Changelog + recomendação de semver).
- O naming `Pipeline.mergeModelId` (a `pensive-darwin` usa `integrationModelId` para o
  mesmo conceito).
- Uma mudança em `src/git/git-client.ts`.

> Caso esses 3 pipelines sejam desejados no futuro, podem ser portados isoladamente da
> branch `origin/claude/modest-gates-dzymjq` (arquivos
> `src/lib/default-pipelines/huu-bug-hunt.ts`, `huu-onboarding.ts`, `huu-release-notes.ts`
> + registro em `registry.ts`), sem trazer a implementação rival de merge cards/knowledge.

## Verificação pós-merge

- `npm run typecheck` — verde.
- `npm test` — 618 testes passando (3 skipped), 52 arquivos.
- `git ls-files node_modules` — vazio (symlink bogus da branch Azure removido; `node_modules/`
  permanece ignorado pelo `.gitignore`).
