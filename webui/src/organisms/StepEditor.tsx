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
            (() => {
              const producers = steps
                .slice(0, editingIndex)
                .map((s, i) => ({ index: i, name: s.name, produces: s.produces }))
                .filter((p): p is { index: number; name: string; produces: string } =>
                  Boolean(p.produces),
                );
              const isDeclared = producers.some((p) => p.produces === editing.filesFrom);
              return (
                <div className="flex flex-col gap-2">
                  {producers.length > 0 ? (
                    <Select
                      label="Memory file (filesFrom)"
                      value={isDeclared ? (editing.filesFrom ?? '') : '__custom'}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== '__custom') update(editingIndex, { filesFrom: v || undefined });
                      }}
                      options={[
                        ...producers.map((p) => ({
                          value: p.produces,
                          label: `${p.produces}  ← produced by #${p.index + 1} ${p.name}`,
                        })),
                        { value: '__custom', label: 'custom path (the producer prompt writes it manually)…' },
                      ]}
                    />
                  ) : null}
                  {producers.length === 0 || !isDeclared ? (
                    <Input
                      label={
                        producers.length === 0
                          ? 'Memory file (filesFrom — no earlier step declares "produces" yet)'
                          : 'Custom memory file path'
                      }
                      value={editing.filesFrom ?? ''}
                      onChange={(e) =>
                        update(editingIndex, { filesFrom: e.currentTarget.value || undefined })
                      }
                      placeholder=".huu/memory/targets.json"
                    />
                  ) : null}
                </div>
              );
            })()
          ) : null}
          <Input
            label="Produces (memory file this step writes for a later step — optional; huu appends the format contract at run time)"
            value={editing.produces ?? ''}
            onChange={(e) =>
              update(editingIndex, { produces: e.currentTarget.value || undefined })
            }
            placeholder=".huu/memory/targets.json"
          />
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
