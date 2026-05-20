import React, { useCallback, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Pipeline } from '../../lib/types.js';
import { parsePipelineFromJson } from '../../lib/pipeline-io.js';

interface Props {
  onComplete: (pipeline: Pipeline) => void;
  onCancel: () => void;
}

type Status =
  | { kind: 'waiting' }
  | { kind: 'success'; name: string }
  | { kind: 'error'; message: string };

/**
 * Captures raw stdin (pasted JSON) and auto-validates when a complete
 * JSON object is detected (balanced braces). On success, calls onComplete.
 */
export function PipelineJsonPaste({ onComplete, onCancel }: Props): React.JSX.Element {
  const bufferRef = useRef('');
  const [charCount, setCharCount] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'waiting' });
  const doneRef = useRef(false);

  const tryParse = useCallback(
    (text: string) => {
      if (doneRef.current) return;
      try {
        const pipeline = parsePipelineFromJson(text);
        doneRef.current = true;
        setStatus({ kind: 'success', name: pipeline.name });
        setTimeout(() => onComplete(pipeline), 600);
      } catch (err) {
        // If JSON.parse fails, it might be incomplete — keep buffering.
        // If Zod validation fails, show the error.
        const msg = err instanceof SyntaxError ? null : err instanceof Error ? err.message : String(err);
        if (msg) {
          setStatus({ kind: 'error', message: msg });
        }
      }
    },
    [onComplete],
  );

  const reset = useCallback(() => {
    bufferRef.current = '';
    setCharCount(0);
    setStatus({ kind: 'waiting' });
    doneRef.current = false;
  }, []);

  useInput((input, key) => {
    if (doneRef.current) return;

    if (key.escape) {
      onCancel();
      return;
    }

    // Ctrl+R to reset buffer
    if (input === '\x12') {
      reset();
      return;
    }

    // Accumulate all characters (including newlines from pasted content)
    if (input) {
      bufferRef.current += input;
      setCharCount(bufferRef.current.length);

      // Heuristic: attempt parse when buffer ends with } or ] and has balanced braces
      const trimmed = bufferRef.current.trim();
      if (trimmed.endsWith('}') || trimmed.endsWith(']')) {
        const opens = (trimmed.match(/{/g) || []).length;
        const closes = (trimmed.match(/}/g) || []).length;
        if (opens > 0 && opens === closes) {
          tryParse(trimmed);
        }
      }
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">
          Import pipeline from JSON paste
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text>Paste your pipeline JSON below. It will be validated automatically.</Text>
          <Text dimColor>The import triggers as soon as valid JSON is detected.</Text>
        </Box>

        <Box marginTop={1}>
          {status.kind === 'waiting' && (
            <Text>
              {charCount === 0 ? (
                <Text dimColor>Waiting for paste...</Text>
              ) : (
                <Text dimColor>Buffering... ({charCount} chars)</Text>
              )}
            </Text>
          )}
          {status.kind === 'success' && (
            <Text color="green">✓ Imported: {status.name}</Text>
          )}
          {status.kind === 'error' && (
            <Text color="red">✗ {status.message}</Text>
          )}
        </Box>

        {status.kind === 'error' && (
          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>Ctrl+R</Text> reset and try again
            </Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
