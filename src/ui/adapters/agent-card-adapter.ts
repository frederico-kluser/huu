import type { KanbanCardData, KanbanColumn, MetadataItem } from 'ink-kanban-board';
import type { AgentStatus, OrchestratorState } from '../../lib/types.js';

const MAX_TITLE_LENGTH = 40;
const MAX_CONTEXT_LENGTH = 80;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

interface CardStatus {
  label: string;
  color: string;
  spinning?: boolean;
}

function lifecycleToKanbanStatus(s: AgentStatus): CardStatus {
  if (s.state === 'error') return { label: 'FAILED', color: 'red' };
  if (s.state === 'done' && s.phase === 'done') return { label: 'DONE', color: 'green' };
  if (s.state === 'streaming' || s.state === 'tool_running') {
    return { label: 'RUNNING', color: 'cyan', spinning: true };
  }
  if (
    s.phase === 'finalizing' ||
    s.phase === 'committing' ||
    s.phase === 'cleaning_up' ||
    s.phase === 'pushing'
  ) {
    return { label: s.phase.toUpperCase(), color: 'cyan', spinning: true };
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

export function agentToCard(
  agent: AgentStatus,
  modelId: string,
  lastLog: string | undefined,
): KanbanCardData {
  const status = lifecycleToKanbanStatus(agent);
  const fileLabel = agent.currentFile ?? '(rodada livre)';
  const subtitle = `[${agent.stageName}] ${truncate(fileLabel, MAX_TITLE_LENGTH)}`;
  const log = lastLog ?? agent.logs[agent.logs.length - 1];
  const contextLine = agent.error
    ? truncate(agent.error, MAX_CONTEXT_LENGTH)
    : log
      ? truncate(log, MAX_CONTEXT_LENGTH)
      : undefined;

  const metadata: MetadataItem[] = [{ label: `🧠 ${modelId}`, dim: true }];
  if (agent.branchName) {
    const shortBranch = agent.branchName.split('/').slice(-1)[0]!;
    metadata.push({ label: shortBranch, dim: true });
  }
  if (agent.filesModified.length > 0) {
    metadata.push({ label: `${agent.filesModified.length} file(s)`, color: 'yellow' });
  }

  return {
    key: String(agent.agentId),
    title: `#${agent.agentId} ${truncate(agent.stageName, MAX_TITLE_LENGTH)}`,
    subtitle,
    status,
    metadata,
    contextLine,
    contextIsError: Boolean(agent.error),
  };
}

export function buildBoardColumns(
  state: OrchestratorState,
  modelId: string,
  lastLogByAgent: Map<number, string>,
): KanbanColumn[] {
  const todo: KanbanCardData[] = [];
  const doing: KanbanCardData[] = [];
  const done: KanbanCardData[] = [];

  for (const agent of state.agents) {
    const card = agentToCard(agent, modelId, lastLogByAgent.get(agent.agentId));
    const col = pickColumn(agent);
    if (col === 'todo') todo.push(card);
    else if (col === 'doing') doing.push(card);
    else done.push(card);
  }

  return [
    { key: 'todo', title: 'TODO', tone: 'neutral', cards: todo },
    { key: 'doing', title: 'DOING', tone: 'accent', cards: doing },
    { key: 'done', title: 'DONE', tone: 'success', cards: done },
  ];
}
