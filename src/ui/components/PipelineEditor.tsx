import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import type { Pipeline, PipelineStep, PromptStep, CheckStep, WorkStep } from '../../lib/types.js';
import {
  DEFAULT_CARD_TIMEOUT_MS,
  DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_CHECK_MAX_RUNS,
  isCheckStep,
  isWorkStep,
} from '../../lib/types.js';
import { StepEditor } from './StepEditor.js';
import { CheckStepEditor } from './CheckStepEditor.js';
import { ModelSelectorOverlay } from './ModelSelectorOverlay.js';
import { log as dlog, bump as dbump } from '../../lib/debug-logger.js';
import { savePipelineToMemory } from '../../lib/pipeline-io.js';
import { theme } from '../theme.js';
import { ActionBar, type ActionHint } from './ActionBar.js';
import { t, translate } from '../../lib/i18n/index.js';

interface Props {
  initialPipeline?: Pipeline;
  sourceName?: string;
  repoRoot: string;
  onComplete: (pipeline: Pipeline) => void;
  onImport: () => void;
  onExport: (pipeline: Pipeline) => void;
  onCancel: () => void;
  /** OpenRouter key drilled to StepEditor → FileMultiSelect for Smart Select. */
  apiKey: string;
  /** Backend-aware context for Smart Select (Azure routing). */
  llmContext?: import('../../lib/llm-client-factory.js').LlmClientContext;
}

const EMPTY_STEP: WorkStep = { type: 'work', name: 'New step', prompt: '', files: [] };

function emptyCheckStep(name: string): CheckStep {
  return {
    type: 'check',
    name,
    condition: '',
    outcomes: [{ label: 'ok', nextStepName: '', default: true }],
    maxRuns: DEFAULT_CHECK_MAX_RUNS,
  };
}

function isStepValid(step: PipelineStep, allSteps: PipelineStep[]): boolean {
  if (!step.name) return false;
  if (isCheckStep(step)) {
    if (!step.condition || step.outcomes.length === 0) return false;
    const defaults = step.outcomes.filter((o) => o.default).length;
    if (defaults !== 1) return false;
    const names = new Set(allSteps.map((s) => s.name));
    return step.outcomes.every((o) => o.label && o.nextStepName && names.has(o.nextStepName));
  }
  if (step.scope === 'memory') return Boolean(step.prompt) && Boolean(step.filesFrom);
  return Boolean(step.prompt) && (step.scope !== 'per-file' || step.files.length > 0);
}

type Mode =
  | { kind: 'pattern' }
  | { kind: 'list' }
  | { kind: 'editing'; index: number }
  | { kind: 'naming-pipeline' }
  | { kind: 'editing-settings' };

type Pattern = 'discover-act' | 'per-file' | 'fan-join' | 'audit-judge' | 'blank';

// Only the GLYPH is fixed here; label + hint come from the catalog. The
// scaffolded step names/prompts below stay in English on purpose: they are
// pipeline DATA handed to an LLM, not UI chrome.
const PATTERNS: { id: Pattern; glyph: string }[] = [
  { id: 'discover-act', glyph: '🔍' },
  { id: 'per-file', glyph: '📄' },
  { id: 'fan-join', glyph: '◇' },
  { id: 'audit-judge', glyph: '🧪' },
  { id: 'blank', glyph: '▢ ' },
];

function patternLabel(id: Pattern): string {
  return translate(`tui.editor.pattern_${id.replace('-', '_')}`);
}

function patternHint(id: Pattern): string {
  return translate(`tui.editor.pattern_${id.replace('-', '_')}_hint`);
}

