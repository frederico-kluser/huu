import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { AgentStatus } from '../../lib/types.js';

// In-house agent detail modal. Replaces the previous ink-kanban-board
// `CardDetailModal` so the run path has zero dependency on third-party
// ink components — everything is plain Box/Text and a single useInput.
//
// Sizing contract: the modal MUST never exceed the terminal viewport. We
// flatten the body into a list of one-row entries and slice it by a scroll
// offset, so the bordered frame stays within `rows × cols` regardless of
// prompt length, file count, or log volume.
//
// Keys:
//   ↑/↓        scroll the body by 1 row
//   PgUp/PgDn  scroll by a viewport
//   g / G      jump to top / bottom (auto-follow re-engages at bottom)
//   Esc / Q    close

interface Props {
  agent: AgentStatus;
  stepPrompt: string;
  onClose: () => void;
}

interface BodyLine {
  key: string;
  node: React.ReactNode;
}

// Rows the modal occupies regardless of body content.
//   2 = top + bottom border
//   1 = title row
//   1 = footer key-hint row
const CHROME_ROWS = 4;
// Rows reserved OUTSIDE the modal frame that the modal cannot use:
//   1 = SystemMetricsBar (App always paints it above the modal)
//   1 = safety margin so a single-row estimation drift can't push the bottom
//       border past the viewport. If it does, Ink's log-update loses track
//       of the row count and leaves stale modal lines on screen when the
//       modal closes ("sujeira"). Keep this >= 1 unless the App layout
//       changes to remove SystemMetricsBar.
const EXTERNAL_CHROME_ROWS = 2;
const MIN_BODY_ROWS = 5;

function useTerminalSize(): { rows: number; cols: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => ({
    rows: stdout.rows ?? 24,
    cols: stdout.columns ?? 80,
  }));
  useEffect(() => {
    if (!stdout.isTTY) return;
    const onResize = (): void => {
      setSize({ rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return size;
}

// Word-wrap that respects existing newlines and breaks on whitespace when
// possible, falling back to hard-cut for unbroken runs (long URLs, paths).
function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      out.push('');
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(' ', width);
      if (breakAt <= 0) breakAt = width;
      out.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).replace(/^\s+/, '');
    }
    out.push(remaining);
  }
  return out;
}

function stateColor(state: AgentStatus['state']): string {
  if (state === 'done') return 'green';
  if (state === 'error') return 'red';
  if (state === 'streaming') return 'cyan';
  if (state === 'tool_running') return 'yellow';
  return 'gray';
}

type TimelineStatus = 'pending' | 'active' | 'done' | 'error';

function timelineEntries(
  agent: AgentStatus,
): Array<{ key: string; label: string; status: TimelineStatus }> {
  const reachedDone = agent.phase === 'done' && agent.state === 'done';
  const isError = agent.state === 'error';
  const reachedRunning =
    reachedDone ||
    isError ||
    agent.state === 'streaming' ||
    agent.state === 'tool_running' ||
    [
      'finalizing',
      'validating',
      'committing',
      'pushing',
      'cleaning_up',
    ].includes(agent.phase);

  return [
    { key: 'created', label: 'Created', status: 'done' },
    {
      key: 'running',
      label: 'Running',
      status: isError ? 'error' : reachedDone ? 'done' : reachedRunning ? 'active' : 'pending',
    },
    {
      key: 'final',
      label: isError ? 'Failed' : reachedDone ? (agent.commitSha ? 'Merged' : 'Done') : 'Pending',
      status: isError ? 'error' : reachedDone ? 'done' : 'pending',
    },
  ];
}

function statusIcon(status: TimelineStatus): { glyph: string; color: string } {
  if (status === 'done') return { glyph: '✓', color: 'green' };
  if (status === 'active') return { glyph: '◆', color: 'cyan' };
  if (status === 'error') return { glyph: '✗', color: 'red' };
  return { glyph: '○', color: 'gray' };
}

