---
name: authoring-pipelines
description: Guides writing huu pipeline JSON (huu-pipeline-v2) — WorkStep/CheckStep fields, scope semantics including the memory scope (filesFrom fan-out driven by a huu-memory-v1 file an earlier step writes, with $hint), outcome routing with exactly one default, the numeric safety caps and validateTopology rules, plus how to dry-run with the stub backend. Use when creating or editing any *.pipeline.json, designing pipeline stages, or deciding which step shape fits a job.
metadata:
  version: 0.3.0
  type: task
---

# Authoring Pipelines

## When to use

Creating or editing `*.pipeline.json` (user pipelines under `pipelines/`, examples, fixtures), or advising on step/check design. For the 7 BUNDLED defaults in `src/lib/default-pipelines/`, use editing-default-pipelines instead — they carry extra contracts.

## Injected knowledge

### Schema essentials (`src/lib/types.ts`, `src/lib/pipeline-io.ts`)

- Accepted `_format`: `huu-pipeline-v2`, `huu-pipeline-v1`, legacy `programatic-agent-pipeline-v1`. Write v2.
- WorkStep: `name`, `prompt`, `files[]`, optional `type:'work'`, `modelId`, `next`, and `scope`:
  - `'project'` → whole-repo single task (the editor locks Files to `[]`)
  - `'per-file'` → one task per file; file picking is mandatory
  - `'flexible'` / omitted → legacy free-form (files `[]` = one whole-project round)
  - `'memory'` + `filesFrom` → one task per path listed in a `huu-memory-v1` JSON an EARLIER step writes, read from the integration worktree when the cursor arrives — the pipeline picks the files, not the user. Per-entry hints reach the prompt via the `$hint` token. Rules: never the first step (schema-enforced); missing file → zero tasks, stage completes empty (stub-safe); corrupt file → run fails; `maxFiles` (default 40) caps width, priority desc then list order; a headless `config.files` override wins.
  - **Producer side — declare `produces`, never paste format boilerplate**: set `produces: '<same path>'` on the earlier step and huu appends the exact MEMORY CONTRACT (path + format + the consumer's cap + hint rule) to its prompt at run time (`src/lib/memory-contract.ts`). The producer's prompt should only say WHAT qualifies and that each pick needs a one-line why. Two steps producing the same path is a topology error. Deep dive: `docs/memory-scope.md`.
- CheckStep: `type:'check'` (required), `condition` (supports the `$runs` visit-count token), `outcomes[]` of `{label, nextStepName, default?}`. Exactly ONE outcome per check has `default: true` — `validateTopology` rejects zero or several. The default outcome fires on judge failure, unknown label, or the `maxRuns` cap, so make it the SAFE path (usually "approved"/"proceed"), never the loop.
- Defaults/caps (types.ts:125-190): `maxRuns` 5 · `maxNodeExecutions` 50 · card timeout 600 000 ms · single-file card timeout 300 000 ms · `maxRetries` 1.
- `validateTopology` also enforces: unique step names; every `next`/`nextStepName` resolves. Errors surface as Zod issues on load.

### Behavior worth designing around

- The integration worktree never rewinds: a check loop re-runs its target steps ON TOP of previous commits. Steps revisited in loops must be idempotent-ish (re-running adds, not corrupts).
- Judge verdict = last JSON block of the judge's output; the judge runs with shell access in the integration worktree. Keep `condition` objectively checkable ("file X exists and section Y non-empty"), not vibes ("code is good").
- Per-file prompts should open with an auto-skip rule for `node_modules/`, `dist/`, `vendor/`, generated/lock files — the bundled pipelines all do this.

## Procedure

1. Sketch stages on paper first: what merges at each stage boundary, where a judge gate adds value, what the safe default outcome is.
2. Write the JSON with `_format: "huu-pipeline-v2"`. Name steps imperatively and uniquely.
3. Validate by loading it (TUI import, or `huu auto <file> --config <cfg>` headless) — schema + topology errors appear at load, before any agent runs.
4. Dry-run with the stub backend (`--stub`-style config / `backend: 'stub'`): free, no API key (stub's `requiresApiKey` is false), exercises decomposition, merges and check routing. Avoid conflicting edits in stub runs — stub aborts on merge conflict by design.
5. Run real, watching the kanban: judge cards (fromJudge green / DEFAULT amber) tell you which outcome actually fired.

## References

- `docs/pipeline-json-guide.md` (full spec; `#conditional-steps-check-nodes` for checks), `example.pipeline.json`, `example.conditional.pipeline.json`
- Related skills: editing-default-pipelines, running-in-docker (run flags), working-on-orchestrator (execution semantics)

> Facts verified against source on 2026-06-12.

## <evolution>

After the task completes:

1. Only persist learnings if the result passed its checks (pipeline loads, dry-run behaves, user accepted).
2. Keep only non-obvious, durable learnings: surprises, user corrections, schema constraints discovered the hard way, designs that failed. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain (schema/authoring facts → here; orchestrator behavior → working-on-orchestrator). Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.
