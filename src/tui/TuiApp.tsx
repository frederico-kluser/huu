// Root TUI application — full-screen, single entry point
//
// Tela principal é o Dashboard. Overlays para:
//   - Setup Wizard (primeira execução)
//   - Nova Tarefa (N)
//   - Configurações gerais (O)
//   - Troca de modelo de agente (G — delegado ao App)
//
// Também suporta o modo legado de renderização (setup, config, run, status)
// para manter compatibilidade com render.tsx.

import React, { useState, useCallback } from 'react';
import { Box, useApp, useStdout } from 'ink';
import { FullScreenLayout } from './components/FullScreenLayout.js';
import { SetupWizard } from './screens/SetupWizard.js';
import type { SetupResult } from './screens/SetupWizard.js';
import { ConfigScreen } from './screens/ConfigScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import type { RunPhase, RunLogEntry, RunMetrics } from './screens/RunScreen.js';
import { StatusScreen } from './screens/StatusScreen.js';
import type { StatusSnapshot } from '../cli/commands/status.js';
import { NewTaskScreen } from './screens/NewTaskScreen.js';
import App from './App.js';
import type { AppProps } from './App.js';
import type { HuuConfig } from '../cli/config.js';
import type { RecentTask } from './types.js';

// ── Screen types ────────────────────────────────────────────────────

export type TuiScreen = 'setup' | 'config' | 'run' | 'status' | 'dashboard';

type ActiveOverlay = 'none' | 'new-task' | 'config';

// ── Props ───────────────────────────────────────────────────────────

interface TuiAppProps {
  initialScreen: TuiScreen;

  // Setup wizard props
  hasApiKey?: boolean;
  hasInit?: boolean;
  onSetupComplete?: (result: SetupResult) => void;

  // Config props
  config?: HuuConfig;
  onConfigSave?: (config: HuuConfig) => void;

  // Run props
  taskDescription?: string;
  runPhase?: RunPhase;
  runLogs?: RunLogEntry[];
  runMetrics?: RunMetrics | null;
  runError?: string | null;

  // Status props
  statusSnapshot?: StatusSnapshot;

  // Dashboard props
  dashboardProps?: AppProps;

  // New task handler — chamado quando o usuário submete uma nova tarefa
  onNewTask?: ((description: string) => void) | undefined;

  // Tarefas recentes para exibir na tela de nova tarefa
  recentTasks?: RecentTask[] | undefined;

  // Full-screen mode — true para TUI full-screen, false para modo legado
  fullScreen?: boolean;
}

// ── Component ───────────────────────────────────────────────────────

export function TuiApp({
  initialScreen,
  hasApiKey = false,
  hasInit = false,
  onSetupComplete,
  config,
  onConfigSave,
  taskDescription = '',
  runPhase = 'preparing',
  runLogs = [],
  runMetrics = null,
  runError = null,
  statusSnapshot,
  dashboardProps,
  onNewTask,
  recentTasks = [],
  fullScreen = false,
}: TuiAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [screen, setScreen] = useState<TuiScreen>(initialScreen);
  const [overlay, setOverlay] = useState<ActiveOverlay>('none');

  const terminalRows = stdout.rows ?? 24;

  // ── Callbacks ───────────────────────────────────────────────────

  const handleSetupComplete = useCallback((result: SetupResult) => {
    if (onSetupComplete) {
      onSetupComplete(result);
    }
    // Em modo full-screen, após setup vai para o dashboard
    if (fullScreen) {
      setScreen('dashboard');
    } else {
      exit();
    }
  }, [onSetupComplete, exit, fullScreen]);

  const handleConfigSave = useCallback((cfg: HuuConfig) => {
    if (onConfigSave) {
      onConfigSave(cfg);
    }
    if (fullScreen) {
      setOverlay('none');
    } else {
      exit();
    }
  }, [onConfigSave, exit, fullScreen]);

  const handleConfigCancel = useCallback(() => {
    if (fullScreen) {
      setOverlay('none');
    } else {
      exit();
    }
  }, [exit, fullScreen]);

  const handleExit = useCallback(() => {
    exit();
  }, [exit]);

  const handleOpenNewTask = useCallback(() => {
    setOverlay('new-task');
  }, []);

  const handleNewTaskSubmit = useCallback((description: string) => {
    setOverlay('none');
    onNewTask?.(description);
  }, [onNewTask]);

  const handleNewTaskCancel = useCallback(() => {
    setOverlay('none');
  }, []);

  const handleOpenConfig = useCallback(() => {
    setOverlay('config');
  }, []);

  // ── Render logic ──────────────────────────────────────────────

  function renderContent(): React.JSX.Element {
    // Overlays sobre o dashboard (apenas em modo full-screen)
    if (screen === 'dashboard' && overlay === 'new-task') {
      return (
        <NewTaskScreen
          recentTasks={recentTasks}
          onSubmit={handleNewTaskSubmit}
          onCancel={handleNewTaskCancel}
          isActive={true}
          terminalRows={terminalRows}
        />
      );
    }

    if (screen === 'dashboard' && overlay === 'config' && config) {
      return (
        <ConfigScreen
          config={config}
          onSave={handleConfigSave}
          onCancel={handleConfigCancel}
        />
      );
    }

    switch (screen) {
      case 'setup':
        return (
          <SetupWizard
            hasApiKey={hasApiKey}
            hasInit={hasInit}
            onComplete={handleSetupComplete}
            onSkip={handleExit}
          />
        );

      case 'config':
        if (!config) return <Box />;
        return (
          <ConfigScreen
            config={config}
            onSave={handleConfigSave}
            onCancel={handleConfigCancel}
          />
        );

      case 'run':
        return (
          <RunScreen
            taskDescription={taskDescription}
            phase={runPhase}
            logs={runLogs}
            metrics={runMetrics}
            error={runError}
            onExit={handleExit}
          />
        );

      case 'status':
        if (!statusSnapshot) return <Box />;
        return (
          <StatusScreen
            snapshot={statusSnapshot}
            onExit={handleExit}
          />
        );

      case 'dashboard':
        return (
          <App
            {...(dashboardProps ?? {})}
            onNewTask={handleOpenNewTask}
            onOpenConfig={handleOpenConfig}
          />
        );
    }
  }

  if (fullScreen) {
    return (
      <FullScreenLayout>
        {renderContent()}
      </FullScreenLayout>
    );
  }

  return renderContent();
}
