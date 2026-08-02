#!/usr/bin/env bash
# scripts/smoke-pipeline.sh — fim-a-fim de `huu auto` com backend stub.
# Substitui o que seria o job pipeline-smoke em GitHub Actions.
#
# Dois casos, em repos git temporários independentes:
#
#   CASO 1 — pipeline SEM `review` (a prova de compatibilidade).
#     2 arquivos, fan-out per-file, exatamente o que este script sempre rodou.
#     Asserta, além do de sempre, que NENHUMA rodada de revisão aconteceu: um
#     pipeline sem o campo novo tem de se comportar como antes dele existir.
#
#   CASO 2 — pipeline mínimo cujo work step declara `review`.
#     Prova que o campo atravessa schema → compilação → execução no caminho
#     stub: o crítico é mesmo spawnado (agente reservado), o shard de achados é
#     escrito, e o branch MERGEIA assim mesmo — o forward-default.
#
# ─────────────────────────── LIMITE CONHECIDO ───────────────────────────
# Com o backend stub, um step de `scope: "memory"` resolve para ZERO tarefas:
# o arquivo huu-memory-v1 é escrito pelo AGENTE de um step anterior, e o stub
# nunca escreve nada além do seu próprio STUB_*.md. Logo o formato de enxame do
# dev mode — recon escreve as specs → fan-out de memória → revisão por tarefa →
# merge — NÃO executa aqui, em caso nenhum. Por isso o caso 2 usa fan-out
# per-file: é o único jeito de o laço de revisão rodar de fato sob o stub.
#
# E mesmo no caso 2, o crítico é o agente stub: ele não emite bloco de veredito
# parseável, então a rodada termina em `unavailable`. Isso exercita o caminho de
# ERRO (crítico quebrado ⇒ zero blocking ⇒ o trabalho mergeia), não o caminho
# feliz. O que este smoke NÃO prova: que o crítico produz achado útil, que um
# achado bloqueante volta ao mesmo agente, que o laço converge, ou que o teto de
# rodadas dispensa (waive) direito. Isso é modelo de verdade — ou os testes de
# unidade com factory roteirizada em src/orchestrator/review-loop.test.ts.
# Resumindo: este script prova TOPOLOGIA, CONTRATOS e CAMINHOS DE ERRO. Ele não
# prova que o enxame funciona.
# ────────────────────────────────────────────────────────────────────────
#
# Nota: `huu run <pipeline>` é interativo por contrato (abre o editor e
# espera G pra rodar) — o caminho sem teclado é `huu auto` desde a 1.2.0.
#
# Uso:  ./scripts/smoke-pipeline.sh                 # contra huu:local
#       ./scripts/smoke-pipeline.sh huu:0.3.0       # contra tag específica
#
# Sai 0 em sucesso, !=0 em falha.

set -euo pipefail

IMAGE="${1:-${HUU_SMOKE_IMAGE:-huu:local}}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE="$REPO_ROOT/.fixtures/smoke-pipeline.json"

step() { printf '\n[smoke-pipeline] %s\n' "$*"; }
fail() { printf '\n[FAIL] %s\n' "$*" >&2; exit 1; }

test -f "$FIXTURE" \
    || fail ".fixtures/smoke-pipeline.json ausente em $FIXTURE"

step "imagem: $IMAGE"
docker image inspect "$IMAGE" >/dev/null \
    || fail "imagem $IMAGE não existe local. Rode 'docker build -t huu:local .' primeiro."

# Mesma regra do smoke-image.sh: o repo precisa estar num caminho exportado
# pra VM do Docker (no macOS, /var/folders não é; mktemp do Darwin ignora
# TMPDIR). Default no macOS: dentro do próprio repo huu. Override:
# HUU_SMOKE_TMPDIR.
if [ "$(uname)" = Darwin ]; then SMOKE_TMP="${HUU_SMOKE_TMPDIR:-$REPO_ROOT/.smoke-tmp}"; else SMOKE_TMP="${HUU_SMOKE_TMPDIR:-${TMPDIR:-/tmp}}"; fi
mkdir -p "$SMOKE_TMP"

CLEANUP_PATHS=""
cleanup() { if [ -n "$CLEANUP_PATHS" ]; then rm -rf $CLEANUP_PATHS; fi; return 0; }
trap cleanup EXIT

