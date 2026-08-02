---
name: orchestrating-git-worktrees
description: Covers huu's git layer — worktree lifecycle under .huu-worktrees/<runId>, branch naming (huu/<runId>/agent-N, integration, -retry suffix), deterministic ascending --no-ff merges, the never-rewind integration invariant, preflight checks and push retry. Use when touching src/git/, changing merge/branch/worktree behavior, or debugging merge conflicts, orphan branches and worktree leftovers.
metadata:
  version: 0.1.0
  type: knowledge
---

# Orchestrating Git Worktrees

## When to use

Any change in `src/git/` (worktree-manager, branch-namer, preflight, merge) and any bug involving branches, merges, conflicts, or leftover `.huu-worktrees/` state.

## Injected knowledge

### Naming & placement (`src/git/branch-namer.ts` — small, read it before changing)

- Worktrees: `<base>/<runId>/agent-<id>` and `<base>/<runId>/integration`, where base is `.huu-worktrees/` in the repo root by default.
- `HUU_WORKTREE_BASE` overrides the base: absolute paths are taken verbatim; relative ones resolve against the repo root. Exists so container setups can put worktrees on a fast volume while the repo sits on a slow bind mount.
- Branches: `huu/<runId>/agent-<id>` and `huu/<runId>/integration`. A retry attempt (`attempt > 1`) appends `-retry` to both branch and worktree path — a retried agent must not collide with its first attempt's refs.
- Agent IDs 9998 (judge) and 9999 (integration) are reserved; branch names derive from agentId.

### Merge discipline

- Stage merges happen in ASCENDING agentId order with `--no-ff`. Why: deterministic, reproducible integration order regardless of which agent finished first; `--no-ff` keeps one merge commit per agent for auditability.
- The integration worktree NEVER rewinds. CheckStep loops re-execute steps on top of the current integration HEAD, accumulating commits. Rewinding would orphan judge verdicts and discard approved work — if a design seems to need a reset, restructure the pipeline instead.
- Internal commits use `--no-verify`: a user repo's commit hooks must not be able to block huu's plumbing commits (the user's own hooks still apply to their normal work).
- Pushes retry with exponential backoff, max 3 attempts.

### Conflict policy

- Real backends get a conflict-resolver agent (an LLM run in the integration worktree). The stub backend has `conflictResolverFactory: undefined` in `backends/registry.ts` — on conflict it fails loud immediately. That is intentional: a no-LLM run silently "resolving" a conflict would ship a bad merge; keep stub conflict-free in tests or expect the abort.

### Hygiene

- Worktrees are excluded from the user's view via `.git/info/exclude` (not `.gitignore` — huu must not edit the user's tracked ignore file for its own runtime dirs).
- Preflight (`src/lib/git-preflight.ts`) validates: inside a git repo, clean-enough state, remote/push permissions (`HUU_CHECK_PUSH` gates the push probe). It runs on the HOST, before Docker re-exec, so failures surface before a container spins up.

## References

- `src/git/branch-namer.ts` (verbatim source of all naming), `src/git/worktree-manager.ts`, `src/lib/git-preflight.ts`
- Related skills: working-on-orchestrator (who calls this layer), writing-tests (worktree tests use real git in temp dirs)

> Facts verified against source on 2026-06-12.
