import { Spinner } from '@/atoms';
import type { WsStatus } from '@/lib/ws-client';

export interface WaitingPageProps {
  status: WsStatus;
}

export function WaitingPage({ status }: WaitingPageProps) {
  const lost = status === 'closed' || status === 'error';
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 rounded-lg border border-foreground/15 bg-background p-6 text-center shadow-sm">
        <Spinner variant={lost ? 'default' : 'ai'} />
        <div className="text-base font-medium">
          {lost ? 'Connection lost' : status === 'connecting' ? 'Connecting to huu…' : 'Waiting for server…'}
        </div>
        <div className="text-xs text-foreground/60">
          {lost
            ? 'The browser will keep trying to reconnect in the background.'
            : 'The server will send the first screen as soon as the session is ready.'}
        </div>
      </div>
    </div>
  );
}
