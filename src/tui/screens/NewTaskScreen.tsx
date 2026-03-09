// Tela de criação de nova tarefa — overlay full-screen
//
// Campo de texto livre para descrever a tarefa.
// Enter submete, ESC cancela.
// Mostra tarefas recentes se disponíveis.

import React, { useState, useCallback } from 'react';
import { Box, Text, Spacer, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Panel } from '../components/Panel.js';
import { BottomBar } from '../components/BottomBar.js';
import type { RecentTask } from '../types.js';

interface NewTaskScreenProps {
  recentTasks: RecentTask[];
  onSubmit: (description: string) => void;
  onCancel: () => void;
  isActive: boolean;
  terminalRows: number;
}

const STATUS_LABELS: Record<RecentTask['status'], { label: string; color: string }> = {
  running: { label: 'em andamento', color: 'yellow' },
  done: { label: 'conclu\u00edda', color: 'green' },
  failed: { label: 'falhou', color: 'red' },
};

export function NewTaskScreen({
  recentTasks,
  onSubmit,
  onCancel,
  isActive,
  terminalRows,
}: NewTaskScreenProps): React.JSX.Element {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 5) {
      setError('A descri\u00e7\u00e3o deve ter pelo menos 5 caracteres.');
      return;
    }
    setError('');
    onSubmit(trimmed);
    setValue('');
  }, [onSubmit]);

  useInput((input: string, key: { escape: boolean }) => {
    if (!isActive) return;
    if (key.escape) {
      onCancel();
    }
  }, { isActive });

  const visibleRecent = recentTasks.slice(0, Math.max(3, terminalRows - 20));

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Barra superior */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">HUU</Text>
        <Text dimColor> {'\u2502'} </Text>
        <Text bold color="yellow">Nova Tarefa</Text>
        <Spacer />
        <Text dimColor>ESC voltar</Text>
      </Box>

      {/* Conte\u00fado central */}
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" paddingX={4}>
        <Panel
          title="Descreva a tarefa"
          titleColor="cyan"
          borderColor="cyan"
          width="100%"
        >
          <Box flexDirection="column" gap={1} paddingY={1}>
            <Text>
              O que voc\u00ea quer que os agentes fa\u00e7am?
            </Text>

            <Box marginTop={1}>
              <Text bold color="cyan">{'\u276F'} </Text>
              <TextInput
                value={value}
                onChange={(v: string) => { setValue(v); setError(''); }}
                onSubmit={handleSubmit}
                placeholder="Ex: Adicionar endpoint de health check com testes..."
              />
            </Box>

            {error && (
              <Box>
                <Text color="red">{'\u2716'} {error}</Text>
              </Box>
            )}

            <Box marginTop={1}>
              <Text dimColor>
                A tarefa ser\u00e1 decomposta pelo orquestrador em um Beat Sheet
                e delegada para os agentes especializados automaticamente.
              </Text>
            </Box>
          </Box>
        </Panel>

        {/* Tarefas recentes */}
        {visibleRecent.length > 0 && (
          <Box marginTop={1} flexDirection="column" width="100%" paddingX={2}>
            <Text dimColor bold>Tarefas recentes:</Text>
            {visibleRecent.map((task) => {
              const info = STATUS_LABELS[task.status];
              return (
                <Box key={task.id} gap={1}>
                  <Text dimColor>{'\u2022'}</Text>
                  <Text dimColor>{task.description}</Text>
                  <Text color={info.color}>({info.label}</Text>
                  <Text dimColor>${task.costUsd.toFixed(2)})</Text>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Barra inferior */}
      <BottomBar bindings={[
        { key: 'Enter', label: 'Executar' },
        { key: 'ESC', label: 'Cancelar' },
      ]} />
    </Box>
  );
}
