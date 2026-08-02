---
name: following-architecture-conventions
description: Injects huu's layering rules and house code style — downward-only imports (ui→orchestrator→git→lib), ESM with .js suffixes, named exports, kebab-case files, types.ts as the single type source, module purity at the CLI top. Use before writing or moving ANY TypeScript in src/, when deciding where new code belongs, or when reviewing a diff for convention drift.
metadata:
  version: 0.1.0
  type: knowledge
---

# Following Architecture Conventions

## When to use

Any task that creates, moves or edits TypeScript under `src/` — features, fixes, refactors, reviews. Load this before touching code; it replaces re-scanning the codebase for "how things are done here".

## Injected knowledge

### Layers (imports flow downward only)

```
cli.tsx → app.tsx → ui/ → orchestrator/ → orchestrator/backends/ → git/ → lib/
```

- A lower layer never imports an upper one. If `lib/` needs something from `orchestrator/`, the design is wrong — move the shared piece down into `lib/`.
- `src/lib/screen-fsm.ts` is a pure reducer the TUI drives its screen state through; keep it side-effect free.
- `src/lib/types.ts` is the single source of domain types (~25 interfaces). Add new domain types there, not next to their first consumer — the UI and the orchestrator re-export from it.

### Module system

- ESM only, with explicit `.js` suffix on relative imports (`import { x } from './foo.js'`). The project compiles with `moduleResolution: Bundler` but runs as real ESM from `dist/` — omitting the suffix breaks the compiled output, not the dev run, so the error surfaces late.
- No barrel files. `orchestrator/index.ts` imports 21 named exports directly from sibling modules; follow that — explicit imports keep the dependency graph greppable.
- Named exports everywhere — no default exports. Don't introduce one.
- Module bodies stay pure (no side effects at import time). Reason: `src/cli.tsx` runs the Docker re-exec gate at the very top with top-level await, before the heavy Ink/React imports; import hoisting means any module side effect would also run on the host wrapper path, where the TUI must not initialize.

### Style

- Files: kebab-case (`auto-scaler.ts`, `branch-namer.ts`). Components: PascalCase filenames inside `ui/components/`.
- Errors: `throw new Error(...)` for programming/validation errors; Zod for schema validation (`run-config.ts` throws on parse failure); `process.exit` only in CLI entrypoints. `debug-logger.ts` intentionally swallows disk errors — logging must never take the app down.
- TS idioms in use: discriminated unions + type guards (`WorkStep | CheckStep`, `isCheckStep`), `as const` token maps, JSDoc blocks on exported functions. Comments are EN/PT-BR mixed — both are accepted; match the file you're in.
- There are no linters or formatters configured (no eslint/prettier/biome — checked). Consistency comes from `strict: true` TypeScript and matching the neighboring code. Don't introduce a linter as a side effect of a task.

### Where things live

| Kind of code | Home |
|---|---|
| Domain types, IO, schemas | `src/lib/` |
| Run scheduling, pool, scaling, check execution | `src/orchestrator/` |
| Agent SDK adapters | `src/orchestrator/backends/<kind>/` |
| Worktree/branch/merge plumbing | `src/git/` |
| Ink components / hooks / theme | `src/ui/` |

## References

- `src/lib/types.ts`, `src/orchestrator/backends/registry.ts:7-18` (dispatch-table comment is the canonical extension recipe)
- Related skills: building-tui-screens, writing-tests
- AGENTS.md "Architecture (summary)"

> Facts verified against source on 2026-06-12.
