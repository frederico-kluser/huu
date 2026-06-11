import { useMemo } from 'react';
import { AgentStatusPill, CheckRunPill, IntegrationPill } from '@/molecules';
import { cn } from '@/lib/cn';
import type { AgentLifecyclePhase, AgentStatus, CheckRun, StageIntegration } from '@/lib/domain-types';

export interface KanbanBoardProps {
  agents: AgentStatus[];
  /** Per-stage merge history — rendered as display-only cards. */
  integrations?: StageIntegration[];
  /** Per-check-visit judge history — rendered as display-only cards. */
  checkRuns?: CheckRun[];
  onAgentClick?: (agent: AgentStatus) => void;
  className?: string;
}

interface Column {
  id: string;
  label: string;
  phases: AgentLifecyclePhase[];
}

const COLUMNS: Column[] = [
  { id: 'pending', label: 'Pending', phases: ['pending', 'worktree_creating', 'worktree_ready', 'session_starting'] },
  { id: 'streaming', label: 'Streaming', phases: ['streaming'] },
  { id: 'tool', label: 'Tool running', phases: ['tool_running'] },
  { id: 'finalizing', label: 'Finalizing', phases: ['finalizing', 'validating', 'committing', 'pushing', 'cleaning_up'] },
  { id: 'done', label: 'Done', phases: ['done', 'no_changes'] },
  { id: 'error', label: 'Error', phases: ['error', 'killed_by_autoscaler'] },
];

// Stage merges map onto the same columns as agents so the board keeps
// moving while the orchestrator is `integrating`.
function integrationColumn(phase: StageIntegration['phase']): string {
  switch (phase) {
    case 'pending':
      return 'pending';
    case 'merging':
    case 'conflict_resolving':
      return 'finalizing';
    case 'error':
      return 'error';
    default:
      return 'done';
  }
}

// Judge runs: deliberating judges sit in `streaming` (an LLM is working),
// finished ones land in done/error like everything else.
function checkRunColumn(phase: CheckRun['phase']): string {
  switch (phase) {
    case 'judging':
      return 'streaming';
    case 'error':
      return 'error';
    default:
      return 'done';
  }
}

/** Kanban view of agents grouped by lifecycle phase. Horizontal scroll on mobile. */
export function KanbanBoard({ agents, integrations, checkRuns, onAgentClick, className }: KanbanBoardProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, AgentStatus[]>();
    for (const col of COLUMNS) map.set(col.id, []);
    for (const a of agents) {
      const col = COLUMNS.find((c) => c.phases.includes(a.phase));
      if (col) map.get(col.id)?.push(a);
    }
    return map;
  }, [agents]);

  const groupedIntegrations = useMemo(() => {
    const map = new Map<string, StageIntegration[]>();
    for (const col of COLUMNS) map.set(col.id, []);
    for (const entry of integrations ?? []) {
      map.get(integrationColumn(entry.phase))?.push(entry);
    }
    return map;
  }, [integrations]);

  const groupedCheckRuns = useMemo(() => {
    const map = new Map<string, CheckRun[]>();
    for (const col of COLUMNS) map.set(col.id, []);
    for (const entry of checkRuns ?? []) {
      map.get(checkRunColumn(entry.phase))?.push(entry);
    }
    return map;
  }, [checkRuns]);

  return (
    <div className={cn('flex gap-3 overflow-x-auto pb-2', className)}>
      {COLUMNS.map((col) => {
        const list = grouped.get(col.id) ?? [];
        const merges = groupedIntegrations.get(col.id) ?? [];
        const judges = groupedCheckRuns.get(col.id) ?? [];
        return (
          <section
            key={col.id}
            className="flex w-64 shrink-0 flex-col gap-2 rounded-md border border-foreground/15 bg-foreground/[0.02] p-2"
            aria-label={col.label}
          >
            <header className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-foreground/60">
              <span>{col.label}</span>
              <span className="font-mono">{list.length + merges.length + judges.length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {list.length === 0 && merges.length === 0 && judges.length === 0 ? (
                <div className="rounded-md border border-dashed border-foreground/10 p-3 text-center text-xs text-foreground/40">
                  empty
                </div>
              ) : (
                <>
                  {list.map((a) => (
                    <AgentStatusPill key={a.agentId} agent={a} onClick={onAgentClick} />
                  ))}
                  {merges.map((m) => (
                    <IntegrationPill key={`merge-${m.visitIndex}`} integration={m} />
                  ))}
                  {judges.map((j) => (
                    <CheckRunPill key={`check-${j.visitIndex}`} checkRun={j} />
                  ))}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
