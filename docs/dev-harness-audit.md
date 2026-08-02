# Auditoria do harness do modo DEV

**Data:** 2026-08-01 · **Escopo:** `src/lib/dev-mode/**`, `src/orchestrator/**`,
`src/orchestrator/backends/pi/**` · **Branch auditada:** `harness`

> **Idioma:** pt-BR sem gêmeo em inglês, seguindo o precedente de `docs/adr/`
> (documentos analíticos deste repositório são pt-BR-only). Não é deriva da
> convenção de `writing-project-docs` — é o mesmo tratamento dado às ADRs.

**Método.** Duas metades independentes:

1. **Pesquisa externa** — 5 ângulos de busca, 25 fontes lidas na íntegra,
   125 afirmações extraídas, **25 submetidas a verificação adversarial de 3
   votos**: 15 confirmadas, 10 refutadas. Só entram aqui as confirmadas, com
   a fonte primária. As refutadas e os buracos de cobertura estão em §6 —
   leia essa seção antes de citar qualquer coisa daqui.
2. **Auditoria interna** — leitura do código do modo DEV. Todo achado carrega
   `arquivo:linha`. Nenhum achado é inferido de documentação nossa: se o doc
   e o código divergem, vale o código.

---

## 0. Resumo executivo

Dezoito achados. Os cinco primeiros são **contradições diretas entre o que o
harness manda e o que o método manda** — não são oportunidades de melhoria, são
defeitos.

| # | Achado | Gravidade | Custo | Onde |
|---|---|---|---|---|
| A1 | Cabeçalho legado de "refactoring" contradiz todo prompt do modo DEV | 🔴 P0 | 1 arquivo | `agents-md-generator.ts` |
| A2 | Papéis somente-leitura recebem `edit` + `write` + `bash` | 🔴 P0 | 1 parâmetro | `backends/pi/factory.ts:170` |
| A18 | `/skill:project-router` prefixado em todo prompt, com skills desligadas | 🔴 P0 | decisão | `hermetic.ts:155` |
| A8 | Disjunção de write-set nunca é imposta — só instrumentada | 🟠 P1 | ~20 linhas | `dev-driver.ts:1101` |
| A6 | O digest é escrito por 1 agente irrestrito, sem verificação nenhuma | 🟠 P1 | médio | `knowledge-to-pipeline.ts` |
| A3 | O crítico nunca lê o que o worker disse | 🟠 P1 | pequeno | `review-agent.ts:427` |
| A4 | Cada rodada de crítica é um agente novo, sem memória da anterior | 🟠 P1 | pequeno | `review-loop.ts:138` |
| A23 | `event-mapper` escuta um evento que o pi não emite — compactação nem logada | 🔴 P0 | 1 case | `event-mapper.ts:113` |
| A11 | Nada gerencia contexto dentro de um card | 🟠 P1 | médio | `index.ts` |
| ~~A19~~ | ~~Nenhum orçamento de resultado de ferramenta~~ — **achado ERRADO, ver §7** | — | — | — |
| A7 | Conhecimento não acumula entre épocas | 🟠 P1 | médio | `knowledge-blackboard.ts:442` |
| A12 | Nenhum artefato de progresso durante a tarefa | 🟠 P1 | pequeno | `dev-protocol.ts:285` |
| A5 | `KNOWLEDGE_DIGEST_MAX_CHARS = 6000` é arbitrário | 🟡 P2 | pequeno | `knowledge-blackboard.ts:53` |
| A9 | Falha da requisição de conhecimento é fail-closed, contra a doutrina | 🟡 P2 | pequeno | `dev-driver.ts:763` |
| A13 | Cache de prompt destruído exatamente onde o custo está | 🟡 P2 | pequeno | `plan-to-pipeline.ts:747` |
| A14 | Época abortada não aterrissa nada | 🟡 P2 | médio | `dev-driver.ts:1048` |
| A15 | Sem teto de custo | 🟡 P2 | pequeno | `dev-driver.ts:1039` |
| A16 | `restatedGoal` é um check que ninguém lê no caminho padrão | 🟡 P2 | pequeno | `dev-driver.ts:987` |
| A17 | Resume é por época; as peças para retomar a execução já existem | 🟡 P2 | médio | `dev-driver.ts:1010` |

E, antes de tudo: **§2 lista o que o huu já acerta e não deve ser mexido.** Boa
parte do modo DEV está alinhada com o que a indústria convergiu, às vezes por
caminho independente. A auditoria não é um pedido de reescrita.

---

## 1. O que o estado da arte convergiu

Cada item abaixo é uma afirmação que sobreviveu a três verificadores
adversariais independentes. Fonte primária entre parênteses.

### 1.1 O harness são três coisas, girando um loop adaptativo — não um pipeline

> "Claude Code serves as the **agentic harness** around Claude: it provides the
> tools, context management, and execution environment that turn a language
> model into a capable coding agent." … "gather context, take action, verify
> results. These phases blend together." … "Claude decides what each step
> requires based on what it learned from the previous step."
> — [code.claude.com/docs/en/how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works)

Skills, MCP, hooks e subagentes são explicitamente "uma camada em cima do loop",
não substitutos dele. E o loop é **dirigível em voo**: `Esc` cancela a ferramenta
em execução; uma correção digitada é injetada **sem** parar a ferramenta, e lida
quando a ação corrente termina.

Ressalva do próprio verificador: a Anthropic enumera três componentes mas nunca
declara a lista exaustiva. E a orientação separada dela para agentes de longa
duração descreve, sim, uma estrutura de duas fases (inicializador → agente de
código) — para runs do Agent SDK que atravessam várias janelas de contexto.
Ou seja: o pipeline determinístico não é herético; ele é o que se faz quando o
horizonte excede uma janela. Que é exatamente o caso do modo DEV.

### 1.2 Contexto é recurso escasso, não capacidade a preencher