function scaffold(pattern: Pattern): Pipeline {
  if (pattern === 'discover-act') {
    const memoryPath = '.huu/memory/discovered.json';
    return {
      name: 'discover-and-act',
      steps: [
        {
          type: 'work',
          name: '1. Discover targets',
          prompt:
            'Scan the project and decide which files need <describe the work — e.g. "a performance fix">. For each file you pick, explain in one line WHY — that line becomes the next agent\'s $hint.',
          files: [],
          scope: 'project',
          // huu appends the MEMORY CONTRACT (exact path + format + cap) to
          // this prompt at run time — the author never writes it.
          produces: memoryPath,
        },
        {
          type: 'work',
          name: '2. Act on each target',
          prompt: 'Apply <your fix / procedure> to $file.\nThe discovery note about this file: $hint',
          files: [],
          scope: 'memory',
          filesFrom: memoryPath,
        },
      ],
    };
  }
  if (pattern === 'per-file') {
    return {
      name: 'per-file-transform',
      steps: [
        {
          type: 'work',
          name: '1. Transform $file',
          prompt: 'Apply <your transformation> to $file. Write only to $file.',
          files: [],
          scope: 'per-file',
        },
      ],
    };
  }
  if (pattern === 'fan-join') {
    return {
      name: 'fan-out-join',
      steps: [
        {
          type: 'work',
          name: '1. Setup',
          prompt: 'Prepare whatever both branches need: <e.g. install deps, write a shared plan file>.',
          files: [],
          scope: 'project',
          dependsOn: [],
        },
        {
          type: 'work',
          name: '2. Branch A',
          prompt: '<first independent analysis/transform — runs in parallel with Branch B>',
          files: [],
          scope: 'project',
          dependsOn: ['1. Setup'],
        },
        {
          type: 'work',
          name: '3. Branch B',
          prompt: '<second independent analysis/transform — runs in parallel with Branch A>',
          files: [],
          scope: 'project',
          dependsOn: ['1. Setup'],
        },
        {
          type: 'work',
          name: '4. Join',
          prompt: 'Combine the results of Branch A and Branch B into <the final artifact>. Both merges are visible in this worktree.',
          files: [],
          scope: 'project',
          dependsOn: ['2. Branch A', '3. Branch B'],
        },
      ],
    };
  }
  if (pattern === 'audit-judge') {
    return {
      name: 'audit-with-judge',
      steps: [
        {
          type: 'work',
          name: '1. Audit',
          prompt:
            'Audit the project for <topic>. REPORT-ONLY: write your findings to .huu/audits/<topic>.md and touch nothing else.',
          files: [],
          scope: 'project',
        },
        {
          type: 'check',
          name: '2. Validate report',
          condition:
            'The report at .huu/audits/<topic>.md exists, every section is filled, and its numbers are internally consistent.',
          maxRuns: 2,
          outcomes: [
            { label: 'approved', nextStepName: '3. Finalize', default: true },
            { label: 'rework', nextStepName: '1. Audit' },
          ],
        },
        {
          type: 'work',
          name: '3. Finalize',
          prompt: 'Append a final "sealed" section to the report with the date and totals.',
          files: [],
          scope: 'project',
        },
      ],
    };
  }
  return { name: 'my-pipeline', steps: [{ ...EMPTY_STEP }] };
}

/** What is wrong with this step and WHICH KEY fixes it (actionable validation). */
function stepProblem(step: PipelineStep, allSteps: PipelineStep[]): string | null {
  if (!step.name) return t('tui.editor.prob_unnamed');
  if (step.dependsOn !== undefined) {
    const selfIdx = allSteps.findIndex((s) => s.name === step.name);
    for (const dep of step.dependsOn) {
      const depIdx = allSteps.findIndex((s) => s.name === dep);
      if (depIdx === -1) return t('tui.editor.prob_dep_unknown', { dep });
      if (depIdx >= selfIdx) return t('tui.editor.prob_dep_not_earlier', { dep });
    }
  }
  if (isCheckStep(step)) {
    if (!step.condition) return t('tui.editor.prob_no_condition');
    const defaults = step.outcomes.filter((o) => o.default).length;
    if (defaults !== 1) return t('tui.editor.prob_default_outcome');
    const names = new Set(allSteps.map((s) => s.name));
    const bad = step.outcomes.find((o) => !o.label || !o.nextStepName || !names.has(o.nextStepName));
    if (bad) return t('tui.editor.prob_outcome_dangling', { label: bad.label || '?' });
    return null;
  }
  if (!step.prompt) return t('tui.editor.prob_no_prompt');
  if (step.scope === 'memory' && !step.filesFrom) {
    return t('tui.editor.prob_memory_unlinked');
  }
  if (step.scope === 'per-file' && step.files.length === 0) {
    return t('tui.editor.prob_per_file_empty');
  }
  return null;
}

function msToMin(ms: number): string {
  return (ms / 60_000).toString();
}

function minToMs(min: string): number | null {
  const trimmed = min.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 60_000);
}

function parseRetries(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 3) return null;
  return n;
}

