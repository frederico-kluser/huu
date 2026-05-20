import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

/**
 * Keyboard shortcut hint. Used for documentation / accessibility — the web
 * UI is click-driven, so this is not a primary navigation surface.
 */
export function Kbd({ children, className, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center rounded border border-foreground/20 bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground/80',
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}
