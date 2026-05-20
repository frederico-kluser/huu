---
name: docker-runtime
description: >-
  Define the host wrapper, signal lifecycle, image variants, and HEALTHCHECK
  semantics for huu's Docker integration. Use when modifying the auto-reexec
  layer, the entrypoint, the Dockerfile, or any of the *-docker / status /
  sentinel modules. Do not use for pipeline logic, TUI components, or git
  worktree concerns.
---
# Docker Runtime

## Goal

`huu` is the same binary on the host and inside the container. A gate at
the very top of `cli.tsx` decides which world it runs in. This skill
captures the invariants that gate must preserve.

## Boundaries

**Do:**
- Keep the re-exec decision (`decideReexec` in `lib/docker-reexec.ts`) pure
  — argv + env in, decision out. No side effects.
- Trap SIGINT/SIGTERM/SIGHUP in the wrapper and `docker kill --signal …`
  the container via the recorded cidfile. Don't rely on docker's own
  `--sig-proxy` (moby#28872 documents the breakage with `-it`).
- Match host UID/GID via `--user "$(id -u):$(id -g)"` so files written
  on the bind mount stay owned by the host user.
- Preserve the same-path bind mount: `-v "$PWD:$PWD" -w "$PWD"`. git
  worktree paths are absolute; mismatched mount prefixes leave host-
  visible pointers that resolve nowhere.
- Preserve the host-home bind mounts: `~/.huu` (always) and `~/Downloads`
  (when it exists on the host) at the same absolute path, paired with
  `HUU_HOST_HOME=$HOME` in the passthrough set. The in-container code
  resolves `~/.huu/...` and the default Downloads export target via
  `src/lib/huu-home.ts::getHuuHome()` which reads `HUU_HOST_HOME` first.
  Without these, "save pipeline" inside the container writes to the
  container's ephemeral `$HOME` and is wiped by `--rm`.
- Add new env vars to the passthrough set in `buildDockerArgv` AND to
  the README configuration table.
- Inside the container, every TUI launch must write `/tmp/huu/active`
  with the active run's cwd (used by HEALTHCHECK) and clear it on exit.

**Don't:**
- Mount the host's full `$HOME` into the container. The whole point of
  the Docker isolation is keeping the agent out of `~/.ssh`, `~/.aws`,
  `~/.npmrc`. Only target `~/.huu` and `~/Downloads`; if a new dir
  needs to persist host-side, add it explicitly with the same-path
  pattern, never widen to `$HOME`.
- Pull in heavy imports above the re-exec gate — the wrapper path must
  stay light. Imports below the top-level await still load (ESM hoists
  them) but their bodies must be pure (no fs writes, no timers).
- Pass `OPENROUTER_API_KEY` via `-e KEY=value`. The wrapper writes the
  value to `/dev/shm/huu-openrouter-key-<pid>-<rand>` (mode 0600) and
  bind-mounts read-only at `/run/secrets/openrouter_api_key`; the
  container's resolver in `lib/api-key.ts` reads from there. The key is
  never in argv (`ps auxf`) or in `docker inspect` output. Other env
  vars use the valueless `-e KEY` form so values stay out of argv too.
- Run a HEALTHCHECK probe from inside `WORKDIR` — probes execute as
  fresh processes from `/`. Use `cd "$(cat /tmp/huu/active)"` first.
- Add a `HEALTHCHECK` directive that fails when no run is active.
  `--liveness` returns 0 unless `phase ∈ {stalled, crashed}` for that
  exact reason.
- Add new top-level statements between the re-exec gate and the
  imports — they would execute on the wrapper path and undermine
  the "wrapper is silent" invariant.
- Ship the runtime image without `HUU_NATIVE_SHIM_PATH` pointing at a
  prebuilt `.so`. The runtime stage has no `cc`, so without the prebuilt
  the bind() interceptor (see `port-isolation` skill) silently degrades
  to env-only — and parallel agents that hardcode `bind(3000)` collide
  inside the shared container netns. The Dockerfile compiles
  `huu-port-shim.so` in the builder, copies it to
  `/opt/huu/native/huu-port-shim.so`, and exports the env var.

## When to use

- Editing `Dockerfile`, `compose.yaml`, or anything under `docker/`
- Touching `lib/docker-reexec.ts`, `lib/active-run-sentinel.ts`,
  `lib/init-docker.ts`, `lib/status.ts`, `lib/prune.ts`, or
  `lib/api-key.ts`
- Reviewing changes to `cli.tsx`'s top-level gate
- Diagnosing signal/lifetime issues (`huu` won't die on Ctrl+C, etc.)
- Updating any of `scripts/huu-docker`, `scripts/smoke-image.sh`,
  `scripts/smoke-pipeline.sh`, or the README's "Run with Docker" section

## Don't use for

- Pipeline schema or task decomposition (see `pipeline-agents`)
- TUI screen routing or Ink components (see `ui-tui-ink`)
- Git worktree mechanics (see `git-workflow-orchestration`)
- Build / dev / test tooling unrelated to Docker (see `build-dev-tools`)

## Lifecycle invariants

```
host process              container PID 1            container PID 2+
─────────────             ─────────────────          ──────────────────
cli.tsx top-level
decideReexec → re-exec
spawn docker run
register SIGINT/HUP/TERM
                    →     tini                  →    huu-entrypoint (sh)
                                                     auto-prepend `huu` if
                                                     first arg unfamiliar
                                                →    huu (Node)
                                                     installSafeTerminal
                                                     initDebugLogger
                                                     writeActiveRunSentinel
                                                     ...TUI runs

Ctrl+C / SIGHUP →
docker kill --signal X cid →
                          tini receives X
                          forwards to huu (PID 2)
                                                     SIGINT handler runs
                                                     restoreTerminal
                                                     clearActiveRunSentinel
                                                     process.exit(130)
                          tini exits with same code
docker run exits          ← container removed (--rm)
wrapper resolves promise
exit code propagates
```

Hard-kill of the wrapper (`kill -9`, OOM): no traps fire, container
becomes orphan. `pruneOrphans()` at the start of the next invocation
checks every cidfile in `/tmp/huu-cids/` against `process.kill(pid, 0)`
and `docker kill`s any whose parent is gone.

## Files in this layer

| File | Role |
|---|---|
| `src/cli.tsx` (top) | Re-exec gate, sentinel write/clear, signal handlers |
| `src/lib/docker-reexec.ts` | `decideReexec`, `buildDockerArgv`, `reexecInDocker`, secret-file mount, host-home bind mount, orphan prune |
| `src/lib/huu-home.ts` | `getHuuHome()` — reads `HUU_HOST_HOME`, falls back to `homedir()`. Single source of truth for `~/.huu/...` paths across pipeline-memory, pipeline-io, model recents, and the Downloads export default |
| `src/lib/active-run-sentinel.ts` | `/tmp/huu/active` read/write/clear |
| `src/lib/api-key.ts` | OpenRouter key resolver (`/run/secrets/...` → `_FILE` → env) |
| `src/lib/init-docker.ts` | `huu init-docker` scaffolder for user repos |
| `src/lib/status.ts` | `huu status` headless monitor; powers HEALTHCHECK |
| `src/lib/prune.ts` | `huu prune` manual orphan inspection / cleanup |
| `Dockerfile` | Multi-stage build, tini, ENTRYPOINT chain, HEALTHCHECK |
| `docker/entrypoint.sh` | UID-aware safe.directory + auto-prepend `huu` |
| `compose.yaml` | Local dev compose (uses `build:`, not the published image) |
| `scripts/huu-docker` | Bash wrapper (alternative to the auto-reexec) |
| `scripts/smoke-image.sh` | Local smoke da imagem (substitui o que era CI) |
| `scripts/smoke-pipeline.sh` | Local smoke fim-a-fim com `huu --stub run` |

## Tests that protect this layer

- `src/lib/docker-reexec.test.ts` — re-exec decision matrix, argv shape
  (valueless `-e KEY`, `--mount` for secrets), env passthrough,
  excludeFromEnv path, `makeSecretFile` 0600 perms, no-args fallback
- `src/lib/active-run-sentinel.test.ts` — sentinel CRUD + race protection
- `src/lib/init-docker.test.ts` — scaffolder renderers + force/skip
- `src/lib/status.test.ts` — NDJSON parser + phase reduction + CLI flags
- `src/lib/prune.test.ts` — stale cidfile detection (alive/dead/EPERM),
  CLI matrix (`--list` / `--dry-run` / `--json` / bare), kill+unlink failures
- `src/lib/api-key.test.ts` — resolver precedence
- `scripts/smoke-image.sh` — image inspection (HEALTHCHECK directive present),
  worktree path consistency under bind mount, slim variant SSH absence
  (rodado manualmente — não há CI automatizada)
- `scripts/smoke-pipeline.sh` — fim-a-fim de `huu --stub run pipeline.json`:
  asserta integration branch, agent branches, debug log, working tree limpo
