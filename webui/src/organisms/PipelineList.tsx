import { PipelineCard } from '@/molecules';
import { cn } from '@/lib/cn';
import type { PipelineEntry } from '@shared/ws-protocol';

export interface PipelineListProps {
  entries: PipelineEntry[];
  onLoad: (entry: PipelineEntry) => void;
  onDelete?: (entry: PipelineEntry) => void;
  emptyMessage?: string;
  className?: string;
}

/** Responsive grid of PipelineCards. */
export function PipelineList({
  entries,
  onLoad,
  onDelete,
  emptyMessage = 'No saved pipelines.',
  className,
}: PipelineListProps) {
  if (entries.length === 0) {
    return (
      <div className={cn('rounded-md border border-dashed border-foreground/15 p-6 text-center text-sm text-foreground/50', className)}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {entries.map((e) => (
        <PipelineCard
          key={`${e.source}:${e.filePath}`}
          entry={e}
          onLoad={onLoad}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
