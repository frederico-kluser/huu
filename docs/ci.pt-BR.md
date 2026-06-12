# Rodando o huu em CI (GitHub Actions · GitLab CI)

> **English:** [docs/ci.md](ci.md)

O modo headless do huu (`huu auto`) transforma qualquer pipeline em um job de
CI: sem TTY, sem teclado, progresso NDJSON no stderr, um único JSON final no
stdout, exit code `0`/`1`. Combinado com `--no-docker` (ou `HUU_NO_DOCKER=1`)
ele roda em qualquer runner que tenha **Node.js ≥ 20 e git** — sem
Docker-in-Docker.

Os pipelines de auditoria report-only (Security, Quality, Docs, Performance,
Refactor) são o encaixe natural: escrevem os achados em `.huu/audits/` e
nunca tocam código de produção — o job sobe os relatórios como artefatos e o
exit code faz o gate da esteira.

## Sumário

- [Como as peças se encaixam](#como-as-peças-se-encaixam)
- [Pré-requisitos](#pré-requisitos)
- [O config JSON](#o-config-json)
- [Receita GitHub Actions](#receita-github-actions)
- [Receita GitLab CI](#receita-gitlab-ci)
- [Lendo a saída](#lendo-a-saída)
- [Concorrência em runners pequenos](#concorrência-em-runners-pequenos)
- [FAQ](#faq)

## Como as peças se encaixam

```
runner (já é um container efêmero)
  └─ npm install -g huu-pipe
  └─ HUU_NO_DOCKER=1 huu auto pipeline.json --config huu-ci-config.json
       ├─ stderr: eventos NDJSON (status, stage, tasks, concurrency, autoScale)
       ├─ stdout: UM JSON final ({ ok, runId, status, agents, … })
       └─ exit:   0 quando o run terminou `done`, 1 caso contrário
```

No seu laptop o huu se embrulha em Docker para o agente nunca ver suas
credenciais de shell. Um runner de CI é a situação inversa: ele *já é* um
container efêmero com credenciais escopadas, e Docker-in-Docker geralmente
não existe — então você desliga o wrapper com `--no-docker` (a grafia neutra
de `--yolo`) ou `HUU_NO_DOCKER=1` no ambiente do job.

## Pré-requisitos

1. **Node.js ≥ 20** e um `git` funcional no runner.
2. **O pipeline JSON commitado no repo.** Pipelines são artefatos versionados
   — comite os que o huu materializou em `pipelines/`, ou os seus. O
   `huu auto` recebe o caminho explicitamente.
3. **API key como secret do CI.** O backend Pi (default) lê
   `OPENROUTER_API_KEY`; os outros backends leem as próprias env vars
   (`COPILOT_GITHUB_TOKEN`, `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_BASE_URL`).
   Toda key também aceita a variante `<NOME>_FILE` apontando para um arquivo.
4. **Clone completo quando o pipeline lê histórico.** A auditoria de Security
   varre o histórico git atrás de segredos — use `fetch-depth: 0` (GitHub) /
   `GIT_DEPTH: 0` (GitLab) nesses casos.

## O config JSON

O `huu auto` separa o pipeline *portátil* do config *específico do ambiente*
(quais arquivos NESTE repo, qual modelo NESTA conta):

```jsonc
// huu-ci-config.json
{
  "modelId": "x-ai/grok-4-fast",      // qualquer model id do OpenRouter
  "backend": "pi",                     // pi (default) | copilot | azure | stub
  "files": {
    // nome do step → lista de arquivos, para steps com scope per-file
    "3. OWASP Top 10:2025 scan for $file": ["src/server.ts", "src/auth.ts"]
  },
  "concurrency": 4                     // opcional — ver "Concorrência" abaixo
}
```

Gerar a lista per-file dinamicamente mantém o config em sincronia com o repo
(exemplo para a auditoria de segurança):

```bash
git ls-files 'src/**/*.ts' | jq -R . | jq -s --arg step "3. OWASP Top 10:2025 scan for \$file" \
  '{ modelId: "x-ai/grok-4-fast", backend: "pi", files: { ($step): . } }' \
  > huu-ci-config.json
```

## Receita GitHub Actions

```yaml
# .github/workflows/huu-security-audit.yml
name: huu security audit

on:
  workflow_dispatch:
  schedule:
    - cron: '0 6 * * 1'   # semanal, segunda 06:00

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      HUU_NO_DOCKER: '1'
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # a varredura de segredos lê o histórico git

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Instalar huu
        run: npm install -g huu-pipe

      - name: Gerar config (lista per-file via git)
        run: |
          git ls-files 'src/**' | jq -R . | jq -s \
            '{ modelId: "x-ai/grok-4-fast", backend: "pi",
               files: { "3. OWASP Top 10:2025 scan for $file": . } }' \
            > huu-ci-config.json

      - name: Rodar auditoria
        run: huu auto pipelines/huu-security-audit.pipeline.json \
               --config huu-ci-config.json > huu-result.json

      - name: Subir relatórios
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: huu-audits
          path: |
            .huu/audits/**
            huu-result.json

      - name: Gate pelo resultado
        run: jq -e '.ok == true' huu-result.json
```

Notas:

- O `huu auto` já sai com código ≠ 0 em falha, então o step "Rodar auditoria"
  faz o gate sozinho; o `jq -e` explícito é para quando você redireciona o
  stdout e ainda quer o gate.
- O `if: always()` no upload preserva os relatórios parciais quando o run
  falha — que é exatamente quando você mais quer lê-los.

## Receita GitLab CI

```yaml
# .gitlab-ci.yml
huu:security-audit:
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  variables:
    HUU_NO_DOCKER: '1'
    GIT_DEPTH: 0                # a varredura de segredos lê o histórico git
  before_script:
    - npm install -g huu-pipe
    - |
      git ls-files 'src/**' | jq -R . | jq -s \
        '{ modelId: "x-ai/grok-4-fast", backend: "pi",
           files: { "3. OWASP Top 10:2025 scan for $file": . } }' \
        > huu-ci-config.json
  script:
    - huu auto pipelines/huu-security-audit.pipeline.json --config huu-ci-config.json > huu-result.json
  after_script:
    - jq '.ok' huu-result.json || true
  artifacts:
    when: always
    paths:
      - .huu/audits/
      - huu-result.json
    expire_in: 30 days
```

Defina `OPENROUTER_API_KEY` como variável mascarada
(Settings → CI/CD → Variables).

## Lendo a saída

- **stderr** — um evento NDJSON por linha, com throttle de ~250 ms:
  `{"type":"state","status":"running","stage":"2/5","tasks":"7/23","activeAgents":4,"pendingTasks":12,"concurrency":4,"autoScale":"auto","elapsedMs":81234,"cost":0.04}`
- **stdout** — exatamente um JSON final:
  `{ "ok": true, "runId": "…", "integrationBranch": "huu/<runId>/integration", "status": "done", "agents": [...] }`
- **exit code** — `0` quando `status === "done"`, `1` caso contrário.

Os branches do run ficam no clone local do runner (`huu/<runId>/agent-N`,
`huu/<runId>/integration`) e morrem com ele. Para os audits report-only o
entregável é `.huu/audits/` — suba como artefato; nada precisa de push.

## Concorrência em runners pequenos

Auto-scale por memória é o default do huu: a concorrência se adapta ao
headroom real de memória do runner (cgroup-aware — enxerga o limite do
container, não o do host), e uma guarda de memória mata o agente mais novo e
devolve a task para a fila se a RAM passar de ~95%. Num runner típico de 7 GB
do GitHub isso é o default certo — omita `concurrency` do config.

Pine apenas quando precisar de determinismo acima de throughput:

```jsonc
{ "concurrency": 2 }            // pina modo manual (a guarda continua ativa)
{ "concurrency": 8, "autoScale": true }  // semeia o modo auto em 8
```

## FAQ

**`--no-docker` é seguro em CI?** O wrapper Docker existe para esconder as
credenciais *do seu laptop* do agente. Um runner de CI já é um container
efêmero cujas únicas credenciais são os secrets que você injetou
explicitamente — o trade-off descrito no aviso do `--yolo` não se aplica.

**Preciso de `huu init-docker`?** Não. Aquilo escaffolda assets Docker para
uso local; o CI não usa nenhum deles.

**Quais pipelines rodar em CI?** Os audits report-only (Security, Quality,
Docs, Performance, Refactor) — nunca modificam código de produção. O
`huu Test Suite` e o `huu Knowledge System` mutam o repo por design; rode-os
interativamente e revise o diff.

**O job pode commitar os relatórios de volta?** Os audits escrevem em
`.huu/audits/` na working tree. Prefira artefatos; se quiser commitado,
adicione um step normal de commit-and-push depois do run e revise como
qualquer commit de bot.
