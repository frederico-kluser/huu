# huu skill catalog

> llms.txt-style index. The project-router consults this file to assemble skill chains.
> Source of truth: `.agents/skills/` (each skill: `SKILL.md` + `LEARNINGS.md`). Portable via per-skill
> symlinks in `.claude/skills/`. Task skills end with an `<evolution>` step; knowledge skills receive
> learnings routed by domain ownership.

## Router

- [project-router](project-router/SKILL.md) `router` — entry point for EVERY task; classifies, assembles the chain, enforces evolution.
## Knowledge skills

- [following-architecture-conventions](following-architecture-conventions/SKILL.md) `knowledge` — layers, downward-only imports, ESM `.js`, named exports, style; load before writing any TS in src/.
- [working-on-orchestrator](working-on-orchestrator/SKILL.md) `knowledge` — run lifecycle, AutoScaler math, memory-guard requeue (`killedAgentIds`), the interactive-retry hold (`awaiting_retry` + `retryTask`/`finish`, `interactiveRetry` option), the multi-run `GlobalScheduler` (subordinate mode, priority backfill, cross-run kill, `run-many`), CheckStep judge 9998, checkRuns, the `simulation/` SimulationEngine demo driver; for any src/orchestrator change.
- [orchestrating-git-worktrees](orchestrating-git-worktrees/SKILL.md) `knowledge` — worktree/branch naming (branch-namer), ascending --no-ff merges, never-rewind invariant, preflight, conflict policy; for src/git work and ANY stage-merge behavior change.
- [integrating-llm-backends](integrating-llm-backends/SKILL.md) `knowledge` — backend registry (pi/copilot/azure/stub), BackendBundle, API-key chain, model catalogs, new-backend checklist.
- [isolating-agent-ports](isolating-agent-ports/SKILL.md) `knowledge` — port windows from 55100, .env.huu, with-ports sourcing gotcha, shim compile cache; for port collisions and shim work.
- [running-in-docker](running-in-docker/SKILL.md) `knowledge` — decideReexec bypass order, cidfile/prune, image/network/secrets, health sentinel, smoke suite; for wrapper/container/CI work.
- [writing-tests](writing-tests/SKILL.md) `knowledge` — vitest colocated, real git in temp dirs, stub factories, regression-tests-as-spec; load before touching any test, and include in any chain that changes runtime code.
- [writing-project-docs](writing-project-docs/SKILL.md) `knowledge` — pt-BR/EN twin files, docs/ layout, Keep-a-Changelog, identity framing; for any markdown work.
- [authoring-agent-prompts](authoring-agent-prompts/SKILL.md) `knowledge` — cross-LLM step-prompt techniques (atomic ops, output contract, $file/$hint injection, mechanical forward-default judges, lean pi prompts); for writing/sharpening any step prompt, judge condition or memory recon prompt.
## Task skills (end with `<evolution>`)

- [authoring-pipelines](authoring-pipelines/SKILL.md) `task` — pipeline JSON v2 schema + design + stub dry-run; for any *.pipeline.json.
- [editing-default-pipelines](editing-default-pipelines/SKILL.md) `task` — the 7 bundled defaults, registry.test contract, knowledge-protocol helpers, never-overwrite trap.
- [building-tui-screens](building-tui-screens/SKILL.md) `task` — FSM + app.tsx routing, theme.ai rule, cardHeight sync, useInput ref-stability; for Ink UI work.
- [building-web-ui](building-web-ui/SKILL.md) `task` — vanilla-ESM no-build client (app.js/db.js), multi-run node:http+SSE server (live queue: add projects while running), browser-owns-state (sessionStorage keys + IndexedDB history), provider→backend dispatch gotcha, no-browser verification, synthetic `/simulation` demo (SimulationEngine via a RunDriver seam); for any src/web work.
- [committing-and-validating](committing-and-validating/SKILL.md) `task` — typecheck+test gate (no CI), Conventional Commits, smoke triggers; for every commit/push.
- [releasing-versions](releasing-versions/SKILL.md) `task` — manual release steps, GHCR multi-arch publish, published-image smoke.

## Meta skills

- [meta-skill-evolution](meta-skill-evolution/SKILL.md) `meta` — update/create/discard decision for new learnings; anti-injection; always a reviewable diff.- [meta-skill-consolidate](meta-skill-consolidate/SKILL.md) `meta` — periodic GC: dedupe, temporal versioning, probation→promotion, token budgets.
## Chain hints

- Any code change → following-architecture-conventions + the domain skill → writing-tests → committing-and-validating.
- Pipeline work: authoring-pipelines for user JSONs; editing-default-pipelines when the change is under src/lib/default-pipelines/.
- UI work: building-tui-screens for Ink (src/ui/, app.tsx); building-web-ui for the browser client + web server (src/web/) — pair with working-on-orchestrator when the change spans run state/streaming.
