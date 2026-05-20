import { X } from 'lucide-react';
import { Button } from '@/atoms';
import { BackendCard } from '@/molecules';
import { useWsSession } from '@/lib/ws-context';
import type { AgentBackendKind } from '@shared/ws-protocol';

interface Tile {
  kind: AgentBackendKind;
  label: string;
  description: string;
}

const TILES: Tile[] = [
  {
    kind: 'pi',
    label: 'Pi (OpenRouter)',
    description: 'Default. Drive any OpenRouter model with the @mariozechner/pi-coding-agent SDK.',
  },
  {
    kind: 'copilot',
    label: 'GitHub Copilot',
    description: 'Use your GitHub Copilot subscription via the official Copilot SDK.',
  },
  {
    kind: 'stub',
    label: 'Stub (no LLM)',
    description: 'Mock backend for smoke tests. Produces deterministic placeholder commits.',
  },
];

export function BackendSelectorPage() {
  const { send, status } = useWsSession();
  const disabled = status !== 'open';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Select agent backend</h1>
        <Button variant="ghost" onClick={() => send({ type: 'nav', event: { type: 'backend.cancel' } })}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <BackendCard
            key={t.kind}
            kind={t.kind}
            label={t.label}
            description={t.description}
            onSelect={(k) => {
              if (disabled) return;
              send({ type: 'backend.select', backendKind: k });
            }}
          />
        ))}
      </div>
    </div>
  );
}
