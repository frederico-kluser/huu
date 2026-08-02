import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout, type Key } from 'ink';
import type { AppConfig, LogEntry, OrchestratorState } from '../../lib/types.js';
import {
  MultiRunDriver,
  type MultiRunPhase,
  type MultiRunSlot,
} from '../../orchestrator/multi-run-driver.js';
import type { AgentFactory } from '../../orchestrator/types.js';
import type { RunQueueItem } from '../../lib/run-queue.js';
import { nextFocusKey } from '../../lib/card-focus.js';
import { formatCost } from '../../lib/format-cost.js';
import { effectiveRamPercent } from '../../lib/web-settings.js';
import { RunKanban } from './RunKanban.js';
import { RunModal } from './RunModal.js';
import { TimeoutPrompt } from './TimeoutPrompt.js';
import { LogArea } from './LogArea.js';
import { MorphLoader, MorphMark } from './MorphLoader.js';
import { theme } from '../theme.js';
import { isAuthError } from '../../lib/auth-error.js';
import { t, translate } from '../../lib/i18n/index.js';

// Mirrors RunDashboard's tuning (kept in sync deliberately).
const LOG_SIDEBAR_WIDTH = 42;
const LOG_SIDEBAR_MIN_TERMINAL_COLS = 100;
const STATE_FLUSH_INTERVAL_MS = 125;
const KANBAN_HEIGHT_RATIO = 0.6;
const KANBAN_COLUMN_CHROME_ROWS = 5;
/** Cross-run scheduler announcements kept for the log sidebar. */
const ANNOUNCE_RING = 40;

interface Props {
  /**
   * Every concurrent run of this launch: one per (pipeline, project) pair, each
   * with its OWN `cwd`. Array order IS scheduler priority — index 0 is admitted
   * first and served first; the rest are pulled in lazily as RAM frees up.
   */
  specs: readonly RunQueueItem[];
  /** Shared config (one backend/model/key for the whole batch). */
  config: AppConfig;
  agentFactory: AgentFactory;
  conflictResolverFactory?: AgentFactory;
  autoScale?: boolean;
  initialConcurrency?: number;
  /** Called when the user quits (Q) — mid-run (aborts the rest) or after all settle. */
  onExit: () => void;
  /** Auth rejection on the shared key — hand off so the parent can fix it. */
  onAuthError?: (specName?: string) => void;
}

function statusGlyph(phase: MultiRunPhase, status: OrchestratorState['status'] | null): string {
  if (phase === 'queued') return '⋯';
  switch (status) {
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    case 'integrating':
      return '⇄';
    case 'awaiting_retry':
      return '⚑';
    case null:
    case undefined:
      return '…';
    default:
      return '●';
  }
}

/** Green under 60%, amber to 85, red above — same reading as SystemMetricsBar. */
function percentColor(pct: number): string {
  if (pct >= 85) return theme.error;
  if (pct >= 60) return theme.warning;
  return theme.success;
}

/**
 * Multi-run TUI dashboard: N pipeline×project runs under ONE
 * {@link MultiRunDriver} — a single shared RAM/concurrency budget with LAZY
 * admission (only the top-priority run starts immediately; the rest sit in a
 * `queued` phase until the machine shows sustained headroom), priority backfill,
 * and cross-run memory-guard preemption of the lowest-priority newest agent.
 *
 * Deliberately leaner than the single-run {@link RunDashboard}: no per-run
 * `+`/`-`/`A`/`M` keys, because concurrency is scheduler-owned (the header shows
 * the machine-global budget chip and this run's `grant` instead). It DOES carry
 * per-card focus, the detail modal and interactive retry — a failed task in the
 * 6th of 8 projects is exactly the case worth recovering by hand.
 */
