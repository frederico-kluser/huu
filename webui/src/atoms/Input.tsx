import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
}

/** Labelled text input with prefix/suffix slots and error state. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, prefix, suffix, id, className, containerClassName, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      {label ? (
        <label htmlFor={inputId} className="text-xs font-medium text-foreground/80">
          {label}
        </label>
      ) : null}
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border bg-background px-3 h-10 text-sm',
          error
            ? 'border-error focus-within:ring-2 focus-within:ring-error/30'
            : 'border-foreground/15 focus-within:ring-2 focus-within:ring-info/30 focus-within:border-info',
        )}
      >
        {prefix ? <span className="shrink-0 text-foreground/60">{prefix}</span> : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-err` : undefined}
          className={cn(
            'flex-1 bg-transparent outline-none placeholder:text-foreground/40 disabled:opacity-50',
            className,
          )}
          {...rest}
        />
        {suffix ? <span className="shrink-0 text-foreground/60">{suffix}</span> : null}
      </div>
      {error ? (
        <span id={`${inputId}-err`} className="text-xs text-error">
          {error}
        </span>
      ) : null}
    </div>
  );
});
