import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AgentBackendKind } from '@shared/ws-protocol';

export interface BackendCardProps {
  kind: AgentBackendKind;
  label: string;
  description: string;
  selected?: boolean;
  onSelect: (kind: AgentBackendKind) => void;
  className?: string;
}

/** Big clickable card for choosing the agent backend (pi/copilot/stub). */
export function BackendCard({
  kind,
  label,
  description,
  selected,
  onSelect,
  className,
}: BackendCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(kind)}
      aria-pressed={selected}
      className={cn(
        'group relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors',
        selected
          ? 'border-info bg-info/5 ring-2 ring-info/30'
          : 'border-foreground/15 hover:border-foreground/30',
        className,
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-info text-white"
        >
          <Check className="h-3 w-3" />
        </span>
      ) : null}
      <span className="font-mono text-xs uppercase tracking-wide text-foreground/50">{kind}</span>
      <span className="text-base font-semibold">{label}</span>
      <span className="text-sm text-foreground/70">{description}</span>
    </button>
  );
}
