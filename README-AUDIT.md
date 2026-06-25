# README audit — claim → evidence

> Auditoria do README contra o código real no HEAD da branch
> `claude/huu-readme-audit-0x3oub`. Objetivo: cada afirmação factual do
> README novo mapeia para uma localização verificável no código. Onde o
> código contradisse o README antigo (ou os "prior findings" de uma
> análise externa), **o código venceu** e o texto foi corrigido.
>
> Método: leitura direta do código (`grep`, `cat`, `wc -l`, `git log`),
> mais sondagens externas (npm registry, manifest GHCR, página do
> Bernstein no PyPI). Citações no formato `arquivo:linha` apontam para o
> HEAD auditado.

---

## 0. Decisões sinalizadas (leia primeiro)

Casos onde a realidade era **pior ou mais sutil** que o README antigo
sugeria. Cada um foi resolvido no texto novo; alguns precisam de uma
decisão sua.

| # | Tema | Realidade no código | O que fiz no README | Precisa de você? |
|---|---|---|---|---|
| D1 | **Custo agregado é stub** | `totalCost: 0, // M5 will populate` (`src/orchestrator/index.ts:312`, `:818`). O total da run nunca é somado. | Marquei `totalCost` como **roadmap** no modo headless e na seção web; deixei claro que custo/tokens **por agente** são reais. | **Sim** — confirmar se quer manter como roadmap ou priorizar implementar a soma (somar `agents[].cost`). |
| D2 | **"Determinístico" sem qualificação** | Merge é determinístico em ordem (`integration-merge.ts:27`, `git-client.ts:243` `--no-ff`), mas conflito cai num agente LLM **não-determinístico** (`integration-agent.ts:97`). | Qualifiquei "determinístico" em **todos** os lugares como "no método e na ordem de merge, não no resultado"; liguei ao MANIFESTO. | Não — alinhado ao MANIFESTO. |
| D3 | **"100% de cobertura"** | O pipeline **não** mira nem garante 100%; só exige suíte verde e reporta a cobertura que emergir (`huu-test-suite.ts` STEP4/CHECK5). O próprio plano aponta mutation testing como o que mede qualidade. | Reescrevi a legenda do GIF + adicionei "Ressalva honesta sobre cobertura" no showcase; 100% = exemplo + ponto de partida, não prova. | Não. |
| D4 | **Showcase desatualizado** | Test Suite agora é **autônomo** (recon + `scope: memory`), não `per-file` "escolhido pelo usuário" (`huu-test-suite.ts:315-357`). | Reescrevi a tabela do showcase pra refletir os 6 passos reais (recon → memory fan-out → cleanup → judge → finalize). | Não. |
| D5 | **Construtores guiados são TUI-only** | A web expõe `GET /api/pipelines`, `GET /api/pipeline`, `POST /api/run` (`web/server.ts:170-215`) — **nenhuma** rota de autoria/assistant. | Adicionei avisos: a web roda pipelines existentes; Assistant/New são da TUI (`--cli`); autoria web é roadmap. | **Sim** — confirmar que autoria web é mesmo roadmap (e não algo que eu não localizei). |
| D6 | **Claim de unicidade forte demais** | O Bernstein (Apache-2.0) compartilha worktree-por-tarefa + merge serializado + gate de verificação + recusa a planner no loop. | Removi "não encontramos em nenhuma das ~20"; adicionei Bernstein como vizinho mais próximo e reposicionei a distinção honesta (humano escreve a decomposição vs. 1 chamada LLM). | Não. |
| D7 | **Maturidade não declarada** | 77 commits: ~61 do autor, 14 com "Claude" como autor, 39 co-autorados por Claude; 1 contribuidor externo menor. Sem CI. | Adicionei seção "Status & maturidade" (autor único + dev assistido por IA + sem CI + tabela Implementado/Estabilizando/Roadmap). | Não. |

---

## 1. Veredito dos "prior findings" (hipóteses externas)

