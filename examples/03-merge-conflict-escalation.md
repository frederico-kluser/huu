# Merge Conflict Escalation

How HUU handles merge conflicts through its 4-tier progressive pipeline, including human escalation.

## Objective

Understand the merge resolution flow when parallel agents produce conflicting changes, from automatic resolution to human intervention.

## Pre-conditions

- Multi-agent run in progress (two or more builders modifying overlapping files)
- Merge queue actively processing

## Merge Tier Progression

When a conflict is detected, HUU escalates through tiers:

```
Tier 1: Fast-forward
  → No divergence? Apply directly.
  ↓ (diverged)

Tier 2: Recursive auto-merge (git merge-tree)
  → Clean merge? Commit.
  ↓ (conflicts)

Tier 3: Heuristic resolution
  → Score signals: last-touch, ownership, history, risk class
  → Low-risk + high confidence (>0.7)? Apply ours/theirs.
  ↓ (high-risk or low confidence)

Tier 4: AI Resolver
  → Send conflict context bundle to Claude
  → Validate resolved output (syntax, tests)
  → Apply if valid.
  ↓ (validation failed or retry budget exhausted)

Human Escalation
  → Queue item enters 'blocked_human' state
  → TUI shows alert in [M]erge Queue tab
```

## Observing in the TUI

### Merge Queue tab (`M`)

```
Merge Queue (3 items)
──────────────────────────────────────
#  Branch              Status    Tier  Wait
1  feat/auth-login     merged    T1    2s
2  feat/auth-register  running   T3    8s
3  feat/auth-middleware blocked   —     45s
   └─ ⚠ Waiting for human resolution

Running: 1  |  Blocked: 1  |  Avg wait: 18s
```

### Human Resolution

When a merge is blocked, the TUI highlights it. The operator can:

1. **Review the conflict** — Open detail view to see conflicting hunks
2. **Choose an action:**
   - `retry_tier4` — Retry AI resolution with different context
   - `accept_tier3_candidate` — Accept the heuristic suggestion
   - `manual_resolution_committed` — Resolve manually in the worktree, then signal done
   - `abort_merge_item` — Discard the merge and fail the task

## Expected SQLite State

```sql
-- Check blocked items
SELECT id, source_branch, status, last_error
FROM merge_queue
WHERE status = 'blocked_human';

-- View conflict history
SELECT file_path, conflict_type, confidence
FROM merge_conflicts
JOIN merge_resolution_attempts ON conflict_id = merge_conflicts.id
WHERE queue_item_id = '...';
```

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Stuck in `blocked_human` | No operator action taken | Use TUI Merge Queue tab to resolve |
| Tier 4 keeps failing validation | AI-generated resolution breaks tests | Manual resolution or abort |
| Same file conflicts repeatedly | Poor task decomposition | Improve Beat Sheet granularity |
| Conflict history not recording | Missing migration 0003 | Run `migrate(db)` to apply all migrations |
