import React from 'react';
import { Box, Text } from 'ink';
import type { AgentStatus, CheckRun, Pipeline, StageIntegration } from '../../lib/types.js';
import { substituteFileInTitle } from '../../lib/title-format.js';
import { theme } from '../theme.js';

// In-house kanban renderer. Replaces `ink-kanban-board` to keep the run
// dashboard free of third-party setIntervals and duplicate `useInput`
// registrations that previously starved Ink's stdin pipeline (every
// keypress, including Ctrl+C, was getting dropped).
//
// Rules of the renderer:
//   • Pure function of props. No setState, no setInterval, no useEffect.
//   • No `useInput` here — the dashboard owns the single input handler.
//   • Wrapped in React.memo at the bottom so unrelated dashboard state
//     (modal toggle, system metrics tick) doesn't redraw the board.
//   • Every "ticking" value (elapsed time, etc.) is derived from `nowMs`
//     passed in by the parent on its throttled cadence.

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE_TO_COLOR: Record<Tone, string> = {
  neutral: 'gray',
  accent: 'cyan',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
};

interface CardStatus {
  label: string;
  color: string;
}

interface BoardCard {
  key: string;
  title: string;
  subtitle?: string;
  status: CardStatus;
  branchShort?: string;
  modelShort?: string;
  filesModifiedCount: number;
  errorLine?: string;
  lastLog?: string;
  /** Formatted per-action counters (e.g. `stream:8 tool:7 done:1`). */
  actionsLabel?: string;
  /** Most recent action name, merged onto the log line as `→ <action>`. */
  lastAction?: string;
  startedAt?: number;
  finishedAt?: number;
}

interface BoardColumn {
  key: string;
  title: string;
  tone: Tone;
  cards: BoardCard[];
}

function lifecycleStatus(s: AgentStatus): CardStatus {
  if (s.state === 'error' && s.errorKind === 'timeout')
    return { label: 'TIMEOUT', color: 'yellow' };
  if (s.state === 'error') return { label: 'FAILED', color: 'red' };
  if (s.state === 'done' && s.phase === 'done') return { label: 'DONE', color: 'green' };
  if (s.state === 'streaming' || s.state === 'tool_running') {
    return { label: 'RUNNING', color: 'cyan' };
  }
  if (
    s.phase === 'finalizing' ||
    s.phase === 'committing' ||
    s.phase === 'cleaning_up' ||
    s.phase === 'pushing'
  ) {
    return { label: s.phase.toUpperCase(), color: 'cyan' };
  }
  if (s.phase === 'no_changes') return { label: 'NO CHANGES', color: 'yellow' };
  return { label: 'PENDING', color: 'gray' };
}

function pickColumn(s: AgentStatus): 'todo' | 'doing' | 'done' {
  if (s.state === 'error') return 'done';
  if (s.state === 'done' && s.phase === 'done') return 'done';
  if (s.phase === 'no_changes') return 'done';
  if (s.phase === 'pending') return 'todo';
  return 'doing';
}

// `theme.ai` is allowed here ONLY for conflict_resolving — the LLM resolver
// is AI-driven UI; the deterministic merge stays cyan per the theme rule.
function integrationStatus(e: StageIntegration): CardStatus {
  switch (e.phase) {
    case 'pending':
      return { label: 'PENDING', color: 'gray' };
    case 'merging':
      return { label: 'MERGING', color: 'cyan' };
    case 'conflict_resolving':
      return { label: 'AI RESOLVE', color: theme.ai };
    case 'done':
      return { label: 'MERGED', color: 'green' };
    case 'skipped':
      return { label: 'SKIPPED', color: 'yellow' };
    case 'error':
      return { label: 'FAILED', color: 'red' };
  }
}

function pickIntegrationColumn(e: StageIntegration): 'todo' | 'doing' | 'done' {
  if (e.phase === 'pending') return 'todo';
  if (e.phase === 'merging' || e.phase === 'conflict_resolving') return 'doing';
  return 'done';
}

