import { useEffect, useState } from 'react';
import { ArrowRight, Download, Upload, Save, X } from 'lucide-react';
import { Button, Input, useToast } from '@/atoms';
import { StepEditor } from '@/organisms';
import { useWsSession } from '@/lib/ws-context';
import type { Pipeline } from '@shared/ws-protocol';
import type { PromptStep } from '@/lib/domain-types';

function blankPipeline(): Pipeline {
  return { name: 'untitled', steps: [{ name: 'Step 1', prompt: '', files: [] }] };
}

export function PipelineEditorPage() {
  const { send, status, currentPipeline, setCurrentPipeline } = useWsSession();
  const disabled = status !== 'open';
  const [pipeline, setPipeline] = useState<Pipeline>(() => currentPipeline ?? blankPipeline());
  const [saveName, setSaveName] = useState('');
  const { show } = useToast();

  // Reset name field when pipeline name changes
  useEffect(() => {
    setSaveName(pipeline.name);
  }, [pipeline.name]);

  const updateSteps = (steps: PromptStep[]) => setPipeline((p) => ({ ...p, steps }));

  const onContinue = () => {
    setCurrentPipeline(pipeline);
    send({
      type: 'nav',
      event: { type: 'editor.complete', pipeline, initialBackendSet: false },
    });
  };

  const onExport = () => send({ type: 'nav', event: { type: 'editor.export', pipeline } });
  const onImport = () => send({ type: 'nav', event: { type: 'editor.import' } });
  const onCancel = () => send({ type: 'nav', event: { type: 'editor.cancel' } });

  const onSave = () => {
    const name = saveName.trim() || pipeline.name.trim();
    if (!name) {
      show({ tone: 'warning', title: 'Name required', description: 'Pick a pipeline name first.' });
      return;
    }
    send({ type: 'pipeline.save', pipeline: { ...pipeline, name }, name });
    show({ tone: 'success', title: 'Saved', description: `Pipeline "${name}" saved.` });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 bg-background p-3 md:flex-row md:items-end md:justify-between">
        <Input
          label="Pipeline name"
          value={pipeline.name}
          onChange={(e) => setPipeline((p) => ({ ...p, name: e.target.value }))}
          containerClassName="md:w-72"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onImport} disabled={disabled} className="min-h-[44px]">
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button variant="secondary" onClick={onExport} disabled={disabled} className="min-h-[44px]">
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="secondary" onClick={onSave} disabled={disabled} className="min-h-[44px]">
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button variant="primary" onClick={onContinue} disabled={disabled || pipeline.steps.length === 0} className="min-h-[44px]">
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={onCancel} className="min-h-[44px]">
            <X className="h-4 w-4" /> Cancel
          </Button>
        </div>
      </div>

      <StepEditor steps={pipeline.steps} onChange={updateSteps} />
    </div>
  );
}
