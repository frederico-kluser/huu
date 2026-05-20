import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { Button, Input } from '@/atoms';
import { cn } from '@/lib/cn';
import type { FileNode } from '@shared/ws-protocol';

export interface FileMultiSelectProps {
  tree: FileNode[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Hook for the AI-driven file suggestion (Smart Select). */
  onSmartSelect?: () => void;
  className?: string;
}

function flattenPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileNode[]) => {
    for (const n of ns) {
      if (n.isDirectory && n.children) walk(n.children);
      else if (!n.isDirectory) out.push(n.path);
    }
  };
  walk(nodes);
  return out;
}

function matches(node: FileNode, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)) return true;
  if (node.children) return node.children.some((c) => matches(c, q));
  return false;
}

interface RowProps {
  node: FileNode;
  depth: number;
  selected: Set<string>;
  onToggle: (path: string) => void;
  query: string;
}

function Row({ node, depth, selected, onToggle, query }: RowProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  if (!matches(node, query)) return null;

  if (node.isDirectory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-foreground/5"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate text-foreground/80">{node.name}/</span>
        </button>
        {expanded && node.children
          ? node.children.map((c) => (
              <Row
                key={c.path}
                node={c}
                depth={depth + 1}
                selected={selected}
                onToggle={onToggle}
                query={query}
              />
            ))
          : null}
      </div>
    );
  }

  const isSel = selected.has(node.path);
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-foreground/5"
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      <input
        type="checkbox"
        checked={isSel}
        onChange={() => onToggle(node.path)}
        className="h-3.5 w-3.5 accent-info"
      />
      <span className="truncate font-mono text-xs">{node.name}</span>
    </label>
  );
}

/** Tree-view file picker with checkboxes, search, and Smart Select. */
export function FileMultiSelect({
  tree,
  selected,
  onChange,
  onSmartSelect,
  className,
}: FileMultiSelectProps) {
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (path: string) => {
    if (selectedSet.has(path)) onChange(selected.filter((p) => p !== path));
    else onChange([...selected, path]);
  };

  const selectAll = () => onChange(flattenPaths(tree));
  const clear = () => onChange([]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          label="Search"
          placeholder="filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          containerClassName="flex-1 min-w-[150px]"
        />
        <Button variant="ghost" size="sm" onClick={selectAll}>
          Select all
        </Button>
        <Button variant="ghost" size="sm" onClick={clear} disabled={selected.length === 0}>
          Clear
        </Button>
        <Button variant="ai" size="sm" onClick={onSmartSelect} disabled={!onSmartSelect}>
          <Sparkles className="h-4 w-4" /> Smart Select
        </Button>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-md border border-foreground/15 bg-background p-1">
        {tree.length === 0 ? (
          <div className="p-3 text-center text-xs text-foreground/40">No files</div>
        ) : (
          tree.map((n) => (
            <Row key={n.path} node={n} depth={0} selected={selectedSet} onToggle={toggle} query={query} />
          ))
        )}
      </div>
      <div className="text-xs text-foreground/60">
        {selected.length} file{selected.length === 1 ? '' : 's'} selected
      </div>
    </div>
  );
}
