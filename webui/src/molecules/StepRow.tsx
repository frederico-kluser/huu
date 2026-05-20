import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { IconButton, Input } from '@/atoms';
import { FileChip } from './FileChip';
import { cn } from '@/lib/cn';
import type { PromptStep } from '@/lib/domain-types';

export interface StepRowProps {
  step: PromptStep;
  index: number;
  onEdit?: (index: number) => void;
  onRemove?: (index: number) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
  onNameChange?: (index: number, name: string) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  className?: string;
}

/** One step in the pipeline editor list. */
export function StepRow({
  step,
  index,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  onNameChange,
  canMoveUp,
  canMoveDown,
  className,
}: StepRowProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border border-foreground/15 bg-background p-3',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-foreground/50">#{index + 1}</span>
        <Input
          aria-label="Step name"
          value={step.name}
          onChange={(e) => onNameChange?.(index, e.target.value)}
          containerClassName="flex-1"
          placeholder="Step name"
        />
        <div className="flex items-center gap-1">
          <IconButton
            aria-label="Move up"
            variant="ghost"
            size="sm"
            disabled={!canMoveUp}
            onClick={() => onMoveUp?.(index)}
          >
            <ArrowUp className="h-4 w-4" />
          </IconButton>
          <IconButton
            aria-label="Move down"
            variant="ghost"
            size="sm"
            disabled={!canMoveDown}
            onClick={() => onMoveDown?.(index)}
          >
            <ArrowDown className="h-4 w-4" />
          </IconButton>
          <IconButton
            aria-label="Edit step"
            variant="ghost"
            size="sm"
            onClick={() => onEdit?.(index)}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton
            aria-label="Remove step"
            variant="ghost"
            size="sm"
            onClick={() => onRemove?.(index)}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      <p className="line-clamp-2 text-xs text-foreground/70">
        {step.prompt || <span className="italic text-foreground/40">No prompt yet</span>}
      </p>
      <div className="flex flex-wrap gap-1">
        {step.files.length === 0 ? (
          <span className="text-xs text-foreground/50 italic">Whole project</span>
        ) : (
          step.files.slice(0, 6).map((f) => <FileChip key={f} path={f} />)
        )}
        {step.files.length > 6 ? (
          <span className="text-xs text-foreground/50">+{step.files.length - 6} more</span>
        ) : null}
      </div>
    </div>
  );
}
