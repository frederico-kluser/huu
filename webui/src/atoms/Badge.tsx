import type { HTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap',
  {
    variants: {
      tone: {
        success: 'bg-success/15 text-success ring-1 ring-inset ring-success/30',
        warning: 'bg-warning/15 text-warning ring-1 ring-inset ring-warning/30',
        error: 'bg-error/15 text-error ring-1 ring-inset ring-error/30',
        info: 'bg-info/15 text-info ring-1 ring-inset ring-info/30',
        ai: 'bg-ai/15 text-ai ring-1 ring-inset ring-ai/30',
        neutral: 'bg-foreground/10 text-foreground ring-1 ring-inset ring-foreground/15',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  children?: ReactNode;
}

/** Small rounded-full label. Tone maps to theme tokens. */
export function Badge({ className, tone, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...rest}>
      {children}
    </span>
  );
}