REPO=""
OUT=""
INTEGRATION=""
LOG=""

# new_repo — repo git fixture novo em $REPO, já com .gitignore e config.json.
# Escreve numa GLOBAL em vez de ecoar: um `$(new_repo)` rodaria numa subshell e
# a lista de limpeza não sobreviveria.
new_repo() {
    REPO=$(mktemp -d "$SMOKE_TMP/repo.XXXXXX")
    OUT="$REPO.out.json"   # fora do repo — não pode contar como tree sujo
    CLEANUP_PATHS="$CLEANUP_PATHS $REPO $OUT"
    git init -q "$REPO"
    git -C "$REPO" config user.email smoke@huu.test
    git -C "$REPO" config user.name smoke
    # .gitignore pré-commitado com TODAS as entradas que o orchestrator
    # garante via ensureGitignored() — sem elas o huu as escreve durante o
    # run e a working tree termina suja (vide orchestrator/index.ts).
    printf '%s\n' ".huu-worktrees/" ".huu/" ".env.huu" ".huu-bin/" ".huu-cache/" > "$REPO/.gitignore"
    cat > "$REPO/config.json" <<'EOF'
{ "modelId": "stub-model", "backend": "stub" }
EOF
}

# run_pipeline — headless: sem -t (um pseudo-TTY fundiria o NDJSON de progresso
# do stderr com o JSON final do stdout). O resultado fica em $OUT.
run_pipeline() {
    docker run --rm \
        --user "$(id -u):$(id -g)" \
        -v "$REPO:$REPO" -w "$REPO" \
        "$IMAGE" huu auto pipeline.json --config config.json \
        > "$OUT"
}

assert_ok_json() {
    grep -q '"ok": *true' "$OUT" \
        || { cat "$OUT"; fail 'stdout final sem "ok": true'; }
    rm -f "$OUT"
}

assert_integration_branch() {
    INTEGRATION=$(git -C "$REPO" for-each-ref \
        --format='%(refname:short)' \
        'refs/heads/huu/*/integration' | head -1)
    test -n "$INTEGRATION" || {
        git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads/
        fail "branch huu/<runId>/integration não foi criada"
    }
    echo "  integration: $INTEGRATION"
}

assert_agent_branches() {   # assert_agent_branches <mínimo>
    local agents
    agents=$(git -C "$REPO" for-each-ref \
        --format='%(refname:short)' \
        'refs/heads/huu/*/agent-*' | wc -l)
    test "$agents" -ge "$1" \
        || fail "esperava >=$1 agent branches, obteve $agents"
    echo "  agents: $agents"
}

assert_debug_log() {
    # `|| LOG=""`: com pipefail um glob sem match derrubaria o script antes da
    # mensagem de erro abaixo, que é a parte útil.
    LOG=$(ls "$REPO"/.huu/debug-*.log 2>/dev/null | head -1) || LOG=""
    test -n "$LOG" \
        || fail "nenhum .huu/debug-*.log foi escrito"
    grep -q 'cli_start' "$LOG" \
        || { tail -50 "$LOG"; fail "cli_start ausente em $LOG"; }
}

assert_clean_tree() {
    local dirty
    dirty=$(git -C "$REPO" status --porcelain)
    test -z "$dirty" \
        || { echo "$dirty"; fail "working tree sujo após o run"; }
}

# ══════════════════ CASO 1 — pipeline SEM review (compatibilidade) ══════════════════

step "CASO 1 — pipeline sem review: criando repo fixture"
new_repo
printf "alpha\n" > "$REPO/a.txt"
printf "bravo\n" > "$REPO/b.txt"
cp "$FIXTURE" "$REPO/pipeline.json"
git -C "$REPO" add a.txt b.txt .gitignore pipeline.json config.json
git -C "$REPO" commit -q -m fixture

step "CASO 1 — rodando huu auto pipeline.json --config config.json"
run_pipeline

step "CASO 1 — asserting JSON final com ok=true"
assert_ok_json

step "CASO 1 — asserting integration branch existe"
assert_integration_branch

step "CASO 1 — asserting >=2 agent branches"
assert_agent_branches 2

step "CASO 1 — asserting lifecycle log completo"
assert_debug_log

