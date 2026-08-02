import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdin, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pipeline, PromptStep, StepScope } from '../../lib/types.js';
import { FileMultiSelect } from './FileMultiSelect.js';
import { ModelSelectorOverlay } from './ModelSelectorOverlay.js';
import { t, translate } from '../../lib/i18n/index.js';

type Field = 'name' | 'prompt' | 'scope' | 'deps' | 'files' | 'model';
type EditorMode = 'selecting' | 'editing';
/** Full-screen pick panels (recognition over recall — lists, not typing). */
type Panel = 'none' | 'scope' | 'memory' | 'link' | 'deps';

/** An earlier step in the pipeline, by its REAL pipeline index. */
export interface PriorStepRef {
  pipelineIndex: number;
  name: string;
  produces?: string;
}

interface Props {
  initialStep: PromptStep;
  stepIndex: number;
  /** All steps in the pipeline. Used to offer "copy files from a previous step". */
  allSteps: PromptStep[];
  repoRoot: string;
  onSave: (step: PromptStep) => void;
  onCancel: () => void;
  /** Pipeline in edit-time state — drilled into FileMultiSelect for Smart Select context. */
  pipeline: Pipeline;
  /** OpenRouter key for Smart Select. '' or 'stub' triggers the deterministic stub. */
  apiKey: string;
  /** Backend-aware context for Smart Select (Azure routing). */
  llmContext?: import('../../lib/llm-client-factory.js').LlmClientContext;
  /** Work steps BEFORE this one (real pipeline indices) — feeds the memory link-picker. */
  priorSteps?: PriorStepRef[];
  /** Declare `produces` on an earlier step (the other half of a memory link). */
  onDeclareProducer?: (pipelineIndex: number, path: string) => void;
  /** ALL earlier step names (work + check, array order) — feeds the dependsOn picker. */
  priorStepNames?: string[];
}

const FULL_CLEAR = '\x1b[3J';

// Scope IDs are part of the pipeline schema and never translated; only their
// human blurbs are, resolved at render time (`tui.step.scope_*`).
const SCOPE_OPTIONS: { scope: StepScope }[] = [
  { scope: 'project' },
  { scope: 'per-file' },
  { scope: 'memory' },
  { scope: 'flexible' },
];

function scopeOptionLabel(scope: StepScope): string {
  return translate(`tui.step.scope_opt_${scope.replace('-', '_')}`);
}

function scopeConsequence(scope: StepScope): string {
  return translate(`tui.step.scope_why_${scope.replace('-', '_')}`);
}

function scopeLabel(scope: StepScope): string {
  return translate(`tui.step.scope_state_${scope.replace('-', '_')}`);
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'step';
}

