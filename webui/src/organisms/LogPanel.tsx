import { useEffect, useMemo, useRef, useState } from 'react';
import { LogLine } from '@/molecules';
import { Button } from '@/atoms';
import { cn } from '@/lib/cn';
import type { LogEntry } from '@/lib/domain-types';

export interface LogPanelProps {
  logs: LogEntry[];
  maxLines?: number;
  className?: string;
}

/**
 * Scrollable log viewer. Keeps only the last `maxLines` (default 500) in the
 * DOM. Auto-scrolls to the bottom unless the user scrolls up — in which case
 * a "Resume" button appears.
 */
export function LogPanel({ logs, maxLines = 500, className }: LogPanelProps) {
  const visible = useMemo(
    () => (logs.length > maxLines ? logs.slice(logs.length - maxLines) : logs),
    [logs, maxLines],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (!follow) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, follow]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setFollow(atBottom);
  };

  const resume = () => {
    setFollow(true);
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  return (
    <div className={cn('relative flex h-full flex-col rounded-md border border-foreground/15 bg-background', className)}>
      <header className="flex items-center justify-between border-b border-foreground/10 px-3 py-2 text-xs text-foreground/60">
        <span>Logs · {visible.length}{logs.length > maxLines ? ` of ${logs.length}` : ''}</span>
        <span className={cn('font-mono', follow ? 'text-success' : 'text-warning')}>
          {follow ? 'auto-scroll' : 'paused'}
        </span>
      </header>
      <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <div className="p-3 text-center text-xs text-foreground/40">No logs yet</div>
        ) : (
          visible.map((entry, i) => (
            <LogLine key={`${entry.timestamp}-${i}`} entry={entry} />
          ))
        )}
      </div>
      {!follow ? (
        <div className="absolute bottom-3 right-3">
          <Button size="sm" variant="secondary" onClick={resume}>
            Resume auto-scroll
          </Button>
        </div>
      ) : null}
    </div>
  );
}
