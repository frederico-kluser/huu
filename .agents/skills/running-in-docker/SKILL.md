---
name: running-in-docker
description: Covers huu's host wrapper and container runtime — the decideReexec bypass order (HUU_IN_CONTAINER, --yolo, --no-docker, HUU_NO_DOCKER, --help, native subcommands), cidfile/prune lifecycle, image resolution, MTU-aware networks, secret mounts, the /tmp/huu/active HEALTHCHECK sentinel and the smoke scripts. Use for any Docker, re-exec, container-lifecycle, CI-without-Docker or image work.
metadata:
  version: 0.1.0
  type: knowledge
---

# Running in Docker

## When to use

Changes to `src/lib/docker-reexec.ts`, `init-docker.ts`, `prune.ts`, `active-run-sentinel.ts`, the Dockerfile/compose, smoke scripts — or debugging "why did/didn't it re-exec", orphan containers, VPN networking, CI runs.

## Injected knowledge

### The gate (`docker-reexec.ts`, `decideReexec`) — first match wins

1. `HUU_IN_CONTAINER === '1'` → run native (set by the Dockerfile; we're already inside)
2. `--yolo` flag (`:149`) → native; the explicit, human "no isolation" spelling
3. `--no-docker` flag (`:152`) → native; the neutral spelling for CI runners (flags are checked before the env on purpose — a typed flag beats ambient env)
4. `HUU_NO_DOCKER === '1' | 'true'` (`:155`) → native
5. `--help` / `-h` → native (pure print, not worth a container)
6. First non-flag arg in `NATIVE_ONLY_SUBCOMMANDS = {init-docker, status, prune}` (`:129`) → native
7. Otherwise → re-exec into Docker

The gate sits at the very top of `cli.tsx`, before Ink/React imports, so the wrapper path never loads TUI code (see following-architecture-conventions on module purity).

When iterating on the wrapper itself, run with `HUU_NO_DOCKER=1` — otherwise a globally-installed `huu` re-execs into the PUBLISHED image and your local changes never execute.

### Container lifecycle

- `docker run --cidfile /tmp/huu-cids/cid-<pid>-<rand>.id`; SIGINT/SIGTERM/SIGHUP are trapped by the wrapper and forwarded via `docker kill --signal` using the recorded CID (works around moby#28872). `huu prune` reads stale cidfiles and kills containers whose parent PID is gone.
- Identity/paths: `--user "$(id -u):$(id -g)"`, repo bind-mounted at its own absolute path (`-v "$PWD:$PWD"`), `~/.huu` and `~/Downloads` mounted at the same absolute paths, host home exported as `HUU_HOST_HOME`.
- Image: default `ghcr.io/frederico-kluser/huu:latest`, override with `HUU_IMAGE` (e.g. `huu:local` after a local build).
- Networking: the wrapper detects the default-route MTU and auto-creates `huu-net-mtu<N>` when needed (VPN tunnels truncate at default MTU); `HUU_DOCKER_NETWORK` overrides.
- Secrets: API keys travel as readonly `--mount` files into `/run/secrets/` and are EXCLUDED from `-e` env passthrough — step 1 of the api-key chain (see integrating-llm-backends).

### Health & sentinel

The TUI writes `/tmp/huu/active` (containing the cwd) on start and clears it on exit; the Dockerfile HEALTHCHECK reads it. If you touch startup/shutdown paths, keep the sentinel writes — `huu status` and container health both depend on them (`src/lib/active-run-sentinel.ts`).

### Validation

```bash
docker build -t huu:local .
./scripts/smoke-image.sh      # ~10s — image sanity
./scripts/smoke-pipeline.sh   # ~60s — e2e pipeline with --stub
```

All exit non-zero on failure (chainable with `&&`). There is no CI: run these when touching Docker/wrapper code and before releases. CI recipes without Docker: `docs/ci.md`.

## References

- `src/lib/docker-reexec.ts`, `Dockerfile`, `compose.yaml`, `scripts/smoke-*.sh`, `docs/ci.md`
- Related skills: releasing-versions, isolating-agent-ports (HUU_NATIVE_SHIM_PATH)

> Facts verified against source on 2026-06-12.
