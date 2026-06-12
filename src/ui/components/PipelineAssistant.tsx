import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import {
  createAssistantChat,
  DEFAULT_ASSISTANT_MODEL,
  HumanMessage,
  SystemMessage,
  AIMessage,
  type AssistantChat,
  type BaseMessage,
} from '../../lib/assistant-client.js';
import {
  buildAssistantSystemPrompt,
  buildInitialHumanMessage,
  FORCE_DONE_NUDGE,
} from '../../lib/assistant-prompts.js';
import { runArchitect, type ArchitectPhase } from '../../lib/assistant-architect.js';
import { loadRecommendedModels } from '../../models/catalog.js';
import type { AssistantTurn, PipelineDraft, QuestionTurn } from '../../lib/assistant-schema.js';
import type { Pipeline } from '../../lib/types.js';
import { ModelSelectorOverlay } from './ModelSelectorOverlay.js';
import { ProjectRecon } from './ProjectRecon.js';
import type { ReconAgentResult } from '../../lib/project-recon.js';
import { Spinner } from './Spinner.js';
import { log as dlog } from '../../lib/debug-logger.js';
import { theme } from '../theme.js';

const FULL_CLEAR = '\x1b[3J';
/**
 * Hidden safety cap. Not surfaced to the model in the system prompt — the
 * prompt's sufficiency-checklist + counterfactual rules drive when the model
 * finalizes. This cap exists ONLY to prevent runaway loops if the model fails
 * to converge: once exceeded we inject FORCE_DONE_NUDGE on the next turn.
 * Generous on purpose (15) — should never fire in a well-formed conversation.
 */
const HARD_SAFETY_CAP = 15;

interface Props {
  apiKey: string;
  onComplete: (pipeline: Pipeline) => void;
  onCancel: () => void;
  /** Backend-aware context. Required for `--backend=azure` to avoid OpenRouter charges. */
  llmContext?: import('../../lib/llm-client-factory.js').LlmClientContext;
}

type Stage =
  | { kind: 'pick-model' }
  | { kind: 'intent' }
  | { kind: 'recon' }
  | { kind: 'asking' }
  | { kind: 'answering'; turn: QuestionTurn }
  | { kind: 'free-text'; turn: QuestionTurn }
  | { kind: 'architect'; phases: { phase: ArchitectPhase; detail: string }[] }
  | { kind: 'confirm-cancel'; previous: Stage }
  | { kind: 'error'; message: string };

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

function turnLabel(turn: QuestionTurn): string {
  return turn.question;
}

