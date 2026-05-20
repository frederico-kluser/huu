import { type ReactNode } from 'react';
import { Activity, FileEdit, Home, ScrollText, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type SidebarTabId = 'welcome' | 'editor' | 'run' | 'logs';

export interface SidebarTab {
  id: SidebarTabId;
  label: string;
  icon: ReactNode;
}

const DEFAULT_TABS: SidebarTab[] = [
  { id: 'welcome', label: 'Welcome', icon: <Home className="h-4 w-4" /> },
  { id: 'editor', label: 'Editor', icon: <FileEdit className="h-4 w-4" /> },
  { id: 'run', label: 'Run', icon: <Activity className="h-4 w-4" /> },
  { id: 'logs', label: 'Logs', icon: <ScrollText className="h-4 w-4" /> },
];

export interface SidebarProps {
  current: SidebarTabId;
  onSelect: (id: SidebarTabId) => void;
  tabs?: SidebarTab[];
  /** Mobile drawer open state. */
  open?: boolean;
  onClose?: () => void;
  className?: string;
}

/**
 * Left nav with screen tabs. CLICK-DRIVEN (no keyboard shortcuts).
 * Always-visible on `md+`. Becomes a slide-over drawer below `md`.
 */
export function Sidebar({
  current,
  onSelect,
  tabs = DEFAULT_TABS,
  open = false,
  onClose,
  className,
}: SidebarProps) {
  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-current={current === t.id ? 'page' : undefined}
          onClick={() => {
            onSelect(t.id);
            onClose?.();
          }}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
            current === t.id
              ? 'bg-info/10 text-info'
              : 'text-foreground/80 hover:bg-foreground/5',
          )}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          'hidden w-56 shrink-0 border-r border-foreground/10 bg-background md:flex md:flex-col',
          className,
        )}
      >
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={onClose}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-background shadow-lg">
            <div className="flex items-center justify-between border-b border-foreground/10 p-3">
              <span className="text-sm font-medium">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-foreground/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      ) : null}
    </>
  );
}
