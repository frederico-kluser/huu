import { Moon, Sun } from 'lucide-react';
import { Badge, IconButton } from '@/atoms';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/use-theme';
import type { WsStatus } from '@/lib/ws-client';

export interface HeaderProps {
  version?: string;
  status: WsStatus;
  /** Optional hamburger handler for mobile sidebar toggle. */
  onMenuClick?: () => void;
  className?: string;
}

const statusDot: Record<WsStatus, string> = {
  connecting: 'bg-warning',
  open: 'bg-success',
  closed: 'bg-foreground/40',
  error: 'bg-error',
};

const statusLabel: Record<WsStatus, string> = {
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Disconnected',
  error: 'Error',
};

/** App top bar: logo · version · connection status · theme toggle. */
export function Header({ version, status, onMenuClick, className }: HeaderProps) {
  const { mode, toggle } = useTheme();
  return (
    <header
      className={cn(
        'flex h-14 items-center justify-between border-b border-foreground/10 bg-background px-4',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {onMenuClick ? (
          <button
            type="button"
            aria-label="Open menu"
            onClick={onMenuClick}
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-foreground/5 md:hidden"
          >
            <span aria-hidden className="block h-0.5 w-5 bg-foreground before:mb-1 before:block before:h-0.5 before:w-5 before:bg-foreground after:mt-1 after:block after:h-0.5 after:w-5 after:bg-foreground" />
          </button>
        ) : null}
        <h1 className="text-lg font-semibold tracking-tight">
          huu<span className="text-ai">·</span>web
        </h1>
        {version ? <Badge tone="neutral">v{version}</Badge> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-foreground/70" aria-live="polite">
          <span aria-hidden className={cn('h-2 w-2 rounded-full', statusDot[status])} />
          <span>{statusLabel[status]}</span>
        </div>
        <IconButton
          aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          variant="ghost"
          size="sm"
          onClick={toggle}
        >
          {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </IconButton>
      </div>
    </header>
  );
}
