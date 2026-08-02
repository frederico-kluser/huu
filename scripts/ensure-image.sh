#!/usr/bin/env bash
# Guarantee `npm start`/`npm run dev` execute the CURRENT source.
#
# huu is docker-only: the host wrapper (src/cli.tsx via tsx) is always fresh,
# but the actual run happens INSIDE the image — which is frozen at whatever
# the last `docker build` produced. Without this step, a fixed bug keeps
# "happening" until someone remembers to rebuild (the stale-image trap).
#
# Behavior:
#   - HUU_IMAGE set to anything other than huu:local → the caller pinned a
#     specific image on purpose (e.g. a published GHCR tag) — skip.
#   - docker missing → warn and continue (native-only subcommands like
#     `status`/`--help` still work; the CLI itself explains when a run
#     actually needs Docker).
#   - otherwise → `docker build -t huu:local .`. Layer cache makes the
#     no-change case take ~1–3 s; a src/ change re-runs only tsc + the
#     runtime-image layers. A FAILED build aborts the start — running stale
#     code silently is exactly what this script exists to prevent.
#
# `--network=host` on Linux: hosts using systemd-resolved expose the DNS stub
# 127.0.0.53, which the default bridge network can't reach — apt/npm inside
# the build would fail name resolution (harmless where not needed).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${HUU_IMAGE:-huu:local}"

if [[ "$IMAGE" != "huu:local" ]]; then
  echo "[ensure-image] HUU_IMAGE=$IMAGE (explicitly pinned) — skipping the local build" >&2
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[ensure-image] docker not found — continuing WITHOUT rebuilding huu:local" >&2
  echo "[ensure-image] (native-only subcommands still work; container runs will fail loudly)" >&2
  exit 0
fi

NET_ARGS=()
if [[ "$(uname -s)" == "Linux" ]]; then
  NET_ARGS+=(--network=host)
fi

echo "[ensure-image] refreshing huu:local from the current source (cached layers skip fast)…" >&2
docker build "${NET_ARGS[@]}" -t huu:local "$REPO_ROOT" >&2
echo "[ensure-image] huu:local is up to date with the working tree" >&2
