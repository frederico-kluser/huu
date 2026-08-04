# Guia de Instalacao e Configuracao do jcode como Backend do huu

> Tutorial pratico de como instalar e configurar o `jcode` no macOS, Linux e
> Windows, focado no uso como backend de agentes do huu.
>
> Para a documentacao de referencia do backend jcode dentro do huu, veja
> [`pi-coding-agent.md`](pi-coding-agent.md) (a arquitetura de backends e a
> mesma) e [`ARCHITECTURE.md`](ARCHITECTURE.md). Para troubleshooting de
> runtime veja [`troubleshooting.pt-BR.md`](troubleshooting.pt-BR.md).

---

## 1. Pre-requisitos

- **Git** -- qualquer versao recente (usado pelo huu para worktrees).
- **Node.js 20+** -- runtime do huu. Verifique com `node --version`.
- **npm** -- gerenciador de pacotes (vem com Node.js).
- **Chave de API do DeepSeek** -- obtenha em [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys).
  O custo e de $1.74/M tokens de input e $3.48/M tokens de output (modelo
  `deepseek-v4-pro`).
- **Terminal** -- bash, zsh, PowerShell ou equivalente.

---

## 2. Instalacao do jcode

O binario `jcode` e distribuido como tarball para cada plataforma. Instale em
`~/.local/bin/jcode` e adicione o diretorio ao `PATH`.

### 2.1 Download por plataforma

Escolha o tarball correspondente ao seu sistema:

| Plataforma          | Arquivo                           |
|---------------------|-----------------------------------|
| macOS Apple Silicon | `jcode-macos-aarch64.tar.gz`      |
| macOS Intel         | `jcode-macos-x86_64.tar.gz`       |
| Linux x86_64        | `jcode-linux-x86_64.tar.gz`       |
| Linux aarch64       | `jcode-linux-aarch64.tar.gz`      |
| Windows x86_64      | `jcode-windows-x86_64.tar.gz`     |
| Windows ARM64       | `jcode-windows-aarch64.tar.gz`    |

### 2.2 macOS / Linux

```bash
# Criar diretorio de instalacao
mkdir -p ~/.local/bin

# Download (substitua <arquivo> pelo nome do tarball da tabela acima)
# Exemplo para macOS Apple Silicon:
curl -fsSL -o /tmp/jcode.tar.gz \
  "https://.../<arquivo>"

# Extrair
tar -xzf /tmp/jcode.tar.gz -C ~/.local/bin/

# Tornar executavel
chmod +x ~/.local/bin/jcode

# Adicionar ao PATH (escolha uma opcao)
# Opcao A: export manual (vale ate o terminal fechar)
export PATH="$HOME/.local/bin:$PATH"

# Opcao B: permanente -- adicione ao ~/.zshrc ou ~/.bashrc
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### 2.3 Windows (PowerShell)

```powershell
# Criar diretorio
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.local\bin"

# Download e extracao (exemplo x86_64)
Invoke-WebRequest -Uri "https://.../jcode-windows-x86_64.tar.gz" `
  -OutFile "$env:TEMP\jcode.tar.gz"
tar -xzf "$env:TEMP\jcode.tar.gz" -C "$env:USERPROFILE\.local\bin\"

# Adicionar ao PATH (permanente -- requer PowerShell como Administrador)
[Environment]::SetEnvironmentVariable(
  "PATH",
  "$env:PATH;$env:USERPROFILE\.local\bin",
  [EnvironmentVariableTarget]::User
)

# Recarregar o perfil
refreshenv
```

---

## 3. Configuracao do Provider DeepSeek

Crie (ou edite) o arquivo `~/.jcode/config.toml` com o conteudo abaixo. Este
e exatamente o mesmo arquivo de configuracao usado no projeto t-8000.

```toml
[provider]
default_provider = "deepseek-v4-pro"
default_model = "deepseek-v4-pro"

[providers.deepseek-v4-pro]
type = "openai-compatible"
base_url = "https://api.deepseek.com/v1"
auth = "bearer"
api_key_env = "DEEPSEEK_API_KEY"
default_model = "deepseek-v4-pro"
requires_api_key = true

[[providers.deepseek-v4-pro.models]]
id = "deepseek-v4-pro"
context_window = 1000000
max_tokens = 384000
```

### 3.1 Exportar a chave de API

A configuracao acima espera a chave na variavel de ambiente `DEEPSEEK_API_KEY`.
Exporte-a no seu shell antes de rodar o huu:

```bash
export DEEPSEEK_API_KEY="sk-..."
```

Para tornar permanente, adicione ao seu `~/.zshrc`, `~/.bashrc` ou use um
gerenciador de secrets (1Password CLI, `pass`, etc.).

**Alternativa -- arquivo `.env` local do jcode:**

O jcode tambem suporta `env_file` no provider. Crie
`~/.jcode/provider-deepseek-v4-pro.env` com:

