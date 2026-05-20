import { Minus, Plus } from 'lucide-react';
import { IconButton } from '@/atoms';
import { cn } from '@/lib/cn';

export interface ConcurrencyControlProps {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  label?: string;
  className?: string;
}

/** `[−] N [+]` numeric stepper with clamping. */
export function ConcurrencyControl({
  value,
  min,
  max,
  onChange,
  label = 'Concurrency',
  className,
}: ConcurrencyControlProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className={cn('inline-flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <div className="inline-flex items-center gap-2 rounded-md border border-foreground/15 bg-background p-1">
        <IconButton
          aria-label="Decrease"
          variant="ghost"
          size="sm"
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          <Minus className="h-4 w-4" />
        </IconButton>
        <span className="min-w-[2ch] text-center font-mono text-sm tabular-nums">{value}</span>
        <IconButton
          aria-label="Increase"
          variant="ghost"
          size="sm"
          disabled={value >= max}
          onClick={() => onChange(clamp(value + 1))}
        >
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
