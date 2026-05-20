import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * Pure CSS hover/focus tooltip. The label is rendered above the child and
 * revealed on `:hover` / `:focus-within`. Uses `role="tooltip"` for a11y.
 */
export function Tooltip({ label, children, className }: TooltipProps) {
  return (
    <span className={cn('relative inline-flex group', className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
