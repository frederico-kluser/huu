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
import { loadRecommendedModels } from '../../models/catalog.js';
import type { AssistantTurn, PipelineDraft, QuestionTurn } from '../../lib/assistant-schema.js';
import type { Pipeline, PromptStep } from '../../lib/types.js';
import { ModelSelectorOverlay } from './ModelSelectorOverlay.js';
import { ProjectRecon } from './ProjectRecon.js';
import type { ReconAgentResult } from '../../lib/project-recon.js';
import { Spinner } from './Spinner.js';
import { log as dlog } from '../../lib/debug-logger.js';

const FULL_CLEAR = '\x1b[3J';
const MAX_TURNS = 8;

interface Props {
  apiKey: string;
  onComplete: (pipeline: Pipeline) => void;
  onCancel: () => void;
}

type Stage =
  | { kind: 'pick-model' }
  | { kind: 'intent' }
  | { kind: 'recon' }
  | { kind: 'asking' }
  | { kind: 'answering'; turn: QuestionTurn }
  | { kind: 'free-text'; turn: QuestionTurn }
  | { kind: 'confirm-cancel'; previous: Stage }
  | { kind: 'error'; message: string };

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

function turnLabel(turn: QuestionTurn): string {
  return turn.question;
}

function draftToPipeline(draft: PipelineDraft): Pipeline {
  const steps: PromptStep[] = draft.steps.map((s) => ({
    name: s.name,
    prompt: s.prompt,
    files: [],
    scope: s.scope,
    ...(s.modelId ? { modelId: s.modelId } : {}),
  }));
  return { name: draft.name, steps };
}

export function PipelineAssistant({
  apiKey,
  onComplete,
  onCancel,
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

      // Cap reached → nudge the model toward `done: true` before the call.
      if (turnsAsked >= MAX_TURNS) {
        messagesRef.current.push(new SystemMessage(FORCE_DONE_NUDGE));
      }

      try {
        const reply: AssistantTurn = await chat.invokeStructured(messagesRef.current);
        if (cancelledRef.current) return;

        if (reply.done === true) {
          // Push assistant message as JSON marker so the model can see the
          // synthesis if we ever extend this into a "review pipeline" loop.
          messagesRef.current.push(new AIMessage(JSON.stringify(reply)));
          dlog('action', 'PipelineAssistant.complete', {
            steps: reply.pipeline.steps.length,
          });
          onComplete(draftToPipeline(reply.pipeline));
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
    [onComplete, turnsAsked],
  );

  const startConversation = useCallback(
    (chosenModelId: string, userIntent: string, reconContext: string): void => {
      try {
        chatRef.current = createAssistantChat({ apiKey, modelId: chosenModelId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStage({ kind: 'error', message });
        return;
      }
      const models = loadRecommendedModels(repoRoot);
      const systemPrompt = buildAssistantSystemPrompt({
        models,
        maxTurns: MAX_TURNS,
        reconContext,
      });
      const seed = buildInitialHumanMessage(userIntent);
      messagesRef.current = [new SystemMessage(systemPrompt), new HumanMessage(seed)];
      setHistory([{ role: 'user', text: userIntent.trim() || '(sem descrição inicial)' }]);
      setStage({ kind: 'asking' });

      // First call doesn't go through sendTurn (we already pushed the seed).
      void (async () => {
        try {
          const reply = await chatRef.current!.invokeStructured(messagesRef.current);
          if (cancelledRef.current) return;
          if (reply.done === true) {
            onComplete(draftToPipeline(reply.pipeline));
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
    [apiKey, onComplete, repoRoot],
  );

  // ProjectRecon owns its own keyboard handler — the parent's must stay quiet
  // while it's mounted so ESC doesn't trip both layers and cancel/abort race.
  const inputActive = stage.kind !== 'recon';

  // Memoized so ProjectRecon's effect-deps don't re-fire and re-trigger recon
  // every render. `intent` and `modelId` are frozen by the time we enter recon.
  const handleReconComplete = useCallback(
    ({ markdown }: { markdown: string; results: ReconAgentResult[] }) => {
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
        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="magenta">Assistente de pipeline</Text>
          <Text dimColor>Escolha o modelo que vai conduzir a entrevista (default: {DEFAULT_ASSISTANT_MODEL})</Text>
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
        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="magenta">Assistente de pipeline</Text>
          <Text dimColor>Modelo: {modelId}</Text>

          <Box marginTop={1} flexDirection="column">
            <Text>O que você quer que a pipeline faça?</Text>
            <Text dimColor>Descreva em uma ou duas frases. Pode ser bem objetivo.</Text>
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
              <Text bold>ENTER</Text> começar · <Text bold>ESC</Text> voltar
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
        onComplete={handleReconComplete}
        onCancel={handleReconCancel}
      />
    );
  }

  if (stage.kind === 'asking') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="magenta">Assistente de pipeline</Text>
          <Text dimColor>Modelo: {modelId} · Turno {turnsAsked + 1}/{MAX_TURNS}</Text>

          {history.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              {history.slice(-4).map((t, i) => (
                <Box key={i}>
                  <Text color={t.role === 'user' ? 'cyan' : 'yellow'} bold>
                    {t.role === 'user' ? 'Você: ' : 'Assistente: '}
                  </Text>
                  <Text>{t.text}</Text>
                </Box>
              ))}
            </Box>
          )}

          <Box marginTop={1}>
            <Spinner label="pensando..." color="magenta" />
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ESC</Text> cancelar
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'answering') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="magenta">Assistente de pipeline</Text>
          <Text dimColor>Modelo: {modelId} · Turno {turnsAsked}/{MAX_TURNS}</Text>

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
              <Text bold>1-{stage.turn.options.length}</Text> escolher · <Text bold>ESC</Text> cancelar
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'free-text') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="magenta">Assistente de pipeline</Text>
          <Box marginTop={1} flexDirection="column">
            <Text bold>{stage.turn.question}</Text>
            <Text dimColor>Digite sua resposta livre:</Text>
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
              <Text bold>ENTER</Text> enviar · <Text bold>ESC</Text> cancelar
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
          <Text bold color="yellow">Descartar conversa?</Text>
          <Text dimColor>Você vai perder o contexto coletado até aqui e voltar pra home.</Text>
          <Box marginTop={1}>
            <Text>
              <Text bold color="cyan">[Y]</Text> sim, descartar  ·  <Text bold color="cyan">[N]</Text> continuar
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
        <Text bold color="red">Erro no assistente</Text>
        <Box marginTop={1}><Text>{stage.message}</Text></Box>
        <Box marginTop={1}><Text dimColor>Pressione <Text bold>ESC</Text> para voltar.</Text></Box>
      </Box>
    </Box>
  );
}
