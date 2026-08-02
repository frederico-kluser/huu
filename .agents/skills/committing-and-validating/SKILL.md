---
name: committing-and-validating
description: The pre-commit gate for huu — npm run typecheck && npm test locally, the SAME 9-step scripts/gate.sh that .github/workflows/gate.yml runs on every push/PR, Conventional Commits with the scopes this repo actually uses, the opt-in .githooks pre-push hook, and when the Docker smoke suite is required. Use whenever work is ready to commit or push, or when asked how changes are validated here.
metadata:
  version: 0.1.0
  type: task
---

# Committing and Validating

## When to use

Every time a change is ready to commit/push. Also when explaining or scripting validation.

## Injected knowledge

- The everyday gate is `npm run typecheck && npm test` before every commit. Opt-in enforcement: `git config core.hooksPath .githooks` (pre-push hook, which runs exactly those two).
- CI EXISTS (since 5.3.0) and is NOT a superset you can lean on: `.github/workflows/gate.yml` runs `scripts/gate.sh` on every push and pull request — 9 steps: typecheck · test · validate-skills · check-acceptance · smoke-defaults · validate-graph · check-pins · check-twins · check-metodo. Reproduce it verbatim with `bash scripts/gate.sh` (~40 s); `--list` shows the steps, `--list-from-ci` parses the workflow YAML so gate.sh and CI cannot drift apart unnoticed.
- `gate.sh` has THREE states and "tool missing = RED, never skipped" (METODO M1-01). A step marked `pending` in the STEPS registry forces `exit 1` for the WHOLE gate — that is deliberate (an announced-but-unbuilt gate must not read as green), so a `pending` flag left behind after its script ships turns CI permanently red. Clear the flag in the same change that wires the step.
- CI needs a git identity: the suite builds real git repos and commits into them, and a runner has none. `gate.yml` sets `user.email`/`user.name` globally before `npm ci`. A dev machine has a global identity, so forgetting this fails ONLY in CI (64 tests, `fatal: unable to auto-detect email address`).
- Conventional Commits, types observed in history: `feat`, `fix`, `docs`, `chore` (releases), `refactor`, `merge`. Scopes actually used: `pipelines`, `cli`, `orchestrator`, `docker`, `azure`, `ui`, `smoke`, `tui`, `kanban`, `backend`, `readme`, `merges`. Subject in English, imperative.
- Never force-push to `main`.
- Docker smoke suite — run when the change touches the wrapper, Dockerfile, or before any release (not for ordinary src-only changes):
  ```bash
  docker build -t huu:local . \
    && ./scripts/smoke-image.sh \
    && ./scripts/smoke-pipeline.sh
  ```
- Two regression suites act as contracts; if they fail, read them before adjusting anything: `requeue.test.ts` (memory-guard requeue race), `registry.test.ts` (default-pipeline contract).
- Changelog: user-visible changes get a bullet under `[Unreleased]` in Keep-a-Changelog format (see writing-project-docs).

## Procedure

1. `npm run typecheck && npm test` — both green, no exceptions.
2. Smokes if Docker/wrapper surface changed (commands above).
3. Stage deliberately (`git add` specific paths — the repo often carries unrelated working files).
4. Commit as `<type>(<scope>): <imperative subject>`; body explains why when non-obvious.
5. Add a `.changes/<card>.md` fragment for user-visible changes (NOT a direct edit to `CHANGELOG.md [Unreleased]` — fragments exist to kill the merge conflict on the most-touched file; `npx tsx scripts/changelog.ts --check` validates, and the release consolidates them).
6. Push (hook runs if enabled). Never force-push main.
7. Touched anything the gate covers beyond typecheck+test — skills, default pipelines, doc twins, pins, the METODO numbers? Run `bash scripts/gate.sh` before pushing; those 7 extra steps are CI-only otherwise, and CI tells you after the fact.

## References

- AGENTS.md "Commit Rules", `.githooks/`, `.github/workflows/gate.yml`, `scripts/gate.sh`, `.changes/README.md`
- Related skills: writing-tests, running-in-docker (smokes), releasing-versions

> Facts verified against source on 2026-08-01.

## <evolution>

After the task completes:

1. Only persist learnings if the commit/push succeeded with green gates.
2. Keep only non-obvious, durable learnings: gate failures with surprising causes, scope conventions clarified by the user, smoke flakes. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain (gate/commit facts → here; test idioms → writing-tests). Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. SKILL.md bodies have one human writer per surface — never auto-distill LEARNINGS into the body.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.