A análise externa levantou 7 pontos. Tratados como **hipóteses**;
confirmados contra o HEAD atual.

### Finding 1 — Cost tracking stub → **CONFIRMADO (com nuance)**

- `src/orchestrator/index.ts:312` — `totalCost: 0, // M5 will populate`
  (no `getState()`).
- `src/orchestrator/index.ts:818` — `totalCost: 0` (no `OrchestratorResult`).
- Consumidores propagam o zero: `src/lib/headless-run.ts:85`
  (`cost: Number(s.totalCost.toFixed(6))`), `:115`
  (`totalCost: Number(result.totalCost.toFixed(6))`),
  `src/web/client/app.js:282` (`'$' + (st.totalCost || 0).toFixed(2)`).
- **Nuance (a favor do código):** custo e tokens **por agente** são
  reais — acumulados de eventos `usage`:
  `src/orchestrator/index.ts:1565-1569`
  (`tokensIn/tokensOut/cost: cur.cost + (event.cost ?? 0)`), originados
  em `backends/pi/event-mapper.ts:64,77` (`usage.cost?.total`). Exibidos
  por card na web (`web/client/app.js:358-362`, `:501-510`) e presentes
  no array `agents[]` do headless (`headless-run.ts:119-129`).
- **Conclusão:** o **agregado** é stub; o **por-agente** funciona.
  README ajustado (D1).

### Finding 2 — "Merge determinístico" enganoso → **CONFIRMADO**

- Caminho determinístico: `src/git/integration-merge.ts:27`
  (`[...entries].sort((a,b) => a.agentId - b.agentId)`) +
  `src/git/git-client.ts:243`
  (`['merge', branchName, '--no-ff', '-m', …]`).
- Fallback não-determinístico: `src/orchestrator/integration-agent.ts:50-97`
  — se sobram conflitos, `ctx.resolverFactory(...)` spawna um agente LLM
  que roda git pra resolver. `agents-md-generator.ts` +
  `prompts/integration-task.ts` montam o prompt dele.
- O MANIFESTO já adota o framing honesto ("Determinístico no método, não
  no resultado", `MANIFESTO.md:5,50-54,85-88`). README alinhado (D2).

### Finding 3 — Contradição de CI → **CONFIRMADO: não há CI**

- **Não existe** `.github/` no repositório (verificado: `ls .github` →
  ausente; nenhum diretório `workflows`).
- Há testes, mas rodam **localmente**: 59 arquivos `*.test.ts(x)`, **710**
  chamadas `it(`/`test(` em 166 `describe` (contagem via `grep`).
  `package.json:57` (`"test": "vitest run"`).
- O README antigo já dizia "não há CI automatizado" — **verdadeiro**. A
  hipótese de contradição não se sustenta no HEAD. Mantido e quantificado
  (D7).

### Finding 4 — Meta de "100% de cobertura" perigosa → **CONFIRMADO**

- O pipeline só exige suíte verde, não um piso de cobertura
  (`src/lib/default-pipelines/huu-test-suite.ts`: STEP4 mede cobertura de
  linha pro badge; CHECK5 julga "suíte verde?", não cobertura;
  `getDefaultPipeline()` em `:301-357`).
- O próprio plano (`huu-tests.md` gerado) inclui disclaimer de que
  cobertura de linha ≠ qualidade e aponta mutation testing (visto nos
  prompts STEP1 do módulo). "100%" só aparecia no **marketing** do README
  (legenda do GIF). README reescrito (D3).

### Finding 5 — Posicionamento competitivo otimista → **CONFIRMADO; Bernstein adicionado**

- Bernstein verificado em fonte pública (PyPI `bernstein` v2.7.0, 24/05/2026;
  GitHub `sipyourdrink-ltd/bernstein`; site bernstein.run):
  - License **Apache-2.0** (página PyPI: "License Expression: Apache-2.0").
  - "**zero LLM in the coordination loop. Plain Python decides who runs**".
  - Decomposição: "**The manager breaks your goal into tasks … One LLM
    call, then plain Python from there.**" → 1 chamada LLM (vs. huu: humano
    escreve).
  - Worktree por tarefa, fila de merge serializada, "janitor"
    (tests/lint/types), audit log encadeado por HMAC-SHA256 (RFC 2104),
    40+ adapters de agentes CLI.
