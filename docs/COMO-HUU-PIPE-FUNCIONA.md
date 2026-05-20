# Como o `huu-pipe` Funciona

Este documento explica como o `huu-pipe` foi projetado para ser um comando simples e direto, sem necessidade de configurações mirabolantes.

## O Que é o `huu-pipe`

O `huu-pipe` é a interface de linha de comando (CLI) do projeto **huu** (*Humans Underwrite Undertakings*). Ele é um executor de pipelines de agentes LLM que roda em worktrees git isolados. A ideia central é que você escreve um plano (pipeline JSON), e o `huu` executa esse plano em paralelo, com cada agente trabalhando em seu próprio branch isolado.

## Como Ele Funciona (O Fluxo Simples)

O `huu-pipe` foi projetado para ser usado com um único comando:

```bash
huu run sua-pipeline.json
```

Por trás dos panos, o fluxo é o seguinte:

1.  **Verificação de Ambiente:** O script `cli.tsx` verifica se ele já está rodando dentro de um container Docker (via a variável `HUU_IN_CONTAINER`).
2.  **Auto-Reexecução em Docker:** Se não estiver em um container, o `huu` assume que deve rodar em um para garantir isolamento e segurança. Ele então executa a lógica em `lib/docker-reexec.ts`.
3.  **Pull da Imagem:** O `docker-reexec.ts` monta o comando `docker run` apontando para a imagem padrão: `ghcr.io/frederico-kluser/huu:latest`.
4.  **Execução:** O Docker inicia o container, monta seu diretório atual (`$PWD`) e executa o comando que você passou.

**A filosofia é:** você não precisa saber de Docker, Node.js, ou qualquer outra dependência. Se o Docker está instalado, o `huu` cuida de tudo.

### Flags úteis para o fluxo de execução

A CLI aceita um conjunto pequeno de flags que compõem com `run`,
`init-docker`, `status`, `prune` e o modo TUI sem argumentos:

| Flag | Efeito |
|---|---|
| `--stub` | Não chama LLM nenhum. Spawna o `stub-agent` em cada worktree para validar a estrutura da pipeline sem gastar tokens. |
| `--yolo` | Desliga a re-exec em Docker e roda nativo na máquina (mesmo efeito de `HUU_NO_DOCKER=1`). Imprime um warning porque o agente passa a ver `~/.ssh`, `~/.aws`, etc. |
| `--auto-scale` | Liga, no startup, o auto-scaler de concorrência (estado `NORMAL`/`BACKING_OFF`/`DESTROYING`). Também é toggle pela tecla `A` no dashboard. |
| `--help` / `-h` | Imprime o help e a lista de variáveis de ambiente do registry de API keys. |

## O Erro `denied: denied` e Suas Alternativas

Em algumas situações, ao rodar o comando pela primeira vez, você pode se deparar com o seguinte erro:

```
huu: pulling ghcr.io/frederico-kluser/huu:latest (~600MB, first time only — subsequent runs are instant)
Unable to find image 'ghcr.io/frederico-kluser/huu:latest' locally
docker: Error response from daemon: error from registry: denied
denied
```

Este erro ocorre ao tentar fazer o download (*pull*) da imagem do GitHub Container Registry (GHCR).

### Por Que Isso Acontece?

A causa raiz é quase sempre **credenciais do Docker cacheadas e inválidas** para o GHCR.

Aqui está o que ocorre:
1.  O Docker mantém um arquivo de configuração em `~/.docker/config.json`.
2.  Se você alguma vez rodou `docker login ghcr.io` (para qualquer projeto), o Docker salvou um token de acesso pessoal (PAT) nesse arquivo.
3.  Quando você tenta fazer o `pull` de qualquer imagem do GHCR — **mesmo que seja pública** — o Docker envia automaticamente essas credenciais cacheadas.
4.  Se esse token expirou, foi revogado, ou é inválido, o GHCR rejeita a requisição com o erro `denied: denied`.
5.  O GHCR não "cai para trás" para um acesso anônimo quando recebe credenciais inválidas; ele simplesmente nega.

### As Alternativas e Escolhas

Abaixo estão as soluções, ordenadas da mais simples para a mais robusta.

#### 1. Limpar as Credenciais Cacheadas (A Solução Mais Rápida)

Se você não precisa estar autenticado no GHCR para outros projetos, a solução mais simples é remover as credenciais inválidas.

```bash
docker logout ghcr.io
```

**O que isso faz:** Remove as entradas do GHCR do seu `~/.docker/config.json`. Ao tentar o `pull` novamente, o Docker não enviará credenciais, e o GHCR permitirá o acesso anônimo à imagem pública.

**Quando usar:** Quando você está apenas testando o `huu` ou não precisa de acesso a imagens privadas no GHCR.

#### 2. Buildar a Imagem Localmente (A Escolha Recomendada)

A documentação oficial do `huu` recomenda este caminho como o principal. Ele elimina completamente a dependência de qualquer registry externo.

```bash
# 1. Clone o repositório do huu
git clone https://github.com/frederico-kluser/huu
cd huu

# 2. Build a imagem localmente
docker build -t huu:local .

# 3. Execute o huu apontando para a imagem local
HUU_IMAGE=huu:local huu run sua-pipeline.json
```

