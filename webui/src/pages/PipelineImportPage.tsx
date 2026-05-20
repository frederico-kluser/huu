import { ClipboardPaste, FileText, X } from 'lucide-react';
import { Button } from '@/atoms';
import { PipelineList } from '@/organisms';
import { useWsSession } from '@/lib/ws-context';
import type { PipelineEntry } from '@shared/ws-protocol';

export function PipelineImportPage() {
  const { send, status, pipelinesAvailable } = useWsSession();
  const disabled = status !== 'open';

  const onLoad = (e: PipelineEntry) =>
    send({ type: 'nav', event: { type: 'import.selectFromList', pipeline: e.pipeline } });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Import Pipeline</h1>
        <Button variant="ghost" onClick={() => send({ type: 'nav', event: { type: 'import.cancel' } })}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => send({ type: 'nav', event: { type: 'import.paste' } })}
          className="min-h-[44px]"
        >
          <ClipboardPaste className="h-4 w-4" /> Paste JSON
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => send({ type: 'nav', event: { type: 'import.customPath' } })}
          className="min-h-[44px]"
        >
          <FileText className="h-4 w-4" /> Custom path
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-foreground/60">
          Available pipelines
        </h2>
        <PipelineList entries={pipelinesAvailable} onLoad={onLoad} />
      </section>
    </div>
  );
}
