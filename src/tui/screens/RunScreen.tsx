// Run progress screen — shows task execution with real-time updates
// Replaces text-based output from run.ts with proper Ink UI

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { Logo } from '../components/Logo.js';
import { Divider } from '../components/Divider.js';
import { Panel } from '../components/Panel.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { KeyHint } from '../components/KeyHint.js';

export type RunPhase =
  | 'preparing'
  | 'initializing'
  | 'spawning'
  | 'running'
  | 'merging'
  | 'done'
  | 'failed';

export interface RunLogEntry {
  id: string;
  message: string;
  level: 'info' | 'success' | 'warn' | 'error' | 'step';
  timestamp: string;
}

export interface RunMetrics {
  runId: string;
  agentName: string;
  filesChanged: string[];
  inputTokens: number;
  outputTokens: number;
  turns: number;
  durationMs: number;
  commitSha: string | null;
  mergeOutcome: string | null;
  mergeTier: string | null;
}

interface RunScreenProps {
  taskDescription: string;
  phase: RunPhase;
  logs: RunLogEntry[];
  metrics: RunMetrics | null;
  error: string | null;
  onExit: () => void;
}

const PHASE_LABELS: Record<RunPhase, string> = {
  preparing: 'Preparing environment...',
  initializing: 'Initializing database and infrastructure...',
  spawning: 'Spawning builder agent...',
  running: 'Agent is working...',
  merging: 'Merging changes...',
  done: 'Task completed!',
  failed: 'Task failed',
};

const PHASE_ICONS: Record<RunPhase, React.ReactNode> = {
  preparing: <Text color="yellow"><Spinner type="dots" /></Text>,
  initializing: <Text color="yellow"><Spinner type="dots" /></Text>,
  spawning: <Text color="cyan"><Spinner type="dots" /></Text>,
  running: <Text color="green"><Spinner type="dots" /></Text>,
  merging: <Text color="magenta"><Spinner type="dots" /></Text>,
  done: <Text color="green">{'\u2714'}</Text>,
  failed: <Text color="red">{'\u2716'}</Text>,
};

function PhaseIndicator({ phase }: { phase: RunPhase }): React.JSX.Element {
  const phases: RunPhase[] = ['preparing', 'initializing', 'spawning', 'running', 'merging', 'done'];
  const currentIdx = phases.indexOf(phase === 'failed' ? 'done' : phase);

  return (
    <Box gap={1}>
      {phases.map((p, i) => {
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isFailed = phase === 'failed' && isCurrent;

        return (
          <Box key={p} gap={0}>
            {isDone ? (
              <Text color="green">{'\u2714'}</Text>
            ) : isFailed ? (
              <Text color="red">{'\u2716'}</Text>
            ) : isCurrent ? (
              <Text color="cyan"><Spinner type="dots" /></Text>
            ) : (
              <Text dimColor>{'\u25CB'}</Text>
            )}
            <Text
              color={isDone ? 'green' : isCurrent ? 'cyan' : 'gray'}
              bold={isCurrent}
              dimColor={!isDone && !isCurrent}
            >
              {' '}{p}
            </Text>
            {i < phases.length - 1 && <Text dimColor> {'\u2500'} </Text>}
          </Box>
        );
      })}
    </Box>
  );
}

function LogLevelColor({ level }: { level: RunLogEntry['level'] }): string {
  switch (level) {
    case 'success': return 'green';
    case 'error': return 'red';
    case 'warn': return 'yellow';
    case 'step': return 'cyan';
    default: return 'white';
  }
}

