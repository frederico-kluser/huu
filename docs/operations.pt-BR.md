# Operações · `huu`

> **English:** [docs/operations.md](operations.md)

Como rodar o `huu` em ambientes tipo-produção — modos Docker,
configuração, auto-scaling, controle de custo, isolamento de portas,
FAQ, roadmap.

## Sumário

- [Docker](#docker)
  - [Lifetime e sinais](#lifetime-e-sinais)
  - [Tratamento de VPN / MTU](#tratamento-de-vpn--mtu)
  - [Modo isolated-volume](#modo-isolated-volume)
  - [Compose](#compose)
  - [Docker secrets](#docker-secrets)
  - [Variantes de imagem](#variantes-de-imagem)
  - [Cookbook na imagem](#cookbook-na-imagem)
  - [Não quer Docker?](#não-quer-docker)
- [Configuração](#configuração)
  - [Registry de API keys](#registry-de-api-keys)
  - [Variáveis de ambiente](#variáveis-de-ambiente)
  - [Arquivos escritos pela ferramenta](#arquivos-escritos-pela-ferramenta)
  - [Modelos recomendados](#modelos-recomendados)
- [Concorrência com auto-scaling](#concorrência-com-auto-scaling)
- [Previsibilidade de custo](#previsibilidade-de-custo)
- [Isolamento de portas (visão geral)](#isolamento-de-portas-visão-geral)
- [Convenções visuais](#convenções-visuais)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contribuindo](#contribuindo)

---

## Docker

`huu` roda em Docker por padrão — suas credenciais de shell, `~/.ssh`
e `~/.aws` nunca ficam visíveis pro agente LLM. O caminho recomendado é
**buildar a imagem do source** (zero dependência de registry,
reprodutibilidade total):

```bash
git clone https://github.com/frederico-kluser/huu
cd huu
docker build -t huu:local .
HUU_IMAGE=huu:local huu run pipeline.json
# ou: docker run --rm -it --user "$(id -u):$(id -g)" \
#       -v "$PWD:$PWD" -w "$PWD" -e OPENROUTER_API_KEY \
#       huu:local run pipeline.json
```

Imagens pré-buildadas são publicadas manualmente pelo maintainer em
`ghcr.io/frederico-kluser/huu:<version>`. Se uma tag está disponível, o
wrapper puxa automaticamente:

```bash
export OPENROUTER_API_KEY=sk-or-...
huu run pipelines/huu-test-suite.pipeline.json     # usa ghcr.io/frederico-kluser/huu:latest
```

> O huu materializa os pipelines default empacotados em `./pipelines/` no
> primeiro launch — escolha um na tela de boas-vindas ou passe o caminho.

Por baixo dos panos, o wrapper monta o equivalente a:

```bash
docker run --rm -it \
  --cidfile /tmp/huu-cids/cid-<pid>-<rand>.id \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" \
  -e OPENROUTER_API_KEY \
  ghcr.io/frederico-kluser/huu:latest run pipelines/huu-test-suite.pipeline.json
```

> **Por que montar `$PWD:$PWD` (mesmo path nos dois lados)?** git
> armazena paths absolutos dentro de `.git/worktrees/<name>/gitdir`.
> Montar sob um prefixo diferente deixaria ponteiros de worktree
> visíveis no host que apontam pra lugar nenhum quando o container
> termina.

### Lifetime e sinais

Lifetime é vinculado ao seu terminal. Ctrl+C, fechar o terminal
(SIGHUP) e `kill` (SIGTERM) param o container de forma confiável. O
wrapper captura cada sinal no processo host e emite
`docker kill --signal …` contra o cidfile capturado, contornando o
bug antigo [moby#28872](https://github.com/moby/moby/issues/28872)
onde `docker run -it` às vezes perde sinais a caminho do container.
Dentro do container, [tini](https://github.com/krallin/tini) (PID 1)
forwarda o sinal pro processo Node do huu, os exit handlers da TUI
rodam, e `--rm` remove o container.

Se o wrapper for morto hard (`kill -9`, OOM), a próxima invocação do
`huu` poda containers órfãos cujo parent PID registrado não está mais
vivo. Use `huu prune --list` pra inspecionar containers huu
remanescentes, `huu prune --dry-run` pra ver o que seria limpo, e
`huu prune` pra forçar kill.

### Tratamento de VPN / MTU

**Em VPN (WireGuard / OpenVPN / Tailscale exit-node)? Simplesmente
funciona.** Na inicialização do wrapper, o huu inspeciona o MTU da
rota default do host (no Linux). Quando está abaixo de 1500 — típico
de túneis VPN — o huu auto-cria uma bridge docker chamada
`huu-net-mtu<N>` com o MTU correspondente e roda o container nela. Sem
env var, sem editar daemon.json, sem `--network=host`. A rede é
idempotente e reusada entre execuções; se seu MTU de VPN mudar, uma
nova rede por-MTU é criada da próxima vez.

Pra override (ex.: forçar networking `host` ou usar uma rede customizada
pré-existente), set `HUU_DOCKER_NETWORK=<value>` — passado verbatim pro
`docker run --network`. Pra inspecionar o que o huu criou:
`docker network ls | grep huu-net-`.

Por que isso importa: sem o clamping de MTU, a discrepância entre
docker bridge (1500) > túnel (~1420) silenciosamente derruba pacotes
TLS ClientHello, e todo handshake HTTPS trava. Como defense-in-depth,
o orchestrator também roda uma sonda de alcance OpenRouter de 8s no
início e aborta com clareza se upstream estiver inalcançável, então
você nunca queima 30 minutos em loops de retry.

### Modo isolated-volume

Pra performance máxima em macOS / Windows com isolamento completo de
filesystem: diga ao huu pra colocar os worktrees num volume nomeado em
vez de dentro do repo bind-montado. Operações de branch ficam no repo
(então o branch de integração ainda cai no seu `git log` local); só o
scratch space por-agente vai pro volume rápido.

```bash
docker volume create huu-worktrees
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" \
  -v huu-worktrees:/var/huu-worktrees \
  -e HUU_WORKTREE_BASE=/var/huu-worktrees \
  -e OPENROUTER_API_KEY \
  ghcr.io/frederico-kluser/huu:latest run pipeline.json
```

`HUU_WORKTREE_BASE` aceita path absoluto (usado verbatim) ou path
relativo ao repo (resolvido contra a raiz). Quando setado,
`git worktree list` no host não vai mostrar os worktrees por-agente
ativos durante a execução — esse é o trade-off pelo speedup.

### Compose

```bash
# usa o compose.yaml do repo (compila a imagem na primeira execução)
export OPENROUTER_API_KEY=sk-or-...
docker compose run --rm huu run pipelines/huu-test-suite.pipeline.json
```

**Wrapper de conveniência:** jogue [`scripts/huu-docker`](../scripts/huu-docker)
no seu `PATH` pra abreviar pra `huu-docker run pipeline.json`.

### Docker secrets

O wrapper auto-Docker cuida do `OPENROUTER_API_KEY` de forma segura:
escreve a key num arquivo modo `0600` sob `/dev/shm` (tmpfs do Linux —
nunca chega no disco; cai pra `os.tmpdir()` em outros lugares) e
bind-monta read-only em `/run/secrets/openrouter_api_key` dentro do
container. O valor da key nunca aparece em `docker inspect`, nunca
aparece em `ps auxf`, e é unlink do host assim que o wrapper termina.

Pra setups Compose, o pattern canônico funciona:

```yaml
# trecho do compose.yaml
services:
  huu:
    secrets:
      - openrouter_api_key
secrets:
  openrouter_api_key:
    file: ./openrouter.key  # ou external: true com `docker secret create`
```

A imagem checa `/run/secrets/openrouter_api_key` antes de cair pra
`OPENROUTER_API_KEY_FILE` e por fim a env var simples — mesma
precedência que a imagem do postgres usa.

### Variantes de imagem

- `huu:latest` (~613MB) — traz `openssh-client` pra remotes git via SSH.
- `huu:slim` (~604MB; build-arg `INCLUDE_SSH=false`) — sem isso, pra
  setups só-HTTPS.

### Cookbook na imagem

A imagem oficial traz os pipelines de referência do repo em
`$HUU_COOKBOOK_DIR` (`/opt/huu/cookbook/`). Puxe um pipeline curado pro
seu repo sem clonar nada:

```bash
docker run --rm ghcr.io/frederico-kluser/huu:latest \
  cookbook pull huu-test-suite > my-test-pipeline.json
```

### Não quer Docker?

`huu --yolo` (ou `HUU_NO_DOCKER=1 huu …`) ignora o Docker e roda
nativo no host. A flag compõe com tudo: `huu --yolo` abre a TUI,
`huu --yolo run x.json` executa um pipeline, `huu --yolo --stub`
roda o agente stub. Execuções nativas exigem o `npm install` local das
deps do huu, e o agente LLM vai ver suas credenciais de shell
(`~/.ssh`, `~/.aws`, …) — um warning de uma linha aparece no stderr
a cada vez. Os subcomandos não-TUI (`huu --help`, `huu init-docker`,
`huu status`) sempre rodam nativo de qualquer forma.

### Solução de problemas: erro `denied: denied` no pull

`docker: ... error from registry: denied` significa que o Docker não
conseguiu puxar a imagem do GHCR — em geral porque a tag não está
publicada/é privada, ou porque há credenciais cacheadas inválidas em
`~/.docker/config.json` (o GHCR não cai pra acesso anônimo nesse caso).
Três saídas, da mais simples à mais completa:

| Caminho | Comando | Quando usar |
|---|---|---|
| Limpar credencial | `docker logout ghcr.io` | Resolve rápido um one-off |
| **Build local** | `docker build -t huu:local .` então `HUU_IMAGE=huu:local huu run …` | **Recomendado** — reprodutível, sem registry |
| Rodar nativo | `huu --yolo run …` (== `HUU_NO_DOCKER=1`) | Dev/teste; ⚠️ expõe `~/.ssh`/`~/.aws` ao agente |
| Re-autenticar | `echo "$PAT" \| docker login ghcr.io -u <user> --password-stdin` | Precisa de imagens privadas (PAT com escopo `read:packages`) |

---

## Configuração

### Registry de API keys

`huu` resolve API keys através de um registry declarativo
(`src/lib/api-key-registry.ts`). Adicionar uma key futuramente é um
append de uma entrada; tudo o mais (prompt da TUI, mount de secret
Docker, passthrough de env, limpeza de órfãos) itera pela mesma lista.

Registry atual:

| Key | Obrigatória | Backend | Usada por |
|---|---|---|---|
| `OPENROUTER_API_KEY` (`openrouter`) | sim (sem `--stub`) | Pi | O agente do Pi SDK + o pipeline assistant + project recon. |
| `ARTIFICIAL_ANALYSIS_API_KEY` (`artificialAnalysis`) | sim | todos | Recomendações de modelo / lookups de capabilities ao vivo no picker. |
| `COPILOT_GITHUB_TOKEN` (`copilot`) | sim (quando `--copilot`) | Copilot | O agente do Copilot SDK. PAT fine-grained com escopo "Copilot Requests", ou `GH_TOKEN`. |

Ordem de resolução por spec (primeira não-vazia vence):

1. Mount de secret de container em `/run/secrets/<snake_case_name>` —
   mesma convenção das imagens Docker postgres / mysql.
2. Env var `<NAME>_FILE` apontando pra um arquivo com o valor.
3. Env var `<NAME>` (plain).
4. Store global persistido em `$XDG_CONFIG_HOME/huu/config.json`
   (fallback `~/.config/huu/config.json`, modo `0600` num diretório
   `0700`). A TUI oferece "salvar globalmente" na primeira vez que
   você cola uma key e escreve lá.

Qualquer key que resolve pra vazio E é `required: true` faz a TUI
mostrar o prompt no caminho da primeira execução. Stub mode (`--stub`)
curto-circuita o check de requisito.

### Variáveis de ambiente

| Variável | Obrigatória | Pra que serve |
|---|---|---|
| `OPENROUTER_API_KEY` | sim (sem `--stub`) | Enviada pro OpenRouter via Pi SDK. Se faltar, o TUI pede na primeira execução real e "save globally" persiste em `~/.config/huu/config.json`. |
| `OPENROUTER_API_KEY_FILE` | não | Caminho de um arquivo contendo a key. Tem precedência sobre `OPENROUTER_API_KEY` quando ambos estão setados; o mount canônico de Docker secret em `/run/secrets/openrouter_api_key` tem precedência sobre ambos. |
| `ARTIFICIAL_ANALYSIS_API_KEY` | sim | Usada pra lookups de capabilities de modelo ao vivo (`supportsThinking`, pricing). Mesma cadeia de precedência via `ARTIFICIAL_ANALYSIS_API_KEY_FILE` e `/run/secrets/artificial_analysis_api_key`. |
| `COPILOT_GITHUB_TOKEN` | sim (quando `--copilot`) | PAT fine-grained do GitHub com escopo "Copilot Requests" (ou `GH_TOKEN`). Obrigatória só quando `--backend=copilot` está ativo. Mesma cadeia de precedência via `COPILOT_GITHUB_TOKEN_FILE` e `/run/secrets/copilot_token`. |
| `HUU_WORKTREE_BASE` | não | Override do diretório base dos worktrees por execução. Paths absolutos são usados verbatim; paths relativos resolvidos contra a raiz do repo. Padrão: `<repo>/.huu-worktrees`. Usado pelo modo isolated-volume do container. |
| `HUU_CHECK_PUSH` | não | Quando setada, preflight verifica que o remote configurado está alcançável antes de a execução começar. |
| `HUU_IN_CONTAINER` | não | Setada pra `1` automaticamente pela imagem Docker oficial. Usada pelo wrapper pra curto-circuitar o auto-Docker re-exec. |
| `HUU_IMAGE` | não | Override da imagem de container usada pelo wrapper auto-Docker. Padrão: `ghcr.io/frederico-kluser/huu:latest`. Útil pra pinar uma release ou apontar pra um mirror privado. |
| `HUU_NO_DOCKER` | não | Quando setada pra `1` ou `true`, pula o auto-Docker re-exec e roda huu nativo. Equivalente à flag `--no-docker` (o alias de grafia neutra do `--yolo`, pensado pra CI). Exige `npm install` local das deps do huu. Útil pro desenvolvimento do huu em si e pra runners de CI — veja [`docs/ci.pt-BR.md`](ci.pt-BR.md). |
| `HUU_DOCKER_NETWORK` | não | Valor pass-through pra `docker run --network=<value>`. Por padrão, huu auto-cria `huu-net-mtu<N>` quando em VPN (MTU da rota default < 1500); set isso pra override (ex.: `host`, ou o nome de uma rede gerenciada pelo usuário pré-existente). |
| `HUU_DOCKER_PASS_ENV` | não | Lista separada por whitespace de nomes de env var adicionais pra forwardar pro container. O wrapper sempre forwarda `OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_FILE`, `HUU_CHECK_PUSH`, `HUU_WORKTREE_BASE`, `HUU_HOST_HOME` e `TERM` — use isso pra adicionar nomes customizados. |
| `HUU_HOST_HOME` | não | Setada automaticamente pelo wrapper pro home directory do host. Dentro do container, `getHuuHome()` lê isso pra escritas em `~/.huu/` e o target default de export `~/Downloads/` caírem no filesystem bind-montado do host. Sem set fora do Docker. |
| `HUU_UID` | não | UID do container pra execuções `docker compose`. Padrão: `1000`. Override com `HUU_UID=$(id -u)` se seu UID de host não é 1000, ou use o wrapper `scripts/huu-compose` que seta automaticamente. |
| `HUU_GID` | não | GID do container pra execuções `docker compose`. Mesmas regras de default que `HUU_UID`. |

### Arquivos escritos pela ferramenta

| Path | Escopo | Propósito |
|---|---|---|
| `~/.config/huu/config.json` | global | API keys persistidas via o prompt "save globally" do TUI (modo `0600` num diretório `0700`). |
| `~/.huu/recents.json` | global | Modelos recentemente usados pelo picker. |
| `~/.huu/pipeline-memory.json` | global | Pipelines salvos do editor TUI. |
| `<repo>/.huu-worktrees/<runId>/` | repo | Um subdiretório por agente durante uma execução; removido no fim (manifest preservado). |
| `<repo>/.huu/<stamp>-execution-<runId>.log` | repo | Transcrição cronológica completa de uma execução. |
| `<repo>/.huu/<stamp>-execution-<runId>/agent-<id>.log` | repo | Transcrição por agente. |
| `<repo>/.huu/debug-<ISO>.log` | repo | Trace de debug em NDJSON, uma linha por evento de lifecycle. |
| `<repo>/.huu-cache/native-shim/<os>-<arch>/` | repo | Interceptor `bind()` compilado. Buildado uma vez, reusado entre execuções. |
| `<worktree>/.env.huu` | por-agente | Atribuições de porta por agente; auto-carregado por tools dotenv-aware. |
| `<worktree>/.huu-bin/with-ports` | por-agente | Wrapper shell que faz source do `.env.huu` e `exec` num comando — necessário pra binários que ignoram dotenv. |

Quando rodando sob Docker (modo host-bind, o padrão), todos esses paths
ficam visíveis no filesystem do host depois que o container termina —
igual a uma execução nativa. `huu` adiciona `.huu-worktrees/`, `.huu/`,
`.huu-cache/`, `.env.huu` e `.huu-bin/` ao `.gitignore` do repo na
primeira execução.

### Modelos recomendados

`recommended-models.json` traz uma lista curta curada mostrada no topo
do picker de modelo. Cada entrada pode carregar metadados opcionais:
`description`, `bestFor` (tags de caso de uso), `tier`
(`flagship` / `workhorse` / `fast`), e `provider`
(`openrouter` ou `copilot`).

Quando `ARTIFICIAL_ANALYSIS_API_KEY` está setada, o quick picker
renderiza uma tabela de largura fixa com métricas ao vivo do
Artificial Analysis — `Model · tok/s · Agnt · Code · Razn · $in/$out
· BestFor`. Sem a key, colunas degradam pra placeholders `—` sem
bloquear a seleção.

---

## Concorrência com auto-scaling

**O auto-scaling memória-aware é o padrão.** O auto-scaler dimensiona
a concorrência pelo headroom real de memória: ele mede o consumo de
verdade de cada agente (média móvel, semeada em 250 MB) e admite novos
agentes só enquanto couberem na memória disponível menos uma margem de
segurança — cgroup-aware, então dentro de um container ele respeita o
limite do container, não o do host. Passe `--concurrency=N` ou
`--no-auto-scale` pra pinar o **modo manual** (ajustável ao vivo com
`+`/`-` no dashboard; `A` religa o auto). Em configs headless, setar
`"concurrency"` pina manual; omita pro auto.

O auto-scaler observa CPU e RAM via `lib/resource-monitor.ts` e
transita entre cinco estados, mostrados no header como
`AUTO <ESTADO> · CPU/RAM · ~<N>MB/agente · free <N>MB`:

- **NORMAL** — abaixo de ambos os thresholds, disposto a subir mais
  agentes até a profundidade da fila.
- **SCALING_UP** — ativamente concedendo slots de spawn.
- **BACKING_OFF** — uso acima do threshold de parada (default 90%);
  recusa novos spawns mas deixa agentes em execução em paz.
- **DESTROYING** — uso acima do threshold de destruição (default 95%);
  mata o agente **mais novo** (fase `killed_by_autoscaler`) pra
  recuperar espaço. O cartão morto volta pra coluna TODO com um
  contador de requeue `↻N` e a tarefa recomeça do zero depois — o
  trabalho dos agentes mais antigos nunca é perdido.
- **COOLDOWN** — pausa de 30s depois de um evento de destroy ou
  backoff pra que o sistema não oscile.

`+`/`-` manuais no dashboard desabilitam o auto-scale automaticamente
— pressione `A` pra reativar. A **guarda de memória continua ativa no
modo manual** (o header troca o chip `AUTO` por um chip `GUARD` com o
contador de kills). O bloco de status também mostra `CPU%` e `RAM%`
ao vivo, espelhando o `SystemMetricsBar` pra você não ter que
correlacionar dois readouts.

**Modo MAX (`M`)** é um terceiro modo, ganancioso: inunda o pool com um
agente por tarefa na fila (até o teto rígido) e deixa a guarda de
memória sempre-ativa como único backstop, então a concorrência se
acomoda exatamente no threshold de destruição. O header mostra um chip
azul `MAX <ESTADO>` com a contagem de kills; o amortecimento por
cooldown evita thrashing. Pressione `M` de novo (ou `A`) pra voltar ao
auto, `+`/`-` pra cair pro manual.

Sobrescreva defaults setando `agentMemoryEstimateMb`,
`stopThresholdPercent`, `destroyThresholdPercent`, `cooldownMs` e
`maxAgents` no código se você embarca o orchestrator; o CLI expõe
`--concurrency=N` e `--no-auto-scale`.

---

## Previsibilidade de custo

O custo de uma execução do `huu` é limitado pelo número de cartões e
pelo modelo escolhido por estágio. Não existe um loop de agente que
pode decidir "também fazer X" — você recebe a execução que pagou.

**Ferramentas de hoje pra manter o custo no controle:**

- `--stub` roda o fluxo todo sem nenhum LLM. Use pra validar a
  estrutura e a decomposição do pipeline antes de gastar um dólar.
- `--copilot` usa créditos do Copilot baseados em assinatura em vez de
  cobrança por token — o custo fica dentro da cota de premium-requests
  do seu plano GitHub existente.
- O `modelId` por step permite rotear estágios mecânicos pra
  Haiku/Gemini Flash e reservar Sonnet/Opus pros estágios que de fato
  precisam.
- Tokens e custo são registrados por agente e aparecem no resumo da
  execução; detalhamento completo em
  `.huu/<runId>-execution-...log`.

**Roadmap:** `huu estimate <pipeline.json>` vai fazer dry-run da
decomposição e produzir uma previsão tipo:

```
5 estágios × 12 tarefas × Sonnet 4.5: estimado em $3.40, ~14 min de tempo de relógio.
```

Até isso chegar, a convenção é: validar com stub primeiro, depois
rodar com olho no kanban durante o primeiro estágio pra pegar
surpresas cedo.

---

## Isolamento de portas (visão geral)

`git worktree` isola o **filesystem**. Não isola a **rede do host**:
quando dez agentes sobem `npm run dev` ao mesmo tempo, todos chamam
`bind(3000)` no mesmo kernel. Nove falham com `EADDRINUSE` — e os
agentes, acreditando corretamente que o código do cliente está certo,
gastam tokens "consertando" um não-bug.

`huu` defende em quatro camadas (nenhuma exige Docker):

1. **`PortAllocator`** — cada agente recebe uma janela contígua de
   portas TCP (default `55100 + (agentId − 1) × 10`).
2. **`.env.huu` por worktree** — um env file dedicado exportando
   `PORT`, `HUU_PORT_HTTP`, `HUU_PORT_DB`, `HUU_PORT_WS`,
   `DATABASE_URL` e sete extras. Frameworks que respeitam dotenv
   (Next, Vite, Nest, Astro, dotenv-flow, …) carregam automaticamente.
3. **Interceptor `bind()` nativo.** Uma biblioteca C compartilhada de
   ~150 linhas em `native/port-shim/port-shim.c`. O orchestrator
   compila com `cc` e faz preload via `LD_PRELOAD` (Linux) ou
   `DYLD_INSERT_LIBRARIES` (macOS). **O código do cliente nunca é
   modificado** — `app.listen(3000)` literal no source roda
   exatamente como escrito; o kernel só vê uma porta por-agente em
   vez disso.
4. **System prompt** — o agente recebe suas portas alocadas e é
   lembrado de prefixar comandos não-dotenv-aware com o wrapper shell
   `./.huu-bin/with-ports <command>`.

**Matriz de cobertura, exclusões, como desabilitar e o design
completo:** [`PORT-SHIM.md`](PORT-SHIM.md).

Pra optar por desabilitar em refatorações puras / análise estática /
geração de doc, adicione `"portAllocation": { "enabled": false }` no
pipeline.

---

## Convenções visuais

**Magenta = ações de IA.** Sempre que você vir um painel ou marcador
roxo (`✦`) — o modo **Smart Select** (`S` no file picker), o
**Pipeline Assistant**, **Project Recon**, **logs de agente** — tem
um LLM sendo invocado em seu nome. Ciano é navegação/seleção neutra;
verde é confirmação/sucesso; amarelo é estado intermediário ou
warning; vermelho é erro; azul é informação auxiliar não-IA (modais
helper, escopos não-IA).

Tokens estão definidos em [`src/ui/theme.ts`](../src/ui/theme.ts).
Componentes que introduzirem nova utilização de magenta fora de
contextos de IA devem escolher outra cor.

---

## FAQ

**Posso rodar isso sem supervisão, de madrugada?**
Sim — é o uso primário. Cada agente tem timeouts e retries; a
execução termina sozinha com um resumo persistido. Leia
`.huu/<runId>-execution-*.log` de manhã. Pra ser notificado no
término, conecte o exit code do CLI num notifier (ntfy, webhook,
Slack incoming-webhook, seu hábito de escolha).

**A execução vai tocar no meu branch atual?**
Não. Todo agente trabalha no seu próprio worktree ramificado do seu
HEAD atual. Seu working tree nunca é modificado durante uma execução.

**Preciso commitar antes de rodar?**
Sim. Preflight se recusa a iniciar num working tree dirty. Faça
stash ou commit primeiro.

**O que acontece se um agente crashar no meio da execução?**
O orchestrator marca o cartão como falho, dropa seu worktree, e
(dependendo do `maxRetries`) re-sobe a tarefa num worktree fresh em
cima do mesmo HEAD de integração. Se retries esgotam, a execução
continua sem aquele cartão e a falha fica preservada no resumo.

**Por que o cartão de um agente voltou pra TODO com um badge `↻`?**
A guarda de memória sempre-ativa disparou: em ~95% de RAM (ou CPU)
ela mata o agente **mais novo** — o que tem menos trabalho feito —
pra que o trabalho dos agentes mais antigos sobreviva. O cartão volta
pra coluna TODO com um contador de requeue `↻N` e a tarefa recomeça
do zero quando a memória liberar. A guarda fica ativa em todos os
modos de concorrência (auto, manual e MAX). O auto-scale memória-aware
é o padrão; pine um
número fixo de agentes com `--concurrency=N` ou `--no-auto-scale`
(ou `"concurrency": N` num config headless).

**Posso rodar o huu no CI (GitHub Actions / GitLab)?**
Sim — um runner de CI já é um container efêmero, então pule o wrapper
Docker com `HUU_NO_DOCKER=1` (ou `--no-docker`) e conduza a execução
com `huu auto`. Receitas completas, incluindo upload de
`.huu/audits/` como artefato: [`docs/ci.pt-BR.md`](ci.pt-BR.md).

**E se dois agentes tocam no mesmo arquivo?**
É sinal de que o pipeline foi mal projetado: em um pipeline
saudável, cada tarefa num estágio é dona de um arquivo disjunto. Se
sobreposição acontece mesmo assim e o git não consegue auto-merge,
um agente de integração ancorado em um LLM real resolve o conflito
num worktree lateral e continua. Resolução de conflito é
desabilitada no modo `--stub`. Encare como rede de segurança, não
feature.

**Posso abortar uma execução com segurança?**
Sim. `Q` aciona um abort cooperativo: agentes em voo terminam seu
step atual, branches com commits são mantidas como artefatos, o
worktree de integração é limpo. Pressione `Q` de novo pra forçar a
saída do dashboard.

**Quanto vou gastar?**
Depende do formato do pipeline e do modelo. Um pipeline de 30
arquivos em Sonnet 4.5 tipicamente fica entre $1 e $10. Use
`--stub` pra validar a estrutura primeiro; roteie estágios
mecânicos pra modelos mais baratos via `modelId` por step. O resumo
da execução detalha o custo por agente.

**Por que dois valores de timeout?**
Cartões de arquivo único geralmente terminam mais rápido que
cartões de projeto inteiro por uma ordem de magnitude. Separar o
timeout significa feedback apertado em trabalho per-file sem matar
prematuramente um cartão mais amplo que ainda está progredindo.

**Onde coloco minha API key?**
Pra **Pi** (backend padrão): exporte `OPENROUTER_API_KEY` antes de
lançar, ou cole no prompt na primeira vez que iniciar uma execução
real sem ela. Pra **Copilot**: exporte `COPILOT_GITHUB_TOKEN` (PAT
do GitHub com escopo "Copilot Requests"). A ferramenta em si nunca
persiste a key a não ser que você escolha "save globally" no prompt
do TUI.

**Por que o container Docker é mais lento no macOS?**
Filesystems bind-mounted no macOS atravessam um boundary de VM,
adicionando ~3× de latência pra operações de muitos arquivos
pequenos como `git worktree add`. Use [OrbStack](https://orbstack.dev/)
em vez do Docker Desktop pra ~2× mais I/O de arquivo no mesmo
workload.

**Posso rodar huu no Windows sem WSL2?**
Não na prática. Docker Desktop no Windows exige ou WSL2 ou Hyper-V,
e paths bind-mounted do Windows (`/mnt/c/...`) são 10–20× mais
lentos que ext4 dentro de WSL — suficiente pra fazer `git worktree
add` pra um pipeline real levar minutos por tarefa. Instale WSL2,
clone seu repo em `/home/<user>/` dentro do WSL, e use Docker
Desktop com integração WSL ativada.

**Por que o Ctrl+C no container às vezes deixa meu terminal travado?**
Não deveria — a imagem roda `tini` como PID 1 pra forwardar sinais,
e o CLI do `huu` instala um restorer de raw-mode belt-and-suspenders
pra `SIGINT`/`SIGTERM`/`SIGHUP`/`uncaughtException`. Se você vir um
terminal travado, rode `stty sane` pra recuperar e por favor abra
uma issue com o conteúdo de `.huu/debug-<ISO>.log` daquela execução.

**Arquivos em `.huu-worktrees/` são donos de root e não consigo deletar.**
Você está num host onde seu usuário primário não é UID 1000. Ou:
1. Use `scripts/huu-compose run pipeline.json` — auto-detecta seu
   UID via `id(1)` e exporta `HUU_UID`/`HUU_GID`.
2. Exporte uma vez por shell: `export HUU_UID=$(id -u) HUU_GID=$(id -g)`
   e use `docker compose run` normalmente.

---

## Roadmap

- `huu estimate <pipeline.json>` — dry-run de custo e previsão de
  tempo de relógio.
- `huu lint <pipeline.json>` — detectar `files` sobrepostos entre
  estágios, placeholders `$file` faltando, model IDs indefinidos.
- `huu/cookbook` — registry comunitário de pipelines, com cada
  entrada taggeada por domínio (testing, audits, refactors, docs).
- Wrapper de GitHub Action — rodar um pipeline `huu` como parte do
  CI em um PR labeled.
- JSON Schema + LSP pra `huu-pipeline-v1.json` — autocomplete e
  validação em editores.

---

## Contribuindo

`huu` é open-source sob [Apache 2.0](../LICENSE). Issues e pull
requests são bem-vindos.

Regras básicas:

- Leia a skill relevante sob `.agents/skills/` antes de mudar uma
  camada com a qual você não tem familiaridade.
- Prefira **Conventional Commits** (`feat:`, `fix:`, `refactor:`,
  `docs:`, …).
- Nunca force-push em `main`.
- **Não há CI automatizado.** Rode `npm run typecheck && npm test`
  localmente antes de abrir um PR. Ative o hook pre-push com
  `git config core.hooksPath .githooks` pra impor isso.

```bash
npm run dev          # TUI com hot-reload em src/cli.tsx
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest (orchestrator, run logger, file scanner, pipeline e2e)
```

Smoke tests pra releases:

```bash
docker build -t huu:local .
./scripts/smoke-image.sh        # ~10s — sanidade da imagem
./scripts/smoke-pipeline.sh     # ~60s — pipeline end-to-end com --stub
```