export function MultiRunDashboard({
  specs,
  config,
  agentFactory,
  conflictResolverFactory,
  autoScale,
  initialConcurrency,
  onExit,
  onAuthError,
}: Props): React.JSX.Element {
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  const abortedRef = useRef(false);
  const authHandledRef = useRef(false);

  const [states, setStates] = useState<(OrchestratorState | null)[]>(() =>
    specs.map(() => null),
  );
  const [slots, setSlots] = useState<readonly MultiRunSlot[]>([]);
  const [active, setActive] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  /**
   * Once every run settles the batch summary takes over — a run of 8 projects
   * used to end by dropping straight back to the editor with no aggregate at all.
   * `B` goes back to the boards, which stay live for inspection.
   */
  const [showBoards, setShowBoards] = useState(false);
  // Non-null while the "retry a timed-out card with a new limit" overlay is open.
  const [retryAgentId, setRetryAgentId] = useState<number | null>(null);
  const [announcements, setAnnouncements] = useState<LogEntry[]>([]);

  // Throttled multi-subscribe — the single-run pattern generalized to an array:
  // subscribers write the latest per-run state into a ref; a fixed-rate poll
  // commits the changed ones. Terminal states bypass the throttle.
  const pendingRef = useRef<(OrchestratorState | null)[]>(specs.map(() => null));
  const committedRef = useRef<(OrchestratorState | null)[]>(specs.map(() => null));

  // Build the driver exactly once. It owns the scheduler, the admission loop and
  // every Orchestrator (created at ADMISSION, so a queued run costs no budget).
  const [driver] = useState<MultiRunDriver>(
    () =>
      new MultiRunDriver(
        specs.map((s) => ({
          pipeline: s.pipeline,
          config,
          cwd: s.cwd,
          agentFactory,
          conflictResolverFactory,
          label: s.label,
        })),
        {
          autoScale,
          initialConcurrency,
          // Honor the persisted machine-global dial (TUI Options / web Settings).
          budgetPercent: effectiveRamPercent(),
          // A held-open run reports getDemand() === 0, so it never starves the
          // scheduler — the same reason the web enables this on every run.
          interactiveRetry: true,
          onSlotsChange: (next) => setSlots([...next]),
          onRunState: (index, state) => {
            pendingRef.current[index] = state;
            const terminal = state.status === 'done' || state.status === 'error';
            if (terminal && committedRef.current[index] !== state) {
              committedRef.current[index] = state;
              setStates((prev) => {
                const out = [...prev];
                out[index] = state;
                return out;
              });
            }
          },
          // Cross-run slot movement is otherwise invisible in the TUI: this is
          // the line that says whether backfill is actually happening.
          onAnnounce: (line) =>
            setAnnouncements((prev) =>
              [
                ...prev,
                { timestamp: Date.now(), agentId: -1, level: 'info' as const, message: line },
              ].slice(-ANNOUNCE_RING),
            ),
          onRunError: (_index, err) => {
            if (abortedRef.current) return;
            // Shared-key auth rejection: one failure means all will fail — abort
            // the batch and hand off so the parent can open the key editor.
            if (isAuthError(err) && onAuthErrorRef.current && !authHandledRef.current) {
              authHandledRef.current = true;
              abortedRef.current = true;
              driverRef.current?.abortAll();
              onAuthErrorRef.current(err.specName);
            }
            // Non-auth failures surface as that run's `error` phase on its tab.
          },
        },
      ),
  );
  // onRunError fires from inside the driver's own callbacks, so it can't close
  // over `driver` (which isn't bound yet when the initializer runs).
  const driverRef = useRef<MultiRunDriver | null>(null);
  driverRef.current = driver;

  useEffect(() => {
    setSlots([...driver.slots]);
    const interval = setInterval(() => {
      let changed = false;
      const next = [...committedRef.current];
      for (let i = 0; i < specs.length; i++) {
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

    void driver.start().then(() => setAllDone(true));

    return () => {
      clearInterval(interval);
      if (!abortedRef.current) {
        abortedRef.current = true;
        driver.abortAll();
      }
    };
  }, [driver, specs.length]);

  // 1 Hz tick so the kanban renders live elapsed timers without per-card timers,
  // and the machine-global budget chip refreshes.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [budget, setBudget] = useState<ReturnType<MultiRunDriver['budgetTelemetry']> | null>(
    null,
  );
  useEffect(() => {
    const tick = (): void => {
      setNowMs(Date.now());
      try {
        setBudget(driver.budgetTelemetry());
      } catch {
        // Telemetry is observability only — never let it take the board down.
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    id.unref?.();
    return () => clearInterval(id);
  }, [driver]);

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
  const runCount = specs.length;
  const allDoneRef = useRef(allDone);
  allDoneRef.current = allDone;
  const activeRef = useRef(active);
  activeRef.current = active;
  const statesRef = useRef(states);
  statesRef.current = states;
  const focusedKeyRef = useRef(focusedKey);
  focusedKeyRef.current = focusedKey;
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  const retryAgentIdRef = useRef(retryAgentId);
  retryAgentIdRef.current = retryAgentId;
  const showBoardsRef = useRef(showBoards);
  showBoardsRef.current = showBoards;

  const handleInput = useCallback(
    (input: string, key: Key) => {
      // CRITICAL: this handler and every overlay's own useInput are registered
      // simultaneously (hooks run before the early-return render branches), so
      // any new overlay MUST be added to this gate or it double-processes
      // ENTER/ESC. Same trap as RunDashboard.
      if (modalOpenRef.current || retryAgentIdRef.current !== null) return;

      if (input === 'q' || input === 'Q') {
        if (abortedRef.current || allDoneRef.current) {
          onExitRef.current();
          return;
        }
        abortedRef.current = true;
        setAborting(true);
        driver.abortAll();
        return;
      }
      // Batch summary ⇄ boards. Only reachable once everything settled, so it
      // can't shadow the in-run meaning of B / ENTER.
      if (allDoneRef.current && !showBoardsRef.current) {
        if (input === 'b' || input === 'B') {
          setShowBoards(true);
          return;
        }
        if (key.return) {
          onExitRef.current();
          return;
        }
      }
      if (allDoneRef.current && showBoardsRef.current && (input === 's' || input === 'S')) {
        setShowBoards(false);
        return;
      }
      // Retry the focused failed card of the ACTIVE project. Only meaningful
      // while that run is held open in `awaiting_retry`.
      if (input === 'r' || input === 'R') {
        const s = statesRef.current[activeRef.current];
        if (s?.status !== 'awaiting_retry') return;
        const fid = focusedKeyRef.current ? Number(focusedKeyRef.current) : null;
        if (fid === null || Number.isNaN(fid)) return;
        const agent = s.agents.find((a) => a.agentId === fid);
        if (!agent || agent.state !== 'error') return;
        if (agent.errorKind === 'timeout') {
          setRetryAgentId(fid);
        } else {
          void driver.orchestratorAt(activeRef.current)?.retryTask(fid);
        }
        return;
      }
      // Finish the active run from its awaiting_retry hold.
      if (input === 'd' || input === 'D') {
        if (statesRef.current[activeRef.current]?.status === 'awaiting_retry') {
          driver.orchestratorAt(activeRef.current)?.finish();
        }
        return;
      }
      if (key.tab) {
        setActive((a) => (a + 1) % runCount);
        setFocusedKey(null);
        return;
      }
      if (key.return) {
        const s = statesRef.current[activeRef.current];
        if (
          focusedKeyRef.current &&
          s?.agents.find((a) => String(a.agentId) === focusedKeyRef.current)
        ) {
          setModalOpen(true);
        }
        return;
      }
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        // Arrows navigate CARDS (Tab and 1-9 switch projects) — a board with
        // focusable cards can't also spend its arrows on the tab strip.
        const next = nextFocusKey(key, statesRef.current[activeRef.current]?.agents, focusedKeyRef.current);
        if (next !== null) setFocusedKey(next);
        return;
      }
      const n = Number(input);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, runCount)) {
        setActive(n - 1);
        setFocusedKey(null);
      }
    },
    [driver, runCount],
  );
  useInput(handleInput);

  const activeSlot = slots[active] ?? null;
  const activeState = states[active] ?? null;
  const activeSpec = specs[active];
  const activePipeline = activeSpec?.pipeline;
  const activeStatus = activeState?.status ?? null;
  const focusedAgent =
    focusedKey !== null
      ? (activeState?.agents.find((a) => String(a.agentId) === focusedKey) ?? null)
      : null;

  const lastLogByAgent = useMemo(() => {
    const map = new Map<number, string>();
    if (!activeState) return map;
    for (const a of activeState.agents) {
      const last = a.logs[a.logs.length - 1];
      if (last) map.set(a.agentId, last);
    }
    return map;
  }, [activeState]);

  // Scheduler announcements interleave with the active run's own log so the
  // sidebar tells one story: "my tasks" plus "what the machine did to us".
  const sidebarLogs = useMemo(() => {
    if (!activeState) return announcements;
    if (announcements.length === 0) return activeState.logs;
    return [...activeState.logs, ...announcements].sort((a, b) => a.timestamp - b.timestamp);
  }, [activeState, announcements]);

  if (modalOpen && focusedAgent && activePipeline) {
    const candidate = activePipeline.steps[focusedAgent.stageIndex];
    const stepPrompt =
      candidate && candidate.type !== 'check'
        ? (candidate.prompt ?? t('tui.dash.prompt_unavailable'))
        : candidate
          ? t('tui.dash.prompt_check', { name: candidate.name, condition: candidate.condition })
          : t('tui.dash.prompt_unavailable');
    return (
      <RunModal
        agent={focusedAgent}
        stepPrompt={stepPrompt}
        onClose={() => setModalOpen(false)}
      />
    );
  }

  if (retryAgentId !== null && activePipeline) {
    const curMs =
      activePipeline.singleFileCardTimeoutMs ?? activePipeline.cardTimeoutMs ?? 300_000;
    const defaultMinutes = Math.max(1, Math.round(curMs / 60_000));
    return (
      <Box flexDirection="column" width="100%">
        <Box paddingX={1}>
          <Text dimColor>
            {t('tui.multi.retry_prompt', { id: retryAgentId, label: activeSpec?.label ?? '' })}
          </Text>
        </Box>
        <TimeoutPrompt
          defaultMinutes={defaultMinutes}
          onSubmit={(minutes) => {
            const id = retryAgentId;
            const idx = activeRef.current;
            setRetryAgentId(null);
            void driver.orchestratorAt(idx)?.retryTask(id, { timeoutMs: minutes * 60_000 });
          }}
          onCancel={() => setRetryAgentId(null)}
        />
      </Box>
    );
  }

  // Batch summary — the aggregate a multi-project run always lacked. Rendered
  // instead of the boards once every run settles; `B` returns to them.
  if (allDone && !showBoards) {
    const okCount = slots.filter((s) => s.phase === 'done').length;
    const failCount = slots.length - okCount;
    const totalCost = slots.reduce((sum, s) => sum + (s.result?.totalCost ?? 0), 0);
    const verdictColor = failCount === 0 ? theme.success : okCount === 0 ? theme.error : theme.warning;
    return (
      <Box flexDirection="column" width="100%">
        <Box
          borderStyle="round"
          borderColor={verdictColor}
          paddingX={1}
          flexDirection="column"
          width="100%"
        >
          <Text bold color={verdictColor}>
            {t('tui.multi.batch_title', {
              ok: okCount,
              failed: failCount > 0 ? t('tui.multi.batch_failed_suffix', { count: failCount }) : '',
              total: slots.length,
            })}
          </Text>
          {totalCost > 0 ? (
            <Text dimColor>{t('tui.multi.total_cost', { cost: formatCost(totalCost) })}</Text>
          ) : null}

          <Box marginTop={1} flexDirection="column">
            {slots.map((slot) => {
              const r = slot.result;
              const committed = r ? r.agents.filter((a) => a.commitSha).length : 0;
              const conflicts = r?.integration.conflicts.length ?? 0;
              const ok = slot.phase === 'done';
              return (
                <Box key={slot.runId} flexDirection="column">
                  <Box>
                    <Text color={ok ? theme.success : theme.error} bold>
                      {ok ? '✓' : '✗'}{' '}
                    </Text>
                    <Text bold wrap="truncate-end">{slot.label}</Text>
                    {r ? (
                      <Text dimColor>
                        {'  ·  '}
                        {t('tui.multi.slot_stats', {
                          committed,
                          total: r.agents.length,
                          files: r.filesModified.length,
                        })}
                        {conflicts > 0 ? ` · ${t('tui.multi.slot_conflicts', { count: conflicts })}` : ''}
                        {r.totalCost > 0 ? ` · ${formatCost(r.totalCost)}` : ''}
                      </Text>
                    ) : null}
                  </Box>
                  {!ok && slot.error ? (
                    <Text color={theme.error} wrap="truncate-end">
                      {'    '}⚠ {slot.error}
                    </Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              {t('tui.multi.logs_hint')} · <Text bold>B</Text> {t('tui.multi.hint_back_boards')} ·{' '}
              <Text bold>ENTER</Text> {t('tui.multi.hint_return')} · <Text bold>Q</Text>{' '}
              {t('common.action.quit')}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Before ANY run has produced state, show a single spin-up loader. With lazy
  // admission that is only the top-priority run — the rest are still queued.
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
          <MorphLoader label={t('tui.multi.starting', { count: specs.length })} />
          <Text dimColor>{t('tui.multi.starting_hint')}</Text>
        </Box>
      </Box>
    );
  }

  const elapsed = activeState ? Math.floor(activeState.elapsedMs / 1000) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const anyRunning = states.some((s) => s && s.status !== 'done' && s.status !== 'error');
  const queuedCount = slots.filter((s) => s.phase === 'queued').length;

  return (
    <Box flexDirection="column" width="100%">
      {/* Project selector — one tab per run; the active one is highlighted. */}
      <Box paddingX={1} width="100%" flexWrap="wrap">
        <MorphMark active={anyRunning} />
        <Text> </Text>
        <Text dimColor>{t('tui.multi.runs_label')} </Text>
        {specs.map((spec, i) => {
          const st = states[i] ?? null;
          const phase = slots[i]?.phase ?? 'queued';
          const isActive = i === active;
          const color = isActive
            ? theme.info
            : phase === 'queued'
              ? theme.warning
              : st?.status === 'done'
                ? 'green'
                : st?.status === 'error'
                  ? 'red'
                  : undefined;
          return (
            <React.Fragment key={`${spec.pipeline.name}:${spec.cwd}`}>
              {i > 0 && <Text dimColor>{'  '}</Text>}
              <Text
                bold={isActive}
                color={color}
                dimColor={!isActive && phase !== 'done' && phase !== 'error' && phase !== 'queued'}
              >
                [{i + 1}] {spec.label} {statusGlyph(phase, st?.status ?? null)}
              </Text>
            </React.Fragment>
          );
        })}
      </Box>

      {/* Machine-global budget chip — one machine, one RAM. Distinct from the
          per-run `grant` below it: this is what the whole box is doing. */}
      {budget && (
        <Box paddingX={1} width="100%" flexWrap="wrap">
          <Text dimColor>{t('tui.multi.budget_label')} </Text>
          <Text>
            {t('tui.multi.dial')}{' '}
            <Text bold color={theme.info}>{budget.budgetPercent}%</Text>
          </Text>
          <Text dimColor>{'  ·  '}</Text>
          <Text>
            {t('tui.multi.agents')}{' '}
            <Text bold color="yellow">
              {budget.liveAgents}/{budget.budgetB}
            </Text>
            {budget.reservedAgents > 0 ? (
              <Text dimColor> {t('tui.multi.reserved', { count: budget.reservedAgents })}</Text>
            ) : null}
          </Text>
          <Text dimColor>{'  ·  '}</Text>
          <Text>
            {/* budgetTelemetry() forwards the RAW sampler float (AutoScaleStatus
                rounds, this doesn't) — render it rounded or it prints 16 digits. */}
            {t('tui.metrics.ram')}{' '}
            <Text bold color={percentColor(budget.ramPercent)}>
              {Math.round(budget.ramPercent)}%
            </Text>
          </Text>
          {budget.hostAvailableBytes != null && (
            <Text dimColor>
              {'  ·  '}
              {t('tui.dash.scaler_host_free', {
                free: Math.round(budget.hostAvailableBytes / 1024 / 1024),
              })}
            </Text>
          )}
          {queuedCount > 0 && (
            <Text color={theme.warning}>
              {'  ·  '}
              {t('tui.multi.queued_count', { count: queuedCount })}
            </Text>
          )}
          {budget.hostClampActive && (
            <Text color={theme.warning}>{'  ·  '}{t('tui.dash.scaler_host_limited')}</Text>
          )}
          {budget.pressureLevel > 0 && (
            <Text color={budget.pressureLevel >= 2 ? theme.error : theme.warning}>
              {'  ·  '}
              {t('tui.multi.pressure', { reason: budget.pressureReason })}
            </Text>
          )}
        </Box>
      )}

      {/* Active-run header (compact). */}
      <Box paddingX={1} width="100%" flexWrap="wrap">
        <Text bold color="cyan">{activeSpec?.label ?? ''}</Text>
        {activeSlot?.phase === 'queued' ? (
          <Text color={theme.warning}>{'  ·  '}{t('tui.multi.queued_waiting')}</Text>
        ) : activeState ? (
          <>
            <Text dimColor>{'  ·  '}</Text>
            <Text>{t('tui.dash.stage')}{' '}<Text bold>{activeState.currentStage}/{activeState.totalStages}</Text></Text>
            <Text dimColor>{'  ·  '}</Text>
            <Text>{t('tui.multi.grant')}{' '}<Text bold color="yellow">{activeState.concurrency}</Text></Text>
            <Text dimColor>{'  ·  '}</Text>
            <Text>{t('tui.dash.elapsed')}{' '}{mm}:{ss}</Text>
            <Text dimColor>{'  ·  '}</Text>
            <Text>{activeState.completedTasks}/{activeState.totalTasks}{' '}{t('tui.dash.done')}</Text>
            {activeState.totalCost > 0 && (
              <>
                <Text dimColor>{'  ·  '}</Text>
                <Text>{t('tui.dash.cost')}{' '}<Text bold color="green">{formatCost(activeState.totalCost)}</Text></Text>
              </>
            )}
            <Text dimColor>{`  ·  ${t('tui.dash.status')}: `}</Text>
            <Text
              bold
              color={
                activeStatus === 'done'
                  ? 'green'
                  : activeStatus === 'error'
                    ? 'red'
                    : activeStatus === 'awaiting_retry'
                      ? theme.warning
                      : 'cyan'
              }
            >
              {translate(`run_status.${activeStatus}`)}
            </Text>
          </>
        ) : null}
      </Box>

      <Box flexDirection="row" height={maxKanbanRows} flexShrink={0}>
        {activeState && activePipeline ? (
          <RunKanban
            agents={activeState.agents}
            pipeline={activePipeline}
            defaultModelId={config.modelId}
            focusedKey={focusedKey}
            nowMs={nowMs}
            lastLogByAgent={lastLogByAgent}
            stageIntegrations={activeState.stageIntegrations}
            checkRuns={activeState.checkRuns}
            maxCardRows={maxCardRows}
          />
        ) : (
          <Box paddingX={1} alignItems="center">
            <MorphLoader
              label={
                activeSlot?.phase === 'queued'
                  ? t('tui.multi.loader_queued')
                  : t('tui.multi.loader_waiting')
              }
            />
          </Box>
        )}
        {showLogSidebar && sidebarLogs.length > 0 && (
          <LogArea
            logs={sidebarLogs}
            filterAgentId={null}
            maxLines={maxCardRows}
            runStartedAt={activeState?.startedAt || undefined}
            width={LOG_SIDEBAR_WIDTH}
          />
        )}
      </Box>

      <Box paddingX={1} width="100%" flexWrap="wrap">
        {activeStatus === 'awaiting_retry' ? (
          <Text dimColor>
            <Text bold color={theme.warning}>
              {t('tui.dash.failed_count', {
                count: activeState?.agents.filter((a) => a.state === 'error').length ?? 0,
              })}
            </Text>
            {' · '}
            <Text bold>↑↓←→</Text> {t('tui.multi.hint_cards')} ·{' '}
            <Text bold color={theme.success}>R</Text> {t('tui.multi.hint_retry_focused')} ·{' '}
            <Text bold color={theme.success}>D</Text> {t('tui.multi.hint_finish_this')} ·{' '}
            <Text bold>Tab</Text>/<Text bold>1-{Math.min(9, specs.length)}</Text>{' '}
            {t('tui.multi.hint_switch')} ·{' '}
            <Text bold color={theme.error}>Q</Text> {t('tui.multi.hint_abort_all')}
          </Text>
        ) : (
          <Text dimColor>
            <Text bold>Tab</Text>/<Text bold>1-{Math.min(9, specs.length)}</Text>{' '}
            {t('tui.multi.hint_switch_run')} · <Text bold>↑↓←→</Text> {t('tui.multi.hint_cards')} ·{' '}
            <Text bold>ENTER</Text> {t('tui.dash.hint_details')} ·{' '}
            {allDone ? (
              <>
                <Text color="green">{t('tui.multi.all_finished')}</Text>
                {' · '}
                <Text bold>S</Text> {t('tui.multi.hint_summary')}
              </>
            ) : aborting ? (
              <Text color="yellow">{t('tui.multi.aborting')}</Text>
            ) : (
              <>{t('tui.multi.shared_concurrency')}</>
            )}
            {' '}· <Text bold>Q</Text>{' '}
            {allDone ? t('tui.multi.hint_return') : t('tui.multi.hint_abort_all_force')}
          </Text>
        )}
      </Box>
    </Box>
  );
}
