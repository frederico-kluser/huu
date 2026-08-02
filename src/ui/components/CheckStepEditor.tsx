import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { CheckOutcome, CheckStep, Pipeline, PipelineStep } from '../../lib/types.js';
import { DEFAULT_CHECK_MAX_RUNS } from '../../lib/types.js';
import { theme } from '../theme.js';
import { analyzeCheckFeasibility, type FeasibilityResult } from '../../lib/assistant-check-feasibility.js';
import { t } from '../../lib/i18n/index.js';

interface Props {
  initialStep: CheckStep;
  /** All steps — used to populate destination dropdowns. */
  allSteps: PipelineStep[];
  pipeline: Pipeline;
  apiKey: string;
  repoRoot: string;
  onSave: (step: CheckStep) => void;
  onCancel: () => void;
  /** Backend-aware context for feasibility analysis (Azure routing). */
  llmContext?: import('../../lib/llm-client-factory.js').LlmClientContext;
}

type Field = 'name' | 'condition' | 'maxRuns' | 'outcomes' | 'feasibility';
type Mode = 'selecting' | 'editing-name' | 'editing-condition' | 'editing-maxruns' | 'editing-outcomes';

/**
 * Editor for CheckStep nodes. Lives next to StepEditor; PipelineEditor
 * routes here whenever the active step has `type === 'check'`.
 *
 * UX shape:
 *   ↑/↓             move between fields
 *   ENTER           edit the focused field
 *   ESC             back / save
 *   In outcomes editor: A add, D delete, S toggle default, ENTER edit row
 */
