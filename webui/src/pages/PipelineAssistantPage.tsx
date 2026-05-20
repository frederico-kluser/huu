import { useMemo, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { Button } from '@/atoms';
import { AssistantChat, type AssistantMessage } from '@/organisms';
import { useWsSession } from '@/lib/ws-context';

export function PipelineAssistantPage() {
  const { send, status, assistantChunks, assistantPipeline, lastError } = useWsSession();
  const disabled = status !== 'open';
  const [history, setHistory] = useState<AssistantMessage[]>([]);
  const [streaming, setStreaming] = useState(false);

  const messages = useMemo<AssistantMessage[]>(() => {
    if (streaming && assistantChunks) {
      return [...history, { role: 'assistant', text: assistantChunks }];
    }
    return history;
  }, [history, streaming, assistantChunks]);

  // When server emits assistant.done (pipeline non-null), finalize the stream.
  if (streaming && assistantPipeline) {
    setStreaming(false);
    setHistory((h) => [
      ...h,
      { role: 'assistant', text: assistantChunks || 'Pipeline ready.' },
    ]);
  }

  const onSubmit = (prompt: string) => {
    setHistory((h) => [...h, { role: 'user', text: prompt }]);
    setStreaming(true);
    send({ type: 'assistant.prompt', prompt });
  };

  const onContinue = () => {
    if (!assistantPipeline) return;
    send({ type: 'nav', event: { type: 'assistant.complete', pipeline: assistantPipeline } });
  };

  const onCancel = () => send({ type: 'nav', event: { type: 'assistant.cancel' } });

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pipeline Assistant</h1>
        <div className="flex items-center gap-2">
          {assistantPipeline ? (
            <Button variant="ai" onClick={onContinue} disabled={disabled}>
              Continue to Editor <ArrowRight className="h-4 w-4" />
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onCancel}>
            <X className="h-4 w-4" /> Cancel
          </Button>
        </div>
      </div>
      {lastError ? (
        <div className="rounded-md border border-error/40 bg-error/5 p-2 text-xs text-error">
          {lastError.message}
        </div>
      ) : null}
      {assistantPipeline ? (
        <div className="rounded-md border border-ai/30 bg-ai/5 p-3 text-sm">
          <div className="font-medium text-ai">Pipeline ready: {assistantPipeline.name}</div>
          <div className="text-xs text-foreground/60">
            {assistantPipeline.steps.length} step
            {assistantPipeline.steps.length === 1 ? '' : 's'}
          </div>
        </div>
      ) : null}
      <div className="flex-1 min-h-0">
        <AssistantChat
          messages={messages}
          onSubmit={onSubmit}
          streaming={streaming}
        />
      </div>
    </div>
  );
}
