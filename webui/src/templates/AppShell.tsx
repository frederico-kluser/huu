import type { ReactNode } from 'react';
import { Header } from '@/organisms/Header';
import { Sidebar, type SidebarTabId } from '@/organisms/Sidebar';
import { useState } from 'react';
import type { WsStatus } from '@/lib/ws-client';
import { cn } from '@/lib/cn';

export interface AppShellProps {
  status: WsStatus;
  version?: string;
  currentTab: SidebarTabId;
  onSelectTab: (id: SidebarTabId) => void;
  children: ReactNode;
  className?: string;
}

/** Standard layout: header on top, sidebar on left (md+), content area. */
export function AppShell({
  status,
  version,
  currentTab,
  onSelectTab,
  children,
  className,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className={cn('flex min-h-screen flex-col bg-background text-foreground', className)}>
      <Header
        status={status}
        version={version}
        onMenuClick={() => setDrawerOpen(true)}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          current={currentTab}
          onSelect={onSelectTab}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
        <main className="flex flex-1 flex-col min-w-0 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}
