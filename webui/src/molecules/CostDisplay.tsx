import { cn } from '@/lib/cn';

export interface CostDisplayProps {
  usd: number;
  budget?: number;
  className?: string;
}

function fmt(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Cumulative cost + optional budget progress bar. */
export function CostDisplay({ usd, budget, className }: CostDisplayProps) {
  const pct = budget && budget > 0 ? Math.min(100, (usd / budget) * 100) : null;
  const over = budget !== undefined && usd > budget;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline gap-2 font-mono text-sm tabular-nums">
        <span className={cn(over && 'text-error')}>{fmt(usd)}</span>
        {budget !== undefined ? (
          <span className="text-foreground/50">/ {fmt(budget)}</span>
        ) : null}
      </div>
      {pct !== null ? (
        <div
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
        >
          <div
            className={cn('h-full transition-[width]', over ? 'bg-error' : 'bg-info')}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
