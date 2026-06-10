#!/usr/bin/env bash
# scripts/smoke-pipeline.sh — fim-a-fim de `huu auto` com backend stub.
# Substitui o que seria o job pipeline-smoke em GitHub Actions.
#
# Cria um repo git temporário com 2 arquivos, copia a fixture
# .fixtures/smoke-pipeline.json pra dentro, roda `huu auto pipeline.json
# --config config.json` (headless, sem TTY) no container, e asserta:
#   - exit code 0 e JSON final no stdout com "ok": true
#   - branch huu/<runId>/integration foi criada
#   - >=2 branches huu/<runId>/agent-* foram criadas
#   - .huu/debug-*.log existe e tem cli_start
#   - working tree está limpo (preflight + cleanup)
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

step "criando repo fixture"
# Mesma regra do smoke-image.sh: o repo precisa estar num caminho exportado
# pra VM do Docker (no macOS, /var/folders não é; mktemp do Darwin ignora
# TMPDIR). Default no macOS: dentro do próprio repo huu. Override:
# HUU_SMOKE_TMPDIR.
if [ "$(uname)" = Darwin ]; then SMOKE_TMP="${HUU_SMOKE_TMPDIR:-$REPO_ROOT/.smoke-tmp}"; else SMOKE_TMP="${HUU_SMOKE_TMPDIR:-${TMPDIR:-/tmp}}"; fi
mkdir -p "$SMOKE_TMP"
REPO=$(mktemp -d "$SMOKE_TMP/repo.XXXXXX")
trap "rm -rf $REPO" EXIT

git init -q "$REPO"
git -C "$REPO" config user.email smoke@huu.test
git -C "$REPO" config user.name smoke
printf "alpha\n" > "$REPO/a.txt"
printf "bravo\n" > "$REPO/b.txt"
# .gitignore pré-commitado com TODAS as entradas que o orchestrator
# garante via ensureGitignored() — sem elas o huu as escreve durante o
# run e a working tree termina suja (vide orchestrator/index.ts).
printf '%s\n' ".huu-worktrees/" ".huu/" ".env.huu" ".huu-bin/" ".huu-cache/" > "$REPO/.gitignore"
cp "$FIXTURE" "$REPO/pipeline.json"
cat > "$REPO/config.json" <<'EOF'
{ "modelId": "stub-model", "backend": "stub" }
EOF
git -C "$REPO" add a.txt b.txt .gitignore pipeline.json config.json
git -C "$REPO" commit -q -m fixture

step "rodando huu auto pipeline.json --config config.json"
# Headless: sem -t (um pseudo-TTY fundiria o NDJSON de progresso do
# stderr com o JSON final do stdout). O resultado fica em out.json.
OUT="$REPO.out.json"   # fora do repo — não pode contar como tree sujo
docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$REPO:$REPO" -w "$REPO" \
    "$IMAGE" huu auto pipeline.json --config config.json \
    > "$OUT"

step "asserting JSON final com ok=true"
grep -q '"ok": *true' "$OUT" \
    || { cat "$OUT"; fail 'stdout final sem "ok": true'; }
rm -f "$OUT"

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

step "asserting working tree limpo"
DIRTY=$(git -C "$REPO" status --porcelain)
test -z "$DIRTY" \
    || { echo "$DIRTY"; fail "working tree sujo após o run"; }

printf '\n[smoke-pipeline] OK\n'
