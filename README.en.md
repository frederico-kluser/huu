<p align="center">
  <img src="assets/huu-demo.gif" alt="huu generating 100% unit-test coverage — 55 minutes sped up to 10 seconds" width="720">
</p>

<p align="center">
  <em>55 minutes of <code>huu</code> generating 100% unit-test coverage — sped up to 10 seconds.</em>
</p>

<h1 align="center">huu</h1>

<p align="center">
  <strong><code>huu</code> — <em>Humans Underwrite Undertakings</em>.</strong>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.md">Português (BR)</a>
</p>

<p align="center">
  <a href="#license"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <img alt="Node.js 20+" src="https://img.shields.io/badge/node-%E2%89%A5%2020-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.x-3178C6?logo=typescript&logoColor=white">
  <img alt="Built with Ink" src="https://img.shields.io/badge/TUI-Ink%204-000000">
</p>

---

## What huu is

**A pipeline is a file of orders that the AI obeys.** You write a
`huu-pipeline-v1.json` listing the steps and the files each step
touches. The orchestrator turns each step into a fan-out of parallel
agents — one agent per file when you ask for it — runs them in
isolated git worktrees, and merges them back into a single integration
branch **between every stage**. The whole run is sandboxed in Docker
so the agent never sees your shell credentials.

That sentence has a few claims worth unpacking:

- **The human underwrites the scope.** No LLM planner decides what
  step 3 should do or which files it should touch. If a step is
  misdesigned, the result is predictably and auditably wrong — not
  surprisingly wrong.
- **In `per-file` mode, one agent gets one file.** The prompt is
  identical across the N agents — only `$file` is substituted. No
  context degradation between agents, no scope drift. The Pi coding
  agent (default backend) runs with `thinking=medium` so the model
  trades latency for quality on its single mission.
- **Pipelines are portable, not provider-locked.** A
  `huu-pipeline-v1.json` is a versioned artifact — commit it, share
  it as a gist, contribute it to the cookbook. The know-how of *how
  to decompose this class of task* lives in plain JSON.

### Stage → merge → stage

```mermaid
flowchart LR
    subgraph Docker["🐳 Docker (sandboxed, no shell creds)"]
        direction TB
        H["Integration HEAD<br/>(stage N base)"]
        H --> F1["Agent 1<br/>worktree"]
        H --> F2["Agent 2<br/>worktree"]
        H --> F3["Agent N<br/>worktree"]
        F1 --> M["Merge<br/>git merge --no-ff"]
        F2 --> M
        F3 --> M
        M --> H2["Integration HEAD<br/>(stage N+1 base)"]
        M -. conflict .-> R["LLM integration agent<br/>(side worktree)"]
        R --> H2
    end
```

Each stage forks N agents off the integration HEAD, lets them work in
parallel in their own worktrees, and merges them back **before**
the next stage starts. The integration worktree is never rewound —
loops re-execute on top of the current HEAD, accumulating commits.
Conflicts hit a side LLM integration agent (skipped in `--stub` mode).

### Per-file scope: one agent, one mission

```mermaid
flowchart LR
    P["Step prompt:<br/>'Test $file'<br/>scope: per-file"]
    P --> A1["Agent 1<br/>$file = src/a.ts"]
    P --> A2["Agent 2<br/>$file = src/b.ts"]
    P --> A3["Agent 3<br/>$file = src/c.ts"]
    P --> A4["Agent 4<br/>$file = src/d.ts"]
    A1 --> Out["4 parallel commits<br/>(no overlap by design)"]
    A2 --> Out
    A3 --> Out
    A4 --> Out
```

Same prompt, different `$file`. Agents read the whole worktree for
context but are instructed to write only to their assigned file —
disjoint writes mean clean merges. **This is the revolutionary bit:
your pipeline is the contract, and the contract scales horizontally.**

---

## Showcase: huu Test Suite

`huu Test Suite` is the default pipeline materialized on first run. It
demonstrates why mixing `project` and `per-file` scope is the recipe.

