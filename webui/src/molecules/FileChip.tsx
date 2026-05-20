import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FileChipProps {
  path: string;
  onRemove?: () => void;
  className?: string;
}

/** Removable pill displaying a file path. */
export function FileChip({ path, onRemove, className }: FileChipProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-foreground/15 bg-foreground/5 px-2 py-1 font-mono text-xs',
        className,
      )}
    >
      <span className="truncate" title={path}>
        {path}
      </span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${path}`}
          onClick={onRemove}
          className="shrink-0 text-foreground/50 hover:text-error"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
