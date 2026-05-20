import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  containerClassName?: string;
  /** Auto-resize height to fit content. Default true. */
  autoResize?: boolean;
}

/** Multi-line text input with optional auto-resize. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, id, className, containerClassName, autoResize = true, onInput, value, ...rest },
  ref,
) {
  const autoId = useId();
  const taId = id ?? autoId;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

  const resize = () => {
    const el = innerRef.current;
    if (!el || !autoResize) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    resize();
  }, [value]);

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      {label ? (
        <label htmlFor={taId} className="text-xs font-medium text-foreground/80">
          {label}
        </label>
      ) : null}
      <textarea
        ref={innerRef}
        id={taId}
        value={value}
        onInput={(e) => {
          resize();
          onInput?.(e);
        }}
        aria-invalid={error ? true : undefined}
        className={cn(
          'min-h-[2.5rem] w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-foreground/40 disabled:opacity-50',
          error
            ? 'border-error focus:ring-2 focus:ring-error/30'
            : 'border-foreground/15 focus:ring-2 focus:ring-info/30 focus:border-info',
          className,
        )}
        {...rest}
      />
      {error ? <span className="text-xs text-error">{error}</span> : null}
    </div>
  );
});
