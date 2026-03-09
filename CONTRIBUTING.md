# Contributing to HUU

Thanks for your interest in contributing to HUU. This guide covers everything you need to set up a local development environment, follow project conventions, and open a pull request.

---

## Quick Start

```bash
# Clone
git clone https://github.com/frederico-kluser/huu.git
cd huu

# Install (Node.js 22+ required)
npm install

# Verify everything works
npm run check   # typecheck + tests
```

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 22+ | ESM-first project (`"type": "module"`) |
| Git | 2.38+ | Worktree support required |
| npm | 10+ | Ships with Node.js 22 |

---

## Project Structure

```
src/
  cli/            # CLI entrypoints (Commander)
  tui/            # React Ink components (UI layer)
  orchestrator/   # Showrunner loop, beat sheet, scheduling
  agents/         # Agent definitions, runtime, tools
  db/             # SQLite connection, schema, repositories
  git/            # WorktreeManager, MergeManager
  memory/         # Observe → analyze → instinct pipeline
  mcp/            # Model Context Protocol bridge
  audit/          # Tool call logging, risk detection, cost
  prompts/        # Verification templates (anti-hallucination)
  types/          # Shared type contracts
test/             # Integration tests
roadmap/          # Task specification files
docs/             # Research docs and API reference
```

---

## Development Workflow

### 1. Create a branch

```bash
git checkout -b feat/your-feature main
```

### 2. Make changes

Follow the conventions below. Tests go alongside source files (`src/**/*.test.ts`) or in `test/`.

### 3. Validate locally

```bash
npm run typecheck     # Type-check without emitting
npm test              # Run tests once
npm run check         # Both (pre-merge gate)
```

### 4. Commit

Write clear, focused commit messages. One logical change per commit.

```bash
git commit -m "Add concurrency cap to agent scheduler"
```

### 5. Open a PR

Push your branch and open a pull request against `main`.

---

## Code Conventions

### TypeScript

- **Strict mode** with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- **ESM imports** with `.js` extension for relative paths:
  ```typescript
  import { openDatabase } from './connection.js';  // correct
  import { openDatabase } from './connection';      // incorrect
  ```
- **`verbatimModuleSyntax`** — use `import type` for type-only imports:
  ```typescript
  import type { Message } from '../types/index.js';
  ```

### Database

- Always initialize with `journal_mode = WAL` and `foreign_keys = ON`
- Use prepared statements and explicit transactions
- Migrations are versioned SQL files in `src/db/migrations/`

### Git & Worktrees

- Pre-create branches before creating worktrees
- Merge sequentially into main (mutex/semaphore)
- Never run `git gc`/`prune` with active worktrees
- No destructive commands (`reset --hard`, `push --force`)

### TUI

- `tui/` must NOT access infrastructure directly — use contracts from `types/` and data providers
- Components receive data via provider interfaces, never raw SQLite

---

## Testing

Tests use [Vitest](https://vitest.dev/) with the v8 coverage provider.

```bash
npm test                    # Run once
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

- Unit tests: `src/**/*.test.ts`
- Integration tests: `test/**/*.test.ts`
- Git-based tests create real temp repos — no mocks for git operations

### Writing Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('MyFeature', () => {
  it('should do the thing', () => {
    // arrange, act, assert
  });
});
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with tsx watch |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run tests once |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run check` | Typecheck + test (pre-merge gate) |
| `npm run docs:api` | Generate API docs with TypeDoc |

---

## Architecture Overview

HUU is a **multi-agent orchestrator** using the Showrunner Model:

- **Beat Sheet decomposition** — tasks are fractally decomposed into objective → acts → sequences → atomic tasks
- **11 specialized agents** — each runs in an isolated Git worktree
- **SQLite WAL** — single database for messages, memory, audit, and state
- **4-tier merge pipeline** — fast-forward → recursive → heuristic → AI resolver
- **TUI Kanban** — React Ink interface with live monitoring and human controls

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full architectural manifest (12 decisions with rationale).

---

## PR Checklist

Before opening a pull request, verify:

- [ ] Changes address a defined requirement or bug
- [ ] `npm run check` passes (typecheck + tests)
- [ ] New code has tests where applicable
- [ ] No secrets or credentials committed (`.env`, API keys, etc.)
- [ ] Commits are focused (one logical change per commit)
- [ ] Documentation updated if public API changed

---

## Reporting Bugs

Open a [GitHub issue](https://github.com/frederico-kluser/huu/issues) with:

1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Node.js version and OS
5. Relevant logs (with `--verbose` flag)

---

## Proposing Features

Open a GitHub issue labeled `enhancement` with:

1. Problem statement (what's missing or painful)
2. Proposed solution (high-level approach)
3. Alternatives considered

---

## Key References

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Architectural decisions
- [ROADMAP.md](./ROADMAP.md) — Implementation phases
- [docs/api.md](./docs/api.md) — API reference overview
