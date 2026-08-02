import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pkg } from '../../lib/package-info.js';
import { Box, Text, useInput, useStdout } from 'ink';
import type { AppConfig, OrchestratorResult, OrchestratorState, Pipeline } from '../../lib/types.js';
import { nextFocusKey } from '../../lib/card-focus.js';
import { formatCost } from '../../lib/format-cost.js';
import { Orchestrator } from '../../orchestrator/index.js';
import type { AgentFactory } from '../../orchestrator/types.js';
import { RunKanban } from './RunKanban.js';
import { RunModal } from './RunModal.js';
import { TimeoutPrompt } from './TimeoutPrompt.js';
import { LogArea } from './LogArea.js';
import { MorphLoader, MorphMark } from './MorphLoader.js';
import { theme } from '../theme.js';
import { log as dlog, bump as dbump } from '../../lib/debug-logger.js';
import { isAuthError } from '../../lib/auth-error.js';
import { effectiveRamPercent } from '../../lib/web-settings.js';
import { t, translate } from '../../lib/i18n/index.js';

// Width of the right-side log column. Below this threshold of total terminal
// columns the sidebar is hidden so the kanban still has room to breathe;
// above it, the kanban "shrinks lateral" by exactly this amount.
const LOG_SIDEBAR_WIDTH = 42;
const LOG_SIDEBAR_MIN_TERMINAL_COLS = 100;

// Coalesce orchestrator emits to ~8 Hz. The orchestrator can fire hundreds
// of state events per second under concurrency 10 (one per agent log /
// state_change / file_write / tool start+end). Each setState here triggers
// a full kanban re-render and a log-update stdout write; if we let those
// run unbounded, Ink can't drain `process.stdin` fast enough and keystrokes
// (including raw-mode Ctrl+C, which is just `\x03` flowing through the same
// pipeline) get buffered indefinitely.
//
// 8 Hz keeps the kanban visibly live while leaving plenty of event-loop
// headroom for stdin polling, useInput dispatch, and React commits.
const STATE_FLUSH_INTERVAL_MS = 125;

interface Props {
  config: AppConfig;
  pipeline: Pipeline;
  cwd: string;
  agentFactory: AgentFactory;
  /** Optional LLM resolver for merge conflicts. When omitted, conflicts abort the run. */
  conflictResolverFactory?: AgentFactory;
  /**
   * Memory-aware dynamic concurrency (default true). False pins the pool
   * at `initialConcurrency`; the memory guard stays active either way.
   */
  autoScale?: boolean;
  /** Initial/pinned concurrency (--concurrency=N). */
  initialConcurrency?: number;
  onComplete: (result: OrchestratorResult) => void;
  onAbort: () => void;
  /**
   * Called instead of surfacing an inline error when the run aborts because
   * a backend rejected the credentials. Lets the parent jump straight to the
   * Options screen, focused on the offending provider (`specName`).
   */
  onAuthError?: (specName?: string) => void;
}

