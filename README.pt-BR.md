<p align="center">
  <img src="assets/banner.png" alt="huu — pipelines de IA para rodar de madrugada, com auditoria, previsibilidade e portabilidade" width="720">
</p>

<h1 align="center">huu</h1>

<p align="center">
  <strong><code>huu</code> — <em>Humans Underwrite Undertakings</em> (humanos subscrevem empreitadas).</strong>
</p>

<p align="center">
  Pipelines de IA que você deixa rodando durante a madrugada. Acorde com o trabalho feito — do jeito que você planejou, em um branch de integração limpo que dá pra auditar. Compartilhe seus pipelines, rode os dos outros. <strong>A inteligência vive no plano, não na IA.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>Português (BR)</strong>
</p>

<p align="center">
  <a href="#licença"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <img alt="Node.js 18+" src="https://img.shields.io/badge/node-%E2%89%A5%2018-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.x-3178C6?logo=typescript&logoColor=white">
  <img alt="Built with Ink" src="https://img.shields.io/badge/TUI-Ink%204-000000">
</p>

---

## Por que huu?

- **Roda sem supervisão, durante a madrugada.** Cada agente trabalha no seu próprio worktree git, com timeouts e retries. A execução termina sozinha, grava uma transcrição cronológica em `.huu/`, e te deixa o `git log` pronto pra auditar de manhã. Você subscreve o escopo; o executor cuida da execução.
- **O escopo fica congelado em JSON antes do kickoff.** Sem expansão de escopo alucinada. O `huu` não decide o que fazer — *você* decidiu, quando escreveu o pipeline. Se uma etapa está mal projetada, o resultado fica errado de um jeito previsível e auditável, não de um jeito surpreendente.
- **Pipelines são portáteis, não amarrados a um provedor.** Um `huu-pipeline-v1.json` é um artefato versionado: comite, compartilhe como gist, contribua pro cookbook. O know-how de *como decompor essa classe de tarefa* vive em JSON puro — não no histórico de chat de alguém com um provedor de código fechado.

---

## Sumário