function formatElapsed(agent: AgentStatus, nowMs: number): string {
  if (!agent.startedAt) return '--:--';
  const end = agent.finishedAt ?? nowMs;
  const secs = Math.max(0, Math.floor((end - agent.startedAt) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function RunModal({ agent, stepPrompt, onClose }: Props): React.JSX.Element {
  const { rows: termRows, cols: termCols } = useTerminalSize();
  // Effective body width inside the bordered frame: cols - 2 (border) - 2 (paddingX).
  const contentWidth = Math.max(20, termCols - 4);
  const bodyRows = Math.max(
    MIN_BODY_ROWS,
    termRows - CHROME_ROWS - EXTERNAL_CHROME_ROWS,
  );

  // Tick once a second to refresh the elapsed timer while the agent is live.
  // Stops as soon as the agent is finished so an idle modal does no work.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (agent.finishedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    id.unref?.();
    return () => clearInterval(id);
  }, [agent.finishedAt]);

  const lines: BodyLine[] = useMemo(() => {
    const out: BodyLine[] = [];
    const sectionHeader = (label: string, key: string): void => {
      out.push({
        key: `sh-${key}`,
        node: (
          <Text>
            <Text color="cyan">▌ </Text>
            <Text bold color="cyan">{label.toUpperCase()}</Text>
          </Text>
        ),
      });
    };
    const blank = (key: string): void => {
      out.push({ key: `bk-${key}`, node: <Text> </Text> });
    };

    const elapsed = formatElapsed(agent, nowMs);
    const tokenInfo = `${agent.tokensIn}↓ ${agent.tokensOut}↑`;

    sectionHeader('Status', 'status');
    out.push({
      key: 'status-row',
      node: (
        <Box>
          <Text bold color={stateColor(agent.state)}>● {agent.state}</Text>
          <Text dimColor>  · phase </Text>
          <Text>{agent.phase}</Text>
          <Text dimColor>  · </Text>
          <Text>{elapsed}</Text>
          <Text dimColor>  · tokens </Text>
          <Text>{tokenInfo}</Text>
          {agent.cost > 0 && (
            <React.Fragment>
              <Text dimColor>  · cost </Text>
              <Text color="yellow">${agent.cost.toFixed(4)}</Text>
            </React.Fragment>
          )}
        </Box>
      ),
    });
    if (agent.currentFile) {
      out.push({
        key: 'current-file',
        node: (
          <Text wrap="truncate-end">
            <Text dimColor>  on </Text>
            {agent.currentFile}
          </Text>
        ),
      });
    }

    blank('1');
    sectionHeader('Timeline', 'timeline');
    const timeline = timelineEntries(agent);
    out.push({
      key: 'timeline-row',
      node: (
        <Box>
          {timeline.map((step, idx) => {
            const icon = statusIcon(step.status);
            return (
              <React.Fragment key={step.key}>
                <Text color={icon.color}>{icon.glyph}</Text>
                <Text> {step.label}</Text>
                {idx < timeline.length - 1 && <Text dimColor>  →  </Text>}
              </React.Fragment>
            );
          })}
        </Box>
      ),
    });

    blank('2');
    sectionHeader('Git', 'git');
    out.push({
      key: 'git-branch',
      node: (
        <Text wrap="truncate-end">
          <Text dimColor>  branch   </Text>
          {agent.branchName ?? <Text dimColor>(pending)</Text>}
        </Text>
      ),
    });
    out.push({
      key: 'git-wt',
      node: (
        <Text wrap="truncate-end">
          <Text dimColor>  worktree </Text>
          {agent.worktreePath ?? <Text dimColor>(pending)</Text>}
        </Text>
      ),
    });
    out.push({
      key: 'git-commit',
      node: (
        <Text wrap="truncate-end">
          <Text dimColor>  commit   </Text>
          {agent.commitSha ?? <Text dimColor>(none)</Text>}
        </Text>
      ),
    });
    out.push({
      key: 'git-stage',
      node: (
        <Text wrap="truncate-end">
          <Text dimColor>  stage    </Text>
          {agent.stageIndex + 1} — {agent.stageName}
        </Text>
      ),
    });

    blank('3');
    sectionHeader('Task prompt', 'prompt');
    const promptLines = wrapText(stepPrompt, contentWidth - 2);
    promptLines.forEach((l, i) =>
      out.push({
        key: `prompt-${i}`,
        node: <Text>  {l.length > 0 ? l : ' '}</Text>,
      }),
    );

    if (agent.filesModified.length > 0) {
      blank('4');
      sectionHeader(`Files modified (${agent.filesModified.length})`, 'files');
      const FILE_LIMIT = 50;
      agent.filesModified.slice(0, FILE_LIMIT).forEach((f) =>
        out.push({
          key: `file-${f}`,
          node: (
            <Text wrap="truncate-end">
              <Text color="green">  • </Text>
              {f}
            </Text>
          ),
        }),
      );
      if (agent.filesModified.length > FILE_LIMIT) {
        out.push({
          key: 'file-overflow',
          node: <Text dimColor>  … and {agent.filesModified.length - FILE_LIMIT} more</Text>,
        });
      }
    }

    if (agent.error) {
      blank('5');
      sectionHeader('Error', 'error');
      const errLines = wrapText(agent.error, contentWidth - 2);
      errLines.forEach((l, i) =>
        out.push({
          key: `err-${i}`,
          node: <Text color="red">  {l.length > 0 ? l : ' '}</Text>,
        }),
      );
    }

    blank('6');
    sectionHeader(`Runtime logs (${agent.logs.length})`, 'logs');
    if (agent.logs.length === 0) {
      out.push({ key: 'logs-empty', node: <Text dimColor>  waiting for logs…</Text> });
    } else {
      agent.logs.forEach((line, i) =>
        out.push({
          key: `log-${i}`,
          node: (
            <Text wrap="truncate-end">
              <Text dimColor>  </Text>
              {line}
            </Text>
          ),
        }),
      );
    }

    return out;
  }, [agent, stepPrompt, contentWidth, nowMs]);

  const totalLines = lines.length;
  const maxScroll = Math.max(0, totalLines - bodyRows);

  // Initial position: pinned to the bottom so the latest logs are visible the
  // moment the modal opens. `g` jumps back to the metadata at the top.
  const [scrollTop, setScrollTop] = useState<number>(maxScroll);
  const followTailRef = useRef(true);

  // When new lines arrive (mostly logs), keep us pinned to the bottom IF the
  // user hasn't scrolled up. Otherwise just clamp in case content shrank.
  useEffect(() => {
    if (followTailRef.current) {
      setScrollTop(maxScroll);
    } else {
      setScrollTop((prev) => Math.min(prev, maxScroll));
    }
  }, [maxScroll]);

  useInput((input, key) => {
    if (key.escape || input === 'q' || input === 'Q') {
      onClose();
      return;
    }
    const apply = (next: number): void => {
      const clamped = Math.max(0, Math.min(maxScroll, next));
      followTailRef.current = clamped >= maxScroll;
      setScrollTop(clamped);
    };
    if (key.upArrow) apply(scrollTop - 1);
    else if (key.downArrow) apply(scrollTop + 1);
    else if (key.pageUp) apply(scrollTop - bodyRows);
    else if (key.pageDown) apply(scrollTop + bodyRows);
    else if (input === 'g') apply(0);
    else if (input === 'G') apply(maxScroll);
  });

  const visible = lines.slice(scrollTop, scrollTop + bodyRows);
  // Pad the viewport with blank rows so the footer's vertical position never
  // jumps when the body is shorter than `bodyRows` (e.g. fresh agent, no logs).
  const padding = Math.max(0, bodyRows - visible.length);

  const isRunning = agent.state !== 'done' && agent.state !== 'error';
  const lastVisible = Math.min(totalLines, scrollTop + bodyRows);
  const scrollLabel =
    totalLines <= bodyRows
      ? 'all'
      : `${scrollTop + 1}–${lastVisible} / ${totalLines}`;
  const followLabel = followTailRef.current && totalLines > bodyRows ? ' · follow' : '';

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        flexDirection="column"
        width="100%"
      >
        <Box justifyContent="space-between" width="100%">
          <Text wrap="truncate-end">
            <Text bold color="cyan">agent #{agent.agentId}</Text>
            <Text dimColor>  ·  </Text>
            <Text>{agent.stageName}</Text>
          </Text>
          <Text>
            <Text dimColor>{scrollLabel}{followLabel}</Text>
            <Text dimColor>  ·  </Text>
            <Text color={isRunning ? 'cyan' : 'gray'}>
              {isRunning ? '● live' : '○ stopped'}
            </Text>
          </Text>
        </Box>

        <Box flexDirection="column">
          {visible.map((l) => (
            <Box key={l.key}>{l.node}</Box>
          ))}
          {Array.from({ length: padding }, (_, i) => (
            <Text key={`pad-${i}`}> </Text>
          ))}
        </Box>

        <Box width="100%">
          <Text dimColor wrap="truncate-end">
            <Text bold>↑↓</Text> scroll · <Text bold>PgUp/PgDn</Text> page · <Text bold>g/G</Text> top/bottom · <Text bold>ESC</Text> close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
