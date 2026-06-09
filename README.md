<p align="center">
  <img src="assets/huu-demo.gif" alt="huu gerando 100% de cobertura de testes unitários — 55 minutos acelerados pra 10 segundos" width="720">
</p>

<p align="center">
  <em>55 minutos do <code>huu</code> gerando 100% de cobertura de testes unitários — acelerados pra 10 segundos.</em>
</p>

<h1 align="center">huu</h1>

<p align="center">
  <strong><code>huu</code> — <em>Humans Underwrite Undertakings</em> (humanos subscrevem empreitadas).</strong>
</p>

<p align="center">
  <a href="README.en.md">English</a> · <strong>Português (BR)</strong>
</p>

<p align="center">
  <a href="#licença"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <img alt="Node.js 20+" src="https://img.shields.io/badge/node-%E2%89%A5%2020-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.x-3178C6?logo=typescript&logoColor=white">
  <img alt="Built with Ink" src="https://img.shields.io/badge/TUI-Ink%204-000000">
</p>

---

## O que é o huu

**Um pipeline é um arquivo de ordens que a IA obedece.** Você escreve
um `huu-pipeline-v1.json` listando os passos e os arquivos que cada
passo toca. O orchestrator transforma cada passo em um fan-out de
agentes paralelos — um agente por arquivo quando você pede assim —
roda eles em worktrees git isolados, e mescla tudo de volta num único
branch de integração **entre cada etapa**. A execução inteira é
sandboxed em Docker, então o agente nunca vê suas credenciais de shell.

Essa frase tem algumas afirmações que vale destacar:

- **O humano subscreve o escopo.** Nenhum planner LLM decide o que o
  passo 3 deve fazer ou quais arquivos ele deve tocar. Se um passo for
  mal projetado, o resultado vai ser previsivelmente e auditavelmente
  errado — não surpreendentemente errado.
- **Em modo `per-file`, um agente recebe um arquivo.** O prompt é
  idêntico entre os N agentes — só `$file` é substituído. Sem
  degradação de contexto entre agentes, sem drift de escopo. O Pi
  coding agent (backend padrão) roda com `thinking=medium` pra que o
  modelo troque latência por qualidade na sua missão única.
- **Pipelines são portáteis, não presos a um provider.** Um
  `huu-pipeline-v1.json` é um artefato versionado — comite, compartilhe
  como gist, contribua pro cookbook. O know-how de *como decompor essa
  classe de tarefa* mora em JSON puro.

### Etapa → merge → etapa

```mermaid
flowchart LR
    subgraph Docker["🐳 Docker (sandboxed, sem credenciais de shell)"]
        direction TB
        H["Integration HEAD<br/>(base da etapa N)"]
        H --> F1["Agente 1<br/>worktree"]
        H --> F2["Agente 2<br/>worktree"]
        H --> F3["Agente N<br/>worktree"]
        F1 --> M["Merge<br/>git merge --no-ff"]
        F2 --> M
        F3 --> M
        M --> H2["Integration HEAD<br/>(base da etapa N+1)"]
        M -. conflito .-> R["Agente de integração LLM<br/>(worktree lateral)"]
        R --> H2
    end
```

Cada etapa ramifica N agentes a partir do HEAD de integração, deixa
eles trabalharem em paralelo nos seus próprios worktrees, e mescla
tudo de volta **antes** da próxima etapa começar. O worktree de
integração nunca dá rewind — loops re-executam em cima do HEAD atual,
acumulando commits. Conflitos caem num agente de integração LLM
lateral (pulado no modo `--stub`).

### Scope per-file: um agente, uma missão

```mermaid
flowchart LR
    P["Prompt do step:<br/>'Teste $file'<br/>scope: per-file"]
    P --> A1["Agente 1<br/>$file = src/a.ts"]
    P --> A2["Agente 2<br/>$file = src/b.ts"]
    P --> A3["Agente 3<br/>$file = src/c.ts"]
    P --> A4["Agente 4<br/>$file = src/d.ts"]
    A1 --> Out["4 commits paralelos<br/>(sem sobreposição por design)"]
    A2 --> Out
    A3 --> Out
    A4 --> Out
```

Mesmo prompt, `$file` diferente. Agentes leem o worktree inteiro pra
contexto mas são instruídos a escrever só no arquivo atribuído —
escritas disjuntas geram merges limpos. **Aqui está a sacada
revolucionária: seu pipeline é o contrato, e o contrato escala
horizontalmente.**

---

## Showcase: huu Test Suite

`huu Test Suite` é o pipeline default materializado na primeira
execução. Ele demonstra porque misturar scope `project` e `per-file` é
a receita.

