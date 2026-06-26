import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout, type Key } from 'ink';
import type { AppConfig, OrchestratorState, Pipeline } from '../../lib/types.js';
import { Orchestrator } from '../../orchestrator/index.js';
import { GlobalScheduler } from '../../orchestrator/global-scheduler.js';
import { generateRunId } from '../../lib/run-id.js';
import type { AgentFactory } from '../../orchestrator/types.js';
import { RunKanban } from './RunKanban.js';
import { LogArea } from './LogArea.js';
import { MorphLoader, MorphMark } from './MorphLoader.js';
import { theme } from '../theme.js';
import { isAuthError } from '../../lib/auth-error.js';

// Mirrors RunDashboard's tuning (kept in sync deliberately).
const LOG_SIDEBAR_WIDTH = 42;
const LOG_SIDEBAR_MIN_TERMINAL_COLS = 100;
const STATE_FLUSH_INTERVAL_MS = 125;
const KANBAN_HEIGHT_RATIO = 0.6;
const KANBAN_COLUMN_CHROME_ROWS = 5;

interface Props {
  /** Two or more pipelines to run CONCURRENTLY under one shared scheduler. */
  pipelines: Pipeline[];
  /** Shared config (one backend/model/key for the whole batch). */
  config: AppConfig;
  cwd: string;
  agentFactory: AgentFactory;
  conflictResolverFactory?: AgentFactory;
  autoScale?: boolean;
  initialConcurrency?: number;
  /** Called when the user quits (Q) — mid-run (aborts the rest) or after all settle. */
  onExit: () => void;
  /** Auth rejection on the shared key — hand off so the parent can fix it. */
  onAuthError?: (specName?: string) => void;
}

interface RunSlot {
  runId: string;
  pipeline: Pipeline;
  orch: Orchestrator;
}

function statusGlyph(status: OrchestratorState['status'] | 'starting'): string {
  switch (status) {
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    case 'integrating':
      return '⇄';
    case 'starting':
      return '…';
    default:
      return '●';
  }
}

/**
 * Multi-run TUI dashboard: runs N pipelines CONCURRENTLY as subordinates of one
 * {@link GlobalScheduler} (a single RAM/concurrency budget — earlier projects
 * have priority, later ones backfill idle slots, lowest-priority newest agent
 * is killed first under memory pressure), and lets the user switch which
 * project's board is shown with Tab / 1-9. Concurrency is scheduler-controlled,
 * so the per-run +/- /A/M keys are intentionally absent here. The single-run
 * {@link RunDashboard} is untouched.
 */