- Adicionado ao quadrante (canto top-left, antes "escasso"), à tabela
  comparativa e à subseção "onde a concorrência ganha". Microsoft Conductor
  mantido. (D6)

### Finding 6 — Discrepâncias de doc (linhas C, faixa de portas) → **CONFIRMADO; corrigido**

- `native/port-shim/port-shim.c` tem **170 linhas** (`wc -l`), não ~150.
  Corrigido em: `docs/PORT-SHIM.md` (×5: linhas ~20, ~371, ~722, ~727,
  ~731), `docs/ARCHITECTURE.md:257`, `docs/operations.md:410`,
  `docs/operations.pt-BR.md:417`.
- Faixa de portas: constantes reais em
  `src/orchestrator/port-allocator.ts:19-22` — `DEFAULT_BASE_PORT=55100`,
  `DEFAULT_WINDOW_SIZE=10`, `DEFAULT_MAX_AGENTS=20`, `SLOTS_PER_BUNDLE=10`.
  Alocação esperada (20 agentes × 10) = **55100–55299**; o probe desliza a
  janela até `basePort + maxAgents*4*windowSize` = **55900**
  (`port-allocator.ts:70-80`). `docs/ARCHITECTURE.md:260` dizia
  `55100..56000` (errado) → corrigido pra `55100..55300` com nota de slide
  até ~55900. (`PORT-SHIM.md:668` já dizia "55100–55300 (20 agentes × 10
  slots)" — correto, mantido.)

### Finding 7 — Maturidade (autor único, dev assistido por IA) → **CONFIRMADO**

- `git log --format='%an | %cn' | sort | uniq -c`:
  - 61 commits do autor (40 `fredericokluser` + 19 + 2 variações do nome).
  - 14 commits com **"Claude"** como autor/committer.
  - 2 commits de um contribuidor externo (William Dias).
  - 77 commits no total; **39** com `Co-authored-by: …Claude`.
- Seção "Status & maturidade" adicionada (D7).

---

## 2. Mapa claim → evidência (afirmações VERIFICADAS)

Todas presentes no README novo, cada uma com âncora no código.

### Identidade & primitivos

| Claim | Evidência |
|---|---|
| 4 backends despachados por `kind` | `src/orchestrator/backends/registry.ts:16` (`'pi'|'copilot'|'azure'|'stub'`), dispatch `:61-110` |
| Map (per-file/memory fan-out) | `huu-test-suite.ts:326-334` (`scope: 'memory'`, `filesFrom`); `scope: 'per-file'` no schema |
| Switch (check steps, default+maxRuns) | `huu-test-suite.ts:342-353` (`type:'check'`, `outcomes`, `default:true`, `maxRuns`) |
| Parallel+Join (`dependsOn` ondas) | `huu-security-audit.ts:516-582` (4 dimensões em onda, join por `dependsOn`) |
| Memory (`produces`→`filesFrom`, `$hint`) | `huu-test-suite.ts:323,332`; contrato em `src/lib/memory-contract.ts:21-28` |
| Humano subscreve o escopo (sem planner) | `MANIFESTO.md:45-49`; nenhum planner em runtime no orchestrator |

### Web UI