export function PipelineAssistant({
  apiKey,
  onComplete,
  onCancel,
  llmContext,
}: Props): React.JSX.Element {
  const { stdout } = useStdout();
  const repoRoot = process.cwd();

  const [stage, setStage] = useState<Stage>({ kind: 'pick-model' });
  const [modelId, setModelId] = useState<string>(DEFAULT_ASSISTANT_MODEL);
  const [intent, setIntent] = useState('');
  const [freeTextDraft, setFreeTextDraft] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [turnsAsked, setTurnsAsked] = useState(0);

  const messagesRef = useRef<BaseMessage[]>([]);
  const chatRef = useRef<AssistantChat | null>(null);
  const cancelledRef = useRef(false);
  const reconRef = useRef('');

  // The interview's done-turn is the BASELINE candidate, not the product:
  // the Architect flow (parallel sketches → generative selection → parallel
  // prompt expansion → mechanical validation) produces the final pipeline.
  const launchArchitect = useCallback(
    (baseline: PipelineDraft): void => {
      setStage({ kind: 'architect', phases: [] });
      const transcript = messagesRef.current
        .map((m) => {
          const role = m instanceof HumanMessage ? 'user' : m instanceof AIMessage ? 'assistant' : null;
          if (!role) return null;
          const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          return `${role}: ${text}`;
        })
        .filter((l): l is string => l !== null)
        .join('\n');
      void (async () => {
        try {
          const result = await runArchitect({
            apiKey,
            modelId,
            llmContext,
            intent,
            transcript,
            reconContext: reconRef.current,
            baseline,
            onPhase: (phase, detail) => {
              if (cancelledRef.current) return;
              setStage((s) =>
                s.kind === 'architect'
                  ? { kind: 'architect', phases: [...s.phases, { phase, detail }] }
                  : s,
              );
            },
          });
          if (cancelledRef.current) return;
          dlog('action', 'PipelineAssistant.architect_complete', {
            steps: result.pipeline.steps.length,
            winner: result.meta.winnerLens,
            retried: result.meta.retried,
          });
          onComplete(result.pipeline);
        } catch (err) {
          if (cancelledRef.current) return;
          const message = err instanceof Error ? err.message : String(err);
          dlog('error', 'PipelineAssistant.architect_failed', { message });
          setStage({ kind: 'error', message });
        }
      })();
    },
    [apiKey, modelId, llmContext, intent, onComplete],
  );

  useEffect(() => {
    if (stdout.isTTY) stdout.write(FULL_CLEAR);
    return () => {
      cancelledRef.current = true;
    };
  }, [stdout]);

  const sendTurn = useCallback(
    async (userText: string): Promise<void> => {
      const chat = chatRef.current;
      if (!chat) return;
      const trimmed = userText.trim();
      if (!trimmed) return;

      setHistory((h) => [...h, { role: 'user', text: trimmed }]);
      messagesRef.current.push(new HumanMessage(trimmed));
      setStage({ kind: 'asking' });

      // Safety cap reached → nudge the model toward `done: true` before the
      // call. In normal use the prompt's sufficiency checklist finalizes far
      // earlier; this only kicks in if the model fails to converge.
      if (turnsAsked >= HARD_SAFETY_CAP) {
        messagesRef.current.push(new SystemMessage(FORCE_DONE_NUDGE));
      }

      try {
        const reply: AssistantTurn = await chat.invokeStructured(messagesRef.current);
        if (cancelledRef.current) return;

        if (reply.done === true) {
          // Push assistant message as JSON marker so the model can see the
          // synthesis if we ever extend this into a "review pipeline" loop.
          messagesRef.current.push(new AIMessage(JSON.stringify(reply)));
          dlog('action', 'PipelineAssistant.interview_done', {
            steps: reply.pipeline.steps.length,
          });
          launchArchitect(reply.pipeline);
          return;
        }

        messagesRef.current.push(new AIMessage(JSON.stringify(reply)));
        setHistory((h) => [...h, { role: 'assistant', text: turnLabel(reply) }]);
        setTurnsAsked((n) => n + 1);
        setStage({ kind: 'answering', turn: reply });
      } catch (err) {
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        dlog('error', 'PipelineAssistant.invoke_failed', { message });
        setStage({ kind: 'error', message });
      }
    },
    [launchArchitect, turnsAsked],
  );

  const startConversation = useCallback(
    (chosenModelId: string, userIntent: string, reconContext: string): void => {
      try {
        chatRef.current = createAssistantChat({ apiKey, modelId: chosenModelId, llmContext });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStage({ kind: 'error', message });
        return;
      }
      const models = loadRecommendedModels(repoRoot);
      const systemPrompt = buildAssistantSystemPrompt({
        models,
        reconContext,
      });
      const seed = buildInitialHumanMessage(userIntent);
      messagesRef.current = [new SystemMessage(systemPrompt), new HumanMessage(seed)];
      setHistory([{ role: 'user', text: userIntent.trim() || '(no initial description)' }]);
      setStage({ kind: 'asking' });

      // First call doesn't go through sendTurn (we already pushed the seed).
      void (async () => {
        try {
          const reply = await chatRef.current!.invokeStructured(messagesRef.current);
          if (cancelledRef.current) return;
          if (reply.done === true) {
            messagesRef.current.push(new AIMessage(JSON.stringify(reply)));
            launchArchitect(reply.pipeline);
            return;
          }
          messagesRef.current.push(new AIMessage(JSON.stringify(reply)));
          setHistory((h) => [...h, { role: 'assistant', text: turnLabel(reply) }]);
          setTurnsAsked(1);
          setStage({ kind: 'answering', turn: reply });
        } catch (err) {
          if (cancelledRef.current) return;
          const message = err instanceof Error ? err.message : String(err);
          dlog('error', 'PipelineAssistant.first_invoke_failed', { message });
          setStage({ kind: 'error', message });
        }
      })();
    },
    [apiKey, launchArchitect, repoRoot],
  );

  // ProjectRecon owns its own keyboard handler — the parent's must stay quiet
  // while it's mounted so ESC doesn't trip both layers and cancel/abort race.
  const inputActive = stage.kind !== 'recon';

  // Memoized so ProjectRecon's effect-deps don't re-fire and re-trigger recon
  // every render. `intent` and `modelId` are frozen by the time we enter recon.
  const handleReconComplete = useCallback(
    ({ markdown }: { markdown: string; results: ReconAgentResult[] }) => {
      reconRef.current = markdown;
      startConversation(modelId, intent, markdown);
    },
    [startConversation, modelId, intent],
  );
  const handleReconCancel = useCallback(() => {
    setStage({ kind: 'intent' });
  }, []);

  useInput((input, key) => {
    if (stage.kind === 'confirm-cancel') {
      if (input === 'y' || input === 'Y') {
        cancelledRef.current = true;
        onCancel();
      } else if (input === 'n' || input === 'N' || key.escape) {
        setStage(stage.previous);
      }
      return;
    }

    if (stage.kind === 'pick-model') {
      // ModelSelectorOverlay handles its own input; nothing to do here.
      return;
    }

    if (key.escape) {
      if (stage.kind === 'error') {
        onCancel();
      } else {
        setStage({ kind: 'confirm-cancel', previous: stage });
      }
      return;
    }

    if (stage.kind === 'answering') {
      const num = parseInt(input, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= stage.turn.options.length) {
        const option = stage.turn.options[num - 1]!;
        if (option.isFreeText) {
          setFreeTextDraft('');
          setStage({ kind: 'free-text', turn: stage.turn });
        } else {
          void sendTurn(option.label);
        }
      }
    }
  }, { isActive: inputActive });

  // — render —

  if (stage.kind === 'pick-model') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor={theme.ai} paddingX={1} flexDirection="column" width="100%">
          <Text bold color={theme.ai}>Pipeline Assistant</Text>
          <Text dimColor>
            This model runs the interview AND the architect (3 parallel sketches → selection → per-step prompts).
          </Text>
          <Text dimColor>
            Planning is maximum leverage — a strong model here pays for the whole run. Suggested:{' '}
            <Text color={theme.ai}>deepseek/deepseek-v4-pro</Text> · moonshotai/kimi-k2.6 · openai/gpt-5.4 · anthropic/claude-opus-4.6. Default: {DEFAULT_ASSISTANT_MODEL}
          </Text>
        </Box>
        <Box marginTop={1}>
          <ModelSelectorOverlay
            onSelect={(id) => {
              setModelId(id);
              setStage({ kind: 'intent' });
            }}
            onCancel={onCancel}
          />
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'intent') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor={theme.ai} paddingX={1} flexDirection="column" width="100%">
          <Text bold color={theme.ai}>Pipeline assistant</Text>
          <Text dimColor>Model: {modelId}</Text>

          <Box marginTop={1} flexDirection="column">
            <Text>What do you want the pipeline to do?</Text>
            <Text dimColor>Describe it in one or two sentences. Keep it concrete.</Text>
          </Box>

          <Box marginTop={1}>
            <Text color="cyan">› </Text>
            <TextInput
              value={intent}
              onChange={setIntent}
              onSubmit={() => {
                if (intent.trim()) setStage({ kind: 'recon' });
              }}
            />
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ENTER</Text> start · <Text bold>ESC</Text> back
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'recon') {
    return (
      <ProjectRecon
        apiKey={apiKey}
        repoRoot={repoRoot}
        intent={intent}
        onComplete={handleReconComplete}
        onCancel={handleReconCancel}
        llmContext={llmContext}
      />
    );
  }

  if (stage.kind === 'asking') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor={theme.ai} paddingX={1} flexDirection="column" width="100%">
          <Text bold color={theme.ai}>Pipeline Assistant</Text>
          <Text dimColor>Model: {modelId} · Turn {turnsAsked + 1}</Text>

          {history.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              {history.slice(-4).map((t, i) => (
                <Box key={i}>
                  <Text color={t.role === 'user' ? 'cyan' : 'yellow'} bold>
                    {t.role === 'user' ? 'You: ' : 'Assistant: '}
                  </Text>
                  <Text>{t.text}</Text>
                </Box>
              ))}
            </Box>
          )}

          <Box marginTop={1}>
            <Spinner label="thinking..." color={theme.ai} />
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ESC</Text> cancel
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'answering') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor={theme.ai} paddingX={1} flexDirection="column" width="100%">
          <Text bold color={theme.ai}>Pipeline Assistant</Text>
          <Text dimColor>Model: {modelId} · Turn {turnsAsked}</Text>

          <Box marginTop={1} flexDirection="column">
            <Text bold>{stage.turn.question}</Text>
            {stage.turn.rationale && <Text dimColor>{stage.turn.rationale}</Text>}
          </Box>

          <Box marginTop={1} flexDirection="column">
            {stage.turn.options.map((opt, i) => (
              <Box key={i}>
                <Text bold color="cyan">[{i + 1}] </Text>
                <Text italic={Boolean(opt.isFreeText)} dimColor={Boolean(opt.isFreeText)}>
                  {opt.label}
                </Text>
              </Box>
            ))}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>1-{stage.turn.options.length}</Text> select · <Text bold>ESC</Text> cancel
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'free-text') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor={theme.ai} paddingX={1} flexDirection="column" width="100%">
          <Text bold color={theme.ai}>Pipeline Assistant</Text>
          <Box marginTop={1} flexDirection="column">
            <Text bold>{stage.turn.question}</Text>
            <Text dimColor>Type your free-form answer:</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="cyan">› </Text>
            <TextInput
              value={freeTextDraft}
              onChange={setFreeTextDraft}
              onSubmit={() => {
                const v = freeTextDraft.trim();
                if (v) {
                  setFreeTextDraft('');
                  void sendTurn(v);
                }
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ENTER</Text> send · <Text bold>ESC</Text> cancel
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'architect') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor={theme.ai} paddingX={1} flexDirection="column" width="100%">
          <Text bold color={theme.ai}>Pipeline Architect</Text>
          <Text dimColor>Model: {modelId} · parallel sketches → selection → per-step prompts → validation</Text>

          <Box marginTop={1} flexDirection="column">
            {stage.phases.slice(-8).map((p, i, arr) => (
              <Box key={i}>
                {i === arr.length - 1 ? (
                  <Spinner label={p.detail} color={theme.ai} />
                ) : (
                  <Text dimColor>✓ {p.detail}</Text>
                )}
              </Box>
            ))}
            {stage.phases.length === 0 && (
              <Spinner label="starting the architect…" color={theme.ai} />
            )}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ESC</Text> cancel
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'confirm-cancel') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="yellow">Discard conversation?</Text>
          <Text dimColor>You will lose the context gathered so far and return to home.</Text>
          <Box marginTop={1}>
            <Text>
              <Text bold color="cyan">[Y]</Text> yes, discard  ·  <Text bold color="cyan">[N]</Text> keep going
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // error
  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="red" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="red">Assistant error</Text>
        <Box marginTop={1}><Text>{stage.message}</Text></Box>
        <Box marginTop={1}><Text dimColor>Press <Text bold>ESC</Text> to go back.</Text></Box>
      </Box>
    </Box>
  );
}
