import { Download, X } from 'lucide-react';
import { Button } from '@/atoms';
import { useWsSession } from '@/lib/ws-context';

export function PipelineExportPage() {
  const { send, currentPipeline } = useWsSession();
  const pipeline = currentPipeline;

  const onDownload = () => {
    if (!pipeline) return;
    const payload = {
      _format: 'huu-pipeline-v1',
      exportedAt: new Date().toISOString(),
      pipeline,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pipeline.name || 'pipeline'}.pipeline.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    send({ type: 'nav', event: { type: 'export.complete' } });
  };

  const onCancel = () => send({ type: 'nav', event: { type: 'export.cancel' } });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Export Pipeline</h1>
        <Button variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>

      {pipeline ? (
        <>
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-foreground/15 bg-foreground/[0.02] p-3 font-mono text-xs">
            {JSON.stringify(pipeline, null, 2)}
          </pre>
          <div>
            <Button variant="primary" onClick={onDownload} className="min-h-[44px]">
              <Download className="h-4 w-4" /> Download
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-foreground/15 p-6 text-center text-sm text-foreground/50">
          No pipeline loaded.
        </div>
      )}
    </div>
  );
}
