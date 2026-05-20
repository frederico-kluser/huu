import { useEffect, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button, Textarea } from '@/atoms';
import { useWsSession } from '@/lib/ws-context';

export function PipelineImportPastePage() {
  const { send, status, lastError } = useWsSession();
  const disabled = status !== 'open';
  const [json, setJson] = useState('');
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);

  // Surface server errors that arrived after our submit.
  useEffect(() => {
    if (submittedAt && lastError && lastError.at >= submittedAt) {
      setSubmittedAt(null);
    }
  }, [lastError, submittedAt]);

  const onImport = () => {
    if (!json.trim()) return;
    setSubmittedAt(Date.now());
    send({ type: 'pipeline.import', json });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Paste pipeline JSON</h1>
        <Button variant="ghost" onClick={() => send({ type: 'nav', event: { type: 'importPaste.cancel' } })}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>

      <Textarea
        label="Pipeline JSON"
        value={json}
        onChange={(e) => setJson(e.currentTarget.value)}
        placeholder='{"name":"…","steps":[…]}'
        rows={14}
      />

      {lastError ? (
        <div className="rounded-md border border-error/40 bg-error/5 p-2 text-xs text-error">
          {lastError.message}
        </div>
      ) : null}

      <div>
        <Button
          variant="primary"
          onClick={onImport}
          disabled={disabled || !json.trim()}
          loading={submittedAt !== null && !lastError}
          className="min-h-[44px]"
        >
          <Upload className="h-4 w-4" /> Import
        </Button>
      </div>
    </div>
  );
}