export function CheckStepEditor({
  initialStep,
  allSteps,
  pipeline,
  apiKey,
  repoRoot,
  onSave,
  onCancel,
  llmContext,
}: Props): React.JSX.Element {
  const [step, setStep] = useState<CheckStep>(initialStep);
  const [field, setField] = useState<Field>('name');
  const [mode, setMode] = useState<Mode>('selecting');
  const [feasibility, setFeasibility] = useState<FeasibilityResult | 'loading' | null>(null);

  const valid = isValidCheckStep(step, allSteps);

  useInput((input, key) => {
    if (mode === 'editing-name' || mode === 'editing-condition' || mode === 'editing-maxruns') {
      // TextInput owns the keys; ESC bails.
      if (key.escape) setMode('selecting');
      return;
    }
    if (mode === 'editing-outcomes') {
      // sub-editor handled below
      return;
    }
    if (key.escape) {
      if (valid) onSave(step);
      else onCancel();
      return;
    }
    if (key.upArrow) {
      setField(prevField);
    } else if (key.downArrow || key.tab) {
      setField(nextField);
    } else if (key.return) {
      if (field === 'name') setMode('editing-name');
      else if (field === 'condition') setMode('editing-condition');
      else if (field === 'maxRuns') setMode('editing-maxruns');
      else if (field === 'outcomes') setMode('editing-outcomes');
      else if (field === 'feasibility') void runFeasibility();
    }
  });

  const runFeasibility = async (): Promise<void> => {
    setFeasibility('loading');
    try {
      const result = await analyzeCheckFeasibility({
        step,
        pipeline,
        apiKey,
        repoRoot,
        llmContext,
      });
      setFeasibility(result);
      if (result.instructionDraft) {
        setStep((s) => ({ ...s, instructionDraft: result.instructionDraft }));
      }
    } catch (err) {
      setFeasibility({
        feasible: false,
        reason: err instanceof Error ? err.message : String(err),
        instructionDraft: '',
        warnings: [],
      });
    }
  };

  if (mode === 'editing-outcomes') {
    return (
      <OutcomesEditor
        outcomes={step.outcomes}
        allSteps={allSteps}
        onSave={(outcomes) => {
          setStep((s) => ({ ...s, outcomes }));
          setMode('selecting');
        }}
        onCancel={() => setMode('selecting')}
      />
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor={theme.ai} paddingX={1} flexDirection="column" width="100%">
        <Box>
          <Text bold color={theme.ai}>
            {t('tui.check.title')}
          </Text>
          <Text dimColor>  ·  </Text>
          {valid ? (
            <Text color="green">{t('tui.check.ready')}</Text>
          ) : (
            <Text color="red">{t('tui.check.incomplete')}</Text>
          )}
        </Box>

        {row(t('common.field.name'), field === 'name', mode === 'editing-name', step.name, (v) => setStep((s) => ({ ...s, name: v })), () => setMode('selecting'))}

        <Box marginTop={1}>
          <Text color="cyan">{field === 'condition' ? '› ' : '  '}</Text>
          <Box width={20}>
            <Text color={field === 'condition' ? 'cyan' : undefined}>{t('tui.check.field_condition')}</Text>
          </Box>
          {mode === 'editing-condition' ? (
            <TextInput
              value={step.condition}
              onChange={(v) => setStep((s) => ({ ...s, condition: v }))}
              onSubmit={() => setMode('selecting')}
            />
          ) : (
            <Text color={step.condition ? undefined : 'red'}>
              {step.condition || <Text dimColor italic>{t('tui.check.condition_empty')}</Text>}
            </Text>
          )}
        </Box>

        {row(
          t('tui.check.field_max_runs'),
          field === 'maxRuns',
          mode === 'editing-maxruns',
          String(step.maxRuns ?? DEFAULT_CHECK_MAX_RUNS),
          (v) => {
            const n = Number(v.trim());
            if (Number.isInteger(n) && n > 0) setStep((s) => ({ ...s, maxRuns: n }));
          },
          () => setMode('selecting'),
        )}

        <Box marginTop={1}>
          <Text color="cyan">{field === 'outcomes' ? '› ' : '  '}</Text>
          <Box width={20}>
            <Text color={field === 'outcomes' ? 'cyan' : undefined}>{t('tui.check.field_outcomes')}</Text>
          </Box>
          <Text>
            {step.outcomes.length === 1
              ? t('tui.check.outcome_one', { count: step.outcomes.length })
              : t('tui.check.outcome_other', { count: step.outcomes.length })}
            {!step.outcomes.some((o) => o.default) && (
              <Text color="red">{`  · ${t('tui.check.no_default')}`}</Text>
            )}
          </Text>
        </Box>

        {step.outcomes.length > 0 && (
          <Box flexDirection="column" marginLeft={4}>
            {step.outcomes.map((o, i) => (
              <Box key={i}>
                <Text dimColor>· </Text>
                <Text color={theme.ai}>{o.label}</Text>
                <Text dimColor> → </Text>
                <Text>{o.nextStepName}</Text>
                {o.default && <Text color="green">{`  (${t('tui.check.default_tag')})`}</Text>}
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={1}>
          <Text color="cyan">{field === 'feasibility' ? '› ' : '  '}</Text>
          <Box width={20}>
            <Text color={field === 'feasibility' ? 'cyan' : undefined}>{t('tui.check.field_feasibility')}</Text>
          </Box>
          {feasibility === null ? (
            <Text dimColor>{t('tui.check.feasibility_idle')}</Text>
          ) : feasibility === 'loading' ? (
            <Text color="yellow">{t('tui.check.feasibility_loading')}</Text>
          ) : (
            <Text color={feasibility.feasible ? 'green' : 'red'}>
              {t('tui.check.feasibility_result', {
                verdict: feasibility.feasible ? t('tui.check.feasible') : t('tui.check.not_feasible'),
                reason: feasibility.reason.slice(0, 80),
              })}
            </Text>
          )}
        </Box>

        {feasibility && feasibility !== 'loading' && feasibility.warnings.length > 0 && (
          <Box flexDirection="column" marginLeft={4}>
            {feasibility.warnings.map((w, i) => (
              <Text key={i} color="yellow">⚠ {w}</Text>
            ))}
          </Box>
        )}

        {step.instructionDraft && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{t('tui.check.instruction_draft')}</Text>
            <Text wrap="wrap">{step.instructionDraft}</Text>
          </Box>
        )}

        <Box marginTop={2} flexDirection="column">
          <Text dimColor>
            <Text bold>↑↓</Text> {t('common.action.select')} · <Text bold>ENTER</Text>{' '}
            {t('common.action.edit')} · <Text bold>ESC</Text>{' '}
            {valid ? (
              <Text color="green">{t('common.action.save')}</Text>
            ) : (
              <Text color="red">{t('common.action.cancel')}</Text>
            )}
          </Text>
        </Box>
      </Box>
    </Box>
  );

  function nextField(f: Field): Field {
    const order: Field[] = ['name', 'condition', 'maxRuns', 'outcomes', 'feasibility'];
    return order[Math.min(order.length - 1, order.indexOf(f) + 1)]!;
  }
  function prevField(f: Field): Field {
    const order: Field[] = ['name', 'condition', 'maxRuns', 'outcomes', 'feasibility'];
    return order[Math.max(0, order.indexOf(f) - 1)]!;
  }
}

function row(
  label: string,
  focused: boolean,
  editing: boolean,
  value: string,
  setValue: (v: string) => void,
  onSubmit: () => void,
): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text color="cyan">{focused ? '› ' : '  '}</Text>
      <Box width={20}>
        <Text color={focused ? 'cyan' : undefined}>{label}</Text>
      </Box>
      {editing ? (
        <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
      ) : (
        <Text color={value ? undefined : 'red'}>{value || <Text dimColor italic>{t('common.empty')}</Text>}</Text>
      )}
    </Box>
  );
}

interface OutcomesEditorProps {
  outcomes: CheckOutcome[];
  allSteps: PipelineStep[];
  onSave: (outcomes: CheckOutcome[]) => void;
  onCancel: () => void;
}

function OutcomesEditor({ outcomes, allSteps, onSave, onCancel }: OutcomesEditorProps): React.JSX.Element {
  const [items, setItems] = useState<CheckOutcome[]>(outcomes.length > 0 ? outcomes : [
    { label: 'ok', nextStepName: '', default: true },
  ]);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<'label' | 'next' | null>(null);

  useInput((input, key) => {
    if (editing) {
      if (key.escape) setEditing(null);
      return;
    }
    if (key.escape) {
      onSave(items);
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(items.length - 1, c + 1));
    else if (input === 'a' || input === 'A') {
      setItems((arr) => [...arr, { label: `outcome-${arr.length + 1}`, nextStepName: '' }]);
      setCursor(items.length);
    } else if ((input === 'd' || input === 'D') && items.length > 1) {
      setItems((arr) => arr.filter((_, i) => i !== cursor));
      setCursor((c) => Math.max(0, c - 1));
    } else if (input === 's' || input === 'S') {
      setItems((arr) => arr.map((o, i) => ({ ...o, default: i === cursor })));
    } else if (input === 'l' || input === 'L') {
      setEditing('label');
    } else if (input === 'n' || input === 'N') {
      setEditing('next');
    } else if (input === 'c' || input === 'C') {
      // cycle nextStepName through allSteps
      const stepNames = allSteps.map((s) => s.name).filter(Boolean);
      if (stepNames.length === 0) return;
      const cur = items[cursor]!.nextStepName;
      const idx = stepNames.indexOf(cur);
      const next = stepNames[(idx + 1) % stepNames.length]!;
      setItems((arr) => arr.map((o, i) => (i === cursor ? { ...o, nextStepName: next } : o)));
    }
  });

  const updateAt = (patch: Partial<CheckOutcome>): void => {
    setItems((arr) => arr.map((o, i) => (i === cursor ? { ...o, ...patch } : o)));
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor={theme.ai} paddingX={1} flexDirection="column">
        <Text bold color={theme.ai}>
          {t('tui.check.outcomes_title', { count: items.length })}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {items.map((o, i) => {
            const isCursor = i === cursor;
            return (
              <Box key={i}>
                <Text color={isCursor ? 'cyan' : undefined}>
                  {isCursor ? '› ' : '  '}
                </Text>
                {isCursor && editing === 'label' ? (
                  <TextInput
                    value={o.label}
                    onChange={(v) => updateAt({ label: v })}
                    onSubmit={() => setEditing(null)}
                  />
                ) : (
                  <Text bold>{o.label}</Text>
                )}
                <Text dimColor> → </Text>
                {isCursor && editing === 'next' ? (
                  <TextInput
                    value={o.nextStepName}
                    onChange={(v) => updateAt({ nextStepName: v })}
                    onSubmit={() => setEditing(null)}
                  />
                ) : (
                  <Text color={o.nextStepName && allSteps.some((s) => s.name === o.nextStepName) ? undefined : 'red'}>
                    {o.nextStepName || t('tui.check.unset')}
                  </Text>
                )}
                {o.default && <Text color="green">{`  (${t('tui.check.default_tag')})`}</Text>}
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            <Text bold>↑↓</Text> {t('common.action.select')} · <Text bold>A</Text>{' '}
            {t('common.action.add')} · <Text bold>D</Text> {t('common.action.delete')} ·{' '}
            <Text bold>S</Text> {t('tui.check.hint_set_default')}
          </Text>
          <Text dimColor>
            <Text bold>L</Text> {t('tui.check.hint_edit_label')} · <Text bold>N</Text>{' '}
            {t('tui.check.hint_edit_next')} · <Text bold>C</Text> {t('tui.check.hint_cycle_next')} ·{' '}
            <Text bold>ESC</Text> {t('common.action.save')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function isValidCheckStep(step: CheckStep, allSteps: PipelineStep[]): boolean {
  if (!step.name || !step.condition || step.outcomes.length === 0) return false;
  const defaults = step.outcomes.filter((o) => o.default).length;
  if (defaults !== 1) return false;
  const names = new Set(allSteps.map((s) => s.name));
  for (const o of step.outcomes) {
    if (!o.label || !o.nextStepName) return false;
    if (!names.has(o.nextStepName)) return false;
  }
  return true;
}
