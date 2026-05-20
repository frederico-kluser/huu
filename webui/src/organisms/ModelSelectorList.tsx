import { useMemo, useState } from 'react';
import { Input } from '@/atoms';
import { ModelCard } from '@/molecules';
import { cn } from '@/lib/cn';
import type { ModelCatalogEntry } from '@/lib/domain-types';

export interface ModelSelectorListProps {
  catalog: ModelCatalogEntry[];
  selected?: string;
  onSelect: (model: ModelCatalogEntry) => void;
  className?: string;
}

/** Filterable model list grouped by provider. */
export function ModelSelectorList({
  catalog,
  selected,
  onSelect,
  className,
}: ModelSelectorListProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? catalog.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q),
        )
      : catalog;
  }, [catalog, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ModelCatalogEntry[]>();
    for (const m of filtered) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Input
        placeholder="Filter models…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {grouped.length === 0 ? (
        <div className="rounded-md border border-dashed border-foreground/15 p-6 text-center text-sm text-foreground/50">
          No models match the filter.
        </div>
      ) : (
        grouped.map(([provider, models]) => (
          <section key={provider} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-foreground/60">
              {provider}
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {models.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  selected={selected === m.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
