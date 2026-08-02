---
name: running-in-docker
description: Covers huu's host wrapper and container runtime — the decideReexec bypass order (HUU_IN_CONTAINER, --yolo, --no-docker, HUU_NO_DOCKER, --help, native subcommands), cidfile/prune lifecycle, image resolution, MTU-aware networks, secret mounts, the /tmp/huu/active HEALTHCHECK sentinel and the smoke scripts. Use for any Docker, re-exec, container-lifecycle, CI-without-Docker or image work.
metadata:
  version: 0.2.0
  type: knowledge
---

# Running in Docker

## When to use

Changes to `src/lib/docker-reexec.ts`, `init-docker.ts`, `prune.ts`, `active-run-sentinel.ts`, the Dockerfile/compose, smoke scripts — or debugging "why did/didn't it re-exec", orphan containers, VPN networking, CI runs.

## Injected knowledge

### The gate (`docker-reexec.ts`, `decideReexec`)

1. `HUU_IN_CONTAINER === '1'` → run native (set by the Dockerfile; we're already inside)
2. `--help` or host utilities (`init-docker`, `status`, `prune`) → run natively
3. Otherwise → re-exec into Docker (`--yolo`/`--no-docker`/`HUU_NO_DOCKER` are detected, warned about and ignored — huu is Docker-only)

The gate sits at the very top of `cli.tsx`, before Ink/React imports, so the wrapper path never loads TUI code (see following-architecture-conventions on module purity).

### Container lifecycle

- `docker run --cidfile /tmp/huu-cids/cid-<pid>-<rand>.id`; SIGINT/SIGTERM/SIGHUP are trapped by the wrapper and forwarded via `docker kill --signal` using the recorded CID (works around moby#28872). `huu prune` reads stale cidfiles and kills containers whose parent PID is gone.
- Identity/paths: `--user "$(id -u):$(id -g)"`, repo bind-mounted at its own absolute path (`-v "$PWD:$PWD"`), `~/.huu`, `~/Downloads`, the HOST config dir (`resolveHostConfigDir` → `$XDG_CONFIG_HOME/huu`, default `~/.config/huu` — `mkdirSync` it BEFORE mounting, else docker creates the mount source root-owned) and the workspace root (`HUU_WORKSPACE`, default `$HOME`) mounted at the same absolute paths; host home exported as `HUU_HOST_HOME`, config dir as `HUU_CONFIG_DIR`. The container runs `--user` with no passwd entry so its HOME is `/tmp` — without `HUU_CONFIG_DIR`, `configFilePath()`/`webSettingsPath()` wrote the ephemeral `/tmp/.config` and keys/settings saved in-container vanished with `--rm` (the trap that made a stale saved key unfixable).
- Image: default `ghcr.io/frederico-kluser/huu:latest`, override with `HUU_IMAGE` (e.g. `huu:local` after a local build). `npm start`/`npm run dev` REFRESH `huu:local` automatically first (`scripts/ensure-image.sh`: layer-cached ~2s no-change; `--network=host` on Linux for the resolved-stub DNS; explicit `HUU_IMAGE`≠huu:local skips; missing docker warns-and-continues so native-only subcommands keep working; a failed build ABORTS — the stale-image trap is the thing prevented).
- Networking: the wrapper detects the default-route MTU and auto-creates `huu-net-mtu<N>` when needed (VPN tunnels truncate at default MTU); `HUU_DOCKER_NETWORK` overrides.
- Secrets: API keys travel as readonly `--mount` files into `/run/secrets/` and are EXCLUDED from `-e` env passthrough — step 1 of the api-key chain (see integrating-llm-backends). The mount is a VALUE SNAPSHOT (a temp file holding the host-resolved key) frozen at container start — it does NOT track the config store live, so anything that must switch keys mid-session needs an in-process override (`WebRunManager.webKeys`); a disk save via `HUU_CONFIG_DIR` covers the NEXT start.
- Container stdout/stderr reach the user's terminal — the wrapper does `spawn('docker', argv, { stdio: 'inherit' })` — so in-container server logging (`src/web/terminal-log.ts`) needs zero extra plumbing.

### Health & sentinel

The TUI writes `/tmp/huu/active` (containing the cwd) on start and clears it on exit; the Dockerfile HEALTHCHECK reads it. If you touch startup/shutdown paths, keep the sentinel writes — `huu status` and container health both depend on them (`src/lib/active-run-sentinel.ts`).

### Validation

```bash
docker build -t huu:local .
./scripts/smoke-image.sh      # ~10s — image sanity
./scripts/smoke-pipeline.sh   # ~60s — e2e pipeline with --stub
```

All exit non-zero on failure (chainable with `&&`). Run these when touching Docker/wrapper code and before releases — the CI gate (`.github/workflows/gate.yml`) does NOT build the image or run any smoke, so this surface is verified locally or not at all. CI recipes for running huu itself without Docker: `docs/ci.md`.

## References

- `src/lib/docker-reexec.ts`, `Dockerfile`, `compose.yaml`, `scripts/smoke-*.sh`, `docs/ci.md`
- Related skills: releasing-versions, isolating-agent-ports (HUU_NATIVE_SHIM_PATH)

> Facts verified against source on 2026-06-12; host config-dir mount + `HUU_CONFIG_DIR` export, the secret-mount-is-a-snapshot caveat and the stdio-inherit terminal path added + verified 2026-07-03.; `npm start`/`npm run dev` image auto-refresh via scripts/ensure-image.sh added + verified 2026-07-03.
