import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Select, Textarea } from '@/atoms';
import { StepRow } from '@/molecules';
import { cn } from '@/lib/cn';
import type { ModelCatalogEntry, PromptStep } from '@/lib/domain-types';

export interface StepEditorProps {
  steps: PromptStep[];
  onChange: (next: PromptStep[]) => void;
  /** When set, clicking the "Files" button calls this handler with the step index. */
  onPickFiles?: (index: number) => void;
  models?: ModelCatalogEntry[];
  className?: string;
}

function blankStep(): PromptStep {
  return { name: 'New step', prompt: '', files: [] };
}

/** Edit/add/remove/reorder pipeline steps + edit prompt, files, model per step. */
export function StepEditor({ steps, onChange, onPickFiles, models, className }: StepEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const update = (idx: number, patch: Partial<PromptStep>) => {
    onChange(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const move = (idx: number, delta: number) => {
    const ni = idx + delta;
    if (ni < 0 || ni >= steps.length) return;
    const next = steps.slice();
    const [removed] = next.splice(idx, 1);
    next.splice(ni, 0, removed);
    onChange(next);
  };

  const remove = (idx: number) => {
    onChange(steps.filter((_, i) => i !== idx));
    if (editingIndex === idx) setEditingIndex(null);
  };

  const add = () => {
    onChange([...steps, blankStep()]);
    setEditingIndex(steps.length);
  };

  const editing = editingIndex !== null ? steps[editingIndex] : null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <StepRow
            key={i}
            step={step}
            index={i}
            onNameChange={(idx, name) => update(idx, { name })}
            onEdit={(idx) => setEditingIndex(idx)}
            onRemove={remove}
            onMoveUp={(idx) => move(idx, -1)}
            onMoveDown={(idx) => move(idx, 1)}
            canMoveUp={i > 0}
            canMoveDown={i < steps.length - 1}
          />
        ))}
        {steps.length === 0 ? (
          <div className="rounded-md border border-dashed border-foreground/15 p-6 text-center text-sm text-foreground/50">
            No steps yet. Add one below to get started.
          </div>
        ) : null}
      </div>
      <div>
        <Button variant="secondary" onClick={add}>
          <Plus className="h-4 w-4" /> Add step
        </Button>
      </div>

      {editing && editingIndex !== null ? (
        <div className="flex flex-col gap-3 rounded-md border border-foreground/15 bg-foreground/[0.02] p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-foreground/60">
            Editing step #{editingIndex + 1}
          </div>
          <Textarea
            label="Prompt"
            value={editing.prompt}
            onChange={(e) => update(editingIndex, { prompt: e.currentTarget.value })}
            placeholder="Describe what this step should do…"
          />
          <Select
            label="Scope"
            value={editing.scope ?? 'flexible'}
            onChange={(e) => {
              const scope = e.target.value as NonNullable<PromptStep['scope']>;
              // project locks to whole-repo; memory gets its files from the
              // filesFrom memory file at run time — both clear the files array.
              if (scope === 'project' || scope === 'memory') {
                update(editingIndex, { scope, files: [] });
              } else {
                update(editingIndex, { scope });
              }
            }}
            options={[
              { value: 'flexible', label: 'flexible — choose files at edit time' },
              { value: 'project', label: 'project — one agent, whole repo' },
              { value: 'per-file', label: 'per-file — one agent per picked file' },
              { value: 'memory', label: "memory — paths from an earlier step's memory file" },
            ]}
          />
          {(editing.scope ?? 'flexible') === 'memory' ? (
            <Input
              label="Memory file (filesFrom — huu-memory-v1 written by an earlier step)"
              value={editing.filesFrom ?? ''}
              onChange={(e) =>
                update(editingIndex, { filesFrom: e.currentTarget.value || undefined })
              }
              placeholder=".huu/knowledge/study-list.json"
            />
          ) : null}
          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              onClick={() => onPickFiles?.(editingIndex)}
              disabled={
                !onPickFiles ||
                editing.scope === 'project' ||
                editing.scope === 'memory'
              }
            >
              Pick files ({editing.files.length})
            </Button>
            {models && models.length > 0 ? (
              <Select
                label="Model override"
                value={editing.modelId ?? ''}
                onChange={(e) =>
                  update(editingIndex, { modelId: e.target.value || undefined })
                }
                options={[
                  { value: '', label: '(use pipeline default)' },
                  ...models.map((m) => ({ value: m.id, label: m.label })),
                ]}
                containerClassName="flex-1"
              />
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setEditingIndex(null)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
