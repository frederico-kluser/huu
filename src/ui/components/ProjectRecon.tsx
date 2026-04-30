import React, { useEffect, useReducer, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from './Spinner.js';
import {
  RECON_AGENTS,
  RECON_MODEL,
  buildReconContextMarkdown,
  runProjectRecon,
  type ReconAgent,
  type ReconAgentId,
  type ReconAgentResult,
  type ReconStatus,
  type ReconUpdate,
} from '../../lib/project-recon.js';
import { log as dlog } from '../../lib/debug-logger.js';

interface Props {
  apiKey: string;
  repoRoot: string;
  modelId?: string;
  onComplete: (payload: { markdown: string; results: ReconAgentResult[] }) => void;
  onCancel: () => void;
}

interface AgentState {
  status: ReconStatus;
  bullets?: readonly string[];
  error?: string;
}

type ReconState = Record<ReconAgentId, AgentState>;

const INITIAL_STATE: ReconState = RECON_AGENTS.reduce<ReconState>((acc, a) => {
  acc[a.id] = { status: 'pending' };
  return acc;
}, {} as ReconState);

function reduce(state: ReconState, update: ReconUpdate): ReconState {
  return {
    ...state,
    [update.agentId]: {
      status: update.status,
      bullets: update.bullets,
      error: update.error,
    },
  };
}

/**
 * Pre-flight project reconnaissance screen. Mounts → fires N agents in
 * parallel against minimax-m2.7, renders one row per agent with its own
 * spinner / check / cross + bullets. Calls `onComplete` once every agent has
 * settled (success or error); calls `onCancel` if the user hits ESC.
 *
 * Errors are NOT fatal: an empty-bullets agent still resolves the screen so
 * the assistant can proceed with whatever context the surviving agents
 * gathered.
 */
export function ProjectRecon({
  apiKey,
  repoRoot,
  modelId,
  onComplete,
  onCancel,
}: Props): React.JSX.Element {
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current = new AbortController();
    void (async () => {
      try {
        const results = await runProjectRecon({
          apiKey,
          repoRoot,
          modelId,
          signal: abortRef.current!.signal,
          onUpdate: (u) => {
            if (!cancelledRef.current) dispatch(u);
          },
        });
        if (cancelledRef.current) return;
        const markdown = buildReconContextMarkdown(results);
        dlog('action', 'ProjectRecon.complete', {
          ok: results.filter((r) => r.status === 'done').length,
          err: results.filter((r) => r.status === 'error').length,
        });
        onComplete({ markdown, results });
      } catch (err) {
        if (cancelledRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        dlog('error', 'ProjectRecon.failed', { msg });
        // Still hand control back to the parent — let the assistant continue
        // without recon context rather than dead-end here.
        onComplete({ markdown: '', results: [] });
      }
    })();

    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
  }, [apiKey, repoRoot, modelId, onComplete]);

  useInput((_, key) => {
    if (key.escape) {
      cancelledRef.current = true;
      abortRef.current?.abort();
      onCancel();
    }
  });

  const total = RECON_AGENTS.length;
  const settled = RECON_AGENTS.filter(
    (a) => state[a.id].status === 'done' || state[a.id].status === 'error',
  ).length;
  const renderedModel = modelId ?? RECON_MODEL;

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
          {total} agentes em paralelo · modelo: {renderedModel} · {settled}/{total} concluídos
        </Text>

        <Box marginTop={1} flexDirection="column">
          {RECON_AGENTS.map((agent) => (
            <AgentRow key={agent.id} agent={agent} state={state[agent.id]} />
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
  agent,
  state,
}: {
  agent: ReconAgent;
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
        <Text bold>{agent.label}</Text>
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