# A prova de compatibilidade propriamente dita: sem o campo `review`, nem uma
# linha do laço de revisão roda. Se este grep passar a casar, alguma coisa
# começou a revisar pipelines que não pediram revisão.
step "CASO 1 — asserting que NENHUMA revisão aconteceu"
if grep -q 'review_round_start' "$LOG"; then
    grep -n 'review_' "$LOG" | head -5
    fail "pipeline SEM 'review' entrou no laço de revisão"
fi
echo "  nenhum review_round_start — caminho inalterado"

step "CASO 1 — asserting working tree limpo"
assert_clean_tree

# ══════════════════ CASO 2 — work step COM review ══════════════════
#
# Um step, um arquivo, um agente, um crítico. `maxRounds: 2` está no fixture de
# propósito mesmo o stub convergindo na rodada 1 (verdict `unavailable` ⇒ zero
# blocking ⇒ break): é o valor que o schema tem de aceitar, e ele prova que o
# teto não é o que encerra o laço aqui.

step "CASO 2 — pipeline com review: criando repo fixture"
new_repo
printf "alpha\n" > "$REPO/a.txt"
cat > "$REPO/pipeline.json" <<'EOF'
{
  "_format": "huu-pipeline-v2",
  "pipeline": {
    "name": "smoke-review",
    "cardTimeoutMs": 60000,
    "singleFileCardTimeoutMs": 30000,
    "maxRetries": 0,
    "steps": [
      {
        "type": "work",
        "name": "stage-1-reviewed",
        "prompt": "Stub agent: this prompt is never sent.",
        "files": ["a.txt"],
        "review": {
          "prompt": "Stub critic: this prompt is never sent either.",
          "maxRounds": 2,
          "blockOn": ["blocker", "major"],
          "maxFindings": 5,
          "verifyCommands": ["true"],
          "findingsDir": "huu-review"
        }
      }
    ]
  }
}
EOF
git -C "$REPO" add a.txt .gitignore pipeline.json config.json
git -C "$REPO" commit -q -m fixture

step "CASO 2 — rodando huu auto pipeline.json --config config.json"
run_pipeline

step "CASO 2 — asserting JSON final com ok=true"
assert_ok_json

step "CASO 2 — asserting integration branch existe"
assert_integration_branch

step "CASO 2 — asserting >=1 agent branch"
assert_agent_branches 1

step "CASO 2 — asserting lifecycle log completo"
assert_debug_log

# O campo não só passou pelo schema: ele chegou ao orchestrator e um crítico
# reservado foi mesmo spawnado na worktree do worker.
step "CASO 2 — asserting que o laço de revisão rodou"
grep -q 'review_round_start' "$LOG" \
    || { grep -n 'review_\|stage_' "$LOG" | head -20; fail "review_round_start ausente — o campo 'review' não chegou à execução"; }
grep -qE 'review_round_(done|unavailable)' "$LOG" \
    || { grep -n 'review_' "$LOG" | head -20; fail "nenhuma rodada de revisão CONCLUIU (nem done nem unavailable)"; }
grep -o 'review_round_[a-z]*' "$LOG" | sort | uniq -c | sed 's/^/  /'

# Forward-default: o crítico stub não produz veredito parseável, e mesmo assim
# o branch entrou no merge. Um crítico quebrado nunca pode destruir trabalho bom
# — a asserção é o shard de achados existir DENTRO da árvore de integração.
step "CASO 2 — asserting que a revisão não bloqueou o merge"
SHARD=$(git -C "$REPO" ls-tree -r --name-only "$INTEGRATION" \
    | grep '^huu-review/agent-' | head -1) \
    || SHARD=""
test -n "$SHARD" || {
    git -C "$REPO" ls-tree -r --name-only "$INTEGRATION"
    fail "nenhum shard huu-review/agent-*.json na árvore de integração — a revisão engoliu o merge"
}
echo "  shard: $SHARD"
git -C "$REPO" show "$INTEGRATION:$SHARD" | grep -q '"_format": *"huu-review-v1"' \
    || { git -C "$REPO" show "$INTEGRATION:$SHARD"; fail "shard de revisão sem _format huu-review-v1"; }

step "CASO 2 — asserting working tree limpo"
assert_clean_tree

printf '\n[smoke-pipeline] OK\n'