// `theme.ai` for the deliberating judge — the check evaluator is an LLM
// agent, i.e. AI-driven UI per the theme rule.
function checkStatus(e: CheckRun): CardStatus {
  switch (e.phase) {
    case 'judging':
      return { label: 'JUDGING', color: theme.ai };
    case 'done':
      return e.fromJudge
        ? { label: (e.outcomeLabel ?? 'DONE').toUpperCase(), color: 'green' }
        : { label: `DEFAULT: ${e.outcomeLabel ?? '?'}`, color: 'yellow' };
    case 'error':
      return { label: 'FAILED', color: 'red' };
  }
}

function pickCheckColumn(e: CheckRun): 'todo' | 'doing' | 'done' {
  return e.phase === 'judging' ? 'doing' : 'done';
}

function buildCheckCard(e: CheckRun): BoardCard {
  const modelShort = e.modelId.includes('/') ? e.modelId.split('/').pop() : e.modelId;
  const subtitle =
    e.phase === 'done' && e.reason
      ? `[check] ${truncate(e.reason, 38)}`
      : `[check] ${truncate(e.condition, 38)}`;
  return {
    key: `check-${e.visitIndex}`,
    title: `judge: ${truncate(substituteFileInTitle(e.stepName, null), 22)}${e.runs > 1 ? ` ×${e.runs}` : ''}`,
    subtitle,
    status: checkStatus(e),
    branchShort: undefined,
    modelShort: modelShort ?? undefined,
    filesModifiedCount: 0,
    errorLine: e.error ? truncate(e.error, 80) : undefined,
    lastLog: e.lastLog ? truncate(e.lastLog, 80) : undefined,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
  };
}

