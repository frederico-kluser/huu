import { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { Button, IconButton, Input } from '@/atoms';
import { useWsSession } from '@/lib/ws-context';
import type { ApiKeySpec, Screen } from '@shared/ws-protocol';

export interface ApiKeyPageProps {
  screen: Extract<Screen, { kind: 'api-key' }>;
}

export function ApiKeyPage({ screen }: ApiKeyPageProps) {
  const { send, status } = useWsSession();
  const disabled = status !== 'open';
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saveGlobally, setSaveGlobally] = useState(false);

  const set = (k: string, v: string) => setValues((m) => ({ ...m, [k]: v }));
  const toggle = (k: string) => setRevealed((m) => ({ ...m, [k]: !m[k] }));

  const onSubmit = () => {
    send({ type: 'apiKey.submit', values, saveGlobally });
  };

  const onCancel = () => send({ type: 'nav', event: { type: 'apiKey.cancel' } });

  const allFilled = screen.missing.every(
    (spec: ApiKeySpec) => (values[spec.name] ?? '').trim().length > 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">API keys required</h1>
        <Button variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>

      <p className="text-sm text-foreground/60">
        huu needs the following credentials to run the selected backend.
      </p>

      <div className="flex flex-col gap-3">
        {screen.missing.map((spec) => {
          const shown = !!revealed[spec.name];
          return (
            <div key={spec.name} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground/80" htmlFor={`k-${spec.name}`}>
                {spec.label} <span className="font-mono text-foreground/50">({spec.envVar})</span>
              </label>
              {spec.hint ? (
                <span className="text-xs text-foreground/50">{spec.hint}</span>
              ) : null}
              <div className="flex items-center gap-2">
                <Input
                  id={`k-${spec.name}`}
                  type={shown ? 'text' : 'password'}
                  value={values[spec.name] ?? ''}
                  onChange={(e) => set(spec.name, e.target.value)}
                  placeholder={spec.validatePrefix ?? ''}
                  containerClassName="flex-1"
                />
                <IconButton
                  aria-label={shown ? 'Hide' : 'Show'}
                  variant="ghost"
                  size="sm"
                  onClick={() => toggle(spec.name)}
                >
                  {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={saveGlobally}
          onChange={(e) => setSaveGlobally(e.target.checked)}
        />
        Save globally (to <code className="font-mono text-xs">~/.config/huu/config.json</code>)
      </label>

      <div>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={disabled || !allFilled}
          className="min-h-[44px]"
        >
          Submit
        </Button>
      </div>
    </div>
  );
}
