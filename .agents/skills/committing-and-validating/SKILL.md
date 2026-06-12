---
name: committing-and-validating
description: The pre-commit gate for huu — npm run typecheck && npm test locally (there is NO CI; the contributor is the pipeline), Conventional Commits with the scopes this repo actually uses, the opt-in .githooks pre-push hook, and when the Docker smoke suite is required. Use whenever work is ready to commit or push, or when asked how changes are validated here.
metadata:
  version: 0.1.0
  type: task
---

# Committing and Validating

## When to use

Every time a change is ready to commit/push. Also when explaining or scripting validation.

## Injected knowledge

- There is NO automated CI. The gate is `npm run typecheck && npm test` before every commit — skipping it means nothing else will catch the break. Opt-in enforcement: `git config core.hooksPath .githooks` (pre-push hook).
- Conventional Commits, types observed in history: `feat`, `fix`, `docs`, `chore` (releases), `refactor`, `merge`. Scopes actually used: `pipelines`, `cli`, `orchestrator`, `docker`, `azure`, `ui,web`, `smoke`, `tui`, `kanban`, `backend`, `readme`, `merges`. Subject in English, imperative.
- Never force-push to `main`.
- Docker smoke suite — run when the change touches the wrapper, Dockerfile, web server, or before any release (not for ordinary src-only changes):
  ```bash
  docker build -t huu:local . \
    && ./scripts/smoke-image.sh \
    && ./scripts/smoke-pipeline.sh \
    && ./scripts/smoke-web.sh
  ```
- Two regression suites act as contracts; if they fail, read them before adjusting anything: `requeue.test.ts` (memory-guard requeue race), `registry.test.ts` (default-pipeline contract).
- Changelog: user-visible changes get a bullet under `[Unreleased]` in Keep-a-Changelog format (see writing-project-docs).

## Procedure

1. `npm run typecheck && npm test` — both green, no exceptions.
2. Smokes if Docker/wrapper/web-server surface changed (commands above).
3. Stage deliberately (`git add` specific paths — the repo often carries unrelated working files).
4. Commit as `<type>(<scope>): <imperative subject>`; body explains why when non-obvious.
5. Update `CHANGELOG.md [Unreleased]` for user-visible changes.
6. Push (hook runs if enabled). Never force-push main.

## References

- AGENTS.md "Commit Rules", `.githooks/`, `CHANGELOG.md`
- Related skills: writing-tests, running-in-docker (smokes), releasing-versions

> Facts verified against source on 2026-06-12.

## <evolution>

After the task completes:

1. Only persist learnings if the commit/push succeeded with green gates.
2. Keep only non-obvious, durable learnings: gate failures with surprising causes, scope conventions clarified by the user, smoke flakes. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain (gate/commit facts → here; test idioms → writing-tests). Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.
