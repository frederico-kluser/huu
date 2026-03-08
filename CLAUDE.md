# HUU — Project Conventions

## What is HUU

Multi-agent orchestrator for software development using the Showrunner Model.
An orchestrator decomposes tasks via a fractal Beat Sheet, delegates to 11 specialized agents,
and integrates work via progressive 4-tier merge. All state lives in a unified SQLite WAL database.
Human interface is a TUI Kanban built with React Ink.

## Stack

- **Runtime:** Node.js 22+ (ESM-first, `"type": "module"`)
- **Language:** TypeScript 5.x via `tsx` (strict mode)
- **TUI:** React Ink 6.x
- **Database:** better-sqlite3 (WAL mode)
- **Git:** simple-git + `raw()` for worktree operations
- **AI:** @anthropic-ai/sdk
- **MCP:** @modelcontextprotocol/sdk
- **Tests:** Vitest 4.x with v8 coverage

## Project Structure

```
src/
  cli/            # CLI entrypoints and argument parsing
  tui/            # React Ink components (UI layer)
  orchestrator/   # Showrunner loop
  agents/         # Agent runtimes and definitions
  db/             # SQLite connection, schema, repositories
  git/            # WorktreeManager and Git operations
  types/          # Shared type contracts
test/             # Integration/smoke tests
```

## Key Rules

### Code

- ESM imports with `.js` extension for relative paths (TypeScript convention with `NodeNext`)
- `tui/` must NOT access infrastructure directly — use contracts from `types/` and orchestrator
- One `simple-git` instance per worktree directory

### Git & Worktrees

- Pre-create branches before creating worktrees
- Merge sequentially into main (mutex/semaphore)
- Never run `git gc`/`prune` with active worktrees
- No destructive commands (`reset --hard`, `push --force`) without explicit authorization

### Database

- Always initialize with `journal_mode = WAL` and `foreign_keys = ON`
- Use prepared statements and explicit transactions
- Migrations are versioned

### Quality

- Run `npm run check` (typecheck + test) before merge
- Tests go in `src/**/*.test.ts` or `test/**/*.test.ts`
- Coverage with v8 provider

## Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start dev server with tsx watch |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run check` | Typecheck + test (pre-merge gate) |

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 12 architectural decisions
- [ROADMAP.md](./ROADMAP.md) — Implementation phases
