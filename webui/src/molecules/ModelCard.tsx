import { Check } from 'lucide-react';
import { Badge } from '@/atoms';
import { cn } from '@/lib/cn';
import type { ModelCatalogEntry } from '@/lib/domain-types';

export interface ModelCardProps {
  model: ModelCatalogEntry;
  selected?: boolean;
  onSelect: (model: ModelCatalogEntry) => void;
  className?: string;
}

function fmtPrice(p: number): string {
  return `$${p.toFixed(2)}/M`;
}

/** Clickable card showing model id, provider badge, pricing (if known). */
export function ModelCard({ model, selected, onSelect, className }: ModelCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(model)}
      aria-pressed={selected}
      className={cn(
        'group relative flex flex-col items-start gap-2 rounded-md border p-3 text-left transition-colors',
        selected
          ? 'border-info bg-info/5 ring-2 ring-info/30'
          : 'border-foreground/15 hover:border-foreground/30',
        className,
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-info text-white"
        >
          <Check className="h-2.5 w-2.5" />
        </span>
      ) : null}
      <div className="flex w-full items-center justify-between gap-2">
        <span className="truncate font-mono text-xs">{model.id}</span>
        <Badge tone="info">{model.provider}</Badge>
      </div>
      <span className="text-sm font-medium">{model.label}</span>
      {model.pricing ? (
        <span className="font-mono text-xs text-foreground/60">
          in {fmtPrice(model.pricing.in)} · out {fmtPrice(model.pricing.out)}
        </span>
      ) : null}
    </button>
  );
}
