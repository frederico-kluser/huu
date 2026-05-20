import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SplitPanelProps {
  left: ReactNode;
  right: ReactNode;
  /** Tailwind class for left column width on md+. Default `md:w-2/3`. */
  leftWidth?: string;
  className?: string;
}

/** Two-pane layout: side-by-side on md+, stacked below. */
export function SplitPanel({ left, right, leftWidth = 'md:w-2/3', className }: SplitPanelProps) {
  return (
    <div className={cn('flex flex-col gap-3 md:flex-row md:gap-4', className)}>
      <div className={cn('w-full min-w-0', leftWidth)}>{left}</div>
      <div className="w-full min-w-0 md:flex-1">{right}</div>
    </div>
  );
}
