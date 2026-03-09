// InterventionInput — text input for steer/follow-up and confirmation for abort/promote
//
// Captures human instructions with focus-managed text input.
// For steer/follow-up: free-text input + Enter to submit.
// For abort: confirmation prompt (y/n).
// For promote: multi-field form (title, content, confidence).

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

// ── Types ─────────────────────────────────────────────────────────────

export type InterventionMode = 'steer' | 'follow-up' | 'abort' | 'promote';

export interface SteerSubmission {
  kind: 'steer';
  text: string;
}

export interface FollowUpSubmission {
  kind: 'follow_up';
  text: string;
}

export interface AbortSubmission {
  kind: 'abort';
  confirmed: boolean;
}

export interface PromoteSubmission {
  kind: 'promote';
  title: string;
  content: string;
  tags: string[];
  confidence: number;
}

export type InterventionSubmission =
  | SteerSubmission
  | FollowUpSubmission
  | AbortSubmission
  | PromoteSubmission;

export interface InterventionInputProps {
  mode: InterventionMode;
  isActive: boolean;
  onSubmit: (submission: InterventionSubmission) => void;
  onCancel: () => void;
}

// ── Placeholders ──────────────────────────────────────────────────────

const PLACEHOLDERS: Record<InterventionMode, string> = {
  steer: 'Redirect the agent...',
  'follow-up': 'Instruction for after current turn...',
  abort: 'Press Y to confirm abort, N or ESC to cancel',
  promote: 'Title for the learning...',
};

// ── Component ─────────────────────────────────────────────────────────

export function InterventionInput({
  mode,
  isActive,
  onSubmit,
  onCancel,
}: InterventionInputProps): React.JSX.Element {
  const [value, setValue] = useState('');
  const [promoteStep, setPromoteStep] = useState<'title' | 'content' | 'tags' | 'confidence'>('title');
  const [promoteData, setPromoteData] = useState({ title: '', content: '', tags: '' });

  const reset = useCallback(() => {
    setValue('');
    setPromoteStep('title');
    setPromoteData({ title: '', content: '', tags: '' });
  }, []);

  useInput(
    (input, key) => {
      if (!isActive) return;

      // ESC cancels any mode
      if (key.escape) {
        reset();
        onCancel();
        return;
      }

      // Abort mode: Y/N confirmation
      if (mode === 'abort') {
        if (input === 'y' || input === 'Y') {
          onSubmit({ kind: 'abort', confirmed: true });
          reset();
        } else if (input === 'n' || input === 'N') {
          reset();
          onCancel();
        }
        return;
      }

      // Promote mode: multi-step form
      if (mode === 'promote') {
        if (key.return) {
          if (promoteStep === 'title') {
            if (value.trim()) {
              setPromoteData((prev) => ({ ...prev, title: value.trim() }));
              setValue('');
              setPromoteStep('content');
            }
          } else if (promoteStep === 'content') {
            if (value.trim()) {
              setPromoteData((prev) => ({ ...prev, content: value.trim() }));
              setValue('');
              setPromoteStep('tags');
            }
          } else if (promoteStep === 'tags') {
            setPromoteData((prev) => ({ ...prev, tags: value.trim() }));
            setValue('');
            setPromoteStep('confidence');
          } else if (promoteStep === 'confidence') {
            const conf = parseFloat(value) || 0.5;
            const clamped = Math.max(0.3, Math.min(0.85, conf));
            onSubmit({
              kind: 'promote',
              title: promoteData.title,
              content: promoteData.content,
              tags: promoteData.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
              confidence: clamped,
            });
            reset();
          }
          return;
        }

        // Text editing
        if (key.backspace || key.delete) {
          setValue((prev) => prev.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          setValue((prev) => prev + input);
        }
        return;
      }

      // Steer / Follow-up mode: text input + Enter
      if (key.return) {
        if (value.trim()) {
          if (mode === 'steer') {
            onSubmit({ kind: 'steer', text: value.trim() });
          } else {
            onSubmit({ kind: 'follow_up', text: value.trim() });
          }
          reset();
        }
        return;
      }

      // Text editing
      if (key.backspace || key.delete) {
        setValue((prev) => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setValue((prev) => prev + input);
      }
    },
    { isActive },
  );

  if (!isActive) return <></>;

  // Abort confirmation
  if (mode === 'abort') {
    return (
      <Box borderStyle="single" borderColor="red" paddingX={1}>
        <Text color="red" bold>
          Abort agent? [Y]es / [N]o
        </Text>
      </Box>
    );
  }

  // Promote multi-step form
  if (mode === 'promote') {
    const stepLabels: Record<typeof promoteStep, string> = {
      title: 'Title',
      content: 'Content (learning)',
      tags: 'Tags (comma-separated)',
      confidence: 'Confidence (0.3-0.85)',
    };

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="green" paddingX={1}>
        <Text color="green" bold>
          Promote to Instinct — Step: {stepLabels[promoteStep]}
        </Text>
        {promoteData.title && (
          <Text dimColor>Title: {promoteData.title}</Text>
        )}
        {promoteData.content && (
          <Text dimColor>Content: {promoteData.content.slice(0, 60)}...</Text>
        )}
        {promoteData.tags && promoteStep !== 'tags' && (
          <Text dimColor>Tags: {promoteData.tags}</Text>
        )}
        <Box>
          <Text color="green">&gt; </Text>
          <Text>{value || PLACEHOLDERS.promote}</Text>
          <Text color="green">{'_'}</Text>
        </Box>
        <Text dimColor>Enter: next step | ESC: cancel</Text>
      </Box>
    );
  }

  // Steer / Follow-up text input
  const color = mode === 'steer' ? 'cyan' : 'blue';
  const label = mode === 'steer' ? 'Steer' : 'Follow-up';

  return (
    <Box borderStyle="single" borderColor={color} paddingX={1}>
      <Text color={color} bold>
        {label}:{' '}
      </Text>
      <Text>{value || PLACEHOLDERS[mode]}</Text>
      <Text color={color}>{'_'}</Text>
      <Box flexGrow={1} />
      <Text dimColor>Enter: send | ESC: cancel</Text>
    </Box>
  );
}
