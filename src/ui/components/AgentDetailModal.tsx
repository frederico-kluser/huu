import React from 'react';
import { CardDetailModal, type KanbanCardData, type ModalSection, type StepItem } from 'ink-kanban-board';
import type { AgentStatus } from '../../lib/types.js';

interface Props {
  card: KanbanCardData;
  agent: AgentStatus;
  stepPrompt: string;
  onClose: () => void;
}

function buildTimeline(agent: AgentStatus): StepItem[] {
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

export function AgentDetailModal({ card, agent, stepPrompt, onClose }: Props): React.JSX.Element {
  const sections: ModalSection[] = [
    {
      type: 'text',
      label: 'Task',
      value: stepPrompt,
    },
    {
      type: 'steps',
      label: 'Timeline',
      steps: buildTimeline(agent),
    },
    {
      type: 'text',
      label: 'Git Info',
      value: [
        `Branch: ${agent.branchName ?? '(pending)'}`,
        `Worktree: ${agent.worktreePath ?? '(pending)'}`,
        `Commit: ${agent.commitSha ?? '(none)'}`,
        `Stage: ${agent.stageIndex + 1} — ${agent.stageName}`,
      ].join('\n'),
    },
  ];

  if (agent.filesModified.length > 0) {
    sections.push({
      type: 'checklist',
      label: 'Files modified',
      items: agent.filesModified.map((f) => ({ key: f, label: f, checked: true })),
    });
  }

  if (agent.error) {
    sections.push({
      type: 'text',
      label: 'Error',
      value: agent.error,
    });
  }

  sections.push({
    type: 'logs',
    label: 'Runtime logs',
    taskLabel: `agent-${agent.agentId}`,
    isRunning: agent.state !== 'done' && agent.state !== 'error',
    lines: agent.logs.length > 0 ? agent.logs : [],
    placeholder: 'sem logs ainda...',
    maxVisibleLines: 12,
  });

  sections.push({
    type: 'select',
    label: 'Actions',
    options: [{ label: 'Close', value: 'close' }],
    value: 'close',
    onChange: (v) => {
      if (v === 'close') onClose();
    },
  });

  return <CardDetailModal card={card} sections={sections} onClose={onClose} />;
}
