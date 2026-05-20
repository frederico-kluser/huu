import { cn } from '@/lib/cn';

export interface TokenCounterProps {
  in: number;
  out: number;
  cacheRead?: number;
  cacheWrite?: number;
  className?: string;
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Inline token-usage summary: `↓ 12.3k ↑ 4.5k (cache: 1.2k)`. */
export function TokenCounter({ in: tokensIn, out, cacheRead, cacheWrite, className }: TokenCounterProps) {
  const cache = (cacheRead ?? 0) + (cacheWrite ?? 0);
  return (
    <span className={cn('inline-flex items-center gap-2 font-mono tabular-nums', className)}>
      <span title="Tokens in">↓ {fmt(tokensIn)}</span>
      <span title="Tokens out">↑ {fmt(out)}</span>
      {cache > 0 ? <span className="text-foreground/50">(cache: {fmt(cache)})</span> : null}
    </span>
  );
}