```
DEEPSEEK_API_KEY=sk-...
```

E adicione ao `config.toml`:

```toml
[providers.deepseek-v4-pro]
# ... resto da config ...
env_file = "provider-deepseek-v4-pro.env"
```

> **Atencao:** Nao commite arquivos `.env` com chaves reais. O `.env` do jcode
> fica em `~/.jcode/`, fora do repositorio.

---

## 4. Desabilitar Embeddings e Telemetria

O backend jcode do huu forca ambiente hermeneutico por padrao (modulo
`src/orchestrator/backends/jcode/hermetic.ts`). Em todo subprocesso `jcode run`
que o huu dispara, as seguintes variaveis sao injetadas automaticamente:

| Variavel                    | Valor   | Efeito                                  |
|-----------------------------|---------|-----------------------------------------|
| `JCODE_MEMORY_ENABLED`      | `false` | Zero embeddings -- execucao stateless   |
| `JCODE_NO_TELEMETRY`        | `1`     | Sem telemetria externa                  |
| `JCODE_AGENT_DIR`           | `~/.huu/jcode-agent` | Runtime isolado, nunca toca `~/.jcode` |

Voce nao precisa exportar essas variaveis manualmente ao usar o huu -- ele faz
isso em toda sessao jcode. Porem, para testes manuais com `jcode run` diretamente
(fora do huu), exporte-as para consistencia:

```bash
export JCODE_MEMORY_ENABLED=false
export JCODE_NO_TELEMETRY=1
```

### 4.1 Escape hatch

Se precisar voltar ao comportamento global do jcode (debugging), defina:

```bash
export HUU_JCODE_HERMETIC=0
```

Isso faz o huu passar o `process.env` intacto para o subprocesso jcode,
exatamente como era antes do modo hermeneutico.

---

## 5. Verificacao

Apos a instalacao e configuracao, verifique cada etapa:

### 5.1 Binario no PATH

```bash
jcode --version
# Deve imprimir a versao do jcode, ex: 0.x.x
```

### 5.2 Provider configurado

```bash
jcode run --provider-profile deepseek-v4-pro \
  --model deepseek-v4-pro \
  --no-update \
  "Responda exatamente: JCODE_OK"
```

Se a saida contiver `JCODE_OK`, o provider e o modelo estao funcionando.

### 5.3 Diagnostico rapido

```bash
# Verificar se a chave esta exportada
echo ${DEEPSEEK_API_KEY:0:8}...
# Deve mostrar os primeiros 8 caracteres da chave

# Testar conectividade com a API DeepSeek
curl -s -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  https://api.deepseek.com/v1/models | head -c 200
```

---

## 6. Uso com o huu

### 6.1 Instalar dependencias e compilar

```bash
cd huu
npm install
npm run build
```

### 6.2 Rodar com backend jcode

```bash
# Via flag explicita
npm start -- --backend jcode --model deepseek-v4-pro

# Ou via alias (parseBackendKind aceita "deepseek" como sinonimo)
npm start -- --backend deepseek --model deepseek-v4-pro
```

O huu usa `jcode run --no-update --provider-profile deepseek-v4-pro --model <model>` internamente. Voce nao precisa passar essas flags -- o backend factory
as injeta automaticamente.

### 6.3 Testar sub-agentes manualmente

O repositorio inclui scripts de validacao que disparam sub-agentes jcode reais:

```bash
# Smoke test: 3 sub-agentes em paralelo (ou 1 com --quick)
export JCODE_MEMORY_ENABLED=false
./scripts/test-jcode-subagents.sh

# Smoke rapido (1 agente apenas)
./scripts/test-jcode-subagents.sh --quick

# Benchmark de consumo de RAM com 1, 2 e 5 agentes paralelos
export JCODE_MEMORY_ENABLED=false
./scripts/benchmark-jcode-subagents.sh --max-parallel 3
```

### 6.4 Rodar testes unitarios do backend

```bash
npx vitest run src/orchestrator/backends/jcode/
```

---

## 7. Troubleshooting Especifico do huu

### 7.1 Backend jcode nao aparece no seletor TUI

**Causa:** O seletor de backends e populado por `ALL_BACKENDS` em
`src/orchestrator/backends/registry.ts`. O bundle jcode so aparece se
`userSelectable: true` estiver definido (esta, desde a versao que introduziu
o backend).

**Solucao:** Verifique que `selectBackend('jcode')` retorna um bundle com
`userSelectable: true`. Se voce modificou o `registry.ts`, confira se o case
`'jcode'` esta presente e com a flag correta.

```bash
grep -A 10 "case 'jcode'" src/orchestrator/backends/registry.ts
```

### 7.2 Erro `JCODE_PROVIDER_DEEPSEEK_V4_PRO_API_KEY`

**Causa:** A variavel `DEEPSEEK_API_KEY` nao esta exportada no ambiente do
shell que lanca o huu. O jcode procura a variavel definida em `api_key_env`
no `config.toml`.

