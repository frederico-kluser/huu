import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button, Spinner } from '@/atoms';
import { ModelSelectorList } from '@/organisms';
import { useWsSession } from '@/lib/ws-context';
import type { AgentBackendKind } from '@shared/ws-protocol';

export function ModelSelectorPage({ backendKind }: { backendKind: AgentBackendKind }) {
  const { send, status, modelCatalogs } = useWsSession();
  const disabled = status !== 'open';
  const catalog = modelCatalogs[backendKind] ?? [];

  useEffect(() => {
    if (status === 'open' && catalog.length === 0) {
      send({ type: 'model.requestCatalog', backend: backendKind });
    }
  }, [status, backendKind, catalog.length, send]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Select a model</h1>
        <Button
          variant="ghost"
          onClick={() =>
            send({ type: 'nav', event: { type: 'modelSelector.cancel', initialBackendSet: true } })
          }
        >
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>

      {catalog.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-foreground/60">
          <Spinner /> Loading models for {backendKind}…
        </div>
      ) : (
        <ModelSelectorList
          catalog={catalog}
          onSelect={(m) => {
            if (disabled) return;
            send({ type: 'model.select', modelId: m.id });
          }}
        />
      )}
    </div>
  );
}
