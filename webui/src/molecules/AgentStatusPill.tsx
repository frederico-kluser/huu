import { useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/atoms';
import { cn } from '@/lib/cn';
import type { AgentLifecyclePhase, AgentStatus } from '@/lib/domain-types';
import { TokenCounter } from './TokenCounter';

export interface AgentStatusPillProps {
  agent: AgentStatus;
  onClick?: (agent: AgentStatus) => void;
  className?: string;
}

const phaseTone: Record<AgentLifecyclePhase, BadgeTone> = {
  pending: 'neutral',
  worktree_creating: 'info',
  worktree_ready: 'info',
  session_starting: 'info',
  streaming: 'info',
  tool_running: 'warning',
  finalizing: 'info',
  validating: 'info',
  committing: 'info',
  pushing: 'info',
  cleaning_up: 'neutral',
  done: 'success',
  no_changes: 'neutral',
  error: 'error',
  killed_by_autoscaler: 'warning',
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** Compact card showing one agent's id, current phase, elapsed time, tokens. */
export function AgentStatusPill({ agent, onClick, className }: AgentStatusPillProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (agent.finishedAt || !agent.startedAt) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [agent.startedAt, agent.finishedAt]);

  const elapsed = agent.startedAt
    ? (agent.finishedAt ?? Date.now()) - agent.startedAt
    : 0;

  const interactive = typeof onClick === 'function';
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onClick?.(agent) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.(agent);
              }
            }
          : undefined
      }
      className={cn(
        'flex flex-col gap-2 rounded-md border border-foreground/15 bg-background p-3 text-sm',
        interactive && 'cursor-pointer hover:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-info/30',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Agent {agent.agentId}</span>
        <span className="flex items-center gap-1">
          {agent.requeues && agent.requeues > 0 ? (
            <Badge tone="warning">{`requeued ×${agent.requeues}`}</Badge>
          ) : null}
          <Badge tone={phaseTone[agent.phase] ?? 'neutral'}>{agent.phase}</Badge>
        </span>
      </div>
      {agent.currentFile ? (
        <div className="truncate text-xs text-foreground/60" title={agent.currentFile}>
          {agent.currentFile}
        </div>
      ) : null}
      <div className="flex items-center justify-between text-xs text-foreground/70">
        <span>{formatElapsed(elapsed)}</span>
        <TokenCounter
          in={agent.tokensIn}
          out={agent.tokensOut}
          cacheRead={agent.cacheReadTokens}
          cacheWrite={agent.cacheWriteTokens}
        />
      </div>
    </div>
  );
}