**O que isso faz:** Compila o container a partir do `Dockerfile` presente no repositório. A variável de ambiente `HUU_IMAGE` instrui o `huu` a usar sua imagem local `huu:local` ao invés de tentar o pull do GHCR.

**Quando usar:** Esta é a melhor opção para uso contínuo. Você tem controle total sobre a imagem, não depende da disponibilidade do GHCR, e evita problemas de autenticação.

#### 3. Rodar Nativamente sem Docker (Para Desenvolvedores)

Se você tem o ambiente Node.js configurado e prefere não usar Docker, pode rodar o `huu` diretamente. Existem dois caminhos equivalentes:

```bash
# 1. Instale as dependências do projeto huu
npm install

# 2a. Use a flag --yolo (recomendado, composável com tudo)
huu --yolo run sua-pipeline.json
huu --yolo --stub                # stub agent + sem Docker
huu --yolo                       # abre a TUI nativo

# 2b. Ou use a variável de ambiente equivalente
HUU_NO_DOCKER=1 huu run sua-pipeline.json
```

**O que isso faz:** Tanto `--yolo` quanto `HUU_NO_DOCKER=1` instruem o `huu` a pular a etapa de re-execução em container e rodar o código Node.js diretamente na sua máquina. O wrapper imprime uma única linha de warning no stderr lembrando da implicação de segurança.

**Quando usar:** Útil se você está desenvolvendo o próprio `huu` ou se o overhead do Docker não é desejado. **Nota:** O agente LLM terá acesso ao seu ambiente de shell local (`~/.ssh`, `~/.aws`, etc.), o que pode ser uma preocupação de segurança.

#### 4. Re-autenticar no GHCR (Se Você Precisa do Registry)

Se você prefere usar a imagem pré-construída do GHCR e precisa resolver o erro de autenticação, gere um novo token de acesso.

```bash
# 1. Gere um Personal Access Token (PAT) no GitHub com o escopo 'read:packages'
#    Acesse: https://github.com/settings/tokens

# 2. Faça login no GHCR
docker login ghcr.io -u SEU_USUARIO_GITHUB -p SEU_PAT_AQUI
```

**O que isso faz:** Atualiza o `~/.docker/config.json` com um token válido, permitindo que o Docker faça o pull da imagem.

**Quando usar:** Se você está em um ambiente corporativo que usa imagens privadas no GHCR e precisa manter a autenticação ativa.

## Resumo das Escolhas

| Alternativa | Comando | Esforço | Melhor Para |
|---|---|---|---|
| **Logout do GHCR** | `docker logout ghcr.io` | 10 segundos | Resolver rapidamente o erro `denied`. |
| **Build Local** | `docker build -t huu:local .` + `HUU_IMAGE=huu:local` | 5 minutos (primeira vez) | Uso contínuo, independência de registry, controle total. |
| **Modo Nativo (`--yolo`)** | `huu --yolo run ...` (ou `HUU_NO_DOCKER=1 huu run ...`) | 2 minutos (setup) | Desenvolvimento do `huu` ou preferência por não usar Docker. |
| **Re-login no GHCR** | `docker login ghcr.io ...` | 5 minutos | Ambientes que exigem autenticação no GHCR. |

A escolha final depende do seu contexto. Para a maioria dos usuários que querem apenas "fazer o comando funcionar", a **Alternativa 1 (Logout)** é o caminho mais direto. Para um uso robusto e sem surpresas, a **Alternativa 2 (Build Local)** é a recomendada pelo projeto.

## E Quando Eu *Não* Tenho uma Pipeline?

Você não precisa escrever JSON na mão. Abra o `huu` sem argumento (`huu`
ou `huu --yolo` para nativo) e na tela de boas-vindas pressione **`A`**:
isso abre o **assistente de pipeline**, que segue este fluxo:

1. Pede um modelo barato pra conduzir a entrevista (default já vem
   configurado).
2. Você descreve em uma frase o que quer (ex.: *"adiciona JSDoc em todo
   helper de src/utils"*).
3. O huu spawna **4 agentes de reconhecimento em paralelo** que recebem
   o mesmo digest do projeto (`package.json`, file tree, README,
   CLAUDE.md, AGENTS.md, tsconfig.json) e cospem ≤5 bullets cada — modo
   *single-pass, digest-only*, sem ferramentas, sem loop, então custa
   pouco e termina rápido.
4. Com esses bullets injetados no system prompt, o assistente faz no
   máximo **8 perguntas** (múltipla escolha + escape em texto livre) e
   monta uma `PipelineDraft`.
5. A draft é convertida pra `huu-pipeline-v1` e abre direto no editor —
   você revisa, ajusta, e roda com `G`.

## Auto-Scale de Concorrência (`--auto-scale` / Tecla `A`)

Em runs longos (overnight), use `huu --auto-scale run pipeline.json` (ou
pressione **`A`** no dashboard) pra deixar o orquestrador escalar
sozinho. O state machine fica em `NORMAL` enquanto sobra CPU/RAM,
muda pra `BACKING_OFF` em 90% e mata o agente mais novo em 95%
(`DESTROYING` → `COOLDOWN` por 30s pra não oscilar). Se você mexer
`+`/`-` na concorrência, o auto-scale desliga até você apertar `A` de
novo — manual sempre vence automatismo.
