# Single Task Execution

Run a single builder agent to implement a feature end-to-end.

## Objective

Execute `huu run` to spawn one agent that creates a worktree, implements a task, commits, and merges back to main.

## Pre-conditions

- HUU initialized in a Git repository (`huu init`)
- `ANTHROPIC_API_KEY` environment variable set
- Clean working tree on `main`

## Commands

```bash
# Run a single task
huu run "Add a health check endpoint that returns { status: 'ok', uptime: process.uptime() }"
```

## Expected Output

```
[huu] Starting single-agent run...
[huu] Creating worktree for builder agent...
[huu] Agent: builder (claude-sonnet-4-20250514)
[huu] Task: Add a health check endpoint that returns { status: 'ok', uptime: process.uptime() }
[huu] ─────────────────────────────────────
[huu] Agent working...
[huu] Files changed:
[huu]   + src/routes/health.ts (created)
[huu]   ~ src/routes/index.ts (modified)
[huu] Commit: a1b2c3d "Add health check endpoint returning status and uptime"
[huu] Merge: fast-forward into main
[huu] ─────────────────────────────────────
[huu] Done. Worktree cleaned up.
```

## Result

- New file(s) committed to `main`
- Worktree removed after completion
- Merge result logged in SQLite (`merge_results` table)
- Audit log records all tool calls

## Check Status

```bash
huu status
```

```
HUU Status
──────────────
Last run: 2025-01-15T10:30:00Z
Agent: builder (claude-sonnet-4-20250514)
Status: completed
Files changed: 2
Cost: $0.04
Duration: 45s
```

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ANTHROPIC_API_KEY not set` | Missing env variable | `export ANTHROPIC_API_KEY=sk-ant-...` |
| `Not a git repository` | Not in a git repo | `git init && git commit --allow-empty -m "init"` |
| `Task description must be at least 5 characters` | Input too short | Provide a more detailed task description |
| `Merge conflict` | Main diverged during execution | Agent retries or escalates |