export function RunScreen({
  taskDescription,
  phase,
  logs,
  metrics,
  error,
  onExit,
}: RunScreenProps): React.JSX.Element {
  const isDone = phase === 'done' || phase === 'failed';

  useInput((input, key) => {
    if (isDone && (input === 'q' || key.escape || key.return)) {
      onExit();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box>
        <Logo compact />
        <Text dimColor> {'\u2502'} </Text>
        <Text color="cyan" bold>Run</Text>
      </Box>
      <Divider />

      {/* Task description */}
      <Box marginTop={1}>
        <Panel title="Task" titleColor="white" borderColor="gray" borderStyle="round">
          <Text wrap="wrap">{taskDescription}</Text>
        </Panel>
      </Box>

      {/* Phase indicator */}
      <Box marginTop={1}>
        <PhaseIndicator phase={phase} />
      </Box>

      {/* Current status */}
      <Box marginTop={1}>
        <Box gap={1}>
          {PHASE_ICONS[phase]}
          <Text bold>{PHASE_LABELS[phase]}</Text>
        </Box>
      </Box>

      {/* Logs */}
      <Static items={logs}>
        {(log) => (
          <Box key={log.id}>
            <Text dimColor>[{log.timestamp}]</Text>
            <Text color={LogLevelColor({ level: log.level })}> {log.message}</Text>
          </Box>
        )}
      </Static>

      {/* Error */}
      {error && (
        <Box marginTop={1}>
          <Panel title="Error" titleColor="red" borderColor="red">
            <Text color="red" wrap="wrap">{error}</Text>
          </Panel>
        </Box>
      )}

      {/* Metrics (shown when done) */}
      {metrics && isDone && (
        <Box marginTop={1}>
          <Panel
            title="Run Summary"
            titleColor={phase === 'done' ? 'green' : 'red'}
            borderColor={phase === 'done' ? 'green' : 'red'}
            borderStyle="round"
          >
            <Box flexDirection="column" paddingY={1}>
              <Box gap={1}>
                <Box width={20}><Text dimColor>Run ID</Text></Box>
                <Text>{metrics.runId.slice(0, 12)}</Text>
              </Box>
              <Box gap={1}>
                <Box width={20}><Text dimColor>Agent</Text></Box>
                <Text>{metrics.agentName}</Text>
              </Box>
              <Box gap={1}>
                <Box width={20}><Text dimColor>Duration</Text></Box>
                <Text>{formatDuration(metrics.durationMs)}</Text>
              </Box>
              <Box gap={1}>
                <Box width={20}><Text dimColor>Tokens</Text></Box>
                <Text>
                  {formatNumber(metrics.inputTokens)} in + {formatNumber(metrics.outputTokens)} out ({metrics.turns} turns)
                </Text>
              </Box>
              <Box gap={1}>
                <Box width={20}><Text dimColor>Files Changed</Text></Box>
                <Text>{metrics.filesChanged.length}</Text>
              </Box>
              {metrics.filesChanged.length > 0 && (
                <Box flexDirection="column" marginLeft={22}>
                  {metrics.filesChanged.slice(0, 8).map((f, i) => (
                    <Text key={i} dimColor>{f}</Text>
                  ))}
                  {metrics.filesChanged.length > 8 && (
                    <Text dimColor>... +{metrics.filesChanged.length - 8} more</Text>
                  )}
                </Box>
              )}
              {metrics.commitSha && (
                <Box gap={1}>
                  <Box width={20}><Text dimColor>Commit</Text></Box>
                  <Text color="yellow">{metrics.commitSha.slice(0, 12)}</Text>
                </Box>
              )}
              {metrics.mergeOutcome && (
                <Box gap={1}>
                  <Box width={20}><Text dimColor>Merge</Text></Box>
                  <Text
                    color={metrics.mergeOutcome === 'merged' ? 'green' : 'red'}
                    bold
                  >
                    {metrics.mergeOutcome}
                    {metrics.mergeTier ? ` (${metrics.mergeTier})` : ''}
                  </Text>
                </Box>
              )}
            </Box>
          </Panel>
        </Box>
      )}

      {/* Exit hint */}
      {isDone && (
        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: 'Enter', label: 'Continue' },
            { key: 'Q', label: 'Quit' },
          ]} />
        </Box>
      )}
    </Box>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds % 60}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
