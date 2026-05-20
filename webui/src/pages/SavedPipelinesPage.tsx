import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/atoms';
import { PipelineList } from '@/organisms';
import { useWsSession } from '@/lib/ws-context';
import type { PipelineEntry } from '@shared/ws-protocol';

export function SavedPipelinesPage() {
  const { send, status, pipelinesSaved, setCurrentPipeline } = useWsSession();

  useEffect(() => {
    if (status === 'open') send({ type: 'pipeline.requestList' });
  }, [status, send]);

  const onLoad = (entry: PipelineEntry) => {
    setCurrentPipeline(entry.pipeline);
    send({ type: 'nav', event: { type: 'saved.select', pipeline: entry.pipeline } });
  };

  const onDelete = (entry: PipelineEntry) => {
    send({ type: 'pipeline.delete', name: entry.fileName });
    setTimeout(() => send({ type: 'pipeline.requestList' }), 50);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Saved Pipelines</h1>
        <Button variant="ghost" onClick={() => send({ type: 'nav', event: { type: 'saved.cancel' } })}>
          <X className="h-4 w-4" /> Back
        </Button>
      </div>

      <PipelineList
        entries={pipelinesSaved}
        onLoad={onLoad}
        onDelete={onDelete}
        emptyMessage="No saved pipelines yet."
      />
    </div>
  );
}
