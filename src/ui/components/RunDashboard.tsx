import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { KanbanBoard, type KanbanCardData } from 'ink-kanban-board';
import type { AppConfig, OrchestratorResult, OrchestratorState, Pipeline } from '../../lib/types.js';
import { Orchestrator } from '../../orchestrator/index.js';
import type { AgentFactory } from '../../orchestrator/types.js';
import { agentToCard, buildBoardColumns } from '../adapters/agent-card-adapter.js';
import { AgentDetailModal } from './AgentDetailModal.js';

interface Props {
  config: AppConfig;
  pipeline: Pipeline;
  cwd: string;
  agentFactory: AgentFactory;
  /** Optional LLM resolver for merge conflicts. When omitted, conflicts abort the run. */
  conflictResolverFactory?: AgentFactory;
  onComplete: (result: OrchestratorResult) => void;
  onAbort: () => void;
}

export function RunDashboard({
  config,
  pipeline,
  cwd,
  agentFactory,
  conflictResolverFactory,
  onComplete,
  onAbort,
}: Props): React.JSX.Element {
  const orch = useMemo(
    () =>
      new Orchestrator(config, pipeline, cwd, agentFactory, {
        initialConcurrency: 2,
        conflictResolverFactory,
      }),
    [config, pipeline, cwd, agentFactory, conflictResolverFactory],
  );
  const [state, setState] = useState<OrchestratorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const unsub = orch.subscribe((s) => setState(s));
    orch.start().then(onComplete).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => unsub();
  }, [orch, onComplete]);

  const lastLogByAgent = useMemo(() => {
    const map = new Map<number, string>();
    if (!state) return map;
    for (const a of state.agents) {
      const last = a.logs[a.logs.length - 1];
      if (last) map.set(a.agentId, last);
    }
    return map;
  }, [state]);

  const columns = useMemo(() => {
    if (!state) return [];
    return buildBoardColumns(state, config.modelId, lastLogByAgent);
  }, [state, config.modelId, lastLogByAgent]);

  // Auto-focus first card if focused one disappears
  useEffect(() => {
    if (!state) return;
    if (!focusedKey && state.agents[0]) {
      setFocusedKey(String(state.agents[0].agentId));
      return;
    }
    if (focusedKey && !state.agents.find((a) => String(a.agentId) === focusedKey)) {
      const first = state.agents[0];
      setFocusedKey(first ? String(first.agentId) : null);
    }
  }, [state, focusedKey]);

  // Find focused agent
  const focusedAgent = useMemo(() => {
    if (!state || !focusedKey) return null;
    return state.agents.find((a) => String(a.agentId) === focusedKey) ?? null;
  }, [state, focusedKey]);

  useInput((input, key) => {
    if (modalOpen) {
      // CardDetailModal handles its own input; we only listen to Esc as a safety net.
      if (key.escape) setModalOpen(false);
      return;
    }
    if (input === '+' || input === '=') orch.increaseConcurrency();
    else if (input === '-' || input === '_') orch.decreaseConcurrency();
    else if (input === 'q') {
      orch.abort();
      onAbort();
    } else if (key.return && focusedAgent) {
      setModalOpen(true);
    } else if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      if (!state || state.agents.length === 0) return;
      const ids = state.agents.map((a) => String(a.agentId));
      const idx = focusedKey ? ids.indexOf(focusedKey) : -1;
      if (idx === -1) {
        setFocusedKey(ids[0]!);
      } else if (key.upArrow || key.leftArrow) {
        setFocusedKey(ids[Math.max(0, idx - 1)]!);
      } else {
        setFocusedKey(ids[Math.min(ids.length - 1, idx + 1)]!);
      }
    }
  });

  if (!state) {
    return <Text>Inicializando orchestrator...</Text>;
  }

  if (error) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text bold color="red">Erro</Text>
        <Box marginTop={1}><Text>{error}</Text></Box>
        <Box marginTop={1}><Text dimColor>q sair</Text></Box>
      </Box>
    );
  }

  // Modal overlay
  if (modalOpen && focusedAgent) {
    const focusedCard: KanbanCardData = agentToCard(
      focusedAgent,
      config.modelId,
      lastLogByAgent.get(focusedAgent.agentId),
    );
    const stepPrompt = pipeline.steps[focusedAgent.stageIndex]?.prompt ?? '(prompt indisponivel)';
    return (
      <AgentDetailModal
        card={focusedCard}
        agent={focusedAgent}
        stepPrompt={stepPrompt}
        onClose={() => setModalOpen(false)}
      />
    );
  }

  const elapsed = Math.floor(state.elapsedMs / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text bold color="cyan">programatic-agent</Text>
        <Text dimColor>  ·  </Text>
        <Text>Stage <Text bold>{state.currentStage}/{state.totalStages}</Text></Text>
        <Text dimColor>  ·  </Text>
        <Text>conc <Text bold color="yellow">{state.concurrency}</Text></Text>
        <Text dimColor>  ·  </Text>
        <Text>{mm}:{ss}</Text>
        <Text dimColor>  ·  </Text>
        <Text>{state.completedTasks}/{state.totalTasks} done</Text>
        <Text dimColor>  ·  status: </Text>
        <Text bold color={state.status === 'done' ? 'green' : state.status === 'error' ? 'red' : 'cyan'}>
          {state.status}
        </Text>
      </Box>
      <KanbanBoard
        columns={columns}
        focusedCardKey={focusedKey}
        onCardPress={(card) => {
          setFocusedKey(card.key);
          setModalOpen(true);
        }}
      />
      <Box paddingX={1}>
        <Text dimColor>+/- conc · ↑↓←→ navega · Enter detalhes · q sair</Text>
      </Box>
    </Box>
  );
}
