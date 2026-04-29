import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { PromptStep } from '../../lib/types.js';
import {
  createRefinementChat,
  DEFAULT_REFINEMENT_MODEL,
  type RefinementChat,
} from '../../lib/langchain-client.js';
import {
  buildRefinerSystemPrompt,
  buildSynthesisRequest,
} from '../../lib/refinement-prompts.js';

interface Props {
  step: PromptStep;
  stageIndex: number;
  totalStages: number;
  apiKey: string;
  onComplete: (refinedPrompt: string) => void;
  onCancel: () => void;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const FULL_CLEAR = '\x1b[3J';

export function InteractiveStep({
  step,
  stageIndex,
  totalStages,
  apiKey,
  onComplete,
  onCancel,
}: Props): React.JSX.Element {
  const { stdout } = useStdout();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);

  // Conversation history fed to the model. Refs survive re-renders without
  // triggering effect re-runs the way state would.
  const historyRef = useRef<BaseMessage[]>([]);
  const chatRef = useRef<RefinementChat | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (stdout.isTTY) stdout.write(FULL_CLEAR);
  }, [stdout]);

  // Bootstrap: instantiate the chat client, send the system prompt + initial
  // user message (the author's seed prompt, or a stub asking for intent).
  useEffect(() => {
    let cancelled = false;
    try {
      chatRef.current = createRefinementChat({
        apiKey,
        modelId: step.refinementModel ?? DEFAULT_REFINEMENT_MODEL,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }

    const systemPrompt = buildRefinerSystemPrompt({
      stageName: step.name,
      initialPrompt: step.prompt,
      files: step.files,
    });
    const seed = step.prompt
      ? `Esta é minha intenção inicial para a etapa "${step.name}":\n\n${step.prompt}\n\nMe ajude a refinar.`
      : `Quero refinar a etapa "${step.name}". Me pergunte o que precisar.`;

    historyRef.current = [new SystemMessage(systemPrompt), new HumanMessage(seed)];

    (async () => {
      try {
        const reply = await chatRef.current!.invoke(historyRef.current);
        if (cancelled) return;
        const text = messageText(reply);
        historyRef.current.push(new AIMessage(text));
        setTurns([
          { role: 'user', text: seed },
          { role: 'assistant', text },
        ]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
      cancelledRef.current = true;
    };
  }, [apiKey, step]);

  const submitTurn = async (userInput: string): Promise<void> => {
    const trimmed = userInput.trim();
    if (!trimmed) return;
    if (!chatRef.current) return;
    setBusy(true);
    setDraft('');
    setTurns((prev) => [...prev, { role: 'user', text: trimmed }]);
    historyRef.current.push(new HumanMessage(trimmed));
    try {
      const reply = await chatRef.current.invoke(historyRef.current);
      if (cancelledRef.current) return;
      const text = messageText(reply);
      historyRef.current.push(new AIMessage(text));
      setTurns((prev) => [...prev, { role: 'assistant', text }]);
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  };

  const synthesizeAndFinish = async (): Promise<void> => {
    if (!chatRef.current || synthesizing) return;
    setSynthesizing(true);
    setBusy(true);
    const synthesisMsg = buildSynthesisRequest({
      stageName: step.name,
      initialPrompt: step.prompt,
      files: step.files,
    });
    historyRef.current.push(new HumanMessage(synthesisMsg));
    try {
      const reply = await chatRef.current.invoke(historyRef.current);
      if (cancelledRef.current) return;
      const refined = messageText(reply).trim();
      onComplete(refined || step.prompt);
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
        setSynthesizing(false);
      }
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      cancelledRef.current = true;
      onCancel();
      return;
    }
    // Ctrl+D synthesizes the refined prompt and exits. ink reports it as
    // input === '\x04' under raw mode.
    if (input === '\x04' && !busy) {
      void synthesizeAndFinish();
    }
  });

  const promptDisplay = step.prompt || '(sem prompt inicial — descreva sua intenção)';
  const filesLine =
    step.files.length === 0
      ? 'whole project'
      : step.files.length === 1
        ? step.files[0]!
        : `${step.files.length} files (${step.files.slice(0, 2).join(', ')}…)`;

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="magenta">
          ⌬ refinement · stage {stageIndex + 1}/{totalStages} · {step.name}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>prompt inicial:</Text>
          <Text>{promptDisplay}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>files: </Text>
          <Text>{filesLine}</Text>
          <Text dimColor>  ·  model: </Text>
          <Text>{step.refinementModel ?? DEFAULT_REFINEMENT_MODEL}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingX={1}>
        {turns.slice(-12).map((t, idx) => (
          <Box key={idx} flexDirection="column" marginBottom={1}>
            <Text bold color={t.role === 'user' ? 'cyan' : 'green'}>
              {t.role === 'user' ? 'você' : 'kimi'}
            </Text>
            <Text>{t.text}</Text>
          </Box>
        ))}
        {busy && (
          <Text dimColor>{synthesizing ? 'sintetizando prompt final…' : 'pensando…'}</Text>
        )}
        {error && (
          <Box marginTop={1}>
            <Text color="red">erro: {error}</Text>
          </Box>
        )}
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text color="cyan">› </Text>
        {busy ? (
          <Text dimColor>(aguarde…)</Text>
        ) : (
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={(v) => void submitTurn(v)}
            placeholder="responda ou pergunte; ENTER envia"
          />
        )}
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          <Text bold>ENTER</Text> enviar · <Text bold>Ctrl+D</Text> finalizar e usar o prompt refinado · <Text bold>ESC</Text> cancelar stage
        </Text>
      </Box>
    </Box>
  );
}

function messageText(msg: BaseMessage | AIMessage): string {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }
  return JSON.stringify(c);
}