- [O que é](#o-que-é)
- [Quando usar](#quando-usar) · [Quando NÃO usar](#quando-não-usar)
- [huu vs alternativas](#huu-vs-alternativas)
- [Rodar com Docker](#rodar-com-docker)
- [Início rápido (instalação nativa)](#início-rápido-instalação-nativa)
- [Schema do pipeline](#schema-do-pipeline)
- [Pipelines como artefato compartilhável](#pipelines-como-artefato-compartilhável)
- [Filosofia](#filosofia)
- [Segurança em paralelo: isolamento de portas por agente](#segurança-em-paralelo-isolamento-de-portas-por-agente)
- [Previsibilidade de custo](#previsibilidade-de-custo)
- [Configuração](#configuração)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contribuindo](#contribuindo)
- [Licença](#licença)
- [Autor](#autor)

---

## O que é

`huu` é um TUI distribuído em um único binário que roda pipelines ordenados de LLM em cima de um repositório git existente. Você escreve *o que* precisa acontecer como uma lista de etapas com prompts; o orquestrador transforma cada etapa em um leque de agentes paralelos, isola cada agente em seu próprio worktree git, e faz o merge do trabalho deles em um único branch de integração antes de seguir pra próxima etapa.

> 🎬 _Aqui caberia um asciinema ao vivo do dashboard kanban. Até ele chegar, imagine: um cartão por agente, contadores ao vivo de tokens/custo, um log de integração rolando embaixo, cada transição de estado persistida em `.huu/` pra post-mortem._

Um exemplo concreto, tirado da prática — *migrar 40 testes de Mocha para Vitest*:

1. **Estágio 1** escreve um único `MIGRATION.md` auditando todos os 40 testes e os padrões a aplicar.
2. **Estágio 2** dispara 40 agentes em paralelo — cada um no seu próprio worktree, cada um tocando exatamente um arquivo.
3. **Estágio 3** roda `npm test`, captura a saída e atualiza o `CHANGELOG.md`.

Você revisa 40 commits independentes e o log de merge. A coisa toda é um único arquivo JSON que você guarda no seu repo e re-executa no próximo codebase que precisar da mesma migração.

O tipo previsível de segurança: cada agente comita num branch descartável, os branches são mergeados num passo serial e ordenado, e seu working tree nunca é tocado. Se algo der errado, aborte a execução — seu repo fica exatamente onde você deixou.

---

## Quando usar

O problema concreto que `huu` resolve é mais específico do que "tarefas gerais de programação": **aplicar a mesma classe de transformação a N arquivos independentes, com auditabilidade arquivo a arquivo.** Casos canônicos:

- Escrever testes unitários pra 30 módulos.
- Auditoria de segurança por arquivo (OWASP), relatórios parciais, consolidação num estágio final.
- Refatorações de alta repetição: tipar 80 arquivos JS, migrar 40 testes Mocha pra Vitest, adicionar JSDoc a 50 funções.
- Plano + execução paralela: estágio 1 escreve um `PLAN.md`, estágio 2 aplica o plano em N arquivos.

## Quando NÃO usar

`huu` **não** é a ferramenta certa pra:

- Bugs cuja causa raiz é desconhecida — você precisa de exploração interativa antes.
- Refatorações arquiteturais que tocam estado compartilhado entre módulos.
- Trabalho de feature cujo escopo emerge da exploração do código.
- Monorepos com dependências complexas entre pacotes.
- Trabalho onde você quer que o sistema te surpreenda com soluções.

Pra esses casos, use Claude Code, Cursor, Aider ou Plandex. `huu` é deliberadamente o oposto: você sabe o que quer, sabe quais arquivos tocar, e quer paralelismo somado a auditabilidade. **Se você ainda não sabe o que quer fazer, é cedo demais pra usar isso aqui.**

---

## huu vs alternativas

| Família de ferramenta | Abordagem | Quando usar |
|---|---|---|
| Claude Code, Cursor, Aider | Conduzido por chat, exploratório | Você ainda não sabe o que fazer. |
| Claude Code `/batch` | Decomposição feita pelo LLM, com gate de aprovação humana | Você quer tarefas em lote, mas confia num LLM pra fatiá-las. |
| Plandex, Devin, OpenHands | Decomposição feita pelo LLM, execução autônoma | Você confia no sistema pra decidir o escopo. |
| Conductor, Claude Squad | Workspaces paralelos, merge humano por branch | Você quer paralelismo com revisão humana em nível de PR pra cada tarefa. |
| **huu** | **Plano escrito por humano, execução paralela, auditoria nativa do git** | **Você sabe o escopo exatamente e quer um pipeline reusável e versionado.** |

A diferença honesta vs `/batch`: `huu` não vai decidir que a etapa 3 também deveria tocar um arquivo que você não listou. O pipeline é o contrato — o humano subscreveu.

---

## Rodar com Docker

O `huu` roda em Docker por padrão — suas credenciais de shell, `~/.ssh`, e `~/.aws` ficam invisíveis pro agente LLM. O caminho recomendado é **buildar a imagem a partir do source** (zero dependência de registry, reproducibilidade total):

```bash
git clone https://github.com/frederico-kluser/huu
cd huu
docker build -t huu:local .
HUU_IMAGE=huu:local huu run pipeline.json
# ou: docker run --rm -it --user "$(id -u):$(id -g)" \
#       -v "$PWD:$PWD" -w "$PWD" -e OPENROUTER_API_KEY \
#       huu:local run pipeline.json
```

Imagens pré-construídas são **publicadas manualmente pelo mantenedor** em `ghcr.io/frederico-kluser/huu:<version>` (sem CI automatizada). Se uma tag estiver disponível, dá pra pular o build:

```bash
export OPENROUTER_API_KEY=sk-or-...
huu run example.pipeline.json     # auto-usa ghcr.io/frederico-kluser/huu:latest
```

Por baixo o wrapper monta o equivalente a:

```bash
docker run --rm -it \
  --cidfile /tmp/huu-cids/cid-<pid>-<rand>.id \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" \
  -e OPENROUTER_API_KEY \
  ghcr.io/frederico-kluser/huu:latest run example.pipeline.json
```

**O tempo de vida é amarrado ao seu terminal.** Ctrl+C, fechar o terminal (SIGHUP), e `kill` (SIGTERM) todos param o container de forma confiável. O wrapper intercepta cada sinal no processo do host e dispara `docker kill --signal …` contra o cidfile capturado, contornando o bug histórico [moby#28872](https://github.com/moby/moby/issues/28872) em que `docker run -it` às vezes perde sinais no caminho pro container. Dentro do container, o [tini](https://github.com/krallin/tini) (PID 1) encaminha o sinal pro processo Node do huu, os handlers de saída do TUI rodam, e `--rm` remove o container.

Se o wrapper em si é morto à força (`kill -9`, OOM), a próxima invocação do `huu` poda containers órfãos cujo PID pai gravado não está mais vivo — sem precisar de `docker ps | xargs kill` manual. Use `huu prune --list` pra inspecionar containers huu pendentes, `huu prune --dry-run` pra ver o que a limpeza faria, e `huu prune` pra matá-los à força.

**Não quer Docker pra uma execução específica?** `HUU_NO_DOCKER=1 huu run x.json` roda nativo (requer o `npm install` local das deps do huu). Os subcomandos não-TUI (`huu --help`, `huu init-docker`, `huu status`) sempre rodam nativo — operam em estado do filesystem do host e um docker pull seria trabalho desperdiçado.

O container roda o pipeline inteiro (worktrees, agentes, merge) e o branch `huu/<runId>/integration` resultante aparece no `git log` do seu repo quando termina — exatamente como se você tivesse rodado o `huu` nativo.

> **Por que montar `$PWD:$PWD` (mesmo path dos dois lados)?** o git armazena paths absolutos dentro de `.git/worktrees/<name>/gitdir`. Montar sob um prefixo diferente deixaria ponteiros de worktree visíveis no host apontando pra lugar nenhum quando o container terminasse.

**Pré-requisitos:**

| SO | Instale |
|---|---|
| Linux | `sudo apt install docker.io docker-compose-v2` (ou o equivalente da sua distro — veja [docker.com/engine/install](https://docs.docker.com/engine/install/)) |
| macOS | [OrbStack](https://orbstack.dev/) (recomendado, ~2× mais rápido em bind mount que Docker Desktop) ou [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Windows | [WSL2](https://learn.microsoft.com/pt-br/windows/wsl/install) + [Docker Desktop](https://www.docker.com/products/docker-desktop/) com integração WSL habilitada |

> **Usuários Windows:** clone seu repo dentro do filesystem do WSL (`/home/...`) — não em `/mnt/c/...` — pra performance nativa. Bind mounts atravessando a fronteira Windows/WSL são 10–20× mais lentos pra I/O de muitos-arquivos-pequenos que `git worktree add` faz..

**Alternativa via Compose:**

```bash
# usa o compose.yaml do repo (compila a imagem na primeira execução)
export OPENROUTER_API_KEY=sk-or-...
docker compose run --rm huu run example.pipeline.json
```

**Wrapper de conveniência:** copie [`scripts/huu-docker`](scripts/huu-docker) pro seu `PATH` pra abreviar tudo acima pra `huu-docker run pipeline.json`.

**Modo isolated-volume** (perf máxima no macOS / Windows, isolamento total do filesystem): aponta o huu pra colocar worktrees num named volume em vez de dentro do repo bind-mounted. As operações de branch continuam no repo (então o branch de integração ainda aparece no seu `git log` local); só o scratch space por agente vai pro volume rápido.

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

`HUU_WORKTREE_BASE` aceita path absoluto (usado verbatim) ou relativo (resolvido contra a raiz do repo). Quando setado, `git worktree list` no host não mostra os trees por agente durante a execução — é o trade-off pelo speedup.

**Docker secrets** pra `OPENROUTER_API_KEY`. O wrapper auto-Docker cuida disso: escreve a chave num arquivo modo `0600` em `/dev/shm` (tmpfs no Linux — nunca toca o disco; fallback pra `os.tmpdir()` em outros sistemas) e bind-monta read-only em `/run/secrets/openrouter_api_key` dentro do container. O valor nunca aparece em `docker inspect`, nunca aparece em `ps auxf` (o wrapper passa outras env vars na forma sem valor `-e VAR`, e `OPENROUTER_API_KEY` é entregue 100% via o file mount), e é desvinculado do host assim que o wrapper sai. Se o wrapper for morto à força (`kill -9`, OOM), a próxima invocação poda secret files vagantes no mesmo sweep que poda containers órfãos.

Pra setups via Compose, o padrão canônico continua funcionando:

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

A imagem checa `/run/secrets/openrouter_api_key` antes de cair pra `OPENROUTER_API_KEY_FILE` e finalmente pra env var nua — mesma precedência que a imagem do postgres usa.

**Variantes da imagem:** `huu:latest` (~613MB) traz `openssh-client` pra git remotes via SSH. `huu:slim` (~604MB; build-arg `INCLUDE_SSH=false`) descarta isso pra setups HTTPS-only.

**Pipelines empacotados (cookbook):** a imagem oficial traz os pipelines de referência do repo em `$HUU_COOKBOOK_DIR` (`/opt/huu/cookbook/`). Puxe um pipeline curado pro seu repo sem clonar nada:

```bash
docker run --rm ghcr.io/frederico-kluser/huu:latest \
  cat "$HUU_COOKBOOK_DIR/demo-rapida.pipeline.json" \
  > demo-rapida.pipeline.json
```

**Inspecionar um pipeline rodando (monitoramento headless):** quando o container está em detached numa execução noturna longa, `huu status` parsa o `.huu/debug-*.log` mais recente e reporta a fase da execução + última atividade:

```bash
# de dentro do container (via compose attach ou docker exec)
docker compose -f compose.huu.yaml exec huu huu status

# ou contra seu repo bind-mounted, do host (sem container)
huu status
huu status --json | jq '.phase'
huu status --liveness && echo healthy   # exit 0 se rodando, 1 caso contrário
```

Saída de exemplo:

```
huu status — /home/user/myproject
  log:           .huu/debug-2026-04-28T20-10-15Z.log (4.2 MiB)
  status:        running
  started:       12m 4s ago
  last event:    180ms ago
  last activity: 1.2s ago (orch.spawn_start)
  heartbeat:     180ms ago, lag=8ms
  counters:      stages=2 spawns=12 errors=0
```

Exit codes pipeline-friendly: `0` pra rodando ou terminado bem, `1` pra travado ou crashado, `2` se nenhum log de execução foi encontrado.

A imagem também conecta `huu status --liveness` num `HEALTHCHECK` do Docker. O launcher do TUI escreve `/tmp/huu/active` com o path do repo da execução ativa; o probe lê esse path e pergunta pro `huu status` se a execução tá quebrada. Um container ocioso (sem execução ativa, e.g. parado na tela de boas-vindas) é reportado como saudável. Execuções travadas ou crashadas viram o status do container pra `unhealthy`, que orquestradores (Compose `restart`, Swarm, shims do Kubernetes) podem usar.

**Scaffolding de Docker no seu próprio repo:** de qualquer projeto onde você queira o huu sob Docker, rode:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" \
  ghcr.io/frederico-kluser/huu:latest \
  init-docker --with-wrapper --with-devcontainer
```

Isso escreve `compose.huu.yaml`, `scripts/huu-docker`, e `.devcontainer/devcontainer.json` no seu repo, todos pré-configurados pra puxar a imagem publicada. Execuções subsequentes são só `docker compose -f compose.huu.yaml run --rm huu run pipeline.json`.

Pra setups multi-modo (host-bind, isolated-volume, dev-container) e detalhes de performance/segurança, veja [`docker-roadmap.md`](docker-roadmap.md).

---

## Início rápido (instalação nativa)

```bash
# 1. Instale (Node 20+ e um `git` funcional)
npm install -g huu-pipe

# 2. Teste o fluxo sem gastar tokens (agente stub, sem LLM)
huu --stub

# 3. Rode um pipeline real
export OPENROUTER_API_KEY=sk-or-...
huu run example.pipeline.json
```

`example.pipeline.json` (que vem junto com o repo) faz exatamente isto:

```json
{
  "_format": "huu-pipeline-v1",
  "pipeline": {
    "name": "exemplo-padronizar-headers",
    "steps": [
      {
        "name": "Padronizar headers",
        "prompt": "Adicione um cabecalho JSDoc no topo de $file com @author huu.",
        "files": ["src/cli.tsx", "src/app.tsx"]
      },
      {
        "name": "Gerar CHANGELOG",
        "prompt": "Crie ou atualize o arquivo CHANGELOG.md ...",
        "files": []
      }
    ]
  }
}
```

> Os exemplos que vêm no repo já estão em português (a língua nativa do autor). O formato do pipeline é agnóstico de idioma — escreva seus prompts em qualquer língua que o modelo entenda.

O que você vai ver numa execução real:

1. O picker de modelos (catálogo do OpenRouter, com seus recentes fixados no topo).
2. Um kanban ao vivo com um cartão por agente — fase, tokens, custo, arquivo atual.
3. Depois que todos os estágios terminam: uma tela de resumo, mais transcrições por agente em `.huu/<runId>-execution-...log`.
4. No disco: um novo branch `huu/<runId>/integration` com o trabalho mergeado, mais os branches por agente preservados pra auditoria via `git log`.

Pipelines que vêm no repo:

| Arquivo | O que faz |
|---|---|
| `example.pipeline.json` (pt-BR) | Adiciona headers JSDoc e escreve uma entrada no CHANGELOG. |
| `pipelines/demo-rapida.pipeline.json` (pt-BR) | Configura testes, escreve um teste por arquivo, roda três auditorias (segurança, qualidade, performance). |
| `pipelines/testes-seguranca.pipeline.json` (pt-BR) | Suíte de regressão focada em segurança. |

---

## Schema do pipeline

Pipelines são persistidos como JSON `huu-pipeline-v1`. O formato completo:

```json
{
  "_format": "huu-pipeline-v1",
  "exportedAt": "2026-04-28T00:00:00.000Z",
  "pipeline": {
    "name": "harden-and-document",
    "cardTimeoutMs": 600000,
    "singleFileCardTimeoutMs": 300000,
    "maxRetries": 1,
    "steps": [
      {
        "name": "Add JSDoc headers",
        "prompt": "Add a JSDoc header on top of $file with @author huu.",
        "files": ["src/cli.tsx", "src/app.tsx"],
        "scope": "per-file",
        "modelId": "anthropic/claude-sonnet-4-5"
      },
      {
        "name": "Refresh the CHANGELOG",
        "prompt": "Update CHANGELOG.md with a new entry summarizing the work above.",
        "files": [],
        "scope": "project"
      }
    ]
  }
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `pipeline.name` | string | Usado como cabeçalho no TUI e nos logs da execução. |
| `steps[].name` | string | Nome de exibição da etapa. |
| `steps[].prompt` | string | Aceita o placeholder `$file` quando `files` não está vazio. |
| `steps[].files` | string[] | Caminhos relativos ao repo. Array vazio roda uma única tarefa que vê o projeto inteiro. |
| `steps[].scope` | `"project" \| "per-file" \| "flexible"`? | Como a etapa decompõe em agentes. `project` = uma única tarefa no projeto inteiro (Files travado). `per-file` = uma tarefa por arquivo selecionado (Files obrigatório). `flexible` = usuário escolhe na hora de editar (comportamento legado). Omisso = `flexible`. |
| `steps[].modelId` | string? | Override de modelo por etapa; padrão é o escolhido no nível da run. Combine um modelo forte de raciocínio pra planejamento com um mais barato pras edições mecânicas. |
| `cardTimeoutMs` | number? | Timeout por cartão pra cartões de projeto inteiro / multi-arquivo. Padrão `600000` (10 min). |
| `singleFileCardTimeoutMs` | number? | Timeout por cartão pra cartões de arquivo único. Padrão `300000` (5 min). |
| `maxRetries` | number? | Retries por cartão em caso de timeout/falha, em worktrees novos a partir do HEAD de integração atual. Padrão `1`. |

> Timeouts valem **por cartão**, não pra execução como um todo. Trabalho de arquivo único tem latência muito diferente de trabalho de projeto inteiro, daí os dois botões.

O editor de pipeline (`N` pra criar uma etapa, `T` pra timeouts, `M` pro picker de modelo) cuida de tudo isso sem você sair do TUI. Referência completa de teclado: [`docs/KEYBOARD.md`](docs/KEYBOARD.md).

---

## Pipelines como artefato compartilhável

Um pipeline é um artefato reusável. Um `security-tests.pipeline.json` que funciona num repo Node funciona em outro. O know-how de "como decompor essa classe de tarefa" fica capturado em JSON — não na cabeça de quem rodou um agente interativo numa tarde.

Essa assimetria é a graça toda:

- **Escrever um pipeline é o trabalho.** Dá pensamento pra fatiar uma tarefa em unidades independentes, escolher modelos por estágio, e definir o que `pronto` significa.
- **Rodar o pipeline bom de outra pessoa é barato.** Clone o JSON, aponte pro seu repo, rode.

A intenção é um cookbook comunitário de pipelines: publicado como JSON puro num repo público, tipicamente sob MIT ou CC0, livre pra usar no trabalho ou em casa. O runner é open-source (Apache 2.0); pipelines que você escreve são *seus*. Jogue num gist, no seu repo, num PR pro `huu/cookbook` — o humano subscreveu, o formato faz eles serem portáteis.

> 🚧 O registro `huu/cookbook` está no roadmap — até lá, compartilhe pipelines via gists ou seus próprios repos; o formato é estável o bastante pra eles continuarem funcionando.

---

## Filosofia

**O nome é o produto.** `huu` significa **Humans Underwrite Undertakings** — humanos subscrevem empreitadas:

- **Humans (humanos)** — o pipeline é escrito por uma pessoa, não gerado por um planner LLM.
- **Underwrite (subscrever)** — no sentido financeiro: o humano assina embaixo, assume responsabilidade e garante o escopo. O sistema não tem direito a negociar.
- **Undertakings (empreitadas)** — pedaços discretos e bem escopados de trabalho, cada um com um resultado claro.

`huu` *não é um agente autônomo*. É um executor que roda um plano que você escreveu. A inteligência mora no pipeline — não no sistema. Se o pipeline foi mal projetado, o resultado vai ser previsivelmente e auditavelmente ruim. Isso é uma feature.

Três premissas:

1. O autor do pipeline é dono do escopo de cada etapa.
2. Etapas bem projetadas isolam edições por arquivo, eliminando conflitos por design.
3. Previsibilidade e auditabilidade ganham de sofisticação.

Se você quer um agente que *decide* o que fazer, use Devin, Plandex ou Claude Code. Se você quer um sistema que executa *exatamente* o que você subscreveu, em paralelo, com trilha de auditoria nativa do git, este é o produto.

### Por que a gente não usa MCP

MCP virou padrão de fato em 2026 e é uma tentação óbvia. A gente recusa a integração por uma razão econômica concreta: cada definição de tool é re-enviada a cada turno de cada agente.

Concretamente: um único servidor MCP (ex.: GitHub MCP) injeta ~55k tokens de definições de tool por turno. Com 10 agentes em paralelo, isso são **~550k tokens de overhead por turno**, antes da primeira edição. Pra um produto cuja proposta é *paralelismo barato e auditável*, MCP inverte o trade-off.

Os casos de uso suportados (testes, auditorias, refatorações) precisam ler arquivos, rodar comandos shell e editar arquivos. As tools padrão do Pi SDK (read/bash/edit/write) cobrem tudo isso sem overhead. Integrações com Jira, Linear ou Slack ficam deliberadamente fora de escopo — `huu` é um produto de transformação de código, não um agente de produtividade de propósito geral.

### Resolução de conflito como fallback

Quando a decomposição do operador acidentalmente coloca trabalho sobreposto no mesmo estágio, um agente de integração ancorado em um LLM real sobe num worktree lateral pra resolver e comitar. Pipelines que seguem a regra "uma tarefa, um arquivo" nunca caem nesse caminho. Encare como rede de segurança, não como feature pra contar com ela. A resolução de conflito fica desabilitada no modo `--stub`.

---

## Segurança em paralelo: isolamento de portas por agente

`git worktree` isola o **filesystem**. Não isola a **rede do host**: quando dez agentes sobem `npm run dev` ao mesmo tempo (ou `vite`, `next dev`, `pytest --serve`, um Postgres embutido…), todos chamam `bind(3000)` no mesmo kernel. Nove falham com `EADDRINUSE` — e os agentes, acreditando corretamente que o código do cliente está certo, gastam tokens "consertando" um não-bug.

`huu` defende em quatro camadas, nenhuma delas exigindo Docker:

1. **`PortAllocator`** — cada agente recebe uma janela contígua de portas TCP (default `55100 + (agentId − 1) × 10`). Antes de comprometer, sonda cada porta com `net.createServer({ exclusive: true })` e desliza a janela pra frente se algo no host (Postgres rodando há horas, language server da IDE…) já ocupa parte do range.
2. **`.env.huu` por worktree** — um arquivo de env dedicado (nunca `.env` ou `.env.local`, que são seus pra controlar) exportando `PORT`, `HUU_PORT_HTTP`, `HUU_PORT_DB`, `HUU_PORT_WS`, `DATABASE_URL` e sete extras. Frameworks que respeitam dotenv (Next, Vite, Nest, Astro, dotenv-flow…) carregam automaticamente quando rodando do worktree.
3. **Interceptador nativo de `bind()`.** Uma biblioteca compartilhada de ~150 linhas em C em [`native/port-shim/port-shim.c`](native/port-shim/port-shim.c). Na primeira execução, o orquestrador compila com `cc` em `.huu-cache/native-shim/<os>-<arch>/huu-port-shim.{so,dylib}` e pré-carrega via `LD_PRELOAD` (Linux) ou `DYLD_INSERT_LIBRARIES` (macOS). O shim lê `HUU_PORT_REMAP` (ex.: `3000:55110,5432:55111,*:55110`) e reescreve a porta na fronteira da syscall. **O código do cliente nunca é modificado** — `app.listen(3000)` literal no fonte continua exatamente assim; o kernel só vê uma porta única por agente no lugar. (Na imagem Docker oficial o runtime não tem `cc`; o builder pré-compila o `.so` e `HUU_NATIVE_SHIM_PATH` pula o compile-on-demand. Veja [PORT-SHIM.md §6.4](PORT-SHIM.md).)
4. **System prompt** — o agente recebe as portas alocadas e a instrução de prefixar comandos não-dotenv-aware com o wrapper `./.huu-bin/with-ports <comando>`, que faz `source .env.huu` e `exec` do binário-alvo pra que `LD_PRELOAD` sobreviva a fronteiras de `bash -c`.

### O que isso cobre — e o que não cobre

O interceptor só funciona pra código que passa pelo loader dinâmico da libc. Qualquer coisa que faz bypass da libc — binários totalmente estáticos, runtimes em sandbox — fica invisível pra `LD_PRELOAD` por design. A matriz honesta:

| Cenário | Coberto? |
|---|---|
| **Node / JS / TS** (Express, Next, Vite, Nest, Astro, Fastify, Hono) lendo `process.env.PORT` | ✅ via dotenv |
| **`app.listen(3000)` hardcoded** em qualquer linguagem com link dinâmico | ✅ via interceptor de `bind()` |
| **Python** (CPython 3, Django, FastAPI, Flask, `python -m http.server`) | ✅ via interceptor |
| **Ruby** (MRI), **PHP**, **Perl**, **Lua** | ✅ via interceptor |
| **Go** com cgo (default na maior parte das distros Linux) | ✅ via interceptor |
| **Rust** linkando contra a libc do sistema (target `gnu` default) | ✅ via interceptor |
| Processos **JVM** (java, kotlin, scala) em Linux/macOS | ✅ via interceptor |
| **Go estaticamente linkado** (`CGO_ENABLED=0`) — comum em distroless/scratch | ❌ libc é completamente bypassada |
| **Rust** em targets `musl` estáticos (Alpine, distroless) | ❌ libc é completamente bypassada |
| Hosts **Windows** | ❌ não há equivalente a `LD_PRELOAD`; cai pro modo só-env |
| Hosts sem compilador C (`cc` não está no `PATH`) | ❌ shim não compila; cai pro modo só-env (warning no log). A imagem Docker oficial contorna isso embarcando um `.so` pré-compilado — veja PORT-SHIM.md §6.4. Imagens derivadas que removem o prebuilt sem instalar `cc` perdem a camada 3. |
| **macOS** com binários protegidos pelo SIP (`/usr/bin/python3` do sistema) | ❌ vars `DYLD_*` são removidas; use um runtime instalado pelo usuário |

Pra linhas ❌, o caminho só-env continua valendo — frameworks que respeitam `PORT` seguem funcionando, mas portas hardcoded nesses binários vão colidir e um dos agentes perde. Se seu pipeline mira uma stack das linhas ❌, prefira etapas que não exigem bind de rede, ou rode essas etapas com `concurrency = 1` até um caminho de namespace de rede entrar no roadmap.

### Como desabilitar

Adicione `"portAllocation": { "enabled": false }` no pipeline. Sem isso, os agentes compartilham as portas do host e dev servers concorrentes vão colidir. Desabilite pra pipelines que nunca abrem socket (refatorações puras, análise estática, geração de doc) — é barato, mas grátis é mais barato.

---

## Previsibilidade de custo

O custo de uma execução do `huu` é limitado pelo número de cartões e pelo modelo escolhido por estágio. Não existe um loop de agente que pode decidir "também fazer X" — você recebe a execução que pagou.

**Ferramentas de hoje pra manter o custo no controle:**

- `--stub` roda o fluxo todo sem nenhum LLM. Use pra validar a estrutura e a decomposição do pipeline antes de gastar um dólar.
- O `modelId` por etapa permite rotear estágios mecânicos pra Haiku/Gemini Flash e reservar Sonnet/Opus pros estágios que de fato precisam.
- Tokens e custo são registrados por agente e aparecem no resumo da execução; detalhamento completo em `.huu/<runId>-execution-...log`.

**Roadmap:** `huu estimate <pipeline.json>` vai fazer um dry-run da decomposição e produzir uma previsão tipo:

```
5 estágios × 12 tarefas × Sonnet 4.5: estimado em $3.40, ~14 min de tempo de relógio.
```

Até isso chegar, a convenção é: validar com stub primeiro, depois rodar com olho no kanban durante o primeiro estágio pra pegar surpresas cedo.

---

## Configuração

**Variáveis de ambiente**

| Variável | Obrigatória | Pra que serve |
|---|---|---|
| `OPENROUTER_API_KEY` | sim (sem `--stub`) | Enviada pro OpenRouter via Pi SDK. Se faltar, o TUI pede na primeira execução real e não persiste nada. |
| `OPENROUTER_API_KEY_FILE` | não | Caminho de um arquivo contendo a chave. Tem precedência sobre `OPENROUTER_API_KEY` quando ambos estão setados; o mount canônico de Docker secret em `/run/secrets/openrouter_api_key` tem precedência sobre ambos. |
| `HUU_WORKTREE_BASE` | não | Override do diretório base dos worktrees por execução. Paths absolutos são usados verbatim; paths relativos são resolvidos contra a raiz do repo. Padrão: `<repo>/.huu-worktrees`. Usado pelo modo isolated-volume do container. |
| `HUU_CHECK_PUSH` | não | Quando setado, o preflight verifica se o remote configurado está alcançável antes da execução começar. |
| `HUU_IN_CONTAINER` | não | Setada automaticamente como `1` pela imagem Docker oficial. Usada pelo wrapper pra short-circuit do auto-Docker re-exec (assim o mesmo binário roda o TUI direto dentro do container). |
| `HUU_IMAGE` | não | Override da imagem do container usada pelo wrapper auto-Docker. Padrão: `ghcr.io/frederico-kluser/huu:latest`. Útil pra pinar um release (e.g. `ghcr.io/frederico-kluser/huu:0.2.0`) ou apontar pra um mirror privado. |
| `HUU_NO_DOCKER` | não | Quando setada pra `1` ou `true`, pula o auto-Docker re-exec e roda o huu nativo. Requer o `npm install` local das deps do huu. Útil principalmente pro desenvolvimento do próprio huu. |
| `HUU_DOCKER_PASS_ENV` | não | Lista separada por espaços de nomes de env vars adicionais pra encaminhar pro container. O wrapper sempre encaminha `OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_FILE`, `HUU_CHECK_PUSH`, `HUU_WORKTREE_BASE`, e `TERM` — use isso pra adicionar nomes customizados. |
| `HUU_UID` | não | UID do container nas execuções `docker compose`. Default: `1000` (combina com o usuário primário padrão de hosts Debian/Ubuntu e com o usuário `node` da imagem base). Override com `HUU_UID=$(id -u)` se seu UID no host não for 1000, ou use o wrapper `scripts/huu-compose` que seta isso automaticamente. |
| `HUU_GID` | não | GID do container nas execuções `docker compose`. Mesmas regras de default que `HUU_UID`. |

**Arquivos escritos pela ferramenta**

| Caminho | Escopo | Pra que serve |
|---|---|---|
| `~/.huu/recents.json` | global | Modelos usados recentemente, pro picker. |
| `<repo>/.huu-worktrees/<runId>/` | repo | Um subdiretório por agente durante a execução; removido no fim (manifesto preservado). |
| `<repo>/.huu/<stamp>-execution-<runId>.log` | repo | Transcrição cronológica completa de uma execução. |
| `<repo>/.huu/<stamp>-execution-<runId>/agent-<id>.log` | repo | Transcrição por agente. |
| `<repo>/.huu/debug-<ISO>.log` | repo | Trace de debug em NDJSON, uma linha por evento de ciclo de vida. |
| `<repo>/.huu-cache/native-shim/<os>-<arch>/` | repo | Interceptor de `bind()` compilado (veja [isolamento de portas](#segurança-em-paralelo-isolamento-de-portas-por-agente)). Compilado uma vez, reaproveitado entre execuções. |
| `<worktree>/.env.huu` | por agente | Atribuições de porta do agente; carregado automaticamente por ferramentas dotenv-aware. |
| `<worktree>/.huu-bin/with-ports` | por agente | Wrapper shell que faz `source .env.huu` e `exec` do comando — necessário pra binários que ignoram dotenv. |

Quando rodando sob Docker (modo host-bind, padrão), todos esses caminhos ficam visíveis no filesystem do host depois que o container termina — igual a uma execução nativa.

`huu` adiciona automaticamente `.huu-worktrees/`, `.huu/`, `.huu-cache/`, `.env.huu` e `.huu-bin/` ao `.gitignore` do repo na primeira execução.

**Modelos recomendados**

`recommended-models.json` traz uma short-list curada que aparece no topo do picker de modelos. Edite a gosto; `id` precisa bater com um identificador de modelo do OpenRouter.

**Arquitetura, decisões de design e regras de import por camada:** veja [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Guia em nível de skill pra contribuidores fica em `.agents/skills/`.

**Referência de teclado:** veja [`docs/KEYBOARD.md`](docs/KEYBOARD.md).

---

## FAQ

**Posso rodar isso sem supervisão, durante a madrugada?**
Pode — é o caso de uso principal. Cada agente tem timeouts e retries; a execução se encerra sozinha com um resumo persistido. Leia `.huu/<runId>-execution-*.log` de manhã. Pra ser notificado quando terminar, plugue o exit code do CLI num notificador (ntfy, webhook, incoming-webhook do Slack, o que você usar).

**A execução vai mexer no meu branch atual?**
Não. Cada agente trabalha no seu próprio worktree, ramificado a partir do seu HEAD atual. Seu working tree não é modificado durante a execução.

**Preciso comitar antes de rodar?**
Sim. O preflight se recusa a começar com working tree sujo. Faça stash ou commit antes.

**O que acontece se um agente quebra no meio da execução?**
O orquestrador marca o cartão como falho, descarta o worktree dele e (dependendo de `maxRetries`) re-spawna a tarefa em um worktree novo no mesmo HEAD de integração. Se os retries acabarem, a execução continua sem aquele cartão e a falha fica preservada no resumo.

**E se dois agentes tocarem no mesmo arquivo?**
É um sinal de que o pipeline foi mal projetado: num pipeline saudável, cada tarefa de um estágio é dona de um conjunto de arquivos disjunto. Se a sobreposição acontecer mesmo assim e o git não conseguir fazer auto-merge, um agente de integração ancorado em um LLM real resolve o conflito num worktree lateral e segue. A resolução de conflito fica desabilitada no modo `--stub`. Encare esse caminho como rede de segurança, não como feature.

**Dá pra abortar uma execução com segurança?**
Dá. `Q` dispara um abort cooperativo: agentes em voo terminam a etapa atual, branches que têm commits ficam preservados como artefatos, o worktree de integração é limpo. Aperte `Q` de novo pra forçar a saída do dashboard.

**Quanto eu vou gastar?**
Depende do formato do pipeline e do modelo. Um pipeline de 30 arquivos no Sonnet 4.5 tipicamente sai entre $1 e $10. Use `--stub` pra validar a estrutura antes; roteie estágios mecânicos pra modelos mais baratos via `modelId` por etapa. O resumo da execução quebra o custo por agente.

**Por que dois valores de timeout?**
Cartões de arquivo único costumam terminar mais rápido que cartões de projeto inteiro por uma ordem de magnitude. Separar o timeout dá feedback rápido em trabalho por arquivo sem matar prematuramente um cartão mais amplo que ainda está progredindo.

**Onde eu coloco minha chave do OpenRouter?**
Ou exporte `OPENROUTER_API_KEY` antes de iniciar, ou cole no prompt na primeira vez que você começar uma execução sem ela. A própria ferramenta nunca persiste a chave.

**Por que o container Docker é mais lento no macOS?**
Filesystems com bind mount no macOS atravessam uma fronteira de VM, adicionando ~3× de latência pra operações de muitos-arquivos-pequenos como `git worktree add`. Use [OrbStack](https://orbstack.dev/) em vez do Docker Desktop pra ~2× mais rápido na mesma carga. Pro caminho de performance máxima, veja o modo dev-container em [`docker-roadmap.md`](docker-roadmap.md) — ele clona o repo dentro de um named volume e atinge velocidade nativa Linux.

**Posso rodar o huu no Windows sem WSL2?**
Não na prática. O Docker Desktop no Windows requer WSL2 ou Hyper-V, e paths Windows com bind mount (`/mnt/c/...`) são 10–20× mais lentos que ext4 dentro do WSL — o suficiente pra fazer um `git worktree add` em um pipeline real levar minutos por task. Instale WSL2, clone seu repo em `/home/<user>/` dentro do WSL, e use Docker Desktop com integração WSL habilitada..

**Por que Ctrl+C no container às vezes deixa meu terminal travado?**
Não deveria — a imagem roda `tini` como PID 1 pra encaminhar sinais, e o CLI do `huu` instala um restaurador de raw mode redundante pra `SIGINT`/`SIGTERM`/`SIGHUP`/`uncaughtException`. Se você ainda assim vir um terminal travado, rode `stty sane` pra recuperar e por favor abra uma issue com o conteúdo de `.huu/debug-<ISO>.log` daquela execução.

**Os arquivos em `.huu-worktrees/` ficaram com dono root e não consigo deletar.**
Você está num host onde o usuário primário não é UID 1000 (raro em Linux desktop, comum em macOS ou servidores compartilhados). O default do compose assume UID 1000; se o seu for diferente, o container roda como 1000 e escreve arquivos que o usuário do host não toca. Saídas:

1. Use o wrapper: `scripts/huu-compose run pipeline.json` — auto-detecta seu UID via `id(1)` e exporta `HUU_UID`/`HUU_GID` antes de invocar o compose.
2. Exporte uma vez por shell: `export HUU_UID=$(id -u) HUU_GID=$(id -g)` e depois use `docker compose run` normalmente.

---

## Roadmap

- `huu estimate <pipeline.json>` — dry-run com previsão de custo e tempo de relógio.
- `huu lint <pipeline.json>` — detectar `files` sobrepostos entre estágios, placeholders `$file` faltando, IDs de modelo indefinidos.
- `huu/cookbook` — registro comunitário de pipelines, com cada entrada tagueada por domínio (testes, auditorias, refatorações, docs).
- Wrapper de GitHub Action — rodar um pipeline `huu` como parte de CI num PR com label.
- JSON Schema + LSP pro `huu-pipeline-v1.json` — autocomplete e validação nos editores.

---

## Contribuindo

`huu` é open-source sob [Apache 2.0](LICENSE). Issues e pull requests são bem-vindos.

Regras básicas:

- Leia a skill relevante em `.agents/skills/` antes de mexer numa camada que você não conhece.
- Prefira **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `docs:`, ...).
- Nunca faça force-push pra `main`.
- O CI roda `npm run typecheck && npm test` em todo PR. Rode local antes de abrir.

```bash
npm run dev          # TUI com hot-reload em src/cli.tsx
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest (orchestrator, run logger, file scanner, pipeline e2e)
```

---

## Licença

`huu` (o runner) é licenciado sob a **Apache License 2.0**. Veja [LICENSE](LICENSE) pro texto completo. Você tem liberdade pra usar, modificar e redistribuir comercial e não-comercialmente, com atribuição e uma cópia da licença.

**Pipelines não são o runner.** O formato JSON `huu-pipeline-v1` é uma especificação aberta. Pipelines que você escreve, ou que pega da comunidade, são *seus* (ou do autor original): eles não estão presos pela licença do runner. A convenção do cookbook é MIT ou CC0 — use no trabalho, em casa, em qualquer lugar.

---

## Autor

**Frederico Guilherme Kluser de Oliveira**
[kluserhuu@gmail.com](mailto:kluserhuu@gmail.com)

`huu` é construído em cima de [`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) — um SDK enxuto e multi-provedor de coding-agent feito por Mario Zechner. O [post dele sobre o design](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) vale a leitura; a sobreposição filosófica não é coincidência.
