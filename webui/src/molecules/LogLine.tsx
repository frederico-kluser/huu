import { cn } from '@/lib/cn';
import type { LogEntry } from '@/lib/domain-types';

export interface LogLineProps {
  entry: LogEntry;
  className?: string;
}

const levelClass: Record<LogEntry['level'], string> = {
  info: 'text-foreground/80',
  warn: 'text-warning',
  error: 'text-error',
  debug: 'text-foreground/50',
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Single log line: timestamp · agent · level-colored message. Monospace. */
export function LogLine({ entry, className }: LogLineProps) {
  return (
    <div className={cn('flex items-start gap-2 font-mono text-xs leading-relaxed', className)}>
      <span className="shrink-0 text-foreground/40">{fmtTime(entry.timestamp)}</span>
      <span className="shrink-0 text-foreground/60">[{entry.agentId}]</span>
      <span className={cn('break-words', levelClass[entry.level])}>{entry.message}</span>
    </div>
  );
}