function buildIntegrationCard(e: StageIntegration, isOverride: boolean): BoardCard {
  const modelShort = e.modelId.includes('/') ? e.modelId.split('/').pop() : e.modelId;
  const total = e.branchesMerged.length + e.branchesPending.length;
  const subtitle =
    e.phase === 'pending'
      ? '[merge] waiting for stage agents'
      : `[merge] ${e.branchesMerged.length}/${total} branches · ${e.conflicts.length} conflicts`;
  return {
    key: `merge-${e.visitIndex}`,
    title: `merge: ${truncate(substituteFileInTitle(e.stageName, null), 22)}${e.runs > 1 ? ` ×${e.runs}` : ''}`,
    subtitle,
    status: integrationStatus(e),
    branchShort: undefined,
    modelShort: modelShort ? `${modelShort}${isOverride ? ' (int)' : ''}` : undefined,
    filesModifiedCount: 0,
    errorLine: e.error ? truncate(e.error, 80) : undefined,
    lastLog: e.lastLog ? truncate(e.lastLog, 80) : undefined,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtClock(epoch: number): string {
  const d = new Date(epoch);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Fixed display order for the per-action counters label. Action names not
// listed here (future event types) are appended after, in map order. Keep the
// names in sync with `actionName()` in orchestrator/index.ts.
const ACTION_ORDER = ['stream', 'tool', 'file', 'log', 'usage', 'done', 'error'];

/** `{ stream: 8, tool: 7 }` → `"stream:8 tool:7"`; undefined when empty. */
function formatActionCounts(counts: Record<string, number> | undefined): string | undefined {
  if (!counts) return undefined;
  const keys = Object.keys(counts);
  if (keys.length === 0) return undefined;
  const known = ACTION_ORDER.filter((k) => counts[k]);
  const extra = keys.filter((k) => !ACTION_ORDER.includes(k));
  return [...known, ...extra].map((k) => `${k}:${counts[k] ?? 0}`).join(' ');
}

// Semantic color for the most-recent-action token. NOT AI-driven UI, so no
// theme.ai (magenta) — it maps to the same status palette the cards already use.
function actionColor(action: string): string {
  if (action === 'error') return 'red';
  if (action === 'done') return 'green';
  if (action === 'stream' || action === 'tool') return 'cyan';
  return 'gray';
}

function buildCard(
  agent: AgentStatus,
  effectiveModelId: string,
  isOverride: boolean,
  lastLog: string | undefined,
): BoardCard {
  const status = lifecycleStatus(agent);
  const branchShort = agent.branchName
    ? agent.branchName.split('/').slice(-1)[0]
    : undefined;
  const modelShort = effectiveModelId.includes('/')
    ? effectiveModelId.split('/').pop()
    : effectiveModelId;
  const fileLabel = agent.currentFile ?? '(rodada livre)';
  // Resolve the `$file` fan-out token to the worked file's name so the user
  // never sees a literal "$file" in the card (per-file/memory steps only).
  const displayStage = substituteFileInTitle(agent.stageName, agent.currentFile);
  const subtitle = `[${displayStage}] ${truncate(fileLabel, 32)}`;
  const log = lastLog ?? agent.logs[agent.logs.length - 1];

  const retryBadge = agent.attempt && agent.attempt > 1 ? ' (retry)' : '';
  // Memory-guard requeues go in the TITLE, not a new line — cardHeight()
  // budgets packCards by rendered rows and must stay in sync.
  const requeueBadge = agent.requeues && agent.requeues > 0 ? ` ↻${agent.requeues}` : '';
  return {
    key: String(agent.agentId),
    title: `#${agent.agentId} ${truncate(displayStage, 24)}${
      isOverride ? ' (step)' : ''
    }${retryBadge}${requeueBadge}`,
    subtitle,
    status,
    branchShort,
    modelShort,
    filesModifiedCount: agent.filesModified.length,
    errorLine: agent.error ? truncate(agent.error, 80) : undefined,
    lastLog: log ? truncate(log, 80) : undefined,
    actionsLabel: formatActionCounts(agent.actionCounts),
    lastAction: agent.lastAction,
    startedAt: agent.startedAt,
    finishedAt: agent.finishedAt,
  };
}

export interface RunKanbanProps {
  agents: ReadonlyArray<AgentStatus>;
  pipeline: Pipeline;
  defaultModelId: string;
  focusedKey: string | null;
  /** Snapshot of "now" in ms, supplied by the parent on its throttled tick. */
  nowMs: number;
  /** Last log per agent, pre-computed by the dashboard. */
  lastLogByAgent: ReadonlyMap<number, string>;
  /**
   * Per-stage merge history. Each entry renders as a display-only card
   * (key `merge-<visitIndex>`, never focusable) so the board keeps moving
   * during `status === 'integrating'`.
   */
  stageIntegrations?: ReadonlyArray<StageIntegration>;
  /**
   * Per-check-visit judge history. Each entry renders as a display-only
   * card (key `check-<visitIndex>`, never focusable) — DOING while the
   * judge deliberates, DONE with the chosen outcome label.
   */
  checkRuns?: ReadonlyArray<CheckRun>;
  /**
   * Maximum rows of card content the column body may render. The board
   * subtracts column chrome (border + title + margin) and overall page chrome
   * (header/footer/metrics bar) before passing this in. When a column would
   * exceed it, cards outside the visible window are replaced by a "↑/↓ N more"
   * hint so the board itself never spills past the terminal viewport.
   */
  maxCardRows: number;
}

function RunKanbanInner({
  agents,
  pipeline,
  defaultModelId,
  focusedKey,
  nowMs,
  lastLogByAgent,
  stageIntegrations,
  checkRuns,
  maxCardRows,
}: RunKanbanProps): React.JSX.Element {
  const todo: BoardCard[] = [];
  const doing: BoardCard[] = [];
  const done: BoardCard[] = [];

  for (const agent of agents) {
    const override = pipeline.steps[agent.stageIndex]?.modelId;
    const effective = override ?? defaultModelId;
    const card = buildCard(
      agent,
      effective,
      Boolean(override),
      lastLogByAgent.get(agent.agentId),
    );
    const col = pickColumn(agent);
    if (col === 'todo') todo.push(card);
    else if (col === 'doing') doing.push(card);
    else done.push(card);
  }

  // Merge cards go after the agent cards of each column so packCards (which
  // anchors on the last card when nothing is focused) keeps the active merge
  // visible while the stage integrates.
  for (const entry of stageIntegrations ?? []) {
    const card = buildIntegrationCard(entry, Boolean(pipeline.integrationModelId));
    const col = pickIntegrationColumn(entry);
    if (col === 'todo') todo.push(card);
    else if (col === 'doing') doing.push(card);
    else done.push(card);
  }

  // Judge cards last — same packCards anchoring rationale as merges.
  for (const entry of checkRuns ?? []) {
    const card = buildCheckCard(entry);
    const col = pickCheckColumn(entry);
    if (col === 'doing') doing.push(card);
    else done.push(card);
  }

  const columns: BoardColumn[] = [
    { key: 'todo', title: 'TODO', tone: 'neutral', cards: todo },
    { key: 'doing', title: 'DOING', tone: 'accent', cards: doing },
    { key: 'done', title: 'DONE', tone: 'success', cards: done },
  ];

  return (
    <Box flexDirection="row" flexGrow={1}>
      {columns.map((col) => (
        <Column
          key={col.key}
          column={col}
          focusedKey={focusedKey}
          nowMs={nowMs}
          maxCardRows={maxCardRows}
        />
      ))}
    </Box>
  );
}

export const RunKanban = React.memo(RunKanbanInner);

interface ColumnProps {
  column: BoardColumn;
  focusedKey: string | null;
  nowMs: number;
  maxCardRows: number;
}

function Column({ column, focusedKey, nowMs, maxCardRows }: ColumnProps): React.JSX.Element {
  const color = TONE_TO_COLOR[column.tone];
  const packed = packCards(column.cards, maxCardRows, focusedKey);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      flexGrow={1}
      flexBasis={0}
      marginRight={1}
    >
      <Text bold color={color}>
        {column.title} ({column.cards.length})
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {column.cards.length === 0 ? (
          <Text dimColor>—</Text>
        ) : (
          <>
            {packed.hiddenAbove > 0 && (
              <Text dimColor>↑ {packed.hiddenAbove} more</Text>
            )}
            {packed.visible.map((card) => (
              <Card
                key={card.key}
                card={card}
                focused={card.key === focusedKey}
                nowMs={nowMs}
              />
            ))}
            {packed.hiddenBelow > 0 && (
              <Text dimColor>↓ {packed.hiddenBelow} more</Text>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

// Card height matches what `Card` actually renders below: 2 rows of border
// frame the content, then 1 row each for whatever fields are populated. Keep
// this in sync with `Card` — packCards uses the value to budget terminal rows.
function cardHeight(card: BoardCard): number {
  let lines = 1; // title row is always present
  if (card.subtitle) lines += 1;
  const hasMeta =
    Boolean(card.branchShort) || Boolean(card.modelShort) || card.filesModifiedCount > 0;
  if (hasMeta) lines += 1;
  if (card.errorLine) lines += 1;
  if (card.startedAt) lines += 1;
  if (card.actionsLabel) lines += 1; // per-action counters row
  lines += 1; // `log:` / `→ action` row is always rendered (shows '—' when empty)
  return lines + 2; // top + bottom border
}

interface PackedColumn {
  visible: BoardCard[];
  hiddenAbove: number;
  hiddenBelow: number;
}

// Decide which contiguous slice of `cards` fits into `maxRows`. The slice is
// anchored on the focused card (so navigating into a hidden card brings it
// into view) or, when focus is in another column, on the last card so the most
// recent activity stays visible. Expansion prefers downward (more recent) and
// dynamically reclaims rows from the indicator reservation when one end is
// already exhausted.
function packCards(
  cards: ReadonlyArray<BoardCard>,
  maxRows: number,
  focusedKey: string | null,
): PackedColumn {
  if (cards.length === 0) {
    return { visible: [], hiddenAbove: 0, hiddenBelow: 0 };
  }
  const heights = cards.map(cardHeight);
  const total = heights.reduce((a, b) => a + b, 0);
  if (total <= maxRows) {
    return { visible: [...cards], hiddenAbove: 0, hiddenBelow: 0 };
  }

  let anchor = cards.findIndex((c) => c.key === focusedKey);
  if (anchor === -1) anchor = cards.length - 1;

  let lo = anchor;
  let hi = anchor;
  let used = heights[anchor]!;

  while (true) {
    const showAboveInd = lo > 0;
    const showBelowInd = hi < cards.length - 1;
    const remaining = maxRows - used - (showAboveInd ? 1 : 0) - (showBelowInd ? 1 : 0);
    if (remaining <= 0) break;

    const downH = hi + 1 < cards.length ? heights[hi + 1]! : Infinity;
    const upH = lo - 1 >= 0 ? heights[lo - 1]! : Infinity;
    const canDown = downH <= remaining;
    const canUp = upH <= remaining;
    if (!canDown && !canUp) break;

    if (canDown) {
      hi += 1;
      used += downH;
    } else {
      lo -= 1;
      used += upH;
    }
  }

  return {
    visible: cards.slice(lo, hi + 1),
    hiddenAbove: lo,
    hiddenBelow: cards.length - 1 - hi,
  };
}

interface CardProps {
  card: BoardCard;
  focused: boolean;
  nowMs: number;
}

function Card({ card, focused, nowMs }: CardProps): React.JSX.Element {
  const borderColor = focused ? 'cyanBright' : card.status.color;
  const borderStyle = focused ? 'bold' : 'single';

  const timeLine = card.startedAt
    ? `${fmtClock(card.startedAt)}→${fmtClock(card.finishedAt ?? nowMs)}`
    : null;

  const metaParts: string[] = [];
  if (card.branchShort) metaParts.push(`🔀 ${card.branchShort}`);
  if (card.modelShort) metaParts.push(`🧠 ${card.modelShort}`);
  if (card.filesModifiedCount > 0) metaParts.push(`${card.filesModifiedCount} file(s)`);

  return (
    <Box flexDirection="column" borderStyle={borderStyle} borderColor={borderColor} paddingX={1}>
      <Box>
        <Text bold color="cyan">
          {truncate(card.title, 40)}
        </Text>
        <Text color={card.status.color}> {card.status.label}</Text>
      </Box>
      {card.subtitle && <Text wrap="truncate-end">{card.subtitle}</Text>}
      {metaParts.length > 0 && (
        <Text color="gray" wrap="truncate-end">
          {metaParts.join(' · ')}
        </Text>
      )}
      {card.errorLine && (
        <Text color="red" wrap="truncate-end">
          {card.errorLine}
        </Text>
      )}
      {timeLine && (
        <Text color="gray" dimColor>
          {timeLine}
        </Text>
      )}
      {card.actionsLabel && (
        <Text color="gray" wrap="truncate-end">
          {card.actionsLabel}
        </Text>
      )}
      {/* Most recent action (`→ name`, colored) leads the pi telemetry line.
          The `log:` prefix only shows before any action has been recorded. */}
      <Text color="gray" dimColor wrap="truncate-end">
        {card.lastAction ? (
          <>
            <Text color={actionColor(card.lastAction)}>→ {card.lastAction}</Text>
            {card.lastLog ? ` · ${card.lastLog}` : ''}
          </>
        ) : (
          `log: ${card.lastLog ?? '—'}`
        )}
      </Text>
    </Box>
  );
}
