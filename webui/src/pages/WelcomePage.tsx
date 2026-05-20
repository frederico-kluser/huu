import { useEffect } from 'react';
import { Sparkles, Plus, Upload, FolderOpen } from 'lucide-react';
import { Button } from '@/atoms';
import { PipelineList } from '@/organisms';
import { useWsSession } from '@/lib/ws-context';
import type { PipelineEntry } from '@shared/ws-protocol';

export function WelcomePage() {
  const { send, status, pipelinesAvailable, pipelinesSaved, setCurrentPipeline } = useWsSession();
  const disabled = status !== 'open';

  useEffect(() => {
    if (status === 'open') send({ type: 'pipeline.requestList' });
  }, [status, send]);

  const onLoad = (entry: PipelineEntry) => {
    setCurrentPipeline(entry.pipeline);
    send({ type: 'nav', event: { type: 'welcome.selectPipeline', pipeline: entry.pipeline } });
  };

  const combined = [...pipelinesAvailable, ...pipelinesSaved];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to huu</h1>
        <p className="text-sm text-foreground/60">
          Pick a saved pipeline or create a new one.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button
          variant="ai"
          disabled={disabled}
          onClick={() => send({ type: 'nav', event: { type: 'welcome.assistant' } })}
          className="min-h-[44px]"
        >
          <Sparkles className="h-4 w-4" /> Pipeline Assistant
        </Button>
        <Button
          variant="primary"
          disabled={disabled}
          onClick={() => send({ type: 'nav', event: { type: 'welcome.new' } })}
          className="min-h-[44px]"
        >
          <Plus className="h-4 w-4" /> New Pipeline
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => send({ type: 'nav', event: { type: 'welcome.import' } })}
          className="min-h-[44px]"
        >
          <Upload className="h-4 w-4" /> Import Pipeline
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => send({ type: 'nav', event: { type: 'welcome.saved' } })}
          className="min-h-[44px]"
        >
          <FolderOpen className="h-4 w-4" /> Saved Pipelines
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-foreground/60">
          Pipelines ({combined.length})
        </h2>
        <PipelineList entries={combined} onLoad={onLoad} emptyMessage="No pipelines yet — create one with the buttons above." />
      </section>
    </div>
  );
}