| # | Step | Scope | O que faz |
|---|---|---|---|
| 1 | Analisa stack e escreve `huu-tests.md` | `project` | Detecta a linguagem (Node / Python / Go / Rust / Java / .NET), verifica o test runner, escreve o **plano** que todos os passos seguintes obedecem. |
| 2 | Testa 3 arquivos representativos | `project` | Escolhe 3 arquivos diversos de lógica de negócio, escreve testes, corrige falhas, adiciona aprendizados em `huu-tests-faq.json`. |
| 3 | **Testa `$file` (escolhido pelo usuário)** | `per-file` | **N agentes em paralelo, cada um recebe um arquivo.** Cada um segue o `huu-tests.md`, escreve um teste, acumula no FAQ. |
| 4 | Limpeza final + badge de cobertura | `project` | Roda a suíte completa, deleta só os **blocos** com falha (nunca arquivos inteiros), atualiza o badge no README. |

Step 1 escreve um contrato; step 3 faz 30 agentes obedecerem em
paralelo; step 4 valida. **Planeje em `project`, execute em
`per-file`, valide em `project`** — o template pra tudo o mais.

Passo a passo com prompts:
[`docs/onboarding.pt-BR.md#exemplo-passo-a-passo`](docs/onboarding.pt-BR.md#exemplo-passo-a-passo).

---

## O que mais você pode construir

Um pipeline é um artefato criativo. Seis outros defaults vêm na
caixa, e um autor criativo pode escrever qualquer coisa que se encaixe
no formato **planejar → fan-out → mergear**:

- **huu Agent Knowledge** (default empacotado). O conhecimento
  progressivo levado ao limite: recon do projeto, estudo profundo por
  arquivo convergindo em `.huu/knowledge/findings.json`, síntese de
  tópicos, e a compilação final em **Agent Skills**
  ([spec](https://agentskills.io/specification)) sob `.agents/skills/`
  — uma skill por tópico mais a skill roteadora `project-knowledge`
  que qualquer agente futuro (huu, Claude Code, Codex, Cursor) carrega
  primeiro pra saber qual skill puxar. Um step `check` valida as
  skills geradas e devolve pro passo anterior se algo violar a spec.
- **Pipeline de segurança.** Escolha à mão os arquivos que quer
  auditar, passe o threat model e padrões (OWASP, CWE) como
  documentação, paralelize scans por arquivo. Etapa 1 monta um
  `THREAT-MODEL.md`. Etapa 2 ramifica N agentes, cada um scanning um
  arquivo contra o modelo. Etapa 3 consolida findings e escreve o
  roadmap de remediação. Todos os worktrees mergeiam num único branch
  de integração.
- **Migração massiva.** *Migrar 40 testes Mocha pra Vitest:* etapa 1
  audita patterns em `MIGRATION.md`, etapa 2 ramifica 40 agentes (um
  por arquivo de teste), etapa 3 roda `npm test` e atualiza o
  `CHANGELOG.md`.
- **Auditorias de Docs / Quality / Performance / Refactor** vêm como
  pipelines default empacotados — só-relatório estrito, nunca tocam
  seus manifests ou source de produção.
- **Sua ideia.** Se você consegue escrever o plano como uma lista
  ordenada de steps com prompts e um `scope`, você consegue rodar.
  O formato do pipeline é estável; o cookbook é aberto.

Defaults empacotados:
[`docs/onboarding.pt-BR.md#pipelines-default-empacotados`](docs/onboarding.pt-BR.md#pipelines-default-empacotados).

---

## Backends — qualquer modelo, sua escolha

```mermaid
flowchart LR
    K["kind: 'pi' | 'copilot' | 'stub'"]
    K --> R["selectBackend()<br/>registry.ts"]
    R --> P["Pi<br/>(OpenRouter, qualquer modelo)"]
    R --> C["Copilot<br/>(estabilizando)"]
    R --> S["Stub<br/>(sem LLM, smoke)"]
```

| Backend | Flag | Modelo de custo | Status |
|---|---|---|---|
| **Pi** (padrão) | `--backend=pi` | Por-token via `OPENROUTER_API_KEY` — **qualquer modelo OpenRouter** | Recomendado |
| GitHub Copilot | `--copilot` | Assinatura via `COPILOT_GITHUB_TOKEN` | Estabilizando |
| Stub | `--stub` | Grátis, sem LLM — smoke tests / demos | Estável |

A factory do Pi habilita `thinking=medium` por padrão pra todo modelo
que suporta — o modelo pode rascunhar, criticar e revisar internamente
antes de emitir uma resposta final. Pra trabalho per-file (um agente,
uma missão), esse é o trade-off certo. Todos os três backends
compartilham o mesmo orchestrator, ciclo de vida de worktree e lógica
de merge.

Adicionar um backend futuro (ACP, Claude Code, …) é uma mudança de
uma pasta + um case no registry sob `src/orchestrator/backends/`.

A fundo: [`docs/onboarding.pt-BR.md#backends-a-fundo`](docs/onboarding.pt-BR.md#backends-a-fundo).

---

## Início rápido

### Docker (recomendado)

```bash
git clone https://github.com/frederico-kluser/huu
cd huu
docker build -t huu:local .
export OPENROUTER_API_KEY=sk-or-...
HUU_IMAGE=huu:local huu run example.pipeline.json
```

Imagens pré-buildadas em `ghcr.io/frederico-kluser/huu:latest` — o
wrapper puxa automaticamente quando nenhum `HUU_IMAGE` está setado.
MTU VPN-aware, mount de secrets, forwarding de sinais e limpeza de
órfãos são todos cuidados pelo wrapper.

### Nativo

```bash
npm install -g huu-pipe        # Node 20+ e um `git` funcional
huu --yolo                     # abre a TUI nativa (sem Docker)
```

Execuções nativas expõem suas credenciais de shell pro agente LLM.
Prefira Docker pra qualquer coisa real. Matriz completa de
instalação (macOS / Windows / Linux, notas do OrbStack, caveats do
WSL2): [`docs/onboarding.pt-BR.md#instalação`](docs/onboarding.pt-BR.md#instalação).

---

## Modo headless / um-comando

Pra CI, cron, demos:

```bash
huu auto pipeline.json --config config.json
```

```json
{
  "modelId": "minimax/minimax-m2.7",
  "backend": "pi",
  "files": { "3. Test $file (user-selected)": ["src/index.ts"] },
  "concurrency": 4
}
```

- **stderr** — eventos de progresso em NDJSON (um por mudança de
  estado).
- **stdout** — um objeto JSON final no término (`runId`,
  `integrationBranch`, `totalCost`, …).
- **Exit code** — `0` se `status === 'done'`, `1` caso contrário.

Construa pipes em cima: `huu auto … | jq .runId`. Doc completa:
[`docs/onboarding.pt-BR.md#modo-headless`](docs/onboarding.pt-BR.md#modo-headless).

---

## Schema do pipeline (compacto)

```json
{
  "_format": "huu-pipeline-v1",
  "pipeline": {
    "name": "harden-and-document",
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
        "name": "Refresh CHANGELOG",
        "prompt": "Update CHANGELOG.md summarizing the work above.",
        "files": [],
        "scope": "project"
      }
    ]
  }
}
```

`scope` controla a decomposição: `project` = uma tarefa pro projeto
inteiro, `per-file` = uma tarefa por arquivo (o sweet spot do
paralelismo), `flexible` = usuário escolhe na hora de editar.

Schema completo (timeouts, retries, steps `check` condicionais,
overrides de modelo, alocação de portas):
[`docs/pipeline-json-guide.md`](docs/pipeline-json-guide.md).

---

## Mais

| Tópico | Onde |
|---|---|
| **Tutorial / primeira execução / autoria** | [`docs/onboarding.pt-BR.md`](docs/onboarding.pt-BR.md) |
| **Arquitetura & regras de import em camadas** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| **Operações (Docker, env vars, FAQ, roadmap)** | [`docs/operations.pt-BR.md`](docs/operations.pt-BR.md) |
| **Modo Web UI (`huu --web`)** | [`docs/WEB-UI.md`](docs/WEB-UI.md) |
| **Schema JSON do pipeline** | [`docs/pipeline-json-guide.md`](docs/pipeline-json-guide.md) |
| **Internals do isolamento de portas** | [`docs/PORT-SHIM.md`](docs/PORT-SHIM.md) |
| **Referência de teclado** | [`docs/KEYBOARD.md`](docs/KEYBOARD.md) |
| **Catálogo de skills de agente** | [`agent-skills.md`](agent-skills.md) |
| **Changelog** | [`CHANGELOG.md`](CHANGELOG.md) |

---

## Licença

`huu` (o runner) é licenciado sob **Apache License 2.0**. Veja
[LICENSE](LICENSE) pro texto completo. Você é livre pra usar,
modificar e redistribuir comercialmente e não-comercialmente, com
atribuição e uma cópia da licença.

**Pipelines não são o runner.** O formato JSON `huu-pipeline-v1` é uma
especificação aberta. Pipelines que você escreve ou pega da
comunidade são *seus* (ou do autor original): eles não estão
amarrados à licença do runner. A convenção do cookbook é MIT ou
CC0 — use no trabalho, em casa, onde quiser.

---

## Autor

**Frederico Guilherme Kluser de Oliveira**
[kluserhuu@gmail.com](mailto:kluserhuu@gmail.com)

`huu` é construído em cima de [`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
— um SDK de coding agent lean e multi-provider do Mario Zechner. O
[post dele sobre o design](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
vale a leitura; a sobreposição filosófica não é coincidência.

A integração com GitHub Copilot usa
[`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk)
(declarada como dependência opcional) — fornecendo acesso baseado em
assinatura pra usuários que já têm um plano GitHub Copilot.
