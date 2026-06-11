import { useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/atoms';
import { cn } from '@/lib/cn';
import type { CheckRun } from '@/lib/domain-types';

export interface CheckRunPillProps {
  checkRun: CheckRun;
  className?: string;
}

// `ai` tone while the judge deliberates — the check evaluator is an LLM
// agent, i.e. AI-driven UI per the theme rule.
const phaseTone: Record<CheckRun['phase'], BadgeTone> = {
  judging: 'ai',
  done: 'success',
  error: 'error',
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** Compact card for one check-step judge run: name, phase, outcome, model. */
export function CheckRunPill({ checkRun, className }: CheckRunPillProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (checkRun.finishedAt || !checkRun.startedAt) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [checkRun.startedAt, checkRun.finishedAt]);

  const elapsed = checkRun.startedAt
    ? (checkRun.finishedAt ?? Date.now()) - checkRun.startedAt
    : 0;
  const modelShort = checkRun.modelId.includes('/')
    ? checkRun.modelId.split('/').pop()
    : checkRun.modelId;
  const badgeLabel =
    checkRun.phase === 'judging'
      ? 'judging'
      : checkRun.phase === 'error'
        ? 'failed'
        : checkRun.fromJudge
          ? (checkRun.outcomeLabel ?? 'done')
          : `default: ${checkRun.outcomeLabel ?? '?'}`;
  const badgeTone: BadgeTone =
    checkRun.phase === 'done' && !checkRun.fromJudge ? 'warning' : phaseTone[checkRun.phase];

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border border-dashed border-foreground/20 bg-background p-3 text-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium" title={checkRun.stepName}>
          judge: {checkRun.stepName}
          {checkRun.runs > 1 ? ` ×${checkRun.runs}` : ''}
        </span>
        <Badge tone={badgeTone}>{badgeLabel}</Badge>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-foreground/70">
        <span className="truncate" title={checkRun.condition}>
          {checkRun.reason ?? checkRun.condition}
        </span>
        {checkRun.startedAt ? <span className="shrink-0">{formatElapsed(elapsed)}</span> : null}
      </div>
      {checkRun.error ? (
        <div className="truncate text-xs text-error" title={checkRun.error}>
          {checkRun.error}
        </div>
      ) : checkRun.lastLog ? (
        <div className="truncate text-xs text-foreground/60" title={checkRun.lastLog}>
          {checkRun.lastLog}
        </div>
      ) : null}
      <div className="truncate text-xs text-foreground/50" title={checkRun.modelId}>
        {modelShort}
      </div>
    </div>
  );
}