const FULL_CLEAR = '\x1b[3J';

// Two full-width footer rows. Navigation keys are muted (info); the two
// most important actions — G run (success) and ESC back (error) — are
// colored and bold so they stand out.
// Functions, not consts: a module-level `t()` would translate at IMPORT time,
// before `initI18n()` has resolved the locale (and against this repo's
// "module bodies stay pure" rule).
function editorNavHints(): ActionHint[] {
  return [
    { key: '↑↓', label: t('common.action.select'), color: theme.info },
    { key: 'SHIFT+↑↓', label: t('tui.editor.hint_reorder'), color: theme.info },
    { key: 'ENTER', label: t('common.action.edit'), color: theme.info },
    { key: 'N', label: t('tui.editor.hint_new_work'), color: theme.info },
    { key: 'C', label: t('tui.editor.hint_new_check'), color: theme.info },
    { key: 'D', label: t('common.action.delete'), color: theme.info },
  ];
}
function editorActionHints(): ActionHint[] {
  return [
    { key: 'R', label: t('tui.editor.hint_rename'), color: theme.info },
    { key: 'T', label: t('tui.editor.hint_settings'), color: theme.info },
    { key: 'I', label: t('tui.editor.hint_import'), color: theme.info },
    { key: 'S', label: t('common.action.save'), color: theme.info },
    { key: 'G', label: t('common.action.run'), color: theme.success, bold: true },
    { key: 'ESC', label: t('common.action.back'), color: theme.error, bold: true },
  ];
}