| # | Step | Scope | What it does |
|---|---|---|---|
| 1 | Analyze stack and write `huu-tests.md` | `project` | Detects language (Node / Python / Go / Rust / Java / .NET), verifies test runner, writes the **plan** every later step obeys. |
| 2 | Test 3 representative files | `project` | Picks 3 diverse business-logic files, writes tests, fixes failures, appends learnings to `huu-tests-faq.json`. |
| 3 | **Test `$file` (user-selected)** | `per-file` | **N parallel agents, each receives one file.** Each follows `huu-tests.md`, writes a test, accumulates FAQ. |
| 4 | Final cleanup + coverage badge | `project` | Runs the full suite, deletes only the failing **blocks** (never entire files), updates README badge. |

Step 1 writes a contract; step 3 makes 30 agents obey it in parallel;
step 4 validates. **Plan in `project`, execute in `per-file`, validate
in `project`** — the template for everything else.

Step-by-step walkthrough with prompts:
[`docs/onboarding.md#example-walkthrough`](docs/onboarding.md#example-walkthrough).

---

## What else can you build

A pipeline is a creative artifact. Five other defaults ship in the box,
and a creative author can write anything that fits the
**plan → fan-out → merge** shape:

- **Security pipeline.** Hand-pick the files you want audited, pass the
  threat model and standards (OWASP, CWE) as documentation, parallelize
  per-file scans. Stage 1 builds a `THREAT-MODEL.md`. Stage 2 fans out
  N agents, each scanning one file against the model. Stage 3
  consolidates findings and writes the remediation roadmap. All
  worktrees merge into a single integration branch.
- **Mass migration.** *Migrate 40 Mocha tests to Vitest:* stage 1 audits
  patterns into `MIGRATION.md`, stage 2 fans out 40 agents (one per
  test file), stage 3 runs `npm test` and updates `CHANGELOG.md`.
- **Docs / Quality / Performance / Refactor audits** ship as bundled
  default pipelines — strict report-only, never touch your manifests
  or production source.
- **Your idea.** If you can write the plan as a list of ordered
  steps with prompts and a `scope`, you can run it. The pipeline
  format is stable; the cookbook is open.

Bundled defaults: [`docs/onboarding.md#bundled-default-pipelines`](docs/onboarding.md#bundled-default-pipelines).

---

## Backends — any model, your choice

```mermaid
flowchart LR
    K["kind: 'pi' | 'copilot' | 'stub'"]
    K --> R["selectBackend()<br/>registry.ts"]
    R --> P["Pi<br/>(OpenRouter, any model)"]
    R --> C["Copilot<br/>(stabilizing)"]
    R --> S["Stub<br/>(no LLM, smoke)"]
```

| Backend | Flag | Cost model | Status |
|---|---|---|---|
| **Pi** (default) | `--backend=pi` | Pay-per-token via `OPENROUTER_API_KEY` — **any OpenRouter model** | Recommended |
| GitHub Copilot | `--copilot` | Subscription via `COPILOT_GITHUB_TOKEN` | Stabilizing |
| Stub | `--stub` | Free, no LLM — smoke tests / demos | Stable |

The Pi factory enables `thinking=medium` by default for every model
that supports it — the model is allowed to draft, critique, and revise
internally before emitting a final answer. For per-file work (one
agent, one mission), this is the right trade-off. All three backends
share the same orchestrator, worktree lifecycle, and merge logic.

Adding a future backend (ACP, Claude Code, …) is a one-folder +
one-case-in-registry change under `src/orchestrator/backends/`.

Deep dive: [`docs/onboarding.md#backends-deep-dive`](docs/onboarding.md#backends-deep-dive).

---

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/frederico-kluser/huu
cd huu
docker build -t huu:local .
export OPENROUTER_API_KEY=sk-or-...
HUU_IMAGE=huu:local huu run example.pipeline.json
```

Pre-built images at `ghcr.io/frederico-kluser/huu:latest` — the wrapper
pulls automatically when no `HUU_IMAGE` is set. VPN-aware MTU, secret
mounting, signal forwarding, and orphan cleanup are all handled by
the wrapper.

### Native

```bash
npm install -g huu-pipe        # Node 20+ and a working `git`
huu --yolo                     # opens the TUI natively (no Docker)
```

Native runs expose your shell credentials to the LLM agent. Prefer
Docker for anything real. Full install matrix (macOS / Windows / Linux,
OrbStack notes, WSL2 caveats): [`docs/onboarding.md#install`](docs/onboarding.md#install).

---

## Headless / one-command mode

For CI, cron, demos:

```bash
huu auto pipeline.json --config config.json
```

```json
{
  "modelId": "minimax/minimax-m2.7",
  "backend": "pi",
  "files": { "3. Test $file (user-selected)": ["src/index.ts"] },
  "concurrency": 4
}
```

- **stderr** — NDJSON progress events (one per state change).
- **stdout** — one final JSON object on completion (`runId`,
  `integrationBranch`, `totalCost`, …).
- **Exit code** — `0` if `status === 'done'`, `1` otherwise.

Build pipes on top: `huu auto … | jq .runId`. Full doc:
[`docs/onboarding.md#headless-mode`](docs/onboarding.md#headless-mode).

---

## Pipeline schema (compact)

```json
{
  "_format": "huu-pipeline-v1",
  "pipeline": {
    "name": "harden-and-document",
    "maxRetries": 1,
    "steps": [
      {
        "name": "Add JSDoc headers",
        "prompt": "Add a JSDoc header on top of $file with @author huu.",
        "files": ["src/cli.tsx", "src/app.tsx"],
        "scope": "per-file",
        "modelId": "anthropic/claude-sonnet-4-5"
      },
      {
        "name": "Refresh CHANGELOG",
        "prompt": "Update CHANGELOG.md summarizing the work above.",
        "files": [],
        "scope": "project"
      }
    ]
  }
}
```

`scope` controls decomposition: `project` = one whole-project task,
`per-file` = one task per file (the parallelism sweet spot),
`flexible` = user picks at edit time.

Full schema (timeouts, retries, conditional `check` steps, model
overrides, port allocation): [`docs/pipeline-json-guide.md`](docs/pipeline-json-guide.md).

---

## More

| Topic | Where |
|---|---|
| **Tutorial / first run / authoring** | [`docs/onboarding.md`](docs/onboarding.md) |
| **Architecture & layered import rules** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| **Operations (Docker, env vars, FAQ, roadmap)** | [`docs/operations.md`](docs/operations.md) |
| **Web UI mode (`huu --web`)** | [`docs/WEB-UI.md`](docs/WEB-UI.md) |
| **Pipeline JSON schema** | [`docs/pipeline-json-guide.md`](docs/pipeline-json-guide.md) |
| **Port isolation internals** | [`docs/PORT-SHIM.md`](docs/PORT-SHIM.md) |
| **Keyboard reference** | [`docs/KEYBOARD.md`](docs/KEYBOARD.md) |
| **Agent skills catalog** | [`agent-skills.md`](agent-skills.md) |
| **Changelog** | [`CHANGELOG.md`](CHANGELOG.md) |

---

## License

`huu` (the runner) is licensed under the **Apache License 2.0**. See
[LICENSE](LICENSE) for the full text. You're free to use, modify, and
redistribute commercially and non-commercially, with attribution and a
copy of the license.

**Pipelines are not the runner.** The `huu-pipeline-v1` JSON format is
an open specification. Pipelines you author or pick up from the
community are *yours* (or the original author's): they are not
encumbered by the runner's license. The cookbook convention is MIT or
CC0 — use them at work, at home, anywhere.

---

## Author

**Frederico Guilherme Kluser de Oliveira**
[kluserhuu@gmail.com](mailto:kluserhuu@gmail.com)

`huu` builds on [`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
— a lean, multi-provider coding-agent SDK by Mario Zechner. His
[post on the design](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
is worth a read; the philosophical overlap is not coincidental.

The GitHub Copilot integration uses [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk)
(declared as an optional dependency) — providing subscription-based
access for users already on a GitHub Copilot plan.
