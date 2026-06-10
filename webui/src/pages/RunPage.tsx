import { StopCircle, Zap } from 'lucide-react';
import { Badge, Button } from '@/atoms';
import { ConcurrencyControl, CostDisplay } from '@/molecules';
import { KanbanBoard, LogPanel } from '@/organisms';
import { SplitPanel } from '@/templates';
import { useWsSession } from '@/lib/ws-context';

export function RunPage() {
  const { send, state, status } = useWsSession();
  const disabled = status !== 'open';

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground/60">
        Waiting for orchestrator state…
      </div>
    );
  }

  const autoScale = state.autoScale;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-foreground/15 bg-background p-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-foreground/50">Status</span>
            <Badge tone={state.status === 'error' ? 'error' : state.status === 'done' ? 'success' : 'info'}>
              {state.status}
            </Badge>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-foreground/50">Stage</span>
            <span className="font-mono text-sm">
              {state.currentStage}/{state.totalStages || 1}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-foreground/50">Tasks</span>
            <span className="font-mono text-sm">
              {state.completedTasks}/{state.totalTasks}
            </span>
          </div>
          <CostDisplay usd={state.totalCost} />
          {autoScale?.enabled ? (
            <Badge tone={autoScale.state === 'NORMAL' ? 'info' : 'warning'}>
              <Zap className="mr-1 inline-block h-3 w-3" />
              auto-scale: {autoScale.state.toLowerCase()}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ConcurrencyControl
            value={state.concurrency}
            min={1}
            max={16}
            onChange={(n) => send({ type: 'run.setConcurrency', concurrency: n })}
          />
          <Button
            variant="danger"
            onClick={() => send({ type: 'run.abort' })}
            disabled={disabled || state.status === 'done' || state.status === 'error'}
            className="min-h-[44px]"
          >
            <StopCircle className="h-4 w-4" /> Abort
          </Button>
        </div>
      </header>

      <SplitPanel
        leftWidth="lg:w-2/3"
        className="lg:flex-row"
        left={
          <div className="overflow-x-auto snap-x snap-mandatory">
            <KanbanBoard agents={state.agents} integrations={state.stageIntegrations} />
          </div>
        }
        right={
          <div className="h-[50vh] lg:h-[70vh]">
            <LogPanel logs={state.logs} />
          </div>
        }
      />
    </div>
  );
}
