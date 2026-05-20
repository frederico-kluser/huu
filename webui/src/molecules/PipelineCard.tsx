import { Trash2 } from 'lucide-react';
import { Badge, IconButton } from '@/atoms';
import { cn } from '@/lib/cn';
import type { PipelineEntry } from '@shared/ws-protocol';

export interface PipelineCardProps {
  entry: PipelineEntry;
  onLoad: (entry: PipelineEntry) => void;
  onDelete?: (entry: PipelineEntry) => void;
  className?: string;
}

/** Pipeline summary card: name, step count, total files. */
export function PipelineCard({ entry, onLoad, onDelete, className }: PipelineCardProps) {
  const stepCount = entry.pipeline.steps.length;
  const fileCount = entry.pipeline.steps.reduce((acc, s) => acc + s.files.length, 0);
  return (
    <div
      className={cn(
        'group flex flex-col gap-2 rounded-lg border border-foreground/15 bg-background p-4 transition-colors hover:border-foreground/30',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onLoad(entry)}
          className="flex-1 text-left focus:outline-none"
        >
          <div className="font-medium">{entry.pipeline.name}</div>
          <div className="font-mono text-xs text-foreground/50">{entry.fileName}</div>
        </button>
        {onDelete ? (
          <IconButton
            aria-label={`Delete pipeline ${entry.pipeline.name}`}
            variant="ghost"
            size="sm"
            onClick={() => onDelete(entry)}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Badge tone="neutral">{stepCount} step{stepCount === 1 ? '' : 's'}</Badge>
        <Badge tone="neutral">{fileCount} file{fileCount === 1 ? '' : 's'}</Badge>
        <Badge tone={entry.source === 'global' ? 'info' : 'neutral'}>{entry.source}</Badge>
      </div>
    </div>
  );
}