/** Blocking $EDITOR hand-off (git-commit pattern). Returns null when unchanged/failed. */
function openInExternalEditor(initial: string): { text: string | null; error: string | null } {
  const editorEnv = process.env.VISUAL || process.env.EDITOR;
  if (!editorEnv) {
    return { text: null, error: t('tui.step.err_no_editor') };
  }
  try {
    const dir = mkdtempSync(join(tmpdir(), 'huu-prompt-'));
    const file = join(dir, 'PROMPT.md');
    writeFileSync(file, initial, 'utf8');
    const [cmd, ...args] = editorEnv.split(' ').filter(Boolean) as [string, ...string[]];
    const res = spawnSync(cmd, [...args, file], { stdio: 'inherit' });
    const text = (res.status ?? 1) === 0 ? readFileSync(file, 'utf8').replace(/\r?\n$/, '') : null;
    rmSync(dir, { recursive: true, force: true });
    if (text === null) return { text: null, error: `${cmd} exited non-zero — prompt unchanged` };
    return { text, error: null };
  } catch (err) {
    return {
      text: null,
      error: t('tui.step.err_editor_failed', {
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
}

/** Generic vertical pick list (the panels). */
function ListPick(props: {
  title: string;
  items: { label: string; hint?: string }[];
  footer: string;
  onSelect: (index: number) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [cursor, setCursor] = useState(0);
  useInput((_input, key) => {
    if (key.escape) props.onCancel();
    else if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(props.items.length - 1, c + 1));
    else if (key.return) props.onSelect(cursor);
  });
  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">{props.title}</Text>
        <Box flexDirection="column" marginTop={1}>
          {props.items.map((item, i) => (
            <Box key={i} flexDirection="column">
              <Text color={i === cursor ? 'cyan' : undefined} bold={i === cursor}>
                {i === cursor ? '› ' : '  '}{item.label}
              </Text>
              {item.hint ? (
                <Text dimColor>      {item.hint}</Text>
              ) : null}
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{props.footer}</Text>
        </Box>
      </Box>
    </Box>
  );
}

/** Multi-select for dependsOn (SPACE toggles; D = default chain; R = root). */
function DepsPick(props: {
  title: string;
  names: string[];
  initial: string[] | undefined;
  onApply: (deps: string[] | undefined) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set(props.initial ?? []));
  const [cursor, setCursor] = useState(0);
  useInput((input, key) => {
    if (key.escape) props.onCancel();
    else if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(Math.max(0, props.names.length - 1), c + 1));
    else if (input === ' ' && props.names.length > 0) {
      const name = props.names[cursor]!;
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    } else if (input === 'd' || input === 'D') props.onApply(undefined);
    else if (input === 'r' || input === 'R') props.onApply([]);
    else if (key.return) props.onApply(props.names.filter((n) => selected.has(n)));
  });
  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">{props.title}</Text>
        <Box flexDirection="column" marginTop={1}>
          {props.names.length === 0 ? (
            <Text dimColor>{t('tui.step.deps_none_available')}</Text>
          ) : (
            props.names.map((name, i) => (
              <Text key={name} color={i === cursor ? 'cyan' : undefined} bold={i === cursor}>
                {i === cursor ? '› ' : '  '}[{selected.has(name) ? 'x' : ' '}] {name}
              </Text>
            ))
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{t('tui.step.deps_footer')}</Text>
        </Box>
      </Box>
    </Box>
  );
}

export function StepEditor({ initialStep, stepIndex, allSteps, repoRoot, onSave, onCancel, pipeline, apiKey, llmContext, priorSteps = [], onDeclareProducer, priorStepNames = [] }: Props): React.JSX.Element {
  const { stdout } = useStdout();
  const { setRawMode, isRawModeSupported } = useStdin();
  const [step, setStep] = useState<PromptStep>(initialStep);
  const [field, setField] = useState<Field>('name');
  const [editorMode, setEditorMode] = useState<EditorMode>('selecting');
  const [panel, setPanel] = useState<Panel>('none');
  const [pickingFiles, setPickingFiles] = useState(false);
  const [pickingModel, setPickingModel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (editorMode === 'selecting' && panel === 'none' && !pickingModel && stdout.isTTY) {
      stdout.write(FULL_CLEAR);
    }
  }, [editorMode, panel, pickingModel, stdout]);

  const scope: StepScope = step.scope ?? 'flexible';

  // For flexible scope, files choice must be explicit. Treat existing steps
  // (already-edited prompt or files already selected) as previously chosen.
  // For project/per-file/memory, "chosen" is derived from scope.
  const [filesChosen, setFilesChosen] = useState<boolean>(
    initialStep.files.length > 0 || initialStep.prompt.length > 0,
  );

  const filesValid =
    scope === 'project' ? true :
    scope === 'per-file' ? step.files.length > 0 :
    scope === 'memory' ? Boolean(step.filesFrom) :
    filesChosen;
  const canSave = Boolean(step.name && step.prompt && filesValid);

  const declaredProducers = priorSteps.filter((p): p is PriorStepRef & { produces: string } =>
    Boolean(p.produces),
  );

  function applyScope(s: StepScope): void {
    if (s === 'project') {
      setStep({ ...step, scope: s, files: [] });
      setFilesChosen(true);
    } else if (s === 'per-file') {
      setStep({ ...step, scope: s });
      setFilesChosen(step.files.length > 0);
    } else if (s === 'memory') {
      // Files come from the memory file at run time — the editor only
      // needs the filesFrom link; the files array stays empty.
      setStep({ ...step, scope: s, files: [] });
      setFilesChosen(true);
    } else {
      setStep({ ...step, scope: s });
    }
  }

  function editPromptExternally(): void {
    if (!stdout.isTTY) {
      setNotice('not a TTY — edit inline with ENTER instead');
      return;
    }
    try {
      if (isRawModeSupported) setRawMode(false);
    } catch { /* best effort */ }
    const result = openInExternalEditor(step.prompt ?? '');
    try {
      if (isRawModeSupported) setRawMode(true);
    } catch { /* best effort */ }
    if (stdout.isTTY) stdout.write(FULL_CLEAR);
    if (result.text !== null) {
      setStep({ ...step, prompt: result.text });
      setNotice(null);
    } else if (result.error) {
      setNotice(result.error);
    }
  }

  useInput((input, key) => {
    if (pickingFiles || pickingModel || panel !== 'none') return;

    if (editorMode === 'editing') {
      if (key.escape) {
        setEditorMode('selecting');
      }
      return;
    }

    if (key.escape) {
      if (canSave) {
        onSave(step);
      } else {
        onCancel();
      }
      return;
    }

    if (key.upArrow) {
      setField((f) =>
        f === 'model' ? 'files' :
        f === 'files' ? 'deps' :
        f === 'deps' ? 'scope' :
        f === 'scope' ? 'prompt' :
        f === 'prompt' ? 'name' :
        'name',
      );
    } else if (key.downArrow) {
      setField((f) =>
        f === 'name' ? 'prompt' :
        f === 'prompt' ? 'scope' :
        f === 'scope' ? 'deps' :
        f === 'deps' ? 'files' :
        f === 'files' ? 'model' :
        'model',
      );
    } else if (key.tab) {
      setField((f) =>
        f === 'name' ? 'prompt' :
        f === 'prompt' ? 'scope' :
        f === 'scope' ? 'deps' :
        f === 'deps' ? 'files' :
        f === 'files' ? 'model' :
        'name',
      );
    } else if (key.return) {
      if (field === 'name' || field === 'prompt') {
        setEditorMode('editing');
      } else if (field === 'scope') {
        // Recognition over recall: a visible list with one-line
        // consequences instead of blind cycling.
        setPanel('scope');
      } else if (field === 'deps') {
        setPanel('deps');
      } else if (field === 'files') {
        if (scope === 'per-file') {
          setPickingFiles(true);
        } else if (scope === 'flexible' && filesChosen) {
          setPickingFiles(true);
        } else if (scope === 'memory') {
          setPanel('memory');
        }
      } else if (field === 'model') {
        setPickingModel(true);
      }
    } else if (field === 'scope') {
      if (input === 'p' || input === 'P') applyScope('project');
      else if (input === 'f' || input === 'F') applyScope('per-file');
      else if (input === 'x' || input === 'X') applyScope('flexible');
      else if (input === 'm' || input === 'M') applyScope('memory');
    } else if (field === 'prompt') {
      if (input === 'e' || input === 'E') editPromptExternally();
    } else if (field === 'files') {
      if (scope === 'project') {
        // Locked: nothing to do here.
      } else if (scope === 'memory') {
        if (input === 'u' || input === 'U') {
          const { filesFrom: _drop, ...rest } = step;
          setStep(rest as PromptStep);
        }
      } else if (scope === 'per-file') {
        if (input === 'f' || input === 'F') setPickingFiles(true);
      } else {
        // flexible
        if (input === 'f' || input === 'F') {
          setPickingFiles(true);
        } else if (input === 'w' || input === 'W') {
          setStep({ ...step, files: [] });
          setFilesChosen(true);
        }
      }
      if (step.produces && (input === 'o' || input === 'O')) {
        // Escape hatch: stop promising the memory file from this step.
        const { produces: _drop, ...rest } = step;
        setStep(rest as PromptStep);
      }
    } else if (field === 'model') {
      if (input === 'm' || input === 'M') {
        setPickingModel(true);
      } else if (input === 'c' || input === 'C') {
        const { modelId: _omit, ...rest } = step;
        setStep(rest);
      }
    }
  });

  // --- Full-screen panels --------------------------------------------------

  if (panel === 'scope') {
    return (
      <ListPick
        title={t('tui.step.scope_title', { index: stepIndex + 1 })}
        items={SCOPE_OPTIONS.map((o) => ({
          label:
            scopeOptionLabel(o.scope) +
            (o.scope === scope ? `   (${t('tui.step.current')})` : ''),
          hint: scopeConsequence(o.scope),
        }))}
        footer={t('tui.step.scope_footer')}
        onSelect={(i) => {
          applyScope(SCOPE_OPTIONS[i]!.scope);
          setPanel('none');
        }}
        onCancel={() => setPanel('none')}
      />
    );
  }

  if (panel === 'deps') {
    return (
      <DepsPick
        title={t('tui.step.deps_title', { index: stepIndex + 1 })}
        names={priorStepNames}
        initial={step.dependsOn}
        onApply={(deps) => {
          if (deps === undefined) {
            const { dependsOn: _drop, ...rest } = step;
            setStep(rest as PromptStep);
          } else {
            setStep({ ...step, dependsOn: deps });
          }
          setPanel('none');
        }}
        onCancel={() => setPanel('none')}
      />
    );
  }

  if (panel === 'memory') {
    const items = [
      ...declaredProducers.map((p) => ({
        label: p.produces,
        hint: t('tui.step.mem_produced_by', { index: p.pipelineIndex + 1, name: p.name }),
      })),
      ...(priorSteps.length > 0 && onDeclareProducer
        ? [{ label: t('tui.step.mem_pick_producer'), hint: t('tui.step.mem_pick_producer_hint') }]
        : []),
      { label: t('tui.step.mem_custom_path'), hint: t('tui.step.mem_custom_path_hint') },
    ];
    return (
      <ListPick
        title={t('tui.step.mem_title')}
        items={items}
        footer={t('tui.step.mem_footer')}
        onSelect={(i) => {
          if (i < declaredProducers.length) {
            setStep({ ...step, filesFrom: declaredProducers[i]!.produces });
            setPanel('none');
          } else if (i === declaredProducers.length && priorSteps.length > 0 && onDeclareProducer) {
            setPanel('link');
          } else {
            setPanel('none');
            setEditorMode('editing');
            setField('files');
          }
        }}
        onCancel={() => setPanel('none')}
      />
    );
  }

  if (panel === 'link') {
    const autoPath = `.huu/memory/${slugify(step.name)}.json`;
    return (
      <ListPick
        title={t('tui.step.link_title', { path: autoPath })}
        items={priorSteps.map((p) => ({
          label: `#${p.pipelineIndex + 1} ${p.name}`,
          hint: p.produces
            ? t('tui.step.link_moves', { current: p.produces, path: autoPath })
            : t('tui.step.link_contract'),
        }))}
        footer={t('tui.step.link_footer')}
        onSelect={(i) => {
          const producer = priorSteps[i]!;
          onDeclareProducer?.(producer.pipelineIndex, autoPath);
          setStep({ ...step, filesFrom: autoPath });
          setPanel('none');
        }}
        onCancel={() => setPanel('memory')}
      />
    );
  }

  if (pickingFiles) {
    const previousSteps = allSteps
      .slice(0, stepIndex)
      .map((s, i) => ({ index: i, name: s.name, files: s.files }))
      .filter((s) => s.files.length > 0);
    return (
      <FileMultiSelect
        repoRoot={repoRoot}
        initialSelection={step.files}
        previousSteps={previousSteps}
        onCommit={(files) => {
          setStep({ ...step, files });
          setFilesChosen(true);
          setPickingFiles(false);
        }}
        onCancel={() => setPickingFiles(false)}
        pipeline={pipeline}
        currentStepIndex={stepIndex}
        currentStep={step}
        apiKey={apiKey}
        modelId={step.modelId}
        llmContext={llmContext}
      />
    );
  }

  if (pickingModel) {
    return (
      <ModelSelectorOverlay
        onSelect={(modelId) => {
          setStep({ ...step, modelId });
          setPickingModel(false);
        }}
        onCancel={() => setPickingModel(false)}
      />
    );
  }

  // --- Main form ------------------------------------------------------------

  const promptLines = (step.prompt ?? '').split('\n');
  const promptDisplay = step.prompt
    ? (promptLines[0]!.length > 60 ? promptLines[0]!.slice(0, 60) + '…' : promptLines[0]!) +
      (promptLines.length > 1 ? `  ⤶ ${t('tui.step.prompt_lines', { count: promptLines.length })}` : '')
    : null;

  const scopeColor =
    scope === 'project' ? 'cyanBright' :
    scope === 'per-file' ? 'blue' :
    scope === 'memory' ? 'blueBright' :
    'yellow';

  // One footer, always describing the focused field (lazygit-style status bar).
  const footerHint = (() => {
    if (editorMode === 'editing') return t('tui.step.foot_editing');
    switch (field) {
      case 'name': return t('tui.step.foot_name');
      case 'prompt': return t('tui.step.foot_prompt');
      case 'scope': return t('tui.step.foot_scope');
      case 'deps': return t('tui.step.foot_deps');
      case 'files':
        if (scope === 'project') return t('tui.step.foot_files_locked');
        if (scope === 'memory') {
          return (
            t('tui.step.foot_files_memory') +
            (step.filesFrom ? ` · ${t('tui.step.foot_unlink')}` : '') +
            (step.produces ? ` · ${t('tui.step.foot_stop_producing')}` : '')
          );
        }
        if (scope === 'per-file') return t('tui.step.foot_files_pick');
        return filesChosen ? t('tui.step.foot_files_flex') : t('tui.step.foot_files_flex_choose');
      case 'model': return t('tui.step.foot_model');
    }
  })();

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">{t('tui.step.title', { index: stepIndex + 1 })}</Text>

        <Box marginTop={1}>
          <Text color="cyan">{field === 'name' ? '› ' : '  '}</Text>
          <Box width={10}><Text color={field === 'name' ? 'cyan' : undefined}>{t('common.field.name')}</Text></Box>
          {field === 'name' && editorMode === 'editing' ? (
            <TextInput
              value={step.name}
              onChange={(v) => setStep({ ...step, name: v })}
              onSubmit={() => setField('prompt')}
              placeholder={t('tui.step.name_placeholder')}
            />
          ) : (
            <Text>{step.name || <Text dimColor>{t('common.empty')}</Text>}</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">{field === 'prompt' ? '› ' : '  '}</Text>
          <Text color={field === 'prompt' ? 'cyan' : undefined}>{t('tui.step.field_prompt')}</Text>
          {field === 'prompt' && editorMode === 'editing' ? (
            <TextInput
              value={step.prompt}
              onChange={(v) => setStep({ ...step, prompt: v })}
              onSubmit={() => {
                setField('scope');
                setEditorMode('selecting');
              }}
              placeholder={t('tui.step.prompt_placeholder')}
            />
          ) : (
            <Text>{promptDisplay || <Text dimColor>{t('tui.step.prompt_empty')}</Text>}</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">{field === 'scope' ? '› ' : '  '}</Text>
          <Box width={10}><Text color={field === 'scope' ? 'cyan' : undefined}>{t('tui.step.field_scope')}</Text></Box>
          <Text color={scopeColor}>{scopeLabel(scope)}</Text>
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">{field === 'deps' ? '› ' : '  '}</Text>
          <Box width={10}><Text color={field === 'deps' ? 'cyan' : undefined}>{t('tui.step.field_deps')}</Text></Box>
          {step.dependsOn === undefined ? (
            <Text dimColor>{t('tui.step.deps_default')}</Text>
          ) : step.dependsOn.length === 0 ? (
            <Text color="cyanBright">{t('tui.step.deps_root')}</Text>
          ) : (
            <Text color="cyanBright">{t('tui.step.deps_needs', { list: step.dependsOn.join(', ') })}</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="cyan">{field === 'files' ? '› ' : '  '}</Text>
            <Box width={10}><Text color={field === 'files' ? 'cyan' : undefined}>{t('tui.step.field_files')}</Text></Box>
            {scope === 'memory' ? (
              field === 'files' && editorMode === 'editing' ? (
                <TextInput
                  value={step.filesFrom ?? ''}
                  onChange={(v) => setStep({ ...step, filesFrom: v || undefined })}
                  onSubmit={() => {
                    setEditorMode('selecting');
                    setField('model');
                  }}
                  placeholder=".huu/memory/list.json"
                />
              ) : step.filesFrom ? (
                <Text color="green">{t('tui.step.files_memory_from', { path: step.filesFrom })}</Text>
              ) : (
                <Text color="red">{t('tui.step.files_not_linked')}</Text>
              )
            ) : scope === 'project' ? (
              <Text color="yellow">{t('tui.step.files_locked')}</Text>
            ) : scope === 'per-file' ? (
              step.files.length === 0 ? (
                <Text color="red">{t('tui.step.files_none_pick')}</Text>
              ) : (
                <Text color="green">{t('tui.step.files_selected', { count: step.files.length })}</Text>
              )
            ) : !filesChosen ? (
              <Text color="red">{t('tui.step.files_no_choice')}</Text>
            ) : step.files.length === 0 ? (
              <Text color="yellow">{t('tui.step.files_whole_once')}</Text>
            ) : (
              <Text color="green">{t('tui.step.files_selected', { count: step.files.length })}</Text>
            )}
          </Box>
          {step.produces ? (
            <Box>
              <Text>            </Text>
              <Text color="blueBright">{t('tui.step.produces', { path: step.produces })}</Text>
              <Text dimColor>{`  (${t('tui.step.produces_hint')})`}</Text>
            </Box>
          ) : null}
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">{field === 'model' ? '› ' : '  '}</Text>
          <Box width={10}><Text color={field === 'model' ? 'cyan' : undefined}>{t('tui.step.field_model')}</Text></Box>
          {step.modelId ? (
            <Text>{step.modelId}</Text>
          ) : (
            <Text dimColor>{t('tui.step.model_default')}</Text>
          )}
        </Box>

        {notice ? (
          <Box marginTop={1}>
            <Text color="yellow">⚠ {notice}</Text>
          </Box>
        ) : null}

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{footerHint}</Text>
          <Text dimColor>
            <Text bold>↑↓/TAB</Text> {t('tui.step.hint_field')} · <Text bold>ESC</Text>{' '}
            {canSave ? (
              <Text color="green">{t('tui.step.hint_save')}</Text>
            ) : (
              <Text color="red">{t('tui.step.hint_cancel_incomplete')}</Text>
            )}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
