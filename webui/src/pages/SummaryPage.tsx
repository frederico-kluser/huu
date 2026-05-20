import { useMemo } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Badge, Button } from '@/atoms';
import { useWsSession } from '@/lib/ws-context';
import type { OrchestratorResult, Screen } from '@shared/ws-protocol';
import type { AgentStatus } from '@/lib/domain-types';

export interface SummaryPageProps {
  screen: Extract<Screen, { kind: 'summary' }>;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s % 60}s`;
}

export function SummaryPage({ screen }: SummaryPageProps) {
  const { send } = useWsSession();
  const result: OrchestratorResult = screen.result;

  const grouped = useMemo(() => {
    const m = new Map<AgentStatus['phase'], AgentStatus[]>();
    for (const a of result.agents) {
      const arr = m.get(a.phase) ?? [];
      arr.push(a);
      m.set(a.phase, arr);
    }
    return [...m.entries()].sort();
  }, [result.agents]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Run summary</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => send({ type: 'nav', event: { type: 'summary.back' } })}
            className="min-h-[44px]"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Editor
          </Button>
          <Button
            variant="ai"
            onClick={() => send({ type: 'nav', event: { type: 'summary.back' } })}
            className="min-h-[44px]"
          >
            <Sparkles className="h-4 w-4" /> New Run
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Duration" value={formatDuration(result.duration)} />
        <Stat label="Total cost" value={`$${result.totalCost.toFixed(4)}`} />
        <Stat label="Agents" value={String(result.agents.length)} />
        <Stat label="Files modified" value={String(result.filesModified.length)} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-foreground/60">
          Agents by status
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {grouped.map(([phase, agents]) => (
            <div
              key={phase}
              className="rounded-md border border-foreground/15 bg-background p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <Badge tone={phase === 'done' ? 'success' : phase === 'error' ? 'error' : 'neutral'}>
                  {phase}
                </Badge>
                <span className="font-mono text-xs text-foreground/60">{agents.length}</span>
              </div>
              <ul className="space-y-1 text-xs">
                {agents.map((a) => (
                  <li key={a.agentId} className="font-mono">
                    #{a.agentId} {a.stageName}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {result.filesModified.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-foreground/60">
            Files modified ({result.filesModified.length})
          </h2>
          <ul className="max-h-64 overflow-auto rounded-md border border-foreground/15 bg-foreground/[0.02] p-2 font-mono text-xs">
            {result.filesModified.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.conflicts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-foreground/60">
            Conflicts ({result.conflicts.length})
          </h2>
          <ul className="rounded-md border border-warning/40 bg-warning/5 p-2 font-mono text-xs">
            {result.conflicts.map((c, i) => (
              <li key={i}>{JSON.stringify(c)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-foreground/15 bg-background p-3">
      <div className="text-xs uppercase tracking-wide text-foreground/50">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </div>
  );
}
