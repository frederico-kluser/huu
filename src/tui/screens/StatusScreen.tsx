// Status display screen using Ink
// Replaces text-based status output

import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Logo } from '../components/Logo.js';
import { Divider } from '../components/Divider.js';
import { Panel } from '../components/Panel.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { KeyHint } from '../components/KeyHint.js';
import type { AggregateStatus, StatusSnapshot } from '../../cli/commands/status.js';

interface StatusScreenProps {
  snapshot: StatusSnapshot;
  onExit: () => void;
}

function statusVariant(status: AggregateStatus): 'success' | 'error' | 'warning' | 'info' | 'idle' | 'running' {
  switch (status) {
    case 'idle': return 'idle';
    case 'running': return 'running';
    case 'merged': return 'success';
    case 'failed': return 'error';
    case 'escalated': return 'warning';
    case 'aborted': return 'error';
    case 'conflict': return 'warning';
    case 'merge_pending': return 'info';
  }
}

function KV({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box gap={1}>
      <Box width={20}><Text dimColor>{label}</Text></Box>
      {typeof children === 'string' ? <Text>{children}</Text> : children}
    </Box>
  );
}

export function StatusScreen({ snapshot, onExit }: StatusScreenProps): React.JSX.Element {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q' || key.escape || key.return) {
      onExit();
    }
  });

  if (snapshot.status === 'idle') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title="Status" />

        <Box marginTop={1}>
          <Panel title="No Active Runs" titleColor="gray" borderColor="gray">
            <Box flexDirection="column" paddingY={1} gap={1}>
              <StatusBadge variant="idle" label="No executions recorded" />
              <Text dimColor>Run `huu run "task description"` to start an agent.</Text>
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[{ key: 'Q', label: 'Quit' }]} />
        </Box>
      </Box>
    );
  }

  const payload = snapshot.lastEventPayload ?? {};

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Logo compact />
      <Divider title="Status" />

      <Box marginTop={1} gap={1}>
        {/* Main status panel */}
        <Panel
          title="Current Run"
          titleColor="cyan"
          borderColor="cyan"
          flexGrow={1}
        >
          <Box flexDirection="column" paddingY={1}>
            <KV label="Status">
              <StatusBadge
                variant={statusVariant(snapshot.status)}
                label={snapshot.status.toUpperCase()}
                bold
              />
            </KV>
            <KV label="Run ID">{snapshot.runId ?? 'unknown'}</KV>
            <KV label="Agent">{snapshot.agentName ?? 'unknown'}</KV>
            <KV label="Last Event">{snapshot.lastEventType ?? 'none'}</KV>
            <KV label="Event Time">{snapshot.lastEventTime ?? 'unknown'}</KV>

            {typeof payload['state'] === 'string' && (
              <KV label="Agent State">{payload['state'] as string}</KV>
            )}
            {typeof payload['turn'] === 'number' && (
              <KV label="Turn">{String(payload['turn'])}</KV>
            )}
            {typeof payload['summary'] === 'string' && payload['summary'] && (
              <KV label="Summary">
                <Text wrap="truncate">{payload['summary'] as string}</Text>
              </KV>
            )}
            {typeof payload['commitSha'] === 'string' && (
              <KV label="Commit">
                <Text color="yellow">{payload['commitSha'] as string}</Text>
              </KV>
            )}
            {typeof payload['error'] === 'string' && (
              <KV label="Error">
                <Text color="red">{payload['error'] as string}</Text>
              </KV>
            )}
            {typeof payload['durationMs'] === 'number' && (
              <KV label="Duration">{`${payload['durationMs']}ms`}</KV>
            )}
          </Box>
        </Panel>

        {/* Sidebar: merge + message stats */}
        <Box flexDirection="column" width={35}>
          {snapshot.mergeSummary && (
            <Panel title="Merge" titleColor="magenta" borderColor="magenta">
              <Box flexDirection="column" paddingY={1}>
                <KV label="Status">
                  <Text
                    color={
                      snapshot.mergeSummary.status === 'merged' ? 'green'
                      : snapshot.mergeSummary.status === 'failed' ? 'red'
                      : 'yellow'
                    }
                    bold
                  >
                    {snapshot.mergeSummary.status}
                  </Text>
                </KV>
                {snapshot.mergeSummary.sourceBranch && (
                  <KV label="Source">{snapshot.mergeSummary.sourceBranch}</KV>
                )}
                {snapshot.mergeSummary.targetBranch && (
                  <KV label="Target">{snapshot.mergeSummary.targetBranch}</KV>
                )}
                {snapshot.mergeSummary.lastError && (
                  <KV label="Error">
                    <Text color="red" wrap="truncate">
                      {snapshot.mergeSummary.lastError}
                    </Text>
                  </KV>
                )}
              </Box>
            </Panel>
          )}

          {Object.keys(snapshot.messageStats).length > 0 && (
            <Panel title="Messages" titleColor="blue" borderColor="blue">
              <Box flexDirection="column" paddingY={1}>
                {Object.entries(snapshot.messageStats).map(([type, count]) => (
                  <Box key={type} gap={1}>
                    <Box width={18}><Text dimColor>{type}</Text></Box>
                    <Text bold>{String(count)}</Text>
                  </Box>
                ))}
              </Box>
            </Panel>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <KeyHint bindings={[{ key: 'Q', label: 'Quit' }]} />
      </Box>
    </Box>
  );
}