| Claim | Evidência |
|---|---|
| Web é o front-end padrão | `src/web/interface-mode.ts:44` (`decideInterfaceMode()` → `'web'`); `cli.tsx:44` |
| `--cli` / `HUU_CLI=1` → TUI | `src/web/interface-mode.ts:37-45` |
| Porta default 4888 (`--port`/`HUU_WEB_PORT`) | `interface-mode.ts:17` (`DEFAULT_WEB_PORT=4888`), `:59-71` |
| Bind `0.0.0.0`; `127.0.0.1` = local | `interface-mode.ts:23` (`DEFAULT_WEB_HOST='0.0.0.0'`), `:78-82` |
| `HUU_WEB_TOKEN` protege rotas | `web/server.ts:44,124-134,164-165` |
| SSE + reconnect, só `node:http` | `web/server.ts:14` (import `node:http`); `web/client/app.js:250-258` (`EventSource` + `onerror` reconnect) |
| Card mostra tokens/custo/branch/arquivos/logs | `web/client/app.js:358-362,501-510` |
| Web só roda pipelines (sem autoria) | `web/server.ts:170-215` (`/api/pipelines`, `/api/pipeline`, `/api/run`…) — sem rota de criação |

### CLI / Docker

| Claim | Evidência |
|---|---|
| Ordem de bypass `--yolo`/`--no-docker`/`HUU_NO_DOCKER` | `src/lib/docker-reexec.ts:140-167` (`decideReexec()`) |
| Re-exec default em Docker via `--cidfile` | `docker-reexec.ts:166,553,577-590` |
| Imagem default `ghcr.io/…/huu:latest`, auto-pull | `docker-reexec.ts:45,521`; manifest GHCR retornou **HTTP 200** |
| Credenciais escondidas (mounts dirigidos + secret-mount) | `docker-reexec.ts:532-540` (só `~/.huu`,`~/Downloads`), `:555-575` (API keys como secret read-only + exclusão de env) |
| MTU VPN-aware / sinais / prune de órfãos | `docker-reexec.ts:50-126` (MTU), `:641-645` (sinais), `:370-460` (prune/cidfile) |
| `npm install -g huu-pipe` válido | npm registry: `huu-pipe` `dist-tags.latest = 2.1.0` (== `package.json:3`) |

### Headless

| Claim | Evidência |
|---|---|
| Subcomando `huu auto <p> --config <c>` | `cli.tsx:448` (`'auto'`), `:149-153` (usage) |
| stderr NDJSON (1/estado, throttle ~250ms) | `headless-run.ts:7-9,62-87` |
| stdout 1 JSON final (campos listados) | `headless-run.ts:104-134` (`ok,runId,integrationBranch,baseCommit,status,errorReason?,totalCost,durationMs,filesModified,conflicts,agents[]`) |
| Exit 0 se `done`, 1 senão | `headless-run.ts:13,103-135` |
| `totalCost` = sempre 0 (roadmap) | ver Finding 1 |

### Concorrência

| Claim | Evidência |
|---|---|
| AutoScaler sempre instanciado | `src/orchestrator/index.ts:293-296` |
| Margem = max(10%, 512 MiB) | `auto-scaler.ts:44,49,181-184` |
| Footprint EMA seed 250 MiB, clamp 128–2048 | `auto-scaler.ts:38,45-46,89,285-289` |
| 3 modos (auto/manual/greedy=MAX) | `auto-scaler.ts:34`; `index.ts:384-392`; `RunDashboard.tsx:352-360` |
| Guarda a ≥95% RAM **ou** CPU mata o mais novo | `auto-scaler.ts:40,149-154`; `index.ts:940-956` (`startedAt`) |
| Requeue na frente com `↻N`; `killedAgentIds` Set | `index.ts:479-494,502` (`unshift`), `:237,440,1124` |
| cgroup-aware | `src/lib/resource-monitor.ts:158-181` |
| `--concurrency=N` / `--no-auto-scale` | `cli.tsx:347-361` |

### Backends

