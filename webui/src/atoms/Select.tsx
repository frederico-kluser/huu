import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options?: SelectOption[];
  containerClassName?: string;
  children?: ReactNode;
}

/** Native <select> styled to match the design system. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, options, id, className, containerClassName, children, ...rest },
  ref,
) {
  const autoId = useId();
  const selId = id ?? autoId;
  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      {label ? (
        <label htmlFor={selId} className="text-xs font-medium text-foreground/80">
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={selId}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-10 rounded-md border bg-background px-3 text-sm outline-none disabled:opacity-50',
          error
            ? 'border-error focus:ring-2 focus:ring-error/30'
            : 'border-foreground/15 focus:ring-2 focus:ring-info/30 focus:border-info',
          className,
        )}
        {...rest}
      >
        {children}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-error">{error}</span> : null}
    </div>
  );
});
