import { useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/atoms';
import { cn } from '@/lib/cn';
import type { StageIntegration } from '@/lib/domain-types';

export interface IntegrationPillProps {
  integration: StageIntegration;
  className?: string;
}

// `ai` tone is allowed ONLY for conflict_resolving — the LLM resolver is
// AI-driven UI; the deterministic merge stays `info` per the theme rule.
const phaseTone: Record<StageIntegration['phase'], BadgeTone> = {
  pending: 'neutral',
  merging: 'info',
  conflict_resolving: 'ai',
  done: 'success',
  skipped: 'warning',
  error: 'error',
};

const phaseLabel: Record<StageIntegration['phase'], string> = {
  pending: 'pending',
  merging: 'merging',
  conflict_resolving: 'AI resolve',
  done: 'merged',
  skipped: 'skipped',
  error: 'failed',
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** Compact card for one stage merge: name, phase, branches/conflicts, model. */
export function IntegrationPill({ integration, className }: IntegrationPillProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (integration.finishedAt || !integration.startedAt) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [integration.startedAt, integration.finishedAt]);

  const elapsed = integration.startedAt
    ? (integration.finishedAt ?? Date.now()) - integration.startedAt
    : 0;
  const total = integration.branchesMerged.length + integration.branchesPending.length;
  const modelShort = integration.modelId.includes('/')
    ? integration.modelId.split('/').pop()
    : integration.modelId;

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border border-dashed border-foreground/20 bg-background p-3 text-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium" title={integration.stageName}>
          merge: {integration.stageName}
          {integration.runs > 1 ? ` ×${integration.runs}` : ''}
        </span>
        <Badge tone={phaseTone[integration.phase]}>{phaseLabel[integration.phase]}</Badge>
      </div>
      <div className="flex items-center justify-between text-xs text-foreground/70">
        <span>
          {integration.phase === 'pending'
            ? 'waiting for stage agents'
            : `${integration.branchesMerged.length}/${total} branches · ${integration.conflicts.length} conflicts`}
        </span>
        {integration.startedAt ? <span>{formatElapsed(elapsed)}</span> : null}
      </div>
      {integration.error ? (
        <div className="truncate text-xs text-error" title={integration.error}>
          {integration.error}
        </div>
      ) : integration.lastLog ? (
        <div className="truncate text-xs text-foreground/60" title={integration.lastLog}>
          {integration.lastLog}
        </div>
      ) : null}
      <div className="truncate text-xs text-foreground/50" title={integration.modelId}>
        {modelShort}
      </div>
    </div>
  );
}
