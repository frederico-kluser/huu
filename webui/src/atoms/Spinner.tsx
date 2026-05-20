import { cn } from '@/lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';
export type SpinnerVariant = 'default' | 'ai';

export interface SpinnerProps {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
  className?: string;
  'aria-label'?: string;
}

const sizeMap: Record<SpinnerSize, string> = {
  sm: 'h-3 w-3 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

/** Pure CSS spinner. `variant="ai"` uses the fuchsia AI color. */
export function Spinner({
  size = 'md',
  variant = 'default',
  className,
  'aria-label': ariaLabel = 'Loading',
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-r-transparent align-[-0.125em]',
        sizeMap[size],
        variant === 'ai' ? 'text-ai' : 'text-current',
        className,
      )}
    />
  );
}
