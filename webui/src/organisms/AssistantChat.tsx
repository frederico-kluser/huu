import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Button, Spinner, Textarea } from '@/atoms';
import { cn } from '@/lib/cn';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantChatProps {
  messages: AssistantMessage[];
  onSubmit: (prompt: string) => void;
  streaming?: boolean;
  placeholder?: string;
  className?: string;
}

/** Chat panel in the AI color theme. Used for the Pipeline Assistant. */
export function AssistantChat({
  messages,
  onSubmit,
  streaming = false,
  placeholder = 'Describe your pipeline…',
  className,
}: AssistantChatProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    onSubmit(text);
    setDraft('');
  };

  return (
    <div className={cn('flex h-full flex-col rounded-lg border border-ai/30 bg-background', className)}>
      <header className="flex items-center gap-2 border-b border-ai/20 px-3 py-2">
        <Sparkles className="h-4 w-4 text-ai" />
        <span className="text-sm font-medium text-ai">Pipeline Assistant</span>
        {streaming ? <Spinner size="sm" variant="ai" /> : null}
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="p-4 text-center text-sm text-foreground/50">
            Ask the assistant to draft a pipeline from a description.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                  m.role === 'user'
                    ? 'self-end bg-info/10 text-foreground'
                    : 'self-start bg-ai/10 text-foreground',
                )}
              >
                {m.text}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="flex items-end gap-2 border-t border-ai/20 p-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder={placeholder}
          rows={2}
          containerClassName="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          variant="ai"
          onClick={submit}
          disabled={streaming || draft.trim().length === 0}
          loading={streaming}
        >
          <Send className="h-4 w-4" />
          Send
        </Button>
      </footer>
    </div>
  );
}
