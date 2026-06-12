# huu Pipeline JSON — Complete Reference Guide

> **Purpose**: This document is a self-contained specification for the huu pipeline JSON format. Give this file as context to any LLM alongside your project description and it can produce a valid, optimized pipeline JSON without access to the huu source code.

---

## What is huu?

**huu** is a CLI/TUI application (TypeScript + React/Ink) that orchestrates multiple LLM-powered coding agents working **in parallel** on the same codebase without conflicts.

### The problem it solves

When you ask a single AI agent to perform large-scale code changes (write tests for 20 files, audit 50 modules, refactor an entire codebase), it works sequentially — one file at a time. This is slow. If you run multiple agents simultaneously on the same repo, they step on each other's changes and create merge conflicts.

### How huu solves it

huu uses **git worktrees** — lightweight copies of the repository where each agent works in complete isolation. After all agents finish their parallel work, huu **merges** their branches deterministically into a single integration branch. The result: N agents working simultaneously, zero conflicts, and the combined output appears as if one very fast developer did it all.

### What is a pipeline?

A **pipeline** is the JSON configuration that tells huu **what work to do**. It defines:
- **Steps** (executed in sequence) — each step represents a phase of work
- **Tasks** (executed in parallel within each step) — each task is assigned to one agent in its own worktree

You write the pipeline JSON → huu reads it → spawns agents → each agent executes the prompt in isolation → huu merges everything → next step starts from the merged result.

### Why generate pipelines externally?

The huu TUI includes a built-in "Pipeline Assistant" that interviews you and generates a pipeline. But you might prefer to:
- Use a more powerful LLM (GPT-4, Claude, etc.) to craft complex multi-step pipelines
- Generate pipelines programmatically from CI/CD scripts
- Share pipeline templates across teams
- Iterate on pipeline design in a chat interface before importing into huu

This guide enables all of those workflows — any LLM that reads this document can produce valid pipeline JSON that huu will accept directly via paste or file import.

---

## Table of Contents