export function MultiRunDashboard({
  pipelines,
  config,
  cwd,
  agentFactory,
  conflictResolverFactory,
  autoScale,
  initialConcurrency,
  onExit,
  onAuthError,
}: Props): React.JSX.Element {
  // Build the scheduler + every Orchestrator exactly once. Each run is
  // subordinate to the shared scheduler and gets a stable runId.
  const [{ scheduler, runs }] = useState<{ scheduler: GlobalScheduler; runs: RunSlot[] }>(() => {
    const sched = new GlobalScheduler();
    const slots: RunSlot[] = pipelines.map((pipeline) => {
      const runId = generateRunId();
      const orch = new Orchestrator(config, pipeline, cwd, agentFactory, {
        conflictResolverFactory,
        autoScale,
        initialConcurrency,
        scheduler: sched,
        runId,
      });
      return { runId, pipeline, orch };
    });
    return { scheduler: sched, runs: slots };
  });

  const [states, setStates] = useState<(OrchestratorState | null)[]>(() => runs.map(() => null));
  const [active, setActive] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [aborting, setAborting] = useState(false);

  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  const abortedRef = useRef(false);
  const authHandledRef = useRef(false);

  // Throttled multi-subscribe — the single-run pattern generalized to an array:
  // subscribers write the latest per-run state into a ref; a fixed-rate poll
  // commits the changed ones. Terminal states bypass the throttle.
  const pendingRef = useRef<(OrchestratorState | null)[]>(runs.map(() => null));
  const committedRef = useRef<(OrchestratorState | null)[]>(runs.map(() => null));

  useEffect(() => {
    scheduler.start();
    const unsubs = runs.map((r, i) =>
      r.orch.subscribe((s) => {
        pendingRef.current[i] = s;
        const terminal = s.status === 'done' || s.status === 'error';
        if (terminal && committedRef.current[i] !== s) {
          committedRef.current[i] = s;
          setStates((prev) => {
            const next = [...prev];
            next[i] = s;
            return next;
          });
        }
      }),
    );

    const interval = setInterval(() => {
      let changed = false;
      const next = [...committedRef.current];
      for (let i = 0; i < runs.length; i++) {
        const p = pendingRef.current[i];
        if (p && p !== committedRef.current[i]) {
          next[i] = p;
          committedRef.current[i] = p;
          changed = true;
        }
      }
      if (changed) setStates(next);
    }, STATE_FLUSH_INTERVAL_MS);
    interval.unref?.();

    let settled = 0;
    for (const r of runs) {
      r.orch
        .start()
        .catch((err: unknown) => {
          if (abortedRef.current) return;
          // Shared-key auth rejection: one failure means all will fail — abort
          // the batch and hand off so the parent can open the key editor.
          if (isAuthError(err) && onAuthErrorRef.current && !authHandledRef.current) {
            authHandledRef.current = true;
            abortedRef.current = true;
            for (const x of runs) x.orch.abort();
            onAuthErrorRef.current(err.specName);
          }
          // Non-auth failures surface as that run's 'error' status on its board.
        })
        .finally(() => {
          settled++;
          if (settled === runs.length) setAllDone(true);
        });
    }

    return () => {
      for (const u of unsubs) u();
      clearInterval(interval);
      scheduler.stop();
      if (!abortedRef.current) {
        abortedRef.current = true;
        for (const r of runs) r.orch.abort();
      }
    };
  }, [scheduler, runs]);

  // 1 Hz tick so the kanban renders live elapsed timers without per-card timers.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    id.unref?.();
    return () => clearInterval(id);
  }, []);

  // Terminal size → clamp the kanban + drop the log sidebar when cramped.
  const { stdout } = useStdout();
  const [terminalRows, setTerminalRows] = useState<number>(() => stdout.rows ?? 24);
  const [terminalCols, setTerminalCols] = useState<number>(() => stdout.columns ?? 80);
  useEffect(() => {
    const handler = (): void => {
      setTerminalRows(stdout.rows ?? 24);
      setTerminalCols(stdout.columns ?? 80);
    };
    stdout.on('resize', handler);
    return () => {
      stdout.off('resize', handler);
    };
  }, [stdout]);
  const maxKanbanRows = Math.max(5, Math.floor(terminalRows * KANBAN_HEIGHT_RATIO));
  const maxCardRows = Math.max(3, maxKanbanRows - KANBAN_COLUMN_CHROME_ROWS);
  const showLogSidebar = terminalCols >= LOG_SIDEBAR_MIN_TERMINAL_COLS;

  // Ref-mirrored state for the input handler so it stays referentially stable
  // (the 1 Hz tick re-renders; a stale-closure handler drops keystrokes).
  const runCount = runs.length;
  const allDoneRef = useRef(allDone);
  allDoneRef.current = allDone;

  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (input === 'q' || input === 'Q') {
        if (abortedRef.current || allDoneRef.current) {
          onExitRef.current();
          return;
        }
        abortedRef.current = true;
        setAborting(true);
        for (const r of runs) r.orch.abort();
        return;
      }
      if (key.tab || key.rightArrow || key.downArrow) {
        setActive((a) => (a + 1) % runCount);
        return;
      }
      if (key.leftArrow || key.upArrow) {
        setActive((a) => (a - 1 + runCount) % runCount);
        return;
      }
      const n = Number(input);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, runCount)) {
        setActive(n - 1);
      }
    },
    [runs, runCount],
  );
  useInput(handleInput);

  const activeState = states[active] ?? null;
  const activePipeline = runs[active]!.pipeline;

  const lastLogByAgent = useMemo(() => {
    const map = new Map<number, string>();
    if (!activeState) return map;
    for (const a of activeState.agents) {
      const last = a.logs[a.logs.length - 1];
      if (last) map.set(a.agentId, last);
    }
    return map;
  }, [activeState]);

  // Before any run has produced state, show a single spin-up loader.
  if (states.every((s) => s === null)) {
    return (
      <Box flexDirection="column" width="100%">
        <Box
          borderStyle="round"
          borderColor={theme.info}
          paddingX={1}
          paddingY={1}
          flexDirection="column"
          width="100%"
          alignItems="center"
        >
          <MorphLoader label={`Starting ${runs.length} projects…`} />
        </Box>
      </Box>
    );
  }

  const elapsed = activeState ? Math.floor(activeState.elapsedMs / 1000) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const anyRunning = states.some((s) => s && s.status !== 'done' && s.status !== 'error');

  return (
    <Box flexDirection="column" width="100%">
      {/* Project selector — one tab per concurrent run; active is highlighted. */}
      <Box paddingX={1} width="100%" flexWrap="wrap">
        <MorphMark active={anyRunning} />
        <Text> </Text>
        <Text dimColor>projects: </Text>
        {runs.map((r, i) => {
          const st = states[i];
          const status = st ? st.status : 'starting';
          const isActive = i === active;
          const color = isActive
            ? theme.info
            : status === 'done'
              ? 'green'
              : status === 'error'
                ? 'red'
                : undefined;
          return (
            <React.Fragment key={r.runId}>
              {i > 0 && <Text dimColor>{'  '}</Text>}
              <Text
                bold={isActive}
                color={color}
                dimColor={!isActive && status !== 'done' && status !== 'error'}
              >
                [{i + 1}] {r.pipeline.name} {statusGlyph(status)}
              </Text>
            </React.Fragment>
          );
        })}
      </Box>

      {/* Active-run header (compact). */}
      <Box paddingX={1} width="100%" flexWrap="wrap">
        <Text bold color="cyan">{activePipeline.name}</Text>
        {activeState && (
          <>
            <Text dimColor>{'  ·  '}</Text>
            <Text>stage{' '}<Text bold>{activeState.currentStage}/{activeState.totalStages}</Text></Text>
            <Text dimColor>{'  ·  '}</Text>
            <Text>grant{' '}<Text bold color="yellow">{activeState.concurrency}</Text></Text>
            <Text dimColor>{'  ·  '}</Text>
            <Text>elapsed{' '}{mm}:{ss}</Text>
            <Text dimColor>{'  ·  '}</Text>
            <Text>{activeState.completedTasks}/{activeState.totalTasks}{' '}done</Text>
            <Text dimColor>{'  ·  status: '}</Text>
            <Text
              bold
              color={
                activeState.status === 'done'
                  ? 'green'
                  : activeState.status === 'error'
                    ? 'red'
                    : 'cyan'
              }
            >
              {activeState.status}
            </Text>
            {activeState.autoScale && (
              <>
                <Text dimColor>{'  ·  '}</Text>
                <Text>RAM {activeState.autoScale.ramPercent}%</Text>
                {activeState.autoScale.guardKillCount > 0 && (
                  <Text color="yellow"> · {activeState.autoScale.guardKillCount} killed</Text>
                )}
              </>
            )}
          </>
        )}
      </Box>

      <Box flexDirection="row" height={maxKanbanRows} flexShrink={0}>
        {activeState ? (
          <RunKanban
            agents={activeState.agents}
            pipeline={activePipeline}
            defaultModelId={config.modelId}
            focusedKey={null}
            nowMs={nowMs}
            lastLogByAgent={lastLogByAgent}
            stageIntegrations={activeState.stageIntegrations}
            checkRuns={activeState.checkRuns}
            maxCardRows={maxCardRows}
          />
        ) : (
          <Box paddingX={1} alignItems="center">
            <MorphLoader label="Waiting for this project to start…" />
          </Box>
        )}
        {showLogSidebar && activeState && (
          <LogArea
            logs={activeState.logs}
            filterAgentId={null}
            maxLines={maxCardRows}
            runStartedAt={activeState.startedAt || undefined}
            width={LOG_SIDEBAR_WIDTH}
          />
        )}
      </Box>

      <Box paddingX={1} width="100%">
        <Text dimColor>
          <Text bold>Tab</Text>/<Text bold>1-{Math.min(9, runs.length)}</Text>/<Text bold>←→</Text> switch project ·{' '}
          {allDone ? (
            <Text color="green">all projects finished</Text>
          ) : aborting ? (
            <Text color="yellow">aborting…</Text>
          ) : (
            <>concurrency is shared across projects</>
          )}
          {' '}· <Text bold>Q</Text> {allDone ? 'return' : 'abort all (press twice to force)'}
        </Text>
      </Box>
    </Box>
  );
}
