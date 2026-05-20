import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '@/atoms';
import { useWsSession } from '@/lib/ws-context';

const QUICK = [5, 10, 20, 30];

export function TimeoutPromptPage() {
  const { send } = useWsSession();
  const [minutes, setMinutes] = useState(10);

  const onSubmit = () =>
    send({ type: 'nav', event: { type: 'timeout.submit', minutes } });

  const onCancel = () => send({ type: 'nav', event: { type: 'timeout.cancel' } });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Per-card timeout</h1>
        <Button variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>

      <p className="text-sm text-foreground/60">
        How long should each agent task be allowed to run before it's killed and retried?
      </p>

      <Input
        label="Minutes"
        type="number"
        min={1}
        max={120}
        value={String(minutes)}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) setMinutes(Math.max(1, Math.min(120, n)));
        }}
        containerClassName="md:w-40"
      />

      <div className="flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <Button
            key={q}
            variant={q === minutes ? 'primary' : 'secondary'}
            onClick={() => setMinutes(q)}
            className="min-h-[44px]"
          >
            {q} min
          </Button>
        ))}
      </div>

      <div>
        <Button variant="primary" onClick={onSubmit} className="min-h-[44px]">
          Submit
        </Button>
      </div>
    </div>
  );
}