> "as the number of tokens in the context window increases, the model's ability
> to accurately recall information from that context decreases"; "LLMs have an
> 'attention budget'"; "Context, therefore, must be treated as a finite resource
> with diminishing marginal returns"; o objetivo é "the smallest possible set of
> high-signal tokens".
> — [Anthropic, *Effective context engineering*](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

Replicado por terceiro: Chroma mediu queda de 30–50% de acurácia em 18 modelos
de fronteira **antes** dos limites documentados de janela, sem exceção. É eixo de
**comprimento**, distinto do *lost-in-the-middle* (eixo posicional).

Nota de incentivo, levantada pelos verificadores: a afirmação vai **contra** o
interesse comercial de vender janela de 1M — o que enfraquece a leitura de
marketing.

### 1.3 Resultado de ferramenta precisa de orçamento explícito e por ferramenta

> "For Claude Code, we restrict tool responses to 25,000 tokens by default."
> — [Anthropic, *Writing tools for agents*](https://www.anthropic.com/engineering/writing-tools-for-agents)

E o tratamento do estouro **varia por ferramenta**: `Read` pagina ("PARTIAL
view") ou erra pedindo `offset`/`limit`; MCP erra duro; `Bash` grava a saída
completa em arquivo e devolve o caminho + um preview (30.000 chars default,
teto 150.000); `Glob` corta em 100 arquivos com flag de truncamento. Tudo
configurável (`MAX_MCP_OUTPUT_TOKENS`, `BASH_MAX_OUTPUT_LENGTH`).

A regra transferível **não** é "trunque tudo em 25k". É: *toda ferramenta tem um
orçamento documentado e um caminho de estouro gracioso*.

### 1.4 Ferramenta é superfície de curadoria de contexto, não só de capacidade

> "tool implementations should take care to return only high signal information
> back to agents"; use `name`/`file_type`/`image_url` em vez de `uuid`/
> `mime_type`/`256px_image_url`; embarque "pagination, range selection,
> filtering, and/or truncation with sensible default parameter values".
> Racional: "LLM agents have limited context … whereas computer memory is cheap
> and abundant."

Quem é dono do orçamento de tokens é o **autor da ferramenta**, não o agente.

### 1.5 Compactação é em camadas, com política de guarda explícita — e com disjuntor

Ordem verificada, literal: "It clears older tool outputs first, then summarizes
the conversation if needed." A sumarização "preserves architectural decisions,
unresolved bugs, and implementation details while discarding redundant tool
outputs", e o agente segue "with this compressed context **plus the five most
recently accessed files**".

O modo de falha tem nome próprio na documentação do fornecedor: "overly
aggressive compaction can result in the loss of subtle but critical context".

E — o achado mais transferível de todos:

> "detects when context refills to the limit immediately after compacting
> **three times in a row** and stops with an actionable error instead of burning
> API calls."
> — [CHANGELOG v2.1.89 / troubleshooting](https://code.claude.com/docs/en/troubleshooting)

Disjuntor com limiar publicado, que **falha alto para o operador e não
auto-cura**: a recuperação é humana. É o padrão anti-tempestade-de-retry com
número em cima.

### 1.6 Restrição persistente vive em ARQUIVO — e precisa ser reinjetada

> "detailed instructions from early in the conversation may be lost. Put
> persistent rules in CLAUDE.md rather than relying on conversation history."
> (dito duas vezes na mesma página)

Mas o mesmo documento lista `CLAUDE.md` como morando **dentro** da janela de
contexto, e o issue tracker registra ele sendo sumarizado embora ou ignorado
depois da compactação. Ou seja: **arquivo é mitigação, não imunidade**. Harness
durável **reinjeta** a regra depois da compactação (seção "Compact
Instructions", hooks) em vez de assumir que uma carga única persiste.

### 1.7 Rascunho em arquivo e artefato de to-do são o que sobrevive ao reset

> "Structured note-taking … the agent regularly writes notes persisted to memory
> outside of the context window"; "Like Claude Code creating a to-do list, or
> your custom agent maintaining a NOTES.md file"; "**Without any prompting about
> memory structure**, it develops maps of explored regions"; "After context
> resets, the agent reads its own notes and continues multi-hour training
> sequences."

Duas qualificações que os verificadores exigiram: (a) a Anthropic lista
compactação, notas estruturadas **e** subagentes como três técnicas **co-iguais**
para horizonte longo — nota não substitui compactação; (b) o exemplo (Claude
Plays Pokémon) é demo de fornecedor, não estudo controlado.

Nota de currency: `TodoWrite` foi substituído por `Tasks`
(`TaskCreate`/`TaskUpdate`/…) por volta de 2026-05-15. O mecanismo continua; o
nome mudou.

### 1.8 Montagem de contexto é HÍBRIDA — e o índice pré-computado foi testado e abandonado

> "CLAUDE.md files are naively dropped into context up front, while primitives
> like glob and grep allow it to navigate its environment and retrieve files
> just-in-time, effectively bypassing the issues of stale indexing and complex
> syntax trees."

A intencionalidade é fechada por fonte independente: Boris Cherny, criador do
Claude Code — *"Early versions of Claude Code used RAG + a local vector db, but
we found pretty quickly that agentic search generally works better"*, com um
engenheiro da Anthropic acrescentando *"agentic search outperformed it by a
lot"*.

Estreitamento exigido pelos verificadores: **não** reformule isso como "designs
RAG-first estão errados". A própria Anthropic diz que o ótimo é dependente da
tarefa e nomeia o custo (exploração em runtime é mais lenta e exige ferramenta
opinativa para o agente não perseguir becos).

### 1.9 Delegação e escopo de capacidade são impostos na camada de FERRAMENTA

O opencode é o exemplo mais limpo: dois níveis (primary/subagent), e a
identidade do papel **é** um perfil de permissão — General (tudo), Explore
(rápido, somente leitura), Scout (docs externas, somente leitura) — sobre um
tri-estado por ferramenta (`ask`/`allow`/`deny`) cobrindo `read`, `edit`,
`glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `todowrite`,
`question`, `webfetch`, `websearch`, `doom_loop`, `lsp`, `skill`.

A imposição é **pré-execução**, não conselho:

```ts
if (rule.action === "deny") return yield* new PermissionV1.DeniedError(...)
```

`permission.task` usa glob (última regra que casa vence) para controlar quais
subagentes um agente pode gerar, e negações do pai propagam para a sessão do
filho (`deriveSubagentSessionPermission()`). A modelagem de contexto — remover a
ferramenta da descrição — é camada **em cima** da negação dura, não no lugar
dela.

Ressalva honesta: a imposição tem furos transitivos documentados (issue #32024,
subagentes contornando `deny` de `read`/`grep` em v1.16.2). Reporte como design
e implementação corrente, não como garantia.

### 1.10 Sumarização é uma IDENTIDADE de agente, com ferramentas negadas

O opencode embarca `compaction`, `title` e `summary` como agentes de sistema
ocultos, com prompt próprio, permissão própria e resolução de modelo própria:

```ts
compaction: { mode: "primary", native: true, hidden: true,
              prompt: PROMPT_COMPACTION,
              permission: merge(defaults, fromConfig({"*":"deny"}), user) }
```

`{"*": "deny"}` — **todas** as ferramentas negadas. A saída é etiquetada
`agent: "compaction", summary: true`.

### 1.11 Modelo por papel é indireção de CONFIG, não escolha em contexto

No OMO, a ferramenta `delegate_task` **não tem parâmetro `model`** — o LLM
estruturalmente não consegue nomear um modelo. Ele declara uma **categoria**, e
uma tabela versionada e coberta por testes de regressão resolve categoria →
(provider, modelo, variante), com **cadeias de fallback ordenadas**:

> `ultrabrain` = três degraus, todos `gpt-5.6-sol` variante `max`, diferindo só
> no **provider**; `visual-engineering` = `claude-opus-5` max → `kimi-k3` max →
> `glm-5.2` max → sol medium.

E as rotas são fixadas por teste: `expect(chain).toEqual([...])`.

### 1.12 Multi-agente peer-to-peer sai DESLIGADO, nos dois harnesses maximalistas

OMO Team Mode: `enabled: z.boolean().default(false)`, máximo 8 membros / 4 em
voo, e o README diz literalmente "**Off by default. Enable it when you want
it.**". O equivalente no Claude Code exige
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` e é rotulado *token-intensive*.

Ressalva: isso é evidência de **cautela e custo**, não medição controlada de que
multi-agente piora. Nenhum dos dois publica o ponto de cruzamento. O debate
Cognition × Anthropic frequentemente citado **não produziu nenhuma afirmação
verificada** nesta passada.

### 1.13 Correção de fato: "OMO" não é do opencode

O pedido original falava do "OMO do opencode". A pesquisa desambiguou:

- **`OMO` = oh-my-openagent** (`github.com/code-yeongyu/oh-my-openagent`), um
  harness maximalista de terceiro **por cima** do opencode — pacotes
  `omo-opencode` e `@oh-my-opencode/*`, 11 agentes, 54+ hooks de ciclo de vida,
  5 MCPs embutidos, roteamento por categoria, Team Mode.
- **opencode** (hoje `anomalyco/opencode`, antes `sst/opencode`) é o substrato
  enxuto: primary/subagent, permissões declarativas por ferramenta, agentes de
  sistema ocultos para compactação/título/sumário.

Confiança média: a relação de camadas foi inferida de nomes de pacote e do
enquadramento do README, não de uma frase explícita. Vale uma confirmação nos
docs de instalação do OMO antes de citar isso como fato firme.

---

## 2. O que o huu já acerta (não mexer)

Uma auditoria que só lista defeitos mente por omissão. Estes pontos estão
alinhados com §1, alguns por caminho independente:

- **Disjuntor com o mesmo limiar.** `MAX_CONSECUTIVE_EPOCH_FAILURES = 3`
  (`dev-driver.ts:121`) foi adotado explicitamente do
  `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` do Claude Code, pelo mesmo incidente.
  §1.5 confirma o número e o racional (falhar alto em vez de queimar chamadas).
- **Memória em arquivo como espinha dorsal.** Atlas, task specs, findings
  shards, digest, journal — tudo em disco, tudo committado. É exatamente §1.7,
  e o huu vai além do NOTES.md ao dar **um arquivo por escritor**
  (`dev-protocol.ts:39-47`), que é o que permite uma onda paralela mergear sem
  conflito.
- **Fronteira estática/dinâmica de prompt no planner.** `DYNAMIC_BOUNDARY`
  (`planner-prompts.ts:279`) separa prefixo cacheável de sufixo por época,
  declaradamente inspirado no `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` do Claude
  Code. Certo. (O defeito é não fazer isso nos prompts dos passos — A13.)
- **Roteamento de modelo por papel.** `DevModelPolicy` com `planner`/`recon`/
  `worker`/`critic`/`reporter`/`judge`/`integration`, e um papel não nomeado
  **omite** o campo em vez de inventar um default. É a direção de §1.11 (falta
  a cadeia de fallback — A22, dobrado em §4).
- **Modelo escreve CONTEÚDO, huu escreve ESTRUTURA.** Nem
  `KnowledgeRequestSchema` nem `DevPlanSchema` carregam `steps`, `dependsOn` ou
  caminho de arquivo. O planner não consegue emitir um grafo inválido porque não
  consegue emitir grafo. Isso é mais forte que qualquer harness pesquisado.
- **`unknowns` obrigatório enquanto `facts` e `sources` têm default.**
  (`knowledge-schema.ts:136`) A assimetria é deliberada e correta: um agente sem
  onde dizer "não consegui verificar" escreve enchimento confiante.
- **Fronts não conversam.** As frentes são partições de arquivo, não pares
  negociando. Pelo mapa de §1.12, o huu está no quadrante
  orchestrator-worker — o lado barato —, não no swarm. Correto.
- **Default forward em todo juiz** (ADR 0003), com `fromJudge: false` gravado na
  evidência para que uma aprovação silenciosa seja visível depois.
- **Isolamento por worktree do git.** Cada agente em cópia isolada, merge
  determinístico ascendente. É o modelo de sandbox que a literatura pede, e o
  huu o tem desde antes do modo DEV.

---

## 3. Os erros

### 3.1 Bloqueadores (P0)

#### A1 — O cabeçalho legado de "refactoring orchestrator" contradiz todo prompt do modo DEV

`agents-md-generator.ts:8-103` gera o cabeçalho que `buildAgentMessageHeader`
(`backends/_shared/build-message.ts:14-30`) prepende à **primeira mensagem de
todo agente pi** (`backends/pi/factory.ts:219-227`). Ele tem dois ramos, e os
dois estão errados para o modo DEV.

**Ramo `files.length > 0`** — todo agente de swarm, porque em `scope: 'memory'`
`task.files = [caminho-do-spec]` (`index.ts:2162`, `index.ts:2458`):

```
# Agent 7 — Refactoring Session
## Assigned Files
- .huu/dev/<sid>/epoch-1/api/T-001.md
## Rules
1. ONLY modify files from your assigned list above.
2. Do NOT create new files unless absolutely necessary for the refactoring.
3. Do NOT modify files outside your assignment — other agents handle those.
4. Do NOT run git commands — the orchestrator manages all Git operations.
7. Maintain or improve test coverage if tests exist.
```

Contradições, todas na posição de maior prioridade da mensagem:

| O cabeçalho manda | O modo DEV manda | Onde |
|---|---|---|
| "ONLY modify files from your assigned list" → o **spec** | "Never edit another task's spec" | `dev-protocol.ts:263` |
| "Do NOT create new files unless absolutely necessary" | frentes de feature existem para criar arquivos | — |
| "Do NOT run git commands" | "5. Commit your work." | `plan-to-pipeline.ts:676` |
| "Maintain or improve test coverage" | "THE TEST FILES ARE FROZEN" | `plan-to-pipeline.ts:720` |
| "Refactoring Session" | a época constrói | — |

A lista de propriedade real está **dentro** do spec, sob `## Files this task
OWNS`. O cabeçalho aponta para o continente, não para o conteúdo.

**Ramo `files.length === 0`** — crítico, juiz, recon global, auditor de plano,
reporter, seal; todo papel somente-leitura:

```
## Your Role
... you may read and modify any file in the project necessary to complete the task.
## Rules
2. You may read any file for context and modify any file necessary.
## Workflow
3. Apply changes using the edit tool.
```

Logo abaixo disso, o crítico lê "You do NOT write code, do NOT commit, do NOT
push. You report." (`review-agent.ts:356`); o auditor de plano lê "Report, never
fix" (`plan-to-pipeline.ts:850`); o juiz idem (`check-evaluator.ts:102`).

**O harness concede e incentiva escrita exatamente para os papéis que o método
define como somente-leitura, e faz isso antes do prompt do papel.**

§1.9 é a resposta: a fronteira não pertence à prosa.

*Correção:* reescrever `agents-md-generator.ts` para um cabeçalho neutro
(papel, worktree, branch, sem regras de refactor), e derivar a lista de
propriedade do spec via `parseOwnedPaths` — que já existe
(`review-agent.ts:497`) — em vez de `task.files`.

#### A2 — Nenhum papel tem restrição de ferramenta

```ts
// backends/pi/factory.ts:170
// tools omitted → default built-ins (read, bash, edit, write) are enabled.
```

Todo agente do modo DEV — crítico, juiz, auditor de plano, recon, reporter,
consolidador do digest — recebe `read + bash + edit + write`. "Escreva só sob
`.huu/`", "report, never fix", "os testes estão congelados": **prosa, não
permissão.**

Consequência concreta: um crítico pode corrigir o código que está auditando, e a
rodada seguinte revisa o próprio conserto. `docs/dev-mode.md:466` já admite isso
para o congelamento de testes ("judge-enforced, not filesystem-enforced") — o
que a auditoria acrescenta é que vale para **todas** as fronteiras, e que o SDK
já aceita o parâmetro.

*Correção:* passar `tools` explícito por papel. Mínimo viável: `[read, bash]`
para crítico / juiz / auditor de plano; `[read, bash, edit, write]` para worker
e recon. Isso é §1.9 e §1.10 aplicados.

#### A18 — `/skill:project-router` é prefixado em todo prompt, e o pi está com skills desligadas

`dev-protocol.ts:17` define `ROUTER_PREFIX = '/skill:project-router'`, aplicado
a todo prompt de todo passo quando o projeto tem knowledge surface
(`dev-driver.ts:820`, `:973`; `plan-to-pipeline.ts:1097-1103`).

Mas o loader hermético — que é o **default** (`pi-runtime-config.ts:10`) — passa
`noSkills: true` incondicionalmente (`hermetic.ts:155`), exatamente a flag que
desliga a descoberta de `.agents/skills` do projeto (`hermetic.ts:8-9`;
`docs/pi-coding-agent.md:92` — "Extensões/skills/prompts/temas | desligados").

A primeira linha de cada prompt do modo DEV é um comando que não resolve. O
contorno (`knowledgeSummary` manda "read the relevant ones") ainda funciona,
porque o agente tem `read` — mas a invocação em si é morta.

*Correção:* uma das duas — habilitar skills **escopadas ao worktree** no loader,
ou remover o prefixo e trocá-lo por leitura explícita do `catalog.md`. A segunda
é mais barata e mais determinística.

### 3.2 Estruturais (P1)

#### A8 — A disjunção de write-set nunca é imposta

Três camadas, nenhuma bloqueante:

- `checkWritePartition` roda **depois** do landing, explicitamente advisory
  (`dev-driver.ts:1101-1114`);
- `writeSetViolations` é instrumentação declarada (`review-agent.ts:489-495`);
- com `--plan-review`, a disjunção é auditada por um **LLM** cujo default é
  forward (`plan-to-pipeline.ts:839`, `:887`).

Mas o huu já sabe ler as declarações: `parseOwnedPaths` (`review-agent.ts:497`)
e `scanSpecs` (`dev-driver.ts:325`). **A união dos write-sets antes do fan-out é
~20 linhas de TypeScript determinístico.** Hoje essa verificação existe apenas
dentro de um prompt — o oposto exato da doutrina que o resto do modo DEV segue.

É o achado com a melhor relação valor/custo do documento.

#### A6 — O digest é escrito por um agente irrestrito, sem verificação nenhuma

A Fase A não tem CheckStep por decisão explícita
(`knowledge-to-pipeline.ts:27-32`) — decisão defensável. O problema é outro: o
fallback de `readKnowledgeDigest` (`knowledge-blackboard.ts:442`) só dispara
quando o digest está **ausente ou vazio**, nunca quando está **errado**. Um
único agente, com `edit` e `write` liberados, escreve a única coisa que o
planner verá do repositório.

E os briefs **já são estruturados e validados** — `KnowledgeBriefSchema` exige
`gapId`/`kind`/`confidence`/`answer`/`facts`/`sources`/`unknowns`. O digest
poderia ser **montado em TypeScript** a partir deles, com o corte por orçamento
determinístico, e a passada de LLM viraria refinamento opcional.

É a doutrina do próprio projeto — "o modelo escreve CONTEÚDO, huu escreve
ESTRUTURA" (`knowledge-schema.ts:1-10`) — violada no ponto do fluxo em que ela
mais importa. E §1.10 acrescenta a outra metade: quando a sumarização é feita
por LLM, ela deve ser uma **identidade com ferramentas negadas**, não um work
step comum.

#### A3 — O crítico nunca lê o que o worker disse

`buildReviewUserPrompt` (`review-agent.ts:427-473`) monta o contexto do crítico
com `review.prompt`, `<verify-commands>`, o caminho do spec, o `$hint` e as
severidades bloqueantes. **A saída do worker não entra.** O crítico reconstrói a
intenção a partir do diff.

Isso empurra na direção do modo de falha que o próprio design diz combater —
rejeição espúria por requisito inventado (`review-agent.ts:324-349`).

*Correção:* um bloco `<worker-report>` com a última mensagem do worker, ou seu
findings shard.

#### A4 — Cada rodada de crítica é um agente novo, sem memória da anterior

`review-loop.ts:138-171` chama `runReviewRound` por rodada, e
`review-agent.ts:164` cria um agente novo a cada chamada. A rodada 2 sabe que é
"round 2 of 2" (`review-agent.ts:352`) mas **não recebe os achados da rodada 1**.

O crítico portanto não verifica se o que pediu foi feito, e pode levantar
achados novos na última rodada — que estouram o cap e viram waive/hold. É o
padrão "trave móvel", e ele consome o único turno de reparo disponível
(`DEFAULT_REVIEW_MAX_ROUNDS = 2` significa exatamente **uma** chance de
conserto).

*Correção:* injetar os achados da rodada anterior com a instrução "verifique se
foram endereçados; não levante achados novos nesta rodada".

#### A23 — O huu escuta um evento de compactação que o pi não emite (NOVO)

Descoberto ao implementar, não na leitura. `event-mapper.ts:113` tinha
`case 'auto_compaction_start'`. O pi 0.73.1 declara, em `AgentSessionEvent`:

```ts
| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
| { type: "compaction_end"; …; willRetry: boolean }
```

O nome nunca bateu. O `case` era **código morto**: um card cujo contexto estava
sendo compactado repetidamente não produzia sinal nenhum — nem a linha de aviso
que o próprio comentário prometia. A auditoria dizia "o huu apenas loga"; a
verdade era pior — ele nem logava.

#### A11 — Nada gerencia contexto dentro de um card

O único limite é relógio: `DEFAULT_CARD_TIMEOUT_MS = 600_000`,
`DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS = 300_000` (`types/pipeline.ts:423-424`).
Sem teto de turnos, sem orçamento de tokens por card, sem política de
compactação — e, por A23, sem sequer perceber que a compactação aconteceu.

A mitigação existe, mas só como prosa — e é a prosa certa:

> "Tool results may be compacted away later; what lands in the files you write
> (the atlas, the task specs, your findings shard) is the memory that survives."
> — `plan-to-pipeline.ts:372`, `:380`

§1.6 diz que isso é mitigação, não imunidade, e que a peça que falta é
**reinjeção**. §1.5 dá o disjuntor com número: três compactações seguidas sem
progresso ⇒ parar e falhar alto.

*Correção mínima:* contar `auto_compaction_start` por card; ao primeiro evento,
reprompt curto com o caminho do spec + a regra de propriedade; ao terceiro,
falhar o card com erro acionável em vez de deixá-lo girar até o timeout.

#### ~~A19 — Nenhum orçamento de resultado de ferramenta~~ (ACHADO ERRADO)

**Retratado em 2026-08-01, ao implementar.** A afirmação era que o huu não tem
orçamento de resultado de ferramenta. O pi tem, e sempre teve:

```
node_modules/@mariozechner/pi-coding-agent/dist/core/tools/truncate.d.ts
  DEFAULT_MAX_LINES = 2000 · DEFAULT_MAX_BYTES = 50KB · GREP_MAX_LINE_LENGTH = 500
```

`read` trunca pela cabeça e instrui o modelo a paginar com `offset`/`limit`;
`bash` trunca pela cauda **e grava a saída completa num arquivo temporário,
devolvendo o caminho** — exatamente o padrão que §1.3 credita ao Claude Code.

O que a auditoria deveria ter dito, e que a investigação encontrou no lugar:
**`grep`, `find` e `ls` existem no SDK e NÃO vêm habilitados**
(`ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls"`; o
default é só os quatro primeiros). Todo agente do huu busca via `bash`. Habilitá-los
é uma linha — mas é uma EXPANSÃO de capacidade, não uma correção, e mudaria o
system prompt e o perfil de token de todo pipeline existente sem opção nenhuma.
Fica como item próprio, com justificativa própria. Ver §7.

#### A7 — Conhecimento não acumula entre épocas

`readKnowledgeDigest(cwd, paths, epoch)` lê só a época corrente. As
`BASELINE_GAPS` só rodam na época 1 e são substituídas pelo
`DELIVERED_VS_PLANNED_GAP` a partir da 2 (`knowledge-blackboard.ts:159`).

Só `verifyCommands` persiste no state (`dev-driver.ts:700-712`). Stack,
convenções, landmines: recomprados ou perdidos. **Na época 3 o planner sabe
menos do repositório do que sabia na época 1.**

O prompt de consolidação já descreve as quatro operações certas — DEDUPE,
CONTRADICTIONS, PRUNE, DRIFT (`knowledge-to-pipeline.ts:234-240`) — mas as
aplica só dentro de uma época. Aplicá-las a um `knowledge/accumulated.md` de
sessão é reusar o que já está escrito.

#### A12 — Nenhum artefato de progresso durante a tarefa

O findings shard é escrito **depois** do trabalho: "AFTER your work: write YOUR
OWN file" (`dev-protocol.ts:285`). Se o card estoura os 10 minutos, o shard está
vazio e a época perde tudo que aquele agente descobriu.

§1.7 é explícito sobre isso ser o mecanismo que sobrevive a resets, e a forma
canônica é o **to-do vivo**, atualizado durante, não um relatório final.

*Correção:* tornar o shard incremental (append por descoberta), ou exigir um
`progress.md` por tarefa marcado a cada item de "Done when".

### 3.3 Economia e observabilidade (P2)

#### A5 — `KNOWLEDGE_DIGEST_MAX_CHARS = 6000` é arbitrário

`knowledge-blackboard.ts:53`. Todo o conhecimento do repositório cabe em 6.000
caracteres, divididos por até `DEV_MAX_GAPS = 12` lacunas → ~500 chars (~125
tokens) por lacuna.

O planner é cego por design — hipótese instrumentada e documentada, e §1.2 dá
apoio parcial a ela (o alvo é o menor conjunto de alto sinal, não o maior). Mas
o teto não deriva de nada: não é fração da janela do modelo planner, não foi
medido. É a constante com maior chance de estar errada em todo o modo DEV.

*Correção:* derivar da janela do modelo planner (5–10%), com piso.

**Tensão honesta a registrar:** §1.8 é a única convergência da indústria que
aponta contra o orquestrador cego. Claude Code testou e **abandonou** o índice
pré-computado porque a busca agêntica ganhou; o huu faz o planner ler um resumo
pré-computado por outros agentes. Não são a mesma coisa (o nosso resumo é
escrito por agentes que tinham shell, e é fresco por época), e a Anthropic
qualifica que o ótimo depende da tarefa. Mas o `docs/dev-mode.md` já chama isso
de "hipótese instrumentada" — esta pesquisa **não** encontrou apoio externo para
ela, e encontrou o caso mais forte publicado do lado oposto. Isso é informação
para o instrumento, não veredito.

#### A9 — Falha da requisição de conhecimento é fail-closed, contra a doutrina do resto

`dev-driver.ts:763-767`: se `planKnowledge` falha, a sessão morre com
`planner-failed`. Mas as `BASELINE_GAPS` são escritas por **huu**, em TypeScript
(`mergeBaselineGaps`) — havia fallback disponível e não usado.

Todo o resto do modo DEV é forward-default (juiz que falha aprova, crítico que
falha libera, digest ausente cai para os shards). Este é o único ponto
fail-closed, e é o que menos precisa ser.

Somado: `structured-invoke.ts:102-107` faz **um** round de reparo e a segunda
falha mata a sessão. A justificativa está escrita ("um segundo reparo compra uma
resposta errada mais cara"), mas o custo do outro lado é a sessão inteira; uma
terceira tentativa a `temperature: 0` custa uma chamada.

#### A13 — O cache de prompt é destruído exatamente onde o custo está

`DYNAMIC_BOUNDARY` (`planner-prompts.ts:279`) faz a coisa certa nas **duas**
chamadas do planner. Mas os prompts compilados dos passos intercalam fixo e
variável livremente (`plan-to-pipeline.ts:747-759`):

```
taskWorkPreamble(epoch, frontId)   ← variável (época + frente)
front.workPrompt                    ← variável
WORK_IMPLEMENTATION_BLOCK           ← fixo
devFindingsProtocol(epoch, null)    ← variável (época)
DEV_SKIP_RULE                       ← fixo
```

*Correção:* ordenar fixo-primeiro em todo prompt de passo.

**Correção da estimativa, 2026-08-01.** A auditoria escreveu "economia
mensurável". Ao medir, não é. O cabeçalho por agente
(`agents-md-generator.ts`) precede o prompt do passo e carrega `agentId`,
`stageName` e a lista de arquivos, então o prefixo de fato compartilhado entre
dois agentes é `"# Agent "` — oito caracteres. Reordenar o prompt do passo não
move isso: no melhor caso, com o cabeçalho também reordenado, o prefixo
compartilhável fica em ~1,8 kB (~450 tokens) e só no PRIMEIRO turno, contra
agentes que queimam dezenas ou centenas de milhares de tokens.

Vale fazer mesmo assim, mas pela outra razão: um **invariante estrutural** com
teste que o fixa — nada específico da época, da frente ou do agente pode
aparecer acima da fronteira. Isso mantém a opção do cache aberta e impede a
deriva que já tinha acontecido. Não venda como economia.

#### A14 — Época abortada não aterrissa nada

`dev-driver.ts:1048-1069`. A decisão é justificada — os agentes foram cortados
no meio, nenhum juiz viu — mas na prática é tudo-ou-nada: quem aperta stop perde
até o merge das frentes que **já haviam passado pelo juiz**.

§1.1 mostra o outro modelo: interrupção que cancela a ação corrente sem destruir
o trabalho concluído, e correção injetada sem parar a ferramenta em voo.

*Correção:* um "parar depois que a stage corrente aterrissar", além do abort
duro.

#### A15 — Sem teto de custo

`costUsd` é coletado por época (`dev-driver.ts:1039-1040`) e nunca vira condição
de parada. O breaker conta falhas (3) e o backstop conta épocas
(`DEV_UNBOUNDED_EPOCH_BACKSTOP = 50`). Uma sessão desatendida pode gastar 50
épocas × 2 runs × N agentes. O número já está na mão; falta um
`stoppedBecause: 'cost-ceiling'`.

#### A16 — `restatedGoal` é um check que ninguém lê no caminho padrão

`dev-driver.ts:987-989` loga e adiciona a `gateWarnings`, que só é apresentado
com `--approve-each`. Como `--autonomous` é o **default**, no caminho padrão o
check de compreensão não muda decisão nenhuma — exatamente a crítica que o
projeto faz à instrumentação que ninguém lê.

#### A17 — Resume é por época; as peças para retomar a execução já existem

`readDevState` retoma na fronteira de época. Um crash na Fase C com 20 agentes
prontos refaz conhecimento + plano + tudo. Mas:

- o pipeline compilado **já é persistido** (`dev-driver.ts:1010-1018`);
- as sessões pi **já têm** checkpoint/restore (`factory.ts:94-103`), usados só
  pelo memory guard dentro de um run.

Falta ligar as duas pontas.

#### A22 — Roteamento de modelo sem cadeia de fallback

`DevModelPolicy` resolve papel → id, e `preflightDevModelPolicy` recusa um id
desconhecido na borda. Bom. Mas é **um** id por papel: um provider fora do ar
derruba o papel inteiro. §1.11 mostra a forma madura — cadeia ordenada de
degraus `{providers[], model, variant}`, fixada por teste de regressão.

O huu já tem key pool e rotação (`key-rotation.test.ts`); falta o mesmo para
modelo.

---

## 4. Plano de correção, em ondas

Cada onda é fechada, testável e não depende da seguinte.

**Onda 1 — parar de contradizer o próprio método** (P0, ~1 dia)

1. `agents-md-generator.ts`: cabeçalho neutro por papel; propriedade derivada de
   `parseOwnedPaths(spec)`, não de `task.files`. Remover as regras de refactor.
2. `tools` explícito por papel no `piAgentFactory` (`[read, bash]` para crítico /
   juiz / auditor de plano / reporter).
3. Decidir A18: habilitar skills escopadas ao worktree **ou** remover o prefixo.
   Não deixar como está.

*Prova:* um teste que compila uma época e afirma que nenhum prompt de papel
somente-leitura contém a string `edit tool`, e que o cabeçalho não contém
`Refactoring`.

**Onda 2 — trocar prompt por mecanismo onde já dá** (P1, ~2 dias)

4. Disjunção de write-set determinística antes do fan-out (A8), reusando
   `parseOwnedPaths`. Bloqueia; não instrumenta.
5. Digest montado em TypeScript a partir dos `*.json` validados; passada de LLM
   vira refinamento opcional (A6).
6. `<worker-report>` no prompt do crítico (A3) + achados da rodada anterior na
   rodada seguinte (A4).

*Prova:* `plan-to-pipeline.test.ts` ganha um caso com dois specs declarando o
mesmo arquivo e afirma que a compilação recusa.

**Onda 3 — economia de contexto** (P1, ~3 dias)

7. Contador de `auto_compaction_start` por card + reinjeção do spec no primeiro
   evento + falha acionável no terceiro (A11 + §1.5).
8. Orçamento de resultado de ferramenta (A19) — começar por `bash`, que é o
   maior emissor.
9. Shard incremental / `progress.md` por tarefa (A12).
10. Ordenar fixo-primeiro nos prompts dos passos (A13).

**Onda 4 — horizonte longo** (P2)

11. `knowledge/accumulated.md` de sessão com as quatro operações (A7).
12. Teto de custo (A15) e derivação do teto do digest (A5).
13. Retomada de execução de época (A17) e parada graciosa (A14).
14. Cadeia de fallback de modelo por papel (A22).

---

## 5. O que NÃO copiar

- **Índice pré-computado / RAG.** Testado e abandonado no Claude Code (§1.8). O
  huu não tem, e não deve ganhar.
- **Multi-agente peer-to-peer.** Sai desligado nos dois harnesses maximalistas
  (§1.12). As frentes do huu são partições, não pares — manter assim.
- **O número 6,7% → 68,3% do hashline.** Vem do benchmark do próprio autor da
  técnica, em tarefas sintéticas de reversão de mutação em React; uma replicação
  independente achou de +48,3% a −20,7% conforme o modelo. **Adote a ideia**
  (rejeitar edição quando o arquivo mudou desde a última leitura — o huu não
  controla o edit tool, mas o pi sim); **não cite a magnitude.**
- **Framework de agentes.** A afirmação da Anthropic sobre isso foi *refutada*
  nesta passada (voto 1-2) por questões de escopo e currency — não use como
  argumento de autoridade em nenhuma direção.

---

## 6. Lacunas desta pesquisa (leia antes de citar)

Honestidade sobre o instrumento, no mesmo espírito do `unknowns` obrigatório dos
briefs:

1. **Cobertura.** Só Claude Code, opencode e OMO produziram afirmações
   sobreviventes. **Zero** claims sobreviveram para Codex CLI, Aider, Cline/Roo
   Code, Cursor, Amp, OpenHands, SWE-agent (e o paper do Agent-Computer
   Interface), Devin, Jules, Gemini CLI e Factory Droid. Este documento é uma
   leitura profunda de três harnesses, **não** um levantamento de paisagem.
2. **Os temas transversais mais próximos do huu não produziram evidência.** Nada
   verificado sobre loops de verificação, confiabilidade de LLM-as-judge,
   bajulação de juiz, degradação de generator-critic, cascata de erro entre
   estágios, agentes fabricando conclusão, decomposição excessiva, blackboard,
   saída estruturada entre estágios, checkpointing ou economia de tokens. **A
   ausência é de evidência verificada nesta passada, não evidência de ausência**
   — e é exatamente o conjunto que mais importaria para o modo DEV.
3. **Refutado ≠ falso.** Dez claims caíram, e várias são paráfrases razoáveis do
   *Building effective agents* da Anthropic (workflow × agente, limite de
   iterações, evitar frameworks, sandbox + checkpoint humano). A refutação
   reflete rigor dos verificadores quanto a exagero, currency (o post é de dez/
    2024) ou escopo — não falsidade demonstrada. Perda prática: a filosofia
   "mantenha o agente em um loop principal" e o limite anti-retry-storm **não
   estão** com fonte primária neste documento.
4. **Nenhum dado quantitativo entre harnesses sobreviveu.** O corpus de 70
   harnesses do arXiv caiu 0-3. Não há base empírica verificada para **nenhuma**
   escolha de design aqui. Tudo é evidência de mecanismo e documentação, não
   medição.
5. **Viés de fonte primária de fornecedor.** Os itens 1.1–1.8 são a Anthropic
   documentando o próprio produto. É o nível certo para "como este harness
   funciona" e o errado para "este é o melhor design". As ressalvas dela
   (híbrido depende da tarefa; exploração em runtime é mais lenta; compactação
   agressiva perde contexto crítico) devem viajar junto com os princípios.
6. **Números a reconferir antes de depender:** 25.000 tokens, 30.000 chars, 3
   tentativas de thrashing, 200 linhas/25KB, 8 membros/4 em voo. A superfície
   muda rápido — `TodoWrite` já virou `Tasks`; `sst/opencode` já virou
   `anomalyco/opencode` (sem branch `main`); o `tools` booleano do opencode já
   foi absorvido por `permission` na v1.1.1.

**Perguntas abertas que valem uma segunda passada** (nesta ordem de valor para o
huu):

1. O paper do **Agent-Computer Interface do SWE-agent** — a fonte primária
   original de "o design da interface determina o resultado do benchmark". É a
   evidência mais diretamente aplicável ao modo DEV e não foi coberta.
2. **Confiabilidade de crítico LLM** com número: o `docs/dev-mode.md` cita
   22,5%–91,9% de falso-positivo, e essa pesquisa **não conseguiu confirmar** a
   fonte. Vale isolar.
3. O **repo-map do Aider** como contraexemplo ao abandono de índice
   pré-computado — diretamente relevante ao debate do orquestrador cego (A5).
4. Onde fica o ponto de cruzamento em que multi-agente ganha do loop único.
   Nenhum dos dois fornecedores publica.
5. Se memória em arquivo sobrevive à compactação, e qual estratégia de reinjeção
   funciona (A11 depende disso).

---

## 7. O que foi implementado (2026-08-01)

As quatro ondas de §4 foram executadas. Gate: `npm run typecheck && npm test`
verde em cada onda, mais um `huu dev --stub --epochs=2` end-to-end
(`stoppedBecause: max-epochs`, ambas as épocas com `landedCommit`,
`git status --porcelain` vazio). Baseline 1966 testes → **2031**.

### Onda 1 — pare de contradizer o próprio método

- **A1** — `agents-md-generator.ts` reescrito. Sem moldura de "refactoring", sem
  as regras que brigavam com o modo DEV. O escopo de escrita vem do
  `## Files this task OWNS` do spec, resolvido uma vez em `prepareStageTasks`
  a partir do worktree de integração (`AgentTask.ownedPaths`), com fallback para
  a lista de arquivos quando não há declaração. Papéis somente-leitura recebem
  um bloco `REPORT ONLY` em vez do convite a editar. **Havia zero teste neste
  arquivo** — agora tem nove, cada um fixando uma contradição que chegou a ser
  entregue.
- **A2** — `AgentTask.readOnly` → allowlist de ferramentas do pi
  (`tools?: string[]`, filtro **duro**: o system prompt é reconstruído sem as
  ferramentas ausentes). Aplicado ao **crítico** e ao **juiz**. `bash` fica: os
  dois são obrigados a rodar os comandos do projeto antes de concluir. Não é
  sandbox — `cat > file` ainda escreve — e o código diz isso.
  - **NÃO aplicado** ao auditor de plano, ao consolidador e ao seal: eles
    escrevem seus relatórios. Tirar `write` deles não é endurecimento, é
    quebrar a época. `WorkStep.readOnly` existe como mecanismo público; nenhum
    pipeline embutido o usa ainda.
- **A18** — o prefixo estava morto por **duas** razões independentes:
  `noSkills: true` e o fato de o `_expandSkillCommand` do pi exigir que o texto
  **comece** com `/skill:` (o cabeçalho do huu sempre vem antes). Corrigido dos
  dois lados: `additionalSkillPaths` escopado ao worktree — que `noSkills` não
  suprime — de modo que o pi lista as skills do projeto em `<available_skills>`
  com descrição e caminho, e o prefixo virou um ponteiro curto e determinístico
  em vez de um comando que não resolve.

### Onda 2 — mecanismo no lugar de prompt

- **A8** — `collideDeclaredOwnership` em `orchestrator/write-sets.ts`, executado
  em `prepareStageTasks` **antes** do fan-out e **acumulado por run**, então
  pega a colisão cara: duas frentes paralelas reivindicando o mesmo arquivo.
  Reporta e registra (`OrchestratorState.declaredWriteCollisions` →
  `DevEpochEvidence`); nunca bloqueia. `checkWritePartition` do modo DEV agora
  **delega ao mesmo núcleo** — uma implementação, dois chamadores, impossível
  discordarem sobre os mesmos dois arquivos.
- **A6** — `assembleKnowledgeDigest` monta o digest em TypeScript a partir dos
  shards já validados por `KnowledgeBriefSchema`, na forma exata que o prompt do
  K2 pede. Ordem de leitura: digest do LLM se cobre toda lacuna → montagem
  mecânica → digest incompleto **com as lacunas faltantes nomeadas** → shards
  crus. A terceira camada nasceu de um teste que quebrou: a primeira versão
  descartava um digest utilizável só por não conseguir provar que estava
  completo, transformando resposta parcial em resposta nenhuma.
- **A3/A4** — o crítico recebe `<worker-report>` (delimitado, rotulado como
  DADO e explicitamente incapaz de aprovar um diff — é superfície nova de
  injeção e o prompt trata como tal) e `<previous-round-findings>` com a
  instrução de verificar o que já pediu antes de levantar coisa nova.

### Onda 3 — economia de contexto

- **A23** — nome do evento corrigido (`compaction_start`), com o antigo aceito
  em paralelo.
- **A11** — `AgentEvent` ganhou a variante `compaction`; `AgentStatus.compactions`
  conta. Na **primeira**, o huu re-declara escopo e spec **na mesma sessão** via
  `session.steer()` — entregue depois do turno corrente, sem cancelar nada. Na
  **terceira**, para o card com erro acionável em vez de deixá-lo girar até o
  relógio. Mesmo limiar e mesma razão do breaker de época.
- **A12** — o protocolo do shard passou de "escreva DEPOIS" para "escreva
  ENQUANTO". Limitação honesta: `guard-pause.ts` apaga worktree e branch no
  caminho de falha, então isso compra sobrevivência a compactação e a pausa do
  memory guard, **não** a um timeout. Salvar o shard de um card morto exige um
  `salvagePaths` que não foi feito.
- **A13** — `DEV_STEP_BOUNDARY`; fixo acima, variável abaixo, com teste que fixa
  o invariante. Ver a correção de estimativa acima.
- **A19** — retratado. Ver acima.

### Onda 4 — horizonte longo

- **A7** — `readAccumulatedBriefs` varre os shards de todas as épocas
  anteriores (cada shard carrega o próprio `gapId`, então nada precisa lembrar
  quais lacunas cada época perguntou), dedupe por lacuna com a época mais nova
  vencendo e a substituída **nomeada**. Entra no prompt do planner como bloco
  próprio, com orçamento separado (40% do digest) para não sufocar o briefing
  fresco.
- **A5** — `DevModeConfig.knowledgeDigestMaxChars`. **Não** derivado da janela do
  modelo: derivar mediria o que CABE, não o que AJUDA, e a razão do teto ser
  pequeno é distração, não capacidade. O defeito era o número não poder ser
  movido; agora pode, e o default segue 6000.
- **A15** — `--max-cost=<usd>`, `DevStopReason 'cost-ceiling'`, verificado entre
  épocas (matar swarm vivo perde o trabalho e paga os tokens assim mesmo).
  Conta como parada limpa: o teto que o usuário pediu funcionou.
- **A22** — valores de papel aceitam cadeia por vírgula; o primeiro degrau que o
  registro do pi conhece vence (`pickModelRung`), o preflight só recusa quando
  **todos** os degraus são desconhecidos, e degraus mortos viram aviso nomeado.
  O compilador estampa o degrau sobrevivente, nunca a cadeia.
- **A14** — `gracefulSignal`: pare depois que a época corrente aterrissar. O
  abort duro continua existindo e continua não aterrissando nada.
- **A17** — `DevState.pendingEpoch`. O grafo compilado já era persistido e nunca
  reusado; agora um crash na Fase C retoma a EXECUÇÃO em vez de recomprar
  conhecimento e replanejar. Plano ilegível ⇒ replaneja, nunca recusa.

### Depois do rebase com `main` (mesma data)

O `main` trouxe i18n completo (catálogos en/pt-BR com guarda que **falha** numa
chave ausente) e **doze** metodologias selecionáveis, contra as quatro que a
auditoria conhecia. Três ajustes:

- `--max-cost` entrou em `cli.help` nos dois catálogos. As demais strings novas
  ficam como estão, por consistência: `dev-cli.ts` não é uma superfície
  traduzida, e o `stoppedBecause` é renderizado como CÓDIGO na web — a mesma
  convenção de `card-state.ts`, que devolve códigos em inglês e traduz só na
  borda de renderização.
- O invariante da fronteira de prompt (A13) passou a ser testado com **todas as
  metodologias ligadas**, enumeradas do `DEV_METHODOLOGIES` em vez de escritas à
  mão — cada metodologia injeta texto de prompt, e cada uma é uma chance de
  reintroduzir exatamente a intercalação que a fronteira existe para impedir.
  Uma metodologia nova passa a ser coberta no dia em que é declarada.
- O bloco de uso do CLI agora vem de `methodologyUsageBlock()` (o registro único
  do `main`) em vez da lista fixa de quatro que a auditoria tinha em mãos.

### O que ficou de fora, e por quê

1. **Salvar o findings shard de um card que morreu** (a manchete de A12). Exige
   um `WorkStep.salvagePaths` com `git checkout <branch> -- <glob>` antes de
   `guard-pause.ts` apagar o branch. Não feito.
2. **Habilitar `grep`/`find`/`ls`** para agentes de escrita. É expansão de
   capacidade e mudaria todo pipeline existente sem opção; merece medição
   própria.
3. **`--max-cost` e a parada graciosa na interface web.** Ambos existem no
   driver e no CLI; `dev-manager.ts` ainda não os expõe.
4. **A tensão de §1.8 (orquestrador cego × busca agêntica)** continua aberta.
   Nada aqui a resolve — A7 apenas para de perder o que já foi comprado.

## Referências primárias

- [Claude Code — How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Claude Code — MCP](https://code.claude.com/docs/en/mcp) · [Tools reference](https://code.claude.com/docs/en/tools-reference) · [Troubleshooting](https://code.claude.com/docs/en/troubleshooting)
- [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Chroma — Context Rot](https://research.trychroma.com/context-rot)
- [opencode — Agents](https://opencode.ai/docs/agents/) · [Permissions](https://opencode.ai/docs/permissions/) · [`anomalyco/opencode`](https://github.com/anomalyco/opencode) (branch `dev`)
- [oh-my-openagent (OMO)](https://github.com/code-yeongyu/oh-my-openagent)
- [Can Bölük — The Harness Problem](https://stencil.so/blog/the-harness-problem) · [Geometric AI — AST Edits](https://geometric.ai)

## Documentos internos relacionados

- `docs/dev-mode.md` §Known limits — os custos que o projeto já assumia
- `docs/adr/0003-default-forward-juizes.md` — o default forward, com risco documentado
- `METODO.md` §4 — o diagnóstico anterior, mesmo gênero
- `.agents/skills/running-dev-mode/SKILL.md` — o conhecimento operacional do fluxo
