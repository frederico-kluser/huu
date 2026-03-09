// Root TUI application with screen routing
// Handles: setup wizard, config, run, status, and dashboard views

import React, { useState, useCallback } from 'react';
import { Box, useApp } from 'ink';
import { SetupWizard } from './screens/SetupWizard.js';
import type { SetupResult } from './screens/SetupWizard.js';
import { ConfigScreen } from './screens/ConfigScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import type { RunPhase, RunLogEntry, RunMetrics } from './screens/RunScreen.js';
import { StatusScreen } from './screens/StatusScreen.js';
import type { StatusSnapshot } from '../cli/commands/status.js';
import App from './App.js';
import type { AppProps } from './App.js';
import type { HuuConfig } from '../cli/config.js';

export type TuiScreen = 'setup' | 'config' | 'run' | 'status' | 'dashboard';

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
}

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
}: TuiAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<TuiScreen>(initialScreen);

  const handleSetupComplete = useCallback((result: SetupResult) => {
    if (onSetupComplete) {
      onSetupComplete(result);
    }
    exit();
  }, [onSetupComplete, exit]);

  const handleConfigSave = useCallback((cfg: HuuConfig) => {
    if (onConfigSave) {
      onConfigSave(cfg);
    }
    exit();
  }, [onConfigSave, exit]);

  const handleExit = useCallback(() => {
    exit();
  }, [exit]);

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
          onCancel={handleExit}
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
      return <App {...(dashboardProps ?? {})} />;
  }
}
