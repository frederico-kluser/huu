---
name: writing-tests
description: Injects huu's test conventions — vitest with colocated <module>.test.ts files, REAL git repos in mkdtemp temp dirs (no git mocks), ad-hoc stub factories, and the named regression tests that act as living specs (requeue.test.ts, registry.test.ts). Use before writing or modifying any test, or when deciding how to make new behavior testable.
metadata:
  version: 0.1.0
  type: knowledge
---

# Writing Tests

## When to use

Creating or editing any `*.test.ts`, or designing code so it can be tested the way this repo tests.

## Injected knowledge

### Runner & layout

- vitest 4 (`npm test` = `vitest run`); ~55 test files, all COLOCATED next to their source as `<module>.test.ts`. No `__tests__/` dirs, no separate test tree.
- `vitest.config.ts` excludes `dist/**` — without it, compiled copies of the tests run twice and the native-shim tests race on real ports (this was a live regression; keep the exclude).
- Plain `describe/it/expect`. No `vi.mock` in the core suites and no fake timers by default — prefer real resources and deterministic inputs.

### Git is tested with REAL git

Worktree/branch/merge logic is the product, so tests run actual `git` in throwaway repos: `mkdtempSync` → `git init` → set `GIT_AUTHOR_NAME`/`GIT_COMMITTER_EMAIL` env → exercise → `rmSync` cleanup (see `src/git/worktree-manager.test.ts`). Mocking git here would test nothing real — follow the same recipe for new git-adjacent behavior.

### Stubbing LLMs

- No-network agents come from small ad-hoc factories defined inside the test file (e.g. `makeKillableFactory` in `requeue.test.ts`, `StubAssistantChat`) or from the stub backend. `HUU_LANGCHAIN_STUB=1` stubs LLM responses where the LangChain path is involved.
- The stub backend cannot resolve merge conflicts (fails loud by design) — design stub-based tests to avoid conflicting edits unless the abort IS the assertion.

### Regression tests are the spec — read them before "fixing" behavior

- `src/orchestrator/requeue.test.ts` pins the memory-guard kill → TODO requeue → successful re-run flow, including the consumable `killedAgentIds` race (a status flag instead of the Set re-breaks it).
- `src/lib/default-pipelines/registry.test.ts` pins the default-pipeline contract: 7 defaults, unique names/filenames; schema + topology round-trip; only Test Suite `_default: true`; exactly one judge check per report-only audit (default outcome `approved`, `maxRuns ≤ 3`); REPORT-ONLY marker in audit bootstrap prompts; caps `maxRetries ≤ 3`, `maxNodeExecutions ≤ 50`.

If a change makes one of these fail, the test is telling you about an invariant — change the design, or change the contract deliberately (test + module + docs together).

### Checklist for a new test

1. Colocate as `<module>.test.ts`; name `describe` after the module, `it` after observable behavior (not implementation).
2. Real fs/git via `mkdtempSync`; clean up in `afterEach`/`finally`.
3. Stub LLM/agent boundaries with a local factory; never hit the network.
4. `npm run typecheck && npm test` must pass locally — there is no CI to catch it later.

## References

- `vitest.config.ts`, `src/orchestrator/requeue.test.ts`, `src/lib/default-pipelines/registry.test.ts`, `src/git/worktree-manager.test.ts`
- Related skills: committing-and-validating, working-on-orchestrator

> Facts verified against source on 2026-06-12.
