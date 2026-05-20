#!/usr/bin/env bash
# scripts/smoke-pipeline.sh — fim-a-fim de huu --stub run.
# Substitui o que seria o job pipeline-smoke em GitHub Actions.
#
# Cria um repo git temporário com 2 arquivos, copia a fixture
# .fixtures/smoke-pipeline.json pra dentro, roda `huu --stub run
# pipeline.json` no container, e asserta:
#   - exit code 0
#   - branch huu/<runId>/integration foi criada
#   - >=2 branches huu/<runId>/agent-* foram criadas
#   - .huu/debug-*.log existe e tem cli_start + wait_until_exit_resolved
#   - working tree está limpo (preflight + cleanup)
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

step "criando repo fixture"
REPO=$(mktemp -d)
trap "rm -rf $REPO" EXIT

git init -q "$REPO"
git -C "$REPO" config user.email smoke@huu.test
git -C "$REPO" config user.name smoke
printf "alpha\n" > "$REPO/a.txt"
printf "bravo\n" > "$REPO/b.txt"
git -C "$REPO" add a.txt b.txt
git -C "$REPO" commit -q -m fixture

cp "$FIXTURE" "$REPO/pipeline.json"

step "rodando huu --stub run pipeline.json"
# -t aloca pseudo-TTY (necessário pro Ink ativar raw mode); stdin é
# herdado mas não interativo — o caminho `huu --stub run X.json` faz
# autoStart=true e termina sem precisar de input de teclado.
docker run --rm -t \
    --user "$(id -u):$(id -g)" \
    -v "$REPO:$REPO" -w "$REPO" \
    "$IMAGE" huu --stub run pipeline.json

step "asserting integration branch existe"
INTEGRATION=$(git -C "$REPO" for-each-ref \
    --format='%(refname:short)' \
    'refs/heads/huu/*/integration' | head -1)
test -n "$INTEGRATION" || {
    git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads/
    fail "branch huu/<runId>/integration não foi criada"
}
echo "  integration: $INTEGRATION"

step "asserting >=2 agent branches"
AGENTS=$(git -C "$REPO" for-each-ref \
    --format='%(refname:short)' \
    'refs/heads/huu/*/agent-*' | wc -l)
test "$AGENTS" -ge 2 \
    || fail "esperava >=2 agent branches, obteve $AGENTS"
echo "  agents: $AGENTS"

step "asserting lifecycle log completo"
LOG=$(ls "$REPO"/.huu/debug-*.log 2>/dev/null | head -1)
test -n "$LOG" \
    || fail "nenhum .huu/debug-*.log foi escrito"
grep -q 'cli_start' "$LOG" \
    || { tail -50 "$LOG"; fail "cli_start ausente em $LOG"; }
grep -q 'wait_until_exit_resolved' "$LOG" \
    || { tail -50 "$LOG"; fail "wait_until_exit_resolved ausente em $LOG"; }

step "asserting working tree limpo"
DIRTY=$(git -C "$REPO" status --porcelain)
test -z "$DIRTY" \
    || { echo "$DIRTY"; fail "working tree sujo após o run"; }

printf '\n[smoke-pipeline] OK\n'