export function PipelineEditor({
  initialPipeline,
  sourceName,
  repoRoot,
  onComplete,
  onImport,
  onExport,
  onCancel,
  apiKey,
  llmContext,
}: Props): React.JSX.Element {
  const { stdout } = useStdout();
  const [pipeline, setPipeline] = useState<Pipeline>(
    initialPipeline ?? { name: 'my-pipeline', steps: [{ ...EMPTY_STEP }] },
  );
  const [cursor, setCursor] = useState(0);
  // Fresh pipelines start at the pattern picker (pre-loaded templates beat a
  // blank screen); existing ones open straight on the list.
  const [mode, setMode] = useState<Mode>(
    initialPipeline ? { kind: 'list' } : { kind: 'pattern' },
  );

  useEffect(() => {
    if (mode.kind === 'list' && stdout.isTTY) {
      stdout.write(FULL_CLEAR);
    }
  }, [mode.kind, stdout]);

  useEffect(() => {
    dlog('mount', 'PipelineEditor', { hasInitial: Boolean(initialPipeline) });
    return () => dlog('mount', 'PipelineEditor.unmount');
  }, [initialPipeline]);

  useEffect(() => {
    if (sourceName) {
      savePipelineToMemory(pipeline);
    }
  }, [pipeline, sourceName]);

  useEffect(() => {
    if (sourceName && pipeline.name === sourceName) {
      savePipelineToMemory(pipeline);
    }
  }, [pipeline, sourceName]);

  useInput((input, key) => {
    dbump('input.PipelineEditor');
    dlog('input', 'PipelineEditor.useInput', {
      mode: mode.kind,
      input,
      escape: key.escape,
      return: key.return,
      upArrow: key.upArrow,
      downArrow: key.downArrow,
      shift: key.shift,
    });
    if (mode.kind !== 'list') return;
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow && key.shift && cursor > 0) {
      setPipeline((p) => {
        const steps = [...p.steps];
        [steps[cursor - 1], steps[cursor]] = [steps[cursor]!, steps[cursor - 1]!];
        return { ...p, steps };
      });
      setCursor((c) => c - 1);
    } else if (key.downArrow && key.shift && cursor < pipeline.steps.length - 1) {
      setPipeline((p) => {
        const steps = [...p.steps];
        [steps[cursor], steps[cursor + 1]] = [steps[cursor + 1]!, steps[cursor]!];
        return { ...p, steps };
      });
      setCursor((c) => c + 1);
    } else if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(pipeline.steps.length - 1, c + 1));
    } else if (input === 'n' || input === 'N') {
      setPipeline((p) => ({
        ...p,
        steps: [...p.steps, { ...EMPTY_STEP, name: `Step ${p.steps.length + 1}` }],
      }));
      setCursor(pipeline.steps.length);
    } else if (input === 'c' || input === 'C') {
      setPipeline((p) => ({
        ...p,
        steps: [...p.steps, emptyCheckStep(`Check ${p.steps.length + 1}`)],
      }));
      setCursor(pipeline.steps.length);
    } else if ((input === 'd' || input === 'D') && pipeline.steps.length > 1) {
      setPipeline((p) => ({ ...p, steps: p.steps.filter((_, i) => i !== cursor) }));
      setCursor((c) => Math.max(0, c - 1));
    } else if (input === 'r' || input === 'R') {
      setMode({ kind: 'naming-pipeline' });
    } else if (input === 't' || input === 'T') {
      setMode({ kind: 'editing-settings' });
    } else if (input === 'i' || input === 'I') {
      onImport();
    } else if (input === 's' || input === 'S') {
      onExport(pipeline);
    } else if (key.return) {
      // ENTER is the only way to open the step editor.
      setMode({ kind: 'editing', index: cursor });
    } else if (input === 'g' || input === 'G') {
      const allValid = pipeline.steps.every((s) => isStepValid(s, pipeline.steps));
      dlog('action', 'PipelineEditor.G_pressed', {
        allValid,
        stepCount: pipeline.steps.length,
        invalidSteps: pipeline.steps
          .map((s, i) => ({ i, name: s.name, type: s.type ?? 'work', valid: isStepValid(s, pipeline.steps) }))
          .filter((s) => !s.valid),
      });
      if (allValid) onComplete(pipeline);
    }
  });

  if (mode.kind === 'pattern') {
    return (
      <PatternPick
        onSelect={(pattern) => {
          const next = scaffold(pattern);
          setPipeline(next);
          setCursor(0);
          // Single-step patterns drop you straight into the step; linked
          // patterns land on the list so the wiring is visible first.
          if (pattern === 'blank' || pattern === 'per-file') {
            setMode({ kind: 'editing', index: 0 });
          } else {
            setMode({ kind: 'list' });
          }
        }}
        onCancel={onCancel}
      />
    );
  }

  if (mode.kind === 'editing') {
    const editing = pipeline.steps[mode.index]!;
    if (isCheckStep(editing)) {
      return (
        <CheckStepEditor
          initialStep={editing}
          allSteps={pipeline.steps}
          pipeline={pipeline}
          apiKey={apiKey}
          llmContext={llmContext}
          repoRoot={repoRoot}
          onSave={(step) => {
            setPipeline((p) => ({
              ...p,
              steps: p.steps.map((s, i) => (i === mode.index ? step : s)),
            }));
            setMode({ kind: 'list' });
          }}
          onCancel={() => setMode({ kind: 'list' })}
        />
      );
    }
    return (
      <StepEditor
        initialStep={editing as WorkStep}
        stepIndex={mode.index}
        allSteps={pipeline.steps.filter(isWorkStep)}
        repoRoot={repoRoot}
        onSave={(step) => {
          setPipeline((p) => ({
            ...p,
            steps: p.steps.map((s, i) => (i === mode.index ? step : s)),
          }));
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
        pipeline={pipeline}
        apiKey={apiKey}
        llmContext={llmContext}
        priorSteps={pipeline.steps
          .map((s, i) => ({ s, i }))
          .slice(0, mode.index)
          .filter(({ s }) => isWorkStep(s))
          .map(({ s, i }) => ({
            pipelineIndex: i,
            name: s.name,
            produces: (s as WorkStep).produces,
          }))}
        onDeclareProducer={(pipelineIndex, path) => {
          setPipeline((p) => ({
            ...p,
            steps: p.steps.map((s, i) =>
              i === pipelineIndex && isWorkStep(s) ? { ...s, produces: path } : s,
            ),
          }));
        }}
        priorStepNames={pipeline.steps.slice(0, mode.index).map((s) => s.name)}
      />
    );
  }

  if (mode.kind === 'naming-pipeline') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="cyan">{t('tui.editor.rename_title')}</Text>
          <Box marginTop={1}>
            <Text>{t('common.field.name')} </Text>
            <TextInput
              value={pipeline.name}
              onChange={(v) => setPipeline((p) => ({ ...p, name: v }))}
              onSubmit={() => setMode({ kind: 'list' })}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ENTER</Text> {t('common.action.confirm')} · <Text bold>ESC</Text>{' '}
              {t('common.action.cancel')}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (mode.kind === 'editing-settings') {
    return (
      <SettingsEditor
        initial={{
          cardTimeoutMs: pipeline.cardTimeoutMs ?? DEFAULT_CARD_TIMEOUT_MS,
          singleFileCardTimeoutMs: pipeline.singleFileCardTimeoutMs ?? DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
          maxRetries: pipeline.maxRetries ?? DEFAULT_MAX_RETRIES,
          integrationModelId: pipeline.integrationModelId,
        }}
        onSave={(values) => {
          setPipeline((p) => {
            const { integrationModelId: cleared, ...rest } = { ...p, ...values };
            return cleared ? { ...rest, integrationModelId: cleared } : rest;
          });
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  const allValid = pipeline.steps.every((s) => isStepValid(s, pipeline.steps));

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Box>
          <Text bold color="cyan">{pipeline.name}</Text>
          <Text dimColor>
            {'  ·  '}
            {pipeline.steps.length === 1
              ? t('tui.editor.step_count_one', { count: pipeline.steps.length })
              : t('tui.editor.step_count_other', { count: pipeline.steps.length })}
          </Text>
          <Text dimColor>  ·  </Text>
          {allValid ? (
            <Text color="green">{t('tui.check.ready')}</Text>
          ) : (
            <Text color="red">{t('tui.check.incomplete')}</Text>
          )}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {pipeline.steps.map((step, i) => {
            const isCursor = i === cursor;
            const valid = isStepValid(step, pipeline.steps);
            let typeBadge: React.ReactNode;
            let detailBadge: React.ReactNode;
            if (isCheckStep(step)) {
              typeBadge = <Text color={theme.ai}>{t('tui.editor.badge_check')}</Text>;
              const defaults = step.outcomes.filter((o) => o.default).length;
              detailBadge =
                defaults === 1 ? (
                  <Text color="cyanBright">
                    {step.outcomes.length === 1
                      ? t('tui.check.outcome_one', { count: step.outcomes.length })
                      : t('tui.check.outcome_other', { count: step.outcomes.length })}
                  </Text>
                ) : (
                  <Text color="red">{t('tui.editor.badge_no_default')}</Text>
                );
            } else {
              typeBadge = <Text color="blue">{t('tui.editor.badge_work')}</Text>;
              const scope = step.scope ?? 'flexible';
              detailBadge =
                scope === 'project' ? (
                  <Text color="cyanBright">{t('tui.editor.badge_project')}</Text>
                ) : scope === 'memory' ? (
                  step.filesFrom ? (
                    <Text color="blueBright">{t('tui.step.files_memory_from', { path: step.filesFrom })}</Text>
                  ) : (
                    <Text color="red">{t('tui.editor.badge_memory_unlinked')}</Text>
                  )
                ) : scope === 'per-file' ? (
                  step.files.length === 0 ? (
                    <Text color="red">{t('tui.editor.badge_per_file_empty')}</Text>
                  ) : (
                    <Text color="blue">{t('tui.editor.badge_per_file', { count: step.files.length })}</Text>
                  )
                ) : step.files.length === 0 ? (
                  <Text color="yellow">{t('tui.editor.badge_flex_project')}</Text>
                ) : (
                  <Text color="green">
                    {step.files.length === 1
                      ? t('tui.editor.badge_flex_files_one', { count: step.files.length })
                      : t('tui.editor.badge_flex_files_other', { count: step.files.length })}
                  </Text>
                );
            }
            const modelBadge = step.modelId ? (
              <Text color={theme.ai}>🧠 {step.modelId}</Text>
            ) : (
              <Text dimColor>🧠 {t('tui.editor.model_global')}</Text>
            );
            return (
              <Box key={i}>
                <Text
                  color={!valid ? 'yellow' : isCursor ? 'cyan' : undefined}
                  bold={isCursor}
                >
                  {isCursor ? '› ' : '  '}#{i + 1}{'  '}
                  {step.name || <Text dimColor italic>{t('common.unnamed')}</Text>}
                </Text>
                <Text dimColor>  —  </Text>
                {typeBadge}
                <Text dimColor>  ·  </Text>
                {detailBadge}
                {isWorkStep(step) && step.produces ? (
                  <>
                    <Text dimColor>  ·  </Text>
                    <Text color="blueBright">→ {step.produces}</Text>
                  </>
                ) : null}
                {step.dependsOn !== undefined ? (
                  <>
                    <Text dimColor>  ·  </Text>
                    <Text color="cyanBright">
                      ⇠ {step.dependsOn.length === 0 ? t('tui.editor.badge_root') : step.dependsOn.join(', ')}
                    </Text>
                  </>
                ) : null}
                <Text dimColor>  ·  </Text>
                {modelBadge}
                {!valid && <Text color="red">  ⚠</Text>}
              </Box>
            );
          })}
        </Box>

        {(() => {
          const current = pipeline.steps[cursor];
          const problem = current ? stepProblem(current, pipeline.steps) : null;
          return problem ? (
            <Box marginTop={1}>
              <Text color="yellow">{t('tui.editor.problem_line', { index: cursor + 1, problem })}</Text>
            </Box>
          ) : null;
        })()}

        <Box marginTop={1}>
          <Text dimColor>
            {t('tui.editor.settings_line', {
              whole: msToMin(pipeline.cardTimeoutMs ?? DEFAULT_CARD_TIMEOUT_MS),
              single: msToMin(
                pipeline.singleFileCardTimeoutMs ?? DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
              ),
              retries: pipeline.maxRetries ?? DEFAULT_MAX_RETRIES,
            })}{' '}
          </Text>
          {pipeline.integrationModelId ? (
            <Text color={theme.ai}>{pipeline.integrationModelId}</Text>
          ) : (
            <Text dimColor>{t('tui.editor.model_global')}</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column" width="100%">
          <ActionBar hints={editorNavHints()} />
          <ActionBar hints={editorActionHints()} />
        </Box>
      </Box>
    </Box>
  );
}

function PatternPick(props: {
  onSelect: (pattern: Pattern) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [cursor, setCursor] = useState(0);
  useInput((_input, key) => {
    if (key.escape) props.onCancel();
    else if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(PATTERNS.length - 1, c + 1));
    else if (key.return) props.onSelect(PATTERNS[cursor]!.id);
  });
  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">{t('tui.editor.pattern_title')}</Text>
        <Box flexDirection="column" marginTop={1}>
          {PATTERNS.map((p, i) => (
            <Box key={p.id} flexDirection="column">
              <Text color={i === cursor ? 'cyan' : undefined} bold={i === cursor}>
                {i === cursor ? '› ' : '  '}{p.glyph} {patternLabel(p.id)}
              </Text>
              <Text dimColor>      {patternHint(p.id)}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            ↑↓ {t('tui.editor.hint_choose')} · <Text bold>ENTER</Text>{' '}
            {t('tui.editor.hint_scaffold')} · <Text bold>ESC</Text> {t('common.action.back')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

interface SettingsValues {
  cardTimeoutMs: number;
  singleFileCardTimeoutMs: number;
  maxRetries: number;
  integrationModelId?: string;
}

interface SettingsEditorProps {
  initial: SettingsValues;
  onSave: (values: SettingsValues) => void;
  onCancel: () => void;
}

type SettingsField = 'cardTimeout' | 'singleFileTimeout' | 'maxRetries' | 'integrationModel';
type SettingsMode = 'selecting' | 'editing';

const SETTINGS_FIELD_ORDER: SettingsField[] = [
  'cardTimeout',
  'singleFileTimeout',
  'maxRetries',
  'integrationModel',
];

function SettingsEditor({ initial, onSave, onCancel }: SettingsEditorProps): React.JSX.Element {
  const [cardMin, setCardMin] = useState<string>(msToMin(initial.cardTimeoutMs));
  const [singleMin, setSingleMin] = useState<string>(msToMin(initial.singleFileCardTimeoutMs));
  const [retries, setRetries] = useState<string>(String(initial.maxRetries));
  const [integrationModelId, setIntegrationModelId] = useState<string | undefined>(
    initial.integrationModelId,
  );
  const [field, setField] = useState<SettingsField>('cardTimeout');
  const [mode, setMode] = useState<SettingsMode>('selecting');
  const [pickingModel, setPickingModel] = useState(false);

  const cardMs = minToMs(cardMin);
  const singleMs = minToMs(singleMin);
  const retriesN = parseRetries(retries);
  const allValid = cardMs !== null && singleMs !== null && retriesN !== null;

  useInput((input, key) => {
    if (pickingModel) return; // ModelSelectorOverlay owns the input
    if (mode === 'editing') {
      if (key.escape) setMode('selecting');
      return;
    }
    if (key.escape) {
      if (allValid) {
        onSave({
          cardTimeoutMs: cardMs!,
          singleFileCardTimeoutMs: singleMs!,
          maxRetries: retriesN!,
          integrationModelId,
        });
      } else {
        onCancel();
      }
      return;
    }
    if (key.upArrow) {
      setField((f) => SETTINGS_FIELD_ORDER[Math.max(0, SETTINGS_FIELD_ORDER.indexOf(f) - 1)]!);
    } else if (key.downArrow || key.tab) {
      setField(
        (f) =>
          SETTINGS_FIELD_ORDER[
            Math.min(SETTINGS_FIELD_ORDER.length - 1, SETTINGS_FIELD_ORDER.indexOf(f) + 1)
          ]!,
      );
    } else if (field === 'integrationModel') {
      if (key.return || input === 'm' || input === 'M') {
        setPickingModel(true);
      } else if (input === 'c' || input === 'C') {
        setIntegrationModelId(undefined);
      }
    } else if (key.return) {
      setMode('editing');
    }
  });

  if (pickingModel) {
    return (
      <ModelSelectorOverlay
        onSelect={(modelId) => {
          setIntegrationModelId(modelId);
          setPickingModel(false);
        }}
        onCancel={() => setPickingModel(false)}
      />
    );
  }

  const     fieldRow = (
    label: string,
    suffix: string,
    f: SettingsField,
    value: string,
    setValue: (v: string) => void,
    isValid: boolean,
  ) => (
    <Box marginTop={1}>
      <Text color="cyan">{field === f ? '› ' : '  '}</Text>
      <Box width={30}>
        <Text color={field === f ? 'cyan' : undefined}>{label}</Text>
      </Box>
      {field === f && mode === 'editing' ? (
        <TextInput value={value} onChange={setValue} onSubmit={() => setMode('selecting')} />
      ) : (
        <Text color={isValid ? undefined : 'red'}>
          {value || <Text dimColor>{t('common.empty')}</Text>}
          <Text dimColor> {suffix}</Text>
        </Text>
      )}
    </Box>
  );

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">{t('tui.settings.title')}</Text>
        <Text dimColor>{t('tui.settings.subtitle')}</Text>

        {fieldRow(t('tui.settings.card_timeout'), t('tui.settings.unit_min'), 'cardTimeout', cardMin, setCardMin, cardMs !== null)}
        {fieldRow(t('tui.settings.single_timeout'), t('tui.settings.unit_min'), 'singleFileTimeout', singleMin, setSingleMin, singleMs !== null)}
        {fieldRow(t('tui.settings.max_retries'), '(0–3)', 'maxRetries', retries, setRetries, retriesN !== null)}

        <Box marginTop={1}>
          <Text color="cyan">{field === 'integrationModel' ? '› ' : '  '}</Text>
          <Box width={30}>
            <Text color={field === 'integrationModel' ? 'cyan' : undefined}>
              {t('tui.settings.integration_model')}
            </Text>
          </Box>
          {integrationModelId ? (
            <Text color={theme.ai}>🧠 {integrationModelId}</Text>
          ) : (
            <Text dimColor>🧠 {t('tui.settings.integration_global')}</Text>
          )}
        </Box>

        <Box marginTop={2} flexDirection="column">
          {mode === 'selecting' ? (
            <>
              <Text dimColor>
                <Text bold>↑↓</Text> {t('common.action.select')} · <Text bold>TAB</Text>{' '}
                {t('tui.settings.hint_cycle')} · <Text bold>ENTER</Text> {t('common.action.edit')}
                {field === 'integrationModel' && (
                  <>
                    {' '}· <Text bold>M</Text> {t('tui.settings.hint_pick_model')} ·{' '}
                    <Text bold>C</Text> {t('tui.settings.hint_clear_model')}
                  </>
                )}
              </Text>
              <Text>
                <Text bold>ESC</Text>{' '}
                {allValid ? (
                  <Text color="green">{t('tui.settings.hint_save_close')}</Text>
                ) : (
                  <Text color="red">{t('tui.settings.hint_fix_first')}</Text>
                )}
              </Text>
            </>
          ) : (
            <Text dimColor>
              <Text bold>ESC</Text> {t('tui.settings.hint_exit_editing')}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
