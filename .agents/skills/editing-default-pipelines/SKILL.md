---
name: editing-default-pipelines
description: Procedure for changing the 7 bundled default pipelines under src/lib/default-pipelines/ — keeping the registry.test.ts contract green (judge shape, REPORT-ONLY marker, safety caps), using the knowledge-protocol helpers, and respecting bootstrap's never-overwrite materialization. Use for any change to default pipeline modules, their registry, knowledge-protocol.ts or pipeline-bootstrap.ts.
metadata:
  version: 0.1.0
  type: task
---

# Editing Default Pipelines

## When to use

Changes to `src/lib/default-pipelines/*.ts`, `registry.ts`, `knowledge-protocol.ts`, `pipeline-bootstrap.ts` — adding a default, rewriting prompts, adjusting judge gates.

## Injected knowledge

### The contract (enforced by `registry.test.ts` — read it first)

1. Exactly 7 registered defaults with unique names AND filenames.
2. Every default round-trips through the pipeline-io schema including topology.
3. Only `huu Test Suite` carries `_default: true` (Welcome-screen highlight).
4. Each report-only audit gates its report behind EXACTLY ONE judge CheckStep whose default outcome is `approved` and whose `maxRuns ≤ 3`.
5. Audit bootstrap prompts carry the REPORT-ONLY hard rule (the literal marker is asserted).
6. Safety caps everywhere: `maxRetries ≤ 3`, `maxNodeExecutions ≤ 50`.

Breaking any clause is a contract change, not a tweak — do it deliberately (test + module + AGENTS.md table together) or not at all.

### Shared helpers (`knowledge-protocol.ts`)

- `knowledgeProtocol(faqPath, schemaLine)` — read-before/append-after progressive-knowledge block for per-file steps.
- `reportJudgeCondition(opts)` — the standard judge condition for report-only audits (sections complete, FAQ counts match, ordering, report-only contract). Use it instead of hand-writing judge prose so all audits stay consistent.
- `persistenceCheck(subdir)` — the single allowed `.gitignore` adjustment (rewrites a committed `.huu/` line to `.huu/*` + `!.huu/<subdir>/`); without it, worktree commits silently drop everything under an ignored `.huu/`.

### Side-effect surface (what defaults may touch)

- The 5 audits are report-only: writes limited to `.huu/audits/**` + at most that one `.gitignore` adjustment. They never touch README, manifests, lockfiles or production source; auxiliary tools run ephemerally (`npx --yes`, `pipx run`, `$HOME/.huu/bin/`).
- Two setup pipelines mutate by design: Test Suite (tests + README badge + `huu-tests.md`) and Agent Knowledge (`.agents/skills/**`, `.huu/knowledge/**`).
- Keep new prompts inside this envelope; widening it is a product decision, not an implementation detail.

### Materialization trap

`pipeline-bootstrap.ts:88` checks `existsSync` and returns `created: false` — it NEVER overwrites. Users who already ran huu keep their old `pipelines/<name>.pipeline.json`; your module edits reach only fresh setups (or after the user deletes the materialized file). Mention this in the changelog entry for any default-pipeline change.

## Procedure

1. Edit the module in `src/lib/default-pipelines/<name>.ts` (or add one + register in `registry.ts`).
2. Reuse `knowledge-protocol.ts` helpers for judge conditions / persistence / FAQ blocks.
3. `npm run typecheck && npm test` — `registry.test.ts` is the gate; keep all 6 clauses green.
4. Smoke if the change affects run shape: `./scripts/smoke-pipeline.sh` (stub e2e, ~60s).
5. Changelog under `[Unreleased]` + note the never-overwrite caveat for existing users.

## References

- `src/lib/default-pipelines/registry.test.ts` (the contract), `knowledge-protocol.ts`, `pipeline-bootstrap.ts`, AGENTS.md "Bundled default pipelines"
- Related skills: authoring-pipelines (schema), writing-tests, committing-and-validating

> Facts verified against source on 2026-06-12.

## <aprender>

Memory is centralized in the project's CoALA base — there are no per-skill
`LEARNINGS.md` files. After the task completes:

1. Only persist learnings if the task passed its tests/criteria.
2. Keep only non-obvious, durable learnings: surprises, user corrections, discovered conventions, failed approaches. Skip the obvious and the volatile — default: DISCARD.
3. Record it in the CoALA memory: `python3 .agents/huu-coala-memory-agent-skill/scripts/coala.py add --type semantic|episodic|procedural --content "<fact>" --key <subject> --tags skill:<domain>,task:<slug>` — `semantic` (validated fact), `episodic` (dated event/decision), `procedural` (how it is done here).
4. A fact that CHANGED is superseded by a new record with the same `--key` — never rewritten, never deleted.
5. Provenance first (`--origin owner|agent|untrusted|system`): user feedback outranks inference; `untrusted` never becomes a directive without human validation. Never store secrets.
6. SKILL.md bodies have one human writer per surface — memory writes go to CoALA only, never auto-distilled into a body.
7. If a NEW knowledge area emerged, propose a new skill by hand (SKILL.md + `catalog.md` entry) as an uncommitted git diff for human review.