| Claim | Evidência |
|---|---|
| Pi é o default | `src/lib/run-config.ts:24` (`.default('pi')`) |
| `thinking=medium` p/ modelos que suportam | `backends/pi/factory.ts:23-46` (`resolveThinkingLevel`) |
| Pi = `OPENROUTER_API_KEY`, qualquer modelo | `api-key-registry.ts:69-80`; `pi/factory.ts:57,64` |
| Azure = `AZURE_OPENAI_API_KEY`+`_BASE_URL` | `api-key-registry.ts:119-142`; `azure/factory.ts:79-89` |
| Copilot = `COPILOT_GITHUB_TOKEN`, dep opcional | `api-key-registry.ts:103-112`; `package.json:83-85` (`optionalDependencies`) |
| Stub grátis, sem LLM | `backends/registry.ts:94-104`; `stub/factory.ts:10-78` |
| Novo backend = 1 pasta + 1 case | `backends/registry.ts:7-10` |

### Pipelines default

| Claim | Evidência |
|---|---|
| 7 pipelines; só Test Suite `_default` | `default-pipelines/registry.ts:26-34`; `registry.test.ts:20-26,38-46`; `huu-test-suite.ts:304` |
| 5 auditorias report-only + judge | módulos STEP0 "REPORT-ONLY"; `knowledge-protocol.ts:109-132` (`reportJudgeCondition`); `registry.test.ts:49-65` |
| Autonomia (nenhum `per-file`; recon+memory) | `registry.test.ts:104-122`; `targetsRecon()` em `knowledge-protocol.ts` |
| Security Audit em 4 ondas | `huu-security-audit.ts:516-582` |
| Test Suite + Knowledge System mutam o repo | `huu-test-suite.ts:33-36,253-269`; `huu-knowledge-system.ts:32-36` |
| MEMORY CONTRACT auto-anexado | `src/lib/memory-contract.ts` |

### Portas / shim

| Claim | Evidência |
|---|---|
| Shim C ~170 linhas, intercepta `bind()` | `wc -l native/port-shim/port-shim.c` = 170; `ARCHITECTURE.md:256` |
| Janela de 10 portas/agente, base 55100 | `port-allocator.ts:19-22,72,108-133` |
| Faixa 55100–55300 (20×10), slide até ~55900 | `port-allocator.ts:70-80` |

### Versão / changelog

| Claim | Evidência |
|---|---|
| Versão 2.1.0 consistente | `package.json:3` (`2.1.0`) == `CHANGELOG.md:53` (`[2.1.0] - 2026-06-25`). A divergência 1.4.0↔2.1.0 do prior finding **não** existe no HEAD. |

---

## 3. Afirmações corrigidas / suavizadas / cortadas

| Antes (README antigo) | Depois (README novo) | Motivo |
|---|---|---|
| Legenda GIF "gerando 100% de cobertura" | "gerando uma suíte de testes unitários… 100% de cobertura de **linha** nesta run, não uma garantia" | 100% é resultado de exemplo, não meta do pipeline (Finding 4). |
| One-liner "mesclados de forma determinística a cada etapa" | "…de forma determinística **no método e na ordem de merge** (não no resultado)" | Conflito → resolvedor LLM não-determinístico (Finding 2). |
| Primitivo Parallel+Join "mesma sequência de commits, sempre" | "a **ordem** das ondas e merges é a mesma… o conteúdo de cada nó é do modelo… merge com conflito cai num resolvedor LLM" | Determinismo de ordem, não de conteúdo. |
| Showcase step 3 "Testa `$file` (escolhido pelo usuário) · per-file" | Tabela de 6 passos: recon (`produces`) → `memory` fan-out → cleanup → judge → finalize | Autonomia v2 removeu o picker manual (Finding/D4). |
| "What huu is for": audits escrevem "só em `.huu/audits/<topic>.md` + `-faq.json`" | Acrescentado `-targets.json`, `.tmp/`, e o "um ajuste de `.gitignore`" | Reflete a superfície de side-effects real (CLAUDE.md + módulos). |
| Headless stdout "(`runId`, `integrationBranch`, `totalCost`, …)" | Lista completa de campos + **ressalva de que `totalCost` é 0/roadmap** | `totalCost` nunca é somado (Finding 1). |
| Concorrência "se a RAM passa de ~95%" | "se a RAM **ou a CPU** passam de ~95%" | Guarda checa CPU **ou** RAM (`auto-scaler.ts:154`). |
| Web "clique num card pra ver tokens, custo…" | Mantido, mas com nota de que o **total** da run não é agregado | Por-card é real; total não (Finding 1). |
| "A combinação que define o huu — que não encontramos em nenhuma das ~20…" | Reposicionado: Bernstein é o vizinho mais próximo; a linha divisória é humano-escreve vs. 1-chamada-LLM | Honestidade competitiva (Finding 5/D6). |
| Construtores guiados descritos sem qualificar a UI | Marcados como **TUI-only** (`--cli`); web roda pipelines existentes | Web não tem rota de autoria (D5). |
| (ausente) | Seção "Status & maturidade" + tabela Implementado/Estabilizando/Roadmap | Disclosure de maturidade (Finding 7/D7). |