export function RunDashboard({
  config,
  pipeline,
  cwd,
  agentFactory,
  conflictResolverFactory,
  autoScale,
  initialConcurrency,
  onComplete,
  onAbort,
  onAuthError,
}: Props): React.JSX.Element {
  // Create the Orchestrator exactly once per mount. Parent re-renders pass new
  // identities for `config`/callbacks; depending on those would rebuild the
  // orchestrator on every state emission and reset `instanceCount` to its
  // default — making the +/- concurrency keys appear to do nothing.
  const [orch] = useState(
    () =>
      new Orchestrator(config, pipeline, cwd, agentFactory, {
        conflictResolverFactory,
        autoScale,
        initialConcurrency,
        // Honor the PERSISTED machine-global RAM dial (TUI Options / web ⚙
        // Settings). Single-run has no GlobalScheduler, so without this the
        // TUI's most-used path silently ignored the dial the user set.
        budgetPercent: effectiveRamPercent(),
        // Single-run TUI holds the run open in `awaiting_retry` when it ends
        // with failed cards so the user can retry them (R) before the summary.
        interactiveRetry: true,
      }),
  );
  const [state, setState] = useState<OrchestratorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Non-null while the "retry a timed-out card with a new limit" overlay is
  // open; holds the agentId being retried.
  const [retryAgentId, setRetryAgentId] = useState<number | null>(null);
  const [aborting, setAborting] = useState(false);
  // `null` = show every log entry; otherwise filter to the matching agentId.
  // `f` toggles between "all" and "focused agent" so the sidebar can zoom in.
  const [logFilter, setLogFilter] = useState<number | null>(null);

  // Callback refs live up here (before the useEffect that consumes them) so
  // there's no TDZ-style ambiguity when the orchestrator's `.then`/`.catch`
  // resolve well after the initial render.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onAbortRef = useRef(onAbort);
  onAbortRef.current = onAbort;
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  // When the user aborts (Q), `orch.start()` is still in flight — it only
  // resolves after every in-flight agent's session/dispose/finalize finishes.
  // Once it resolves, the original `.then(onCompleteRef.current)` would fire
  // and navigate the user (who already moved away) to the summary screen,
  // making it look like Q "did nothing" or that the run completed normally.
  // This ref is checked inside the `.then` and short-circuits onComplete after
  // an abort.
  const abortedRef = useRef(false);

  // Throttled subscription. Subscriber writes the latest state into a ref;
  // a fixed-rate setInterval pulls it into React. setInterval (not
  // setTimeout-per-emit) means there is at most one pending timer in the
  // queue regardless of emission rate, so the timer phase can't crowd out
  // the poll phase where stdin is drained. Terminal states bypass the
  // throttle so the user sees the final frame immediately.
  const pendingStateRef = useRef<OrchestratorState | null>(null);
  const lastRenderedRef = useRef<OrchestratorState | null>(null);

  useEffect(() => {
    dlog('mount', 'RunDashboard');
    let firstEmit = true;
    const commit = (s: OrchestratorState): void => {
      dbump('commit.RunDashboard');
      lastRenderedRef.current = s;
      setState(s);
    };

    const unsub = orch.subscribe((s) => {
      dbump('orch.subscribe');
      pendingStateRef.current = s;
      const isTerminal = s.status === 'done' || s.status === 'error';
      if (firstEmit || isTerminal) {
        firstEmit = false;
        commit(s);
      }
    });

    const interval = setInterval(() => {
      const next = pendingStateRef.current;
      if (next && next !== lastRenderedRef.current) commit(next);
    }, STATE_FLUSH_INTERVAL_MS);
    interval.unref?.();

    orch.start().then((r) => {
      if (abortedRef.current) {
        onAbortRef.current();
        return;
      }
      onCompleteRef.current(r);
    }).catch((err) => {
      if (abortedRef.current) {
        onAbortRef.current();
        return;
      }
      // Credential rejection: hand off to the parent so it can open the
      // Options screen focused on the bad provider, instead of dead-ending
      // on an inline error the user can't act on here.
      if (isAuthError(err) && onAuthErrorRef.current) {
        abortedRef.current = true;
        orch.abort();
        onAuthErrorRef.current(err.specName);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      dlog('mount', 'RunDashboard.unmount');
      unsub();
      clearInterval(interval);
      // If the dashboard unmounts for any reason while the orchestrator is
      // still working, ask it to wind down. Without this, a leaked run keeps
      // creating worktrees and finalize() callbacks fire into a dead tree.
      if (!abortedRef.current) {
        abortedRef.current = true;
        orch.abort();
      }
    };
  }, [orch]);

  // The kanban consumes `nowMs` to render live elapsed timers without each
  // card running its own setInterval. Tick once per second; that's enough
  // resolution for HH:MM display and is light on the event loop.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    id.unref?.();
    return () => clearInterval(id);
  }, []);

  // Terminal-size tracking so the kanban can clamp its content to the visible
  // viewport and the log sidebar can drop on cramped terminals. Ink doesn't
  // re-render on its own when stdout fires `resize`, so we keep both
  // dimensions in state and refresh them from the listener.
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

  // Toggling the modal swaps the entire body (kanban ↔ modal). Mirror the
  // pattern used by App.navigate at screen boundaries: wipe the scrollback so
  // any residue from the previous view (overflow row Ink couldn't reclaim,
  // pre-resize content) doesn't bleed into the next frame. `\x1b[3J` is
  // scrollback-only — it doesn't touch Ink's tracked viewport, so the
  // upcoming render still draws cleanly via log-update.
  const prevModalOpenRef = useRef(modalOpen);
  useEffect(() => {
    if (prevModalOpenRef.current !== modalOpen) {
      prevModalOpenRef.current = modalOpen;
      if (stdout.isTTY) stdout.write('\x1b[3J');
    }
  }, [modalOpen, stdout]);

  // Hard cap the kanban row at 60% of terminal height so the dashboard
  // header (stage/elapsed/status) and footer (key hints) stay on screen even
  // when the board fills up with cards. Without this, a busy run pushes the
  // header off the top and the footer off the bottom, leaving the user with
  // no idea which keys do what or what stage they're on.
  //
  // The remaining 40% absorbs:
  //   • SystemMetricsBar rendered upstream by App (~1 row)
  //   • dashboard header and footer (1 row each)
  //   • drift when cardHeight() underestimates a wrapped card
  //   • terminal-scroll headroom so we never paint past the bottom edge
  const KANBAN_HEIGHT_RATIO = 0.6;
  // Floor of 5 keeps borders + title + at least one card row legible on
  // tiny terminals; anything smaller and the column collapses to noise.
  const maxKanbanRows = Math.max(5, Math.floor(terminalRows * KANBAN_HEIGHT_RATIO));

  // Per-column card budget = kanban row height minus column chrome:
  //   2 — round border (top + bottom)
  //   1 — column title row
  //   1 — marginTop=1 between title and the cards body
  //   1 — safety margin for cardHeight() underestimating a wrapped card
  // Math.max(3, …) keeps a single short card visible on cramped terminals.
  const KANBAN_COLUMN_CHROME_ROWS = 5;
  const maxCardRows = Math.max(3, maxKanbanRows - KANBAN_COLUMN_CHROME_ROWS);
  // Drop the log sidebar on cramped terminals so the kanban still has room to
  // breathe. Above the threshold the sidebar takes its fixed slice and the
  // kanban absorbs whatever's left.
  const showLogSidebar = terminalCols >= LOG_SIDEBAR_MIN_TERMINAL_COLS;

  const lastLogByAgent = useMemo(() => {
    const map = new Map<number, string>();
    if (!state) return map;
    for (const a of state.agents) {
      const last = a.logs[a.logs.length - 1];
      if (last) map.set(a.agentId, last);
    }
    return map;
  }, [state]);

  // Auto-focus first card if focused one disappears.
  useEffect(() => {
    if (!state) return;
    if (!focusedKey && state.agents[0]) {
      setFocusedKey(String(state.agents[0].agentId));
      return;
    }
    if (focusedKey && !state.agents.find((a) => String(a.agentId) === focusedKey)) {
      const first = state.agents[0];
      setFocusedKey(first ? String(first.agentId) : null);
    }
  }, [state, focusedKey]);

  const focusedAgent = useMemo(() => {
    if (!state || !focusedKey) return null;
    return state.agents.find((a) => String(a.agentId) === focusedKey) ?? null;
  }, [state, focusedKey]);

  // Refs feed the input handler so it stays referentially stable. Without
  // this, every state tick rebuilds the arrow function and Ink's useInput
  // reattaches its stdin listener — at high state churn, the unattached
  // window is wide enough to drop key events.
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  const retryAgentIdRef = useRef(retryAgentId);
  retryAgentIdRef.current = retryAgentId;
  const focusedKeyRef = useRef(focusedKey);
  focusedKeyRef.current = focusedKey;
  const stateRef = useRef(state);
  stateRef.current = state;

  const handleInput = useCallback(
    (
      input: string,
      key: { return: boolean; escape: boolean; upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean },
    ) => {
      dbump('input.RunDashboard');
      dlog('input', 'RunDashboard.useInput', {
        modalOpen: modalOpenRef.current,
        input,
        return: key.return,
        escape: key.escape,
        upArrow: key.upArrow,
        downArrow: key.downArrow,
        leftArrow: key.leftArrow,
        rightArrow: key.rightArrow,
      });
      if (modalOpenRef.current || retryAgentIdRef.current !== null) {
        // The modal / retry overlay owns its own input while open.
        return;
      }
      // Retry the focused failed card. Only meaningful while the run is held
      // open in `awaiting_retry`. A timed-out card opens a new-timeout overlay;
      // any other error re-runs immediately.
      if (input === 'r' || input === 'R') {
        const s = stateRef.current;
        if (s?.status !== 'awaiting_retry') return;
        const fid = focusedKeyRef.current ? Number(focusedKeyRef.current) : null;
        if (fid === null || Number.isNaN(fid)) return;
        const agent = s.agents.find((a) => a.agentId === fid);
        if (!agent || agent.state !== 'error') return;
        if (agent.errorKind === 'timeout') {
          setRetryAgentId(fid);
        } else {
          void orch.retryTask(fid);
        }
        return;
      }
      // Finish the run from the awaiting_retry hold (accept current state).
      if (input === 'd' || input === 'D') {
        if (stateRef.current?.status === 'awaiting_retry') orch.finish();
        return;
      }
      if (input === '+' || input === '=') {
        // Pin manual from any scaling mode (auto OR greedy) — otherwise the
        // per-tick target would immediately overwrite the bump.
        if (stateRef.current?.autoScale?.mode !== 'manual') {
          orch.disableAutoScale();
        }
        orch.increaseConcurrency();
        return;
      }
      if (input === '-' || input === '_') {
        if (stateRef.current?.autoScale?.mode !== 'manual') {
          orch.disableAutoScale();
        }
        orch.decreaseConcurrency();
        return;
      }
      if (input === 'q' || input === 'Q') {
        if (abortedRef.current) {
          onAbortRef.current();
          return;
        }
        abortedRef.current = true;
        setAborting(true);
        orch.abort();
        return;
      }
      if (input === 'f' || input === 'F') {
        // Toggle: focused agent → filter on; same agent → clear; no focus → clear.
        const focusedId = focusedKeyRef.current;
        const focusedAgentId = focusedId ? Number(focusedId) : null;
        setLogFilter((prev) => {
          if (focusedAgentId === null || Number.isNaN(focusedAgentId)) return null;
          return prev === focusedAgentId ? null : focusedAgentId;
        });
        return;
      }
      if (input === 'a' || input === 'A') {
        const s = stateRef.current;
        if (s?.autoScale?.enabled) {
          orch.disableAutoScale();
        } else {
          orch.enableAutoScale();
        }
        return;
      }
      if (input === 'm' || input === 'M') {
        // MAX (greedy): flood to the memory limit. Toggle back to auto.
        const s = stateRef.current;
        if (s?.autoScale?.mode === 'greedy') {
          orch.enableAutoScale();
        } else {
          orch.enableGreedyMode();
        }
        return;
      }
      if (key.return) {
        if (focusedKeyRef.current && stateRef.current?.agents.find((a) => String(a.agentId) === focusedKeyRef.current)) {
          setModalOpen(true);
        }
        return;
      }
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        navigateFocus(key, stateRef.current, focusedKeyRef.current, setFocusedKey);
      }
    },
    [orch],
  );

  useInput(handleInput);

  const handleModalClose = useCallback(() => setModalOpen(false), []);

  if (!state) {
    return (
      <Box flexDirection="column" width="100%">
        <Box
          borderStyle="round"
          borderColor={theme.ai}
          paddingX={1}
          paddingY={1}
          flexDirection="column"
          width="100%"
          alignItems="center"
        >
          <MorphLoader label={t('tui.dash.initializing')} />
        </Box>
      </Box>
    );
  }

  if (aborting) {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="yellow">{t('tui.dash.aborting_title')}</Text>
          <Box marginTop={1}>
            <Text dimColor>{t('tui.dash.aborting_body')}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{t('tui.dash.aborting_force')}</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="red" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="red">{t('tui.dash.error_title')}</Text>
          <Box marginTop={1}><Text>{error}</Text></Box>
          <Box marginTop={1}>
            <Text dimColor><Text bold>Q</Text> {t('common.action.quit')}</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (modalOpen && focusedAgent) {
    const candidate = pipeline.steps[focusedAgent.stageIndex];
    const stepPrompt =
      candidate && candidate.type !== 'check'
        ? (candidate.prompt ?? t('tui.dash.prompt_unavailable'))
        : candidate
        ? t('tui.dash.prompt_check', { name: candidate.name, condition: candidate.condition })
        : t('tui.dash.prompt_unavailable');
    return <RunModal agent={focusedAgent} stepPrompt={stepPrompt} onClose={handleModalClose} />;
  }

  if (retryAgentId !== null) {
    // Default the prompt to the pipeline's current single-file limit (most
    // per-file fan-outs are single-file); the user bumps it for the retry.
    const curMs = pipeline.singleFileCardTimeoutMs ?? pipeline.cardTimeoutMs ?? 300_000;
    const defaultMinutes = Math.max(1, Math.round(curMs / 60_000));
    return (
      <Box flexDirection="column" width="100%">
        <Box paddingX={1}>
          <Text dimColor>{t('tui.dash.retry_prompt', { id: retryAgentId })}</Text>
        </Box>
        <TimeoutPrompt
          defaultMinutes={defaultMinutes}
          onSubmit={(minutes) => {
            const id = retryAgentId;
            setRetryAgentId(null);
            void orch.retryTask(id, { timeoutMs: minutes * 60_000 });
          }}
          onCancel={() => setRetryAgentId(null)}
        />
      </Box>
    );
  }

  const elapsed = Math.floor(state.elapsedMs / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const providerLabel = config.provider === 'azure' ? 'Azure AI Foundry' : 'OpenRouter';

  return (
    <Box flexDirection="column" width="100%">
      {/*
        flexWrap lets the status items reflow onto a second line on narrow
        terminals instead of overflowing and "breaking" the header. Each
        metric is one <Text> unit so it wraps whole, and every value carries
        an explicit space after its label so "stage" and "5/5" never collide.
      */}
      <Box paddingX={1} width="100%" flexWrap="wrap">
        <MorphMark active={state.status !== 'done' && state.status !== 'error'} />
        <Text> </Text>
        <Text bold color="cyan">{pkg.name} v{pkg.version}</Text>
        <Text dimColor>{'  ·  '}</Text>
        <Text>{providerLabel}{' '}<Text bold color="cyan">{config.modelId}</Text></Text>
        <Text dimColor>{'  ·  '}</Text>
        <Text>{t('tui.dash.stage')}{' '}<Text bold>{state.currentStage}/{state.totalStages}</Text></Text>
        {state.wave !== undefined && (
          <>
            <Text dimColor>{'  ·  '}</Text>
            <Text>◇ {t('tui.dash.wave')}{' '}<Text bold color="cyanBright">{state.wave}</Text></Text>
          </>
        )}
        <Text dimColor>{'  ·  '}</Text>
        <Text>{t('tui.dash.concurrency')}{' '}<Text bold color="yellow">{state.concurrency}</Text></Text>
        <Text dimColor>{'  ·  '}</Text>
        <Text>{t('tui.dash.elapsed')}{' '}{mm}:{ss}</Text>
        <Text dimColor>{'  ·  '}</Text>
        <Text>{state.completedTasks}/{state.totalTasks}{' '}{t('tui.dash.done')}</Text>
        {/* Live spend: totalCost is already summed per emission in getState();
            the TUI simply never showed it, while the web header always has. */}
        {state.totalCost > 0 && (
          <>
            <Text dimColor>{'  ·  '}</Text>
            <Text>
              {t('tui.dash.cost')}{' '}
              <Text bold color="green">{formatCost(state.totalCost)}</Text>
            </Text>
          </>
        )}
        <Text dimColor>{`  ·  ${t('tui.dash.status')}: `}</Text>
        <Text
          bold
          color={
            state.status === 'done'
              ? 'green'
              : state.status === 'error'
              ? 'red'
              : state.status === 'awaiting_retry'
              ? 'yellow'
              : 'cyan'
          }
        >
          {translate(`run_status.${state.status}`)}
        </Text>
        {state.status !== 'error' && state.integrationStatus.conflicts.some((c) => !c.resolved) && (
          <>
            <Text dimColor>  ·  </Text>
            <Text bold color="yellow">{t('tui.dash.conflicts_unresolved')}</Text>
          </>
        )}
        {state.autoScale?.mode === 'greedy' && (
          <>
            <Text dimColor>  ·  </Text>
            <Text bold color={theme.info}>{t('tui.dash.mode_max')} {state.autoScale.state}</Text>
            <Text dimColor>  ·  </Text>
            <Text>
              {t('tui.dash.scaler_stats', {
                cpu: state.autoScale.cpuPercent,
                ram: state.autoScale.ramPercent,
                perAgent: state.autoScale.observedAgentMemoryMb,
                free: state.autoScale.ramAvailableMb,
              })}
              {state.autoScale.hostAvailableMb != null
                ? ` · ${t('tui.dash.scaler_host_free', { free: state.autoScale.hostAvailableMb })}`
                : ''}
              {state.autoScale.hostClampActive ? ` · ${t('tui.dash.scaler_host_limited')}` : ''}
              {state.autoScale.guardKillCount > 0
                ? ` · ${t('tui.dash.scaler_killed', { count: state.autoScale.guardKillCount })}`
                : ''}
            </Text>
          </>
        )}
        {state.autoScale?.enabled && (
          <>
            <Text dimColor>  ·  </Text>
            <Text bold color={
              state.autoScale.state === 'NORMAL' ? 'green' :
              state.autoScale.state === 'BACKING_OFF' ? 'yellow' :
              'red'
            }>
              {t('tui.dash.mode_auto')} {state.autoScale.state}
            </Text>
            <Text dimColor>  ·  </Text>
            <Text>
              {t('tui.dash.scaler_stats', {
                cpu: state.autoScale.cpuPercent,
                ram: state.autoScale.ramPercent,
                perAgent: state.autoScale.observedAgentMemoryMb,
                free: state.autoScale.ramAvailableMb,
              })}
              {state.autoScale.hostAvailableMb != null
                ? ` · ${t('tui.dash.scaler_host_free', { free: state.autoScale.hostAvailableMb })}`
                : ''}
              {state.autoScale.hostClampActive ? ` · ${t('tui.dash.scaler_host_limited')}` : ''}
            </Text>
          </>
        )}
        {state.autoScale && !state.autoScale.enabled && state.autoScale.mode !== 'greedy' && (
          <>
            <Text dimColor>  ·  </Text>
            <Text dimColor bold>{t('tui.dash.mode_guard')}</Text>
            {state.autoScale.guardKillCount > 0 && (
              <Text color="yellow"> {t('tui.dash.scaler_killed', { count: state.autoScale.guardKillCount })}</Text>
            )}
            <Text dimColor>{`  ·  ${t('tui.metrics.ram')} ${state.autoScale.ramPercent}%`}</Text>
          </>
        )}
      </Box>
      {/*
        Fixed-height row, not flexGrow, so the kanban can never push the
        footer off-screen no matter how many cards land in DOING/DONE.
        flexShrink=0 stops Ink from collapsing the row when its children
        report a smaller intrinsic size on the first frame.
      */}
      <Box flexDirection="row" height={maxKanbanRows} flexShrink={0}>
        <RunKanban
          agents={state.agents}
          pipeline={pipeline}
          defaultModelId={config.modelId}
          focusedKey={focusedKey}
          nowMs={nowMs}
          lastLogByAgent={lastLogByAgent}
          stageIntegrations={state.stageIntegrations}
          checkRuns={state.checkRuns}
          maxCardRows={maxCardRows}
        />
        {showLogSidebar && (
          <LogArea
            logs={state.logs}
            filterAgentId={logFilter}
            maxLines={maxCardRows}
            runStartedAt={state.startedAt || undefined}
            width={LOG_SIDEBAR_WIDTH}
          />
        )}
      </Box>
      <Box paddingX={1} width="100%">
        {state.status === 'awaiting_retry' ? (
          <Text dimColor>
            <Text bold color="yellow">
              {t('tui.dash.failed_count', {
                count: state.agents.filter((a) => a.state === 'error').length,
              })}
            </Text>{' '}
            · <Text bold>↑↓←→</Text> {t('common.action.navigate')} · <Text bold>R</Text>{' '}
            {t('tui.dash.hint_retry')} · <Text bold>D</Text> {t('tui.dash.hint_finish')} ·{' '}
            <Text bold>Q</Text> {t('common.action.abort')}
          </Text>
        ) : (
          <Text dimColor>
            <Text bold>+</Text>/<Text bold>-</Text> {t('tui.dash.hint_concurrency')} ·{' '}
            <Text bold>↑↓←→</Text> {t('common.action.navigate')} · <Text bold>ENTER</Text>{' '}
            {t('tui.dash.hint_details')} · <Text bold>F</Text>{' '}
            {t('tui.dash.hint_filter_logs', {
              scope: logFilter !== null ? `A${logFilter}` : t('tui.dash.filter_all'),
            })}{' '}
            · <Text bold>A</Text> {t('tui.dash.hint_autoscale')} · <Text bold>M</Text>{' '}
            {t('tui.dash.hint_max')} · <Text bold>Q</Text> {t('tui.dash.hint_abort')}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Thin adapter over the shared pure `nextFocusKey` — extracted to `src/lib` so
 * MultiRunDashboard navigates by the identical rules.
 */
function navigateFocus(
  key: { upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean },
  state: OrchestratorState | null,
  currentKey: string | null,
  setFocusedKey: (k: string | null) => void,
): void {
  const next = nextFocusKey(key, state?.agents, currentKey);
  if (next !== null) setFocusedKey(next);
}
