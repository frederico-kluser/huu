import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button, Input } from '@/atoms';
import { useWsSession } from '@/lib/ws-context';

export function PipelineImportCustomPage() {
  const { send, status, lastError } = useWsSession();
  const disabled = status !== 'open';
  const [path, setPath] = useState('');

  // TODO(server): no dedicated client message for "import from path" — the
  // server-side flow expects a `pipeline.import` with JSON. We send the path
  // through `pipeline.import` and let the server interpret. Once a dedicated
  // message exists, replace with `pipeline.importFromPath`.
  const onLoad = () => {
    if (!path.trim()) return;
    send({ type: 'pipeline.import', json: JSON.stringify({ __path: path.trim() }) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Import from custom path</h1>
        <Button variant="ghost" onClick={() => send({ type: 'nav', event: { type: 'importCustom.cancel' } })}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>

      <Input
        label="File path"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/abs/path/to/pipeline.json"
      />

      {lastError ? (
        <div className="rounded-md border border-error/40 bg-error/5 p-2 text-xs text-error">
          {lastError.message}
        </div>
      ) : null}

      <div>
        <Button
          variant="primary"
          onClick={onLoad}
          disabled={disabled || !path.trim()}
          className="min-h-[44px]"
        >
          <Upload className="h-4 w-4" /> Load
        </Button>
      </div>
    </div>
  );
}
