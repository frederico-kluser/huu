---
name: git-workflow-orchestration
description: >-
  Define git worktree lifecycle, branch naming, merge strategies, and conflict
  resolution for agent runs. Use when modifying git operations, debugging merge
  failures, or adding new preflight checks. Do not use for general git usage
  outside the agent context.
paths: "src/git/**/*.ts"
disable-model-invocation: true
---
# Git Workflow Orchestration

## Goal

Documents the complete lifecycle of worktrees and branches used by the
orchestrator to isolate LLM agents and integrate their results.

## Boundaries

**Do:**
- Use `GitClient` (synchronous wrapper over `execSync`) for all git operations
- Follow `branch-namer.ts` naming conventions: `programatic-agent/<runId>/agent-N` and `.../integration`
- Temporary worktrees in `.programatic-agent-worktrees/<runId>/` (auto-gitignored)
- Merge deterministically by ascending `agentId` via `git merge --no-ff`
- Resolve conflicts via integration agent LLM (when real factory is available)

**Do not:**
- Use async git operations (`exec`/`spawn`) — the project intentionally uses `execSync`
- Create branches outside the `programatic-agent/<runId>/...` pattern
- Leave orphaned worktrees — always cleanup via `WorktreeManager`
- Allow stubs to resolve conflicts — only real agents have permission

## Workflow

### Preflight
1. `runPreflight()` validates: git repo, resolved branch, HEAD commit, dirty state, remote, push dry-run
2. Returns `PreflightResult` with `valid`, `errors[]`, `warnings[]`

### Central Worktree (Integration)
1. Created at `.programatic-agent-worktrees/<runId>/integration`
2. Branch: `programatic-agent/<runId>/integration` from current HEAD
3. Auto-appended to `.gitignore` on first run

### Per Stage
1. Decompose tasks → 1 per file (or 1 whole-project if `files: []`)
2. Create worktree per agent: `.programatic-agent-worktrees/<runId>/agent-N/`
3. Branch per agent: `programatic-agent/<runId>/agent-N`
4. When agent finishes: validate → stage → commit (`--no-verify`) → remove worktree
5. Merge all branches deterministically in the integration worktree (`agentId` order)
6. If conflicts: spawn integration agent LLM to resolve
7. Next stage branches from the updated integration HEAD

### Cleanup
- Central worktree removed at end of run
- Branches preserved as artifacts

## Gotchas

- Agent commits use `--no-verify` because preflight already validated the state.
- Push uses retry with exponential backoff (up to 3 attempts).
- The integration agent is always `agentId: 9999`.
- Stub agents (`--stub`) do not resolve conflicts — any conflict aborts immediately.
- `git-client.ts` is a thin wrapper — there is no libgit2 or isomorphic-git.
