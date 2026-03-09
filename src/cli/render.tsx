// Ink rendering utilities for CLI commands
// Bridges CLI commands with TUI screens

import React from 'react';
import { render } from 'ink';
import { TuiApp } from '../tui/TuiApp.js';
import type { TuiScreen } from '../tui/TuiApp.js';
import type { SetupResult } from '../tui/screens/SetupWizard.js';
import type { RunPhase, RunLogEntry, RunMetrics } from '../tui/screens/RunScreen.js';
import type { StatusSnapshot } from './commands/status.js';
import { DEFAULT_AGENT_MODELS } from './config.js';
import type { HuuConfig } from './config.js';

// ── Setup Wizard ────────────────────────────────────────────────────

export interface SetupOptions {
  hasApiKey: boolean;
  hasInit: boolean;
}

export async function renderSetupWizard(options: SetupOptions): Promise<SetupResult> {
  return new Promise((resolve) => {
    const instance = render(
      <TuiApp
        initialScreen="setup"
        hasApiKey={options.hasApiKey}
        hasInit={options.hasInit}
        onSetupComplete={(result) => {
          resolve(result);
        }}
      />,
    );

    instance.waitUntilExit().catch(() => {
      resolve({
        apiKey: null,
        orchestratorModel: 'opus',
        workerModel: 'sonnet',
        supportModel: 'haiku',
        agentModels: { ...DEFAULT_AGENT_MODELS },
      });
    });
  });
}

// ── Config Screen ───────────────────────────────────────────────────

export async function renderConfigScreen(config: HuuConfig): Promise<HuuConfig | null> {
  return new Promise((resolve) => {
    let saved: HuuConfig | null = null;

    const instance = render(
      <TuiApp
        initialScreen="config"
        config={config}
        onConfigSave={(cfg) => {
          saved = cfg;
        }}
      />,
    );

    instance.waitUntilExit().then(() => {
      resolve(saved);
    }).catch(() => {
      resolve(null);
    });
  });
}

// ── Status Screen ───────────────────────────────────────────────────

export async function renderStatusScreen(snapshot: StatusSnapshot): Promise<void> {
  const instance = render(
    <TuiApp
      initialScreen="status"
      statusSnapshot={snapshot}
    />,
  );

  await instance.waitUntilExit().catch(() => {});
}

// ── Run Screen ──────────────────────────────────────────────────────

export interface RunScreenController {
  setPhase(phase: RunPhase): void;
  addLog(entry: Omit<RunLogEntry, 'id' | 'timestamp'>): void;
  setMetrics(metrics: RunMetrics): void;
  setError(error: string): void;
  waitUntilExit(): Promise<void>;
}

export function renderRunScreen(taskDescription: string): RunScreenController {
  let currentPhase: RunPhase = 'preparing';
  let currentLogs: RunLogEntry[] = [];
  let currentMetrics: RunMetrics | null = null;
  let currentError: string | null = null;
  let logCounter = 0;
  let rerenderFn: ((node: React.JSX.Element) => void) | null = null;

  function buildElement(): React.JSX.Element {
    return (
      <TuiApp
        initialScreen="run"
        taskDescription={taskDescription}
        runPhase={currentPhase}
        runLogs={[...currentLogs]}
        runMetrics={currentMetrics}
        runError={currentError}
      />
    );
  }

  const instance = render(buildElement());
  rerenderFn = (node) => instance.rerender(node);

  function update(): void {
    if (rerenderFn) {
      rerenderFn(buildElement());
    }
  }

  return {
    setPhase(phase: RunPhase) {
      currentPhase = phase;
      update();
    },
    addLog(entry) {
      logCounter++;
      currentLogs.push({
        id: `log-${logCounter}`,
        timestamp: new Date().toLocaleTimeString(),
        ...entry,
      });
      update();
    },
    setMetrics(metrics: RunMetrics) {
      currentMetrics = metrics;
      update();
    },
    setError(error: string) {
      currentError = error;
      currentPhase = 'failed';
      update();
    },
    async waitUntilExit() {
      await instance.waitUntilExit().catch(() => {});
    },
  };
}

// ── Full-Screen App ─────────────────────────────────────────────────

export interface FullScreenAppOptions {
  config: HuuConfig;
}

export async function renderFullScreenApp(options: FullScreenAppOptions): Promise<void> {
  const instance = render(
    <TuiApp
      initialScreen="dashboard"
      fullScreen={true}
      config={options.config}
      onConfigSave={(cfg) => {
        // Salvar configuração de forma atômica
        import('./config.js').then(({ writeConfigAtomic }) => {
          writeConfigAtomic(process.cwd(), cfg);
        }).catch(() => {
          // Ignora erro de salvamento silenciosamente
        });
      }}
      onNewTask={(description) => {
        // Por agora, loga a tarefa — será integrado com runSingleAgentTask futuramente
        console.log(`[HUU] Nova tarefa: ${description}`);
      }}
    />,
  );

  await instance.waitUntilExit().catch(() => {});
}
