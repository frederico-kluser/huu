#!/usr/bin/env bash
# scripts/smoke-image.sh — smoke estrutural da imagem huu.
# Substitui o que era o job smoke-test em .github/workflows/docker.yml.
#
# Uso:  ./scripts/smoke-image.sh                    # contra huu:local
#       ./scripts/smoke-image.sh huu:0.3.0          # contra tag específica
#       HUU_SMOKE_IMAGE=ghcr.io/.../huu:latest \
#           ./scripts/smoke-image.sh
#
# Sai 0 em sucesso, !=0 em falha. Encadeável em && com smoke-pipeline.sh.

set -euo pipefail

IMAGE="${1:-${HUU_SMOKE_IMAGE:-huu:local}}"

step() { printf '\n[smoke-image] %s\n' "$*"; }
fail() { printf '\n[FAIL] %s\n' "$*" >&2; exit 1; }

step "imagem: $IMAGE"
docker image inspect "$IMAGE" >/dev/null \
    || fail "imagem $IMAGE não existe local. Rode 'docker build -t huu:local .' primeiro."

step "huu --help"
docker run --rm "$IMAGE" huu --help >/dev/null \
    || fail "huu --help retornou erro"

step "tini é PID 1"
PID1=$(docker run --rm "$IMAGE" sh -c 'cat /proc/1/comm')
test "$PID1" = "tini" \
    || fail "PID 1 é '$PID1', esperado 'tini'"

step "git presente"
docker run --rm --entrypoint sh "$IMAGE" -c 'git --version' >/dev/null \
    || fail "git ausente da imagem"

step "safe.directory wildcard configurada"
docker run --rm --entrypoint sh "$IMAGE" -c \
    'git config --system --get-all safe.directory' \
    | grep -qF '*' \
    || fail "safe.directory '*' ausente"

step "bind-mount worktree consistency (gotcha §4.1)"
REPO=$(mktemp -d)
trap "rm -rf $REPO" EXIT
git init -q "$REPO"
git -C "$REPO" config user.email smoke@huu.test
git -C "$REPO" config user.name smoke
echo "smoke" > "$REPO/README.md"
git -C "$REPO" add README.md
git -C "$REPO" commit -q -m init

docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$REPO:$REPO" -w "$REPO" \
    --entrypoint sh "$IMAGE" -c "git worktree add '$REPO/wt' HEAD"

git -C "$REPO" worktree list | grep -qF "$REPO/wt" \
    || fail "host's git not seeing the worktree at expected path"

git -C "$REPO" worktree remove --force "$REPO/wt"

step "HEALTHCHECK probe é idle-safe"
docker run --rm --entrypoint sh "$IMAGE" -c '
    if [ -f /tmp/huu/active ]; then
        cd "$(cat /tmp/huu/active)" && exec huu status --liveness
    else
        exit 0
    fi
' || fail "HEALTHCHECK probe retornou !=0 numa imagem ociosa"

step "tamanho da imagem"
docker images "$IMAGE" --format '  size = {{.Size}}'

printf '\n[smoke-image] OK\n'
