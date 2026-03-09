# Recovery After Crash

How HUU recovers orchestrator state after an unexpected crash or process termination.

## Objective

Demonstrate the crash recovery flow: the orchestrator replays its event log, restores task states, reclaims stale worktrees, and resumes execution.

## Pre-conditions

- A previous HUU run was interrupted (process kill, power loss, OOM)
- SQLite database intact (WAL mode ensures durability)
- Worktrees may be in inconsistent state

## What Happens on Restart

```
1. Open SQLite database (WAL recovery automatic)
      ↓
2. Find latest orchestrator run (orchestrator_runs table)
      ↓
3. RecoveryEngine.recover()
   ├─ Replay event log from last_applied_event_id
   ├─ Rebuild in-memory task states
   ├─ Detect abandoned tasks (heartbeat expired)
   └─ Classify: resume vs retry vs fail
      ↓
4. Stale worktree cleanup
   ├─ Check process alive (PID)
   ├─ Check for uncommitted changes
   ├─ Check for unmerged commits
   └─ Prune or preserve based on policy
      ↓
5. Resume orchestrator loop from recovered state
```

## Commands

```bash
# HUU automatically recovers on next run
huu run "Continue implementing feature X"

# Check what was recovered
huu status
```

## Expected Recovery Output

```
[huu] Found interrupted run: run_abc123 (status: recovering)
[huu] Replaying 47 events from event log...
[huu] Task states recovered:
[huu]   - task_1: done (previously completed)
[huu]   - task_2: done (previously completed)
[huu]   - task_3: failed → retry (heartbeat expired, attempt 1/3)
[huu]   - task_4: pending (not yet started)
[huu] Stale worktrees:
[huu]   - worktree/agent-3: stale (PID 12345 dead), has uncommitted changes → preserved
[huu]   - worktree/agent-5: stale (PID 12346 dead), clean → pruned
[huu] Resuming orchestrator loop from ASSIGN state...
```

## Key Recovery Components

| Component | Role |
|-----------|------|
| `EventLog` | Append-only event log with idempotency keys |
| `TaskAttemptTracker` | Track attempts per task with heartbeat |
| `RecoveryEngine` | Replay events, rebuild state, classify abandoned tasks |
| `RunStateMachine` | Validate state transitions during recovery |
| `WorktreeCleanup` | Detect and handle stale worktrees |
| `ShutdownManager` | Graceful shutdown saves state for clean recovery |

## SQLite Tables Involved

```sql
-- Orchestrator run state
SELECT run_id, status, state_version, last_applied_event_id
FROM orchestrator_runs WHERE status != 'done';

-- Event log for replay
SELECT id, event_type, task_id, payload_json
FROM orchestrator_events WHERE run_id = ? AND id > ?
ORDER BY id;

-- Task attempts with heartbeat
SELECT task_id, attempt, state, heartbeat_at
FROM task_attempts WHERE run_id = ? AND state IN ('assigned', 'running');

-- State transitions (audit)
SELECT from_state, to_state, trigger, created_at
FROM state_transitions WHERE run_id = ?;
```

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `UNIQUE constraint: schema_migrations` | Migration version conflict | Renumber conflicting migration files |
| Worktree locked by dead process | PID still in process table | Reboot or `kill -9` the zombie |
| Event replay diverges | Non-deterministic event payload | Check idempotency keys in `orchestrator_events` |
| Task retried too many times | Max attempts exceeded | Check `max_attempts` config; increase if needed |
| Stale worktree with valuable changes | Agent crashed after coding but before commit | Manually commit from preserved worktree |
