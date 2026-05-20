import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-info text-white hover:bg-info/90 focus-visible:ring-info',
        secondary:
          'bg-foreground/10 text-foreground hover:bg-foreground/20 focus-visible:ring-foreground/30',
        ghost:
          'bg-transparent text-foreground hover:bg-foreground/10 focus-visible:ring-foreground/20',
        danger:
          'bg-error text-white hover:bg-error/90 focus-visible:ring-error',
        ai: 'bg-ai text-white hover:bg-ai/90 focus-visible:ring-ai',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  children?: ReactNode;
}

/**
 * Primary action atom. Variants: primary | secondary | ghost | danger | ai.
 * `ai` is reserved for AI-driven actions (Smart Select, Assistant submit).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" variant={variant === 'ai' ? 'ai' : 'default'} /> : null}
      {children}
    </button>
  );
});
