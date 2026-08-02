---
name: isolating-agent-ports
description: Explains per-agent port isolation — contiguous window allocation from base 55100, the .env.huu file, the with-ports bin shim, LD_PRELOAD/DYLD bind() interception and its critical sourcing gotcha, compile cache and HUU_NATIVE_SHIM_PATH. Use when agent ports collide, the native shim misbehaves or won't compile, or anything in port allocation changes.
metadata:
  version: 0.1.0
  type: knowledge
---

# Isolating Agent Ports

## When to use

Port collisions between parallel agents, shim compile/load failures, changes to `src/orchestrator/port-allocator.ts`, `native/port-shim/port-shim.c`, or the `.env.huu` / `with-ports` plumbing.

## Injected knowledge

### Allocation

- `port-allocator.ts:19` — `DEFAULT_BASE_PORT = 55100`; each agent reserves a contiguous window (`windowSize`, min `SLOTS_PER_BUNDLE`). A TCP probe rejects windows already in use and slides forward. Allocation is in-memory only — nothing persists between runs.

### Per-worktree wiring

- `writeAgentEnvFile()` writes `<worktree>/.env.huu` (mode 0600): `PORT`, `HUU_PORT_HTTP|DB|WS|EXTRA_<N>`, `HUU_PORT_REMAP`, `HUU_RUN_ID`, `HUU_AGENT_ID`, and — when a shim is available — `LD_PRELOAD` (Linux) or `DYLD_INSERT_LIBRARIES` (+ `DYLD_FORCE_FLAT_NAMESPACE=1`, macOS).
- `HUU_PORT_REMAP` is a CSV of `from:to` pairs with a `*:<port>` wildcard default (e.g. `3000:55100,5432:55110,*:55100`), parsed by the C interceptor in `native/port-shim/port-shim.c`, which rewrites `bind()` calls.
- `writeAgentBinShim()` writes `<worktree>/.huu-bin/with-ports` (0755): a bash script that sources `.env.huu` then `exec "$@"`.

### The gotcha that causes most bugs here

The `LD_PRELOAD`/`DYLD_*` values live only inside `.env.huu` and take effect only when a process is launched through `.huu-bin/with-ports` (or otherwise sources the file). Injecting them into the orchestrator's own `process.env` would apply ONE agent's remap to EVERY child process — defeating per-agent isolation. If a server inside an agent still binds the original port, the first thing to check is whether it was started via `with-ports`.

### Shim compilation

- `ensureNativeShim()` checks `HUU_NATIVE_SHIM_PATH` first (the Docker image pre-compiles the shim in the builder stage and exports this var — no gcc needed at runtime), then compiles on demand with `cc` (-O2 -fPIC -shared / -dynamiclib) into `.huu-cache/native-shim/<os>-<arch>/`, reused while its mtime ≥ source.
- `HUU_PORT_DEBUG=1` logs every remap the interceptor performs — first tool for "who stole my port".

### Coverage limits

Interception works for runtimes that route through libc `bind()` (Node, Python, Ruby, PHP, JVM, Bun, Deno, cgo-Go, glibc-Rust). It cannot work for static Go (`CGO_ENABLED=0`), musl-static Rust, Windows, machines without a C compiler (outside Docker), or SIP-protected macOS binaries. The full matrix and design rationale live in `docs/PORT-SHIM.md` — link, don't duplicate it here.

## References

- `src/orchestrator/port-allocator.ts`, `native/port-shim/port-shim.c`, `docs/PORT-SHIM.md` (canonical matrix)
- Related skills: working-on-orchestrator, running-in-docker (prebuilt shim path)

> Facts verified against source on 2026-06-12.
