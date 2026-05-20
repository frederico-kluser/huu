import { useMemo, useState } from 'react';
import { ToastHost, ToastProvider } from '@/atoms';
import { AppShell } from '@/templates';
import type { SidebarTabId } from '@/organisms';
import { WsProvider, deriveWsUrl, useWsSession } from '@/lib/ws-context';
import { Router } from '@/Router';
import type { Screen } from '@shared/ws-protocol';

function screenToTab(kind: Screen['kind'] | undefined): SidebarTabId {
  switch (kind) {
    case undefined:
    case 'welcome':
      return 'welcome';
    case 'run':
      return 'run';
    case 'summary':
      return 'run';
    default:
      return 'editor';
  }
}

function Shell() {
  const { status, screen } = useWsSession();
  // Sidebar is visual-only: clicks just update a local preferred tab marker.
  // True navigation goes through FSM events emitted by individual pages.
  const [override, setOverride] = useState<SidebarTabId | null>(null);
  const tab = override ?? screenToTab(screen?.kind);
  const onSelect = useMemo(
    () => (id: SidebarTabId) => setOverride(id),
    [],
  );

  return (
    <AppShell status={status} currentTab={tab} onSelectTab={onSelect}>
      <Router />
    </AppShell>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <WsProvider url={deriveWsUrl()}>
        <Shell />
      </WsProvider>
      <ToastHost />
    </ToastProvider>
  );
}
