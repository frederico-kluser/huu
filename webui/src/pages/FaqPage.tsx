import { ArrowLeft } from 'lucide-react';
import { Button } from '@/atoms';
import { useWsSession } from '@/lib/ws-context';

export function FaqPage() {
  const { send, status } = useWsSession();
  const disabled = status !== 'open';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">FAQ</h1>
          <p className="text-sm text-foreground/60">Short answers to the most common questions.</p>
        </div>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => send({ type: 'nav', event: { type: 'faq.back' } })}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </header>

      <dl className="flex flex-col gap-4">
        <Q q="What is huu?">
          A TUI/web UI that orchestrates pipelines of LLM agents in parallel, each isolated in its
          own git worktree, with deterministic merge at the end of every stage.
        </Q>
        <Q q="What is a pipeline?">
          A sequence of steps. Each step decomposes into N tasks that run in parallel; the stage
          only advances after merging the tasks into the integration worktree.
        </Q>
        <Q q="Does huu modify my repository?">
          No. Every run happens in sibling git worktrees. The current branch stays intact; the
          result becomes a new branch that you decide whether to merge.
        </Q>
        <Q q="Which LLM backends are supported?">
          <b>pi</b> (OpenRouter — default), <b>copilot</b> (GitHub subscription), and <b>stub</b>{' '}
          (LLM-free mock, for smoke tests).
        </Q>
        <Q q="Do I need an API key?">
          Yes for <b>pi</b> (OPENROUTER_API_KEY). <b>copilot</b> uses your GitHub subscription. The
          key is requested on demand and saved locally.
        </Q>
      </dl>
    </div>
  );
}

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-foreground/15 bg-background p-4">
      <dt className="font-medium text-foreground">{q}</dt>
      <dd className="text-sm text-foreground/70">{children}</dd>
    </div>
  );
}
