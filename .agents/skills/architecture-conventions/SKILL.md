---
name: architecture-conventions
description: >-
  Define layered architecture boundaries, naming conventions, import rules, and
  dependency direction for the huu codebase. Use when creating new
  modules, refactoring imports, or reviewing code structure. Do not use for
  runtime debugging or UI styling decisions.
---
# Architecture & Conventions

## Goal

Establishes the architectural rules and code conventions of the
huu project, ensuring new modules follow the same layered
structure and naming/import patterns.

## Boundaries

**Do:**
- Follow the dependency flow: `ui/` → `orchestrator/` → `git/` → `lib/`
- Use discriminated unions (`kind` / `type`) for states and events
- Put all shared types in `lib/types.ts`
- Use explicit `.js` in local imports (ESM requirement)
- Use `export default`? **NEVER.** Only named exports.
- Treat the **host wrapper** at the top of `cli.tsx` (`decideReexec` / `reexecInDocker` from `lib/docker-reexec.ts`) as a layer that runs OUTSIDE the in-container `ui/orchestrator/git/lib` flow. Side effects (debug logger, sentinel write, terminal restore) are deliberately gated to only fire when in-container or when `HUU_NO_DOCKER=1`. See the `docker-runtime` skill.

**Don't:**
- Import `ui/` or `orchestrator/` from `git/` or `lib/`
- Create scattered types across multiple files
- Use `export default` in any file
- Import upper layers from lower layers
- Add side-effectful top-level code in modules imported by `cli.tsx`. ESM hoists imports above the docker-reexec gate, so any module body that writes files or registers global handlers will run on the wrapper path too. Keep module bodies pure; put effects inside exported functions.

## Workflow

1. **New module** — decide the layer (`ui/`, `orchestrator/`, `git/`, `lib/`)
2. **Naming** — `kebab-case.ts` (or `.tsx` if JSX), `PascalCase` classes/components, `camelCase` functions
3. **Types** — if shared, go to `lib/types.ts`; if local, define in the file itself
4. **Imports** — order: external → internal (by depth) → `node:` built-ins
5. **Exports** — always named

## Gotchas

- The project is ESM-only (`"type": "module"`). TypeScript with `moduleResolution: Bundler` requires `.js` in imports even for `.ts`/`.tsx`.
- `lib/types.ts` is the single source of truth (~25 interfaces). Do not duplicate types.
- The architecture was derived from `pi-orq` but was reduced to a linear pipeline only (no DAG/parallel).
- The `Orchestrator` is a mutable class by design (maintains pool state, subscribers, lifecycle).
- There is no dependency injection framework — factories are passed as parameters (`AgentFactory`).
