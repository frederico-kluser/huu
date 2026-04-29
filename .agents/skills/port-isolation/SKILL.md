---
name: port-isolation
description: >-
  Define per-agent TCP port allocation, the bind() interceptor (LD_PRELOAD /
  DYLD_INSERT_LIBRARIES), `.env.huu` injection, and the on-demand C compile
  pipeline. Use when modifying port allocation, the native shim, the
  `with-ports` wrapper, or when a pipeline hits EADDRINUSE under
  parallelism. Do not use for general port-related questions outside the
  agent runtime.
---
# Port Isolation

## Goal

Documents how `huu` keeps parallel agents from colliding on TCP/UDP ports
without resorting to Docker or network namespaces. Worktrees isolate the
filesystem; this layer isolates the host network.

The complete walkthrough — problem framing, alternatives weighed, design
decisions, and limits — lives in [`PORT-SHIM.md`](../../../PORT-SHIM.md) at
the repo root. **Read it before changing anything in this layer.**

## Boundaries

**Do:**
- Allocate ports via `PortAllocator.allocate(agentId)` — never hand-pick
  a port in orchestrator code.
- Release the bundle on **every** terminal path (success, retry-final,
  setup-fail, abort, safety-net catch). Centralize via the `release()`
  call sites already present in `orchestrator/index.ts`.
- Write `.env.huu` and the `.huu-bin/with-ports` shim **after** worktree
  creation and **before** invoking the AgentFactory. Both must exist when
  the agent starts so the system prompt's `with-ports <cmd>` instruction
  is actionable.
- Use `ensureNativeShim()` once at run start; cache lives in
  `<repoRoot>/.huu-cache/native-shim/<os>-<arch>/`.
- Add new ignored artefacts (`.huu-cache/`, `.env.huu`, `.huu-bin/`) via
  `ensureGitignored()` — do not edit `.gitignore` by hand.

**Don't:**
- Modify the user's `.env`, `.env.local`, or any other dotenv file. Only
  write `.env.huu` (the dedicated, gitignored sentinel).
- Pass `LD_PRELOAD` via the orchestrator's `process.env` — that affects
  every child of every agent simultaneously, defeating per-agent
  isolation. The path is exclusively `with-ports → source .env.huu →
  exec`, which scopes the env to that one subprocess tree.
- Add a fallback that writes shim source to a temp dir on the fly. The
  source must remain at `native/port-shim/port-shim.c`; `native-shim.ts`
  locates it relative to the module URL and works for both `tsx` (dev)
  and built `dist/` layouts.
- Remap port `0`. It's the kernel's "give me an ephemeral" signal —
  rewriting it breaks tools that read `getsockname()` after binding.
- Change the default base port (`55100`) without checking the ephemeral
  range on Linux (32768–60999) — overlap is mitigated by the TCP probe
  but should stay rare.

## Workflow

The feature is four layers; new code touches one or two at a time. Know
which layer you're in:

### Layer 1 — `PortAllocator` (`src/orchestrator/port-allocator.ts`)
- One contiguous window of `windowSize` ports per `agentId`.
- TCP probe via `net.createServer({ exclusive: true })` rejects windows
  that overlap with externally held ports; the algorithm slides forward
  up to `maxAgents × 4` slots before giving up.
- In-memory only; no persistence between runs.
- Idempotent for the same `agentId` (retries reuse the same bundle).

### Layer 2 — `agent-env.ts`
- `writeAgentEnvFile(worktreePath, bundle, runId, shim?)` writes
  `.env.huu` with `PORT`, `HUU_PORT_*`, `DATABASE_URL`, `HUU_PORT_REMAP`,
  and (when `shim` is non-null) `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES` +
  `DYLD_FORCE_FLAT_NAMESPACE=1` (macOS).
- `writeAgentBinShim(worktreePath)` drops `<worktree>/.huu-bin/with-ports`
  — a bash script that does `set -a; source .env.huu; set +a; exec "$@"`.
- `buildPortRemap(bundle)` produces the `HUU_PORT_REMAP` value: well-known
  ports paired with extras, plus a `*:HUU_PORT_HTTP` catchall.

### Layer 3 — Native bind() interceptor
- C source: [`native/port-shim/port-shim.c`](../../../native/port-shim/port-shim.c).
- Build: `cc -O2 -fPIC -shared -o huu-port-shim.so port-shim.c -ldl
  -lpthread` (Linux) or `cc -O2 -fPIC -dynamiclib -o
  huu-port-shim.dylib port-shim.c` (macOS).
- Compile pipeline: `ensureNativeShim(repoRoot, onWarning?)` in
  `src/orchestrator/native-shim.ts`. Returns `null` gracefully when
  `cc` is missing, the platform is unsupported (Windows), or compile
  fails. Cache key: `<os>-<arch>`.