**Solucao:**

```bash
# Verifique se esta exportada no shell atual
echo $DEEPSEEK_API_KEY

# Se vazia, exporte
export DEEPSEEK_API_KEY="sk-..."

# Confirme que o huu a recebe (o processo filho herda o env do pai)
npm start -- --backend jcode --model deepseek-v4-pro
```

### 7.3 Sub-agentes nao spawnam

**Causa provavel:** O binario `jcode` nao esta no `PATH` do container Docker
(se estiver rodando `huu` via Docker).

**Solucao:**

```bash
# Dentro do container (ou no Dockerfile):
which jcode
# Se nao encontrar, adicione ao Dockerfile:
# ENV PATH="/home/node/.local/bin:$PATH"
# COPY --from=jcode-builder /usr/local/bin/jcode /home/node/.local/bin/jcode
```

Para execucao local (sem Docker):

```bash
# Verifique o PATH
which jcode
# Deve retornar ~/.local/bin/jcode

# Se nao encontrar, ajuste o PATH
export PATH="$HOME/.local/bin:$PATH"
```

### 7.4 Testes falham com timeout

**Causa:** O `jcode run` esta demorando mais que o esperado. Comum na primeira
execucao apos instalacao (cold start).

**Solucao:**

```bash
# Rodar um teste simples primeiro para "aquecer"
jcode run --provider-profile deepseek-v4-pro \
  --model deepseek-v4-pro --no-update "hello"

# Depois rodar os testes
npx vitest run src/orchestrator/backends/jcode/
```

### 7.5 Erro `jcode exited with code 1`

**Causa:** O provider ou modelo nao foi encontrado, ou a chave de API e
invalida.

**Diagnostico:**

```bash
# Testar o jcode isoladamente com o mesmo provider e modelo
jcode run --provider-profile deepseek-v4-pro \
  --model deepseek-v4-pro --no-update "test" 2>&1 | head -50

# Verificar a configuracao
cat ~/.jcode/config.toml

# Verificar conectividade com a API
curl -s -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  https://api.deepseek.com/v1/models
```

### 7.6 Transcript do agente vazio ou truncado

**Causa:** O subprocesso jcode foi abortado (SIGTERM/SIGKILL) antes de
completar a escrita em stdout. O backend jcode e stateless -- nao ha checkpoint
para retomar.

**Solucao:** O orchestrator do huu faz kill+requeue automatico (a task e
re-agendada do zero). O agente re-le os arquivos da worktree e continua
idempotentemente. Nenhuma acao manual necessaria.

### 7.7 Variaveis de ambiente nao chegam ao subprocesso

**Causa:** O `buildJcodeSessionEnvironment()` em `hermetic.ts` compoe um objeto
`env` a partir de `process.env`. Se o huu foi lancado sem `DEEPSEEK_API_KEY`
no ambiente, o subprocesso jcode tambem nao a tera.

**Solucao:** Certifique-se de exportar `DEEPSEEK_API_KEY` ANTES de lancar o
huu:

```bash
export DEEPSEEK_API_KEY="sk-..."
npm start -- --backend jcode --model deepseek-v4-pro
```

---

## 8. Resumo de Variaveis de Ambiente

| Variavel                     | Quem define         | Proposito                                     |
|------------------------------|---------------------|-----------------------------------------------|
| `DEEPSEEK_API_KEY`           | Voce (usuario)      | Chave de API do DeepSeek                      |
| `JCODE_MEMORY_ENABLED=false` | huu (automatico)    | Desabilita embeddings -- execucao stateless    |
| `JCODE_NO_TELEMETRY=1`       | huu (automatico)    | Desabilita telemetria externa                 |
| `JCODE_AGENT_DIR`            | huu (automatico)    | Diretorio isolado `~/.huu/jcode-agent`        |
| `HUU_JCODE_HERMETIC=0`       | Voce (debug apenas) | Escape hatch -- volta ao config global do host |
| `JCODE_BIN`                  | Scripts de teste    | Caminho customizado para o binario jcode      |

---

## 9. Referencias

- **Codigo do backend jcode no huu:** `src/orchestrator/backends/jcode/`
  - `factory.ts` -- spawn de subprocesso `jcode run`
  - `hermetic.ts` -- composicao de ambiente isolado
  - `event-mapper.ts` -- traducao de stdout para `AgentEvent`
- **Registro de backends:** `src/orchestrator/backends/registry.ts`
- **Scripts de teste:** `scripts/test-jcode-subagents.sh`,
  `scripts/benchmark-jcode-subagents.sh`
- **Testes unitarios:** `src/orchestrator/backends/jcode/factory.test.ts`
- **Documentacao de runtime:** [`operations.pt-BR.md`](operations.pt-BR.md)
- **Onboarding do huu:** [`onboarding.pt-BR.md`](onboarding.pt-BR.md)
