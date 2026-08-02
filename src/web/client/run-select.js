/* Which run should the board show? Pure decision, unit-tested by
   src/web/run-select.test.js (kept OUT of this served dir).

   The bug this kills: the active-run pointer adopted the OLDEST tracked run
   and only ever moved when that run VANISHED from tracking — so a single
   early finished/failed run parked the UI on a dead board forever. The board
   auto-switch fires only while the POINTED run is `running`, so with nine
   live projects narrating in the terminal the web showed... the launch view.

   Rules, in order (insertion order of `runs` = queue priority):
     1. A run the USER explicitly picked in the selector wins while tracked.
     2. A current pointer that is RUNNING is kept (no view churn).
     3. Otherwise advance to the first RUNNING run.
     4. Nothing running: a QUEUED current is kept, else the first QUEUED run
        (it is about to start).
     5. Nothing live at all: keep the current pointer if it still exists (its
        final board stays readable), else the MOST RECENT run, else null. */
export function pickActiveRun(currentId, pinnedId, runs) {
  const byId = (id) => (id ? runs.find((r) => r.runId === id) : undefined);
  const pinned = byId(pinnedId);
  if (pinned) return pinned.runId;
  const current = byId(currentId);
  if (current && current.phase === 'running') return current.runId;
  const firstRunning = runs.find((r) => r.phase === 'running');
  if (firstRunning) return firstRunning.runId;
  if (current && current.phase === 'queued') return current.runId;
  const firstQueued = runs.find((r) => r.phase === 'queued');
  if (firstQueued) return firstQueued.runId;
  if (current) return current.runId;
  return runs.length ? runs[runs.length - 1].runId : null;
}
