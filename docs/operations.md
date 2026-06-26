# Operations · `huu`

> **Português (BR):** [docs/operations.pt-BR.md](operations.pt-BR.md)

How to run `huu` in production-like settings — Docker modes, configuration,
auto-scaling, cost control, port isolation, FAQ, roadmap.

## Table of contents

- [Docker](#docker)
  - [Lifetime and signals](#lifetime-and-signals)
  - [VPN / MTU handling](#vpn--mtu-handling)
  - [Isolated-volume mode](#isolated-volume-mode)
  - [Compose](#compose)
  - [Docker secrets](#docker-secrets)
  - [Image variants](#image-variants)
  - [Cookbook in the image](#cookbook-in-the-image)
  - [Don't want Docker?](#dont-want-docker)
- [Configuration](#configuration)
  - [API key registry](#api-key-registry)
  - [Environment variables](#environment-variables)
  - [Files written by the tool](#files-written-by-the-tool)
  - [Recommended models](#recommended-models)
- [Auto-scaling concurrency](#auto-scaling-concurrency)
- [Cost predictability](#cost-predictability)
- [Port isolation (overview)](#port-isolation-overview)
- [Visual conventions](#visual-conventions)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Docker

`huu` runs in Docker by default — your shell credentials, `~/.ssh`, and
`~/.aws` are never visible to the LLM agent. The recommended path is to
**build the image from source** (zero registry dependency, full
reproducibility):

```bash
git clone https://github.com/frederico-kluser/huu
cd huu
docker build -t huu:local .
HUU_IMAGE=huu:local huu run pipeline.json
# or: docker run --rm -it --user "$(id -u):$(id -g)" \
#       -v "$PWD:$PWD" -w "$PWD" -e OPENROUTER_API_KEY \
#       huu:local run pipeline.json
```

Pre-built images are published manually by the maintainer to
`ghcr.io/frederico-kluser/huu:<version>`. If a tag is available, the
wrapper pulls it automatically:

```bash
export OPENROUTER_API_KEY=sk-or-...
huu run pipelines/huu-test-suite.pipeline.json     # auto-uses ghcr.io/frederico-kluser/huu:latest
```

> huu writes the bundled default pipelines into `./pipelines/` on first
> launch — pick one on the welcome screen or pass its path.

Behind the scenes the wrapper builds the equivalent of:

```bash
docker run --rm -it \
  --cidfile /tmp/huu-cids/cid-<pid>-<rand>.id \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" \
  -e OPENROUTER_API_KEY \
  ghcr.io/frederico-kluser/huu:latest run pipelines/huu-test-suite.pipeline.json
```

> **Why mount `$PWD:$PWD` (same path on both sides)?** git stores
> absolute paths inside `.git/worktrees/<name>/gitdir`. Mounting under
> a different prefix would leave host-visible worktree pointers that
> resolve to nowhere when the container exits.

### Lifetime and signals

Lifetime is bound to your terminal. Ctrl+C, closing the terminal
(SIGHUP), and `kill` (SIGTERM) all stop the container reliably. The
wrapper traps each signal in the host process and issues
`docker kill --signal …` against the captured cidfile, which sidesteps
the long-standing [moby#28872](https://github.com/moby/moby/issues/28872)
where `docker run -it` sometimes drops signals on the way to the
container. Inside the container, [tini](https://github.com/krallin/tini)
(PID 1) forwards the signal to huu's Node process, the TUI's exit
handlers run, and `--rm` removes the container.

If the wrapper itself is killed hard (`kill -9`, OOM), the next `huu`
invocation prunes any orphan containers whose recorded parent PID is no
longer alive. Use `huu prune --list` to inspect lingering huu
containers, `huu prune --dry-run` to preview cleanup, and `huu prune`
to force kill them.

### VPN / MTU handling

**On a VPN (WireGuard / OpenVPN / Tailscale exit-node)? Just works.** At
wrapper startup, huu inspects the host's default-route MTU (on Linux).
When it's below 1500 — typical of VPN tunnels — huu auto-creates a
docker bridge named `huu-net-mtu<N>` with the matching MTU and runs the
container on it. No env var, no daemon.json edits, no
`--network=host`. The network is idempotent and reused across runs; if
your VPN MTU changes, a fresh per-MTU network is created next time.

To override (e.g., force `host` networking or use a pre-existing custom
network), set `HUU_DOCKER_NETWORK=<value>` — passed verbatim to
`docker run --network`. To inspect what huu created:
`docker network ls | grep huu-net-`.

Why this matters: without MTU clamping, the docker bridge (1500) >
tunnel (~1420) mismatch silently drops TLS ClientHello packets, and
every HTTPS handshake hangs. As defense-in-depth, the orchestrator also
runs an 8s OpenRouter reachability probe at run-start and aborts loudly
if upstream is unreachable, so you never burn 30 minutes on retry
loops.

### Isolated-volume mode

For max performance on macOS / Windows with full filesystem isolation:
tell huu to put worktrees on a named volume instead of inside the
bind-mounted repo. Branch operations stay on the repo (so the
integration branch still lands in your local `git log`); only the
per-agent scratch space goes to the fast volume.

```bash
docker volume create huu-worktrees
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" \
  -v huu-worktrees:/var/huu-worktrees \
  -e HUU_WORKTREE_BASE=/var/huu-worktrees \
  -e OPENROUTER_API_KEY \
  ghcr.io/frederico-kluser/huu:latest run pipeline.json
```

`HUU_WORKTREE_BASE` accepts an absolute path (used verbatim) or a
repo-relative path (resolved against the repo root). When set,
`git worktree list` on the host won't show the active per-agent trees
during the run — that's the trade-off for the speedup.

### Compose

```bash
# uses the bundled compose.yaml (builds the image on first run)
export OPENROUTER_API_KEY=sk-or-...
docker compose run --rm huu run pipelines/huu-test-suite.pipeline.json
```

**Convenience wrapper:** drop [`scripts/huu-docker`](../scripts/huu-docker)
on your `PATH` to abbreviate the above to `huu-docker run pipeline.json`.

### Docker secrets

The auto-Docker wrapper handles `OPENROUTER_API_KEY` securely: it writes
the key to a `0600`-mode file under `/dev/shm` (Linux tmpfs — never
hits disk; falls back to `os.tmpdir()` elsewhere) and bind-mounts it
read-only at `/run/secrets/openrouter_api_key` inside the container.
The key value never appears in `docker inspect`, never appears in
`ps auxf`, and is unlinked from the host as soon as the wrapper exits.

For Compose-driven setups, the canonical pattern works:

```yaml
# compose.yaml fragment
services:
  huu:
    secrets:
      - openrouter_api_key
secrets:
  openrouter_api_key:
    file: ./openrouter.key  # or external: true with `docker secret create`
```

The image checks `/run/secrets/openrouter_api_key` before falling back
to `OPENROUTER_API_KEY_FILE` and finally the plain env var — same
precedence the postgres image uses.

### Image variants

- `huu:latest` (~613MB) — ships `openssh-client` for SSH-based git
  remotes.
- `huu:slim` (~604MB; build-arg `INCLUDE_SSH=false`) — drops it for
  HTTPS-only setups.

### Cookbook in the image

The official image ships the repo's reference pipelines at
`$HUU_COOKBOOK_DIR` (`/opt/huu/cookbook/`). Pull a curated pipeline
into your repo without cloning anything:

```bash
docker run --rm ghcr.io/frederico-kluser/huu:latest \
  cookbook pull huu-test-suite > my-test-pipeline.json
```

### Don't want Docker?

`huu --yolo` (or `HUU_NO_DOCKER=1 huu …`) bypasses Docker and runs
natively on the host. The flag composes with everything: `huu --yolo`
opens the TUI, `huu --yolo run x.json` executes a pipeline,
`huu --yolo --stub` runs the stub agent. Native runs require the local
`npm install` of huu's deps, and the LLM agent will see your shell
credentials (`~/.ssh`, `~/.aws`, …) — a one-line warning is printed to
stderr each time. The non-TUI subcommands (`huu --help`,
`huu init-docker`, `huu status`) always run native regardless.

### Troubleshooting: `denied: denied` on pull

`docker: ... error from registry: denied` means Docker could not pull the
image from GHCR — usually because the tag isn't published/is private, or
because of invalid cached credentials in `~/.docker/config.json` (GHCR
does not fall back to anonymous access in that case). Three ways out, from
simplest to most complete:

| Path | Command | When |
|---|---|---|
| Clear credentials | `docker logout ghcr.io` | Quick one-off fix |
| **Local build** | `docker build -t huu:local .` then `HUU_IMAGE=huu:local huu run …` | **Recommended** — reproducible, registry-free |
| Run native | `huu --yolo run …` (== `HUU_NO_DOCKER=1`) | Dev/testing; ⚠️ exposes `~/.ssh`/`~/.aws` to the agent |
| Re-authenticate | `echo "$PAT" \| docker login ghcr.io -u <user> --password-stdin` | Need private images (PAT with `read:packages` scope) |

---

## Configuration

### API key registry

`huu` resolves API keys through a declarative registry
(`src/lib/api-key-registry.ts`). Adding a key in the future is a
one-entry append; everything else (TUI prompt, Docker secret mount,
env-passthrough, orphan cleanup) iterates the same list.

The current registry:

| Key | Required | Backend | Used by |
|---|---|---|---|
| `OPENROUTER_API_KEY` (`openrouter`) | yes (without `--stub`) | Pi | The Pi SDK agent + the pipeline assistant + project recon. |
| `ARTIFICIAL_ANALYSIS_API_KEY` (`artificialAnalysis`) | yes | all | Model recommendations / live capability lookups in the picker. |
| `COPILOT_GITHUB_TOKEN` (`copilot`) | yes (when `--copilot`) | Copilot | The Copilot SDK agent. Fine-grained PAT with "Copilot Requests" scope, or `GH_TOKEN`. |

Resolution order for every spec (first non-empty wins) — the EXPLICIT
choice beats the AMBIENT one:

1. Container secret mount at `/run/secrets/<snake_case_name>` — same
   convention as the postgres / mysql Docker images. (On a Docker run the
   host resolves the key with this same order and re-mounts it here.)
2. The persisted global store at `$XDG_CONFIG_HOME/huu/config.json`
   (fallback `~/.config/huu/config.json`, mode `0600` in a `0700`
   directory). The TUI offers "save globally" the first time you paste
   a key and writes there. A key you explicitly saved now OUTRANKS the
   env var below it.
3. `<NAME>_FILE` env var pointing at a file with the value.
4. `<NAME>` env var (plain) — the fallback when nothing is saved (the
   standard CI / headless path).

Any key that resolves to empty AND is `required: true` causes the TUI
to pop the prompt on the way to the first run. Stub mode (`--stub`)
short-circuits the requirement check.

Because the saved store (step 2) now outranks the env var (step 4), a key you
explicitly saved in the Options screen takes precedence — a stale
`OPENROUTER_API_KEY` left in a shell profile no longer shadows it. If you
*want* the env var to apply, clear the saved key. `resolveApiKeyWithSource`
reports which tier won, so the abort message names the real source: update the
saved key when that one was used, or fix the env var / save a key when the env
var was only the fallback. The **web UI** keeps a key pasted in the browser
only in that tab's `sessionStorage` — validated against the provider first,
sent with each run, never written to `~/.config`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | yes (without `--stub`) | Sent to OpenRouter through the Pi SDK. If missing, the TUI prompts on first real run; "save globally" persists to `~/.config/huu/config.json`. |
| `OPENROUTER_API_KEY_FILE` | no | Path to a file containing the key. Wins over `OPENROUTER_API_KEY` when both are set; the canonical Docker-secret mount at `/run/secrets/openrouter_api_key` wins over both. A key saved via the Options screen (`~/.config/huu/config.json`) now outranks all three — clear it if you want an env var to apply. |
| `ARTIFICIAL_ANALYSIS_API_KEY` | yes | Used for live model-capability lookups (`supportsThinking`, pricing). Same precedence chain via `ARTIFICIAL_ANALYSIS_API_KEY_FILE` and `/run/secrets/artificial_analysis_api_key`. |
| `COPILOT_GITHUB_TOKEN` | yes (when `--copilot`) | GitHub fine-grained PAT with "Copilot Requests" scope (or `GH_TOKEN`). Required only when `--backend=copilot` is active. Same precedence chain via `COPILOT_GITHUB_TOKEN_FILE` and `/run/secrets/copilot_token`. |
| `HUU_WORKTREE_BASE` | no | Override the base directory for per-run worktrees. Absolute paths are used verbatim; relative paths are resolved against the repo root. Default: `<repo>/.huu-worktrees`. Used by the isolated-volume container mode. |
| `HUU_CHECK_PUSH` | no | When set, preflight verifies the configured remote is reachable before the run starts. |
| `HUU_IN_CONTAINER` | no | Set to `1` automatically by the official Docker image. Used by the wrapper to short-circuit the auto-Docker re-exec (so the same binary runs the TUI directly inside the container). |
| `HUU_IMAGE` | no | Override the container image used by the auto-Docker wrapper. Default: `ghcr.io/frederico-kluser/huu:latest`. Useful for pinning a release or pointing at a private mirror. |
| `HUU_NO_DOCKER` | no | When set to `1` or `true`, skip the auto-Docker re-exec and run huu natively. Equivalent to the `--no-docker` flag (the CI-neutral alias of `--yolo`). Requires the local `npm install` of huu's deps. Useful for huu development itself and for CI runners — see [`docs/ci.md`](ci.md). |
| `HUU_DOCKER_NETWORK` | no | Pass-through value for `docker run --network=<value>`. By default huu auto-creates `huu-net-mtu<N>` when on a VPN (default-route MTU < 1500); set this to override (e.g., `host`, or the name of a pre-existing user-managed network). |
| `HUU_DOCKER_PASS_ENV` | no | Whitespace-separated list of additional env var names to forward into the container. The wrapper always forwards `OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_FILE`, `HUU_CHECK_PUSH`, `HUU_WORKTREE_BASE`, `HUU_HOST_HOME`, and `TERM` — use this to add custom names. |
| `HUU_HOST_HOME` | no | Set automatically by the wrapper to the host's home directory. Inside the container, `getHuuHome()` reads it so writes to `~/.huu/` and the default `~/Downloads/` export target land on the host's bind-mounted filesystem. Unset outside Docker. |
| `HUU_UID` | no | Container UID for `docker compose` runs. Default: `1000`. Override with `HUU_UID=$(id -u)` if your host UID isn't 1000, or use the `scripts/huu-compose` wrapper which sets it automatically. |
| `HUU_GID` | no | Container GID for `docker compose` runs. Same defaulting rules as `HUU_UID`. |

### Files written by the tool

| Path | Scope | Purpose |
|---|---|---|
| `~/.config/huu/config.json` | global | API keys persisted via the TUI's "save globally" prompt (mode `0600` in a `0700` directory). |
| `~/.huu/recents.json` | global | Recently-used models for the picker. |
| `~/.huu/pipeline-memory.json` | global | Pipelines saved from the TUI editor. |
| `<repo>/.huu-worktrees/<runId>/` | repo | One subdirectory per agent during a run; removed at the end (manifest preserved). |
| `<repo>/.huu/<stamp>-execution-<runId>.log` | repo | Full chronological transcript of a run. |
| `<repo>/.huu/<stamp>-execution-<runId>/agent-<id>.log` | repo | Per-agent transcript. |
| `<repo>/.huu/debug-<ISO>.log` | repo | NDJSON debug trace, one line per lifecycle event. |
| `<repo>/.huu-cache/native-shim/<os>-<arch>/` | repo | Compiled `bind()` interceptor. Built once, reused across runs. |
| `<worktree>/.env.huu` | per-agent | Per-agent port assignments; auto-loaded by dotenv-aware tools. |
| `<worktree>/.huu-bin/with-ports` | per-agent | Shell wrapper that sources `.env.huu` and `exec`s a command — needed for binaries that ignore dotenv. |

When running under Docker (host-bind mode, the default), all of these
paths are visible on the host filesystem after the container exits —
same as a native run. `huu` adds `.huu-worktrees/`, `.huu/`,
`.huu-cache/`, `.env.huu`, and `.huu-bin/` to the repo's `.gitignore`
on the first run.

### Recommended models

`recommended-models.json` ships a curated short-list shown at the top
of the model picker. Each entry can carry optional metadata:
`description`, `bestFor` (use-case tags), `tier`
(`flagship` / `workhorse` / `fast`), and `provider`
(`openrouter` or `azure`).

In the **web UI**, the Model field loads the **full live OpenRouter
catalog** — every model, capability-annotated (`GET /api/models` →
`listAllModels` in `src/lib/openrouter.ts`). OpenRouter's `/models`
endpoint is **public**, so the catalog loads **with or without an
OpenRouter key**, the moment you open the picker; models that lack tool
calling are **badged** (`no tools`) rather than hidden, and you can type
any model id to use it verbatim. The curated short-list above is only the
offline / fetch-failure fallback.

When `ARTIFICIAL_ANALYSIS_API_KEY` is set, the quick picker renders a
fixed-width table with live metrics from Artificial Analysis —
`Model · tok/s · Agnt · Code · Razn · $in/$out · BestFor`. Without
the key, columns degrade to `—` placeholders without blocking selection.

---

## Auto-scaling concurrency

**Memory-aware auto-scaling is on by default.** The auto-scaler sizes
concurrency to the real memory headroom: it tracks each agent's actual
footprint (moving average, seeded at 250 MB) and admits new agents only
while they fit in the available memory minus a safety margin —
cgroup-aware, so inside a container it respects the container's limit,
not the host's. Pass `--concurrency=N` or `--no-auto-scale` to pin
**manual mode** instead (live-tunable with `+`/`-` on the run
dashboard; `A` re-enables auto). In headless configs, setting
`"concurrency"` pins manual; omit it for auto.

The auto-scaler watches CPU and RAM via `lib/resource-monitor.ts` and
moves between five states, surfaced in the header as
`AUTO <STATE> · CPU/RAM · ~<N>MB/agent · free <N>MB`:

- **NORMAL** — under both thresholds, willing to spawn more agents up
  to the queue depth.
- **SCALING_UP** — actively granting spawn slots.
- **BACKING_OFF** — usage above the stop threshold (default 90%);
  refuses new spawns but leaves running agents alone.
- **DESTROYING** — usage above the destroy threshold (default 95%);
  kills the **newest** agent (`killed_by_autoscaler` phase) to recover
  headroom. The killed card returns to the TODO column with a `↻N`
  requeue counter and the task restarts from zero later — older agents'
  work is never lost.
- **COOLDOWN** — 30s pause after a destroy or backoff event so the
  system doesn't oscillate.

Manual `+`/`-` on the dashboard automatically disables auto-scale —
press `A` to turn it back on. The **memory guard stays active in manual
mode** (the header swaps the `AUTO` chip for a `GUARD` chip with the
kill count). The status block also shows live `CPU%` and `RAM%`,
mirroring the `SystemMetricsBar` so you don't have to correlate two
readouts.

**MAX mode (`M`)** is a third, greedy mode: it floods the pool with one
agent per queued task (up to the hard ceiling) and lets the always-on
memory guard be the sole backstop, so concurrency settles right at the
destroy threshold. The header shows a blue `MAX <STATE>` chip with the
kill count; cooldown damping keeps it from thrashing. Press `M` again
(or `A`) to return to auto, `+`/`-` to drop to manual.

Override defaults by setting `agentMemoryEstimateMb`,
`stopThresholdPercent`, `destroyThresholdPercent`, `cooldownMs`, and
`maxAgents` in code if you embed the orchestrator; the CLI exposes
`--concurrency=N` and `--no-auto-scale`.

---

## Cost predictability

A `huu` run's cost is bounded by the number of cards and the model
chosen per stage. There is no agent loop that can decide to "also do
X" — you get the run you paid for.

**Today's tools to keep cost in check:**

- `--stub` runs the entire flow without any LLM. Use it to validate
  pipeline structure and decomposition before spending a dollar.
- `--copilot` uses subscription-based Copilot credits instead of
  per-token billing — cost stays within your existing GitHub plan's
  premium-request quota.
- Per-step `modelId` lets you route mechanical stages to Haiku / Gemini
  Flash and reserve Sonnet / Opus for stages that actually need it.
- Tokens and cost are recorded per agent and surfaced in the run
  summary; full breakdown in `.huu/<runId>-execution-...log`.

**Roadmap:** `huu estimate <pipeline.json>` will dry-run the
decomposition and produce a forecast like:

```
5 stages × 12 tasks × Sonnet 4.5: estimated $3.40, ~14 min wallclock.
```

Until that lands, the convention is: stub-validate first, then run
with eyes on the kanban during the first stage to catch surprises
early.

---

## Port isolation (overview)

`git worktree` isolates the **filesystem**. It does not isolate the
**host network**: when ten agents simultaneously launch `npm run dev`
they all hit `bind(3000)` on the same kernel. Nine fail with
`EADDRINUSE`, and the agents — correctly believing the customer code
is fine — burn tokens "fixing" a non-bug.

`huu` defends in four layers (none require Docker):

1. **`PortAllocator`** assigns each agent a contiguous window of TCP
   ports (default `55100 + (agentId − 1) × 10`).
2. **`.env.huu` per worktree** — a dedicated env file exporting
   `PORT`, `HUU_PORT_HTTP`, `HUU_PORT_DB`, `HUU_PORT_WS`,
   `DATABASE_URL`, and seven extras. Frameworks that respect dotenv
   (Next, Vite, Nest, Astro, dotenv-flow, …) load it automatically.
3. **Native `bind()` interceptor.** A ~170-line C shared library at
   `native/port-shim/port-shim.c`. The orchestrator compiles it with
   `cc` and preloads it via `LD_PRELOAD` (Linux) or
   `DYLD_INSERT_LIBRARIES` (macOS). Customer code is never modified —
   `app.listen(3000)` literal in source ships exactly as written; the
   kernel just sees a per-agent port instead.
4. **System prompt** — the agent is shown its allocated ports and
   reminded to prefix non-dotenv-aware commands with the
   `./.huu-bin/with-ports <command>` shell wrapper.

**Coverage matrix, exclusions, disabling, and the full design:**
[`PORT-SHIM.md`](PORT-SHIM.md).

To opt out for pure refactors / static analysis / doc generation, add
`"portAllocation": { "enabled": false }` to the pipeline.

---

## Visual conventions

**Magenta = AI actions.** Whenever you see a purple panel or marker
(`✦`) — the **Smart Select** mode (`S` on the file picker), the
**Pipeline Assistant**, **Project Recon**, **agent logs** — there is
an LLM being invoked on your behalf. Cyan is neutral
navigation/selection; green is confirmation/success; yellow is
intermediate state or warning; red is error; blue is non-AI auxiliary
information (helper modals, non-AI scopes).

Tokens are defined in [`src/ui/theme.ts`](../src/ui/theme.ts).
Components that introduce new magenta usage outside of AI contexts
should pick another color.

---

## FAQ

**Can I run this unsupervised, overnight?**
Yes — it's the primary use case. Each agent has timeouts and retries;
the run terminates itself with a persisted summary. Read
`.huu/<runId>-execution-*.log` in the morning. To get notified on
completion, wire the CLI exit code into a notifier (ntfy, webhook,
Slack incoming-webhook, your habit of choice).

**Will the run touch my checked-out branch?**
No. Every agent works in its own worktree branched off your current
HEAD. Your working tree is never modified during a run.

**Do I need to commit before running?**
Yes. Preflight refuses to start on a dirty working tree. Stash or
commit first.

**What happens if an agent crashes mid-run?**
The orchestrator marks the card as failed, drops its worktree, and
(depending on `maxRetries`) re-spawns the task in a fresh worktree on
the same integration HEAD. If retries are exhausted, the run
continues without that card and the failure is preserved in the
summary.

**Why did an agent's card jump back to TODO with a `↻` badge?**
The always-on memory guard fired: at ~95% RAM (or CPU) it kills the
**newest** agent — the one with the least work done — so the older
agents' work survives. The card returns to the TODO column with a `↻N`
requeue counter and the task restarts from zero once memory frees up.
The guard is active in every concurrency mode (auto, manual, and MAX). Memory-aware auto-scale
is the default; pin a fixed agent count with `--concurrency=N` or
`--no-auto-scale` (or `"concurrency": N` in a headless config).

**Can I run huu in CI (GitHub Actions / GitLab)?**
Yes — a CI runner is already an ephemeral container, so skip the
Docker wrapper with `HUU_NO_DOCKER=1` (or `--no-docker`) and drive the
run with `huu auto`. Full recipes, including artifact upload of
`.huu/audits/`: [`docs/ci.md`](ci.md).

**What if two agents touch the same file?**
A sign the pipeline was misdesigned: in a healthy pipeline, each task
in a stage owns a disjoint file. If overlap happens anyway and git
can't auto-merge, an integration agent backed by a real LLM resolves
the conflict on a side worktree and continues. Conflict resolution is
disabled in `--stub` mode. Treat this path as a safety net, not a
feature.

**Can I abort a run safely?**
Yes. `Q` triggers a cooperative abort: in-flight agents finish their
current step, branches with commits are kept as artifacts, the
integration worktree is cleaned up. Press `Q` again to force-exit the
dashboard.

**How much will I spend?**
Depends on pipeline shape and model. A 30-file pipeline on Sonnet 4.5
typically lands between $1 and $10. Use `--stub` to validate
structure first; route mechanical stages to cheaper models via
per-step `modelId`. The run summary breaks cost down per agent.

**Why two timeout values?**
Single-file cards usually finish faster than whole-project cards by an
order of magnitude. Splitting the timeout means tight feedback on
per-file work without prematurely killing a broader card that's still
making progress.

**Where do I put my API key?**
For **Pi** (default backend): export `OPENROUTER_API_KEY` before
launching, or paste it in the prompt the first time you start a run
without it. For **Copilot**: export `COPILOT_GITHUB_TOKEN` (GitHub
PAT with "Copilot Requests" scope). The tool itself never persists
the key unless you choose "save globally" in the TUI prompt.

**Why is the Docker container slower on macOS?**
Bind-mounted filesystems on macOS cross a VM boundary, adding ~3×
latency for many-small-files operations like `git worktree add`. Use
[OrbStack](https://orbstack.dev/) instead of Docker Desktop for ~2×
faster file I/O on the same workload.

**Can I run huu on Windows without WSL2?**
Not practically. Docker Desktop on Windows requires either WSL2 or
Hyper-V, and bind-mounted Windows paths (`/mnt/c/...`) are 10–20×
slower than ext4 inside WSL — enough to make `git worktree add` for
a real pipeline take minutes per task. Install WSL2, clone your repo
into `/home/<user>/` inside WSL, and use Docker Desktop with WSL
integration enabled.

**Why does Ctrl+C in the container sometimes leave my terminal wedged?**
It shouldn't — the image runs `tini` as PID 1 to forward signals,
and `huu`'s CLI installs a belt-and-suspenders raw-mode restorer
for `SIGINT`/`SIGTERM`/`SIGHUP`/`uncaughtException`. If you ever see
a stuck terminal, run `stty sane` to recover and please open an
issue with the contents of `.huu/debug-<ISO>.log` from that run.

**Files in `.huu-worktrees/` are owned by root and I can't delete them.**
You're on a host where your primary user isn't UID 1000. Either:
1. Use `scripts/huu-compose run pipeline.json` — auto-detects your
   UID via `id(1)` and exports `HUU_UID`/`HUU_GID`.
2. Export once per shell: `export HUU_UID=$(id -u) HUU_GID=$(id -g)`
   and then use `docker compose run` normally.

---

## Roadmap

- `huu estimate <pipeline.json>` — dry-run cost and wallclock forecast.
- `huu lint <pipeline.json>` — detect overlapping `files` across
  stages, missing `$file` placeholders, undefined model IDs.
- `huu/cookbook` — community pipeline registry, with each entry
  tagged by domain (testing, audits, refactors, docs).
- GitHub Action wrapper — run a `huu` pipeline as part of CI on a
  labeled PR.
- JSON Schema + LSP for `huu-pipeline-v1.json` — autocomplete and
  validation in editors.

---

## Contributing

`huu` is open-source under [Apache 2.0](../LICENSE). Issues and pull
requests are welcome.

Ground rules:

- Read the relevant skill under `.agents/skills/` before changing a
  layer you're not familiar with.
- Prefer **Conventional Commits** (`feat:`, `fix:`, `refactor:`,
  `docs:`, …).
- Never force-push to `main`.
- There is **no automated CI**. Run `npm run typecheck && npm test`
  locally before opening a PR. Enable the pre-push hook with
  `git config core.hooksPath .githooks` to enforce it.

```bash
npm run dev          # hot-reload TUI on src/cli.tsx
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest (orchestrator, run logger, file scanner, pipeline e2e)
```

Smoke tests for releases:

```bash
docker build -t huu:local .
./scripts/smoke-image.sh        # ~10s — image sanity
./scripts/smoke-pipeline.sh     # ~60s — end-to-end pipeline with --stub
```