- Activation: the `LD_PRELOAD=...` line baked into `.env.huu` (Linux) or
  the `DYLD_INSERT_LIBRARIES=...` + `DYLD_FORCE_FLAT_NAMESPACE=1` pair
  (macOS).
- Algorithm: intercept `bind(2)` for `AF_INET`/`AF_INET6`; consult
  `HUU_PORT_REMAP` (parsed once via `pthread_once`); rewrite
  `sockaddr.sin_port` before delegating to `dlsym(RTLD_NEXT, "bind")`.
  Other socket families pass through unchanged.

### Layer 4 — System prompt
- `formatPortGuidanceForPrompt(bundle, shimAvailable)` in
  `agent-env.ts` produces the markdown block.
- `generateAgentSystemPrompt(...)` in `agents-md-generator.ts` injects it
  before the Rules section, in both whole-project and file-scoped
  branches.
- The prompt's content **changes** based on `shimAvailable`: when true,
  it tells the agent that hardcoded ports will be remapped silently;
  when false, it warns the agent to avoid hardcoded ports.

## Coverage matrix

The interceptor only works for code that goes through the dynamic libc
loader. Use the PORT-SHIM.md matrix as the source of truth, summarized:

- ✅ Node, Python, Ruby, PHP, Perl, JVM, Bun, Deno, Go-with-cgo,
  Rust-glibc.
- ❌ Statically-linked Go (`CGO_ENABLED=0`), Rust on `musl` static
  targets, Windows hosts, hosts without `cc`, macOS with SIP-protected
  binaries.

For ❌ rows, the env-only path still works for cooperative code; for
hardcoded-port cases, document `concurrency = 1` in the pipeline as the
fallback.

## Gotchas

- `LD_PRELOAD` is in `.env.huu` — but `.env.huu` only takes effect
  when something **sources** it. Frameworks that read dotenv pick up
  `PORT` and friends, but they do **not** pick up `LD_PRELOAD` (that
  is enforced by the dynamic linker at process exec, not by dotenv
  libraries). So the interceptor activates only when the agent runs
  via `./.huu-bin/with-ports <cmd>`. The system prompt instructs this
  explicitly; agent compliance is required.
- The `bash` tool of the Pi SDK inherits the **orchestrator's**
  `process.env`, not a per-agent env. We deliberately do **not** set
  `LD_PRELOAD` on the orchestrator — it would apply to all agents
  simultaneously with the same `HUU_PORT_REMAP`, defeating per-agent
  isolation. Per-call env injection would require a Pi SDK patch
  upstream; see "Future work" in PORT-SHIM.md.
- `pipeline.portAllocation: { enabled: false }` disables the entire
  feature. Useful for pipelines that never bind a socket — saves the
  ~50ms compile on first run and the dotenv noise.
- Allocator releases must happen for **every** path, including the
  outer `executeTaskPool` `.catch()` safety net. Forgetting one path
  leaks the agent's window across runs in the same orchestrator
  instance (only relevant when the orchestrator is reused — currently
  not the case, but the contract is "release everywhere" anyway).
- Probe TCP failures slide the window forward; this is a feature, not
  a bug. If the user's Postgres is on `55121`, agent 1 simply gets
  `55200..55209` instead. The probe cost is ~1ms per slot.
- `HUU_PORT_DEBUG=1` makes the C shim log every remap to stderr —
  invaluable when an agent reports EADDRINUSE despite the shim being
  "active". If nothing is logged, `LD_PRELOAD` did not reach the
  process (almost always: agent forgot the `with-ports` prefix).
- **Docker container ≠ container-per-agent.** The `huu` Docker image
  (see `docker-runtime` skill) puts the entire orchestrator into a
  single container; the N parallel agents are sibling processes
  inside it and share the network namespace. Port collisions therefore
  still happen and the port-shim is still required. The official
  Dockerfile pre-compiles the `.so` in the builder and exports
  `HUU_NATIVE_SHIM_PATH=/opt/huu/native/huu-port-shim.so` so the
  runtime never needs `cc`. **When derivative images strip the
  prebuilt without installing a compiler, layer 3 silently degrades.**
  See PORT-SHIM.md §6.4.
- `HUU_NATIVE_SHIM_PATH`: when set and the file exists,
  `ensureNativeShim()` returns it verbatim — no compile, no cache
  check, no arch validation. Trust the operator. When set but the
  file is missing, emit a warning and fall through to the normal
  compile-on-demand flow.

## When in doubt

Read [`PORT-SHIM.md`](../../../PORT-SHIM.md). It documents:
- Why we rejected Docker (per-agent), netns, code rewriting, and serialization.
- The diagnostic flowchart for "EADDRINUSE despite the shim".
- The Docker scenario (huu-in-container) and how the prebuilt path
  preserves layer 3 (§6.4).
- The exhaustive list of what we did **not** solve (AF_UNIX paths,
  global file locks, distroless static binaries) and the reasons.
