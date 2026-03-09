# Multi-Agent Feature Implementation

Use the full orchestrator to decompose a complex feature across multiple agents working in parallel.

## Objective

The orchestrator (Opus) decomposes a feature into a Beat Sheet, assigns atomic tasks to specialized agents (builder, tester, reviewer), and merges results progressively.

## Pre-conditions

- HUU initialized (`huu init`)
- `ANTHROPIC_API_KEY` set
- Clean working tree on `main`

## Commands

```bash
# Preview the decomposition plan without executing
huu run "Implement user authentication with JWT tokens, login/register endpoints, and middleware" --dry-run

# Execute with full orchestration
huu run "Implement user authentication with JWT tokens, login/register endpoints, and middleware"
```

## Expected Output (Dry Run)

```
[huu] Dry-run mode — generating plan preview without execution.
[huu] ─────────────────────────────────────
[huu] Task: Implement user authentication with JWT tokens...
[huu] Mode: dry-run (no side effects)
[huu] To execute with the full decomposition pipeline, run without --dry-run.
```

## Expected Output (Full Run)

The TUI Kanban board launches showing real-time progress:

```
┌─ huu ──────────────── Ato 2/3 ── Beat: Confrontation ── $0.47 ─┐
│                                                                   │
│  BACKLOG       RUNNING        REVIEW         DONE                │
│  ─────────    ─────────      ─────────      ─────────            │
│  │ 3.2  │    │ 2.1   │      │ 1.1   │      │ 0.1   │            │
│  │ midlw│    │🤖 bldr│      │🔍 revw│      │✅ JWT │            │
│  │      │    │ sonnet│      │ opus  │      │ $0.08 │            │
│  └──────┘    └───────┘      └───────┘      └───────┘            │
│                                                                   │
│  [K]anban  [L]ogs  [M]erge Queue  [C]ost  [B]eat Sheet   [Q]uit │
└───────────────────────────────────────────────────────────────────┘
```

## Result

- Beat Sheet with 3 acts decomposed into atomic tasks
- Multiple agents executed in parallel (builder + tester)
- Code reviewed by reviewer agent (Opus)
- All work merged into `main` through the 4-tier pipeline
- Session summary and audit log generated

## Observing Progress

### TUI Navigation

| Key | View |
|-----|------|
| `Enter` | Detail view for selected card (live logs, diffs, metrics) |
| `B` | Beat Sheet tab — hierarchical progress with checkpoints |
| `M` | Merge Queue — FIFO queue with tier indicators |
| `C` | Cost breakdown by agent/model/phase |
| `L` | Aggregated logs from all agents |

### Human Controls

| Key | Action |
|-----|--------|
| `S` | Steer — redirect a running agent |
| `F` | Follow-up — queue instruction for after current turn |
| `A` | Abort — cancel agent, discard worktree |
| `P` | Promote — save learning from completed task |

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent stuck (no heartbeat) | Network or API timeout | Health checker auto-detects and restarts |
| Merge conflict in Tier 2 | Parallel agents modified same file | Tier 3/4 auto-resolves or escalates to human |
| Cost exceeding budget | Complex decomposition | Monitor `[C]ost` tab; abort expensive agents |
| Beat blocked | Dependency deadlock | Check `[B]eat Sheet` tab for blocked tasks |