**Cortes:** nenhuma feature foi alegada sem respaldo a ponto de exigir
remoção total — todas as features citadas existem no código. O que mudou
foi **qualificação** (determinismo, custo, cobertura) e **escopo de UI**
(autoria é TUI). Superlativos: o README antigo **não** continha
"revolucionário"/"a única ferramenta"; o único quase-absoluto ("não
encontramos em nenhuma das ~20") foi suavizado.

---

## 4. Correções aplicadas em docs (além do README)

| Arquivo | Mudança |
|---|---|
| `docs/ARCHITECTURE.md:257` | `~150 lines C` → `~170 lines C` |
| `docs/ARCHITECTURE.md:260` | `55100..56000` → `55100..55300` (20 agentes × 10) + nota de slide até ~55900 |
| `docs/PORT-SHIM.md` (×5) | "~150 / 150 linhas" → "~170 linhas" (linhas ~20, ~371, ~722, ~727, ~731) |
| `docs/operations.md:410` | `~150-line C` → `~170-line C` |
| `docs/operations.pt-BR.md:417` | `~150 linhas` → `~170 linhas` |

`docs/PORT-SHIM.md:668` ("55100–55300 (20 agentes × 10 slots)") já estava
correto — mantido. `docs/pipeline-json-guide.md:522` usa um exemplo
"agent 0 gets 55100–55109" (indexação aproximada); não alterado por ser
ilustrativo, mas sinalizado aqui caso queira normalizar pra `agentId-1`.

---

## 5. Decisões em aberto pro autor

1. **`totalCost` agregado (D1).** Implementar a soma é barato: somar
   `agents[].cost` no `OrchestratorResult` (`index.ts:818`) e no
   `getState()` (`:312`). Enquanto não, o README chama de roadmap. Quer
   que eu implemente numa próxima passada?
2. **Autoria de pipeline pela web (D5).** Confirmar que é mesmo roadmap
   (não localizei rota de criação em `web/server.ts`). Se existir e eu não
   achei, corrijo o aviso.
3. **Mutation score como métrica de 1ª classe.** Hoje os prompts miram
   asserções mutation-surviving, mas o pipeline não roda Stryker/mutmut/PIT.
   Vale um pipeline/step opcional de mutation? Listado como roadmap.
4. **`docs/ARCHITECTURE.md:259,265`** ainda dizem "Default concurrency 10"
   e thresholds antigos — fora do escopo deste PR (linhas/portas), mas a
   concorrência default hoje é `auto` (memória-aware). Sinalizo caso queira
   um follow-up de consistência.
5. **MANIFESTO interno:** `MANIFESTO.md:124` diz que o Bernstein faz
   "scheduling determinístico em código, sem LLM no loop de decisão" e
   `:139` diz que ele "mantém um planejador gerando o grafo". Ambos são
   verdadeiros (1 chamada LLM decompõe; o **scheduling** é Python puro),
   mas a redação pode confundir. Sugiro uma nota unificando — não alterei o
   MANIFESTO nesta passada.

---

*Gerado durante a reescrita do README. Cada `arquivo:linha` aponta para o
HEAD da branch auditada; reverifique após qualquer rebase.*
