#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { importPipeline } from './lib/pipeline-io.js';
import { stubAgentFactory } from './orchestrator/stub-agent.js';
import { realAgentFactory } from './orchestrator/real-agent.js';
import type { AgentFactory } from './orchestrator/types.js';
import type { Pipeline } from './lib/types.js';

function printUsage(): void {
  console.log(`programatic-agent — Guided pipeline execution TUI with kanban

Usage:
  programatic-agent                       Open the TUI at the welcome screen
  programatic-agent run <pipeline.json>   Load pipeline and jump to the model picker
  programatic-agent --stub                Force the stub agent (no real LLM)
  programatic-agent --help                Show this help

Environment:
  OPENROUTER_API_KEY    Your OpenRouter key. Asked in the TUI when missing.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useStub = args.includes('--stub');
  const filtered = args.filter((a) => a !== '--stub');

  if (filtered.includes('--help') || filtered.includes('-h')) {
    printUsage();
    return;
  }

  let initialPipeline: Pipeline | undefined;
  let autoStart = false;

  if (filtered[0] === 'run') {
    const path = filtered[1];
    if (!path) {
      console.error('Usage: programatic-agent run <pipeline.json>');
      process.exit(1);
    }
    try {
      initialPipeline = importPipeline(path);
      autoStart = true;
    } catch (err) {
      console.error(`Failed to import pipeline: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  const agentFactory: AgentFactory = useStub ? stubAgentFactory : realAgentFactory;
  // Stub agents can't resolve merge conflicts; only enable the LLM resolver
  // when running with the real factory.
  const conflictResolverFactory: AgentFactory | undefined = useStub ? undefined : realAgentFactory;

  const { waitUntilExit } = render(
    <App
      initialPipeline={initialPipeline}
      agentFactory={agentFactory}
      conflictResolverFactory={conflictResolverFactory}
      requiresApiKey={!useStub}
      autoStart={autoStart}
    />,
  );
  await waitUntilExit();
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
