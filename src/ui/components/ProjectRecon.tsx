import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from './Spinner.js';
import {
  RECON_MODEL,
  buildReconContextMarkdown,
  selectAndRunRecon,
  type ReconAgentResult,
  type ReconRunItem,
  type ReconStatus,
  type ReconUpdate,
} from '../../lib/project-recon.js';
import { log as dlog } from '../../lib/debug-logger.js';

interface Props {
  apiKey: string;
  repoRoot: string;
  /** What the user typed when asked "o que você quer que a pipeline faça?" —
   *  feeds the selector that picks which recon processes to run. */
  intent: string;
  modelId?: string;
  onComplete: (payload: { markdown: string; results: ReconAgentResult[] }) => void;
  onCancel: () => void;
}

interface AgentState {
  status: ReconStatus;
  bullets?: readonly string[];
  error?: string;
}

type Phase = 'selecting' | 'running';

interface ReconState {
  phase: Phase;
  items: readonly ReconRunItem[];
  byTag: Record<string, AgentState>;
}

type ReconAction =
  | { type: 'items-resolved'; items: readonly ReconRunItem[] }
  | { type: 'agent-update'; update: ReconUpdate };

const INITIAL_STATE: ReconState = {
  phase: 'selecting',
  items: [],
  byTag: {},
};

function reduce(state: ReconState, action: ReconAction): ReconState {
  switch (action.type) {
    case 'items-resolved': {
      const byTag: Record<string, AgentState> = {};
      for (const item of action.items) byTag[item.tag] = { status: 'pending' };
      return { phase: 'running', items: action.items, byTag };
    }
    case 'agent-update': {
      const { agentId, status, bullets, error } = action.update;
      return {
        ...state,
        byTag: {
          ...state.byTag,
          [agentId]: { status, bullets, error },
        },
      };
    }
  }
}

/**
 * Pre-flight project reconnaissance screen. Two phases:
 *
 *   1. Selecting — single spinner while the selector LLM picks which catalog
 *      processes (and/or custom missions) apply to the user's intent.
 *   2. Running — one row per resolved item, each with its own spinner /
 *      check / cross + bullets, fanning out in parallel.
 *
 * Calls `onComplete` once every item has settled (success or error); calls
 * `onCancel` if the user hits ESC. Errors are NOT fatal: an empty-bullets
 * item still resolves the screen so the assistant can proceed with whatever
 * context the surviving items gathered.
 */
export function ProjectRecon({
  apiKey,
  repoRoot,
  intent,
  modelId,
  onComplete,
  onCancel,
}: Props): React.JSX.Element {
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
  const [selectorError, setSelectorError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current = new AbortController();
    void (async () => {
      try {
        const { items, results } = await selectAndRunRecon({
          apiKey,
          repoRoot,
          intent,
          modelId,
          signal: abortRef.current!.signal,
          onItemsResolved: (items) => {
            if (!cancelledRef.current) {
              dispatch({ type: 'items-resolved', items });
            }
          },
          onUpdate: (u) => {
            if (!cancelledRef.current) dispatch({ type: 'agent-update', update: u });
          },
        });
        if (cancelledRef.current) return;
        const markdown = buildReconContextMarkdown(results);
        dlog('action', 'ProjectRecon.complete', {
          total: items.length,
          ok: results.filter((r) => r.status === 'done').length,
          err: results.filter((r) => r.status === 'error').length,
        });
        onComplete({ markdown, results });
      } catch (err) {
        if (cancelledRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        dlog('error', 'ProjectRecon.failed', { msg });
        setSelectorError(msg);
        // Hand control back to the parent so the assistant can continue
        // without recon context rather than dead-end here.
        onComplete({ markdown: '', results: [] });
      }
    })();

    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
  }, [apiKey, repoRoot, intent, modelId, onComplete]);

  useInput((_, key) => {
    if (key.escape) {
      cancelledRef.current = true;
      abortRef.current?.abort();
      onCancel();
    }
  });

  const renderedModel = modelId ?? RECON_MODEL;

  if (state.phase === 'selecting') {
    return (
      <Box flexDirection="column" width="100%">
        <Box
          borderStyle="round"
          borderColor="magenta"
          paddingX={1}
          flexDirection="column"
          width="100%"
        >
          <Text bold color="magenta">Análise do projeto</Text>
          <Text dimColor>modelo: {renderedModel}</Text>
          <Box marginTop={1}>
            <Spinner color="magenta" label="Selecionando o que investigar..." />
          </Box>
          {selectorError && (
            <Box marginTop={1}>
              <Text color="red">Falha no seletor: {selectorError.slice(0, 80)}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ESC</Text> cancelar
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  const total = state.items.length;
  const settled = state.items.filter(
    (item) =>
      state.byTag[item.tag]?.status === 'done' ||
      state.byTag[item.tag]?.status === 'error',
  ).length;

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        flexDirection="column"
        width="100%"
      >
        <Text bold color="magenta">Análise do projeto</Text>
        <Text dimColor>
          {total} processos em paralelo · modelo: {renderedModel} · {settled}/{total} concluídos
        </Text>

        <Box marginTop={1} flexDirection="column">
          {state.items.map((item) => (
            <AgentRow
              key={item.tag}
              item={item}
              state={state.byTag[item.tag] ?? { status: 'pending' }}
            />
          ))}
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

function AgentRow({
  item,
  state,
}: {
  item: ReconRunItem;
  state: AgentState;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={state.status === 'done' ? 1 : 0}>
      <Box>
        {state.status === 'done' ? (
          <Text color="green">✓</Text>
        ) : state.status === 'error' ? (
          <Text color="red">✗</Text>
        ) : (
          <Spinner color="magenta" />
        )}
        <Text> </Text>
        <Text bold>{item.label}</Text>
        {item.source === 'custom' && (
          <Text dimColor>  (custom)</Text>
        )}
        {state.status === 'error' && state.error && (
          <Text dimColor>  ({state.error.slice(0, 80)})</Text>
        )}
      </Box>
      {state.status === 'done' && state.bullets && state.bullets.length > 0 && (
        <Box marginLeft={2} flexDirection="column">
          {state.bullets.slice(0, 3).map((b, i) => (
            <Text key={i} dimColor>• {b}</Text>
          ))}
          {state.bullets.length > 3 && (
            <Text dimColor>• … (+{state.bullets.length - 3})</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
