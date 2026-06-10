# Running huu in CI (GitHub Actions · GitLab CI)

> **Português (BR):** [docs/ci.pt-BR.md](ci.pt-BR.md)

huu's headless mode (`huu auto`) turns any pipeline into a CI job: no TTY, no
keyboard, NDJSON progress on stderr, one final JSON object on stdout, exit
code `0`/`1`. Combined with `--no-docker` (or `HUU_NO_DOCKER=1`) it runs on
any runner that has **Node.js ≥ 20 and git** — no Docker-in-Docker required.

The report-only audit pipelines (Security, Quality, Docs, Performance,
Refactor) are the natural fit: they write their findings to `.huu/audits/`
and never touch production source, so the job uploads the reports as
artifacts and the exit code gates the pipeline.

## Table of contents

- [How it fits together](#how-it-fits-together)
- [Prerequisites](#prerequisites)
- [The config JSON](#the-config-json)
- [GitHub Actions recipe](#github-actions-recipe)
- [GitLab CI recipe](#gitlab-ci-recipe)
- [Reading the output](#reading-the-output)
- [Concurrency on small runners](#concurrency-on-small-runners)
- [FAQ](#faq)

## How it fits together

```
runner (already an ephemeral container)
  └─ npm install -g huu-pipe
  └─ HUU_NO_DOCKER=1 huu auto pipeline.json --config huu-ci-config.json
       ├─ stderr: NDJSON progress events (status, stage, tasks, concurrency, autoScale)
       ├─ stdout: ONE final JSON object ({ ok, runId, status, agents, … })
       └─ exit:   0 when the run finished `done`, 1 otherwise
```

On your laptop, huu wraps itself in Docker so the agent never sees your shell
credentials. A CI runner is the opposite situation: it is *already* an
ephemeral, credential-scoped container, and Docker-in-Docker is usually
unavailable — so you opt out of the wrapper with `--no-docker` (the neutral
spelling of `--yolo`) or `HUU_NO_DOCKER=1` in the job environment.

## Prerequisites

1. **Node.js ≥ 20** and a working `git` on the runner.
2. **The pipeline JSON committed to your repo.** Pipelines are versioned
   artifacts — commit the ones huu materialized under `pipelines/`, or your
   own. `huu auto` takes the path explicitly.
3. **An API key as a CI secret.** The Pi backend (default) reads
   `OPENROUTER_API_KEY`; other backends read their own env vars
   (`COPILOT_GITHUB_TOKEN`, `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_BASE_URL`).
   Every key also accepts a `<NAME>_FILE` variant pointing at a file path.
4. **A full clone when the pipeline reads history.** The Security audit scans
   git history for secrets — use `fetch-depth: 0` (GitHub) / `GIT_DEPTH: 0`
   (GitLab) for those.

## The config JSON

`huu auto` separates the *portable* pipeline from the *environment-specific*
config (which files on THIS repo, which model on THIS account):

```jsonc
// huu-ci-config.json
{
  "modelId": "x-ai/grok-4-fast",      // any OpenRouter model id
  "backend": "pi",                     // pi (default) | copilot | azure | stub
  "files": {
    // step name → file list, for steps with scope per-file
    "3. OWASP Top 10:2025 scan for $file": ["src/server.ts", "src/auth.ts"]
  },
  "concurrency": 4                     // optional — see "Concurrency" below
}
```

Generating the per-file list dynamically keeps the config in sync with the
repo (example for the security audit):

```bash
git ls-files 'src/**/*.ts' | jq -R . | jq -s --arg step "3. OWASP Top 10:2025 scan for \$file" \
  '{ modelId: "x-ai/grok-4-fast", backend: "pi", files: { ($step): . } }' \
  > huu-ci-config.json
```

## GitHub Actions recipe

```yaml
# .github/workflows/huu-security-audit.yml
name: huu security audit

on:
  workflow_dispatch:
  schedule:
    - cron: '0 6 * * 1'   # weekly, Monday 06:00

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      HUU_NO_DOCKER: '1'
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # secrets sweep reads git history

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install huu
        run: npm install -g huu-pipe

      - name: Build config (per-file list from git)
        run: |
          git ls-files 'src/**' | jq -R . | jq -s \
            '{ modelId: "x-ai/grok-4-fast", backend: "pi",
               files: { "3. OWASP Top 10:2025 scan for $file": . } }' \
            > huu-ci-config.json

      - name: Run audit
        run: huu auto pipelines/huu-security-audit.pipeline.json \
               --config huu-ci-config.json > huu-result.json

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: huu-audits
          path: |
            .huu/audits/**
            huu-result.json

      - name: Gate on result
        run: jq -e '.ok == true' huu-result.json
```

Notes:

- `huu auto` already exits non-zero on failure, so the `Run audit` step gates
  by itself; the explicit `jq -e` step is for when you redirect stdout and
  still want the gate.
- `if: always()` on the upload keeps the partial reports when the run fails —
  that is usually when you want to read them most.

## GitLab CI recipe

```yaml
# .gitlab-ci.yml
huu:security-audit:
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  variables:
    HUU_NO_DOCKER: '1'
    GIT_DEPTH: 0                # secrets sweep reads git history
  before_script:
    - npm install -g huu-pipe
    - |
      git ls-files 'src/**' | jq -R . | jq -s \
        '{ modelId: "x-ai/grok-4-fast", backend: "pi",
           files: { "3. OWASP Top 10:2025 scan for $file": . } }' \
        > huu-ci-config.json
  script:
    - huu auto pipelines/huu-security-audit.pipeline.json --config huu-ci-config.json > huu-result.json
  after_script:
    - jq '.ok' huu-result.json || true
  artifacts:
    when: always
    paths:
      - .huu/audits/
      - huu-result.json
    expire_in: 30 days
```

Set `OPENROUTER_API_KEY` as a masked CI/CD variable
(Settings → CI/CD → Variables).

## Reading the output

- **stderr** — one NDJSON event per line, throttled to ~250 ms:
  `{"type":"state","status":"running","stage":"2/5","tasks":"7/23","activeAgents":4,"pendingTasks":12,"concurrency":4,"autoScale":"auto","elapsedMs":81234,"cost":0.04}`
- **stdout** — exactly one final JSON object:
  `{ "ok": true, "runId": "…", "integrationBranch": "huu/<runId>/integration", "status": "done", "agents": [...] }`
- **exit code** — `0` when `status === "done"`, `1` otherwise.

The run's branches stay in the runner's local clone (`huu/<runId>/agent-N`,
`huu/<runId>/integration`) and die with it. For the report-only audits the
deliverable is `.huu/audits/` — upload it; nothing needs to be pushed.

## Concurrency on small runners

Memory-aware auto-scale is huu's default: concurrency adapts to the runner's
real memory headroom (cgroup-aware — it sees the container limit, not the
host's), and a memory guard kills the newest agent and requeues its task if
RAM crosses ~95%. On a typical 7 GB GitHub-hosted runner this is the right
default — omit `concurrency` from the config.

Pin it only when you need determinism over throughput:

```jsonc
{ "concurrency": 2 }            // pins manual mode (guard stays active)
{ "concurrency": 8, "autoScale": true }  // seeds auto mode at 8
```

## FAQ

**Is `--no-docker` safe in CI?** The Docker wrapper exists to hide *your
laptop's* credentials from the agent. A CI runner is already an ephemeral
container whose only credentials are the secrets you explicitly inject — the
trade-off the `--yolo` warning describes does not apply.

**Do I need `huu init-docker`?** No. That scaffolds Docker assets for local
use; CI uses none of them.

**Which pipelines should run in CI?** The report-only audits (Security,
Quality, Docs, Performance, Refactor) — they never modify production source.
`huu Test Suite` and `huu Agent Knowledge` mutate the repo by design; run
those interactively and review the diff instead.

**Can the job push the reports back?** The audits write to `.huu/audits/` in
the work tree. Prefer artifacts; if you want them committed, add a normal
commit-and-push step after the run and review it like any bot commit.