1. [What is huu?](#what-is-huu)
2. [Conceptual Overview](#conceptual-overview)
3. [Accepted Formats](#accepted-formats)
4. [Schema Reference](#schema-reference)
5. [Step Scope Semantics](#step-scope-semantics)
6. [The `$file` Token](#the-file-token)
7. [Conditional Steps (Check Nodes)](#conditional-steps-check-nodes)
8. [Writing Effective Prompts](#writing-effective-prompts)
9. [Model Selection (`modelId`)](#model-selection-modelid)
10. [Port Allocation](#port-allocation)
11. [Anti-Patterns](#anti-patterns)
12. [Examples](#examples)

---

## Conceptual Overview

huu is an orchestrator that executes **pipelines** of LLM-driven agents in parallel git worktrees.

### Execution model

```
Pipeline
 └── Step 1 (sequential)
      └── Task 1a ──┐
      └── Task 1b ──┤  (parallel, isolated git worktrees)
      └── Task 1c ──┘
      └── MERGE → integration branch
 └── Step 2 (sequential, branches from merged Step 1)
      └── Task 2a ──┐
      └── ...       ┘
      └── MERGE → integration branch
 └── ...
```

**Key rules:**
- **Steps** run **sequentially** — step N+1 starts only after step N's merge completes.
- **Tasks within a step** run in **parallel** — each agent gets its own git worktree branched from the integration HEAD.
- After all tasks in a step finish, their branches are **merged deterministically** into a central integration branch.
- The next step's worktrees branch from that merged HEAD — each step sees the accumulated work of all previous steps.

### How tasks are created from a step

| `files` array | Behavior |
|---|---|
| Empty `[]` | **One task** — single agent with full project access ("whole-project" mode) |
| Non-empty `["a.ts", "b.ts", ...]` | **One task per file** — N agents in parallel, each scoped to one file |

---

## Accepted Formats

huu accepts **two** JSON formats when importing a pipeline:

### Format A — Wrapped (recommended for export/sharing)

```json
{
  "_format": "huu-pipeline-v2",
  "exportedAt": "2026-04-24T00:00:00.000Z",
  "pipeline": {
    "name": "my-pipeline",
    "steps": [ ... ]
  }
}
```

### Format B — Bare pipeline object

```json
{
  "name": "my-pipeline",
  "steps": [ ... ]
}
```

Both are valid. The wrapped format is preferred because it's self-documenting and forward-compatible.

| Field | Type | Required | Notes |
|---|---|---|---|
| `_format` | `"huu-pipeline-v2"` | Yes (in wrapped) | Literal string. `"huu-pipeline-v1"` and legacy `"programatic-agent-pipeline-v1"` also accepted (auto-upgraded). |
| `exportedAt` | ISO 8601 string | No | Informational timestamp. |
| `pipeline` | Pipeline object | Yes (in wrapped) | The actual pipeline definition. |

**v2 vs v1**: v2 introduces the `CheckStep` node type for conditional routing. v1 pipelines (work steps only) remain fully supported — v2 is a superset. See [Conditional Steps](#conditional-steps-check-nodes).

---

## Schema Reference

### Pipeline object

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `name` | string | **Yes** | — | Min 1 char. Kebab-case recommended, max 80 chars. |
| `steps` | PipelineStep[] | **Yes** | — | Min 1 step. Max 20 (enforced by the assistant). Each item is a `WorkStep` or a `CheckStep` (discriminated by `type`). |
| `cardTimeoutMs` | integer | No | `600000` (10 min) | Must be > 0. Per-card timeout for whole-project and multi-file cards. |
| `singleFileCardTimeoutMs` | integer | No | `300000` (5 min) | Must be > 0. Per-card timeout for single-file cards. |
| `maxRetries` | integer | No | `1` | Range: 0–3. Retries on timeout/failure before marking a task as failed. |
| `maxNodeExecutions` | integer | No | `50` | Global cap on total node visits per run (safety net for loops via check steps). |
| `portAllocation` | PortAllocationConfig | No | `{ enabled: true }` | See [Port Allocation](#port-allocation). |
| `integrationModelId` | string | No | Falls back to global model | Model for the merge/integration agent (the conflict resolver that runs between stages). See [Model Selection](#model-selection-modelid). |

### WorkStep object (the v1 "PromptStep" — still the default)

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `type` | `"work"` | No | `"work"` | Discriminator. Omit for v1 back-compat. |
| `name` | string | **Yes** | — | Min 1 char, max 80 chars. **Must be unique across all steps.** Human-readable step label. |
| `prompt` | string | **Yes** | — | The instruction sent to each agent. Supports `$file` token for per-file steps. |
| `files` | string[] | **Yes** | — | File paths relative to repo root. Empty `[]` = whole-project (1 agent). |
| `modelId` | string | No | Falls back to global model | Must reference a valid model from the catalog (see [Model Selection](#model-selection-modelid)). |
| `scope` | `"project"` \| `"per-file"` \| `"flexible"` | No | `"flexible"` | Controls how the step decomposes into tasks. See [Step Scope Semantics](#step-scope-semantics). |
| `next` | string | No | (next step in array) | Name of the step to visit after this one completes. Must reference an existing step. `null`-equivalent: omit to fall through linearly. |

### CheckStep object (v2 — conditional decision node)

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `type` | `"check"` | **Yes** | — | Discriminator. Must be the literal `"check"`. |
| `name` | string | **Yes** | — | Unique across all steps. |
| `condition` | string | **Yes** | — | Natural-language predicate evaluated by an LLM judge agent. Supports `$runs` substitution (1-based iteration counter for this check). |
| `outcomes` | Outcome[] | **Yes** | — | Min 1. Exactly **one** must have `default: true`. Each outcome's `nextStepName` must reference an existing step. |
| `maxRuns` | integer | No | `5` | Maximum times this check may be visited per run. On overflow, the default outcome fires automatically. |
| `instructionDraft` | string | No | — | Optional hint surfaced to the runtime judge agent (typically authored by `analyzeCheckFeasibility` at setup time). |
| `modelId` | string | No | Falls back to global model | Model used for the judge agent. |

### Outcome object

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `label` | string | **Yes** | — | The label the judge LLM must emit (e.g. `"ok"`, `"low"`, `"retry"`). |
| `nextStepName` | string | **Yes** | — | Name of the step to visit when this outcome fires. Forward and backward jumps both allowed. |
| `default` | boolean | No | `false` | If `true`, this outcome is selected when the judge fails / emits an unknown label / `maxRuns` is exceeded. Exactly one outcome per check must set this to `true`. |

### PortAllocationConfig object

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `enabled` | boolean | No | `true` | Set `false` to disable port isolation entirely. |
| `basePort` | integer | No | `55100` | First port in the allocation range. |
| `windowSize` | integer | No | `10` | Ports per agent (min 10). Each agent gets a contiguous window. |

---

## Step Scope Semantics

The `scope` field determines how a step is decomposed into parallel tasks:

### `"project"` — Single agent, whole repository

- **One agent** is spawned with full access to the entire project.
- The `files` array is ignored for decomposition (but may still provide hints).
- Do **NOT** use `$file` in the prompt — there's no per-file substitution.
- **Use when**: the task requires cross-file context, produces a single shared artifact, or depends on global state.

**Examples of project scope work:**
- Install/configure dependencies or tooling
- Run build/test/lint (single command, unified output)
- Write a README, CHANGELOG, ADR, or configuration file
- Refactor architecture across multiple files
- Consolidate reports from previous steps

### `"per-file"` — One agent per file, parallel

- **N agents** are spawned simultaneously, one for each file in the `files` array.
- Each agent works in its own isolated git worktree.
- The `$file` token in the prompt is replaced with the actual file path for each agent.
- **Use when**: the work naturally decomposes into independent, file-scoped units.

**Examples of per-file scope work:**
- Write unit tests for each source file
- Add JSDoc/docstrings to each module
- Apply the same transformation (lint fix, rename, translate comments) per file
- Security/quality audit of individual files
- Migrate imports file-by-file

### `"flexible"` — User decides at edit time

- Legacy mode. The user chooses between whole-project and per-file when editing the pipeline in the TUI.
- **Prefer explicit `"project"` or `"per-file"`** when the scope is clear.

### `"memory"` — Files decided by an EARLIER step at run time

- The step declares `"filesFrom": "<repo-relative path>"` pointing at a **memory file** a previous step writes. When the cursor reaches the step, huu reads that file from the integration worktree (so check-loop rewrites are picked up) and spawns **one agent per listed path** — the pipeline, not the user, decides the file set.
- `files` stays `[]` in the JSON. In headless runs, a `config.files` entry for the step overrides the memory file (escape hatch).
- Per-entry `hint`s are substituted into the prompt via the **`$hint`** token (`$file` works as usual) — the producing step hands each agent targeted context, not just a path.
- A **missing** memory file resolves to zero tasks (the stage completes empty, with a loud warning); a **corrupt** one (bad JSON / wrong `_format` / no usable path) fails the run. `maxFiles` (default 40) caps the fan-out width; entries run by `priority` desc, then list order.
- Cannot be the FIRST step — nothing ran yet to write the file (schema-enforced).

**Memory file format (`huu-memory-v1`):**

```json
{
  "_format": "huu-memory-v1",
  "files": [
    { "path": "src/lib/types.ts", "hint": "extract the step contract here", "priority": 10 },
    "src/cli.tsx"
  ]
}
```

**Example:**

```json
{ "name": "1. Scan for risky files", "prompt": "Find risky files and write .huu/scan-list.json (huu-memory-v1) listing them with a one-line hint each.", "files": [], "scope": "project" },
{ "name": "2. Fix $file", "prompt": "Fix the issue in $file. The scanner's note about this file: $hint", "files": [], "scope": "memory", "filesFrom": ".huu/scan-list.json" }
```

- **Use when**: an earlier step discovers the work units (scan, recon, diff, ranking) and the fan-out must follow that discovery with no human file-picking.
- Deep-dive guide (patterns, interfaces, troubleshooting): [memory-scope.md](memory-scope.md) · [pt-BR](memory-scope.pt-BR.md).

### Decision guide

Ask yourself: **"Does this step produce N independent outputs (one per file) or 1 shared output?"**

| Answer | Scope |
|---|---|
| N independent outputs → | `"per-file"` |
| 1 shared output → | `"project"` |
| The file set is discovered by an EARLIER step → | `"memory"` + `filesFrom` |
| Genuinely ambiguous → | `"flexible"` |

---

## The `$file` Token

When a step has `scope: "per-file"` (or uses a non-empty `files` array), the orchestrator performs this substitution before sending the prompt to each agent:

```
step.prompt.replaceAll('$file', task.files[0])
```

**Rules:**
- Use `$file` as a **literal token** in the prompt text wherever you want the file path injected.
- It's replaced with the full relative path (e.g., `src/lib/utils.ts`).
- For `scope: "project"` steps, `$file` is **NOT** substituted — don't use it.
- You can use `$file` multiple times in the same prompt.

**Example:**
```json
{
  "name": "Add JSDoc to $file",
  "prompt": "Read $file and add JSDoc comments to every exported function. Do not modify logic. Only add documentation to $file.",
  "files": ["src/utils.ts", "src/parser.ts", "src/validator.ts"],
  "scope": "per-file"
}
```

This spawns 3 agents. Agent 1 receives the prompt with `$file` → `src/utils.ts`, Agent 2 → `src/parser.ts`, Agent 3 → `src/validator.ts`.

---

## Conditional Steps (Check Nodes)

A **check step** is a decision node whose verdict is produced by an **LLM judge agent** with full shell access running in the integration worktree. It evaluates a natural-language `condition` and routes to one of its declared `outcomes`. This enables:

- **Forward jumps** (skip steps when conditions are already met)
- **Backward loops** (re-run an earlier step until a condition is satisfied)
- **Branching** (different paths based on the judge's verdict)

### Critical execution semantics

- **The integration worktree is NEVER rewound.** Looping back to an earlier step re-runs that step on top of the CURRENT integration HEAD — commits accumulate.
- The judge runs IN the integration worktree (no new branch is created for it) and **must not commit, modify code, or push**.
- The judge MUST emit a JSON verdict matching `{ "label": "<one-of-allowed-labels>", "reason": "..." }`. Anything else triggers the `default: true` fallback.
- `CheckStep.maxRuns` caps how many times a check may be visited; `Pipeline.maxNodeExecutions` caps total node visits per run.

### The `$runs` token

Inside `condition`, the literal token `$runs` is replaced with the 1-based iteration counter for **that specific check** before the prompt is sent to the judge. Use it to bound retry loops:

```
"condition": "Cobertura >= 60%? Tentativa $runs/3 — se $runs == 3, aprove mesmo abaixo."
```

The judge is responsible for the actual arithmetic; huu only does string substitution.

### Minimal example: coverage gate with loop-back

```json
{
  "_format": "huu-pipeline-v2",
  "pipeline": {
    "name": "coverage-gate",
    "maxNodeExecutions": 20,
    "steps": [
      {
        "type": "work",
        "name": "Write tests",
        "prompt": "Add Vitest coverage for changed files.",
        "files": [],
        "scope": "project"
      },
      {
        "type": "check",
        "name": "Coverage gate",
        "condition": "Run `npm test -- --coverage` and check global line coverage >= 60%. Attempt $runs of 3 — if $runs >= 3 accept anyway.",
        "instructionDraft": "Parse the 'Lines' row of the coverage summary. >=60 → 'ok'; else → 'low'.",
        "maxRuns": 3,
        "outcomes": [
          { "label": "ok",  "nextStepName": "Update CHANGELOG", "default": true },
          { "label": "low", "nextStepName": "Write tests" }
        ]
      },
      {
        "type": "work",
        "name": "Update CHANGELOG",
        "prompt": "Append a CHANGELOG entry describing the new tests.",
        "files": [],
        "scope": "project"
      }
    ]
  }
}
```

### Idiom: judge-validates-report

The five bundled report-only audits (Docs / Quality / Performance / Refactor / Security) all end with the same pattern: a **final check step** whose `condition` demands the report be complete and internally consistent — required sections present with real content (no placeholders), FAQ JSON counts matching the report's summary tables, recommendations ordered critical → warn → info, and `git status` clean outside `.huu/`. The shared condition text is built by `reportJudgeCondition()` in `src/lib/default-pipelines/knowledge-protocol.ts` so all five audits demand the same bar.

Two outcomes, `maxRuns: 2`:

- `approved` (**`default: true`**) → a terminal work step that stamps the validation section of the report.
- `rework` → back to the consolidation step, which rebuilds the report on top of the accumulated commits.

```json
{
  "type": "check",
  "name": "7. Validate report",
  "condition": "The report at `.huu/audits/docs.md` is complete and internally consistent. Verify ALL of: 1) every required section is present with real content … 4) `git status --porcelain` shows NO modified files outside `.huu/` … This is run $runs of this validation. If every clause holds, answer \"approved\"; if any fails, answer \"rework\".",
  "maxRuns": 2,
  "outcomes": [
    { "label": "approved", "nextStepName": "8. Finalize report", "default": true },
    { "label": "rework", "nextStepName": "6. Consolidate report and cleanup" }
  ]
},
{
  "type": "work",
  "name": "8. Finalize report",
  "prompt": "The judge approved the report. Stamp the Validation section with the final numbers and leave the working tree clean.",
  "files": [],
  "scope": "project"
}
```

**Why `approved` must carry `default: true`.** The default outcome fires whenever the judge cannot produce a usable verdict — stub mode, judge failure, an unknown label, or the `maxRuns` cap. If `rework` were the default, every one of those degraded paths would loop backwards (stub runs would bounce between consolidation and the check until `maxNodeExecutions` killed the run). With `approved` as the default, a broken judge degrades to "ship the report as-is" — the safe direction for a report-only pipeline.

### Validation rules (enforced at parse time)

- All step `name`s must be **unique** across the pipeline.
- Every `WorkStep.next` and `Outcome.nextStepName` must reference an existing step.
- Every `CheckStep` must have **exactly one** outcome with `default: true`.
- `outcomes` must be non-empty.

A full working example lives in [`example.conditional.pipeline.json`](../example.conditional.pipeline.json) at the repo root.

---

## Writing Effective Prompts

### General principles

1. **Be direct and actionable** — the agent cannot ask clarifying questions. Write the prompt as if giving instructions to a junior developer who will execute them literally.
2. **Include acceptance criteria** — define what "done" looks like. The agent needs a clear exit condition.
3. **Specify constraints explicitly** — what the agent must NOT do is as important as what it must do.
4. **Scope the work tightly** — a focused prompt produces better results than a vague one.

### For `per-file` steps

- Always use `$file` to reference the target file.
- Don't mention specific file paths — let the substitution handle it.
- Write the prompt as if talking about a single file (the agent only sees one).
- Keep the prompt generic enough to work for any file in the list.

### For `project` steps

- Don't use `$file` — no substitution happens.
- You CAN mention specific paths if relevant.
- Consider that this agent sees the entire repo — frame instructions at the project level.

### Prompt structure (recommended template for complex steps)

```
=== OBJECTIVE ===
<1-2 sentences describing what this step achieves>

=== STEPS ===
1. <concrete action>
2. <concrete action>
...

=== CONSTRAINTS ===
- DO NOT <prohibited action>
- DO NOT <prohibited action>
- <limitation>

=== OUTPUT ===
<what files should be created/modified and their expected content>
```

### Length guidance

- Simple mechanical steps (rename, add header, lint): 2-5 sentences.
- Complex analytical steps (security audit, test writing): detailed checklist (see examples in the `pipelines/` directory).
- There is no hard character limit on prompts — clarity is more important than brevity.

---

## Model Selection (`modelId`)

Each step can optionally specify a `modelId` to override the global model selection. The value must reference a model from the project's `recommended-models.json` catalog.

### Current catalog (as of writing)

| ID | Tier | Best for |
|---|---|---|
| `minimax/minimax-m2.7` | fast | Cheap/fast tasks: per-file fan-out, lint, rename, JSDoc, translation, boilerplate |
| `moonshotai/kimi-k2.6` | workhorse | Complex coding, multi-file refactors, reasoning, agentic planning |

### Selection heuristic

| Step characteristic | Recommended model |
|---|---|
| Simple, mechanical, per-file → | Fast/cheap model (e.g., `minimax/minimax-m2.7`) |
| Complex reasoning, cross-file, architecture → | Workhorse model (e.g., `moonshotai/kimi-k2.6`) |

### Notes

- The model catalog is project-configurable — check the project's `recommended-models.json` for the current list.
- If omitted, the pipeline uses whatever model the user selected globally in the TUI.
- When in doubt, assign a model — it gives the user one less decision to make at runtime.

### Integration agent model (`integrationModelId`)

The pipeline-level `integrationModelId` pins the model of the **merge/integration agent** — the conflict resolver spawned in the integration worktree when the deterministic stage merge hits conflicts. It falls back to the run's global model when omitted. Conflict resolution is a cross-file reasoning task, so a workhorse-tier model is usually the right choice here even when the steps themselves run on a fast/cheap model. Editable in the TUI pipeline editor under `T` (Pipeline settings) and shown on the merge card in the run dashboard.

---

## Port Allocation

When agents run dev servers, databases, or other network services in parallel, they'd collide on ports. huu solves this with automatic port isolation.

### How it works

Each agent gets a contiguous window of TCP ports. A `bind()` interceptor (native shim via LD_PRELOAD/DYLD_INSERT_LIBRARIES) transparently remaps hardcoded ports to the agent's allocated window.

### Configuration

```json
{
  "portAllocation": {
    "enabled": true,
    "basePort": 55100,
    "windowSize": 10
  }
}
```

- **enabled** (default `true`): Disable only if your pipeline doesn't run any network services.
- **basePort**: First port in the range. Agent 0 gets ports 55100–55109, agent 1 gets 55110–55119, etc.
- **windowSize**: How many ports each agent gets. Default 10 is enough for most projects (HTTP + DB + WebSocket + extras).

### When to configure

- **Most pipelines**: Leave it at defaults (omit the field entirely).
- **Disable it**: Set `"enabled": false` if your steps only read/write files and never start servers.
- **Custom base**: Change `basePort` if 55100+ conflicts with existing services on the machine.

---

## Anti-Patterns

### ❌ Using `per-file` scope for a step that produces ONE shared artifact

```json
// WRONG — per-file with no files means "1 agent, no $file substitution"
{
  "name": "Write README",
  "prompt": "Create a README.md...",
  "files": [],
  "scope": "per-file"
}
```

**Fix**: Use `"scope": "project"` for steps that produce a single output (README, CHANGELOG, config file, report).

### ❌ Using `project` scope for work that's naturally file-independent

```json
// WRONG — loses parallelism
{
  "name": "Add tests for all modules",
  "prompt": "Write unit tests for src/utils.ts, src/parser.ts, and src/validator.ts",
  "files": [],
  "scope": "project"
}
```

**Fix**: Use `"scope": "per-file"` with each file in the `files` array. This spawns 3 agents working simultaneously.

### ❌ Collapsing distinct phases into one step

```json
// WRONG — setup + creation + verification in one step
{
  "name": "Setup tests and write them",
  "prompt": "Install vitest, then write tests for every file, then verify coverage...",
  "files": [],
  "scope": "project"
}
```

**Fix**: Split into 3 steps:
1. Step 1 (`project`): Install/configure test framework
2. Step 2 (`per-file`): Write tests for each file in parallel
3. Step 3 (`project`): Run full test suite / generate coverage report

### ❌ Using `$file` in a project-scope step

The token won't be substituted — it'll appear literally in the prompt sent to the agent.

### ❌ Forgetting `$file` in a per-file step

The agent won't know which specific file to work on. Always use `$file` to reference the target.

### ❌ Setting `maxRetries: 0` without good reason

Transient failures (timeouts, API errors) are common with LLM agents. At least 1 retry (the default) prevents unnecessary pipeline failures.

### ❌ Mentioning specific file paths in a per-file prompt

```json
// WRONG
{
  "prompt": "Write tests for src/utils.ts",
  "files": ["src/utils.ts", "src/parser.ts"],
  "scope": "per-file"
}
```

The same prompt goes to ALL agents. Use `$file` instead.

---

## Examples

### Example 1 — Minimal (single step, whole project)

```json
{
  "_format": "huu-pipeline-v1",
  "exportedAt": "2026-05-04T00:00:00.000Z",
  "pipeline": {
    "name": "update-changelog",
    "steps": [
      {
        "name": "Generate CHANGELOG entry",
        "prompt": "Read the git log since the last tag and create or update CHANGELOG.md at the root with a new entry listing all changes grouped by type (feat, fix, chore).",
        "files": [],
        "scope": "project",
        "modelId": "moonshotai/kimi-k2.6"
      }
    ]
  }
}
```

### Example 2 — Medium (mixed scopes, 3 steps)

```json
{
  "_format": "huu-pipeline-v1",
  "exportedAt": "2026-05-04T00:00:00.000Z",
  "pipeline": {
    "name": "setup-and-write-tests",
    "steps": [
      {
        "name": "1. Bootstrap test infrastructure",
        "prompt": "Detect the project language and install the standard test framework. Create a minimal sample test that passes. Write TESTS.md at the root with: framework chosen, install command, run-all command, run-single-file command, and naming convention.",
        "files": [],
        "scope": "project",
        "modelId": "moonshotai/kimi-k2.6"
      },
      {
        "name": "2. Write unit tests for $file",
        "prompt": "Read TESTS.md for conventions. Read $file and identify the public surface. Create the corresponding test file following the naming convention from TESTS.md. Write unit tests covering the main behavior + at least 1 edge case per public function. Mock external dependencies. Run the test file — it must pass with exit code 0.",
        "files": ["src/lib/utils.ts", "src/lib/parser.ts", "src/lib/validator.ts"],
        "scope": "per-file",
        "modelId": "minimax/minimax-m2.7"
      },
      {
        "name": "3. Run full test suite",
        "prompt": "Run the full test suite using the command from TESTS.md. If any test fails, investigate and fix the issue. Report the final pass/fail count.",
        "files": [],
        "scope": "project",
        "modelId": "moonshotai/kimi-k2.6"
      }
    ]
  }
}
```

### Example 3 — Advanced (5 steps, port allocation, timeouts)

```json
{
  "_format": "huu-pipeline-v1",
  "exportedAt": "2026-05-04T00:00:00.000Z",
  "pipeline": {
    "name": "full-audit-pipeline",
    "cardTimeoutMs": 900000,
    "singleFileCardTimeoutMs": 600000,
    "maxRetries": 2,
    "portAllocation": {
      "enabled": false
    },
    "steps": [
      {
        "name": "1. Setup test infra + TESTS.md",
        "prompt": "Detect the project language. Install the standard test framework. Create a sample test that passes. Write TESTS.md at the root with install, run-all, run-single-file, and naming conventions.",
        "files": [],
        "scope": "project",
        "modelId": "moonshotai/kimi-k2.6"
      },
      {
        "name": "2. Unit tests for $file",
        "prompt": "Read TESTS.md for conventions. Read $file, identify public surface, create test file. Cover main behavior + edge cases. Mock external deps. Test MUST pass (exit 0). Do NOT modify other files.",
        "files": ["src/auth.ts", "src/api.ts", "src/db.ts", "src/utils.ts", "src/middleware.ts"],
        "scope": "per-file",
        "modelId": "minimax/minimax-m2.7"
      },
      {
        "name": "3. Security audit of $file",
        "prompt": "Audit $file for security issues: injection, path traversal, hardcoded secrets, weak crypto, SSRF, prototype pollution. For each real finding, record severity, line, risk, and fix. Create $file-security-gaps.md with findings. If no issues found, create no file.",
        "files": ["src/auth.ts", "src/api.ts", "src/db.ts", "src/utils.ts", "src/middleware.ts"],
        "scope": "per-file",
        "modelId": "moonshotai/kimi-k2.6"
      },
      {
        "name": "4. Performance audit of $file",
        "prompt": "Audit $file for: I/O in loops (N+1), O(n²) in hot paths, sync I/O in request handlers. For each real finding, create $file-perf.md. Max 2 findings per file. If clean, create no file.",
        "files": ["src/auth.ts", "src/api.ts", "src/db.ts", "src/utils.ts", "src/middleware.ts"],
        "scope": "per-file",
        "modelId": "minimax/minimax-m2.7"
      },
      {
        "name": "5. Consolidate reports",
        "prompt": "Find all *-security-gaps.md and *-perf.md files. Consolidate into a single AUDIT-REPORT.md at the root, grouped by severity. Delete the individual report files after consolidation.",
        "files": [],
        "scope": "project",
        "modelId": "moonshotai/kimi-k2.6"
      }
    ]
  }
}
```

### Example 4 — Bare format (minimal)

The simplest valid pipeline (bare format, no wrapper):

```json
{
  "name": "add-headers",
  "steps": [
    {
      "name": "Add JSDoc header to $file",
      "prompt": "Add a JSDoc header comment at the top of $file with @module, @description (1 sentence), and @author huu. Do not modify anything else.",
      "files": ["src/cli.tsx", "src/app.tsx"],
      "scope": "per-file"
    }
  ]
}
```

---

## Bundled Default Pipelines

On first app mount, `pipeline-bootstrap.ts` materializes a catalog of framework-agnostic default pipelines into the user's `pipelines/` directory. Each is idempotent (never overwrites an existing file). Source of truth lives in `src/lib/default-pipelines/<name>.ts` and is registered in `src/lib/default-pipelines/registry.ts`.

| Filename | Pipeline name | Steps | Scope mix | Purpose |
|---|---|---|---|---|
| `huu-test-suite.pipeline.json` | huu Test Suite (`_default`) | 4 | project · project · per-file · project | Set up a test runner, write unit tests, prune failures, add a coverage badge. |
| `huu-docs-audit.pipeline.json` | huu Docs Audit | 6 | 4× project + 1 per-file + 1 project | Diátaxis classification, README scorecard, staleness scan, API-doc coverage. |
| `huu-quality-audit.pipeline.json` | huu Quality Audit | 5 | project · per-file · 3× project | Sonar-style complexity, duplication, dead code, composite score. |
| `huu-performance-audit.pipeline.json` | huu Performance Audit | 5 | project · per-file · 3× project | N+1 / big-O / sync-I/O / Core Web Vitals / USE checklist. |
| `huu-refactor.pipeline.json` | huu Refactor Plan | 5 | project · per-file · 3× project | Fowler smell catalog + static Mikado-style dependency graph. |
| `huu-security-audit.pipeline.json` | huu Security Audit | 5 | 2× project · per-file · 2× project | gitleaks secrets sweep + OWASP Top 10 per-file + dep CVE scan + remediation. |

### Strict report-only contract

The five audit pipelines write **only** under `.huu/audits/<topic>.md` and `.huu/audits/<topic>-faq.json` (working files under `.huu/audits/.tmp/`). They never touch `README.md`, `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, lockfiles, or any production source. Tools that need to be present (semgrep, jscpd, gitleaks, lighthouse-ci, …) are invoked ephemerally via `npx --yes`, `pipx run`, or vendored binaries under `$HOME/.huu/bin/`.

Only `huu Test Suite` mutates production state — by design: it writes `huu-tests.md` to repo root and inserts a tests-coverage badge into `README.md`. That's a setup pipeline, not an audit.

### Fan-out cap

Every per-file step in the bundled catalog runs under `Pipeline.maxNodeExecutions = 50`. On a large repo, narrow your file selection at runtime; auto-skip rules ignore `node_modules/`, `dist/`, `build/`, `vendor/`, generated files (`*.generated.*`, `*.min.js`), type declarations (`*.d.ts`), and lock/snapshot files.

### Adding a new bundled default

1. Create `src/lib/default-pipelines/huu-<topic>.ts` exporting `DEFAULT_PIPELINE_FILENAME`, `DEFAULT_PIPELINE_NAME`, `getDefaultPipeline(): Pipeline`, and `getDefaultPipelineFileContent(): string`.
2. Import the module and append it to the `DEFAULT_PIPELINES` array in `src/lib/default-pipelines/registry.ts`.
3. The registry-iterating tests in `src/lib/pipeline-bootstrap.test.ts` automatically cover topology, JSON drift, CheckStep defaults, and `$file`-only-in-per-file invariants — no need to copy-paste them per default.

---

## Quick Validation Checklist

Before using your pipeline JSON, verify:

- [ ] `name` is non-empty (ideally kebab-case, ≤ 80 chars)
- [ ] `steps` array has at least 1 element
- [ ] Each step has a non-empty `name` and `prompt`
- [ ] Each step has a `files` array (even if empty `[]`)
- [ ] `per-file` steps use `$file` in the prompt
- [ ] `project` steps do NOT use `$file`
- [ ] Steps that produce a single artifact use `scope: "project"`
- [ ] Steps with independent per-file work use `scope: "per-file"`
- [ ] Multi-phase work is split into separate steps (not collapsed)
- [ ] `maxRetries` is 0–3 if specified
- [ ] `cardTimeoutMs` and `singleFileCardTimeoutMs` are positive integers if specified
- [ ] If using wrapped format, `_format` is exactly `"huu-pipeline-v2"` (or `"huu-pipeline-v1"` for v1-only pipelines)
- [ ] All step `name`s are unique across the pipeline
- [ ] Any `WorkStep.next` or `Outcome.nextStepName` references an existing step
- [ ] Every `CheckStep` has exactly one outcome with `default: true`

---

## LLM Usage Instructions

When asking an LLM to generate a pipeline for you:

1. **Provide this guide** as context (the full document).
2. **Describe your goal** clearly: what you want done, to which files, and in what order.
3. **Mention the project language/framework** so the LLM can write language-appropriate prompts.
4. **Specify the model catalog** if different from the defaults shown here.

### Suggested prompt template for the LLM

```
Using the huu pipeline JSON format described in the reference guide below, create a pipeline that:

[Describe your goal here]

Target files: [list files or describe pattern]
Project: [language/framework]
Available models: [list or say "use defaults from the guide"]

Requirements:
- [Any specific constraints]
- [Desired number of steps]
- [Scope preferences if any]

[Paste this entire guide here OR reference it if already in context]
```
